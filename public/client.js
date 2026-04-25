const socket = io();
socket.on('connect', () => {
    console.log('Connected to server with ID:', socket.id);
});

socket.on('error', (msg) => {
    alert(`Server Error: ${msg}`);
});

// UI Elements
const lobbyScreen = document.getElementById('lobby-screen');
const gameScreen = document.getElementById('game-screen');
const gameOverScreen = document.getElementById('game-over-screen');

const joinBtn = document.getElementById('joinBtn');
const clickTarget = document.getElementById('click-target');
const shopContainer = document.getElementById('shop-items');
const trollContainer = document.getElementById('troll-items');

// State
let shopItems = {};
let playerItems = {};

// 1. Join Room
joinBtn.addEventListener('click', () => {
    const playerName = document.getElementById('playerName').value.trim();
    const roomCode = document.getElementById('roomCode').value.trim().toUpperCase();

    if (playerName && roomCode) {
        socket.emit('joinRoom', { playerName, roomCode });
        
        document.getElementById('current-room').innerText = roomCode;
        lobbyScreen.style.display = 'none';
        gameScreen.style.display = 'block';
    } else {
        alert("Please enter a name and a room code!");
    }
});

// 2. Click the Gem
clickTarget.addEventListener('mousedown', () => {
    socket.emit('click');
    // Visual Polish: Squash effect
    clickTarget.style.transform = 'scale(0.95)';
    setTimeout(() => {
        clickTarget.style.transform = 'scale(1)';
    }, 100);
});

// 3. Buy Upgrade - Handle all shop buttons
function handleShopClick(e) {
    const btn = e.target.closest('.shop-btn');
    if (!btn) return;
    
    const itemId = btn.dataset.item;
    const item = shopItems[itemId];
    if (!item) return;
    
    socket.emit('buyUpgrade', { itemId });
}

shopContainer.addEventListener('click', handleShopClick);
trollContainer.addEventListener('click', handleShopClick);

function calculateCost(item, owned) {
    return Math.floor(item.baseCost * Math.pow(item.costMultiplier, owned));
}

// 4. Receive Shop Items
socket.on('shopItems', (items) => {
    shopItems = items;
    updateShopUI();
});

function updateShopUI() {
    const allButtons = document.querySelectorAll('.shop-btn');
    allButtons.forEach(btn => {
        const itemId = btn.dataset.item;
        const item = shopItems[itemId];
        if (!item || !playerItems) return;
        
        const owned = playerItems[itemId] || 0;
        const cost = calculateCost(item, owned);
        
        btn.querySelector('.cost').innerText = `Cost: ${cost}`;
    });
}

// 5. Update Game State (Leaderboard & Score)
socket.on('gameState', (players) => {
    const leaderboardUI = document.getElementById('leaderboard');
    leaderboardUI.innerHTML = '';

    const playersArray = Object.values(players);
    playersArray.sort((a, b) => b.score - a.score);

    playersArray.forEach((p, index) => {
        const li = document.createElement('li');
        li.innerHTML = `<span>#${index + 1} ${p.name}</span> <span>${p.score}</span>`;
        leaderboardUI.appendChild(li);

        if (p.id === socket.id) { // Rely solely on socket.id for current player's UI
            document.getElementById('my-score').innerText = `Score: ${p.score}`;
            document.getElementById('my-multiplier').innerText = `Multiplier: x${p.multiplier}`;
            document.getElementById('my-clickPower').innerText = `Click Power: x${p.clickPower}`;
            document.getElementById('my-autoClickers').innerText = `Auto Clickers: ${p.autoClickers}`;
            document.getElementById('my-luckChance').innerText = `Luck: ${p.luckChance}%`;
            
            playerItems = p.items;
            updateShopUI();
            
            // Gray out buttons if can't afford
            const allButtons = document.querySelectorAll('.shop-btn');
            allButtons.forEach(btn => {
                const itemId = btn.dataset.item;
                const item = shopItems[itemId];
                if (!item) return;
                const owned = playerItems[itemId] || 0;
                const cost = calculateCost(item, owned);
                
                btn.style.opacity = p.score < cost ? '0.5' : '1';
            });
        }
    });
});

// 6. Troll Events
socket.on('trollEvent', (event) => {
    if (!event) return;
    const messages = {
        steal: `🔥 ${event.from} stole ${event.amount} pts from ${event.to}!`,
        freeze: `❄️ ${event.target} is frozen for ${event.duration} sec!`,
        swap: `🔄 Scores swapped between ${event.players[0]} and ${event.players[1]}!`,
        reduce: `📉 ${event.target}'s multiplier decreased!`,
        spam: `😂 ${event.target} is being spammed with ${event.emoji}!`
    };
    
    if (messages[event.type]) showNotification(messages[event.type]);
});

function showNotification(msg) {
    const notif = document.createElement('div');
    notif.className = 'troll-notification';
    notif.innerText = msg;
    document.body.appendChild(notif);
    
    // Smooth fade out
    setTimeout(() => {
        notif.style.opacity = '0';
        setTimeout(() => notif.remove(), 500);
    }, 2500);
}

// 7. Lucky Hit
socket.on('luckyHit', ({ playerId, points }) => {
    console.log(`Lucky hit! +${points} bonus points`);
});

// 8. Frozen Message
socket.on('frozenMessage', ({ remaining }) => {
    showNotification(`❄️ You are frozen! ${remaining}s left`);
});

// 9. Update Timer
socket.on('updateTimer', (timeLeft) => {
    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    document.getElementById('timer').innerText = 
        `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
});

// 10. Game Over
socket.on('gameOver', (players) => {
    gameScreen.style.display = 'none';
    gameOverScreen.style.display = 'flex';

    const resultsUI = document.getElementById('final-results');
    const playersArray = Object.values(players).sort((a, b) => b.score - a.score);

    playersArray.forEach((p, index) => {
        const li = document.createElement('li');
        li.innerHTML = `<strong>#${index + 1} ${p.name}</strong> - Final Score: ${p.score}`;
        resultsUI.appendChild(li);
    });
});