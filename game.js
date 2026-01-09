import * as THREE from 'three';
import { Snake } from './snake.js';
import { FoodManager } from './food-manager.js';
import { AudioManager } from './audio-manager.js';
import { ReplayRecorder } from './replay-recorder.js';
import { hideLoader } from './loader.js';
import { getRippleHeight } from './math-utils.js';

export class Game {
    constructor(scene, camera, renderer, room) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
        this.room = room;
        
        // Constants
        this.EARTH_RADIUS = 10;
        this.MAX_PLAYERS = 8;
        this.INVULN_TIME = 5000;
        
        // State
        this.isPlaying = false; // "Playing" means controlling a snake
        this.isGameOver = false; // Local "game over" state (transitioning to lobby)
        this.isWaiting = true; // In lobby queue
        this.score = 0;
        this.growthPoints = 0;
        this.time = 0;
        
        // Networking State
        this.joinedLobbyTime = Date.now();
        this.spawnTime = 0;
        this.remoteSnakes = new Map(); // clientId -> { headMesh, segments: [], data: {} }

        // Visuals
        this.rippleUniforms = {
            uTime: { value: 0 },
            uRippleCenters: { value: new Array(5).fill().map(() => new THREE.Vector3()) },
            uRippleStartTimes: { value: new Array(5).fill(-1000) },
            uRippleIntensities: { value: new Array(5).fill(0) }
        };
        this.currentRippleIdx = 0;
        
        // Player Info
        this.playerInfo = { username: 'Player', avatarUrl: '' };
        
        // Components
        this.audioManager = new AudioManager();
        this.recorder = new ReplayRecorder(30);
        
        // Entities
        this.earth = null;
        this.snake = null; 
        this.foodManager = null; 

        this.targetPoint = null;

        // Queue Logic
        this.room.updatePresence({
            joinedAt: this.joinedLobbyTime,
            isPlaying: false
        });

        const lobbyEl = document.getElementById('lobby-ui');
        if(lobbyEl) lobbyEl.classList.remove('hidden');

        this.init();
    }

    setPlayerInfo(info) {
        this.playerInfo = info;
        // Avatar loading handled by UI logic in Main or Game
        // We'll trigger the ready state when we actually join the lobby properly
        this.updateUI();
    }

    updateUI() {
        const avatarEl = document.getElementById('player-avatar');
        const nameEl = document.getElementById('player-name');
        
        if (nameEl && this.playerInfo.username) {
            nameEl.textContent = this.playerInfo.username;
        }
        
        if (avatarEl && this.playerInfo.avatarUrl) {
             avatarEl.src = this.playerInfo.avatarUrl || './default_avatar.png';
        }
    }

    init() {
        this.audioManager.load('eat', './snake_eat.mp3');
        this.audioManager.load('die', './game_over.mp3');

        this.createEarth();

        this.snake = new Snake(this.scene, this.EARTH_RADIUS);
        
        // Init Food Manager with Room
        this.foodManager = new FoodManager(this.scene, this.EARTH_RADIUS, this.room);
        
        // We don't spawn food here anymore, we wait for room state or spawn if we become active
        
        // Initial setup
        document.body.classList.add('ready');
        hideLoader();
    }
    
    createEarth() {
        const geometry = new THREE.SphereGeometry(this.EARTH_RADIUS, 64, 64);
        const material = new THREE.MeshStandardMaterial({
            color: 0x88ccff,
            emissive: 0x002244, 
            emissiveIntensity: 0.8,
            transparent: true,
            opacity: 0.7,
            roughness: 0.9,
            metalness: 0.0,
            side: THREE.DoubleSide
        });

        // Inject Ripple Shader Logic
        material.onBeforeCompile = (shader) => {
            shader.uniforms.uTime = this.rippleUniforms.uTime;
            shader.uniforms.uRippleCenters = this.rippleUniforms.uRippleCenters;
            shader.uniforms.uRippleStartTimes = this.rippleUniforms.uRippleStartTimes;
            shader.uniforms.uRippleIntensities = this.rippleUniforms.uRippleIntensities;

            shader.vertexShader = `varying vec3 vWorldPos;\n` + shader.vertexShader;
            shader.vertexShader = shader.vertexShader.replace(
                '#include <worldpos_vertex>',
                `#include <worldpos_vertex>
                vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
            );

            const rippleFunc = `
                uniform float uTime;
                uniform vec3 uRippleCenters[5];
                uniform float uRippleStartTimes[5];
                uniform float uRippleIntensities[5];
                varying vec3 vWorldPos;

                float getRipple(int i, vec3 pos) {
                    float startTime = uRippleStartTimes[i];
                    if (startTime < 0.0) return 0.0;
                    
                    float age = uTime - startTime;
                    if (age < 0.0 || age > 2.0) return 0.0; // Lifetime 2s
                    
                    vec3 center = uRippleCenters[i];
                    float intensity = uRippleIntensities[i];
                    
                    float dotProd = dot(normalize(pos), normalize(center));
                    float angle = acos(clamp(dotProd, -1.0, 1.0));
                    float dist = angle * 10.0; // approx distance on sphere radius 10
                    
                    float speed = 8.0; 
                    float waveCenter = age * speed;
                    float distDiff = dist - waveCenter;
                    
                    float ripple = 0.0;
                    // Wave packet width
                    if (abs(distDiff) < 2.0) {
                        ripple = sin(distDiff * 3.0) * exp(-distDiff * distDiff);
                    }
                    
                    // Fade out
                    ripple *= (1.0 - age / 2.0);
                    ripple *= intensity;
                    return ripple;
                }
            `;

            shader.fragmentShader = rippleFunc + shader.fragmentShader;
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <dithering_fragment>',
                `#include <dithering_fragment>
                float totalRipple = 0.0;
                for(int i=0; i<5; i++) {
                    totalRipple += getRipple(i, vWorldPos);
                }
                if (abs(totalRipple) > 0.01) {
                    float strength = smoothstep(0.0, 0.5, abs(totalRipple));
                    vec3 rippleColor = vec3(0.7, 0.9, 1.0);
                    gl_FragColor.rgb = mix(gl_FragColor.rgb, rippleColor, strength * 0.4);
                    gl_FragColor.rgb += rippleColor * strength * 0.2;
                }`
            );
        };

        this.earth = new THREE.Mesh(geometry, material);
        this.scene.add(this.earth);
        
        const atmGeometry = new THREE.SphereGeometry(this.EARTH_RADIUS * 1.03, 64, 64);
        const atmMaterial = new THREE.MeshBasicMaterial({
            color: 0x4488ff,
            transparent: true,
            opacity: 0.1,
            side: THREE.BackSide
        });
        this.scene.add(new THREE.Mesh(atmGeometry, atmMaterial));
    }
    
    startGame() {
        // Called when we leave the queue and start playing
        console.log("Starting Game!");
        
        this.isPlaying = true;
        this.isWaiting = false;
        this.isGameOver = false;
        this.spawnTime = Date.now();
        this.score = 0;
        this.growthPoints = 0;
        
        this.snake.reset();
        this.recorder.reset();
        
        // Don't reset food manager entirely, as other players share it
        // But we can ensure food exists
        if (!this.foodManager.food.visible) {
            // Force a spawn if missing
             this.foodManager.spawnFood();
        }

        // Reset Visuals
        this.rippleUniforms.uRippleStartTimes.value.fill(-1000);
        
        // Reset Camera
        this.updateCamera(0.1, true); 
        
        this.targetPoint = null;
        
        const scoreEl = document.getElementById('player-score');
        if(scoreEl) scoreEl.innerText = this.score;
        
        const gameOverEl = document.getElementById('game-over');
        if (gameOverEl) {
            gameOverEl.classList.remove('visible');
            gameOverEl.classList.add('hidden');
        }
        
        const lobbyEl = document.getElementById('lobby-ui');
        if(lobbyEl) lobbyEl.classList.add('hidden');

        // Update Presence
        this.room.updatePresence({
            joinedAt: this.joinedLobbyTime, // Keep original join time
            isPlaying: true,
            spawnTime: this.spawnTime,
            score: 0,
            snake: {
                head: this.snake.head.position.toArray(),
                segments: this.snake.segments.map(s => ({ pos: s.position.toArray(), color: s.material.color.getHex() }))
            }
        });
    }

    spectate() {
        this.isPlaying = false;
        this.isWaiting = true;
        
        // Move camera to a nice orbit or follow someone
        // For simplicity, just orbit
        this.targetPoint = null;
        
        // Hide local snake
        this.snake.reset();
        this.snake.head.position.set(0,0,0); // Hide inside earth
        this.snake.segments.forEach(s => s.position.set(0,0,0));

        const lobbyEl = document.getElementById('lobby-ui');
        if(lobbyEl) lobbyEl.classList.remove('hidden');
    }

    playSound(name, volume = 1.0) {
        this.audioManager.play(name, volume);
        this.recorder.recordEvent(name, { volume });
    }

    setTarget(point) {
        if(this.isGameOver) return;
        this.audioManager.resume();
        this.targetPoint = point.clone().normalize().multiplyScalar(this.EARTH_RADIUS);
    }

    triggerRipple(point, durationMs) {
        const idx = this.currentRippleIdx;
        this.rippleUniforms.uRippleCenters.value[idx].copy(point);
        this.rippleUniforms.uRippleStartTimes.value[idx] = this.time;
        
        // Intensity logic based on hold duration
        // Short tap (<200ms) -> 0.15
        // Long tap (>600ms) -> 0.45
        let intensity = 0.15;
        if (durationMs > 200) {
            const factor = Math.min((durationMs - 200) / 400, 1.0);
            intensity = 0.15 + factor * 0.3;
        }
        
        this.rippleUniforms.uRippleIntensities.value[idx] = intensity;
        
        this.currentRippleIdx = (this.currentRippleIdx + 1) % 5;

        // Record for replay
        this.recorder.recordEvent('ripple', { 
            center: point.toArray(), 
            duration: durationMs 
        });
    }

    update(dt) {
        this.time += dt;
        this.rippleUniforms.uTime.value = this.time;

        this.updateNetworkState();

        const rippleFn = (pos) => {
            return getRippleHeight(
                pos,
                this.time,
                this.rippleUniforms.uRippleCenters.value,
                this.rippleUniforms.uRippleStartTimes.value,
                this.rippleUniforms.uRippleIntensities.value,
                this.EARTH_RADIUS
            );
        };

        if (this.isPlaying && !this.isGameOver) {
            // Update Invulnerability
            const isInvulnerable = (Date.now() - this.spawnTime) < this.INVULN_TIME;
            this.snake.setInvulnerable(isInvulnerable);

            // 1. Update Snake
            const moveDist = this.snake.update(dt, this.targetPoint, rippleFn);
            if (moveDist > 0 && this.targetPoint && this.snake.head.position.distanceTo(this.targetPoint) < 1.0) {
                this.targetPoint = null;
            }

            // 2. Update Food Manager
            this.foodManager.update(moveDist, this.snake.getTailPosition(), rippleFn);

            // 3. Collision Checks (Food)
            const collisions = this.foodManager.checkCollisions(this.snake.head.position);
            
            if (collisions.mainFood) {
                this.playSound('eat', 0.33);
                this.score += 5;
                this.growthPoints += 5;
                
                const scoreEl = document.getElementById('player-score');
                if(scoreEl) scoreEl.innerText = this.score;
                
                this.foodManager.spawnFood(this.snake.head.position, this.snake.segments);
                this.snake.triggerTongue();
            }

            // Check Growth
            while (this.growthPoints >= 10) {
                this.snake.addSegment();
                this.growthPoints -= 10;
            }

            // 4. Collision Checks (Death)
            if (!isInvulnerable) {
                // Self Collision
                if (this.snake.checkSelfCollision()) {
                    this.gameOver();
                }
                
                // Remote Collision
                this.checkRemoteCollisions();
            }

            // Update Presence with new state
            this.room.updatePresence({
                isPlaying: true,
                spawnTime: this.spawnTime,
                score: this.score,
                snake: {
                    head: this.snake.head.position.toArray(),
                    segments: this.snake.segments.map(s => ({ pos: s.position.toArray(), color: s.material.color.getHex() }))
                }
            });

            // 5. Update Camera
            this.updateCamera(dt);

            // 6. Record Frame
            this.recorder.update(dt, () => this.getSnapshot());

        } else {
            // Spectator Mode
            this.updateSpectatorCamera(dt);
        }

        // Always update remote visuals
        this.updateRemoteSnakes(dt, rippleFn);
    }
    
    checkRemoteCollisions() {
        const headNorm = this.snake.head.position.clone().normalize();
        
        for (const [id, remote] of this.remoteSnakes) {
            // Don't collide with invulnerable players
            const spawnTime = remote.data.spawnTime || 0;
            if (Date.now() - spawnTime < this.INVULN_TIME) continue;

            if (remote.data.snake && remote.data.snake.segments) {
                // Check against segments
                for (const segData of remote.data.snake.segments) {
                    const segPos = new THREE.Vector3().fromArray(segData.pos);
                    const segNorm = segPos.normalize();
                    if (headNorm.distanceTo(segNorm) * this.EARTH_RADIUS < 0.6) {
                        this.gameOver();
                        return;
                    }
                }
                
                // Check against head?
                // Optional: Head-to-head collision
                 const remoteHead = new THREE.Vector3().fromArray(remote.data.snake.head);
                 if (headNorm.distanceTo(remoteHead.normalize()) * this.EARTH_RADIUS < 0.8) {
                     this.gameOver();
                     return;
                 }
            }
        }
    }

    updateNetworkState() {
        // Lobby Logic
        const allPeers = Object.values(this.room.peers);

        // 1. Identify who is playing (Count everyone who claims to be playing)
        const playingPeers = allPeers.filter(p => this.room.presence[p.id]?.isPlaying);

        // 2. Identify who is validly waiting (Must have joinedAt to be in queue)
        // This filters out peers who are initializing or have broken presence data
        const waitingPeers = allPeers
            .filter(p => !this.room.presence[p.id]?.isPlaying && this.room.presence[p.id]?.joinedAt)
            .sort((a, b) => {
                const tA = this.room.presence[a.id].joinedAt;
                const tB = this.room.presence[b.id].joinedAt;
                return tA - tB; // Oldest first
            });
        
        if (this.isWaiting) {
            // Calculate my position in queue
            const myIndex = waitingPeers.findIndex(p => p.id === this.room.clientId);
            const canJoin = playingPeers.length < this.MAX_PLAYERS && myIndex === 0;
            
            // UI Update
            const qStat = document.getElementById('queue-status');
            const qPos = document.getElementById('queue-position');
            
            if (myIndex === -1) {
                // Presence hasn't propagated yet
                if (qStat) {
                    qStat.innerText = "Connecting...";
                    qStat.style.color = "#ffd700";
                }
                if (qPos) qPos.innerText = `Syncing lobby state...`;
            } else {
                if (qStat) {
                    qStat.innerText = canJoin ? "Joining..." : "Waiting for slot...";
                    qStat.style.color = canJoin ? "#00ff00" : "#ffd700";
                }
                if (qPos) qPos.innerText = `Queue Position: ${myIndex + 1} / ${waitingPeers.length}\nActive Players: ${playingPeers.length}/${this.MAX_PLAYERS}`;
            }

            if (canJoin) {
                // Safety delay to ensure state propagation
                if (!this.joinAttemptTime) this.joinAttemptTime = Date.now();
                if (Date.now() - this.joinAttemptTime > 500) {
                    this.startGame();
                    this.joinAttemptTime = 0;
                }
            } else {
                this.joinAttemptTime = 0;
            }
        }
    }

    updateRemoteSnakes(dt, rippleFn) {
        // Prune disconnected
        for(const [id, snakeObj] of this.remoteSnakes) {
            if(!this.room.peers[id] || !this.room.presence[id]?.isPlaying) {
                this.scene.remove(snakeObj.headMesh);
                snakeObj.segments.forEach(s => this.scene.remove(s));
                this.remoteSnakes.delete(id);
            }
        }

        // Update/Create
        Object.keys(this.room.peers).forEach(id => {
            if (id === this.room.clientId) return; // Skip self

            const presence = this.room.presence[id];
            if (!presence || !presence.isPlaying || !presence.snake) return;

            let remote = this.remoteSnakes.get(id);
            if (!remote) {
                // Create
                const headGeo = new THREE.BoxGeometry(0.8, 0.4, 0.8);
                const headMat = new THREE.MeshStandardMaterial({ color: 0xff0000 }); // Red for enemies
                const headMesh = new THREE.Mesh(headGeo, headMat);
                this.scene.add(headMesh);
                
                remote = {
                    headMesh,
                    segments: [],
                    data: presence
                };
                this.remoteSnakes.set(id, remote);
            }
            
            // Update Data ref
            remote.data = presence;
            
            // Invulnerability Visuals for remote
            const isRemoteInvuln = (Date.now() - (presence.spawnTime || 0)) < this.INVULN_TIME;
            if (isRemoteInvuln) {
                remote.headMesh.material.opacity = (Math.sin(this.time * 15) > 0) ? 0.8 : 0.2;
                remote.headMesh.material.transparent = true;
            } else {
                remote.headMesh.material.opacity = 1.0;
                remote.headMesh.material.transparent = false;
            }

            // Sync Head
            const targetPos = new THREE.Vector3().fromArray(presence.snake.head);
            // Apply ripple displacement
            const h = rippleFn(targetPos);
            targetPos.setLength(this.EARTH_RADIUS + h);
            
            remote.headMesh.position.lerp(targetPos, 0.5); // Simple lerp
            remote.headMesh.lookAt(0,0,0); // Simplified orientation

            // Sync Segments
            const segData = presence.snake.segments || [];
            
            // Grow
            while(remote.segments.length < segData.length) {
                const sGeo = new THREE.BoxGeometry(0.6, 0.3, 0.6);
                const sMat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa });
                const mesh = new THREE.Mesh(sGeo, sMat);
                this.scene.add(mesh);
                remote.segments.push(mesh);
            }
            // Shrink
            while(remote.segments.length > segData.length) {
                const mesh = remote.segments.pop();
                this.scene.remove(mesh);
            }
            
            // Position
            remote.segments.forEach((mesh, i) => {
                const sData = segData[i];
                const pos = new THREE.Vector3().fromArray(sData.pos);
                // Ripple
                const sh = rippleFn(pos);
                pos.setLength(this.EARTH_RADIUS + sh);
                
                mesh.position.lerp(pos, 0.5);
                mesh.lookAt(0,0,0);
                mesh.material.color.setHex(sData.color); // Use their color
                
                if (isRemoteInvuln) {
                    mesh.material.opacity = remote.headMesh.material.opacity;
                    mesh.material.transparent = true;
                } else {
                    mesh.material.opacity = 1.0;
                    mesh.material.transparent = false;
                }
            });
        });
    }

    updateSpectatorCamera(dt) {
        // Orbit around earth slowly
        const speed = 0.2;
        const x = Math.sin(this.time * speed) * 30;
        const z = Math.cos(this.time * speed) * 30;
        const y = 20;
        
        this.camera.position.lerp(new THREE.Vector3(x, y, z), dt);
        this.camera.lookAt(0,0,0);
    }
    
    updateCamera(dt, snap = false) {
        const idealCameraPos = this.snake.head.position.clone().normalize().multiplyScalar(30);
        if (snap) {
            this.camera.position.copy(idealCameraPos);
        } else {
            this.camera.position.lerp(idealCameraPos, 2.0 * dt);
        }
        this.camera.lookAt(0, 0, 0);
        
        const snakeForward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.snake.head.quaternion);
        this.camera.up.copy(snakeForward);
    }

    getSnapshot() {
        return {
            head: {
                pos: this.snake.head.position.toArray(),
                quat: this.snake.head.quaternion.toArray()
            },
            camera: {
                pos: this.camera.position.toArray(),
                quat: this.camera.quaternion.toArray(),
                up: this.camera.up.toArray()
            },
            food: this.foodManager.food.position.toArray(),
            bonusFoods: this.foodManager.bonusFoods.map(b => b.position.toArray()),
            segments: this.snake.segments.map(seg => ({
                pos: seg.position.toArray(),
                quat: seg.quaternion.toArray(),
                color: seg.material.color.getHex()
            })),
            score: this.score,
            tongue: {
                scaleX: this.snake.tongue ? this.snake.tongue.scale.x : 1,
                scaleZ: this.snake.tongue ? this.snake.tongue.scale.z : 0.01
            },
            events: [] // Filled by recorder
        };
    }

    getReplayJSON() {
        return this.recorder.getReplayJSON({
            earthRadius: this.EARTH_RADIUS,
            fps: this.recorder.RECORD_FPS,
            playerInfo: this.playerInfo,
            sounds: {
                eat: './snake_eat.mp3',
                die: './game_over.mp3'
            },
            muted: this.audioManager.isMuted()
        });
    }

    gameOver() {
        this.isGameOver = true;
        this.playSound('die');
        // Force a final record
        this.recorder.update(100, () => this.getSnapshot()); 
        
        const gameOverEl = document.getElementById('game-over');
        const restartBtn = document.getElementById('btn-restart');
        const replayBtn = document.getElementById('btn-replay');

        if (restartBtn) restartBtn.disabled = true;
        if (replayBtn) replayBtn.disabled = true;

        if (gameOverEl) {
            gameOverEl.classList.remove('hidden');
            requestAnimationFrame(() => {
                gameOverEl.classList.add('visible');
            });
            setTimeout(() => {
                if (restartBtn) restartBtn.disabled = false;
                if (replayBtn) replayBtn.disabled = false;
            }, 700);
        }
        
        this.isPlaying = false;
        
        // Go to back of queue immediately
        this.joinedLobbyTime = Date.now();
        this.room.updatePresence({
            isPlaying: false,
            joinedAt: this.joinedLobbyTime
        });
        
        // After game over, user clicks "Return to Lobby" to spectate/wait
    }
}