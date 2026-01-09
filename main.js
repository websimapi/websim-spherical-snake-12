import * as THREE from 'three';
import { Game } from './game.js';
import { initLoader, showLoader, hideLoader } from './loader.js';

// Start Loading Screen immediately
initLoader();

// Setup basic Three.js scene
const scene = new THREE.Scene();

// Camera setup
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
// Position camera for a nice orbital view
const cameraRig = new THREE.Group();
scene.add(cameraRig);
cameraRig.add(camera);
camera.position.z = 25;
camera.position.y = 10;
camera.lookAt(0, 0, 0);

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Optimize for mobile
document.getElementById('game-container').appendChild(renderer.domElement);

// Lighting
// Bright ambient light to ensure no part of the sphere is too dark
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5); 
scene.add(ambientLight);

// Hemisphere light for natural, omnidirectional illumination
const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
scene.add(hemiLight);

// Camera-mounted light removed to prevent glare.
// Note: Camera is already added to the scene via cameraRig

 // Mute toggle button
const muteBtn = document.getElementById('mute-toggle');
if (muteBtn) {
    muteBtn.addEventListener('click', () => {
        // AudioManager is inside game now, we need to access it safely
        // But game is not const yet. Move this after.
    });
}

// Setup WebsimSocket
const room = new WebsimSocket();
let game;

room.initialize().then(() => {
    // Duplicate Check
    const me = room.peers[room.clientId];
    const others = Object.values(room.peers).filter(p => p.username === me.username && p.id !== me.id);
    
    if (others.length > 0) {
        document.body.innerHTML = '<div style="color:white;text-align:center;padding-top:20vh;font-family:sans-serif;"><h1>Connection Error</h1><p>You are already connected to this lobby in another tab.</p></div>';
        return;
    }

    // Initialize Game
    game = new Game(scene, camera, renderer, room);
    
    // Wire up mute button
    if (muteBtn) {
        muteBtn.addEventListener('click', () => {
            const muted = game.audioManager.toggleMuted();
            muteBtn.textContent = muted ? '🔇' : '🔊';
        });
    }

    if(me) {
        game.setPlayerInfo(me);
    }
});

// Raycaster for interaction
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function getIntersection(x, y) {
    mouse.x = (x / window.innerWidth) * 2 - 1;
    mouse.y = -(y / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    return raycaster.intersectObject(game.earth);
}

function handleInput(x, y) {
    const intersects = getIntersection(x, y);

    if (intersects.length > 0) {
        // Pass the intersection point to the game logic
        game.setTarget(intersects[0].point);
        
        // Remove start message on first tap
        const msg = document.getElementById('start-message');
        if(msg) msg.style.display = 'none';
    }
}

// Ripple Logic
let interactionStart = 0;

function handleRippleTrigger(x, y, duration) {
    const intersects = getIntersection(x, y);
    if (intersects.length > 0) {
        game.triggerRipple(intersects[0].point, duration);
    }
}

// Event Listeners
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Touch events for mobile
window.addEventListener('touchstart', (e) => {
    interactionStart = Date.now();
    if (game.isGameOver) {
        // Handled by click listener on game over modal
    } else {
        const touch = e.touches[0];
        handleInput(touch.clientX, touch.clientY);
    }
}, { passive: false });

window.addEventListener('touchend', (e) => {
    if (!game.isGameOver && e.changedTouches.length > 0) {
        const touch = e.changedTouches[0];
        const duration = Date.now() - interactionStart;
        handleRippleTrigger(touch.clientX, touch.clientY, duration);
    }
});

window.addEventListener('touchmove', (e) => {
    // Allow dragging to update direction continuously
    if(!game.isGameOver) {
        const touch = e.touches[0];
        handleInput(touch.clientX, touch.clientY);
    }
}, { passive: false });

// Mouse events for desktop testing
window.addEventListener('mousedown', (e) => {
    interactionStart = Date.now();
    if(!game.isGameOver) handleInput(e.clientX, e.clientY);
});
window.addEventListener('mouseup', (e) => {
    if(!game.isGameOver) {
        const duration = Date.now() - interactionStart;
        handleRippleTrigger(e.clientX, e.clientY, duration);
    }
});
window.addEventListener('mousemove', (e) => {
    if(e.buttons === 1 && !game.isGameOver) handleInput(e.clientX, e.clientY);
});

// UI Event Handlers
const gameOverScreen = document.getElementById('game-over');
const replayContainer = document.getElementById('replay-container');

// Restart / Return to Lobby
document.getElementById('btn-restart').addEventListener('click', (e) => {
    e.stopPropagation(); 
    if(game && game.isGameOver) {
        // We go to spectate mode which handles waiting in queue
        game.spectate();
        
        // Hide Game Over
        const gameOverEl = document.getElementById('game-over');
        gameOverEl.classList.remove('visible');
        setTimeout(() => gameOverEl.classList.add('hidden'), 500);
    }
});

// Watch Replay
document.getElementById('btn-replay').addEventListener('click', async (e) => {
    e.stopPropagation();
    
    // 1. Show Loading Screen to mask the heavy loading
    showLoader();
    
    // 2. Wait for fade-in (600ms) before doing work
    setTimeout(async () => {
        // Hide Game UI
        document.getElementById('ui-layer').classList.add('hidden');
        document.getElementById('game-container').classList.add('hidden');
        
        // Show Replay Container
        replayContainer.classList.remove('hidden');
        
        // Load Replay Logic
        // We use dynamic import for the JSX/Remotion module
        const { mountReplay } = await import('./replay.jsx');
        
        const data = game.getReplayJSON();
        mountReplay('replay-root', data);
        
        // 3. Hide Loading Screen (fade out)
        // Give Remotion a moment to mount
        setTimeout(() => {
            hideLoader();
        }, 100);
    }, 700);
});

// Close Replay
document.getElementById('close-replay').addEventListener('click', async () => {
    // Hide Replay
    replayContainer.classList.add('hidden');
    
    // Unmount React
    const { unmountReplay } = await import('./replay.jsx');
    unmountReplay();
    
    // Show Game UI
    document.getElementById('ui-layer').classList.remove('hidden');
    document.getElementById('game-container').classList.remove('hidden');
    
    // Ensure Game Over screen is still visible and interactable
    const gameOverEl = document.getElementById('game-over');
    gameOverEl.classList.remove('hidden');
    gameOverEl.classList.add('visible');
});

// Animation Loop
const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);
    
    const dt = Math.min(clock.getDelta(), 0.1); 
    
    if (game) {
        game.update(dt); // Game handles its own playing/waiting/spectating states
    }
    
    renderer.render(scene, camera);
}

animate();