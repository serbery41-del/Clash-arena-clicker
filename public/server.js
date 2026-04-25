const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const ngrok = require('ngrok'); // Added ngrok for public URL

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;
let PUBLIC_URL = process.env.PUBLIC_URL || null;
// Hardcoded authtoken to ensure ngrok bypasses local config issues
const NGROK_TOKEN = '3CqO0fo14rWJm3SPZzfE8mbSSqP_3mnSdv9m4FuRFk8G5TDXk';

// Game Constants & State
const rooms = {};
const lobbies = {};
const GAME_DURATION = 300; // 5 minutes default
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
    tax: { name: 'Tax Everyone', type: 'troll', effect: 'tax', baseCost: 800, costMultiplier: 1.6 }
};

// Serve static files
app.use(express.static('public'));

io.on('connection', (socket) => {
    socket.on('joinRoom', ({ playerName, roomCode, duration, maxPlayers }) => {
        const code = roomCode.toUpperCase();
        
        if (!rooms[code]) {
            initializeRoom(code, (duration || 5) * 60, maxPlayers || 4);
        }

        if (Object.keys(rooms[code].players).length >= rooms[code].maxPlayers) {
            return socket.emit('error', 'Room is full!');
        }

        socket.join(code);
        socket.roomCode = code;
        
        if (Object.keys(rooms[code].players).length === 0) {
            rooms[code].hostId = socket.id;
        }

        // CLEANUP: If this player already exists in the room (reconnection), 
        // clear their old timer to prevent double-scoring.
        if (rooms[code].timers && rooms[code].timers[socket.id]) {
            clearInterval(rooms[code].timers[socket.id]);
        }

        // Initialize player
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
            items: {}
        };
        
        // Initialize item counts
        Object.keys(SHOP_ITEMS).forEach(item => {
            rooms[code].players[socket.id].items[item] = 0;
        });

        // Auto-clicker timer
        rooms[code].timers[socket.id] = setInterval(() => {
            const room = rooms[code];
            const player = room?.players[socket.id];
            if (room && room.gameActive && player && player.autoClickers > 0 && !player.frozen) {
                player.score += (player.autoClickers * player.multiplier * player.clickPower);
                io.to(code).emit('gameState', room.players);
            }
        }, 1000);

        io.to(code).emit('gameState', rooms[code].players);
        io.to(code).emit('roomUpdate', { 
            players: rooms[code].players, 
            hostId: rooms[code].hostId,
            gameActive: rooms[code].gameActive // Include gameActive status
        });
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
            room.gameActive = true;
            io.to(socket.roomCode).emit('gameStarted');
        } else if (room && room.gameActive) {
            // If a non-host or a host trying to start an already active game,
            // just ensure they get the gameStarted event if they somehow missed it.
            // This handles late joiners who need to transition from lobby to game screen.
            // This is now triggered by the client's roomUpdate handler.
            // We can directly emit to the specific socket here if needed, but client logic handles it.
            io.to(socket.roomCode).emit('gameStarted');
        }
    });

    socket.on('buyUpgrade', (data) => {
        // SAFETY CHECK: Ensure data exists and player is in a room
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
        
        // Apply self-buffs
        if (item.type === 'self' || itemId === 'luckBoost') {
            switch(itemId) {
                case 'multiplier': player.multiplier += 1; break;
                case 'clickPower': player.clickPower += 1; break;
                case 'autoClicker': player.autoClickers += 1; break;
                case 'luckBoost': player.luckChance += 10; break;
                case 'megaDrill': player.autoClickers += 10; break;
            }
        }
        // Apply troll effects
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
            
            // Clean up empty rooms
            if (Object.keys(room.players).length === 0) {
                clearInterval(room.timers.gameTimer);
                delete rooms[socket.roomCode];
            } else if (socket.id === room.hostId) {
                // Reassign host
                room.hostId = Object.keys(room.players)[0];
                io.to(socket.roomCode).emit('roomUpdate', { 
                    players: room.players, 
                    hostId: room.hostId 
                });
            }
        }
        console.log('Player disconnected:', socket.id);
    });

    socket.on('createLobby', ({ lobbyName, duration }) => {
        const code = lobbyName.toUpperCase().replace(/\s+/g, '-');
        if (rooms[code]) {
            socket.emit('error', 'A room with this name already exists.');
            return;
        }

        initializeRoom(code, duration * 60);
        socket.emit('lobbyCreated', { name: lobbyName, code: code, duration });
        console.log(`🚀 Lobby Created: ${code} (${duration}m)`);
    });

    socket.on('joinLobby', ({ lobbyName }) => {
        const code = lobbyName.toUpperCase().replace(/\s+/g, '-');
        if (rooms[code]) {
            socket.emit('lobbyJoined', { name: lobbyName });
        } else {
            socket.emit('error', 'Lobby not found.');
        }
    });
});

function initializeRoom(code, durationInSeconds, maxPlayers) {
    rooms[code] = {
        code: code,
        players: {},
        timeLeft: durationInSeconds,
        gameActive: false,
        timers: {},
        maxPlayers: parseInt(maxPlayers) || 4,
        hostId: null
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

function applyTrollEffect(room, buyer, itemId, effect) {
    const opponents = Object.values(room.players).filter(p => p.id !== buyer.id);
    if (opponents.length === 0) {
        buyer.items[itemId]--; // Revert the purchase count
        buyer.score += getItemCost(itemId, buyer.items[itemId]); // Refund the original cost
        return;
    }
    
    const target = opponents[Math.floor(Math.random() * opponents.length)];
    
    switch(effect) {
        case 'steal':
            const stealAmount = Math.min(100, target.score);
            target.score -= stealAmount;
            buyer.score += stealAmount;
            io.to(room.code).emit('trollEvent', { 
                type: 'steal', from: target.name, to: buyer.name, amount: stealAmount 
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
                const tax = Math.floor(p.score * 0.15); // 15% tax
                p.score -= tax;
                totalTaxed += tax;
            });
            buyer.score += totalTaxed;
            io.to(room.code).emit('trollEvent', { 
                type: 'tax', from: buyer.name, amount: totalTaxed 
            });
            break;
    }
}

function getItemCost(itemId, owned) {
    const item = SHOP_ITEMS[itemId];
    return Math.floor(item.baseCost * Math.pow(item.costMultiplier, owned));
}

server.listen(PORT, async () => {
    try {
        if (!PUBLIC_URL) {
            // Explicitly pass the authtoken here to fix the "stubborn" connection issue
            PUBLIC_URL = await ngrok.connect({
                proto: 'http',
                addr: PORT,
                authtoken: NGROK_TOKEN
            });
        }
        console.log('═══════════════════════════════════════');
        console.log('🎮 CLICK CLASH ARENA IS LIVE');
        console.log('═══════════════════════════════════════');
        console.log(`Local Address:  http://localhost:${PORT}`);
        console.log(`Public URL:     ${PUBLIC_URL}`);
        console.log('═══════════════════════════════════════');
        console.log('Tip: Share the Public URL with your friends!');
    } catch (err) {
        console.log('═══════════════════════════════════════');
        console.log('❌ NGROK ERROR: The tunnel could not start.');
        console.log('💡 FIX: You need a free account from https://ngrok.com');
        console.log('   Then run: npx ngrok config add-authtoken YOUR_TOKEN');
        console.log('═══════════════════════════════════════');
        console.log(`Server is still running locally at: http://localhost:${PORT}`);
    }
});

// Gracefully close the ngrok tunnel when the server stops
process.on('SIGINT', async () => {
    console.log('\nStopping server and closing tunnel...');
    await ngrok.disconnect();
    process.exit();
});