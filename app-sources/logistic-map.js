export function initLogistic() {
    const tsCanvas = document.getElementById('timeSeriesCanvas');
    const bfCanvas = document.getElementById('bifurcationCanvas');
    if (!tsCanvas || !bfCanvas) return;

    // High-DPI Canvas Setup Helper 
    // Set to 250px height to match your CSS "h-64" (256px) container
    function setupCanvasDPI(canvas, forceW, forceH) {
        const dpr = window.devicePixelRatio || 1;
        const w = forceW || 800;
        const h = forceH || 250; 
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
        canvas._logW = w;
        canvas._logH = h;
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        return ctx;
    }

    const tsCtx = setupCanvasDPI(tsCanvas, 800, 250);
    const bfCtx = setupCanvasDPI(bfCanvas, 800, 250);

    const offscreenCanvas = document.createElement('canvas');
    const offCtx = setupCanvasDPI(offscreenCanvas, 800, 250);

    // UI Setup
    const rSlider = document.getElementById('r-slider');
    const x0Slider = document.getElementById('x0-slider');
    const rVal = document.getElementById('r-val'); 
    const x0Val = document.getElementById('x0-val'); 
    const stepSizeInput = document.getElementById('step-size'); 
    
    const btnPlayPause = document.getElementById('btn-play-pause');
    const btnStep = document.getElementById('btn-step');
    const btnReset = document.getElementById('btn-reset');

    let r = parseFloat(rSlider.value);
    let x0 = parseFloat(x0Slider.value);
    let isPlaying = false;
    let animationId = null;

    // Colors
    const tsLineColor = '#000000'; 
    const tsDotColor = '#000000';                  
    const bfDotColor = 'rgba(0, 0, 0, 0.15)';       
    const scrubberColor = 'rgba(220, 38, 38, 0.8)'; 

    // Adjusted Padding for the smaller 250px window
    const pLeft = 60;
    const pRight = 20;
    const pTop = 20;
    const pBottom = 50; // Room for labels

    function drawAxesAndLabels(ctx, canvas, xLabel, yLabel, xMin, xMax, xTicks, yMin, yMax, yTicks) {
        const w = canvas._logW;
        const h = canvas._logH;
        const graphW = w - pLeft - pRight;
        const graphH = h - pTop - pBottom;

        ctx.fillStyle = '#000000';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1.5;

        // Axes
        ctx.beginPath();
        ctx.moveTo(pLeft, pTop);
        ctx.lineTo(pLeft, h - pBottom); 
        ctx.lineTo(w - pRight, h - pBottom); 
        ctx.stroke();

        ctx.font = 'bold 13px "Crimson Pro", serif';
        
        // X Label - Centered in the bottom padding
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(xLabel, pLeft + graphW / 2, h - 20);

        // Y Label
        ctx.save();
        ctx.translate(15, pTop + graphH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textBaseline = 'bottom';
        ctx.fillText(yLabel, 0, 0);
        ctx.restore();

        ctx.font = '10px sans-serif';
        
        // Y Ticks
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        yTicks.forEach(val => {
            let py = h - pBottom - ((val - yMin) / (yMax - yMin)) * graphH;
            ctx.beginPath();
            ctx.moveTo(pLeft - 5, py);
            ctx.lineTo(pLeft, py);
            ctx.stroke();
            ctx.fillText(val.toString(), pLeft - 8, py);
        });

        // X Ticks
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        xTicks.forEach(val => {
            let px = pLeft + ((val - xMin) / (xMax - xMin)) * graphW;
            ctx.beginPath();
            ctx.moveTo(px, h - pBottom);
            ctx.lineTo(px, h - pBottom + 5);
            ctx.stroke();
            ctx.fillText(val.toString(), px, h - pBottom + 8);
        });
    }

    function preRenderBifurcation() {
        offCtx.fillStyle = '#ffffff';
        offCtx.fillRect(0, 0, offscreenCanvas._logW, offscreenCanvas._logH);
        
        drawAxesAndLabels(
            offCtx, offscreenCanvas, 
            "Growth Rate (r)", "Population",
            0, 4, [0, 1, 2, 3, 4],
            0, 1, [0, 0.25, 0.5, 0.75, 1.0]
        );

        offCtx.fillStyle = bfDotColor;
        const graphW = offscreenCanvas._logW - pLeft - pRight;
        const graphH = offscreenCanvas._logH - pTop - pBottom;

        for (let px = 0; px < graphW; px++) {
            let testR = (px / graphW) * 4.0;
            let x = 0.5;
            for (let i = 0; i < 200; i++) x = testR * x * (1 - x);
            for (let i = 0; i < 100; i++) {
                x = testR * x * (1 - x);
                let py = offscreenCanvas._logH - pBottom - (x * graphH);
                offCtx.fillRect(pLeft + px, py, 1, 1);
            }
        }
    }

    function updateLabels() {
        rVal.value = r.toFixed(3); 
        x0Val.value = x0.toFixed(2);
        rSlider.value = r;
        x0Slider.value = x0;
    }

    function drawTimeSeries() {
        tsCtx.fillStyle = '#ffffff';
        tsCtx.fillRect(0, 0, tsCanvas._logW, tsCanvas._logH);
        
        const steps = 80; 
        drawAxesAndLabels(
            tsCtx, tsCanvas, 
            "Time", "Population",
            0, steps, [0, 10, 20, 30, 40, 50, 60, 70, 80],
            0, 1, [0, 0.25, 0.5, 0.75, 1.0]
        );

        let history = [x0];
        let currentX = x0;
        for (let i = 0; i < steps; i++) {
            currentX = r * currentX * (1 - currentX);
            history.push(currentX);
        }

        const graphW = tsCanvas._logW - pLeft - pRight;
        const graphH = tsCanvas._logH - pTop - pBottom;

        tsCtx.beginPath();
        tsCtx.strokeStyle = tsLineColor;
        tsCtx.lineWidth = 1.5;
        for (let i = 0; i < history.length; i++) {
            let px = pLeft + (i / steps) * graphW;
            let py = tsCanvas._logH - pBottom - (history[i] * graphH);
            if (i === 0) tsCtx.moveTo(px, py);
            else tsCtx.lineTo(px, py);
        }
        tsCtx.stroke();

        tsCtx.fillStyle = tsDotColor;
        for (let i = 0; i < history.length; i++) {
            let px = pLeft + (i / steps) * graphW;
            let py = tsCanvas._logH - pBottom - (history[i] * graphH);
            tsCtx.beginPath();
            tsCtx.arc(px, py, 2.5, 0, Math.PI * 2);
            tsCtx.fill();
        }
    }

    function drawBifurcation() {
        bfCtx.clearRect(0, 0, bfCanvas._logW, bfCanvas._logH);
        bfCtx.drawImage(offscreenCanvas, 0, 0, bfCanvas._logW, bfCanvas._logH);
        const graphW = bfCanvas._logW - pLeft - pRight;
        const rPx = pLeft + (r / 4.0) * graphW;
        bfCtx.beginPath();
        bfCtx.strokeStyle = scrubberColor;
        bfCtx.lineWidth = 2;
        bfCtx.moveTo(rPx, pTop);
        bfCtx.lineTo(rPx, bfCanvas._logH - pBottom);
        bfCtx.stroke();
    }

    function renderFrame() {
        drawTimeSeries();
        drawBifurcation();
    }

    function animate() {
        if (!isPlaying) return;
        r += 0.0035;
        if (r >= 4.0) { r = 4.0; isPlaying = false; btnPlayPause.textContent = "Play"; }
        updateLabels();
        renderFrame();
        if (isPlaying) animationId = requestAnimationFrame(animate);
    }

    rSlider.addEventListener('input', (e) => { r = parseFloat(e.target.value); updateLabels(); renderFrame(); });
    x0Slider.addEventListener('input', (e) => { x0 = parseFloat(e.target.value); updateLabels(); renderFrame(); });

    rVal.addEventListener('change', (e) => {
        let newR = parseFloat(e.target.value);
        if (!isNaN(newR)) { r = Math.max(0, Math.min(4.0, newR)); updateLabels(); renderFrame(); }
    });

    x0Val.addEventListener('change', (e) => {
        let newX0 = parseFloat(e.target.value);
        if (!isNaN(newX0)) { x0 = Math.max(0.01, Math.min(0.99, newX0)); updateLabels(); renderFrame(); }
    });

    btnPlayPause.addEventListener('click', () => {
        if (isPlaying) {
            isPlaying = false; btnPlayPause.textContent = "Play";
            if (animationId) cancelAnimationFrame(animationId);
        } else {
            if (r >= 4.0) r = 0; isPlaying = true; btnPlayPause.textContent = "Pause";
            animate();
        }
    });

    btnStep.addEventListener('click', () => {
        isPlaying = false; btnPlayPause.textContent = "Play";
        r = Math.min(4.0, r + (parseFloat(stepSizeInput.value) || 0.05));
        updateLabels(); renderFrame();
    });

    btnReset.addEventListener('click', () => {
        isPlaying = false; btnPlayPause.textContent = "Play";
        if (animationId) cancelAnimationFrame(animationId);
        r = 2.0; x0 = 0.5; updateLabels(); renderFrame();
    });

    const parentAccordion = tsCanvas.closest('details');
    if (parentAccordion) {
        parentAccordion.addEventListener('toggle', (e) => {
            if (!e.target.open && isPlaying) {
                isPlaying = false; btnPlayPause.textContent = "Play";
                if (animationId) cancelAnimationFrame(animationId);
            }
            if (e.target.open) renderFrame();
        });
    }

    preRenderBifurcation();
    renderFrame();
}