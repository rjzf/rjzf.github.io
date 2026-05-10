import { EulerSolver } from './shock-physics.js';
import { ShockVisuals } from './shock-visuals.js';

export function initShockTube() {
    // Only run this if we are actually on the shock tube page
    if (!document.getElementById('xtCanvas')) return;

    const runBtn = document.getElementById('runButton');
    const visualizer = new ShockVisuals();
    let solver = null;

    /**
     * Reads the top numerical and boundary conditions
     */
    function buildConfig() {
        return {
            gridCells: parseInt(document.getElementById('gridCells').value) || 500,
            cflNumber: parseFloat(document.getElementById('cflNumber').value) || 0.8,
            maxTime: parseFloat(document.getElementById('maxTime').value) || 0.2,
            snapshotInterval: parseFloat(document.getElementById('snapshotInterval').value) || 0.005,
            leftBoundary: document.getElementById('leftBoundary').value,
            rightBoundary: document.getElementById('rightBoundary').value,
            unitSystem: document.getElementById('unitSystem').value // Pass unit system for Temp calculation
        };
    }

    /**
     * Reads the dynamic material sections (slabs)
     */
    function buildSlabs() {
        const slabs = [];
        document.querySelectorAll('.slab-container').forEach(container => {
            const idStr = container.id.split('-')[1];
            slabs.push({
                length: parseFloat(document.getElementById(`secLength-${idStr}`).value),
                gamma: parseFloat(document.getElementById(`secGamma-${idStr}`).value),
                mw: parseFloat(document.getElementById(`secMW-${idStr}`).value),
                pressure: parseFloat(document.getElementById(`secPressure-${idStr}`).value),
                density: parseFloat(document.getElementById(`secDensity-${idStr}`).value),
                velocity: parseFloat(document.getElementById(`secVelocity-${idStr}`).value),
                name: document.getElementById(`secGas-${idStr}`).options[document.getElementById(`secGas-${idStr}`).selectedIndex].text
            });
        });
        return slabs;
    }

    /**
     * The single action function: Computes math and renders visuals
     */
    function runSimulation() {
        const config = buildConfig();
        const slabs = buildSlabs();
        
        // 1. Initialize the Engine
        solver = new EulerSolver(config);
        solver.initialize(slabs);
        
        // 2. Compute the entire history up front (Instantly)
        solver.runFullSimulation();
        
        // 3. Pass pre-computed data to the visualizer
        visualizer.setData(solver.history, solver.x, solver.tracers, config);
        
        // 4. Default the view to the final state of the simulation
        visualizer.currentTimeIndex = solver.history.length - 1;
        
        // 5. Render everything
        visualizer.renderAll();
    }

    // Main Event Listener
    runBtn.addEventListener('click', runSimulation);

    // Visual Setting Listeners: Update graphs instantly without re-running math
    const liveUpdateIds = ['xtColormap', 'xtVariable', 'showTracker', 'trackerColor', 'unitSystem'];
    liveUpdateIds.forEach(id => {
        document.getElementById(id)?.addEventListener('change', () => {
            if (solver) {
                // If units changed, we need to refresh the coordinate bounds
                if (id === 'unitSystem') visualizer.calculateBounds();
                visualizer.renderAll();
            }
        });
    });

    // --- EXPORTS ---
    document.getElementById('exportXTBtn')?.addEventListener('click', () => {
        if (!solver) return;
        
        // Added Temperature to the CSV Header
        let csv = "Time(s),Position(m),Density,Velocity,Pressure,Temperature\n";
        
        solver.history.forEach(snap => {
            for(let i=0; i<snap.rho.length; i++){
                // Added snap.T to the row output
                csv += `${snap.t.toFixed(4)},${solver.x[i].toFixed(4)},${snap.rho[i].toFixed(4)},${snap.u[i].toFixed(4)},${snap.p[i].toFixed(4)},${(snap.T ? snap.T[i] : 0).toFixed(4)}\n`;
            }
        });
        downloadFile(csv, "xt_heatmap_data.csv");
    });

    document.getElementById('exportTracerBtn')?.addEventListener('click', () => {
        if (!solver) return;
        let csv = "TracerID,Time(s),Position(m)\n";
        solver.tracers.forEach((tracer, idx) => {
            tracer.path.forEach(p => {
                csv += `${idx+1},${p.t.toFixed(4)},${p.x.toFixed(4)}\n`;
            });
        });
        downloadFile(csv, "tracer_data.csv");
    });

    document.getElementById('exportPngBtn')?.addEventListener('click', () => {
        const canvas = document.getElementById('xtCanvas');
        const a = document.createElement('a');
        a.href = canvas.toDataURL('image/png');
        a.download = "xt_diagram.png";
        a.click();
    });

    function downloadFile(content, filename) {
        const blob = new Blob([content], { type: 'text/csv' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
    }

    // Run simulation once on page load to show the default initial state
    runSimulation();
}