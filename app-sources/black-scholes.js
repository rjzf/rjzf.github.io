export function initBlackScholes() {
    const canvas = document.getElementById('bsCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const sInput = document.getElementById('bs-s-val'), sSlider = document.getElementById('bs-s-slider');
    const kInput = document.getElementById('bs-k-val'), kSlider = document.getElementById('bs-k-slider');
    const volInput = document.getElementById('bs-vol-val'), volSlider = document.getElementById('bs-vol-slider');
    const tInput = document.getElementById('bs-t-val'), tSlider = document.getElementById('bs-t-slider');
    const costInput = document.getElementById('bs-cost-val'), costSlider = document.getElementById('bs-cost-slider');
    const typeSelect = document.getElementById('bs-type-select');
    const priceDisplay = document.getElementById('bs-price-display');

    const r = 0.05; 
    const padding = 60;
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
        priceDisplay.style.color = profit >= 0 ? '#32CD32' : '#f23';

        draw(S, K, sigma, T, isCall);
    }

    function draw(currentS, K, sigma, T, isCall) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const chartW = canvas.width - padding * 2, chartH = canvas.height - padding * 2;
        const maxPrice = 120, maxStock = 200;

        // Draw Ticks and Labels
        ctx.fillStyle = '#000000'; ctx.strokeStyle = '#000000';
        ctx.font = '10px monospace'; ctx.textAlign = 'center';
        
        // X-Axis Ticks
        for (let i = 0; i <= 10; i++) {
            const xVal = (maxStock / 10) * i;
            const px = padding + (xVal / maxStock) * chartW;
            ctx.beginPath(); ctx.moveTo(px, canvas.height - padding); ctx.lineTo(px, canvas.height - padding + 5); ctx.stroke();
            ctx.fillText(xVal.toFixed(0), px, canvas.height - padding + 15);
        }

        // Y-Axis Ticks
        ctx.textAlign = 'right';
        for (let i = 0; i <= 6; i++) {
            const yVal = (maxPrice / 6) * i;
            const py = canvas.height - padding - (yVal / maxPrice) * chartH;
            ctx.beginPath(); ctx.moveTo(padding - 5, py); ctx.lineTo(padding, py); ctx.stroke();
            ctx.fillText(yVal.toFixed(0), padding - 10, py + 3);
        }

        // Draw Axes
        ctx.lineWidth = 1.5; ctx.beginPath();
        ctx.moveTo(padding, padding); ctx.lineTo(padding, canvas.height - padding);
        ctx.lineTo(canvas.width - padding, canvas.height - padding); ctx.stroke();

        // Axis Titles
        ctx.textAlign = 'center';
        ctx.fillText('Asset Value ($)', padding + chartW / 2, canvas.height - 10);
        ctx.save(); ctx.translate(15, padding + chartH / 2); ctx.rotate(-Math.PI / 2);
        ctx.fillText('Option Value ($)', 0, 0); ctx.restore();

        // Draw Entry Cost Line (Break-even threshold)
        const costY = canvas.height - padding - (currentGreeks.cost / maxPrice) * chartH;
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(padding, costY);
        ctx.lineTo(canvas.width - padding, costY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Plot Theoretical Curve (Blue)
        ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 2.5; ctx.beginPath();
        for (let x = 0; x <= chartW; x++) {
            const S = Math.max(0.01, (x / chartW) * maxStock);
            const d1_x = (Math.log(S / K) + (r + 0.5 * sigma**2) * T) / (sigma * Math.sqrt(T));
            const d2_x = d1_x - sigma * Math.sqrt(T);
            const val = isCall ? (S * CND(d1_x) - K * Math.exp(-r * T) * CND(d2_x)) : (K * Math.exp(-r * T) * CND(-d2_x) - S * CND(-d1_x));
            const sy = canvas.height - padding - (val / maxPrice) * chartH;
            if (x === 0) ctx.moveTo(padding + x, sy); else ctx.lineTo(padding + x, sy);
        }
        ctx.stroke();

        // Calculate Specific Y-Coordinate for the Marker
        const d1_spot = (Math.log(currentS / K) + (r + 0.5 * sigma**2) * T) / (sigma * Math.sqrt(T));
        const d2_spot = d1_spot - sigma * Math.sqrt(T);
        const spotVal = isCall ? (currentS * CND(d1_spot) - K * Math.exp(-r * T) * CND(d2_spot)) : (K * Math.exp(-r * T) * CND(-d2_spot) - currentS * CND(-d1_spot));
        
        const spotX = (currentS / maxStock) * chartW + padding;
        const spotY = canvas.height - padding - (spotVal / maxPrice) * chartH;

        // Draw Marker for Current Asset Value
        ctx.fillStyle = '#f23'; ctx.beginPath(); ctx.arc(spotX, spotY, 5, 0, Math.PI * 2); ctx.fill();

        // Clearer Legend
        const lx = padding + 20, ly = padding + 20;
        ctx.textAlign = 'left'; ctx.fillStyle = '#000000';
        
        // Legend: Theoretical Curve
        ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + 20, ly); ctx.stroke();
        ctx.fillText('Theoretical Option Value', lx + 30, ly + 3);
        
        // Legend: Entry Cost Line (Moved up to fill the gap)
        ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 1.5; ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.moveTo(lx, ly + 15); ctx.lineTo(lx + 20, ly + 15); ctx.stroke();
        ctx.setLineDash([]); ctx.fillText('Break-even', lx + 30, ly + 18);

        // Legend: Current Spot Dot (Moved up to fill the gap)
        ctx.fillStyle = '#f23'; ctx.beginPath(); ctx.arc(lx + 10, ly + 30, 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#000000'; ctx.fillText('Current Asset Price', lx + 30, ly + 33);

        // Render Greeks on Canvas
        const rx = canvas.width - padding - 10, ry = padding + 10;
        ctx.textAlign = 'right'; ctx.font = 'bold 11px monospace';
        ctx.fillText(`Value: $${currentGreeks.theo.toFixed(2)}`, rx, ry);
        ctx.fillText(`Δ Delta: ${currentGreeks.delta.toFixed(3)}`, rx, ry + 20);
        ctx.fillText(`Γ Gamma: ${currentGreeks.gamma.toFixed(4)}`, rx, ry + 35);
        ctx.fillText(`Θ Theta: ${currentGreeks.theta.toFixed(3)}`, rx, ry + 50);
        ctx.fillText(`ν Vega:  ${currentGreeks.vega.toFixed(3)}`, rx, ry + 65);
    }

    function syncUI(val, targetInput, targetSlider) {
        targetInput.value = val;
        if (targetSlider) targetSlider.value = val;
    }

    // Input Event Sync
    const controls = [
        [sSlider, sInput], [kSlider, kInput], 
        [volSlider, volInput], [tSlider, tInput], 
        [costSlider, costInput]
    ];
    controls.forEach(([s, i]) => {
        const h = (e) => { syncUI(e.target.value, i, s); calculate(); };
        s.addEventListener('input', h); i.addEventListener('change', h);
    });

    typeSelect.addEventListener('change', calculate);

    calculate();
}