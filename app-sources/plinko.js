export function initPlinko() {
    const canvas = document.getElementById('plinkoCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // UI References
    const btnPlay = document.getElementById('plinko-play-pause');
    const btnReset = document.getElementById('plinko-reset');
    const btnBatch = document.getElementById('plinko-batch');
    const ballInput = document.getElementById('plinko-ball-val');
    const levelInput = document.getElementById('plinko-level-val');
    const probInput = document.getElementById('plinko-prob-val'); 
    const speedInput = document.getElementById('plinko-speed-val');
    const overlayCheck = document.getElementById('plinko-overlay');

    // Simulation state
    let isPlaying = false, animationId = null, finishedCount = 0;
    let balls = [], bins = [], pinCoords = [];

    // Styling constants
    const padding = { top: 60, bottom: 160, side: 80 };
    const primaryBlue = '#3b82f6'; 

    // Synchronize inputs
    function syncUI(val, targetInput, targetSlider) {
        targetInput.value = val;
        if (targetSlider) targetSlider.value = val;
    }

    // Generate triangular grid
    function initBoard() {
        const levels = parseInt(levelInput.value);
        const width = canvas.width - padding.side * 2;
        const height = canvas.height - padding.top - padding.bottom;

        pinCoords = [];
        const dy = height / levels;
        const dx = width / levels;

        for (let l = 0; l <= levels; l++) {
            const pinsInRow = l + 1; 
            const rowWidth = (pinsInRow - 1) * dx;
            const startX = (canvas.width / 2) - (rowWidth / 2);
            for (let i = 0; i < pinsInRow; i++) {
                pinCoords.push({ x: startX + i * dx, y: padding.top + l * dy });
            }
        }
        bins = new Array(levels + 2).fill(0); 
        balls = [];
        finishedCount = 0;
    }

    // Initialize ball object
    function spawnBall() {
        if (finishedCount + balls.length >= parseInt(ballInput.value)) return;
        
        const speedScale = parseFloat(speedInput.value) / 100;
        const vy = (speedScale * 3.5) + 1.5; 

        balls.push({
            x: canvas.width / 2,
            y: padding.top - 20,
            vy: vy,
            targetX: canvas.width / 2,
            level: -1,
            rightHandBounces: 0
        });
    }

    // Physics update loop
    function update() {
        const p = parseFloat(probInput.value);
        const levels = parseInt(levelInput.value);
        const height = canvas.height - padding.top - padding.bottom;
        const dy = height / levels;
        const dx = (canvas.width - padding.side * 2) / levels;

        for (let i = balls.length - 1; i >= 0; i--) {
            let b = balls[i];
            
            b.y += b.vy;
            b.x += (b.targetX - b.x) * 0.15; 

            const currentLevel = Math.floor((b.y - padding.top + (dy / 2)) / dy);
            
            // Catch-up logic loop
            while (b.level < currentLevel && b.level < levels) {
                b.level++;
                const moveRight = Math.random() < p;
                b.targetX += (moveRight ? 1 : -1) * (dx / 2);
                if (moveRight) b.rightHandBounces++;
            }

            // Boundary check
            if (b.y > canvas.height - padding.bottom) {
                const binIdx = b.rightHandBounces;
                if (binIdx >= 0 && binIdx < bins.length) bins[binIdx]++;
                balls.splice(i, 1);
                finishedCount++;
            }
        }
    }

    // Primary render function
    function draw() {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const levels = parseInt(levelInput.value);
        const pinRad = Math.max(1.5, 4.5 - (levels / 15)); 
        const ballRad = Math.max(2.5, 6.5 - (levels / 15));
        const width = canvas.width - padding.side * 2;
        const dx = width / levels;
        const lastRowStartX = (canvas.width / 2) - (levels * dx / 2);

        // Draw bin walls
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1.5;
        for (let i = 0; i <= levels; i++) {
            const wallX = lastRowStartX + i * dx;
            ctx.beginPath();
            ctx.moveTo(wallX, padding.top + (levels * ((canvas.height - padding.top - padding.bottom) / levels)));
            ctx.lineTo(wallX, canvas.height);
            ctx.stroke();
        }

        // Draw pegs
        ctx.fillStyle = '#000000';
        pinCoords.forEach(p => {
            ctx.beginPath(); ctx.arc(p.x, p.y, pinRad, 0, Math.PI * 2); ctx.fill();
        });

        // Draw blue bars
        const maxBin = Math.max(...bins, 1);
        ctx.textAlign = 'center';
        ctx.font = 'bold 10px monospace';
        bins.forEach((count, i) => {
            const binCenterX = lastRowStartX + (i - 0.5) * dx;
            const h = (count / maxBin) * (padding.bottom - 40);
            ctx.fillStyle = primaryBlue; 
            ctx.fillRect(binCenterX - (dx / 2) + 2, canvas.height - h, dx - 4, h);
            if (count > 0) {
                ctx.fillStyle = h > 25 ? '#ffffff' : primaryBlue;
                const textY = h > 25 ? canvas.height - h + 15 : canvas.height - h - 5;
                ctx.fillText(count, binCenterX, textY);
            }
        });

        // Draw balls
        ctx.fillStyle = '#f23';
        balls.forEach(b => {
            ctx.beginPath(); ctx.arc(b.x, b.y, ballRad, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.beginPath(); ctx.arc(b.x - ballRad / 3, b.y - ballRad / 3, ballRad / 4, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#f23';
        });

        // Dashboard and legend
        drawStats();
        if (overlayCheck.checked && finishedCount > 0) {
            drawAnalyticalGaussian(lastRowStartX, dx, levels);
            drawLiveDistribution(maxBin, lastRowStartX, dx, levels);
            drawLegend();
        }
    }

    // Dashboard stats
    function drawStats() {
        ctx.textAlign = 'right';
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 10px monospace';
        const rx = canvas.width - 20, ry = 30;

        let sum = 0, sumSq = 0;
        bins.forEach((c, i) => { sum += i * c; sumSq += (i * i) * c; });
        const mean = finishedCount > 0 ? sum / finishedCount : 0;
        const stdDev = finishedCount > 0 ? Math.sqrt(Math.max(0, (sumSq / finishedCount) - (mean * mean))) : 0;
        ctx.fillText(`N: ${finishedCount}`, rx, ry);
        ctx.fillText(`μ (Live): ${mean.toFixed(2)}`, rx, ry + 15);
        ctx.fillText(`σ (Live): ${stdDev.toFixed(2)}`, rx, ry + 30);
    }

    // Dynamic legend
    function drawLegend() {
        ctx.textAlign = 'left';
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 10px monospace';
        const lx = 20, ly = 30;
        ctx.strokeStyle = '#f23'; ctx.lineWidth = 2; ctx.beginPath(); 
        ctx.moveTo(lx, ly); ctx.lineTo(lx + 20, ly); ctx.stroke();
        ctx.fillText('Current Distribution', lx + 30, ly + 3);
        ctx.strokeStyle = '#000000'; ctx.setLineDash([4, 4]); ctx.beginPath(); 
        ctx.moveTo(lx, ly + 15); ctx.lineTo(lx + 20, ly + 15); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillText('Analytical Gaussian', lx + 30, ly + 18);
    }

    // Theoretical curve
    function drawAnalyticalGaussian(startX, dx, n) {
        const p = parseFloat(probInput.value), trials = n + 1;
        const mu = trials * p, sigma = Math.sqrt(trials * p * (1 - p));
        ctx.strokeStyle = '#000000'; ctx.lineWidth = 2; ctx.setLineDash([5, 5]); ctx.beginPath();
        const res = 200;
        for (let i = 0; i <= res; i++) {
            const cur = (i / res) * trials;
            const y = (1 / (sigma * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * Math.pow((cur - mu) / sigma, 2));
            const sy = canvas.height - (y / (1 / (sigma * Math.sqrt(2 * Math.PI)))) * (padding.bottom - 40);
            const sx = startX + (cur - 0.5) * dx;
            if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
        }
        ctx.stroke(); ctx.setLineDash([]); 
    }

    // Live curve
    function drawLiveDistribution(maxBin, startX, dx, n) {
        ctx.strokeStyle = '#f23'; ctx.lineWidth = 2; ctx.beginPath();
        bins.forEach((count, i) => {
            const sx = startX + (i - 0.5) * dx;
            const sy = canvas.height - (count / maxBin) * (padding.bottom - 40);
            if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
        });
        ctx.stroke();
    }

    // Animation frame loop
    function animate() {
        if (!isPlaying) return;
        update();
        if (Math.random() < 0.2) spawnBall(); 
        draw();
        animationId = requestAnimationFrame(animate);
    }

    // Click handlers
    btnPlay.addEventListener('click', () => { isPlaying = !isPlaying; btnPlay.textContent = isPlaying ? "Pause" : "Play"; if (isPlaying) animate(); });
    btnReset.addEventListener('click', () => { isPlaying = false; btnPlay.textContent = "Play"; cancelAnimationFrame(animationId); initBoard(); draw(); });
    
    // Instant drop logic
    btnBatch.addEventListener('click', () => {
        const count = parseInt(ballInput.value), n = parseInt(levelInput.value), p = parseFloat(probInput.value), trials = n + 1; 
        for (let i = 0; i < count; i++) {
            let s = 0; for (let j = 0; j < trials; j++) if (Math.random() < p) s++;
            if (s >= 0 && s < bins.length) bins[s]++;
        }
        finishedCount += count; draw();
    });

    // Control listeners
    const sliders = [[document.getElementById('plinko-ball-slider'), ballInput], [document.getElementById('plinko-level-slider'), levelInput], [document.getElementById('plinko-prob-slider'), probInput], [document.getElementById('plinko-speed-slider'), speedInput]];
    sliders.forEach(([s, i]) => {
        const h = (e) => { syncUI(e.target.value, i, s); initBoard(); draw(); };
        s.addEventListener('input', h); i.addEventListener('change', h);
    });

    // Accordion lifecycle
    const parentAcc = canvas.closest('details');
    if (parentAcc) {
        parentAcc.addEventListener('toggle', (e) => {
            if (!e.target.open && isPlaying) {
                isPlaying = false; btnPlay.textContent = "Play"; cancelAnimationFrame(animationId);
            }
            if (e.target.open) draw();
        });
    }

    initBoard();
    draw();
}