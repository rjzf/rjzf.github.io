/*
	Copyright 2013, Daniel V. Schroeder

	Permission is hereby granted, free of charge, to any person obtaining a copy of 
	this software and associated data and documentation (the "Software"), to deal in 
	the Software without restriction, including without limitation the rights to 
	use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies 
	of the Software, and to permit persons to whom the Software is furnished to do 
	so, subject to the following conditions:

	The above copyright notice and this permission notice shall be included in all 
	copies or substantial portions of the Software.

	THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, 
	INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A 
	PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR 
	ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR 
	OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR 
	OTHER DEALINGS IN THE SOFTWARE.

	Except as contained in this notice, the name of the author shall not be used in 
	advertising or otherwise to promote the sale, use or other dealings in this 
	Software without prior written authorization.

*/

//////////////////////////////
////// Global variables //////
//////////////////////////////	

// Create canvas area
var canvas = document.getElementById('theCanvas');
var context = canvas.getContext('2d');

// for direct pixel manipulation (faster than fillRect)
var image = context.createImageData(canvas.width, canvas.height);
// set all alpha values to opaque
for (var i = 3; i < image.data.length; i += 4) image.data[i] = 255;

// Width of plot in pixels (Fixed at 3 because it allows decent clarity and speed)
var pxPerSquare = 3;

// Define grid
var xdim = canvas.width / pxPerSquare;
var ydim = canvas.height / pxPerSquare;

// HTML element values  
var stepsSlider = document.getElementById('stepsSlider');
var startButton = document.getElementById('startButton');
var speedSlider = document.getElementById('speedSlider');
var speedValue = document.getElementById('speedValue');
var viscSlider = document.getElementById('viscSlider');
var viscValue = document.getElementById('viscValue');
var mouseSelect = document.getElementById('mouseSelect');
var plotSelect = document.getElementById('plotSelect');
var contrastSlider = document.getElementById('contrastSlider');
var dragCheck = document.getElementById('dragCheck');  // Allow for fluid dragging, fixes issue of tracer dragging and fluid dragging simultaneously
var tracerCheck = document.getElementById('tracerCheck');
var sensorCheck = document.getElementById('sensorCheck');
var dataCheck = document.getElementById('dataCheck');
var rafCheck = document.getElementById('rafCheck');
var speedReadout = document.getElementById('speedReadout');
var dataSection = document.getElementById('dataSection');
var dataArea = document.getElementById('dataArea');
var dataButton = document.getElementById('dataButton');

// True when running
var running = false;

// Establish Counts
var stepCount = 0;
var startTime = 0;

// Numerical abbreviations 
var four9ths = 4.0 / 9.0;
var one9th = 1.0 / 9.0;
var one36th = 1.0 / 36.0;

// Various declarations
var barrierCount = 0;
var barrierxSum = 0;
var barrierySum = 0;
var barrierFx = 0.0;		     // total force on all barrier sites
var barrierFy = 0.0;
var sensorX = xdim / 2;	     // coordinates of "sensor" to measure local fluid properties	
var sensorY = ydim / 2;
var draggingSensor = false;
var mouseIsDown = false;
var collectingData = false;
var time = 0;				 // time (in simulation step units) since data collection started
var showingPeriod = false;
var lastBarrierFy = 1;				 // for determining when F_y oscillation begins
var lastFyOscTime = 0;				 // for calculating F_y oscillation period
var LineCount = 0;              // operator for creating pipe walls
var mouseX, mouseY;					 // mouse location in canvas coordinates
var oldMouseX = -1, oldMouseY = -1;	 // mouse coordinates from previous simulation frame

/////////////////////////////
//////// Main Script ////////
/////////////////////////////	

canvas.addEventListener('mousedown', mouseDown, false);
canvas.addEventListener('mousemove', mouseMove, false);
document.body.addEventListener('mouseup', mouseUp, false);	// button release could occur outside canvas
canvas.addEventListener('touchstart', mouseDown, false);
canvas.addEventListener('touchmove', mouseMove, false);
document.body.addEventListener('touchend', mouseUp, false);

// Create the arrays of fluid particle densities, etc. (using 1D arrays for speed):
// To index into these arrays, use x + y*xdim, traversing rows first and then columns.
var n0 = new Array(xdim * ydim);		// microscopic densities along each lattice direction
var nN = new Array(xdim * ydim);
var nS = new Array(xdim * ydim);
var nE = new Array(xdim * ydim);
var nW = new Array(xdim * ydim);
var nNE = new Array(xdim * ydim);
var nSE = new Array(xdim * ydim);
var nNW = new Array(xdim * ydim);
var nSW = new Array(xdim * ydim);
var rho = new Array(xdim * ydim);	// macroscopic density
var ux = new Array(xdim * ydim);	// macroscopic velocity
var uy = new Array(xdim * ydim);
var curl = new Array(xdim * ydim);
var barrier = new Array(xdim * ydim); // boolean array of barrier locations

// Initialize to a steady rightward flow with no barriers:
for (var y = 0; y < ydim; y++) {
    for (var x = 1; x < xdim; x++) {
        barrier[x + y * xdim] = false;
    }
}

// Create barrier around the top and bottom edges to simulate a pipe
for (var x = 0; x < xdim; x++) {

    while (LineCount <= 7) {  // Change value to make the "wall" thicker or thinner
        barrier[x + LineCount * xdim] = true;
        barrier[xdim * ydim - x - 1 - LineCount * xdim] = true;
        LineCount++
    }
    LineCount = 0
}

// Set up the array of colors for plotting (mimicks matplotlib "jet" colormap):
// (Kludge: Index nColors+1 labels the color used for drawing barriers.)
var nColors = 400;							// there are actually nColors+2 colors
var hexColorList = new Array(nColors + 2);
var redList = new Array(nColors + 2);
var greenList = new Array(nColors + 2);
var blueList = new Array(nColors + 2);
for (var c = 0; c <= nColors; c++) {
    var r, g, b;
    if (c < nColors / 8) {
        r = 0; g = 0; b = Math.round(255 * (c + nColors / 8) / (nColors / 4));
    } else if (c < 3 * nColors / 8) {
        r = 0; g = Math.round(255 * (c - nColors / 8) / (nColors / 4)); b = 255;
    } else if (c < 5 * nColors / 8) {
        r = Math.round(255 * (c - 3 * nColors / 8) / (nColors / 4)); g = 255; b = 255 - r;
    } else if (c < 7 * nColors / 8) {
        r = 255; g = Math.round(255 * (7 * nColors / 8 - c) / (nColors / 4)); b = 0;
    } else {
        r = Math.round(255 * (9 * nColors / 8 - c) / (nColors / 4)); g = 0; b = 0;
    }
    redList[c] = r; greenList[c] = g; blueList[c] = b;
    hexColorList[c] = rgbToHex(r, g, b);
}
redList[nColors + 1] = 64; greenList[nColors + 1] = 64; blueList[nColors + 1] = 64;	// Barriers are dark gray
hexColorList[nColors + 1] = rgbToHex(0, 0, 0);

// Functions to convert rgb to hex color string (from stackoverflow):
function componentToHex(c) {
    var hex = c.toString(16);
    return hex.length == 1 ? "0" + hex : hex;
}
function rgbToHex(r, g, b) {
    return "#" + componentToHex(r) + componentToHex(g) + componentToHex(b);
}

// Initialize array of partially transparant blacks, for drawing flow lines:
var transBlackArraySize = 50;
var transBlackArray = new Array(transBlackArraySize);
for (var i = 0; i < transBlackArraySize; i++) {
    transBlackArray[i] = "rgba(0,0,0," + Number(i / transBlackArraySize).toFixed(2) + ")";
}

// Initialize tracers (but don't place them yet):
var nTracers = 100;
var tracerX = new Array(nTracers);
var tracerY = new Array(nTracers);
for (var t = 0; t < nTracers; t++) {
    tracerX[t] = 0.0; tracerY[t] = 0.0;
}

initFluid();		// initialize to steady rightward flow

// Mysterious gymnastics that are apparently useful for better cross-browser animation timing:
window.requestAnimFrame = (function (callback) {
    return window.requestAnimationFrame ||
        window.webkitRequestAnimationFrame ||
        window.mozRequestAnimationFrame ||
        window.oRequestAnimationFrame ||
        window.msRequestAnimationFrame ||
        function (callback) {
            window.setTimeout(callback, 1);		// second parameter is time in ms
        };
})();

/////////////////////////////
///////// Functions /////////
/////////////////////////////	

// Simulate function executes a bunch of steps and then schedules another call to itself:
function simulate() {
    var stepsPerFrame = Number(stepsSlider.value);			// number of simulation steps per animation frame
    setBoundaries();
    // Test to see if we're dragging the fluid:
    var pushing = false;
    var pushX, pushY, pushUX, pushUY; 
    if (mouseIsDown && dragCheck.checked && draggingSensor == false) {    // draggingSensor check gets rid of dragging fluid bug
        if (oldMouseX >= 0) {
            var gridLoc = canvasToGrid(mouseX, mouseY);
            pushX = gridLoc.x;
            pushY = gridLoc.y;
            pushUX = (mouseX - oldMouseX) / pxPerSquare / stepsPerFrame;
            pushUY = -(mouseY - oldMouseY) / pxPerSquare / stepsPerFrame; // y axis is flipped
            if (Math.abs(pushUX) > 0.1) pushUX = 0.1 * Math.abs(pushUX) / pushUX;
            if (Math.abs(pushUY) > 0.1) pushUY = 0.1 * Math.abs(pushUY) / pushUY;
            pushing = true;
        }
        oldMouseX = mouseX; oldMouseY = mouseY;
    } else {
        oldMouseX = -1; oldMouseY = -1;
    }
    // Execute a bunch of time steps:
    for (var step = 0; step < stepsPerFrame; step++) {
        collide();
        stream();
        if (tracerCheck.checked) moveTracers();
        if (pushing) push(pushX, pushY, pushUX, pushUY);
        time++;
        if (showingPeriod && (barrierFy > 0) && (lastBarrierFy <= 0)) {
            var thisFyOscTime = time - barrierFy / (barrierFy - lastBarrierFy);	// interpolate when Fy changed sign
            if (lastFyOscTime > 0) {
                var period = thisFyOscTime - lastFyOscTime;
                dataArea.innerHTML += Number(period).toFixed(2) + "\n";
                dataArea.scrollTop = dataArea.scrollHeight;
            }
            lastFyOscTime = thisFyOscTime;
        }
        lastBarrierFy = barrierFy;
    }
    paintCanvas();
    if (collectingData) {
        writeData();
        if (time >= 10000) startOrStopData();
    }
    if (running) {
        stepCount += stepsPerFrame;
        var elapsedTime = ((new Date()).getTime() - startTime) / 1000;	// time in seconds
        speedReadout.innerHTML = Number(stepCount / elapsedTime).toFixed(0);
    }
    var stable = true;
    for (var x = 0; x < xdim; x++) {
        var index = x + (ydim / 2) * xdim;	// look at middle row only
        if (rho[index] <= 0) stable = false;
    }
    if (!stable) {
        window.alert("The simulation has become unstable due to excessive fluid speeds.");
        startStop();
        initFluid();
    }
    if (running) {
        if (rafCheck.checked) {
            requestAnimFrame(function () { simulate(); });	// let browser schedule next frame
        } else {
            window.setTimeout(simulate, 1);	// schedule next frame asap (nominally 1 ms but always more)
        }
    }
}

// Set the fluid variables at the boundaries, according to the current slider value:
function setBoundaries() {
    var u0 = Number(speedSlider.value);
    for (var x = 0; x < xdim; x++) {
        setEquil(x, 0, u0, 0, 1);
        setEquil(x, ydim - 1, u0, 0, 1);
    }
    for (var y = 1; y < ydim - 1; y++) {
        setEquil(0, y, u0, 0, 1);
        setEquil(xdim - 1, y, u0, 0, 1);
    }
}

// Collide particles within each cell (here's the physics!):
function collide() {
    var viscosity = Number(viscSlider.value);	// kinematic viscosity coefficient in natural units
    var omega = 1 / (3 * viscosity + 0.5);		// reciprocal of relaxation time
    for (var y = 1; y < ydim - 1; y++) {
        for (var x = 1; x < xdim - 1; x++) {
            var i = x + y * xdim;		// array index for this lattice site
            var thisrho = n0[i] + nN[i] + nS[i] + nE[i] + nW[i] + nNW[i] + nNE[i] + nSW[i] + nSE[i];
            rho[i] = thisrho;
            var thisux = (nE[i] + nNE[i] + nSE[i] - nW[i] - nNW[i] - nSW[i]) / thisrho;
            ux[i] = thisux;
            var thisuy = (nN[i] + nNE[i] + nNW[i] - nS[i] - nSE[i] - nSW[i]) / thisrho;
            uy[i] = thisuy
            var one9thrho = one9th * thisrho;		// pre-compute a bunch of stuff for optimization
            var one36thrho = one36th * thisrho;
            var ux3 = 3 * thisux;
            var uy3 = 3 * thisuy;
            var ux2 = thisux * thisux;
            var uy2 = thisuy * thisuy;
            var uxuy2 = 2 * thisux * thisuy;
            var u2 = ux2 + uy2;
            var u215 = 1.5 * u2;

            // Each node is computed for the iteration, and each node affects its neighboring node
            n0[i] += omega * (four9ths * thisrho * (1 - u215) - n0[i]);
            nE[i] += omega * (one9thrho * (1 + ux3 + 4.5 * ux2 - u215) - nE[i]);
            nW[i] += omega * (one9thrho * (1 - ux3 + 4.5 * ux2 - u215) - nW[i]);
            nN[i] += omega * (one9thrho * (1 + uy3 + 4.5 * uy2 - u215) - nN[i]);
            nS[i] += omega * (one9thrho * (1 - uy3 + 4.5 * uy2 - u215) - nS[i]);
            nNE[i] += omega * (one36thrho * (1 + ux3 + uy3 + 4.5 * (u2 + uxuy2) - u215) - nNE[i]);
            nSE[i] += omega * (one36thrho * (1 + ux3 - uy3 + 4.5 * (u2 - uxuy2) - u215) - nSE[i]);
            nNW[i] += omega * (one36thrho * (1 - ux3 + uy3 + 4.5 * (u2 - uxuy2) - u215) - nNW[i]);
            nSW[i] += omega * (one36thrho * (1 - ux3 - uy3 + 4.5 * (u2 + uxuy2) - u215) - nSW[i]);
        }
    }
    for (var y = 1; y < ydim - 2; y++) {
        nW[xdim - 1 + y * xdim] = nW[xdim - 2 + y * xdim];   // at right end, copy left-flowing densities from next row to the left
        nNW[xdim - 1 + y * xdim] = nNW[xdim - 2 + y * xdim];
        nSW[xdim - 1 + y * xdim] = nSW[xdim - 2 + y * xdim];
    }
}

// Move particles along their directions of motion:
function stream() {

    for (var y = ydim - 2; y > 0; y--) {			     // first start in NW corner...
        for (var x = 1; x < xdim - 1; x++) {
            nN[x + y * xdim] = nN[x + (y - 1) * xdim];	 // move the north-moving particles
            nNW[x + y * xdim] = nNW[x + 1 + (y - 1) * xdim]; // and the northwest-moving particles
        }
    }
    for (var y = ydim - 2; y > 0; y--) {			     // now start in NE corner...
        for (var x = xdim - 2; x > 0; x--) {
            nE[x + y * xdim] = nE[x - 1 + y * xdim];		 // move the east-moving particles
            nNE[x + y * xdim] = nNE[x - 1 + (y - 1) * xdim]; // and the northeast-moving particles
        }
    }
    for (var y = 1; y < ydim - 1; y++) {			     // now start in SE corner...
        for (var x = xdim - 2; x > 0; x--) {
            nS[x + y * xdim] = nS[x + (y + 1) * xdim];	 // move the south-moving particles
            nSE[x + y * xdim] = nSE[x - 1 + (y + 1) * xdim]; // and the southeast-moving particles
        }
    }
    for (var y = 1; y < ydim - 1; y++) {    	         // now start in the SW corner...
        for (var x = 1; x < xdim - 1; x++) {
            nW[x + y * xdim] = nW[x + 1 + y * xdim];		 // move the west-moving particles
            nSW[x + y * xdim] = nSW[x + 1 + (y + 1) * xdim]; // and the southwest-moving particles
        }
    }
    for (var y = 1; y < ydim - 1; y++) {				 // Now handle bounce-back from barriers
        for (var x = 1; x < xdim - 1; x++) {
            if (barrier[x + y * xdim]) {
                var index = x + y * xdim;
                nE[x + 1 + y * xdim] = nW[index];
                nW[x - 1 + y * xdim] = nE[index];
                nN[x + (y + 1) * xdim] = nS[index];
                nS[x + (y - 1) * xdim] = nN[index];
                nNE[x + 1 + (y + 1) * xdim] = nSW[index];
                nNW[x - 1 + (y + 1) * xdim] = nSE[index];
                nSE[x + 1 + (y - 1) * xdim] = nNW[index];
                nSW[x - 1 + (y - 1) * xdim] = nNE[index];
            }
        }
    }
}

// Move the tracer particles:
function moveTracers() {
    for (var t = 0; t < nTracers; t++) {
        var roundedX = Math.round(tracerX[t]);
        var roundedY = Math.round(tracerY[t]);
        var index = roundedX + roundedY * xdim;
        tracerX[t] += ux[index];
        tracerY[t] += uy[index];
        if (tracerX[t] > xdim - 1) {
            tracerX[t] = 0;
            tracerY[t] = (Math.random() * (0.9 - 0.09) + 0.09) * ydim;
        }
    }
}

// "Drag" the fluid in a direction determined by the mouse (or touch) motion:
// (The drag affects a "circle", 5 px in diameter, centered on the given coordinates.)
function push(pushX, pushY, pushUX, pushUY) {
    // First make sure we're not too close to edge:
    var margin = 3;
    if ((pushX > margin) && (pushX < xdim - 1 - margin) && (pushY > margin) && (pushY < ydim - 1 - margin)) {
        for (var dx = -1; dx <= 1; dx++) {
            setEquil(pushX + dx, pushY + 2, pushUX, pushUY);
            setEquil(pushX + dx, pushY - 2, pushUX, pushUY);
        }
        for (var dx = -2; dx <= 2; dx++) {
            for (var dy = -1; dy <= 1; dy++) {
                setEquil(pushX + dx, pushY + dy, pushUX, pushUY);
            }
        }
    }
}

// Set all densities in a cell to their equilibrium values for a given velocity and density:
// (If density is omitted, it's left unchanged.)
function setEquil(x, y, newux, newuy, newrho) {
    var i = x + y * xdim;
    if (typeof newrho == 'undefined') {
        newrho = rho[i];
    }
    var ux3 = 3 * newux;
    var uy3 = 3 * newuy;
    var ux2 = newux * newux;
    var uy2 = newuy * newuy;
    var uxuy2 = 2 * newux * newuy;
    var u2 = ux2 + uy2;
    var u215 = 1.5 * u2;
    n0[i] = four9ths * newrho * (1 - u215);
    nE[i] = one9th * newrho * (1 + ux3 + 4.5 * ux2 - u215);
    nW[i] = one9th * newrho * (1 - ux3 + 4.5 * ux2 - u215);
    nN[i] = one9th * newrho * (1 + uy3 + 4.5 * uy2 - u215);
    nS[i] = one9th * newrho * (1 - uy3 + 4.5 * uy2 - u215);
    nNE[i] = one36th * newrho * (1 + ux3 + uy3 + 4.5 * (u2 + uxuy2) - u215);
    nSE[i] = one36th * newrho * (1 + ux3 - uy3 + 4.5 * (u2 - uxuy2) - u215);
    nNW[i] = one36th * newrho * (1 - ux3 + uy3 + 4.5 * (u2 - uxuy2) - u215);
    nSW[i] = one36th * newrho * (1 - ux3 - uy3 + 4.5 * (u2 + uxuy2) - u215);
    rho[i] = newrho;
    ux[i] = newux;
    uy[i] = newuy;
}

// Initialize the tracer particles:
function initTracers() {
    if (tracerCheck.checked) {
        var nRows = Math.ceil(Math.sqrt(nTracers));
        var dx = xdim / nRows;
        var dy = ydim / nRows + 10;
        var nextX = dx / 2;
        var nextY = dy / 2;
        for (var t = 0; t < nTracers; t++) {
            tracerX[t] = nextX;
            tracerY[t] = nextY;
            nextX += dx;
            if (nextX > xdim) {
                nextX = dx / 2;
                nextY += dy;
            }
        }
    }
    paintCanvas();
}

// Draw the desired graphical plot
function paintCanvas() {

    var cIndex = 0;
    var contrast = Math.pow(1.2, Number(contrastSlider.value));
    var plotType = plotSelect.selectedIndex;

    if (plotType == 4) computeCurl();
    for (var y = 0; y < ydim; y++) {
        for (var x = 0; x < xdim; x++) {
            if (barrier[x + y * xdim]) {
                cIndex = nColors + 1;	// kludge for barrier color which isn't really part of color map
            } else {
                switch (plotSelect.selectedIndex) {
                    default:
                        cIndex = Math.round(nColors * (curl[x + y * xdim] * 5 * contrast + 0.5));
                        break;
                    case 0:
                        cIndex = Math.round(nColors * (ux[x + y * xdim] * 2 * contrast + 0.5));
                        break;
                    case 1:
                        cIndex = Math.round(nColors * (uy[x + y * xdim] * 2 * contrast + 0.5));
                        break;
                    case 2:
                        var speed = Math.sqrt(ux[x + y * xdim] * ux[x + y * xdim] + uy[x + y * xdim] * uy[x + y * xdim]);
                        cIndex = Math.round(nColors * (speed * 4 * contrast));
                }
                if (cIndex < 0) cIndex = 0;
                if (cIndex > nColors) cIndex = nColors;
            }
            colorSquare(x, y, redList[cIndex], greenList[cIndex], blueList[cIndex]);
        }
    }

    context.putImageData(image, 0, 0);		// blast image to the screen

    // Draw tracers, force vector, and/or sensor if appropriate:
    if (tracerCheck.checked) drawTracers();
    if (sensorCheck.checked) drawSensor();
}

// Color a grid square in the image data array, one pixel at a time (rgb each in range 0 to 255):
function colorSquare(x, y, r, g, b) {
    var flippedy = ydim - y - 1;			// put y=0 at the bottom
    for (var py = flippedy * pxPerSquare; py < (flippedy + 1) * pxPerSquare; py++) {
        for (var px = x * pxPerSquare; px < (x + 1) * pxPerSquare; px++) {
            var index = (px + py * image.width) * 4;
            image.data[index + 0] = r;
            image.data[index + 1] = g;
            image.data[index + 2] = b;
        }
    }
}

// Compute the curl (actually times 2) of the macroscopic velocity field, for plotting
function computeCurl() {
    for (var y = 1; y < ydim - 1; y++) {			// interior sites only; leave edges set to zero
        for (var x = 1; x < xdim - 1; x++) {
            curl[x + y * xdim] = uy[x + 1 + y * xdim] - uy[x - 1 + y * xdim] - ux[x + (y + 1) * xdim] + ux[x + (y - 1) * xdim];
        }
    }
}

// Draw the tracer particles:
function drawTracers() {
    context.fillStyle = "rgb(0,0,50)";
    for (var t = 0; t < nTracers; t++) {
        var canvasX = (tracerX[t] + 0.5) * pxPerSquare;
        var canvasY = canvas.height - (tracerY[t] + 0.5) * pxPerSquare;
        context.fillRect(canvasX - 1, canvasY - 1, 2, 2);
    }
}

// Draw the sensor and its associated data display:
function drawSensor() {
    var canvasX = (sensorX + 0.5) * pxPerSquare;
    var canvasY = canvas.height - (sensorY + 0.5) * pxPerSquare;
    context.fillStyle = "rgba(180,180,180,0.7)";	// first draw gray filled circle
    context.beginPath();
    context.arc(canvasX, canvasY, 7, 0, 2 * Math.PI);
    context.fill();
    context.strokeStyle = "#404040";				// next draw cross-hairs
    context.linewidth = 1;
    context.beginPath();
    context.moveTo(canvasX, canvasY - 10);
    context.lineTo(canvasX, canvasY + 10);
    context.moveTo(canvasX - 10, canvasY);
    context.lineTo(canvasX + 10, canvasY);
    context.stroke();
    context.fillStyle = "rgba(255,255,255,0.5)";	// draw rectangle behind text
    canvasX += 10;
    context.font = "12px Monospace";
    var rectWidth = context.measureText("00000000000").width + 6;
    var rectHeight = 44;
    if (canvasX + rectWidth > canvas.width) canvasX -= (rectWidth + 20);
    if (canvasY + rectHeight > canvas.height) canvasY = canvas.height - rectHeight;
    context.fillRect(canvasX, canvasY, rectWidth, rectHeight);
    context.fillStyle = "#000000";					// finally draw the text
    canvasX += 3;
    canvasY += 12;
    var coordinates = "  (" + sensorX + "," + sensorY + ")";
    context.fillText(coordinates, canvasX, canvasY);
    canvasY += 14;

    var index = sensorX + sensorY * xdim;
    var digitString = Number(ux[index]).toFixed(3);
    if (ux[index] >= 0) digitString = " " + digitString;
    context.fillText("ux = " + digitString, canvasX, canvasY);
    canvasY += 14;
    digitString = Number(uy[index]).toFixed(3);
    if (uy[index] >= 0) digitString = " " + digitString;
    context.fillText("uy = " + digitString, canvasX, canvasY);
}

// Functions to handle mouse/touch interaction:
function mouseDown(e) {
    if (sensorCheck.checked) {
        var canvasLoc = pageToCanvas(e.pageX, e.pageY);
        var gridLoc = canvasToGrid(canvasLoc.x, canvasLoc.y);
        var dx = (gridLoc.x - sensorX) * pxPerSquare;
        var dy = (gridLoc.y - sensorY) * pxPerSquare;
        if (Math.sqrt(dx * dx + dy * dy) <= 8) {
            draggingSensor = true;
        }
    }
    mousePressDrag(e);
};
function mouseMove(e) {
    if (mouseIsDown) {
        mousePressDrag(e);
    }
};
function mouseUp(e) {
    mouseIsDown = false;
    draggingSensor = false;
};

// Handle mouse press or drag:
function mousePressDrag(e) {
    e.preventDefault();
    mouseIsDown = true;
    var canvasLoc = pageToCanvas(e.pageX, e.pageY);
    if (draggingSensor) {
        var gridLoc = canvasToGrid(canvasLoc.x, canvasLoc.y);
        sensorX = gridLoc.x;
        sensorY = gridLoc.y;
        paintCanvas();
        return;
    }
    else {
        mouseX = canvasLoc.x;
        mouseY = canvasLoc.y;
        return;
    }
}

// Convert page coordinates to canvas coordinates:
function pageToCanvas(pageX, pageY) {
    var canvasX = pageX - canvas.offsetLeft;
    var canvasY = pageY - canvas.offsetTop;
    // this simple subtraction may not work when the canvas is nested in other elements
    return { x: canvasX, y: canvasY };
}

// Convert canvas coordinates to grid coordinates:
function canvasToGrid(canvasX, canvasY) {
    var gridX = Math.floor(canvasX / pxPerSquare);
    var gridY = Math.floor((canvas.height - 1 - canvasY) / pxPerSquare); 	// off by 1?
    return { x: gridX, y: gridY };
}


// Function to initialize or re-initialize the fluid, based on speed slider setting:
function initFluid() {
    // Amazingly, if I nest the y loop inside the x loop, Firefox slows down by a factor of 20
    var u0 = Number(speedSlider.value);
    for (var y = 0; y < ydim; y++) {
        for (var x = 0; x < xdim; x++) {
            setEquil(x, y, u0, 0, 1);
            curl[x + y * xdim] = 0.0;
        }
    }
    paintCanvas();
}

// Function to start or pause the simulation:
function startStop() {
    running = !running;
    if (running) {
        startButton.value = "Pause";
        resetTimer();
        simulate();
    } else {
        startButton.value = " Run ";
    }
}

// Reset the timer that handles performance evaluation:
function resetTimer() {
    stepCount = 0;
    startTime = (new Date()).getTime();
}

// Show value of flow speed setting:
function adjustSpeed() {
    speedValue.innerHTML = Number(speedSlider.value).toFixed(3);
}

// Show value of viscosity:
function adjustViscosity() {
    viscValue.innerHTML = Number(viscSlider.value).toFixed(3);
}