/**
 * Visualization Engine for 1D Shock Tube
 */

export class ShockVisuals {
    constructor() {
        this.xtCanvas = document.getElementById('xtCanvas');
        this.densityCanvas = document.getElementById('densityCanvas');
        this.pressureCanvas = document.getElementById('pressureCanvas');
        this.velocityCanvas = document.getElementById('velocityCanvas');

        this.xtCtx = this.setupCanvasDPI(this.xtCanvas);
        this.densityCtx = this.setupCanvasDPI(this.densityCanvas);
        this.pressureCtx = this.setupCanvasDPI(this.pressureCanvas);
        this.velocityCtx = this.setupCanvasDPI(this.velocityCanvas);

        this.xtOffscreen = document.createElement('canvas');
        this.xtOffCtx = this.setupCanvasDPI(this.xtOffscreen, this.xtCanvas._logW, this.xtCanvas._logH);

        this.pad = { l: 85, r: 110, t: 40, b: 65 }; 
        this.plotW = this.xtCanvas._logW - this.pad.l - this.pad.r;
        this.plotH = this.xtCanvas._logH - this.pad.t - this.pad.b;
        this.labelFontSize = 14;

        this.history = [];
        this.xArr = [];
        this.tracers = [];
        this.currentTimeIndex = 0;
        this.config = {};
        this.bounds = { rhoMin: 0, rhoMax: 1, pMin: 0, pMax: 1, uMin: -1, uMax: 1, tMin: 0, tMax: 1 };
        
        this.hoverX = -1;
        this.hoverY = -1;
        this.isHovering = false;

        this.setupEventListeners();
    }

    formatValue(val) {
        const abs = Math.abs(val);
        if (abs === 0) return "0.00";
        if (abs < 0.01) return val.toExponential(2);
        if (abs < 1) return val.toFixed(4);
        return val.toFixed(2);
    }

    setupCanvasDPI(canvas, forceW, forceH) {
        const dpr = window.devicePixelRatio || 1;
        const w = forceW || parseInt(canvas.getAttribute('width')) || 800;
        const h = forceH || parseInt(canvas.getAttribute('height')) || 200;
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

    getUnitMultipliers() {
        const sys = document.getElementById('unitSystem').value;
        if (sys === 'cgs') return { rho: 0.001, p: 10, u: 100, T: 1, rhoLbl: '(g/cm³)', pLbl: '(Ba)', uLbl: '(cm/s)', xLbl: '(cm)', tLbl: '(s)', tempLbl: '(K)' };
        if (sys === 'fps') return { rho: 0.00194, p: 0.02088, u: 3.28084, T: 1, rhoLbl: '(slug/ft³)', pLbl: '(psf)', uLbl: '(ft/s)', xLbl: '(ft)', tLbl: '(s)', tempLbl: '(°R)' };
        if (sys === 'mks') return { rho: 1, p: 1, u: 1, T: 1, rhoLbl: '(kg/m³)', pLbl: '(Pa)', uLbl: '(m/s)', xLbl: '(m)', tLbl: '(s)', tempLbl: '(K)' };
        return { rho: 1, p: 1, u: 1, T: 1, rhoLbl: '', pLbl: '', uLbl: '', xLbl: '', tLbl: '', tempLbl: '' };
    }

    setData(history, xArray, tracers, config) {
        this.history = history;
        this.xArr = xArray;
        this.tracers = tracers;
        this.config = config;
        this.calculateBounds();
    }

    calculateBounds() {
        let rhoMin = Infinity, rhoMax = -Infinity;
        let pMin = Infinity, pMax = -Infinity;
        let uMin = Infinity, uMax = -Infinity;
        let tMin = Infinity, tMax = -Infinity;
        const mults = this.getUnitMultipliers();

        this.history.forEach(snap => {
            for(let i=0; i < snap.rho.length; i++) {
                const rVal = snap.rho[i] * mults.rho;
                const pVal = snap.p[i] * mults.p;
                const uVal = snap.u[i] * mults.u;
                const tempVal = snap.T ? (snap.T[i] * mults.T) : 0;

                rhoMin = Math.min(rhoMin, rVal); rhoMax = Math.max(rhoMax, rVal);
                pMin = Math.min(pMin, pVal); pMax = Math.max(pMax, pVal);
                uMin = Math.min(uMin, uVal); uMax = Math.max(uMax, uVal);
                tMin = Math.min(tMin, tempVal); tMax = Math.max(tMax, tempVal);
            }
        });

        this.bounds = {
            rhoMin: rhoMin, rhoMax: rhoMax,
            pMin: pMin, pMax: pMax,
            uMin: uMin, uMax: uMax,
            tMin: tMin, tMax: tMax
        };
    }

    isDefaultSodSetup() {
        try {
            const slabs = document.querySelectorAll('.slab-container');
            if (slabs.length !== 2) return false;
            const checks = [
                {id: 'secGamma-0', val: 1.4}, {id: 'secPressure-0', val: 1.0}, {id: 'secDensity-0', val: 1.0}, {id: 'secVelocity-0', val: 0.0},
                {id: 'secGamma-1', val: 1.4}, {id: 'secPressure-1', val: 0.1}, {id: 'secDensity-1', val: 0.125}, {id: 'secVelocity-1', val: 0.0}
            ];
            return checks.every(c => Math.abs(parseFloat(document.getElementById(c.id).value) - c.val) < 0.001);
        } catch(e) { return false; }
    }

    getSodAnalyticalValue(x, t, variable) {
        if (t <= 0) {
            if (x < 0.5) return (variable === 'density' ? 1.0 : (variable === 'pressure' ? 1.0 : 0.0));
            return (variable === 'density' ? 0.125 : (variable === 'pressure' ? 0.1 : 0.0));
        }
        const g = 1.4;
        const x_rel = x - 0.5;
        const P_star = 0.30313, u_star = 0.92745, rho_starL = 0.42632, rho_starR = 0.26557;
        const s_head = -1.18322, s_tail = -0.07027, s_contact = 0.92745, s_shock = 1.75216;
        const s = x_rel / t;
        let rho, p, u;
        if (s < s_head) { rho = 1.0; p = 1.0; u = 0.0; }
        else if (s < s_tail) { 
            u = (2 / (g + 1)) * (1.18322 + s);
            const a = 1.18322 - ((g - 1) / 2) * u;
            p = Math.pow(a*a / (g * 1.0 / 1.0), g / (g - 1));
            rho = Math.pow(p / 1.0, 1 / g);
        }
        else if (s < s_contact) { rho = rho_starL; p = P_star; u = u_star; }
        else if (s < s_shock) { rho = rho_starR; p = P_star; u = u_star; }
        else { rho = 0.125; p = 0.1; u = 0.0; }
        if (variable === 'density') return rho;
        if (variable === 'pressure') return p;
        return u;
    }

    setupEventListeners() {
        this.xtCanvas.addEventListener('mousemove', (e) => {
            if (!this.history || this.history.length === 0) return;
            const rect = this.xtCanvas.getBoundingClientRect();
            const scaleX = this.xtCanvas._logW / rect.width;
            const scaleY = this.xtCanvas._logH / rect.height;
            this.hoverX = (e.clientX - rect.left) * scaleX;
            this.hoverY = (e.clientY - rect.top) * scaleY;
            this.isHovering = true;
            this.renderXTWithOverlay();
        });

        this.xtCanvas.addEventListener('mouseleave', () => {
            this.isHovering = false;
            this.renderXTWithOverlay();
        });

        this.xtCanvas.addEventListener('click', () => {
            if (!this.history || this.history.length === 0 || !this.isHovering) return;
            const localPlotH = this.xtCanvas._logH - this.pad.t - this.pad.b;
            if (this.hoverY < this.pad.t || this.hoverY > this.pad.t + localPlotH) return;
            const yFrac = 1.0 - ((this.hoverY - this.pad.t) / localPlotH);
            const targetTime = yFrac * this.config.maxTime;
            let bestIdx = 0; let minDiff = Infinity;
            for (let i = 0; i < this.history.length; i++) {
                const diff = Math.abs(this.history[i].t - targetTime);
                if (diff < minDiff) { minDiff = diff; bestIdx = i; }
            }
            this.currentTimeIndex = bestIdx;
            this.renderTraces(); 
            this.renderXTWithOverlay();
        });
    }

    getColor(value, min, max, mapName) {
        let t = (value - min) / (max - min);
        t = Math.max(0, Math.min(1, t)); 
        if (mapName === 'rainbow') {
            let h = (2/3) * (1 - t); 
            const hue2rgb = (p, q, t) => {
                if(t < 0) t += 1; if(t > 1) t -= 1;
                if(t < 1/6) return p + (q - p) * 6 * t;
                if(t < 1/2) return q;
                if(t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                return p;
            };
            const q = 1;
            const p = 0;
            return [Math.round(hue2rgb(p,q,h+1/3)*255), Math.round(hue2rgb(p,q,h)*255), Math.round(hue2rgb(p,q,h-1/3)*255)];
        }
        const maps = {
            plasma:  [[13,8,135], [126,3,168], [203,71,120], [248,149,64], [240,249,33]],
            viridis: [[68,1,84], [59,82,139], [33,145,140], [94,201,98], [253,231,37]],
            inferno: [[0,0,4], [87,16,110], [187,55,84], [249,141,10], [252,255,164]],
            magma:   [[0,0,4], [81,18,124], [182,54,121], [251,136,97], [252,253,191]]
        };
        const stops = maps[mapName] || maps.plasma;
        const idx = t * (stops.length - 1);
        const lower = Math.floor(idx);
        const upper = Math.ceil(idx);
        const f = idx - lower;
        if (lower === upper) return stops[lower];
        return [
            Math.round(stops[lower][0] + f * (stops[upper][0] - stops[lower][0])),
            Math.round(stops[lower][1] + f * (stops[upper][1] - stops[lower][1])),
            Math.round(stops[lower][2] + f * (stops[upper][2] - stops[lower][2]))
        ];
    }

    renderAll() {
        if (!this.history || this.history.length === 0) return;
        this.renderXTOffscreen();
        this.renderXTWithOverlay();
        this.renderTraces();
    }

    renderXTOffscreen() {
        const colormap = document.getElementById('xtColormap').value;
        const xtVar = document.getElementById('xtVariable').value;
        const trackerColor = document.getElementById('trackerColor').value;
        const mults = this.getUnitMultipliers();
        const dpr = window.devicePixelRatio || 1;
        
        this.xtOffCtx.fillStyle = "white";
        this.xtOffCtx.fillRect(0, 0, this.xtOffscreen._logW, this.xtOffscreen._logH);
        
        const plotW = this.xtCanvas._logW - this.pad.l - this.pad.r;
        const plotH = this.xtCanvas._logH - this.pad.t - this.pad.b;
        const nCells = this.history[0].rho.length;
        const nSteps = this.history.length;
        
        const minVal = xtVar === 'density' ? this.bounds.rhoMin : (xtVar === 'pressure' ? this.bounds.pMin : this.bounds.tMin);
        const maxVal = xtVar === 'density' ? this.bounds.rhoMax : (xtVar === 'pressure' ? this.bounds.pMax : this.bounds.tMax);

        const physW = Math.floor(plotW * dpr);
        const physH = Math.floor(plotH * dpr);
        const imgData = this.xtOffCtx.createImageData(physW, physH);
        const data = imgData.data;

        for (let j = 0; j < nSteps; j++) {
            const snap = this.history[j];
            const yBottomFrac = snap.t / this.config.maxTime;
            const yTopFrac = (j < nSteps - 1) ? this.history[j+1].t / this.config.maxTime : 1.0;
            const y1 = Math.floor(physH - yBottomFrac * physH);
            const y0 = Math.floor(physH - yTopFrac * physH);
            for (let i = 0; i < nCells; i++) {
                const rawVal = xtVar === 'density' ? snap.rho[i] : (xtVar === 'pressure' ? snap.p[i] : (snap.T ? snap.T[i] : 0));
                const val = rawVal * (xtVar === 'density' ? mults.rho : (xtVar === 'pressure' ? mults.p : mults.T));
                
                const rgb = this.getColor(val, minVal, maxVal, colormap);
                const x0 = Math.floor((i / nCells) * physW);
                const x1 = Math.floor(((i + 1) / nCells) * physW);
                for (let py = Math.max(0, y0); py < y1; py++) {
                    for (let px = x0; px < x1; px++) {
                        const idx = (py * physW + px) * 4;
                        data[idx] = rgb[0]; data[idx+1] = rgb[1]; data[idx+2] = rgb[2]; data[idx+3] = 255; 
                    }
                }
            }
        }
        this.xtOffCtx.putImageData(imgData, Math.floor(this.pad.l * dpr), Math.floor(this.pad.t * dpr));
        
        if (document.getElementById('showTracker').checked && this.tracers) {
            this.xtOffCtx.strokeStyle = trackerColor === 'white' ? "rgba(255, 255, 255, 0.9)" : "rgba(0, 0, 0, 0.9)";
            this.xtOffCtx.lineWidth = 2;
            const totalLen = this.xArr[this.xArr.length - 1] + (this.xArr[1] - this.xArr[0]) / 2;
            this.tracers.forEach(tracer => {
                this.xtOffCtx.beginPath();
                tracer.path.forEach((p, i) => {
                    const xPx = this.pad.l + (p.x / totalLen) * plotW;
                    const yPx = this.pad.t + plotH - (p.t / this.config.maxTime) * plotH;
                    if(i===0) this.xtOffCtx.moveTo(xPx, yPx); else this.xtOffCtx.lineTo(xPx, yPx);
                });
                this.xtOffCtx.stroke();
            });
        }
    }

    renderXTWithOverlay() {
        const mults = this.getUnitMultipliers();
        const plotW = this.xtCanvas._logW - this.pad.l - this.pad.r;
        const plotH = this.xtCanvas._logH - this.pad.t - this.pad.b;
        const totalLen = this.xArr[this.xArr.length - 1] + (this.xArr[1] - this.xArr[0]) / 2;
        this.xtCtx.fillStyle = "white";
        this.xtCtx.fillRect(0, 0, this.xtCanvas._logW, this.xtCanvas._logH);
        this.xtCtx.drawImage(this.xtOffscreen, 0, 0, this.xtCanvas._logW, this.xtCanvas._logH);
        this.drawAxes(this.xtCtx, this.xtCanvas._logW, this.xtCanvas._logH, "Position", "Time", totalLen, this.config.maxTime, 0, this.pad);
        this.drawColorbar();

        if (this.history.length > 0) {
            const currentT = this.history[this.currentTimeIndex].t;
            const yPlay = this.pad.t + plotH - ((currentT / this.config.maxTime) * plotH);
            this.xtCtx.beginPath();
            this.xtCtx.strokeStyle = "rgba(0, 0, 0, 0.8)";
            this.xtCtx.lineWidth = 2;
            this.xtCtx.moveTo(this.pad.l, yPlay);
            this.xtCtx.lineTo(this.pad.l + plotW, yPlay);
            this.xtCtx.stroke();
        }

        if (this.isHovering && this.hoverX >= this.pad.l && this.hoverX <= this.pad.l + plotW && this.hoverY >= this.pad.t && this.hoverY <= this.pad.t + plotH) {
            const xFrac = (this.hoverX - this.pad.l) / plotW;
            const yFrac = 1.0 - ((this.hoverY - this.pad.t) / plotH);
            const time = yFrac * this.config.maxTime;
            const position = xFrac * totalLen; 
            let bestTIdx = 0; let minTDiff = Infinity;
            for (let i = 0; i < this.history.length; i++) {
                if (Math.abs(this.history[i].t - time) < minTDiff) { minTDiff = Math.abs(this.history[i].t - time); bestTIdx = i; }
            }
            const snap = this.history[bestTIdx];
            const cellIdx = Math.max(0, Math.min(snap.rho.length - 1, Math.floor(xFrac * snap.rho.length)));
            const tempVal = snap.T ? snap.T[cellIdx] * mults.T : 0;
            const text = `Time: ${time.toFixed(4)}s | Position: ${position.toFixed(3)}${mults.xLbl.replace(/[()]/g, '')} | Density: ${this.formatValue(snap.rho[cellIdx]*mults.rho)} ${mults.rhoLbl} | Pressure: ${this.formatValue(snap.p[cellIdx]*mults.p)} ${mults.pLbl} | Velocity: ${this.formatValue(snap.u[cellIdx]*mults.u)} ${mults.uLbl} | Temp: ${this.formatValue(tempVal)} ${mults.tempLbl}`;
            
            this.xtCtx.fillStyle = "rgba(255, 255, 255, 0.95)";
            this.xtCtx.strokeStyle = "black";
            this.xtCtx.font = "12px sans-serif";
            const tW = this.xtCtx.measureText(text).width;
            let tipX = this.hoverX + 15;
            let tipY = this.hoverY - 15;
            if (tipX + tW + 10 > this.xtCanvas._logW) tipX = this.hoverX - tW - 15;
            this.xtCtx.fillRect(tipX, tipY - 15, tW + 10, 24);
            this.xtCtx.strokeRect(tipX, tipY - 15, tW + 10, 24);
            this.xtCtx.fillStyle = "black";
            this.xtCtx.textAlign = "left";
            this.xtCtx.fillText(text, tipX + 5, tipY + 2);
        }
    }

    renderTraces() {
        if (!this.history || this.history.length === 0) return;
        const snap = this.history[this.currentTimeIndex];
        const mults = this.getUnitMultipliers();
        const totalLen = this.xArr[this.xArr.length - 1] + (this.xArr[1] - this.xArr[0]) / 2;
        const tracePad = { l: 85, r: 30, t: 15, b: 45 };
        
        const showAnalytical = this.isDefaultSodSetup() && Math.abs(snap.t - 0.2) < 0.001;

        const renderPlot = (ctx, canvas, data, color, min, max, title, mult, variable) => {
            const plotW = canvas._logW - tracePad.l - tracePad.r;
            const plotH = canvas._logH - tracePad.t - tracePad.b;
            ctx.fillStyle = "white";
            ctx.fillRect(0, 0, canvas._logW, canvas._logH);
            this.drawAxes(ctx, canvas._logW, canvas._logH, "Position", title, totalLen, max, min, tracePad);

            ctx.beginPath();
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            for (let i = 0; i < data.length; i++) {
                const val = data[i] * mult;
                const xPx = tracePad.l + (i / (data.length - 1)) * plotW;
                const yPx = tracePad.t + plotH - ((val - min) / (max - min)) * plotH;
                i === 0 ? ctx.moveTo(xPx, yPx) : ctx.lineTo(xPx, yPx);
            }
            ctx.stroke();

            if (showAnalytical) {
                ctx.beginPath();
                ctx.setLineDash([0, 8]); 
                ctx.lineCap = 'round'; 
                ctx.strokeStyle = "black";
                ctx.lineWidth = 5; 
                for (let i = 0; i <= 200; i++) {
                    const xFrac = i / 200;
                    const analyticalVal = this.getSodAnalyticalValue(xFrac * totalLen, snap.t, variable) * mult;
                    const px = tracePad.l + xFrac * plotW;
                    const py = tracePad.t + plotH - ((analyticalVal - min) / (max - min)) * plotH;
                    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
                }
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.lineCap = 'butt'; 
            }
            
            if(document.getElementById('showTracker').checked && this.tracers) {
                const trackerColor = document.getElementById('trackerColor').value;
                this.tracers.forEach(tracer => {
                    let tp = tracer.path.find(p => Math.abs(p.t - snap.t) < 0.001) || tracer.path[tracer.path.length-1];
                    const txPx = tracePad.l + (tp.x / totalLen) * plotW; 
                    ctx.beginPath();
                    ctx.setLineDash([4,4]);
                    ctx.strokeStyle = trackerColor === 'white' ? "rgba(0, 0, 0, 0.4)" : "rgba(0, 0, 0, 0.9)";
                    ctx.moveTo(txPx, tracePad.t); ctx.lineTo(txPx, tracePad.t + plotH);
                    ctx.stroke();
                    ctx.setLineDash([]);
                });

                ctx.fillStyle = "black"; ctx.font = "10px Crimson Pro"; ctx.textAlign = "left";
                ctx.beginPath(); ctx.setLineDash([3,3]);
                ctx.moveTo(tracePad.l, canvas._logH - 10); ctx.lineTo(tracePad.l + 20, canvas._logH - 10);
                ctx.stroke(); ctx.setLineDash([]);
                ctx.fillText("= Interface", tracePad.l + 25, canvas._logH - 7);
                
                if (showAnalytical) {
                    ctx.beginPath(); ctx.setLineDash([0, 5]); ctx.lineCap = 'round'; ctx.lineWidth = 4;
                    ctx.moveTo(tracePad.l + 85, canvas._logH - 10); ctx.lineTo(tracePad.l + 86, canvas._logH - 10);
                    ctx.stroke(); ctx.setLineDash([]); ctx.lineCap = 'butt'; ctx.lineWidth = 1.5;
                    ctx.fillText("= Analytical", tracePad.l + 100, canvas._logH - 7);
                }
            }
        };

        renderPlot(this.densityCtx, this.densityCanvas, snap.rho, '#d62728', this.bounds.rhoMin, this.bounds.rhoMax, `Density ${mults.rhoLbl}`, mults.rho, 'density');
        renderPlot(this.pressureCtx, this.pressureCanvas, snap.p, '#2ca02c', this.bounds.pMin, this.bounds.pMax, `Pressure ${mults.pLbl}`, mults.p, 'pressure');
        renderPlot(this.velocityCtx, this.velocityCanvas, snap.u, '#1f77b4', this.bounds.uMin, this.bounds.uMax, `Velocity ${mults.uLbl}`, mults.u, 'velocity');
    }

    drawAxes(ctx, w, h, xLabelBase, yLabelBase, xRange, yRange, yMinVal = 0, padding) {
        const mults = this.getUnitMultipliers();
        const isTimeAxis = yLabelBase === "Time";
        const xLabel = `${xLabelBase} ${mults.xLbl}`.trim();
        const yLabel = isTimeAxis ? `${yLabelBase} ${mults.tLbl}`.trim() : yLabelBase;
        const localPlotW = w - padding.l - padding.r;
        const localPlotH = h - padding.t - padding.b;
        ctx.strokeStyle = "black"; ctx.lineWidth = 1.5; ctx.fillStyle = "black"; ctx.font = `bold ${this.labelFontSize}px Crimson Pro`; 
        ctx.beginPath(); ctx.moveTo(padding.l, padding.t); ctx.lineTo(padding.l, h - padding.b); ctx.lineTo(padding.l + localPlotW, h - padding.b); ctx.stroke();
        ctx.font = `11px sans-serif`; ctx.textAlign = "right";
        for(let i=0; i<=5; i++) {
            let frac = i/5;
            let tickY = padding.t + (1 - frac) * localPlotH;
            ctx.beginPath(); ctx.moveTo(padding.l, tickY); ctx.lineTo(padding.l - 6, tickY); ctx.stroke();
            let val = isTimeAxis ? frac * yRange : yMinVal + frac * (yRange - yMinVal);
            ctx.fillText(this.formatValue(val), padding.l - 10, tickY + 4);
        }
        ctx.textAlign = "center";
        for(let i=0; i<=5; i++) {
            let frac = i/5;
            let tickX = padding.l + frac * localPlotW;
            ctx.beginPath(); ctx.moveTo(tickX, h - padding.b); ctx.lineTo(tickX, h - padding.b + 6); ctx.stroke();
            ctx.fillText((frac * xRange).toFixed(2), tickX, h - padding.b + 20);
        }
        ctx.font = `bold ${this.labelFontSize}px Crimson Pro`;
        ctx.fillText(xLabel, padding.l + localPlotW / 2, h - 5);
        ctx.save(); ctx.translate(25, padding.t + localPlotH / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(yLabel, 0, 0); ctx.restore();
    }

    drawColorbar() {
        const xtVar = document.getElementById('xtVariable').value;
        const colormap = document.getElementById('xtColormap').value;
        const mults = this.getUnitMultipliers();
        
        let minVal = xtVar === 'density' ? this.bounds.rhoMin : (xtVar === 'pressure' ? this.bounds.pMin : this.bounds.tMin);
        let maxVal = xtVar === 'density' ? this.bounds.rhoMax : (xtVar === 'pressure' ? this.bounds.pMax : this.bounds.tMax);
        
        const plotH = this.xtCanvas._logH - this.pad.t - this.pad.b;
        const cbX = this.xtCanvas._logW - 75, cbY = this.pad.t, cbW = 18, cbH = plotH;
        for (let i = 0; i < cbH; i++) {
            const t = 1 - (i / cbH);
            const val = minVal + t * (maxVal - minVal);
            const rgb = this.getColor(val, minVal, maxVal, colormap);
            this.xtCtx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
            this.xtCtx.fillRect(cbX, cbY + i, cbW, 1);
        }
        this.xtCtx.strokeStyle = "black"; this.xtCtx.strokeRect(cbX, cbY, cbW, cbH);
        
        let varLabel = 'Temperature';
        let unitLabel = mults.tempLbl;
        if (xtVar === 'density') { varLabel = 'Density'; unitLabel = mults.rhoLbl; }
        else if (xtVar === 'pressure') { varLabel = 'Pressure'; unitLabel = mults.pLbl; }

        this.xtCtx.fillStyle = "black"; this.xtCtx.font = "bold 12px Crimson Pro"; this.xtCtx.textAlign = "center";
        this.xtCtx.save(); this.xtCtx.translate(cbX + cbW + 45, cbY + cbH/2); this.xtCtx.rotate(Math.PI/2);
        this.xtCtx.fillText(`${varLabel} ${unitLabel}`.trim(), 0, 0);
        this.xtCtx.restore();
        
        this.xtCtx.font = "10px sans-serif"; this.xtCtx.textAlign = "left"; 
        for(let i=0; i<=5; i++) {
            let frac = i/5;
            let val = minVal + frac * (maxVal - minVal);
            this.xtCtx.fillText(this.formatValue(val), cbX + cbW + 5, cbY + cbH - (frac * cbH) + 3);
        }
    }
}