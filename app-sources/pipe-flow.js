var canvas = document.getElementById('theCanvas');
var context = canvas.getContext('2d');
var image = context.createImageData(canvas.width, canvas.height);

for (var i = 3; i < image.data.length; i += 4) image.data[i] = 255;

var pxPerSquare = 5;
var xdim = canvas.width / pxPerSquare;
var ydim = canvas.height / pxPerSquare;

var stepsSlider = document.getElementById('stepsSlider');
var startButton = document.getElementById('startButton');
var speedSlider = document.getElementById('speedSlider');
var speedValue = document.getElementById('speedValue');
var viscSlider = document.getElementById('viscSlider');
var viscValue = document.getElementById('viscValue');
var plotSelect = document.getElementById('plotSelect');
var contrastSlider = document.getElementById('contrastSlider');
var dragCheck = document.getElementById('dragCheck');
var tracerCheck = document.getElementById('tracerCheck');
var sensorCheck = document.getElementById('sensorCheck');
var rafCheck = document.getElementById('rafCheck');
var speedReadout = document.getElementById('speedReadout');

var running = false;
var stepCount = 0;
var startTime = 0;
var four9ths = 4.0 / 9.0;
var one9th = 1.0 / 9.0;
var one36th = 1.0 / 36.0;

var sensorX = Math.floor(xdim / 2); 
var sensorY = Math.floor(ydim / 2);
var draggingSensor = false; var mouseIsDown = false;
var time = 0;
var mouseX, mouseY; var oldMouseX = -1, oldMouseY = -1;

var n0, nN, nS, nE, nW, nNE, nSE, nNW, nSW, rho, ux, uy, curl, barrier;
var nTracers = 100;
var tracerX = new Float64Array(nTracers);
var tracerY = new Float64Array(nTracers);

var nColors = 400;
var redList = new Uint8Array(nColors + 2), greenList = new Uint8Array(nColors + 2), blueList = new Uint8Array(nColors + 2);
for (var c = 0; c <= nColors; c++) {
    var r, g, b;
    if (c < nColors / 8) { r = 0; g = 0; b = Math.round(255 * (c + nColors / 8) / (nColors / 4)); }
    else if (c < 3 * nColors / 8) { r = 0; g = Math.round(255 * (c - nColors / 8) / (nColors / 4)); b = 255; }
    else if (c < 5 * nColors / 8) { r = Math.round(255 * (c - 3 * nColors / 8) / (nColors / 4)); g = 255; b = 255 - r; }
    else if (c < 7 * nColors / 8) { r = 255; g = Math.round(255 * (7 * nColors / 8 - c) / (nColors / 4)); b = 0; }
    else { r = Math.round(255 * (9 * nColors / 8 - c) / (nColors / 4)); g = 0; b = 0; }
    redList[c] = r; greenList[c] = g; blueList[c] = b;
}
redList[nColors + 1] = 64; greenList[nColors + 1] = 64; blueList[nColors + 1] = 64;

// Memory allocation and boundary setup
function setupArrays() {
    var size = xdim * ydim;
    n0 = new Float64Array(size); nN = new Float64Array(size); nS = new Float64Array(size);
    nE = new Float64Array(size); nW = new Float64Array(size); nNE = new Float64Array(size);
    nSE = new Float64Array(size); nNW = new Float64Array(size); nSW = new Float64Array(size);
    rho = new Float64Array(size); ux = new Float64Array(size); uy = new Float64Array(size);
    curl = new Float64Array(size); barrier = new Uint8Array(size);

    for (var y = 0; y < ydim; y++) { for (var x = 0; x < xdim; x++) { barrier[x + y * xdim] = 0; } }
    for (var x = 0; x < xdim; x++) {
        barrier[x + 1 * xdim] = 1;
        barrier[x + (ydim - 2) * xdim] = 1;
    }
    
    for (var t = 0; t < nTracers; t++) { tracerX[t] = 0.0; tracerY[t] = 0.0; }
    sensorX = Math.floor(xdim / 2); sensorY = Math.floor(ydim / 2);
}

// Domain rescaling
function changeResolution() {
    pxPerSquare = Number(document.getElementById('sizeSelect').value);
    xdim = canvas.width / pxPerSquare;
    ydim = canvas.height / pxPerSquare;
    setupArrays();
    changeObstacle(); 
}

// Obstacle injection and parameter reset
function changeObstacle() {
    speedSlider.value = 0.09;
    viscSlider.value = 0.03;
    adjustSpeed(); adjustViscosity();

    for (var i = 0; i < xdim * ydim; i++) {
        barrier[i] = 0;
    }

    for (var x = 0; x < xdim; x++) {
        barrier[x + 1 * xdim] = 1;
        barrier[x + (ydim - 2) * xdim] = 1;
    }

    var obs = document.getElementById('obstacleSelect').value;

    if (obs === 'step') {
        // Backward Facing Step
        for (var x = 1; x < xdim / 5; x++) {
            for (var y = 1; y <= ydim / 2; y++) {
                barrier[Math.floor(x) + Math.floor(y) * xdim] = 1;
            }
        }
    } else if (obs === 'fstep') {
        // Forward Facing Step
        for (var x = xdim / 3; x < xdim; x++) {
            for (var y = 1; y <= ydim / 2; y++) {
                barrier[Math.floor(x) + Math.floor(y) * xdim] = 1;
            }
        }
    } else if (obs === 'cylinder') {
        // Center Cylinder
        var cx = xdim / 4;
        var cy = ydim / 2;
        var r = ydim / 10;
        for (var y = 1; y < ydim - 1; y++) {
            for (var x = 1; x < xdim - 1; x++) {
                if (Math.pow(x - cx, 2) + Math.pow(y - cy, 2) <= r * r) {
                    barrier[x + y * xdim] = 1;
                }
            }
        }
    } else if (obs === 'inline') {
        // Inline Tubes
        var size = ydim / 12;
        var cy = ydim / 2;
        for (var i = 1; i <= 3; i++) {
            var cx = i * (xdim / 4);
            for (var y = Math.floor(cy - size); y <= Math.floor(cy + size); y++) {
                for (var x = Math.floor(cx - size); x <= Math.floor(cx + size); x++) {
                    if (x > 0 && x < xdim && y > 0 && y < ydim) {
                        barrier[x + y * xdim] = 1;
                    }
                }
            }
        }
    } else if (obs === 'staggered') {
        // Staggered Tubes
        var size = ydim / 12;
        for (var i = 1; i <= 3; i++) {
            var cx = i * (xdim / 4.5);
            var cy = (i % 2 === 0) ? ydim / 3 : 2 * ydim / 3;
            for (var y = Math.floor(cy - size); y <= Math.floor(cy + size); y++) {
                for (var x = Math.floor(cx - size); x <= Math.floor(cx + size); x++) {
                    if (x > 0 && x < xdim && y > 0 && y < ydim) {
                        barrier[x + y * xdim] = 1;
                    }
                }
            }
        }
    } else if (obs === 'baffle') {
        // Bottom Baffle
        var cx = xdim / 3;
        var thick = Math.max(2, Math.floor(xdim / 100)); 
        for (var x = cx; x < cx + thick; x++) {
            for (var y = 1; y < ydim * 0.50; y++) { 
                barrier[Math.floor(x) + Math.floor(y) * xdim] = 1;
            }
        }
    }

    initFluid(); 
    if (tracerCheck.checked) initTracers();
}

function initFluid() {
    var u0 = Number(speedSlider.value);
    for (var y = 0; y < ydim; y++) {
        for (var x = 0; x < xdim; x++) {
            setEquil(x, y, u0, 0, 1);
            curl[x + y * xdim] = 0.0;
        }
    }
    paintCanvas();
}

function simulate() {
    var stepsPerFrame = Number(stepsSlider.value);
    setBoundaries();
    var pushing = false; var pushX, pushY, pushUX, pushUY; 
    if (mouseIsDown && dragCheck.checked && draggingSensor == false) {
        if (oldMouseX >= 0) {
            var gridLoc = canvasToGrid(mouseX, mouseY);
            pushX = gridLoc.x; pushY = gridLoc.y;
            pushUX = (mouseX - oldMouseX) / pxPerSquare / stepsPerFrame;
            pushUY = -(mouseY - oldMouseY) / pxPerSquare / stepsPerFrame;
            if (Math.abs(pushUX) > 0.1) pushUX = 0.1 * Math.abs(pushUX) / pushUX;
            if (Math.abs(pushUY) > 0.1) pushUY = 0.1 * Math.abs(pushUY) / pushUY;
            pushing = true;
        }
        oldMouseX = mouseX; oldMouseY = mouseY;
    } else { oldMouseX = -1; oldMouseY = -1; }
    
    for (var step = 0; step < stepsPerFrame; step++) {
        collide(); stream();
        if (tracerCheck.checked) moveTracers();
        if (pushing) push(pushX, pushY, pushUX, pushUY);
        time++;
    }
    paintCanvas();
    if (running) {
        stepCount += stepsPerFrame;
        var elapsed = ((new Date()).getTime() - startTime) / 1000;
        speedReadout.innerHTML = Number(stepCount / elapsed).toFixed(0);
        if (rafCheck.checked) { window.requestAnimationFrame(simulate); } else { window.setTimeout(simulate, 1); }
    }
}

function setBoundaries() {
    var u0 = Number(speedSlider.value);
    for (var x = 0; x < xdim; x++) {
        setEquil(x, 0, u0, 0, 1);
        setEquil(x, ydim - 1, u0, 0, 1);
    }
    for (var y = 1; y < ydim - 1; y++) {
        setEquil(0, y, u0, 0, 1);
    }
}

// Collision logic
function collide() {
    var viscosity = Number(viscSlider.value); var omega = 1 / (3 * viscosity + 0.5);
    for (var y = 1; y < ydim - 1; y++) {
        for (var x = 1; x < xdim - 1; x++) {
            var i = x + y * xdim;
            var thisrho = n0[i] + nN[i] + nS[i] + nE[i] + nW[i] + nNW[i] + nNE[i] + nSW[i] + nSE[i];
            rho[i] = thisrho;
            
            var thisux = (nE[i] + nNE[i] + nSE[i] - nW[i] - nNW[i] - nSW[i]) / thisrho; ux[i] = thisux;
            var thisuy = (nN[i] + nNE[i] + nNW[i] - nS[i] - nSE[i] - nSW[i]) / thisrho; uy[i] = thisuy;
            
            var one9thrho = one9th * thisrho, ux3 = 3 * thisux, uy3 = 3 * thisuy, ux2 = thisux * thisux, uy2 = thisuy * thisuy, u2 = ux2 + uy2, u215 = 1.5 * u2;
            
            n0[i] += omega * (four9ths * thisrho * (1 - u215) - n0[i]);
            nE[i] += omega * (one9thrho * (1 + ux3 + 4.5 * ux2 - u215) - nE[i]);
            nW[i] += omega * (one9thrho * (1 - ux3 + 4.5 * ux2 - u215) - nW[i]);
            nN[i] += omega * (one9thrho * (1 + uy3 + 4.5 * uy2 - u215) - nN[i]);
            nS[i] += omega * (one9thrho * (1 - uy3 + 4.5 * uy2 - u215) - nS[i]); 
            nNE[i] += omega * (one36th * thisrho * (1 + ux3 + uy3 + 4.5 * (u2 + 2*thisux*thisuy) - u215) - nNE[i]);
            nSE[i] += omega * (one36th * thisrho * (1 + ux3 - uy3 + 4.5 * (u2 - 2*thisux*thisuy) - u215) - nSE[i]);
            nNW[i] += omega * (one36th * thisrho * (1 - ux3 + uy3 + 4.5 * (u2 - 2*thisux*thisuy) - u215) - nNW[i]);
            nSW[i] += omega * (one36th * thisrho * (1 - ux3 - uy3 + 4.5 * (u2 + 2*thisux*thisuy) - u215) - nSW[i]);
        }
    }
    
    for (var y = 1; y <= ydim - 2; y++) {
        nW[xdim - 1 + y * xdim] = nW[xdim - 2 + y * xdim];
        nNW[xdim - 1 + y * xdim] = nNW[xdim - 2 + y * xdim];
        nSW[xdim - 1 + y * xdim] = nSW[xdim - 2 + y * xdim];
    }
}

// Streaming step
function stream() {
    for (var y = ydim - 2; y > 0; y--) { for (var x = 1; x < xdim - 1; x++) { nN[x + y * xdim] = nN[x + (y - 1) * xdim]; nNW[x + y * xdim] = nNW[x + 1 + (y - 1) * xdim]; } }
    for (var y = ydim - 2; y > 0; y--) { for (var x = xdim - 1; x > 0; x--) { nE[x + y * xdim] = nE[x - 1 + y * xdim]; nNE[x + y * xdim] = nNE[x - 1 + (y - 1) * xdim]; } }
    for (var y = 1; y < ydim - 1; y++) { for (var x = xdim - 1; x > 0; x--) { nS[x + y * xdim] = nS[x + (y + 1) * xdim]; nSE[x + y * xdim] = nSE[x - 1 + (y + 1) * xdim]; } }
    for (var y = 1; y < ydim - 1; y++) { for (var x = 1; x < xdim - 1; x++) { nW[x + y * xdim] = nW[x + 1 + y * xdim]; nSW[x + y * xdim] = nSW[x + 1 + (y + 1) * xdim]; } }
    
    for (var y = 1; y < ydim - 1; y++) {
        for (var x = 1; x < xdim - 1; x++) {
            if (barrier[x + y * xdim] === 1) {
                var i = x + y * xdim;
                nE[x + 1 + y * xdim] = nW[i]; nW[x - 1 + y * xdim] = nE[i]; nN[x + (y + 1) * xdim] = nS[i]; nS[x + (y - 1) * xdim] = nN[i];
                nNE[x+1+(y+1)*xdim] = nSW[i]; nNW[x-1+(y+1)*xdim] = nSE[i]; nSE[x+1+(y-1)*xdim] = nNW[i]; nSW[x-1+(y-1)*xdim] = nNE[i];
            }
        }
    }
}

// Update tracer positions
function moveTracers() {
    for (var t = 0; t < nTracers; t++) {
        var rx = Math.floor(tracerX[t]), ry = Math.floor(tracerY[t]); 
        if (rx < 0) rx = 0; if (rx >= xdim) rx = xdim - 1;
        if (ry < 0) ry = 0; if (ry >= ydim) ry = ydim - 1;
        
        var i = rx + ry * xdim;
        tracerX[t] += ux[i]; tracerY[t] += uy[i];
        
        var newRx = Math.floor(tracerX[t]), newRy = Math.floor(tracerY[t]);
        if (tracerX[t] > xdim - 1 || newRx < 0 || newRx >= xdim || newRy <= 0 || newRy >= ydim - 1 || barrier[newRx + newRy * xdim] === 1) {
            var valid = false;
            while (!valid) {
                var spawnY = (Math.random() * 0.81 + 0.09) * ydim;
                var sRy = Math.floor(spawnY);
                if (barrier[0 + sRy * xdim] === 0) {
                    tracerX[t] = 0; tracerY[t] = spawnY; valid = true;
                }
            }
        }
    }
}

function push(px, py, pux, puy) {
    var m = 3;
    if ((px > m) && (px < xdim - 1 - m) && (py > m) && (py < ydim - 1 - m)) {
        for (var dx = -1; dx <= 1; dx++) { setEquil(px + dx, py + 2, pux, puy); setEquil(px + dx, py - 2, pux, puy); }
        for (var dx = -2; dx <= 2; dx++) { for (var dy = -1; dy <= 1; dy++) { setEquil(px + dx, py + dy, pux, puy); } }
    }
}

// Initialize node equilibrium
function setEquil(x, y, nux, nuy, nrho) {
    var i = x + y * xdim; if (typeof nrho == 'undefined') nrho = rho[i];
    var ux3 = 3 * nux, uy3 = 3 * nuy, ux2 = nux * nux, uy2 = nuy * nuy, u2 = ux2 + uy2, u215 = 1.5 * u2;
    n0[i] = four9ths * nrho * (1 - u215); nE[i] = one9th * nrho * (1 + ux3 + 4.5 * ux2 - u215); nW[i] = one9th * nrho * (1 - ux3 + 4.5 * ux2 - u215);
    nN[i] = one9th * nrho * (1 + uy3 + 4.5 * uy2 - u215); nS[i] = one9th * nrho * (1 - uy3 + 4.5 * uy2 - u215); 
    nNE[i] = one36th * nrho * (1 + ux3 + uy3 + 4.5 * (u2 + 2*nux*nuy) - u215); nSE[i] = one36th * nrho * (1 + ux3 - uy3 + 4.5 * (u2 - 2*nux*nuy) - u215);
    nNW[i] = one36th * nrho * (1 - ux3 + uy3 + 4.5 * (u2 - 2*nux*nuy) - u215); nSW[i] = one36th * nrho * (1 - ux3 - uy3 + 4.5 * (u2 + 2*nux*nuy) - u215);
    rho[i] = nrho; ux[i] = nux; uy[i] = nuy;
}

function initTracers() {
    if (tracerCheck.checked) {
        for (var t = 0; t < nTracers; t++) {
            var valid = false;
            var attempts = 0;
            while (!valid && attempts < 1000) { 
                var tx = Math.random() * xdim, ty = Math.random() * ydim;
                var ix = Math.floor(tx), iy = Math.floor(ty);
                if (ix >= 0 && ix < xdim && iy > 0 && iy < ydim - 1 && barrier[ix + iy * xdim] === 0) {
                    tracerX[t] = tx; tracerY[t] = ty; valid = true;
                }
                attempts++;
            }
        }
    }
    paintCanvas();
}

function paintCanvas() {
    var contrast = Math.pow(1.2, Number(contrastSlider.value));
    var plotType = plotSelect.selectedIndex;
    if (plotType == 3) computeCurl(); 
    for (var y = 0; y < ydim; y++) {
        for (var x = 0; x < xdim; x++) {
            var i = x + y * xdim;
            var ci = 0;
            if (barrier[i] === 1 || y === 0 || y === ydim - 1) { ci = nColors + 1; }
            else {
                if (plotType == 0) {
                    ci = Math.round(nColors * (ux[i] * 2 * contrast + 0.5));
                } else if (plotType == 1) {
                    ci = Math.round(nColors * (uy[i] * 2 * contrast + 0.5));
                } else if (plotType == 2) { 
                    var speedSq = ux[i]*ux[i] + uy[i]*uy[i];
                    var speed = Math.sqrt(speedSq); 
                    ci = Math.round(nColors * (speed * 4 * contrast)); 
                } else if (plotType == 3) {
                    ci = Math.round(nColors * (curl[i] * 5 * contrast + 0.5));
                }
                if (ci < 0) ci = 0; if (ci > nColors) ci = nColors;
            }
            colorSquare(x, y, redList[ci], greenList[ci], blueList[ci]);
        }
    }
    context.putImageData(image, 0, 0);
    if (tracerCheck.checked) drawTracers();
    if (sensorCheck.checked) drawSensor();
}

function colorSquare(x, y, r, g, b) {
    var fy = ydim - y - 1;
    for (var py = fy * pxPerSquare; py < (fy + 1) * pxPerSquare; py++) {
        for (var px = x * pxPerSquare; px < (x + 1) * pxPerSquare; px++) {
            var i = (px + py * image.width) * 4; image.data[i] = r; image.data[i+1] = g; image.data[i+2] = b;
        }
    }
}

function computeCurl() {
    for (var y = 1; y < ydim - 1; y++)
        for (var x = 1; x < xdim - 1; x++)
            curl[x + y * xdim] = uy[x+1+y*xdim] - uy[x-1+y*xdim] - ux[x+(y+1)*xdim] + ux[x+(y-1)*xdim];
}

function drawTracers() {
    for (var t = 0; t < nTracers; t++) {
        var cx = (tracerX[t] + 0.5) * pxPerSquare; 
        var cy = canvas.height - (tracerY[t] + 0.5) * pxPerSquare;
        context.beginPath();
        context.arc(cx, cy, 2.5, 0, 2 * Math.PI);
        context.fillStyle = "white";
        context.fill();
        context.lineWidth = 1;
        context.strokeStyle = "black";
        context.stroke();
    }
}

function drawSensor() {
    var cx = (sensorX + 0.5) * pxPerSquare; var cy = canvas.height - (sensorY + 0.5) * pxPerSquare;
    context.strokeStyle = "white"; context.beginPath(); context.arc(cx, cy, 5, 0, 2*Math.PI); context.stroke();
    var i = sensorX + sensorY * xdim;
    context.fillStyle = "white"; context.font = "10px Monospace";
    context.fillText("ux:" + Number(ux[i]).toFixed(3) + " uy:" + Number(uy[i]).toFixed(3), cx + 10, cy - 10);
}

canvas.addEventListener('mousedown', function(e) {
    mouseIsDown = true; var r = canvas.getBoundingClientRect();
    var mx = e.clientX - r.left; var my = e.clientY - r.top;
    if (sensorCheck.checked) {
        var gl = canvasToGrid(mx, my); var dx = (gl.x - sensorX)*pxPerSquare; var dy = (gl.y - sensorY)*pxPerSquare;
        if (Math.sqrt(dx*dx+dy*dy) <= 10) draggingSensor = true;
    }
    mouseX = mx; mouseY = my;
});
window.addEventListener('mouseup', function() { mouseIsDown = false; draggingSensor = false; });
canvas.addEventListener('mousemove', function(e) {
    var r = canvas.getBoundingClientRect(); mouseX = e.clientX - r.left; mouseY = e.clientY - r.top;
    if (mouseIsDown && draggingSensor) { var gl = canvasToGrid(mouseX, mouseY); sensorX = gl.x; sensorY = gl.y; paintCanvas(); }
});

function canvasToGrid(cx, cy) { return { x: Math.floor(cx/pxPerSquare), y: Math.floor((canvas.height-1-cy)/pxPerSquare) }; }
function startStop() { running = !running; startButton.value = running ? "Pause" : "Start"; if (running) { startTime = (new Date()).getTime(); stepCount = 0; simulate(); } }
function resetTimer() { stepCount = 0; startTime = (new Date()).getTime(); }
function adjustSpeed() { speedValue.innerHTML = Number(speedSlider.value).toFixed(3); }
function adjustViscosity() { viscValue.innerHTML = Number(viscSlider.value).toFixed(3); }

setupArrays();
window.requestAnimFrame = window.requestAnimationFrame || function(c){ window.setTimeout(c, 1); };
initFluid();
changeObstacle(); 

// Vite Global Scoping
window.startStop = startStop;
window.initFluid = initFluid;
window.changeResolution = changeResolution;
window.changeObstacle = changeObstacle;
window.adjustSpeed = adjustSpeed;
window.adjustViscosity = adjustViscosity;
window.paintCanvas = paintCanvas;
window.resetTimer = resetTimer;
window.initTracers = initTracers;