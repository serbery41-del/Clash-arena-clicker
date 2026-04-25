const socket = io();
let isHost = false;
let currentMode = 'classic';
let audioCtx = null;

// Initialize AudioContext on first user interaction
function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioCtx;
}

function playClickSound() {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.setValueAtTime(800, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(400, audioCtx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.1);
}

function playBuySound() {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.setValueAtTime(400, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(800, audioCtx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.15);
}

function playLuckySound() {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(523, audioCtx.currentTime);
    osc.frequency.setValueAtTime(659, audioCtx.currentTime + 0.1);
    osc.frequency.setValueAtTime(784, audioCtx.currentTime + 0.2);
    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.3);
}

function playTrollSound() {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, audioCtx.currentTime);
    osc.frequency.setValueAtTime(100, audioCtx.currentTime + 0.1);
    osc.frequency.setValueAtTime(200, audioCtx.currentTime + 0.2);
    gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.3);
}

function playGameOverSound() {
    if (!audioCtx) return;
    const notes = [392, 440, 494, 523];
    notes.forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime + i * 0.15);
        gain.gain.setValueAtTime(0.2, audioCtx.currentTime + i * 0.15);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + i * 0.15 + 0.2);
        osc.start(audioCtx.currentTime + i * 0.15);
        osc.stop(audioCtx.currentTime + i * 0.15 + 0.2);
    });
}

function triggerJumpscare(imageUrl, soundUrl) {
    const overlay = document.getElementById('jumpscare-overlay');
    const img = document.getElementById('jumpscare-img');
    if (!overlay || !img) return;

    // Load Foxy's scream
    const jumpscareAudio = new Audio(soundUrl);
    jumpscareAudio.volume = 1.0; 

    img.src = imageUrl;
    overlay.style.display = 'flex';
    
    // Force a reflow and add a slight zoom for Foxy's lunge
    void overlay.offsetWidth;
    overlay.style.opacity = '1';
    overlay.style.transform = 'scale(1.1)'; 
    
    jumpscareAudio.play().catch(e => console.error("Foxy scream blocked or not found:", e));

    if ("vibrate" in navigator) {
        navigator.vibrate([500]); // Shock pulse
    }

    // Foxy is fast, so we keep the jumpscare duration short (800ms)
    setTimeout(() => {
        overlay.style.opacity = '0';
        overlay.style.transform = 'scale(1)';
        setTimeout(() => {
            overlay.style.display = 'none';
            img.src = '';
        }, 400);
    }, 800); 
}

function createFloatingEmoji(emoji) {
    const el = document.createElement('div');
    el.innerText = emoji;
    el.style.cssText = `
        position: fixed;
        left: ${Math.random() * 80 + 10}vw;
        top: 100vh;
        font-size: 4rem;
        z-index: 10000;
        pointer-events: none;
        transition: all 2.5s cubic-bezier(0.1, 0.25, 0.1, 1);
    `;
    document.body.appendChild(el);
    
    setTimeout(() => {
        el.style.top = '-15vh';
        el.style.transform = `rotate(${Math.random() * 360}deg)`;
        setTimeout(() => el.remove(), 2600);
    }, 50);
}

socket.on('connect', () => {
    console.log('Connected to server with ID:', socket.id);
});

// Initialize goal input fields on page load
document.addEventListener('DOMContentLoaded', () => {
    const goalInputs = document.querySelectorAll('.goal-input, .time-input');
    goalInputs.forEach(input => {
        input.setAttribute('min', '50000');
        input.setAttribute('max', '10000000');
        input.setAttribute('placeholder', '50,000 - 10,000,000');
        // Set a default value if it's empty or still showing old timer defaults
        if (!input.value || parseInt(input.value) < 50000 || parseInt(input.value) > 10000000) {
            input.value = '50000'; // Default to minimum
        }
    });
});

socket.on('error', (msg) => {
    alert(`Server Error: ${msg}`);
});

// UI Elements
const lobbyScreen = document.getElementById('lobby-screen');
const gameScreen = document.getElementById('game-screen');
const gameOverScreen = document.getElementById('game-over-screen');
const lobbyStatus = document.getElementById('lobby-status');

let startBtn = null;
let clickTarget = null;
const shopContainer = document.getElementById('shop-items');
const trollContainer = document.getElementById('troll-items');

// State
let shopItems = {};
let playerItems = {};

// 1. Join Room Logic
function joinGame(mode, cardSelector) {
    const card = document.querySelector(cardSelector);
    if (!card) return console.error(`Card selector ${cardSelector} not found!`);
    
    const playerName = card.querySelector('.name-input').value.trim();
    const roomCode = card.querySelector('.code-input').value.trim().toUpperCase();
    // Renamed selector to look for .time-input or .goal-input for backward compatibility
    const goalInputValue = (card.querySelector('.goal-input') || card.querySelector('.time-input')).value;
    const maxPlayers = card.querySelector('.players-input')?.value || 4;
    
    // Ensure client-side clamping matches server-side expectations
    const winGoal = Math.min(Math.max(parseInt(goalInputValue) || 50000, 50000), 10000000);

    if (playerName && roomCode) {
        currentMode = mode;
        socket.emit('joinRoom', { 
            playerName, 
            roomCode,
            mode,
            winGoal: winGoal,
            maxPlayers: parseInt(maxPlayers)
        });
        document.getElementById('current-room').innerText = roomCode;
    } else {
        alert("Please enter a name and a room code!");
    }
}

document.querySelector('.join-classic')?.addEventListener('click', () => {
    initAudio();
    joinGame('classic', '.mode-card:not(.team-mode-card)');
});

document.querySelector('.join-team')?.addEventListener('click', () => {
    initAudio();
    joinGame('teams', '.team-mode-card');
});

document.querySelector('.join-chaos')?.addEventListener('click', () => {
    initAudio();
    joinGame('chaos', '.chaos-mode-card');
});

// Start Game logic
startBtn = document.createElement('button');
startBtn.id = 'startBtn';
startBtn.className = 'primary-btn';
startBtn.innerText = 'Start Game';
startBtn.style.display = 'none';
document.getElementById('lobby-screen').appendChild(startBtn);

startBtn.addEventListener('click', () => {
    socket.emit('startGame');
});

socket.on('roomUpdate', ({ players, hostId, gameActive, winGoal }) => {
    isHost = socket.id === hostId;
    const playerCount = Object.keys(players).length;

    if (isHost) {
        startBtn.style.display = 'block';
        startBtn.innerText = "Start Game";
    } else {
        startBtn.style.display = 'none';
    }
    
    if (gameActive) {
        lobbyScreen.style.display = 'none';
        gameScreen.style.display = 'flex';
        document.getElementById('current-room').innerText = socket.roomCode || '';
    }

    // The header element that previously showed the timer now shows the Win Goal
    if (winGoal) {
        const headerDisplay = document.getElementById('timer');
        if (headerDisplay) headerDisplay.innerText = `Target: ${winGoal.toLocaleString()}`;
    }

    document.getElementById('lobby-status').innerText = `${playerCount} players in lobby`;
});

socket.on('gameStarted', () => {
    lobbyScreen.style.display = 'none';
    gameScreen.style.display = 'flex';
});

// Leave Room logic
const leaveBtn = document.getElementById('leaveBtn');
if (leaveBtn) {
    leaveBtn.addEventListener('click', () => {
        socket.emit('leaveRoom');
        window.location.reload(); // Refresh to ensure clean state
    });
}

socket.on('leftRoom', () => {
    gameScreen.style.display = 'none';
    lobbyScreen.style.display = 'flex';
});

// 2. Click the Gem
function getClickTarget() {
    if (!clickTarget) clickTarget = document.getElementById('click-target');
    return clickTarget;
}

getClickTarget().addEventListener('click', (e) => {
    e.preventDefault();
    socket.emit('click');
    playClickSound();
    
    // Visual squash effect
    getClickTarget().style.transform = 'scale(0.95)';
    setTimeout(() => {
        getClickTarget().style.transform = 'scale(1)';
    }, 100);
});

// 3. Buy Upgrade
function handleShopClick(e) {
    const btn = e.target.closest('.shop-btn');
    if (!btn) return;
    
    const itemId = btn.dataset.item;
    const item = shopItems[itemId];
    if (!item) return;

    const targetId = document.getElementById('troll-target-select').value;
    socket.emit('buyUpgrade', { itemId, targetId });
    playBuySound();
}

shopContainer.addEventListener('click', handleShopClick);
trollContainer.addEventListener('click', handleShopClick);

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

// 5. Update Game State
socket.on('gameState', (players) => {
    const leaderboardUI = document.getElementById('leaderboard');
    const targetSelect = document.getElementById('troll-target-select');
    const currentTarget = targetSelect.value;
    
    leaderboardUI.innerHTML = '';
    targetSelect.innerHTML = '<option value="random">Random Opponent</option>';

    const playersArray = Object.values(players);
    playersArray.sort((a, b) => b.score - a.score);

    playersArray.forEach((p, index) => {
        const avatarHtml = p.avatar ? `<img src="${p.avatar}" class="player-avatar-small" alt="avatar" style="width:20px;height:20px;border-radius:50%;">` : '';
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

        if (p.id === socket.id) {
            applyCursor(p.cursor);
            
            document.getElementById('my-score').innerText = `Score: ${p.score}`;
            document.getElementById('my-multiplier').innerText = `Multiplier: x${p.multiplier}`;
            document.getElementById('my-clickPower').innerText = `Click Power: x${p.clickPower}`;
            document.getElementById('my-autoClickers').innerText = `Auto Clickers: ${p.autoClickers}`;
            document.getElementById('my-luckChance').innerText = `Luck: ${p.luckChance}%`;
            
            playerItems = p.items;
            updateShopUI();

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
    playTrollSound();

    const messages = {
        steal: `🔥 ${event.from} stole ${event.amount} pts from ${event.to}!`,
        freeze: `❄️ ${event.target} is frozen for ${event.duration} sec!`,
        swap: `🔄 Scores swapped between ${event.players[0]} and ${event.players[1]}!`,
        reduce: `📉 ${event.target}'s multiplier decreased!`,
        spamNotification: `😂 ${event.target} is being spammed with emojis!`,
        tax: `💰 ${event.from} collected ${event.amount} in taxes!`,
        loudSoundTroll: `🔊 ${event.from} trolled ${event.targetName} with a loud sound!`,
        scramble: `🌀 ${event.targetName}'s controls were scrambled!`,
        jumpscare: `👻 ${event.from} triggered a jumpscare!`
    };

    if ((event.type === 'spam' || event.type === 'chaos_spam') && event.isTarget) {
        createFloatingEmoji(event.emoji);
    }

    if (event.type === 'scramble' && event.target === socket.id) {
        const nav = document.getElementById('emoji-nav');
        if (nav) nav.style.flexDirection = nav.style.flexDirection === 'row-reverse' ? 'row' : 'row-reverse';
        setTimeout(() => { nav.style.flexDirection = 'row'; }, 10000);
    }

    if (event.type === 'jumpscare' && (event.target === socket.id || event.target === 'ALL')) {
        if (event.showStatic) {
            triggerStaticOverlay(1500);
        }
        triggerJumpscare(event.imageUrl, event.soundUrl); // Pass image and sound URLs
        // Note: If jumpscare assets (image/sound) are not loading, consider hosting them locally or on a reliable CDN to avoid CORS or external service issues.
    }

    if (event.type === 'loudSoundTroll' && event.target === socket.id) {
        const trollOverlay = document.getElementById('troll-overlay');
        const trollImage = document.getElementById('troll-image');
        const trollSound = document.getElementById('troll-sound');

        if (trollOverlay && trollImage && trollSound) {
            trollImage.src = event.imageUrl;
            trollSound.src = event.soundUrl;
            trollOverlay.style.display = 'flex';
            trollSound.play().catch(e => console.error("Error playing loud sound troll:", e)); // Added .catch()
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
    notif.style.opacity = '1';
    
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
    playLuckySound();
});

// 8. Frozen Message
socket.on('frozenMessage', ({ remaining }) => {
    showNotification(`❄️ You are frozen! ${remaining}s left`);
});

// 11. Random Event
socket.on('randomEvent', (event) => {
    showNotification(`✨ Random Event: ${event.message}`);
});

// 10. Game Over
socket.on('gameOver', (players) => {
    playGameOverSound();
    gameScreen.style.display = 'none';
    gameOverScreen.style.display = 'flex';

    const resultsUI = document.getElementById('final-results');
    resultsUI.innerHTML = ''; // Clear previous results
    const playersArray = Object.values(players).sort((a, b) => b.score - a.score);

    playersArray.forEach((p, index) => {
        if (p.id === socket.id) {
            const resultHeader = document.createElement('h2');
            if (index === 0) {
                resultHeader.innerText = "🏆 You Win! 🏆";
            } else {
                resultHeader.innerText = "Better luck next time!";
            }
            gameOverScreen.prepend(resultHeader); // Prepend to ensure it's at the top
        }
        const li = document.createElement('li');
        li.innerHTML = `<strong>#${index + 1} ${p.name}</strong> - Final Score: ${p.score}`;
        resultsUI.appendChild(li);
    });
});