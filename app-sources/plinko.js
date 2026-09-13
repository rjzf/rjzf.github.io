import { sizePlot, plotWidth, observePlot, bindPair } from './view-utils.js';

export function initPlinko() {
    const canvas = document.getElementById('plinkoCanvas');
    if (!canvas) return;
    const boardWidth = 800, boardHeight = 600;
    const ctx = canvas.getContext('2d');
    const background = document.createElement('canvas');
    canvas.parentElement.classList.add('plinko-plot');

    // Read the existing controls.
    const btnPlay = document.getElementById('plinko-play-pause');
    const btnReset = document.getElementById('plinko-reset');
    const btnBatch = document.getElementById('plinko-batch');
    const ballInput = document.getElementById('plinko-ball-val');
    const levelInput = document.getElementById('plinko-level-val');
    const probInput = document.getElementById('plinko-prob-val');
    const speedInput = document.getElementById('plinko-speed-val');
    const overlayCheck = document.getElementById('plinko-overlay');
    const settings = { balls: Number(ballInput.value), levels: Number(levelInput.value), probability: Number(probInput.value), speed: Number(speedInput.value) };

    // Keep motion independent of the display refresh rate.
    let isPlaying = false, animationId = null, finishedCount = 0;
    let lastFrame = null, accumulator = 0, displayWidth = 0, sizeKey = '';
    let balls = [], bins = [], pinGrid = [], binCenters = [], normalBins = [];
    const padding = { top: 140, bottom: 230, side: 60 };
    const floor = boardHeight - 20, histogramHeight = 155;
    const primaryBlue = '#3b82f6';
    const fontSize = () => Math.max(14, 12 * boardWidth / displayWidth);

    function resizeBoard(force = false) {
        const minimum = settings.levels <= 16 ? 256 : Math.min(800, (settings.levels + 1) * 16);
        const width = Math.max(minimum, plotWidth(canvas));
        const key = width + ':' + Math.min(2, window.devicePixelRatio || 1);
        if (!force && key === sizeKey) return;
        sizeKey = key;
        displayWidth = width;
        sizePlot(canvas, width, width * boardHeight / boardWidth, boardWidth, boardHeight);
        canvas.style.width = width + 'px';
        cacheBoard();
    }

    function initBoard() {
        const levels = settings.levels;
        const dx = (boardWidth - padding.side * 2) / (levels + 1);
        const dy = (boardHeight - padding.top - padding.bottom) / levels;
        pinGrid = [];
        for (let row = 0; row < levels; row++) {
            pinGrid[row] = [];
            for (let col = 0; col <= row; col++) {
                pinGrid[row].push({ x: boardWidth / 2 + (col - row / 2) * dx, y: padding.top + row * dy });
            }
        }
        binCenters = Array.from({ length: levels + 1 }, (_, i) => boardWidth / 2 + (i - levels / 2) * dx);
        bins = new Array(levels + 1).fill(0);
        balls = [];
        finishedCount = 0;
        normalBins = binCenters.map((_, i) => normalProbability(i, levels, settings.probability));
        resizeBoard(true);
    }

    // Cache the pegs and walls until the board changes.
    function cacheBoard() {
        if (!pinGrid.length) return;
        const bg = sizePlot(background, displayWidth, displayWidth * boardHeight / boardWidth, boardWidth, boardHeight);
        bg.fillStyle = '#ffffff'; bg.fillRect(0, 0, boardWidth, boardHeight);
        const dx = (boardWidth - padding.side * 2) / (settings.levels + 1);
        const wallTop = pinGrid.at(-1)[0].y + 15;
        bg.strokeStyle = '#d4d4d4'; bg.lineWidth = 1;
        bg.beginPath();
        for (let i = 0; i <= binCenters.length; i++) {
            const x = binCenters[0] - dx / 2 + i * dx;
            bg.moveTo(x, wallTop); bg.lineTo(x, floor);
        }
        bg.moveTo(padding.side, floor); bg.lineTo(boardWidth - padding.side, floor); bg.stroke();
        bg.fillStyle = '#000000';
        const radius = Math.max(1.5, 4.5 - settings.levels / 15);
        for (const row of pinGrid) for (const pin of row) {
            bg.beginPath(); bg.arc(pin.x, pin.y, radius, 0, Math.PI * 2); bg.fill();
        }
    }

    function spawnBall() {
        if (finishedCount + balls.length >= settings.balls) return;
        const pin = pinGrid[0][0];
        balls.push({ x: pin.x, y: pin.y - 20, targetX: pin.x, targetY: pin.y, row: 0, col: 0, isFinalDrop: false, finalBinIdx: null });
    }

    function update() {
        const speed = 1.5 + 3.5 * settings.speed / 100;
        for (let i = balls.length - 1; i >= 0; i--) {
            const ball = balls[i];
            ball.y += speed;
            ball.x += (ball.targetX - ball.x) * 0.15;
            if (ball.y >= ball.targetY && !ball.isFinalDrop) {
                ball.y = ball.targetY;
                if (Math.random() < settings.probability) ball.col++;
                if (++ball.row < settings.levels) {
                    const pin = pinGrid[ball.row][ball.col];
                    ball.targetX = pin.x;
                    ball.targetY = pin.y;
                } else {
                    ball.finalBinIdx = ball.col;
                    ball.targetX = binCenters[ball.col];
                    ball.isFinalDrop = true;
                }
            }
            if (ball.y > floor) {
                bins[ball.finalBinIdx]++;
                balls.splice(i, 1);
                finishedCount++;
            }
        }
    }

    // Integrate the normal approximation over each unit-width bin.
    function normalProbability(i, n, p) {
        const sigma = Math.sqrt(n * p * (1 - p));
        if (!sigma) return 0;
        const cdf = x => {
            const z = Math.abs(x), k = 1 / (1 + 0.2316419 * z);
            const tail = Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI) * k * (0.319381530 + k * (-0.356563782 + k * (1.781477937 + k * (-1.821255978 + k * 1.330274429))));
            return x < 0 ? tail : 1 - tail;
        };
        return Math.max(0, cdf((i + 0.5 - n * p) / sigma) - cdf((i - 0.5 - n * p) / sigma));
    }

    function draw() {
        ctx.drawImage(background, 0, 0, boardWidth, boardHeight);
        const dx = (boardWidth - padding.side * 2) / (settings.levels + 1);
        const normalVisible = overlayCheck.checked && finishedCount > 0 && settings.probability > 0 && settings.probability < 1;
        const expected = normalBins.map(value => value * finishedCount);
        const maximum = Math.max(1, ...bins, ...(normalVisible ? expected : [])) * 1.12;
        const y = count => floor - count / maximum * histogramHeight;

        // Share one count scale between the bars and both lines.
        ctx.fillStyle = primaryBlue;
        bins.forEach((count, i) => ctx.fillRect(binCenters[i] - dx / 2 + 2, y(count), Math.max(1, dx - 4), floor - y(count)));
        if (overlayCheck.checked && finishedCount > 0) {
            if (normalVisible) drawDistribution(expected, y, '#000000', [5, 5]);
            drawDistribution(bins, y, '#f23', []);
        }

        // Place readable counts above their bars with a clear backing.
        ctx.textAlign = 'center'; ctx.font = 'bold ' + fontSize() + 'px monospace';
        bins.forEach((count, i) => {
            const label = String(count), width = ctx.measureText(label).width;
            if (!count || width + 8 > dx) return;
            const top = y(Math.max(count, normalVisible ? expected[i] : 0)) - 8;
            ctx.fillStyle = '#ffffff'; ctx.fillRect(binCenters[i] - width / 2 - 2, top - fontSize(), width + 4, fontSize() + 3);
            ctx.fillStyle = '#000000'; ctx.fillText(label, binCenters[i], top);
        });
        const radius = Math.max(2.5, 6.5 - settings.levels / 15);
        ctx.fillStyle = '#f23';
        for (const ball of balls) {
            ctx.beginPath(); ctx.arc(ball.x, ball.y, radius, 0, Math.PI * 2); ctx.fill();
        }
        drawStats();
        if (overlayCheck.checked && finishedCount > 0) drawLegend(normalVisible);
    }

    function drawDistribution(values, y, color, dash) {
        ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash(dash); ctx.beginPath();
        values.forEach((count, i) => {
            if (i) ctx.lineTo(binCenters[i], y(count)); else ctx.moveTo(binCenters[i], y(count));
        });
        ctx.stroke(); ctx.setLineDash([]);
    }

    function drawStats() {
        let sum = 0, sumSq = 0;
        bins.forEach((count, i) => { sum += i * count; sumSq += i * i * count; });
        const mean = finishedCount ? sum / finishedCount : 0;
        const deviation = finishedCount ? Math.sqrt(Math.max(0, sumSq / finishedCount - mean * mean)) : 0;
        ctx.textAlign = 'left'; ctx.fillStyle = '#000000'; ctx.font = 'bold ' + fontSize() + 'px monospace';
        [`N: ${finishedCount}`, `μ: ${mean.toFixed(2)}`, `σ: ${deviation.toFixed(2)}`].forEach((label, i) => ctx.fillText(label, 30 + i * 255, 44));
    }

    function drawLegend(normalVisible) {
        ctx.textAlign = 'left'; ctx.font = 'bold ' + fontSize() + 'px monospace';
        const entries = [['Live Path', '#f23', []]];
        if (normalVisible) entries.push(['Ideal Normal', '#000000', [5, 5]]);
        entries.forEach(([label, color, dash], i) => {
            const x = 30 + i * 360;
            ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash(dash); ctx.beginPath();
            ctx.moveTo(x, 91); ctx.lineTo(x + 25, 91); ctx.stroke(); ctx.setLineDash([]);
            ctx.fillStyle = '#000000'; ctx.fillText(label, x + 35, 91 + fontSize() / 3);
        });
    }

    function pause() {
        isPlaying = false;
        cancelAnimationFrame(animationId);
        animationId = null; lastFrame = null; accumulator = 0;
        btnPlay.textContent = 'Play';
    }

    function animate(timestamp) {
        animationId = null;
        if (!isPlaying) return;
        accumulator += lastFrame === null ? 0 : Math.min(100, Math.max(0, timestamp - lastFrame));
        lastFrame = timestamp;
        const step = 1000 / 60;
        while (accumulator + 1e-9 >= step) {
            accumulator = Math.max(0, accumulator - step);
            update();
            if (Math.random() < 0.15) spawnBall();
        }
        draw();
        if (!balls.length && finishedCount >= settings.balls) { pause(); return; }
        animationId = requestAnimationFrame(animate);
    }

    btnPlay.addEventListener('click', () => {
        if (isPlaying) { pause(); return; }
        if (!balls.length && finishedCount >= settings.balls) return;
        isPlaying = true; lastFrame = null; accumulator = 0;
        btnPlay.textContent = 'Pause';
        animationId = requestAnimationFrame(animate);
    });
    btnReset.addEventListener('click', () => { pause(); initBoard(); draw(); });
    btnBatch.addEventListener('click', () => {
        for (let i = 0; i < settings.balls; i++) {
            let bin = 0;
            for (let j = 0; j < settings.levels; j++) if (Math.random() < settings.probability) bin++;
            bins[bin]++;
        }
        finishedCount += settings.balls;
        if (!balls.length && finishedCount >= settings.balls) pause();
        draw();
    });
    const sliders = [
        [document.getElementById('plinko-ball-slider'), ballInput],
        [document.getElementById('plinko-level-slider'), levelInput],
        [document.getElementById('plinko-prob-slider'), probInput],
        [document.getElementById('plinko-speed-slider'), speedInput]
    ];
    sliders.forEach(([slider, input], index) => bindPair(input, slider, value => {
        settings[['balls', 'levels', 'probability', 'speed'][index]] = value;
        if (index !== 3) { pause(); initBoard(); }
        draw();
    }));
    observePlot(canvas, force => { resizeBoard(force); draw(); });
    overlayCheck.addEventListener('change', draw);
    const details = canvas.closest('details');
    details?.addEventListener('toggle', () => { if (!details.open) pause(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
    window.addEventListener('pagehide', pause);
    initBoard();
    draw();
}
