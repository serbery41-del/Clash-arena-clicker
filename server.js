const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

// Game Constants & State
const rooms = {};
const GAME_DURATION = 300;
const SHOP_ITEMS = {
    multiplier: { name: 'Multiplier', type: 'self', baseCost: 50, costMultiplier: 1.5 },
    clickPower: { name: 'Click Power', type: 'self', baseCost: 100, costMultiplier: 1.8 },
    autoClicker: { name: 'Auto Clicker', type: 'self', baseCost: 200, costMultiplier: 2.0 },
    luckBoost: { name: 'Luck Boost', type: 'self', baseCost: 400, costMultiplier: 2.5 },
    megaDrill: { name: 'Mega Drill', type: 'self', baseCost: 1000, costMultiplier: 2.2 },
    steal: { name: 'Steal Points', type: 'troll', effect: 'steal', baseCost: 300, costMultiplier: 1.2 },
    freeze: { name: 'Freeze Opponent', type: 'troll', effect: 'freeze', baseCost: 400, costMultiplier: 1.3 },
    swap: { name: 'Swap Scores', type: 'troll', effect: 'swap', baseCost: 1000, costMultiplier: 1.5 },
    reduce: { name: 'Reduce Mult', type: 'troll', effect: 'reduce', baseCost: 600, costMultiplier: 1.4 },
    spam: { name: 'Emoji Spam', type: 'troll', effect: 'spam', baseCost: 150, costMultiplier: 1.1 },
    scramble: { name: 'UI Scramble', type: 'troll', effect: 'scramble', baseCost: 500, costMultiplier: 1.5 },
    tax: { name: 'Tax Everyone', type: 'troll', effect: 'tax', baseCost: 800, costMultiplier: 1.6 },
    jumpscare: { name: 'Jumpscare', type: 'troll', effect: 'jumpscare', baseCost: 600, costMultiplier: 1.4 }
};

// Serve static files
app.use(express.static('public'));

io.on('connection', (socket) => {
    socket.on('joinRoom', ({ playerName, roomCode, mode, duration, maxPlayers }) => {
        const code = roomCode.toUpperCase();
        
        if (!rooms[code]) {
            initializeRoom(code, (duration || 5) * 60, maxPlayers || 4, mode || 'classic');
        }

        if (Object.keys(rooms[code].players).length >= rooms[code].maxPlayers) {
            return socket.emit('error', 'Room is full!');
        }

        socket.join(code);
        socket.roomCode = code;
        
        if (Object.keys(rooms[code].players).length === 0) {
            rooms[code].hostId = socket.id;
        }

        if (rooms[code].timers && rooms[code].timers[socket.id]) {
            clearInterval(rooms[code].timers[socket.id]);
        }

        // Assign team for team mode
        let team = null;
        if (rooms[code].mode === 'teams') {
            const redCount = Object.values(rooms[code].players).filter(p => p.team === 'red').length;
            const blueCount = Object.values(rooms[code].players).filter(p => p.team === 'blue').length;
            team = redCount <= blueCount ? 'red' : 'blue';
        }

        rooms[code].players[socket.id] = {
            id: socket.id,
            name: playerName,
            score: 0,
            multiplier: 1,
            clickPower: 1,
            autoClickers: 0,
            luckChance: 0,
            frozen: false,
            frozenUntil: 0,
            items: {},
            team: team
        };
        
        Object.keys(SHOP_ITEMS).forEach(item => {
            rooms[code].players[socket.id].items[item] = 0;
        });

        rooms[code].timers[socket.id] = setInterval(() => {
            const room = rooms[code];
            const player = room?.players[socket.id];
            if (room && room.gameActive && player && player.autoClickers > 0 && !player.frozen) {
                player.score += (player.autoClickers * player.multiplier * player.clickPower);
                io.to(code).emit('gameState', room.players);
            }
        }, 1000);

        io.to(code).emit('gameState', rooms[code].players);
        io.to(code).emit('roomUpdate', { players: rooms[code].players, hostId: rooms[code].hostId, mode: rooms[code].mode });
        io.to(code).emit('shopItems', SHOP_ITEMS);
        io.to(code).emit('playerJoined', { name: playerName, players: Object.keys(rooms[code].players) });
    });

    socket.on('click', () => {
        const room = rooms[socket.roomCode];
        const player = room?.players[socket.id];
        
        if (room && room.gameActive && player && !player.frozen) {
            let points = player.multiplier * player.clickPower;
            
            if (Math.random() * 100 < player.luckChance) {
                points *= 2;
                io.to(socket.roomCode).emit('luckyHit', { playerId: socket.id, points });
            }
            
            player.score += points;
            io.to(socket.roomCode).emit('gameState', room.players);
        } else if (player?.frozen) {
            socket.emit('frozenMessage', { remaining: Math.ceil((player.frozenUntil - Date.now()) / 1000) });
        }
    });

    socket.on('startGame', () => {
        const room = rooms[socket.roomCode];
        if (room && socket.id === room.hostId && !room.gameActive) {
            // Shuffle teams if in team mode
            if (room.mode === 'teams') {
                shuffleTeams(room);
            }
            room.gameActive = true;
            io.to(socket.roomCode).emit('gameStarted');
            io.to(socket.roomCode).emit('gameState', room.players);
        }
    });

    socket.on('buyUpgrade', (data) => {
        if (!data || !data.itemId || !socket.roomCode) return;
        const itemId = data.itemId;
        const room = rooms[socket.roomCode];
        const player = room?.players[socket.id];
        const item = SHOP_ITEMS[itemId];
        
        if (!room || !room.gameActive || !player || !item) return;
        
        const cost = getItemCost(itemId, player.items[itemId] || 0);
        if (player.score < cost) return;

        player.score -= cost;
        player.items[itemId]++;
        
        if (item.type === 'self' || itemId === 'luckBoost') {
            switch(itemId) {
                case 'multiplier': player.multiplier += 1; break;
                case 'clickPower': player.clickPower += 1; break;
                case 'autoClicker': player.autoClickers += 1; break;
                case 'luckBoost': player.luckChance += 10; break;
                case 'megaDrill': player.autoClickers += 10; break;
            }
        }
        else if (item.type === 'troll') {
            applyTrollEffect(room, player, itemId, item.effect);
        }
        
        io.to(socket.roomCode).emit('gameState', room.players);
    });

    socket.on('disconnect', () => {
        if (socket.roomCode && rooms[socket.roomCode]) {
            const room = rooms[socket.roomCode];
            delete room.players[socket.id];
            
            if (room.timers[socket.id]) {
                clearInterval(room.timers[socket.id]);
            }
            
            io.to(socket.roomCode).emit('gameState', room.players);
            
            if (Object.keys(room.players).length === 0) {
                clearInterval(room.timers.gameTimer);
                delete rooms[socket.roomCode];
            } else if (socket.id === room.hostId) {
                room.hostId = Object.keys(room.players)[0];
                io.to(socket.roomCode).emit('roomUpdate', { 
                    players: room.players, 
                    hostId: room.hostId,
                    mode: room.mode
                });
            }
        }
        console.log('Player disconnected:', socket.id);
    });
});

function initializeRoom(code, durationInSeconds, maxPlayers, mode = 'classic') {
    rooms[code] = {
        code: code,
        players: {},
        timeLeft: durationInSeconds,
        gameActive: false,
        timers: {},
        maxPlayers: parseInt(maxPlayers) || 4,
        hostId: null,
        mode: mode
    };
    
    rooms[code].timers.gameTimer = setInterval(() => {
        const room = rooms[code];
        if (room && room.gameActive && room.timeLeft > 0) {
            rooms[code].timeLeft--;
            io.to(code).emit('updateTimer', room.timeLeft);
        } else if (rooms[code]) {
            rooms[code].gameActive = false;
            io.to(code).emit('gameOver', rooms[code].players);
            clearInterval(rooms[code].timers.gameTimer);
        }
    }, 1000);
}

function shuffleTeams(room) {
    const playerIds = Object.keys(room.players);
    // Fisher-Yates shuffle
    for (let i = playerIds.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [playerIds[i], playerIds[j]] = [playerIds[j], playerIds[i]];
    }
    
    // Assign teams alternately
    playerIds.forEach((id, index) => {
        room.players[id].team = index % 2 === 0 ? 'red' : 'blue';
    });
}

function applyTrollEffect(room, buyer, itemId, effect) {
    const opponents = Object.values(room.players).filter(p => p.id !== buyer.id);
    if (opponents.length === 0) {
        buyer.items[itemId]--;
        buyer.score += getItemCost(itemId, buyer.items[itemId]);
        return;
    }
    
    const target = opponents[Math.floor(Math.random() * opponents.length)];
    
    switch(effect) {
        case 'steal':
            const stealAmount = Math.min(100, target.score);
            target.score -= stealAmount;
            buyer.score += stealAmount;
            io.to(room.code).emit('trollEvent', { 
                type: 'steal', from: buyer.name, to: target.name, amount: stealAmount 
            });
            break;
            
        case 'freeze':
            target.frozen = true;
            target.frozenUntil = Date.now() + 5000;
            setTimeout(() => {
                if (room.players[target.id]) {
                    room.players[target.id].frozen = false;
                }
            }, 5000);
            io.to(room.code).emit('trollEvent', { 
                type: 'freeze', target: target.name, duration: 5 
            });
            break;
            
        case 'swap':
            const temp = buyer.score;
            buyer.score = target.score;
            target.score = temp;
            io.to(room.code).emit('trollEvent', { 
                type: 'swap', players: [buyer.name, target.name] 
            });
            break;
            
        case 'reduce':
            if (target.multiplier > 1) {
                target.multiplier -= 1;
                io.to(room.code).emit('trollEvent', { 
                    type: 'reduce', target: target.name 
                });
            }
            break;
            
        case 'scramble':
            io.to(room.code).emit('trollEvent', { 
                type: 'scramble', target: target.id, targetName: target.name 
            });
            break;

        case 'spam':
            const emojis = ['😂', '🤡', '💀', '🙃', '😎'];
            let spamCount = 0;
            const spamInterval = setInterval(() => {
                if (spamCount >= 5) {
                    clearInterval(spamInterval);
                    return;
                }
                io.to(room.code).emit('trollEvent', { 
                    type: 'spam', target: target.name, emoji: emojis[Math.floor(Math.random() * emojis.length)] 
                });
                spamCount++;
            }, 500);
            break;
            
        case 'tax':
            let totalTaxed = 0;
            opponents.forEach(p => {
                const tax = Math.floor(p.score * 0.15);
                p.score -= tax;
                totalTaxed += tax;
            });
            buyer.score += totalTaxed;
            io.to(room.code).emit('trollEvent', { 
                type: 'tax', from: buyer.name, amount: totalTaxed 
            });
            break;
            
        case 'jumpscare':
            io.to(room.code).emit('trollEvent', { 
                type: 'jumpscare', from: buyer.name, target: target.id, targetName: target.name 
            });
            break;
    }
}

function getItemCost(itemId, owned) {
    const item = SHOP_ITEMS[itemId];
    return Math.floor(item.baseCost * Math.pow(item.costMultiplier, owned));
}

server.listen(PORT, () => {
    console.log('═══════════════════════════════════════');
    console.log('🎮 CHROMA ARENA CLICKER IS LIVE');
    console.log('═══════════════════════════════════════');
    console.log(`Server running at: http://localhost:${PORT}`);
    console.log('═══════════════════════════════════════');
});

process.on('SIGINT', () => {
    console.log('\nStopping server...');
    process.exit();
});