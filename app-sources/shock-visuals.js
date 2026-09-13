import { unitSystems, unitLabel } from './shock-physics.js';

// Exact Sod reference before the first wave reaches a boundary.
const gamma = 1.4;
const aL = Math.sqrt(gamma),
    aR = Math.sqrt((gamma * 0.1) / 0.125);
const pressureFunction = (p, p0, rho, a) =>
    p > p0
        ? (p - p0) * Math.sqrt(2 / ((gamma + 1) * rho) / (p + ((gamma - 1) / (gamma + 1)) * p0))
        : ((2 * a) / (gamma - 1)) * ((p / p0) ** ((gamma - 1) / (2 * gamma)) - 1);
let low = 0.1,
    high = 1;
for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (low + high);
    if (pressureFunction(mid, 1, 1, aL) + pressureFunction(mid, 0.1, 0.125, aR) > 0) high = mid;
    else low = mid;
}
export const sodPressure = 0.5 * (low + high);
export const sodVelocity = -pressureFunction(sodPressure, 1, 1, aL);
const starAL = aL * sodPressure ** ((gamma - 1) / (2 * gamma));
const shockSpeed =
    aR * Math.sqrt((((gamma + 1) / (2 * gamma)) * sodPressure) / 0.1 + (gamma - 1) / (2 * gamma));
export const sodBoundaryTime = Math.min(0.5 / aL, 0.5 / shockSpeed);

// Check whether the exact Sod reference matches the inputs.
export function isDefaultSodSetup(config) {
    if (
        config.slabs?.length !== 2 ||
        config.leftBoundary !== 'closed' ||
        config.rightBoundary !== 'closed'
    )
        return false;
    return config.slabs.every((slab, i) => {
        const expected = {
            length: 0.5,
            gamma: 1.4,
            density: i === 0 ? 1 : 0.125,
            pressure: i === 0 ? 1 : 0.1,
            velocity: 0
        };
        return Object.entries(expected).every(
            ([key, value]) => Math.abs(slab[key] - value) <= 1e-12
        );
    });
}

// Evaluate the exact Sod state at one position and time.
export function getSodState(x, t) {
    if (t <= 0) return x < 0.5 ? { rho: 1, p: 1, u: 0 } : { rho: 0.125, p: 0.1, u: 0 };
    const speed = (x - 0.5) / t;
    if (speed < -aL) return { rho: 1, p: 1, u: 0 };
    if (speed < sodVelocity - starAL) {
        const u = (2 / (gamma + 1)) * (aL + speed);
        const a = aL - ((gamma - 1) * u) / 2;
        return {
            rho: (a / aL) ** (2 / (gamma - 1)),
            p: (a / aL) ** ((2 * gamma) / (gamma - 1)),
            u
        };
    }
    if (speed < sodVelocity)
        return { rho: sodPressure ** (1 / gamma), p: sodPressure, u: sodVelocity };
    if (speed < shockSpeed) {
        const ratio = sodPressure / 0.1,
            beta = (gamma - 1) / (gamma + 1);
        return {
            rho: (0.125 * (ratio + beta)) / (beta * ratio + 1),
            p: sodPressure,
            u: sodVelocity
        };
    }
    return { rho: 0.125, p: 0.1, u: 0 };
}

// Sample both sides of discontinuities at the same x coordinate.
export function getSodCurve(time, count = 800) {
    const points = [];
    const jumps = time > 0 ? [0.5 + sodVelocity * time, 0.5 + shockSpeed * time] : [0.5];
    for (let i = 0; i <= count; i++) {
        const x = i / count;
        if (!jumps.some((jump) => Math.abs(x - jump) < 1e-12))
            points.push({ x, ...getSodState(x, time) });
    }
    for (const x of jumps) {
        if (x < 0 || x > 1) continue;
        points.push({ x, ...getSodState(x - 1e-12, time) });
        points.push({ x, ...getSodState(x + 1e-12, time) });
    }
    return points.sort((left, right) => left.x - right.x);
}

// Plot appearance.
const plotStyle = {
    font: '"Crimson Pro", Georgia, serif',
    labelSize: 16,
    tickSize: 14,
    lineWidth: 2.4,
    dotRadius: 1.7,
    dotSpacing: 8,
    interfaceWidth: 2,
    minimumPixelRatio: 2
};

// Read the extrema of one field.
export function fieldRange(values, factor = 1) {
    let min = Infinity;
    let max = -Infinity;
    for (const value of values) {
        min = Math.min(min, value * factor);
        max = Math.max(max, value * factor);
    }
    return { min, max };
}

// Round a tick interval to a readable number.
function niceStep(value) {
    const magnitude = 10 ** Math.floor(Math.log10(value));
    const fraction = value / magnitude;
    const choices = [1, 2, 2.5, 5, 10];
    const nearest = choices.reduce((best, choice) =>
        Math.abs(choice - fraction) < Math.abs(best - fraction) ? choice : best
    );
    return nearest * magnitude;
}

// Pad the data range so curves stay clear of the axes.
export function paddedBounds(min, max) {
    if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, step: 0.2 };
    const span = max - min;
    const constant = span <= 1e-12 * Math.max(Math.abs(min), Math.abs(max));
    const padding = constant ? Math.abs(min) * 0.08 || 0.1 : span * 0.08;
    const step = niceStep((span + 2 * padding) / 5);
    const lower = Math.floor((min - padding) / step) * step;
    const upper = Math.ceil((max + padding) / step) * step;
    return { min: lower, max: upper, step };
}

// Choose the stored snapshot nearest to a requested time.
export function nearestSnapshot(history, time) {
    let low = 0;
    let high = history.length - 1;
    while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (history[mid].t < time) low = mid + 1;
        else high = mid;
    }
    return low > 0 && time - history[low - 1].t <= history[low].t - time ? low - 1 : low;
}

// Draw the heatmap and the three state profiles.
export class ShockVisuals {
    // Set up the visible canvases and reusable backgrounds.
    constructor() {
        this.xtCanvas = document.getElementById('xtCanvas');
        this.densityCanvas = document.getElementById('densityCanvas');
        this.pressureCanvas = document.getElementById('pressureCanvas');
        this.velocityCanvas = document.getElementById('velocityCanvas');
        this.xtOffscreen = document.createElement('canvas');
        this.heatmapCanvas = document.createElement('canvas');
        this.pad = { l: 85, r: 120, t: 42, b: 62 };
        this.history = [];
        this.xArr = [];
        this.tracers = [];
        this.config = {};
        this.displayUnits = 'arbitrary';
        this.currentTimeIndex = 0;
        this.dataVersion = 0;
        this.isHovering = false;
        this.hoverX = 0;
        this.hoverY = 0;
        this.framePending = false;
        this.tracesPending = false;
        this.profileBounds = {};
        this.resizeCanvases();
        this.setupEventListeners();
        if (typeof ResizeObserver !== 'undefined') {
            this.resizeObserver = new ResizeObserver(() => {
                if (this.resizeCanvases()) this.renderAll();
            });
            this.resizeObserver.observe(this.xtCanvas.parentElement);
        }
        document.fonts?.ready.then(() => {
            this.staticKey = null;
            this.renderAll();
        });
    }

    // Include current canvases and the next heatmap buffer.
    memoryBytes() {
        return [this.xtCanvas, this.densityCanvas, this.pressureCanvas, this.velocityCanvas,
            this.xtOffscreen, this.heatmapCanvas].reduce((bytes, canvas) => bytes + canvas.width * canvas.height * 4, 0)
            + Math.max(this.heatmapCanvas.width * this.heatmapCanvas.height, this.xtCanvas.width * this.xtCanvas.height) * 8;
    }

    // Format a sampled value without excessive decimal places.
    formatValue(value) {
        if (!Number.isFinite(value)) return '—';
        if (value === 0) return '0';
        const abs = Math.abs(value);
        return abs < 0.01 || abs >= 10000
            ? value.toExponential(3)
            : Number(value.toPrecision(5)).toString();
    }

    // Keep adjacent tick labels distinct for small ranges.
    formatTick(value, step) {
        if (Math.abs(value) < Math.abs(step) * 1e-10) return '0';
        const decimals = Math.max(0, Math.ceil(-Math.log10(step)) + 1);
        if (Math.abs(value) >= 100000 || Math.abs(value) < 0.001) {
            const precision = Math.max(2, Math.ceil(Math.log10(Math.abs(value) / step)) + 1);
            return value.toExponential(Math.min(14, precision));
        }
        return Number(value.toFixed(Math.min(14, decimals))).toString();
    }

    // Allocate enough pixels for a sharp display and PNG export.
    setupCanvasDPI(canvas, width, height, ratio) {
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        canvas._logW = width;
        canvas._logH = height;
        canvas.style.width = '100%';
        canvas.style.height = `${height}px`;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas rendering is unavailable in this browser.');
        context.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
        return context;
    }

    // Resize only when the width or display scale changes.
    resizeCanvases() {
        const width = Math.max(
            240,
            Math.round(
                this.xtCanvas.clientWidth || this.xtCanvas.getBoundingClientRect().width || 800
            )
        );
        const ratio = Math.min(2, Math.max(plotStyle.minimumPixelRatio, window.devicePixelRatio || 1));
        if (width === this.width && ratio === this.pixelRatio) return false;
        this.width = width;
        this.pixelRatio = ratio;
        const heatmapHeight = width < 500 ? 460 : 560;
        const profileHeight = width < 500 ? 280 : 310;
        this.xtCtx = this.setupCanvasDPI(this.xtCanvas, width, heatmapHeight, ratio);
        this.densityCtx = this.setupCanvasDPI(this.densityCanvas, width, profileHeight, ratio);
        this.pressureCtx = this.setupCanvasDPI(this.pressureCanvas, width, profileHeight, ratio);
        this.velocityCtx = this.setupCanvasDPI(this.velocityCanvas, width, profileHeight, ratio);
        this.xtOffCtx = this.setupCanvasDPI(this.xtOffscreen, width, heatmapHeight, ratio);
        this.heatmapKey = null;
        this.staticKey = null;
        return true;
    }

    // Convert internal values to the selected display units.
    getUnitMultipliers() {
        const units = unitSystems[this.displayUnits];
        return {
            ...units,
            x: 1 / units.x,
            rho: 1 / units.rho,
            p: 1 / units.p,
            u: 1 / units.u,
            T: 1 / units.T
        };
    }

    // Change labels without rescanning the simulation history.
    setDisplayUnits(system) {
        if (!Object.hasOwn(unitSystems, system) || system === this.displayUnits) return;
        if ((system === 'arbitrary') !== (this.config.unitSystem === 'arbitrary')) return;
        this.displayUnits = system;
        this.calculateBounds();
        this.staticKey = null;
    }

    // Attach the completed run and its precomputed extrema.
    setData(history, xArray, tracers, config, ranges = null) {
        this.history = history;
        this.xArr = xArray;
        this.tracers = tracers;
        this.config = structuredClone(config);
        this.displayUnits = config.displayUnits;
        this.currentTimeIndex = history.length - 1;
        this.isHovering = false;
        this.rawRanges = ranges || this.findHistoryRanges();
        this.dataVersion++;
        this.heatmapKey = null;
        this.staticKey = null;
        this.calculateBounds();
    }

    // Support callers that do not supply precomputed extrema.
    findHistoryRanges() {
        const ranges = {};
        for (const key of ['rho', 'u', 'p', 'T']) {
            let min = Infinity;
            let max = -Infinity;
            for (const snapshot of this.history) {
                const range = fieldRange(snapshot[key]);
                min = Math.min(min, range.min);
                max = Math.max(max, range.max);
            }
            ranges[key] = { min, max };
        }
        return ranges;
    }

    // Keep one consistent color scale across the heatmap.
    calculateBounds() {
        const multipliers = this.getUnitMultipliers();
        this.bounds = {};
        for (const key of ['rho', 'u', 'p', 'T']) {
            const raw = this.rawRanges[key];
            let min = raw.min * multipliers[key];
            let max = raw.max * multipliers[key];
            if (max - min <= 1e-12 * Math.max(Math.abs(min), Math.abs(max))) {
                const padded = paddedBounds(min, max);
                min = padded.min;
                max = padded.max;
            }
            this.bounds[key] = { min, max };
        }
    }

    // Select the nearest stored time and refresh its profiles.
    selectTime(time) {
        if (!this.history.length) return;
        this.currentTimeIndex = nearestSnapshot(this.history, time);
        this.updateTimeControl();
        this.queueRender(true);
    }

    // Update the slider label and theme-colored fill.
    updateTimeControl() {
        const snapshot = this.history[this.currentTimeIndex];
        const slider = document.getElementById('timeSlider');
        const units = this.getUnitMultipliers();
        const text = `${this.formatValue(snapshot.t)} ${units.tLbl}`.trim();
        slider.max = this.history.length - 1;
        slider.value = this.currentTimeIndex;
        slider.disabled = false;
        slider.style.setProperty(
            '--scrub-percent',
            `${(100 * this.currentTimeIndex) / Math.max(1, this.history.length - 1)}%`
        );
        slider.setAttribute('aria-valuetext', text);
        document.getElementById('selectedTime').textContent = text;
    }

    // Combine rapid pointer events into one draw per frame.
    queueRender(traces = false) {
        this.tracesPending = this.tracesPending || traces;
        if (this.framePending) return;
        this.framePending = true;
        const schedule = window.requestAnimationFrame?.bind(window) || ((callback) => callback());
        schedule(() => {
            this.framePending = false;
            this.renderXTWithOverlay();
            if (this.tracesPending) this.renderTraces();
            this.tracesPending = false;
        });
    }

    // Connect pointer and keyboard-friendly time selection.
    setupEventListeners() {
        const readPointer = (event) => {
            const rect = this.xtCanvas.getBoundingClientRect();
            this.hoverX = ((event.clientX - rect.left) * this.xtCanvas._logW) / rect.width;
            this.hoverY = ((event.clientY - rect.top) * this.xtCanvas._logH) / rect.height;
            this.isHovering = true;
        };
        this.xtCanvas.addEventListener('pointermove', (event) => {
            readPointer(event);
            this.queueRender();
        });
        this.xtCanvas.addEventListener('pointerleave', () => {
            this.isHovering = false;
            this.queueRender();
        });
        this.xtCanvas.addEventListener('pointerdown', (event) => {
            readPointer(event);
            const height = this.xtCanvas._logH - this.pad.t - this.pad.b;
            if (this.hoverY < this.pad.t || this.hoverY > this.pad.t + height) return;
            this.selectTime((1 - (this.hoverY - this.pad.t) / height) * this.config.maxTime);
        });
        document.getElementById('timeSlider').addEventListener('input', (event) => {
            if (!this.history.length) return;
            this.currentTimeIndex = Math.max(
                0,
                Math.min(this.history.length - 1, Number(event.target.value))
            );
            this.updateTimeControl();
            this.queueRender(true);
        });
    }

    // Map a scalar to an RGB color.
    getColor(value, min, max, mapName) {
        let fraction = max > min ? (value - min) / (max - min) : 0.5;
        fraction = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0.5;
        if (mapName === 'rainbow') {
            const hue = 4 * (1 - fraction);
            const sector = Math.floor(hue);
            const offset = hue - sector;
            const colors = [
                [255, 255 * offset, 0],
                [255 * (1 - offset), 255, 0],
                [0, 255, 255 * offset],
                [0, 255 * (1 - offset), 255],
                [0, 0, 255]
            ];
            return colors[sector].map(Math.round);
        }
        const maps = {
            plasma: [
                [13, 8, 135],
                [126, 3, 168],
                [203, 71, 120],
                [248, 149, 64],
                [240, 249, 33]
            ],
            viridis: [
                [68, 1, 84],
                [59, 82, 139],
                [33, 145, 140],
                [94, 201, 98],
                [253, 231, 37]
            ],
            inferno: [
                [0, 0, 4],
                [87, 16, 110],
                [187, 55, 84],
                [249, 141, 10],
                [252, 255, 164]
            ],
            magma: [
                [0, 0, 4],
                [81, 18, 124],
                [182, 54, 121],
                [251, 136, 97],
                [252, 253, 191]
            ]
        };
        const stops = maps[mapName] || maps.plasma;
        const index = fraction * (stops.length - 1);
        const lower = Math.floor(index);
        const upper = Math.ceil(index);
        return stops[lower].map((value, channel) =>
            Math.round(value + (index - lower) * (stops[upper][channel] - value))
        );
    }

    // Read the current heatmap controls.
    getXTSettings() {
        const variable = document.getElementById('xtVariable').value;
        const key = { density: 'rho', pressure: 'p', temperature: 'T' }[variable];
        const units = this.getUnitMultipliers();
        const label = variable[0].toUpperCase() + variable.slice(1);
        const unit = key === 'rho' ? units.rhoLbl : key === 'p' ? units.pLbl : units.tempLbl;
        return {
            key,
            ...this.bounds[key],
            factor: units[key],
            label: unitLabel(label, unit),
            map: document.getElementById('xtColormap').value
        };
    }

    // Refresh every visible plot after a control change.
    renderAll() {
        if (!this.history.length) return;
        this.renderXTOffscreen();
        this.renderXTWithOverlay();
        this.renderTraces();
    }

    // Cache heatmap pixels separately from labels and markers.
    renderHeatmap(settings, width, height) {
        const key = `${this.dataVersion}:${settings.key}:${settings.map}:${width}:${height}`;
        if (key === this.heatmapKey) return;
        this.heatmapCanvas.width = width;
        this.heatmapCanvas.height = height;
        const context = this.heatmapCanvas.getContext('2d');
        const image = context.createImageData(width, height);
        const colors = Array.from({ length: 256 }, (_, i) =>
            this.getColor(i, 0, 255, settings.map)
        );
        const cellIndices = new Int32Array(width);
        for (let x = 0; x < width; x++)
            cellIndices[x] = Math.min(
                this.xArr.length - 1,
                Math.floor(((x + 0.5) / width) * this.xArr.length)
            );
        const raw = this.rawRanges[settings.key];
        const range = raw.max - raw.min;
        const constant = range <= 1e-12 * Math.max(Math.abs(raw.min), Math.abs(raw.max));
        for (let y = 0; y < height; y++) {
            const time = (1 - (y + 0.5) / height) * this.config.maxTime;
            const values = this.history[nearestSnapshot(this.history, time)][settings.key];
            for (let x = 0; x < width; x++) {
                const fraction = constant ? 0.5 : (values[cellIndices[x]] - raw.min) / range;
                const color = colors[Math.max(0, Math.min(255, Math.round(fraction * 255)))];
                const index = 4 * (y * width + x);
                image.data[index] = color[0];
                image.data[index + 1] = color[1];
                image.data[index + 2] = color[2];
                image.data[index + 3] = 255;
            }
        }
        context.putImageData(image, 0, 0);
        this.heatmapKey = key;
    }

    // Cache the complete diagram background for fast scrubbing.
    renderXTOffscreen() {
        const settings = this.getXTSettings();
        const units = this.getUnitMultipliers();
        const trackerColor = document.getElementById('trackerColor').value;
        const showTracker = document.getElementById('showTracker').checked;
        const key = `${this.dataVersion}:${this.width}:${this.pixelRatio}:${this.displayUnits}:${settings.key}:${settings.map}:${trackerColor}:${showTracker}`;
        if (key === this.staticKey) return;
        const context = this.xtOffCtx;
        context.font = `${plotStyle.tickSize}px sans-serif`;
        const colorStep = (settings.max - settings.min) / 4;
        const colorLabels = [settings.min, settings.max].map((value) =>
            this.formatTick(value, colorStep)
        );
        const compact = this.width < 500;
        this.pad.r = compact ? 16 : Math.max(110, ...colorLabels.map(label => context.measureText(label).width + 44));
        this.pad.l = Math.min(this.width * 0.35, Math.max(compact ? 62 : 75, context.measureText(this.formatValue(this.config.maxTime)).width + 40));
        this.pad.b = compact ? 130 : 62;
        const plotW = this.width - this.pad.l - this.pad.r;
        const plotH = this.xtCanvas._logH - this.pad.t - this.pad.b;
        this.renderHeatmap(
            settings,
            Math.max(1, Math.round(plotW * this.pixelRatio)),
            Math.round(plotH * this.pixelRatio)
        );
        context.fillStyle = '#fff';
        context.fillRect(0, 0, this.width, this.xtCanvas._logH);
        context.drawImage(this.heatmapCanvas, this.pad.l, this.pad.t, plotW, plotH);
        const timeBounds = { min: 0, max: this.config.maxTime, step: this.config.maxTime / 4 };
        this.drawAxes(
            context,
            this.xtCanvas,
            this.pad,
            unitLabel('Position', units.xLbl),
            unitLabel('Time', units.tLbl),
            this.config.totalLength * units.x,
            timeBounds,
            false
        );
        this.drawColorbar(context, settings);
        if (showTracker) {
            context.save();
            context.beginPath();
            context.rect(this.pad.l, this.pad.t, plotW, plotH);
            context.clip();
            context.strokeStyle = trackerColor;
            context.lineWidth = 2;
            for (const tracer of this.tracers) {
                context.beginPath();
                (tracer.plotPath || tracer.path).forEach((point, i) => {
                    const x = this.pad.l + (point.x / this.config.totalLength) * plotW;
                    const y = this.pad.t + (1 - point.t / this.config.maxTime) * plotH;
                    if (i === 0) context.moveTo(x, y);
                    else context.lineTo(x, y);
                });
                context.stroke();
            }
            context.restore();
        }
        this.staticKey = key;
    }

    // Draw the selected time and optional tooltip over the cached diagram.
    renderXTWithOverlay(showTooltip = true) {
        if (!this.history.length) return;
        const context = this.xtCtx;
        const plotW = this.width - this.pad.l - this.pad.r;
        const plotH = this.xtCanvas._logH - this.pad.t - this.pad.b;
        const snapshot = this.history[this.currentTimeIndex];
        context.drawImage(this.xtOffscreen, 0, 0, this.width, this.xtCanvas._logH);
        const y = this.pad.t + (1 - snapshot.t / this.config.maxTime) * plotH;
        context.beginPath();
        context.strokeStyle = '#000';
        context.lineWidth = 1.8;
        context.moveTo(this.pad.l, y);
        context.lineTo(this.pad.l + plotW, y);
        context.stroke();
        this.updateTimeControl();
        if (
            showTooltip &&
            this.isHovering &&
            this.hoverX >= this.pad.l &&
            this.hoverX <= this.pad.l + plotW &&
            this.hoverY >= this.pad.t &&
            this.hoverY <= this.pad.t + plotH
        )
            this.drawTooltip(context, plotW, plotH);
    }

    // Report the time and cell actually represented by the heatmap.
    drawTooltip(context, plotW, plotH) {
        const units = this.getUnitMultipliers();
        const time = (1 - (this.hoverY - this.pad.t) / plotH) * this.config.maxTime;
        const snapshot = this.history[nearestSnapshot(this.history, time)];
        const cell = Math.min(
            this.xArr.length - 1,
            Math.floor(((this.hoverX - this.pad.l) / plotW) * this.xArr.length)
        );
        const lines = [
            `Snapshot: ${this.formatValue(snapshot.t)} ${units.tLbl}`.trim(),
            `Cell center: ${this.formatValue(this.xArr[cell] * units.x)} ${units.xLbl}`.trim(),
            `Density: ${this.formatValue(snapshot.rho[cell] * units.rho)} ${units.rhoLbl}`.trim(),
            `Pressure: ${this.formatValue(snapshot.p[cell] * units.p)} ${units.pLbl}`.trim(),
            `Velocity: ${this.formatValue(snapshot.u[cell] * units.u)} ${units.uLbl}`.trim(),
            `Temp: ${this.formatValue(snapshot.T[cell] * units.T)} ${units.tempLbl}`.trim()
        ];
        context.font = '14px sans-serif';
        const tipW = Math.min(
            this.width - 12,
            Math.max(...lines.map((line) => context.measureText(line).width)) + 20
        );
        const tipH = lines.length * 22 + 16;
        const x = Math.max(6, Math.min(this.width - tipW - 6, this.hoverX + 12));
        const y = Math.max(6, Math.min(this.xtCanvas._logH - tipH - 6, this.hoverY - tipH - 12));
        context.fillStyle = '#fff';
        context.strokeStyle = '#000';
        context.fillRect(x, y, tipW, tipH);
        context.strokeRect(x, y, tipW, tipH);
        context.fillStyle = '#000';
        context.textAlign = 'left';
        lines.forEach((line, i) => context.fillText(line, x + 10, y + 24 + i * 22, tipW - 20));
    }

    // Render filled black dots at even distances along a curve.
    drawDottedCurve(context, points) {
        context.beginPath();
        context.fillStyle = '#000';
        let remaining = 0;
        for (let i = 1; i < points.length; i++) {
            const [x0, y0] = points[i - 1];
            const [x1, y1] = points[i];
            const length = Math.hypot(x1 - x0, y1 - y0);
            if (length === 0) continue;
            while (remaining <= length) {
                const fraction = remaining / length;
                const x = x0 + fraction * (x1 - x0);
                const y = y0 + fraction * (y1 - y0);
                context.moveTo(x + plotStyle.dotRadius, y);
                context.arc(x, y, plotStyle.dotRadius, 0, 2 * Math.PI);
                remaining += plotStyle.dotSpacing;
            }
            remaining -= length;
        }
        context.fill();
    }

    // Fit each profile to the selected snapshot and its exact reference.
    renderTraces() {
        if (!this.history.length) return;
        const snapshot = this.history[this.currentTimeIndex];
        const units = this.getUnitMultipliers();
        const showAnalytical = isDefaultSodSetup(this.config) && snapshot.t < sodBoundaryTime;
        const analytical = showAnalytical ? getSodCurve(snapshot.t, Math.max(500, this.width)) : [];
        const showTracker =
            document.getElementById('showTracker').checked && this.tracers.length > 0;
        const plots = [
            [
                this.densityCtx,
                this.densityCanvas,
                'rho',
                '#d62728',
                unitLabel('Density', units.rhoLbl)
            ],
            [
                this.pressureCtx,
                this.pressureCanvas,
                'p',
                '#228b22',
                unitLabel('Pressure', units.pLbl)
            ],
            [
                this.velocityCtx,
                this.velocityCanvas,
                'u',
                '#1f77b4',
                unitLabel('Velocity', units.uLbl)
            ]
        ];
        for (const [context, canvas, key, color, title] of plots) {
            const saved = snapshot.ranges?.[key];
            const range = saved ? { min: saved.min * units[key], max: saved.max * units[key] }
                : fieldRange(snapshot[key], units[key]);
            for (const point of analytical) {
                range.min = Math.min(range.min, point[key] * units[key]);
                range.max = Math.max(range.max, point[key] * units[key]);
            }
            const bounds = paddedBounds(range.min, range.max);
            this.profileBounds[key] = bounds;
            context.font = `${plotStyle.tickSize}px sans-serif`;
            const labelWidth = Math.max(
                ...this.tickValues(bounds).map(
                    (value) => context.measureText(this.formatTick(value, bounds.step)).width
                )
            );
            const leftPadding = Math.min(canvas._logW * 0.4, Math.max(canvas._logW < 500 ? 62 : 78, labelWidth + 42));
            const wrapLegend =
                showTracker && showAnalytical && canvas._logW - leftPadding - 24 < 260;
            const bottomPadding = wrapLegend ? 116 : showTracker || showAnalytical ? 88 : 66;
            const padding = { l: leftPadding, r: 24, t: 24, b: bottomPadding };
            const plotW = canvas._logW - padding.l - padding.r;
            const plotH = canvas._logH - padding.t - padding.b;
            const xPixel = (x) => padding.l + (x / this.config.totalLength) * plotW;
            const yPixel = (value) =>
                padding.t +
                (1 - (value * units[key] - bounds.min) / (bounds.max - bounds.min)) * plotH;
            context.fillStyle = '#fff';
            context.fillRect(0, 0, canvas._logW, canvas._logH);
            this.drawAxes(
                context,
                canvas,
                padding,
                unitLabel('Position', units.xLbl),
                title,
                this.config.totalLength * units.x,
                bounds,
                true
            );
            context.save();
            context.beginPath();
            context.rect(padding.l, padding.t, plotW, plotH);
            context.clip();
            context.beginPath();
            context.strokeStyle = color;
            context.lineWidth = plotStyle.lineWidth;
            context.lineJoin = 'round';
            const indices = snapshot.plotIndices?.[key];
            const points = indices?.length ?? this.xArr.length;
            for (let point = 0; point < points; point++) {
                const i = indices ? indices[point] : point;
                if (point === 0) context.moveTo(xPixel(this.xArr[i]), yPixel(snapshot[key][i]));
                else context.lineTo(xPixel(this.xArr[i]), yPixel(snapshot[key][i]));
            }
            context.stroke();
            if (showAnalytical)
                this.drawDottedCurve(
                    context,
                    analytical.map((point) => [xPixel(point.x), yPixel(point[key])])
                );
            if (showTracker) {
                context.strokeStyle = '#000';
                context.lineWidth = plotStyle.interfaceWidth;
                context.setLineDash([7, 5]);
                for (const x of snapshot.tracerX) {
                    if (x === null) continue;
                    context.beginPath();
                    context.moveTo(xPixel(x), padding.t);
                    context.lineTo(xPixel(x), padding.t + plotH);
                    context.stroke();
                }
            }
            context.restore();
            this.drawLegend(context, canvas, padding, showTracker, showAnalytical);
        }
    }

    // Generate stable ticks from a rounded interval.
    tickValues(bounds) {
        const count = Math.min(20, Math.round((bounds.max - bounds.min) / bounds.step));
        return Array.from({ length: count + 1 }, (_, i) => bounds.min + i * bounds.step);
    }

    // Draw axes with readable ticks and faint guide lines.
    drawAxes(context, canvas, padding, xLabel, yLabel, xMax, bounds, grid) {
        const plotW = canvas._logW - padding.l - padding.r;
        const plotH = canvas._logH - padding.t - padding.b;
        context.font = `${plotStyle.tickSize}px sans-serif`;
        context.textAlign = 'right';
        context.fillStyle = '#000';
        for (const value of this.tickValues(bounds)) {
            const y = padding.t + (1 - (value - bounds.min) / (bounds.max - bounds.min)) * plotH;
            if (grid) {
                context.strokeStyle = '#e7e7e7';
                context.lineWidth = 0.7;
                context.beginPath();
                context.moveTo(padding.l, y);
                context.lineTo(padding.l + plotW, y);
                context.stroke();
            }
            context.fillText(this.formatTick(value, bounds.step), padding.l - 11, y + 5);
        }
        context.strokeStyle = '#000';
        context.lineWidth = 1.1;
        context.beginPath();
        context.moveTo(padding.l, padding.t);
        context.lineTo(padding.l, padding.t + plotH);
        context.lineTo(padding.l + plotW, padding.t + plotH);
        context.stroke();
        context.textAlign = 'center';
        const count = plotW < 300 ? 2 : 4;
        for (let i = 0; i <= count; i++)
            context.fillText(
                this.formatTick((i * xMax) / count, xMax / count),
                padding.l + (i * plotW) / count,
                padding.t + plotH + 24
            );
        context.font = `bold ${plotStyle.labelSize}px ${plotStyle.font}`;
        context.fillText(xLabel, padding.l + plotW / 2, padding.t + plotH + 48);
        context.save();
        context.translate(22, padding.t + plotH / 2);
        context.rotate(-Math.PI / 2);
        context.fillText(yLabel, 0, 0);
        context.restore();
    }

    // Draw legend samples with the same black dots and dashes as the data.
    drawLegend(context, canvas, padding, showTracker, showAnalytical) {
        if (!showTracker && !showAnalytical) return;
        const wrap = showTracker && showAnalytical && canvas._logW - padding.l - padding.r < 260;
        let y = canvas._logH - (wrap ? 39 : 17);
        let x = padding.l;
        context.font = '14px sans-serif';
        context.textAlign = 'left';
        context.fillStyle = '#000';
        if (showTracker) {
            context.beginPath();
            context.strokeStyle = '#000';
            context.lineWidth = plotStyle.interfaceWidth;
            context.setLineDash([7, 5]);
            context.moveTo(x, y - 4);
            context.lineTo(x + 28, y - 4);
            context.stroke();
            context.setLineDash([]);
            context.fillText('Interface', x + 36, y);
            x += 124;
        }
        if (showAnalytical) {
            if (wrap) {
                x = padding.l;
                y = canvas._logH - 17;
            }
            this.drawDottedCurve(context, [
                [x, y - 4],
                [x + 28, y - 4]
            ]);
            context.fillText('Analytical Sod', x + 36, y);
        }
    }

    // Label the color scale above the diagram to avoid vertical overlap.
    drawColorbar(context, settings) {
        if (this.width < 500) {
            const x = this.pad.l, y = this.xtCanvas._logH - 58;
            const width = this.width - this.pad.l - this.pad.r;
            for (let i = 0; i < width; i++) {
                context.fillStyle = `rgb(${this.getColor(i / width, 0, 1, settings.map).join(',')})`;
                context.fillRect(x + i, y, 1, 14);
            }
            context.strokeStyle = '#000';
            context.strokeRect(x, y, width, 14);
            context.fillStyle = '#000';
            context.font = `${plotStyle.tickSize}px sans-serif`;
            const step = (settings.max - settings.min) / 2;
            for (let i = 0; i <= 2; i++) {
                context.textAlign = i === 0 ? 'left' : i === 2 ? 'right' : 'center';
                context.fillText(this.formatTick(settings.min + i * step, step), x + i * width / 2, y + 34);
            }
            context.textAlign = 'left';
            context.font = `bold ${plotStyle.labelSize}px ${plotStyle.font}`;
            context.fillText(settings.label, this.pad.l, 24, this.width - this.pad.l - 12);
            return;
        }
        const x = this.width - this.pad.r + 18;
        const height = this.xtCanvas._logH - this.pad.t - this.pad.b;
        for (let i = 0; i < height; i++) {
            const color = this.getColor(1 - i / height, 0, 1, settings.map);
            context.fillStyle = `rgb(${color.join(',')})`;
            context.fillRect(x, this.pad.t + i, 16, 1);
        }
        context.strokeStyle = '#000';
        context.lineWidth = 1;
        context.strokeRect(x, this.pad.t, 16, height);
        context.fillStyle = '#000';
        context.font = `${plotStyle.tickSize}px sans-serif`;
        context.textAlign = 'left';
        const step = (settings.max - settings.min) / 4;
        for (let i = 0; i <= 4; i++)
            context.fillText(
                this.formatTick(settings.min + i * step, step),
                x + 24,
                this.pad.t + (1 - i / 4) * height + 5
            );
        context.font = `bold ${plotStyle.labelSize}px ${plotStyle.font}`;
        context.fillText(settings.label, this.pad.l, 24, this.width - this.pad.l - 12);
    }
}
