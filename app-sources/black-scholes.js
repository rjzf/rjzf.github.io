import { sizePlot, plotWidth, observePlot, bindPair } from './view-utils.js';

export function initBlackScholes() {
    const canvas = document.getElementById('bsCanvas');
    if (!canvas) return;
    const plotHeight = width => width < 620 ? 510 : Math.min(560, Math.max(480, Math.round(width * 0.55)));
    const ctx = sizePlot(canvas, plotWidth(canvas), plotHeight(plotWidth(canvas)));
    let lastDraw = null, drawFrame = null;

    const sInput = document.getElementById('bs-s-val'), sSlider = document.getElementById('bs-s-slider');
    const kInput = document.getElementById('bs-k-val'), kSlider = document.getElementById('bs-k-slider');
    const volInput = document.getElementById('bs-vol-val'), volSlider = document.getElementById('bs-vol-slider');
    const tInput = document.getElementById('bs-t-val'), tSlider = document.getElementById('bs-t-slider');
    const costInput = document.getElementById('bs-cost-val'), costSlider = document.getElementById('bs-cost-slider');
    const typeSelect = document.getElementById('bs-type-select');
    const priceDisplay = document.getElementById('bs-price-display');

    const r = 0.05; 
    let currentGreeks = {};

    // Standard Normal PDF
    const ND = (x) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

    // Cumulative Normal Distribution approximation
    function CND(x) {
        const a = [0.31938153, -0.356563782, 1.781477937, -1.821255978, 1.330274429];
        const L = Math.abs(x);
        const K = 1.0 / (1.0 + 0.2316419 * L);
        let w = 1.0 - 1.0 / Math.sqrt(2.0 * Math.PI) * Math.exp(-L * L / 2.0) * (a[0] * K + a[1] * K**2 + a[2] * K**3 + a[3] * K**4 + a[4] * K**5);
        return (x < 0) ? 1.0 - w : w;
    }

    function calculate() {
        if ([sInput, kInput, volInput, tInput, costInput].some(input => !input.checkValidity() || !Number.isFinite(input.valueAsNumber))) return;
        const S = parseFloat(sInput.value);
        const K = parseFloat(kInput.value);
        const sigma = parseFloat(volInput.value) / 100.0;
        const T = Math.max(0.0001, parseFloat(tInput.value) / 365.0);
        const entryCost = parseFloat(costInput.value);
        const isCall = typeSelect.value === 'call';

        const d1 = (Math.log(S / K) + (r + 0.5 * sigma**2) * T) / (sigma * Math.sqrt(T));
        const d2 = d1 - sigma * Math.sqrt(T);

        const theoreticalPrice = isCall ? (S * CND(d1) - K * Math.exp(-r * T) * CND(d2)) 
                                        : (K * Math.exp(-r * T) * CND(-d2) - S * CND(-d1));

        const profit = theoreticalPrice - entryCost;

        // Store greeks and theoretical value for rendering
        currentGreeks = {
            delta: isCall ? CND(d1) : CND(d1) - 1,
            gamma: ND(d1) / (S * sigma * Math.sqrt(T)),
            vega: (S * ND(d1) * Math.sqrt(T)) / 100,
            theta: (-(S * ND(d1) * sigma) / (2 * Math.sqrt(T)) - r * K * Math.exp(-r * T) * (isCall ? CND(d2) : -CND(-d2))) / 365,
            rho: (K * T * Math.exp(-r * T) * (isCall ? CND(d2) : -CND(-d2))) / 100,
            theo: theoreticalPrice,
            cost: entryCost 
        };

        // Update HTML Profit Display
        const prefix = profit >= 0 ? "+" : "-";
        priceDisplay.textContent = `${prefix}$${Math.abs(profit).toFixed(2)}`;
        priceDisplay.dataset.positive = String(profit >= 0);
        clearTimeout(announcementTimer);
        announcementTimer = setTimeout(() => { announcement.textContent = 'Expected Profit/Loss: ' + priceDisplay.textContent; }, 300);

        const args = [S, K, sigma, T, isCall];
        if (!lastDraw) draw(...args);
        else {
            lastDraw = args;
            if (drawFrame === null) drawFrame = requestAnimationFrame(() => {
                drawFrame = null;
                draw(...lastDraw);
            });
        }
    }

    function draw(currentS, K, sigma, T, isCall) {
        lastDraw = [currentS, K, sigma, T, isCall];
        const width = canvas._logW, height = canvas._logH;
        const compact = width < 620;
        const padding = compact ? 44 : 60;
        const bottom = height - padding - (compact ? 190 : 125);
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height);
        const chartW = width - padding * 2, chartH = bottom - padding;
        const maxStock = 200;
        const samples = Math.min(2048, Math.ceil(chartW));
        const values = new Float64Array(samples + 1);
        const rootT = Math.sqrt(T), discount = K * Math.exp(-r * T);
        const spread = sigma * rootT, drift = (r + 0.5 * sigma * sigma) * T;
        let maximum = Math.max(currentGreeks.cost, currentGreeks.theo, 1);
        for (let i = 0; i <= samples; i++) {
            const S = Math.max(0.01, i / samples * maxStock);
            const d1 = (Math.log(S / K) + drift) / spread, d2 = d1 - spread;
            values[i] = isCall ? S * CND(d1) - discount * CND(d2) : discount * CND(-d2) - S * CND(-d1);
            maximum = Math.max(maximum, values[i]);
        }
        const rough = maximum * 1.08 / 5, power = 10 ** Math.floor(Math.log10(rough));
        const tickStep = [1, 2, 2.5, 5, 10].find(n => n * power >= rough) * power;
        const maxPrice = Math.ceil(maximum * 1.08 / tickStep) * tickStep;
        const minPrice = -0.03 * maxPrice;
        const yPixel = value => bottom - (value - minPrice) / (maxPrice - minPrice) * chartH;
        const xPixel = value => padding + 6 + value / maxStock * (chartW - 12);

        // Draw Ticks and Labels
        ctx.fillStyle = '#000000'; ctx.strokeStyle = '#000000';
        ctx.font = '12px monospace'; ctx.textAlign = 'center';
        
        // X-Axis Ticks
        for (let i = 0; i <= 10; i += compact ? 2 : 1) {
            const xVal = (maxStock / 10) * i;
            const px = xPixel(xVal);
            ctx.beginPath(); ctx.moveTo(px, bottom); ctx.lineTo(px, bottom + 5); ctx.stroke();
            ctx.fillText(xVal.toFixed(0), px, bottom + 15);
        }

        // Y-Axis Ticks
        ctx.textAlign = 'right';
        for (let yVal = 0; yVal <= maxPrice + tickStep * 0.01; yVal += tickStep) {
            const py = yPixel(yVal);
            ctx.beginPath(); ctx.moveTo(padding - 5, py); ctx.lineTo(padding, py); ctx.stroke();
            ctx.fillText(String(Number(yVal.toPrecision(5))), padding - 10, py + 3);
        }

        // Draw Axes
        ctx.lineWidth = 1.5; ctx.beginPath();
        ctx.moveTo(padding, padding); ctx.lineTo(padding, bottom);
        ctx.lineTo(width - padding, bottom); ctx.stroke();

        // Axis Titles
        ctx.textAlign = 'center';
        ctx.fillText('Asset Value ($)', padding + chartW / 2, bottom + 40);
        ctx.save(); ctx.translate(15, padding + chartH / 2); ctx.rotate(-Math.PI / 2);
        ctx.fillText('Option Value ($)', 0, 0); ctx.restore();

        // Draw Entry Cost Line (Break-even threshold)
        ctx.save(); ctx.beginPath(); ctx.rect(padding, padding, chartW, chartH); ctx.clip();
        const costY = yPixel(currentGreeks.cost);
        ctx.strokeStyle = '#15803d';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(padding, costY);
        ctx.lineTo(width - padding, costY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Plot Theoretical Curve (Blue)
        ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 2.5; ctx.beginPath();
        for (let i = 0; i <= samples; i++) {
            const px = xPixel(i / samples * maxStock), py = yPixel(values[i]);
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();

        ctx.restore();
        const spotX = xPixel(currentS), spotY = yPixel(currentGreeks.theo);

        // Draw Marker for Current Asset Value
        ctx.fillStyle = '#f23'; ctx.beginPath(); ctx.arc(spotX, spotY, 5, 0, Math.PI * 2); ctx.fill();

        // Clearer Legend
        const lx = compact ? 12 : padding, ly = bottom + 66;
        ctx.textAlign = 'left'; ctx.fillStyle = '#000000';
        
        // Legend: Theoretical Curve
        ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + 20, ly); ctx.stroke();
        ctx.fillText('Theoretical Option Value', lx + 30, ly + 3);
        
        // Legend: Entry Cost Line (Moved up to fill the gap)
        ctx.strokeStyle = '#15803d'; ctx.lineWidth = 1.5; ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.moveTo(lx, ly + 15); ctx.lineTo(lx + 20, ly + 15); ctx.stroke();
        ctx.setLineDash([]); ctx.fillText('Break-even', lx + 30, ly + 18);

        // Legend: Current Spot Dot (Moved up to fill the gap)
        ctx.fillStyle = '#f23'; ctx.beginPath(); ctx.arc(lx + 10, ly + 30, 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#000000'; ctx.fillText('Current Asset Price', lx + 30, ly + 33);

        // Render Greeks on Canvas
        const rx = width - 12, ry = compact ? bottom + 124 : bottom + 54;
        ctx.textAlign = 'right'; ctx.font = 'bold 12px monospace';
        ctx.fillText(`Value: $${currentGreeks.theo.toFixed(2)}`, rx, ry);
        ctx.fillText(`Δ Delta: ${currentGreeks.delta.toFixed(3)}`, rx, ry + 20);
        ctx.fillText(`Γ Gamma: ${currentGreeks.gamma.toFixed(4)}`, rx, ry + 35);
        ctx.fillText(`Θ Theta: ${currentGreeks.theta.toFixed(3)}`, rx, ry + 50);
        ctx.fillText(`ν Vega:  ${currentGreeks.vega.toFixed(3)}`, rx, ry + 65);
    }

    // Input Event Sync
    const controls = [
        [sSlider, sInput], [kSlider, kInput], 
        [volSlider, volInput], [tSlider, tInput], 
        [costSlider, costInput]
    ];
    controls.forEach(([slider, input]) => bindPair(input, slider, calculate));

    typeSelect.addEventListener('change', calculate);

    const announcement = document.createElement('span');
    announcement.className = 'sr-only';
    announcement.dataset.accessibilityAddition = 'status';
    announcement.setAttribute('role', 'status');
    priceDisplay.removeAttribute('role');
    priceDisplay.removeAttribute('aria-live');
    priceDisplay.after(announcement);
    let announcementTimer;
    window.addEventListener('pagehide', () => { clearTimeout(announcementTimer); cancelAnimationFrame(drawFrame); drawFrame = null; });
    let sizeKey = canvas._logW + ':' + Math.min(2, window.devicePixelRatio || 1);
    observePlot(canvas, (force) => {
        const width = plotWidth(canvas);
        const key = width + ':' + Math.min(2, window.devicePixelRatio || 1);
        if (!force && key === sizeKey) return;
        sizeKey = key;
        sizePlot(canvas, width, plotHeight(width));
        if (lastDraw) draw(...lastDraw);
    });
    calculate();
}
