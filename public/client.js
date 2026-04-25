const socket = io();
let isHost = false;

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
const lobbyStatus = document.getElementById('lobby-status');

const startBtn = document.getElementById('startBtn');
const joinBtn = document.getElementById('joinBtn');
const clickTarget = document.getElementById('click-target');
const shopContainer = document.getElementById('shop-items');
const trollContainer = document.getElementById('troll-items');

// Customization UI Elements
const avatarUrlInput = document.getElementById('avatarUrl');
const cursorStyleInput = document.getElementById('cursorStyle');
const saveCustomizationBtn = document.getElementById('saveCustomizationBtn');
const myAvatar = document.getElementById('my-avatar');

// State
let shopItems = {};
let playerItems = {};

// 1. Join Room Logic
function joinGame(mode, cardSelector) {
    const card = document.querySelector(cardSelector);
    const playerName = card.querySelector('.name-input').value.trim();
    const roomCode = card.querySelector('.code-input').value.trim().toUpperCase();
    const duration = card.querySelector('.time-input').value;
    const maxPlayers = card.querySelector('.players-input')?.value || 4;
    
    const avatar = localStorage.getItem('playerAvatar') || '';
    const cursor = localStorage.getItem('playerCursor') || '';

    if (playerName && roomCode) {
        socket.emit('joinRoom', { 
            playerName, 
            roomCode,
            mode,
            duration: parseInt(duration),
            maxPlayers: parseInt(maxPlayers),
            avatar,
            cursor
        });
        document.getElementById('current-room').innerText = roomCode;
    } else {
        alert("Please enter a name and a room code!");
    }
}

document.querySelector('.join-classic').addEventListener('pointerdown', () => {
    joinGame('classic', '.mode-card:not(.team-mode-card)');
});

document.querySelector('.join-team').addEventListener('pointerdown', () => {
    joinGame('teams', '.team-mode-card');
});

// Customization Logic
saveCustomizationBtn.addEventListener('pointerdown', () => {
    localStorage.setItem('playerAvatar', avatarUrlInput.value.trim());
    localStorage.setItem('playerCursor', cursorStyleInput.value.trim());
    alert('Customization saved!');
    applyCursor(cursorStyleInput.value.trim());
});

// Load saved customization on page load
window.addEventListener('load', () => {
    avatarUrlInput.value = localStorage.getItem('playerAvatar') || '';
    cursorStyleInput.value = localStorage.getItem('playerCursor') || '';
});

// Start Game logic
startBtn.addEventListener('pointerdown', () => {
    socket.emit('startGame');
});

socket.on('roomUpdate', ({ players, hostId, gameActive }) => {
    isHost = socket.id === hostId;
    const playerCount = Object.keys(players).length;

    if (isHost) {
        startBtn.style.display = 'block';
        startBtn.innerText = "Start Game";
    } else {
        startBtn.style.display = 'none'; // Hide start button for non-hosts
    }
    
    // If the game is already active when a player joins, transition them to the game screen
    if (gameActive) {
        lobbyScreen.style.display = 'none';
        gameScreen.style.display = 'flex';
        // The server will send 'gameState' and 'shopItems' shortly after 'roomUpdate'
        // which will populate the game screen correctly.
        document.getElementById('current-room').innerText = document.getElementById('roomCode').value.trim().toUpperCase();
    }

    // Update player avatars/cursors on room update
    Object.values(players).forEach(p => {
        if (p.id === socket.id) {
            applyCursor(p.cursor);
            if (myAvatar) myAvatar.src = p.avatar;
        }
    });
    
    document.getElementById('lobby-status').innerText = `${playerCount} players in lobby`;
});

socket.on('gameStarted', () => {
    lobbyScreen.style.display = 'none';
    gameScreen.style.display = 'flex';
});

// Leave Room logic
const leaveBtn = document.getElementById('leaveBtn');
if (leaveBtn) {
    leaveBtn.addEventListener('pointerdown', () => {
        socket.emit('leaveRoom');
    });
}

socket.on('leftRoom', () => {
    gameScreen.style.display = 'none';
    lobbyScreen.style.display = 'flex';
});

// 2. Click the Gem
clickTarget.addEventListener('pointerdown', (e) => {
    e.preventDefault(); // Prevent accidental zoom/scrolling
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

    // Get selected target for trolls
    const targetId = document.getElementById('troll-target-select').value;
    socket.emit('buyUpgrade', { itemId, targetId });
}

shopContainer.addEventListener('pointerdown', handleShopClick);
trollContainer.addEventListener('pointerdown', handleShopClick);

function calculateCost(item, owned) {
    return Math.floor(item.baseCost * Math.pow(item.costMultiplier, owned));
}

// 4. Receive Shop Items
socket.on('shopItems', (items) => {
    shopItems = items;
    renderShop();
    updateShopUI();
});

function renderShop() {
    shopContainer.innerHTML = '';
    trollContainer.innerHTML = '';

    Object.keys(shopItems).forEach(id => {
        const item = shopItems[id];
        const btn = document.createElement('div');
        btn.className = 'shop-btn';
        btn.dataset.item = id;
        btn.innerHTML = `
            <div class="info">
                <span class="name">${item.name}</span>
                <span class="cost">Cost: ${item.baseCost}</span>
            </div>
            <div class="owned-count">0</div>
        `;

        if (item.type === 'troll') trollContainer.appendChild(btn);
        else shopContainer.appendChild(btn);
    });
}

function updateShopUI() {
    const allButtons = document.querySelectorAll('.shop-btn');
    allButtons.forEach(btn => {
        const itemId = btn.dataset.item;
        const item = shopItems[itemId];
        if (!item) return;
        
        const owned = playerItems[itemId] || 0;
        const cost = calculateCost(item, owned);
        
        btn.querySelector('.cost').innerText = `Cost: ${cost}`;
        const ownedLabel = btn.querySelector('.owned-count');
        if (ownedLabel) ownedLabel.innerText = owned;
    });
}

// 5. Update Game State (Leaderboard & Score)
socket.on('gameState', (players) => {
    const leaderboardUI = document.getElementById('leaderboard');
    const targetSelect = document.getElementById('troll-target-select');
    const currentTarget = targetSelect.value;
    
    leaderboardUI.innerHTML = '';
    targetSelect.innerHTML = '<option value="random">Random Opponent</option>';

    const playersArray = Object.values(players);
    playersArray.sort((a, b) => b.score - a.score);

    playersArray.forEach((p, index) => {
        const avatarHtml = p.avatar ? `<img src="${p.avatar}" class="player-avatar-small" alt="avatar">` : '';
        const teamTag = p.team ? `<span class="team-tag tag-${p.team}">${p.team.toUpperCase()}</span> ` : '';
        
        const li = document.createElement('li');
        li.className = p.team ? `team-${p.team}` : '';
        li.innerHTML = `<span>#${index + 1} ${avatarHtml} ${teamTag}${p.name}</span> <span>${p.score}</span>`;
        leaderboardUI.appendChild(li);

        // Update troll target dropdown
        if (p.id !== socket.id) {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.innerText = p.name + (p.team ? ` (${p.team})` : '');
            targetSelect.appendChild(opt);
        }

        if (p.id === socket.id) { // Rely solely on socket.id for current player's UI
            // Apply cursor and avatar for current player
            applyCursor(p.cursor);
            if (myAvatar) myAvatar.src = p.avatar;

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

    // Restore previous target selection if still valid
    if ([...targetSelect.options].some(o => o.value === currentTarget)) targetSelect.value = currentTarget;
});

// 6. Troll Events
socket.on('trollEvent', (event) => {
    if (!event) return;
    const messages = {
        steal: `🔥 ${event.from} stole ${event.amount} pts from ${event.to}!`,
        freeze: `❄️ ${event.target} is frozen for ${event.duration} sec!`,
        swap: `🔄 Scores swapped between ${event.players[0]} and ${event.players[1]}!`,
        reduce: `📉 ${event.target}'s multiplier decreased!`,
        spam: `😂 ${event.target} is being spammed with ${event.emoji}!`,
        tax: `💰 ${event.from} collected ${event.amount} in taxes!`,
        loudSoundTroll: `🔊 ${event.from} trolled ${event.targetName} with a loud sound!`,
        scramble: `🌀 ${event.targetName}'s controls were scrambled!`
    };

    // If I am the target of a scramble
    if (event.type === 'scramble' && event.target === socket.id) {
        const nav = document.getElementById('emoji-nav');
        nav.style.flexDirection = nav.style.flexDirection === 'row-reverse' ? 'row' : 'row-reverse';
        setTimeout(() => { nav.style.flexDirection = 'row'; }, 10000);
    }

    // Handle loud sound troll
    if (event.type === 'loudSoundTroll' && event.target === socket.id) {
        const trollOverlay = document.getElementById('troll-overlay');
        const trollImage = document.getElementById('troll-image');
        const trollSound = document.getElementById('troll-sound');

        if (trollOverlay && trollImage && trollSound) {
            trollImage.src = event.imageUrl;
            trollSound.src = event.soundUrl;
            trollOverlay.style.display = 'flex';
            trollSound.play();
            setTimeout(() => {
                trollOverlay.style.display = 'none';
            }, 3000); // Show for 3 seconds
        }
    }
    if (messages[event.type]) showNotification(messages[event.type]);
});

function showNotification(msg) {
    const notif = document.createElement('div');
    notif.className = 'troll-notification';
    notif.innerText = msg;
    document.body.appendChild(notif);
    notif.style.opacity = '1'; // Ensure it's visible initially
    
    // Smooth fade out
    setTimeout(() => {
        notif.style.opacity = '0';
        setTimeout(() => notif.remove(), 500);
    }, 2500);
}

function applyCursor(cursorStyle) {
    if (cursorStyle) {
        document.body.style.cursor = cursorStyle;
    }
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

// 11. Random Event
socket.on('randomEvent', (event) => {
    showNotification(`✨ Random Event: ${event.message}`);
});

// 10. Game Over
socket.on('gameOver', (players) => {
    gameScreen.style.display = 'none';
    gameOverScreen.style.display = 'flex';

    const resultsUI = document.getElementById('final-results');
    const playersArray = Object.values(players).sort((a, b) => b.score - a.score);

    playersArray.forEach((p, index) => {
        if (p.id === socket.id) {
            const resultHeader = document.createElement('h2');
            if (index === 0) {
                resultHeader.innerText = "🏆 You Win! 🏆";
            } else {
                resultHeader.innerText = "Better luck next time!";
            }
            gameOverScreen.prepend(resultHeader);
        }
        const li = document.createElement('li');
        li.innerHTML = `<strong>#${index + 1} ${p.name}</strong> - Final Score: ${p.score}`;
        resultsUI.appendChild(li);
    });
});