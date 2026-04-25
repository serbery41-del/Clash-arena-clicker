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
    tax: { name: 'Tax Everyone', type: 'troll', effect: 'tax', baseCost: 800, costMultiplier: 1.6 },
    loudSoundTroll: { name: 'Loud Sound Troll', type: 'troll', effect: 'loudSoundTroll', baseCost: 3000, costMultiplier: 1.0 } // New troll item
};

// Serve static files
app.use(express.static('public'));

io.on('connection', (socket) => {
    socket.on('joinRoom', ({ playerName, roomCode, duration, maxPlayers }) => {
    socket.on('joinRoom', ({ playerName, roomCode, duration, maxPlayers, avatar, cursor }) => {
        
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
            avatar: avatar || '', // Store avatar URL
            autoClickers: 0,
            cursor: cursor || 'default', // Store custom cursor style
            luckChance: 0,
            frozen: false,
            frozenUntil: 0,
            items: {},
            team: null
        };

        // Auto-assign teams if in team mode
        if (rooms[code].mode === 'teams') {
            const playerCount = Object.keys(rooms[code].players).length;
            rooms[code].players[socket.id].team = (playerCount % 2 === 0) ? 'blue' : 'red';
        }
        
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
        io.to(code).emit('roomUpdate', { players: rooms[code].players, hostId: rooms[code].hostId });
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
        }
    });

    socket.on('buyUpgrade', (data) => {
        // SAFETY CHECK: Ensure data exists and player is in a room
        if (!data || !data.itemId || !socket.roomCode) return;
        const itemId = data.itemId;
        const targetId = data.targetId;
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
            applyTrollEffect(room, player, itemId, item.effect, targetId);
        }
        
        io.to(socket.roomCode).emit('gameState', room.players);
    });

    socket.on('disconnect', () => { // Use a common handler for disconnect and leaveRoom
        if (socket.roomCode && rooms[socket.roomCode]) {
            handlePlayerDisconnect(socket, socket.roomCode);
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

function handlePlayerDisconnect(socket, roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    delete room.players[socket.id];
    
    if (room.timers[socket.id]) {
        clearInterval(room.timers[socket.id]);
        delete room.timers[socket.id]; // Remove the specific player's timer
    }
    
    io.to(roomCode).emit('gameState', room.players);
    
    // Clean up empty rooms
    if (Object.keys(room.players).length === 0) {
        clearInterval(room.timers.gameTimer);
        delete rooms[roomCode];
    } else if (socket.id === room.hostId) {
        // Reassign host
        room.hostId = Object.keys(room.players)[0];
        io.to(roomCode).emit('roomUpdate', { 
            players: room.players, 
            hostId: room.hostId, gameActive: room.gameActive });
    }
});

function initializeRoom(code, durationInSeconds, maxPlayers, mode) {
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

function applyTrollEffect(room, buyer, itemId, effect, targetId) {
    const opponents = Object.values(room.players).filter(p => p.id !== buyer.id);
    if (opponents.length === 0) {
        buyer.items[itemId]--; // Revert the purchase count
        buyer.score += getItemCost(itemId, buyer.items[itemId]); // Refund the original cost
        return;
    }
    
    let target;
    if (targetId && targetId !== 'random' && room.players[targetId]) {
        target = room.players[targetId];
    } else {
        target = opponents[Math.floor(Math.random() * opponents.length)];
    }
    
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
            
        case 'loudSoundTroll':
            // Example image and sound URLs - replace with actual assets
            const imageUrl = 'https://i.imgur.com/example_jumpscare.png'; // Placeholder image
            const soundUrl = 'https://www.soundjay.com/buttons/sounds/beep-07.mp3'; // Placeholder sound
            io.to(target.id).emit('trollEvent', {
                type: 'loudSoundTroll',
                from: buyer.name,
                target: target.id,
                targetName: target.name,
                imageUrl: imageUrl,
                soundUrl: soundUrl
            });
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

function triggerRandomEvent(roomCode) {
    const room = rooms[roomCode];
    if (!room || !room.gameActive || Object.keys(room.players).length === 0) return;

    const eventTypes = ['scoreBoostGlobal', 'scoreDrainGlobal', 'multiplierBoostRandom', 'freezeRandom'];
    const randomEventType = eventTypes[Math.floor(Math.random() * eventTypes.length)];
    const playersArray = Object.values(room.players);
    const randomPlayer = playersArray[Math.floor(Math.random() * playersArray.length)];

    let message = '';

    switch (randomEventType) {
        case 'scoreBoostGlobal':
            const globalBoost = 500;
            playersArray.forEach(p => p.score += globalBoost);
            message = `Everyone received a ${globalBoost} point boost!`;
            break;
        case 'scoreDrainGlobal':
            const globalDrainPercentage = 0.1; // 10%
            playersArray.forEach(p => p.score = Math.max(0, p.score * (1 - globalDrainPercentage)));
            message = `Everyone lost ${globalDrainPercentage * 100}% of their score!`;
            break;
        case 'multiplierBoostRandom':
            if (randomPlayer) {
                randomPlayer.multiplier += 2;
                message = `${randomPlayer.name} received a temporary multiplier boost!`;
                setTimeout(() => {
                    if (room.players[randomPlayer.id]) room.players[randomPlayer.id].multiplier -= 2;
                }, 15000); // Boost lasts 15 seconds
            }
            break;
        case 'freezeRandom':
            if (randomPlayer) {
                randomPlayer.frozen = true;
                randomPlayer.frozenUntil = Date.now() + 10000; // Freeze for 10 seconds
                message = `${randomPlayer.name} has been frozen!`;
            }
            break;
    }
    io.to(roomCode).emit('randomEvent', { message });
    io.to(roomCode).emit('gameState', room.players); // Update scores/multipliers
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