// loader.js

let canvas, ctx;
let isActive = true;
let animId;
let width, height;

const cellSize = 30;
let snake = []; 
let foods = []; 
let cycle = 0;
let tick = 0;
let speedInterval = 4; // Lower is faster
let prevSnake = [];
let dotPhase = 0;
let dotTick = 0;

// Track when the loader animation has completed at least one full cycle
window.__loaderHasCompletedCycle = false;

function reset() {
    if (!canvas) return;
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
    
    cycle = 0;
    startLevel();
}

function startLevel() {
    snake = [];
    prevSnake = [];
    // Center vertically on a grid line
    const startY = Math.floor(height / 2 / cellSize) * cellSize;
    const length = 3 + cycle * 2;
    
    // Start off screen left
    // Head is at index 0
    for(let i=0; i<length; i++) {
        snake.push({ x: -(i+1)*cellSize, y: startY });
    }
    
    // Initial previous state matches current for smooth interpolation
    prevSnake = snake.map(s => ({ ...s }));
    
    // Spawn foods
    foods = [];
    const numFoods = 3;
    // Distribute across screen width
    const spacing = width / (numFoods + 1);
    for(let i=1; i<=numFoods; i++) {
        foods.push({
            x: Math.floor((i * spacing)/cellSize)*cellSize,
            y: startY
        });
    }
}

function update() {
    if (!isActive) return;
    
    tick++;
    dotTick++;

    // Slow dot animation: advance every 20 ticks (instead of every movement step)
    if (dotTick % 20 === 0) {
        dotPhase = (dotPhase + 1) % 4;
    }

    if (tick % speedInterval === 0) {
        // 1. Move Head
        // Save previous snake state for smooth interpolation
        prevSnake = snake.map(s => ({ ...s }));
        const head = { ...snake[0] };
        head.x += cellSize;
        
        snake.unshift(head);
        
        // 2. Check Food
        let ate = false;
        for(let i=0; i<foods.length; i++) {
            // Approx collision
            if (Math.abs(head.x - foods[i].x) < cellSize/2) {
                foods.splice(i, 1);
                ate = true;
                break;
            }
        }
        
        // 3. Update Tail
        if (!ate) {
            snake.pop();
        }
        
        // 4. Check Bounds
        const tail = snake[snake.length-1];
        if (tail.x > width) {
            cycle++;
            if (cycle >= 1) {
                // Mark that we've completed at least one full pass
                window.__loaderHasCompletedCycle = true;
            }
            startLevel();
        }
    }
    
    // Render
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);

    // Loading Text (slightly smaller, with dot animation)
    const progress = speedInterval > 0 ? (tick % speedInterval) / speedInterval : 0;
    const dots = '.'.repeat(dotPhase);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const centerX = width / 2;
    const baseY = height / 2 + cellSize * 2.5;

    // Draw the word "LOADING" centered
    ctx.fillText('LOADING', centerX, baseY);

    // Measure "LOADING" and draw dots to the right without shifting the center
    const loadingWidth = ctx.measureText('LOADING').width;
    const prevAlign = ctx.textAlign;
    ctx.textAlign = 'left';
    const dotsX = centerX + loadingWidth / 2 + 6; // small gap after the word
    ctx.fillText(dots, dotsX, baseY);
    ctx.textAlign = prevAlign;
    
    // Draw Foods
    ctx.fillStyle = '#ffaa00';
    for(const f of foods) {
        ctx.beginPath();
        ctx.arc(f.x + cellSize/2, f.y + cellSize/2, cellSize/3, 0, Math.PI*2);
        ctx.fill();
    }
    
    // Draw Snake (interpolated between previous and current positions for smoothness)
    for(let i=0; i<snake.length; i++) {
        const sNew = snake[i];
        const sOld = prevSnake[i] || sNew;
        const drawX = sOld.x + (sNew.x - sOld.x) * progress;
        const drawY = sOld.y + (sNew.y - sOld.y) * progress;

        // Head is slightly brighter
        ctx.fillStyle = i === 0 ? '#44ff44' : '#00cc00';
        ctx.fillRect(drawX + 2, drawY + 2, cellSize - 4, cellSize - 4);
        
        // Eyes for head
        if (i === 0) {
            ctx.fillStyle = '#000';
            ctx.fillRect(drawX + cellSize - 8, drawY + 6, 4, 4); // Eye
        }
    }
    
    animId = requestAnimationFrame(update);
}

export function initLoader() {
    canvas = document.getElementById('loader-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    
    window.addEventListener('resize', reset);
    reset();
    isActive = true;
    update();
}

export function showLoader() {
    const loaderEl = document.getElementById('loading-screen');
    const fadeEl = document.getElementById('black-fade');
    
    if (loaderEl) {
        // Reset cycle tracking so we ensure a full animation plays if needed
        window.__loaderHasCompletedCycle = false;

        // Prepare state for new showing
        reset(); 
        isActive = true;
        cancelAnimationFrame(animId);
        update();
        
        loaderEl.classList.remove('hidden');
    }
    
    // If black fade is present, remove it to reveal loader
    if (fadeEl) {
        fadeEl.classList.remove('visible');
    }
}

export function hideLoader() {
    // Ensure we don't hide the loader until at least one full animation cycle has completed
    if (!window.__loaderHasCompletedCycle) {
        // Try again shortly until the animation has finished a pass
        setTimeout(hideLoader, 100);
        return;
    }

    const loaderEl = document.getElementById('loading-screen');
    const fadeEl = document.getElementById('black-fade');

    if (!fadeEl) {
        // Fallback: simple hide
        if (loaderEl) {
            loaderEl.classList.add('hidden');
            setTimeout(() => {
                isActive = false;
            }, 600);
        }
        document.body.classList.add('ready');
        return;
    }

    // 1) Fade to black
    fadeEl.classList.add('visible');

    // 2) Once black, reveal scene/UI and hide loader under it
    setTimeout(() => {
        document.body.classList.add('ready');

        if (loaderEl) {
            loaderEl.classList.add('hidden');
            // We do NOT remove the element to allow reuse
            setTimeout(() => {
                isActive = false; // Stop loop to save resources
            }, 600);
        }

        // 3) After scene has started fading in, fade black away
        setTimeout(() => {
            fadeEl.classList.remove('visible');
            // Optional cleanup for fadeEl? We'll keep it for reuse too.
        }, 300); 
    }, 500); // wait for black fade-in
}