// Setup Canvas contexts for 1D plots and 2D x-t diagram
var xtCanvas = document.getElementById('xtCanvas');
var ctxXT = xtCanvas.getContext('2d');
var densityCanvas = document.getElementById('densityCanvas');
var ctxDensity = densityCanvas.getContext('2d');
var pressureCanvas = document.getElementById('pressureCanvas');
var ctxPressure = pressureCanvas.getContext('2d');
var velocityCanvas = document.getElementById('velocityCanvas');
var ctxVelocity = velocityCanvas.getContext('2d');

// Offscreen buffer for x-t diagram performance
var xtOffscreen = document.createElement('canvas');
var ctxOff = xtOffscreen.getContext('2d');

// Global simulation and physics variables
var running = false;
var nCells, dx, time = 0, maxTime;
var U1, U2, U3, gammaArr, xPos;
var plotMinRho, plotMaxRho, plotMinP, plotMaxP, plotMinU, plotMaxU, initialMinRho, initialMaxRho;
var currentInterfacePos = 0;
var history = []; 

// Layout constants
var labelFontSize = 18;
var padL = 70, padR = 100, padT = 20, padB = 60;

// Convert HSL values to RGB for color mapping
function hslToRgb(h, s, l) {
    var r, g, b;
    if (s === 0) { r = g = b = l; } 
    else {
        var hue2rgb = function hue2rgb(p, q, t) {
            if (t < 0) t += 1; if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        }
        var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        var p = 2 * l - q;
        r = hue2rgb(p, q, h + 1/3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1/3);
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

// Generate color lookup table for density plotting
var nColors = 400;
var redList = new Uint8Array(nColors + 1), greenList = new Uint8Array(nColors + 1), blueList = new Uint8Array(nColors + 1);
for (var c = 0; c <= nColors; c++) {
    var val = c / nColors;
    var hue = (2/3) * (1 - val); 
    var rgb = hslToRgb(hue, 1, 0.5);
    redList[c] = rgb[0]; greenList[c] = rgb[1]; blueList[c] = rgb[2];
}

// Initialize grid, variables, and plot scaling
function initFluid() {
    nCells = Number(document.getElementById('gridCells').value);
    var xL = Number(document.getElementById('domainLeft').value);
    var xR = Number(document.getElementById('domainRight').value);
    var xInt = Number(document.getElementById('interfacePos').value);
    maxTime = Number(document.getElementById('maxTime').value);
    
    // Grab state variables from UI
    var rhoL = Number(document.getElementById('leftDensity').value);
    var uL = Number(document.getElementById('leftVelocity').value);
    var pL = Number(document.getElementById('leftPressure').value);
    var gL = Number(document.getElementById('leftGamma').value);
    var rhoR = Number(document.getElementById('rightDensity').value);
    var uR = Number(document.getElementById('rightVelocity').value);
    var pR = Number(document.getElementById('rightPressure').value);
    var gR = Number(document.getElementById('rightGamma').value);

    dx = (xR - xL) / nCells;
    time = 0;
    currentInterfacePos = xInt;
    history = [];

    // Allocate arrays for conserved variables
    U1 = new Float64Array(nCells); U2 = new Float64Array(nCells); U3 = new Float64Array(nCells);
    gammaArr = new Float64Array(nCells); xPos = new Float64Array(nCells);

    // Initial state assignment
    for (var i = 0; i < nCells; i++) {
        xPos[i] = xL + (i + 0.5) * dx;
        if (xPos[i] < xInt) {
            U1[i] = rhoL; U2[i] = rhoL * uL; U3[i] = pL / (gL - 1.0) + 0.5 * rhoL * uL * uL; gammaArr[i] = gL;
        } else {
            U1[i] = rhoR; U2[i] = rhoR * uR; U3[i] = pR / (gR - 1.0) + 0.5 * rhoR * uR * uR; gammaArr[i] = gR;
        }
    }

    // Set plot bounds
    initialMinRho = Math.min(rhoL, rhoR); initialMaxRho = Math.max(rhoL, rhoR);
    if (initialMinRho === initialMaxRho) initialMaxRho += 0.1;
    plotMinRho = initialMinRho - (initialMaxRho - initialMinRho) * 0.1;
    plotMaxRho = initialMaxRho + (initialMaxRho - initialMinRho) * 0.2;
    plotMinP = Math.min(pL, pR) * 0.8; plotMaxP = Math.max(pL, pR) * 1.1;
    var aL = Math.sqrt(gL * pL / rhoL); var aR = Math.sqrt(gR * pR / rhoR);
    var vScale = Math.max(Math.abs(uL), Math.abs(uR), aL, aR);
    plotMinU = -vScale * 1.1; plotMaxU = vScale * 1.1;

    // Reset offscreen x-t buffer
    var plotW = xtCanvas.width - padL - padR;
    var plotH = xtCanvas.height - padT - padB;
    xtOffscreen.width = plotW; xtOffscreen.height = plotH;
    ctxOff.fillStyle = "white"; ctxOff.fillRect(0, 0, plotW, plotH);

    saveToHistory();
    paintCanvas();
}

// Store current state for time scrubbing
function saveToHistory() {
    history.push({
        t: time,
        U1: new Float64Array(U1),
        U2: new Float64Array(U2),
        U3: new Float64Array(U3),
        intPos: currentInterfacePos
    });
}

// Calculate pressure from conserved variables
function calcPressure(rho, rhou, E, gamma) {
    var u = rhou / rho;
    return (gamma - 1.0) * (E - 0.5 * rho * u * u);
}

// Core HLLC Solver routine
function solveHLLC() {
    if (time >= maxTime) { running = false; document.getElementById('playPauseButton').innerText = "Start"; return; }
    var cfl = Number(document.getElementById('cflNumber').value);
    var lB = document.getElementById('leftBoundary').value;
    var rB = document.getElementById('rightBoundary').value;
    
    // Find global max wave speed for CFL time-stepping
    var maxSpeed = 1e-5;
    for (var i = 0; i < nCells; i++) {
        var p = calcPressure(U1[i], U2[i], U3[i], gammaArr[i]);
        var a = Math.sqrt(gammaArr[i] * Math.max(1e-10, p) / U1[i]);
        maxSpeed = Math.max(maxSpeed, Math.abs(U2[i]/U1[i]) + a);
    }
    
    var dt = cfl * dx / maxSpeed;
    if (time + dt > maxTime) dt = maxTime - time;

    var F1 = new Float64Array(nCells + 1), F2 = new Float64Array(nCells + 1), F3 = new Float64Array(nCells + 1);

    // Compute HLLC fluxes at cell interfaces
    for (var i = 0; i <= nCells; i++) {
        var iL, iR, rhoL, uL, EL, gL, pL, aL, HL, rhoR, uR, ER, gR, pR, aR, HR;
        if (i === 0) { // Boundary conditions (Left)
            iR = 0; rhoR = U1[iR]; uR = U2[iR]/rhoR; ER = U3[iR]; gR = gammaArr[iR];
            pR = calcPressure(rhoR, U2[iR], ER, gR); aR = Math.sqrt(gR * pR / rhoR); HR = (ER + pR) / rhoR;
            if (lB === "closed") { rhoL = rhoR; uL = -uR; pL = pR; EL = ER; gL = gR; aL = aR; HL = HR; }
            else { rhoL = rhoR; uL = uR; pL = pR; EL = ER; gL = gR; aL = aR; HL = HR; }
        } else if (i === nCells) { // Boundary conditions (Right)
            iL = nCells - 1; rhoL = U1[iL]; uL = U2[iL]/rhoL; EL = U3[iL]; gL = gammaArr[iL];
            pL = calcPressure(rhoL, U2[iL], EL, gL); aL = Math.sqrt(gL * pL / rhoL); HL = (EL + pL) / rhoL;
            if (rB === "closed") { rhoR = rhoL; uR = -uL; pR = pL; ER = EL; gR = gL; aR = aL; HR = HL; }
            else { rhoR = rhoL; uR = uL; pR = pL; ER = EL; gR = gL; aR = aL; HR = HL; }
        } else { // Internal fluxes
            iL = i-1; iR = i;
            rhoL = U1[iL]; uL = U2[iL]/rhoL; EL = U3[iL]; gL = gammaArr[iL]; pL = calcPressure(rhoL, U2[iL], EL, gL); aL = Math.sqrt(gL * pL / rhoL); HL = (EL+pL)/rhoL;
            rhoR = U1[iR]; uR = U2[iR]/rhoR; ER = U3[iR]; gR = gammaArr[iR]; pR = calcPressure(rhoR, U2[iR], ER, gR); aR = Math.sqrt(gR * pR / rhoR); HR = (ER+pR)/rhoR;
        }

        // Roe-averaging for wave speeds
        var R = Math.sqrt(rhoR / rhoL);
        var uRoe = (uL + R * uR) / (1.0 + R);
        var HRoe = (HL + R * HR) / (1.0 + R);
        var aRoe = Math.sqrt((0.5*(gL+gR) - 1.0) * (HRoe - 0.5 * uRoe * uRoe));
        var sL = Math.min(uL - aL, uRoe - aRoe), sR = Math.max(uR + aR, uRoe + aRoe);
        var sStar = (pR - pL + rhoL * uL * (sL - uL) - rhoR * uR * (sR - uR)) / (rhoL * (sL - uL) - rhoR * (sR - uR));

        var f1L = rhoL * uL, f2L = rhoL * uL * uL + pL, f3L = uL * (EL + pL);
        var f1R = rhoR * uR, f2R = rhoR * uR * uR + pR, f3R = uR * (ER + pR);

        // HLLC State selection logic
        if (sL >= 0) { F1[i] = f1L; F2[i] = f2L; F3[i] = f3L; }
        else if (sL <= 0 && sStar >= 0) {
            var cL = rhoL * (sL - uL) / (sL - sStar);
            F1[i] = f1L + sL * (cL - rhoL); F2[i] = f2L + sL * (cL * sStar - rhoL * uL);
            F3[i] = f3L + sL * (cL * (EL/rhoL + (sStar - uL) * (sStar + pL / (rhoL * (sL - uL)))) - EL);
        } else if (sStar <= 0 && sR >= 0) {
            var cR = rhoR * (sR - uR) / (sR - sStar);
            F1[i] = f1R + sR * (cR - rhoR); F2[i] = f2R + sR * (cR * sStar - rhoR * uR);
            F3[i] = f3R + sR * (cR * (ER/rhoR + (sStar - uR) * (sStar + pR / (rhoR * (sR - uR)))) - ER);
        } else { F1[i] = f1R; F2[i] = f2R; F3[i] = f3R; }
    }

    // Update conserved variables via flux divergence
    for (var i = 0; i < nCells; i++) {
        U1[i] -= (dt / dx) * (F1[i + 1] - F1[i]);
        U2[i] -= (dt / dx) * (F2[i + 1] - F2[i]);
        U3[i] -= (dt / dx) * (F3[i + 1] - F3[i]);
    }

    // Lag-Interface tracking
    var xL = Number(document.getElementById('domainLeft').value);
    var tIdx = Math.max(0, Math.min(nCells - 1, Math.floor((currentInterfacePos - xL) / dx)));
    currentInterfacePos += (U2[tIdx] / U1[tIdx]) * dt;

    // Render new time step to offscreen x-t buffer
    var pW = xtOffscreen.width, pH = xtOffscreen.height;
    var yTop = pH - ((time + dt) / maxTime) * pH;
    var hRow = (dt / maxTime) * pH;
    var yTopFixed = Math.floor(yTop);
    var hRowFixed = Math.ceil(hRow + 0.5);

    for (var i = 0; i < nCells; i++) {
        var cIdx = Math.max(0, Math.min(nColors, Math.round(((U1[i] - initialMinRho) / (initialMaxRho - initialMinRho)) * nColors)));
        ctxOff.fillStyle = "rgb(" + redList[cIdx] + "," + greenList[cIdx] + "," + blueList[cIdx] + ")";
        ctxOff.fillRect(Math.floor(i * (pW/nCells)), yTopFixed, Math.ceil(pW/nCells), hRowFixed);
    }

    if (document.getElementById('showTracker').checked) {
        var xPx = ((currentInterfacePos - xL) / (Number(document.getElementById('domainRight').value) - xL)) * pW;
        ctxOff.fillStyle = "#000000"; 
        ctxOff.fillRect(Math.floor(xPx - 2), yTopFixed, 4, hRowFixed);
    }

    time += dt;
    saveToHistory();
}

// Simulation loop
function simulate() {
    if (!running) return;
    var speed = Number(document.getElementById('simSpeed').value);
    for (var i = 0; i < speed; i++) solveHLLC();
    paintCanvas();
    if (running) window.requestAnimationFrame(simulate);
}

// User-driven time scrubbing on x-t diagram
function scrubTime(event) {
    var rect = xtCanvas.getBoundingClientRect();
    var scaleY = xtCanvas.height / rect.height;
    var y = (event.clientY - rect.top) * scaleY;
    if (y < padT || y > xtCanvas.height - padB) return;
    running = false;
    document.getElementById('playPauseButton').innerText = "Start";
    var tFrac = 1 - (y - padT) / (xtCanvas.height - padT - padB);
    var targetT = tFrac * maxTime;
    if (history.length === 0) return;
    var best = history[0];
    for (var i = 0; i < history.length; i++) {
        if (Math.abs(history[i].t - targetT) < Math.abs(best.t - targetT)) best = history[i];
    }
    time = best.t; U1.set(best.U1); U2.set(best.U2); U3.set(best.U3); currentInterfacePos = best.intPos;
    paintCanvas();
}

xtCanvas.addEventListener('mousedown', scrubTime);

// Draw plot borders, labels, and tick marks
function drawAxes(ctx, w, h, minX, maxX, minY, maxY, xL_label, yL_label, isXT) {
    var locR = isXT ? padR : 30;
    var pW = w - padL - locR, pH = h - padT - padB;
    ctx.strokeStyle = "black"; ctx.lineWidth = 1; ctx.fillStyle = "black"; ctx.font = labelFontSize + "px Crimson Pro"; 
    
    // Draw Main Axis Lines
    ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL, h - padB); ctx.lineTo(w - locR, h - padB); ctx.stroke();
    
    // Add Tick Marks
    ctx.beginPath();
    for(let i=0; i<=5; i++) {
        // Y-axis ticks
        let tickY = padT + (i/5) * pH;
        ctx.moveTo(padL, tickY); ctx.lineTo(padL - 5, tickY);
        // X-axis ticks
        let tickX = padL + (i/5) * pW;
        ctx.moveTo(tickX, h - padB); ctx.lineTo(tickX, h - padB + 5);
    }
    ctx.stroke();

    // Labels
    ctx.textAlign = "center"; ctx.fillText(xL_label, padL + pW / 2, h - 15);
    ctx.save(); ctx.translate(20, padT + pH / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(yL_label, 0, 0); ctx.restore();
    ctx.textAlign = "right"; ctx.fillText(maxY.toFixed(2), padL - 10, padT + 5); ctx.fillText(minY.toFixed(2), padL - 10, h - padB);
    ctx.textAlign = "center"; ctx.fillText(minX.toFixed(2), padL, h - padB + 20); ctx.fillText(maxX.toFixed(2), w - locR, h - padB + 20);
    
    return { localPadL: padL, localPadR: locR, localPadT: padT, localPadB: padB, plotW: pW, plotH: pH };
}

// Exact solution for Sod validation case
function getAnalyticalSod(x) {
    if (x < 0.263) return { rho: 1.0, p: 1.0, u: 0.0 };
    if (x < 0.486) {
        let v = (x - 0.263) / (0.486 - 0.263);
        return { rho: 1.0 - v * 0.5737, p: 1.0 - v * 0.6969, u: v * 0.9275 };
    }
    if (x < 0.685) return { rho: 0.4263, p: 0.3031, u: 0.9275 };
    if (x < 0.850) return { rho: 0.2656, p: 0.3031, u: 0.9275 };
    return { rho: 0.125, p: 0.1, u: 0.0 };
}

// Master rendering function
function paintCanvas() {
    var w = densityCanvas.width, h = densityCanvas.height;
    var xL = Number(document.getElementById('domainLeft').value), xR = Number(document.getElementById('domainRight').value);
    var showT = document.getElementById('showTracker').checked;

    // Check if current run matches Sod validation case parameters
    var isDefault = (
        Math.abs(Number(document.getElementById('leftDensity').value) - 1.0) < 0.01 &&
        Math.abs(Number(document.getElementById('leftPressure').value) - 1.0) < 0.01 &&
        Math.abs(Number(document.getElementById('rightDensity').value) - 0.125) < 0.01 &&
        Math.abs(Number(document.getElementById('rightPressure').value) - 0.1) < 0.01 &&
        Math.abs(time - 0.2) < 0.005
    );

    // Clear canvases
    [ctxDensity, ctxPressure, ctxVelocity, ctxXT].forEach(c => { c.fillStyle = "white"; c.fillRect(0, 0, 800, 800); });
    
    // Draw Axes for all plots
    var dD = drawAxes(ctxDensity, w, h, xL, xR, plotMinRho, plotMaxRho, "Position", "Density", false);
    var pD = drawAxes(ctxPressure, w, h, xL, xR, plotMinP, plotMaxP, "Position", "Pressure", false);
    var vD = drawAxes(ctxVelocity, w, h, xL, xR, plotMinU, plotMaxU, "Position", "Velocity", false);

    // Helper: Draw subtle gridlines for trace graphs
    function drawGrid(ctx, dims) {
        ctx.save();
        ctx.strokeStyle = "rgba(0,0,0,0.05)";
        ctx.beginPath();
        for(let i=1; i<5; i++) {
            let y = dims.localPadT + (i/5) * dims.plotH;
            ctx.moveTo(dims.localPadL, y); ctx.lineTo(dims.localPadL + dims.plotW, y);
            let x = dims.localPadL + (i/5) * dims.plotW;
            ctx.moveTo(x, dims.localPadT); ctx.lineTo(x, dims.localPadT + dims.plotH);
        }
        ctx.stroke();
        ctx.restore();
    }
    [ctxDensity, ctxPressure, ctxVelocity].forEach((c, idx) => {
        let dims = [dD, pD, vD][idx];
        drawGrid(c, dims);
    });

    // Helper: Draw analytical solution as dotted line
    function drawDotted(ctx, dims, color, minV, maxV, func) {
        ctx.save();
        ctx.beginPath();
        ctx.strokeStyle = color; 
        ctx.lineWidth = 5;
        ctx.setLineDash([1, 10]);
        ctx.lineCap = 'round';
        for (var i = 0; i < nCells; i++) {
            var val = func(i);
            var xPx = dims.localPadL + (i / (nCells - 1)) * dims.plotW;
            var yPx = dims.localPadT + dims.plotH - ((val - minV) / (maxV - minV)) * dims.plotH;
            i === 0 ? ctx.moveTo(xPx, yPx) : ctx.lineTo(xPx, yPx);
        }
        ctx.stroke();
        ctx.restore();
    }

    // Helper: Draw simulation data as solid line
    function plotLine(ctx, dims, color, minV, maxV, func) {
        ctx.beginPath();
        ctx.strokeStyle = color; 
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        for (var i = 0; i < nCells; i++) {
            var val = func(i);
            var xPx = dims.localPadL + (i / (nCells - 1)) * dims.plotW;
            var yPx = dims.localPadT + dims.plotH - ((val - minV) / (maxV - minV)) * dims.plotH;
            i === 0 ? ctx.moveTo(xPx, yPx) : ctx.lineTo(xPx, yPx);
        }
        ctx.stroke();
    }

    // Plot Simulation Data
    plotLine(ctxDensity, dD, '#d62728', plotMinRho, plotMaxRho, i => U1[i]);
    plotLine(ctxPressure, pD, '#2ca02c', plotMinP, plotMaxP, i => calcPressure(U1[i], U2[i], U3[i], gammaArr[i]));
    plotLine(ctxVelocity, vD, '#1f77b4', plotMinU, plotMaxU, i => U2[i] / U1[i]);

    // Plot Analytical Overlay if conditions match
    if (isDefault) {
        drawDotted(ctxDensity, dD, '#000', plotMinRho, plotMaxRho, i => getAnalyticalSod(xPos[i]).rho);
        drawDotted(ctxPressure, pD, '#000', plotMinP, plotMaxP, i => getAnalyticalSod(xPos[i]).p);
        drawDotted(ctxVelocity, vD, '#000', plotMinU, plotMaxU, i => getAnalyticalSod(xPos[i]).u);

        // Legend for analytical solution
        [ {c: ctxDensity, d: dD}, {c: ctxPressure, d: pD}, {c: ctxVelocity, d: vD} ].forEach(item => {
            let legX = item.d.localPadL + 15;
            let legY = item.d.localPadT + item.d.plotH - 15;
            item.c.save();
            item.c.font = "12px Crimson Pro";
            item.c.fillStyle = "black";
            item.c.textAlign = "left";
            item.c.textBaseline = "middle";
            item.c.strokeStyle = "black";
            item.c.lineWidth = 4;
            item.c.setLineDash([1, 6]);
            item.c.lineCap = 'round';
            item.c.beginPath();
            item.c.moveTo(legX, legY);
            item.c.lineTo(legX + 25, legY);
            item.c.stroke();
            item.c.fillText("Analytical Solution", legX + 35, legY);
            item.c.restore();
        });
    }

    // Draw vertical interface trackers on 1D plots
    if (showT) {
        const snapshots = [{c: ctxDensity, d: dD}, {c: ctxPressure, d: pD}, {c: ctxVelocity, d: vD}];
        snapshots.forEach(s => {
            let tPx = s.d.localPadL + ((currentInterfacePos - xL)/(xR - xL)) * s.d.plotW;
            s.c.setLineDash([5, 5]); s.c.strokeStyle = "#000"; s.c.lineWidth = 1;
            s.c.beginPath(); s.c.moveTo(tPx, s.d.localPadT); s.c.lineTo(tPx, s.d.localPadT + s.d.plotH); s.c.stroke();
            s.c.setLineDash([]);
        });
    }

    // Finalize x-t diagram rendering and colorbar
    var xtD = drawAxes(ctxXT, xtCanvas.width, xtCanvas.height, xL, xR, 0, maxTime, "Position", "Time", true);
    ctxXT.drawImage(xtOffscreen, padL, padT);
    var cbX = xtCanvas.width - 75, cbY = xtD.localPadT, cbW = 15, cbH = xtD.plotH;
    for (var i = 0; i < cbH; i++) {
        var cIdx = Math.round((1 - i / cbH) * nColors);
        ctxXT.fillStyle = "rgb(" + redList[cIdx] + "," + greenList[cIdx] + "," + blueList[cIdx] + ")";
        ctxXT.fillRect(cbX, cbY + i, cbW, 2);
    }
    ctxXT.strokeStyle = "black"; ctxXT.strokeRect(cbX, cbY, cbW, cbH);
    ctxXT.fillStyle = "black"; ctxXT.textAlign = "left"; 
    ctxXT.font = labelFontSize + "px Crimson Pro"; 
    ctxXT.fillText(initialMaxRho.toFixed(2), cbX + cbW + 5, cbY + 10); ctxXT.fillText(initialMinRho.toFixed(2), cbX + cbW + 5, cbY + cbH);
    ctxXT.save(); ctxXT.translate(cbX + cbW + 50, cbY + cbH / 2); ctxXT.rotate(-Math.PI / 2); ctxXT.textAlign = "center";
    ctxXT.fillText("Density", 0, 0); ctxXT.restore();

    // Tracker Legend for x-t diagram
    if (showT) {
        var legX = padL + 605, legY = h - padB + 645;
        ctxXT.font = "bold " + (labelFontSize - 2) + "px Crimson Pro";
        var tW = ctxXT.measureText("Interface").width, bH = labelFontSize + 5;
        ctxXT.strokeStyle = "black"; ctxXT.strokeRect(legX - 5, legY - bH/2, 30 + 10 + tW + 10, bH);
        ctxXT.fillStyle = "black"; ctxXT.fillRect(legX, legY - 2, 30, 4);
        ctxXT.textBaseline = "middle"; ctxXT.fillText("Interface", legX + 40, legY);
    }
}

// Control Event Handlers
function startStop() { running = !running; document.getElementById('playPauseButton').innerText = running ? "Pause" : "Start"; if (running) simulate(); }
initFluid();
document.getElementById('playPauseButton').addEventListener('click', startStop);
document.getElementById('resetButton').addEventListener('click', () => { running = false; document.getElementById('playPauseButton').innerText = "Start"; initFluid(); });
document.getElementById('stepButton').addEventListener('click', () => { running = false; solveHLLC(); paintCanvas(); });

// Export to window for HTML accessibility
window.initFluid = initFluid; window.startStop = startStop;