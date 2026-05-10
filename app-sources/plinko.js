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
    let balls = [], bins = [], pinCoords = [], pinGrid = [], binCenters = [];

    // Styling constants
    const padding = { top: 60, bottom: 160, side: 80 };
    const primaryBlue = '#3b82f6'; 

    function syncUI(val, targetInput, targetSlider) {
        targetInput.value = val;
        if (targetSlider) targetSlider.value = val;
    }

    function initBoard() {
        const levels = parseInt(levelInput.value);
        const width = canvas.width - padding.side * 2;
        const height = canvas.height - padding.top - padding.bottom;
        const dy = height / levels;
        const dx = width / levels;

        pinGrid = [];
        pinCoords = [];
        
        // 1. Generate Pin Grid (2D for logic, Flat for drawing)
        for (let l = 0; l < levels; l++) {
            const pinsInRow = l + 1;
            const rowWidth = (pinsInRow - 1) * dx;
            const startX = (canvas.width / 2) - (rowWidth / 2);
            
            pinGrid[l] = [];
            for (let i = 0; i < pinsInRow; i++) {
                const coord = { x: startX + i * dx, y: padding.top + l * dy };
                pinGrid[l][i] = coord;
                pinCoords.push(coord); 
            }
        }

        // 2. Pre-calculate Bin Centers based on the last row of pins
        binCenters = [];
        const lastRow = pinGrid[levels - 1];
        const firstPinX = lastRow[0].x;
        for (let i = 0; i <= levels; i++) {
            binCenters.push(firstPinX - (dx / 2) + i * dx);
        }

        bins = new Array(levels + 1).fill(0);
        balls = [];
        finishedCount = 0;
    }

    function spawnBall() {
        if (finishedCount + balls.length >= parseInt(ballInput.value)) return;
        
        const speedScale = parseFloat(speedInput.value) / 100;
        const vy = (speedScale * 3.5) + 1.5;

        // Start at the first pin (Top)
        const startPin = pinGrid[0][0];

        balls.push({
            x: startPin.x,
            y: padding.top - 20, 
            targetX: startPin.x,
            targetY: startPin.y,
            vy: vy,
            row: 0,
            col: 0,
            isFinalDrop: false,
            finalBinIdx: null
        });
    }

    function update() {
        const p = parseFloat(probInput.value);
        const levels = parseInt(levelInput.value);

        for (let i = balls.length - 1; i >= 0; i--) {
            let b = balls[i];

            // 1. Movement
            b.y += b.vy;
            // Smoothly interpolate X toward the current target
            b.x += (b.targetX - b.x) * 0.15;

            // 2. Target Detection
            if (b.y >= b.targetY && !b.isFinalDrop) {
                b.y = b.targetY; // Snap to target Y

                if (b.row < levels - 1) {
                    // Decide next pin (diagonal path)
                    b.row++;
                    if (Math.random() < p) b.col++;
                    
                    const nextPin = pinGrid[b.row][b.col];
                    b.targetX = nextPin.x;
                    b.targetY = nextPin.y;
                } else {
                    // Final Decision: Decide the BIN
                    const moveRight = Math.random() < p;
                    b.finalBinIdx = moveRight ? b.col + 1 : b.col;
                    
                    b.targetX = binCenters[b.finalBinIdx];
                    b.targetY = canvas.height + 100; // Drive toward floor
                    b.isFinalDrop = true;
                }
            }

            // 3. Collection
            if (b.y > canvas.height - 20) {
                bins[b.finalBinIdx]++;
                balls.splice(i, 1);
                finishedCount++;
            }
        }
    }

    function draw() {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const levels = parseInt(levelInput.value);
        const pinRad = Math.max(1.5, 4.5 - (levels / 15)); 
        const ballRad = Math.max(2.5, 6.5 - (levels / 15));
        const width = canvas.width - padding.side * 2;
        const dx = width / levels;
        const dy = (canvas.height - padding.top - padding.bottom) / levels;

        // 1. Draw Bin Walls (Centered between pre-calculated bin centers)
        ctx.strokeStyle = '#cccccc';
        ctx.lineWidth = 1;
        binCenters.forEach((center, i) => {
            const wallX = center - dx / 2;
            ctx.beginPath();
            ctx.moveTo(wallX, padding.top + (levels - 1) * dy + 15);
            ctx.lineTo(wallX, canvas.height);
            ctx.stroke();
            // Closing wall for the last bin
            if (i === binCenters.length - 1) {
                const lastWallX = center + dx / 2;
                ctx.beginPath();
                ctx.moveTo(lastWallX, padding.top + (levels - 1) * dy + 15);
                ctx.lineTo(lastWallX, canvas.height);
                ctx.stroke();
            }
        });

        // 2. Draw Pegs
        ctx.fillStyle = '#000000';
        pinCoords.forEach(p => {
            ctx.beginPath(); ctx.arc(p.x, p.y, pinRad, 0, Math.PI * 2); ctx.fill();
        });

        // 3. Draw Bins
        const maxBin = Math.max(...bins, 1);
        ctx.textAlign = 'center';
        ctx.font = 'bold 10px monospace';
        bins.forEach((count, i) => {
            const center = binCenters[i];
            const h = (count / maxBin) * (padding.bottom - 40);
            ctx.fillStyle = primaryBlue; 
            ctx.fillRect(center - (dx / 2) + 2, canvas.height - h, dx - 4, h);
            if (count > 0) {
                ctx.fillStyle = h > 25 ? '#ffffff' : primaryBlue;
                const textY = h > 25 ? canvas.height - h + 15 : canvas.height - h - 5;
                ctx.fillText(count, center, textY);
            }
        });

        // 4. Draw Balls
        balls.forEach(b => {
            ctx.fillStyle = '#f23';
            ctx.beginPath(); ctx.arc(b.x, b.y, ballRad, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.beginPath(); ctx.arc(b.x - ballRad / 3, b.y - ballRad / 3, ballRad / 4, 0, Math.PI * 2); ctx.fill();
        });

        drawStats();
        if (overlayCheck.checked && finishedCount > 0) {
            const startX = binCenters[0];
            drawAnalyticalGaussian(startX, dx, levels);
            drawLiveDistribution(maxBin, startX, dx, levels);
            drawLegend();
        }
    }

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
        ctx.fillText(`μ: ${mean.toFixed(2)}`, rx, ry + 15);
        ctx.fillText(`σ: ${stdDev.toFixed(2)}`, rx, ry + 30);
    }

    function drawLegend() {
        ctx.textAlign = 'left';
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 10px monospace';
        const lx = 20, ly = 30;
        ctx.strokeStyle = '#f23'; ctx.lineWidth = 2; ctx.beginPath(); 
        ctx.moveTo(lx, ly); ctx.lineTo(lx + 20, ly); ctx.stroke();
        ctx.fillText('Live Path', lx + 30, ly + 3);
        ctx.strokeStyle = '#000000'; ctx.setLineDash([4, 4]); ctx.beginPath(); 
        ctx.moveTo(lx, ly + 15); ctx.lineTo(lx + 20, ly + 15); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillText('Ideal Normal', lx + 30, ly + 18);
    }

    function drawAnalyticalGaussian(startX, dx, n) {
        const p = parseFloat(probInput.value);
        const mu = n * p, sigma = Math.sqrt(n * p * (1 - p));
        ctx.strokeStyle = '#000000'; ctx.lineWidth = 2; ctx.setLineDash([5, 5]); ctx.beginPath();
        const res = 200;
        for (let i = 0; i <= res; i++) {
            const cur = (i / res) * n;
            const y = (1 / (sigma * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * Math.pow((cur - mu) / sigma, 2));
            const sy = canvas.height - (y / (1 / (sigma * Math.sqrt(2 * Math.PI)))) * (padding.bottom - 40);
            const sx = startX + cur * dx;
            if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
        }
        ctx.stroke(); ctx.setLineDash([]); 
    }

    function drawLiveDistribution(maxBin, startX, dx, n) {
        ctx.strokeStyle = '#f23'; ctx.lineWidth = 2; ctx.beginPath();
        bins.forEach((count, i) => {
            const sx = startX + i * dx;
            const sy = canvas.height - (count / maxBin) * (padding.bottom - 40);
            if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
        });
        ctx.stroke();
    }

    function animate() {
        if (!isPlaying) return;
        update();
        if (Math.random() < 0.15) spawnBall(); 
        draw();
        animationId = requestAnimationFrame(animate);
    }

    btnPlay.addEventListener('click', () => { 
        isPlaying = !isPlaying; 
        btnPlay.textContent = isPlaying ? "Pause" : "Play"; 
        if (isPlaying) animate(); 
    });
    
    btnReset.addEventListener('click', () => { 
        isPlaying = false; 
        btnPlay.textContent = "Play"; 
        cancelAnimationFrame(animationId); 
        initBoard(); 
        draw(); 
    });
    
    btnBatch.addEventListener('click', () => {
        const count = parseInt(ballInput.value), n = parseInt(levelInput.value), p = parseFloat(probInput.value); 
        for (let i = 0; i < count; i++) {
            let s = 0; for (let j = 0; j < n; j++) if (Math.random() < p) s++;
            if (s >= 0 && s < bins.length) bins[s]++;
        }
        finishedCount += count; draw();
    });

    const sliders = [[document.getElementById('plinko-ball-slider'), ballInput], [document.getElementById('plinko-level-slider'), levelInput], [document.getElementById('plinko-prob-slider'), probInput], [document.getElementById('plinko-speed-slider'), speedInput]];
    sliders.forEach(([s, i]) => {
        const h = (e) => { syncUI(e.target.value, i, s); initBoard(); draw(); };
        if(s) s.addEventListener('input', h); 
        if(i) i.addEventListener('change', h);
    });

    initBoard();
    draw();
}