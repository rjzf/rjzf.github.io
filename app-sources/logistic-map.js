import { sizePlot, plotWidth, observePlot, fieldError } from './view-utils.js';

export function initLogistic() {
    const tsCanvas = document.getElementById('timeSeriesCanvas');
    const bfCanvas = document.getElementById('bifurcationCanvas');
    if (!tsCanvas || !bfCanvas) return;

    // Match the visible width without changing the map state.
    const width = plotWidth(tsCanvas);
    const tsCtx = sizePlot(tsCanvas, width, 280);
    const bfCtx = sizePlot(bfCanvas, width, 280);
    const offscreenCanvas = document.createElement('canvas');
    const offCtx = sizePlot(offscreenCanvas, width, 280);

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
    let lastFrame = null, rRemainder = 0;

    // Colors
    const tsLineColor = '#000000'; 
    const tsDotColor = '#000000';                  
    const bfDotColor = 'rgba(0, 0, 0, 0.45)';       
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

        ctx.font = '12px sans-serif';
        
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
        xTicks.filter((value, index) => w >= 500 || xTicks.length <= 5 || index % 2 === 0).forEach(val => {
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

        const samples = Math.min(2048, Math.ceil(graphW * Math.min(2, window.devicePixelRatio || 1)));
        const dot = graphW / samples;
        for (let sample = 0; sample < samples; sample++) {
            const px = sample * dot;
            let testR = ((sample + 0.5) / samples) * 4.0;
            let x = 0.5;
            for (let i = 0; i < 1000; i++) x = testR * x * (1 - x);
            for (let i = 0; i < 100; i++) {
                x = testR * x * (1 - x);
                let py = offscreenCanvas._logH - pBottom - (x * graphH);
                offCtx.fillRect(pLeft + px, py, Math.max(0.5, dot), 0.7);
            }
        }
    }

    function updateLabels() {
        r = Math.round(r * 1000) / 1000;
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
        tsCtx.lineWidth = graphW < 320 ? 1 : 1.4;
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
            tsCtx.arc(px, py, Math.max(0.7, Math.min(2.1, graphW / steps * 0.28)), 0, Math.PI * 2);
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

    // Advance at the same rate on different refresh-rate displays.
    function animate(timestamp) {
        if (!isPlaying) return;
        const elapsed = lastFrame === null ? 0 : Math.max(0, Math.min(100, timestamp - lastFrame));
        lastFrame = timestamp;
        rRemainder += elapsed * 0.00021;
        const increment = Math.floor(rRemainder * 1000 + 1e-9) / 1000;
        rRemainder -= increment;
        r += increment;
        if (r >= 4.0) { r = 4.0; isPlaying = false; btnPlayPause.textContent = "Play"; }
        fieldError(rVal);
        updateLabels();
        renderFrame();
        if (isPlaying) animationId = requestAnimationFrame(animate);
    }

    rSlider.addEventListener('input', (e) => { r = parseFloat(e.target.value); fieldError(rVal); updateLabels(); renderFrame(); });
    x0Slider.addEventListener('input', (e) => { x0 = parseFloat(e.target.value); fieldError(x0Val); updateLabels(); renderFrame(); });

    rVal.addEventListener('change', (e) => {
        fieldError(rVal);
        let newR = parseFloat(e.target.value);
        if (!Number.isFinite(newR) || !rVal.checkValidity()) { fieldError(rVal, 'Enter a growth rate from 0 to 4 in steps of 0.001.'); return; }
        fieldError(rVal); r = newR; updateLabels(); renderFrame();
    });

    x0Val.addEventListener('change', (e) => {
        fieldError(x0Val);
        let newX0 = parseFloat(e.target.value);
        if (!Number.isFinite(newX0) || !x0Val.checkValidity()) { fieldError(x0Val, 'Enter an initial population from 0.01 to 0.99 in steps of 0.01.'); return; }
        fieldError(x0Val); x0 = newX0; updateLabels(); renderFrame();
    });

    btnPlayPause.addEventListener('click', () => {
        if (isPlaying) {
            isPlaying = false; btnPlayPause.textContent = "Play";
            if (animationId) cancelAnimationFrame(animationId);
        } else {
            if (r >= 4.0) r = 0; isPlaying = true; btnPlayPause.textContent = "Pause";
            lastFrame = null;
            rRemainder = 0;
            animationId = requestAnimationFrame(animate);
        }
    });

    btnStep.addEventListener('click', () => {
        isPlaying = false; btnPlayPause.textContent = "Play";
        if (animationId) cancelAnimationFrame(animationId);
        fieldError(stepSizeInput);
        const step = stepSizeInput.valueAsNumber;
        if (!Number.isFinite(step) || !stepSizeInput.checkValidity()) { fieldError(stepSizeInput, 'Enter a step from 0.001 to 1 in increments of 0.001.'); return; }
        fieldError(stepSizeInput);
        r = Math.min(4.0, r + step);
        updateLabels(); renderFrame();
    });

    btnReset.addEventListener('click', () => {
        isPlaying = false; btnPlayPause.textContent = "Play";
        if (animationId) cancelAnimationFrame(animationId);
        fieldError(rVal); fieldError(x0Val);
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

    let sizeKey = width + ':' + Math.min(2, window.devicePixelRatio || 1);
    observePlot(tsCanvas, (force) => {
        const nextWidth = plotWidth(tsCanvas);
        const nextKey = nextWidth + ':' + Math.min(2, window.devicePixelRatio || 1);
        if (!force && nextKey === sizeKey) return;
        sizeKey = nextKey;
        for (const canvas of [tsCanvas, bfCanvas, offscreenCanvas]) sizePlot(canvas, nextWidth, 280);
        preRenderBifurcation();
        renderFrame();
    });
    preRenderBifurcation();
    renderFrame();

    // Pause without advancing the map when the page is hidden.
    const pause = () => {
        isPlaying = false;
        btnPlayPause.textContent = 'Play';
        cancelAnimationFrame(animationId);
        animationId = null;
        lastFrame = null;
    };
    document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
    window.addEventListener('pagehide', pause);
}
