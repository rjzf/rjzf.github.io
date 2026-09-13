import { fieldError } from './view-utils.js';
import { ShockVisuals } from './shock-visuals.js';
import {
    SOLVER_VERSION,
    Ru,
    MAX_MATERIALS,
    MEMORY_WARNING,
    MEMORY_ACKNOWLEDGEMENT,
    estimateResources,
    unitSystems,
    unitLabel,
    getGasConstant,
    readNumber,
    positiveNumber,
    validateGas,
    validateConfig,
    toInternalSlabs,
    calculateMixture
} from './shock-physics.js';

// Page controls and run lifecycle.
// Connect page controls and start the default run.
export function initShockTube() {
    if (!document.getElementById('xtCanvas')) return;
    const runBtn = document.getElementById('runButton');
    const cancelBtn = document.getElementById('cancelButton');
    const status = document.getElementById('runStatus');
    const progress = document.getElementById('runProgress');
    const acknowledgement = document.getElementById('allowHighMemory');
    const resourceWarning = document.getElementById('resourceWarning');
    const exportIds = ['exportXTBtn', 'exportTracerBtn', 'exportPngBtn'];
    let solver = null,
        worker = null,
        revision = 0,
        lastRunRevision = null,
        busy = false,
        exporting = false;
    let lastProgressAnnouncement = -1;
    let estimates = null, estimateFrame = null, acknowledgedBytes = 0, requiredBytes = 0;
    let exportRequest = null, exportCancelled = false;
    const visualizer = new ShockVisuals();

    // Mark displayed results as belonging to earlier inputs.
    function markChanged(message) {
        revision++;
        if (!exporting) exportRequest = null;
        queueEstimates();
        if (solver)
            status.textContent =
                message ||
                'Inputs changed. The plots and exports still show the last completed run.';
        else if (message) status.textContent = message;
    }

    const ui = initShockUI(markChanged);

    // Show decimal MB without suggesting an exact browser allocation.
    function memoryLabel(bytes) {
        return `≈ ${(bytes / 1e6).toLocaleString(undefined, { maximumFractionDigits: 1 })} MB`;
    }

    // Keep one estimate update for a burst of input events.
    function queueEstimates() {
        if (estimateFrame !== null) return;
        estimateFrame = requestAnimationFrame(() => { estimateFrame = null; updateEstimates(); });
    }

    // Include completed results and canvas buffers in the next-run estimate.
    function updateEstimates() {
        try {
            const config = buildConfig(false), slabs = buildSlabs();
            const retained = solver ? estimateResources(solver.config, solver.config.slabs.length).historyBytes : 0;
            estimates = estimateResources(config, slabs.length, retained, visualizer.memoryBytes());
            document.getElementById('memoryEstimate').textContent = memoryLabel(estimates.runBytes);
            document.getElementById('csvEstimate').textContent = memoryLabel(estimates.csvBytes);
        } catch {
            estimates = null;
            document.getElementById('memoryEstimate').textContent = '—';
            document.getElementById('csvEstimate').textContent = '—';
        }
        requiredBytes = exportRequest?.peakBytes ?? estimates?.runBytes ?? 0;
        const high = requiredBytes > MEMORY_ACKNOWLEDGEMENT;
        if (!high || requiredBytes > acknowledgedBytes) {
            acknowledgement.checked = false;
            acknowledgedBytes = 0;
        }
        document.getElementById('memoryAcknowledgement').hidden = !high;
        const warning = requiredBytes >= MEMORY_WARNING;
        resourceWarning.hidden = !warning;
        const phase = exportRequest ? 'CSV export' : 'This run';
        resourceWarning.textContent = high
            ? `${phase} may use ${memoryLabel(requiredBytes)} of RAM. ${acknowledgement.checked ? 'High memory use acknowledged.' : 'Acknowledge high memory use to continue.'}`
            : warning ? `${phase} may use ${memoryLabel(requiredBytes)} of RAM. Fewer cells or snapshots use less memory.` : '';
        updateButtons();
    }

    acknowledgement.addEventListener('change', () => {
        acknowledgedBytes = acknowledgement.checked ? requiredBytes : 0;
        updateEstimates();
    });

    // Enable controls for the current run and export state.
    function updateButtons() {
        runBtn.disabled = busy || exporting || (estimates?.runBytes > MEMORY_ACKNOWLEDGEMENT && estimates.runBytes > acknowledgedBytes);
        cancelBtn.disabled = !busy && !exporting;
        cancelBtn.hidden = !busy && !exporting;
        cancelBtn.textContent = exporting ? 'Cancel Export' : 'Cancel Run';
        progress.hidden = !busy;
        runBtn.textContent = busy ? 'Running…' : 'Run Simulation';
        for (const id of exportIds)
            document.getElementById(id).disabled = !solver || busy || exporting;
    }

    // Read and validate the run settings.
    function buildConfig(showErrors = true) {
        const system = document.getElementById('unitSystem').value;
        try {
            return validateConfig({
                gridCells: document.getElementById('gridCells').value,
                cflNumber: document.getElementById('cflNumber').value,
                maxTime: document.getElementById('maxTime').value,
                snapshotInterval: document.getElementById('snapshotInterval').value,
                snapshotPrecision: document.getElementById('snapshotPrecision').value,
                leftBoundary: document.getElementById('leftBoundary').value,
                rightBoundary: document.getElementById('rightBoundary').value,
                unitSystem: system === 'arbitrary' ? 'arbitrary' : 'mks',
                displayUnits: system
            });
        } catch (error) {
            const fields = { 'Grid cells': 'gridCells', 'CFL number': 'cflNumber', 'Max time': 'maxTime', 'Snapshot interval': 'snapshotInterval', 'Too many snapshots': 'snapshotInterval' };
            const match = Object.entries(fields).find(([label]) => error.message.startsWith(label));
            if (showErrors && match) fieldError(document.getElementById(match[1]), error.message);
            throw error;
        }
    }

    // Read material sections and convert them to solver units.
    function buildSlabs() {
        const slabs = [...document.querySelectorAll('.slab-container')].map((section, i) => {
            const id = section.id.split('-')[1];
            const value = (name) =>
                readNumber(
                    document.getElementById(`sec${name}-${id}`).value,
                    `Section ${i + 1} ${name.toLowerCase()}`
                );
            const select = document.getElementById(`secGas-${id}`);
            return {
                length: value('Length'),
                gamma: value('Gamma'),
                mw: value('MW'),
                pressure: value('Pressure'),
                density: value('Density'),
                velocity: value('Velocity'),
                name: select.options[select.selectedIndex].text
            };
        });
        return toInternalSlabs(slabs, document.getElementById('unitSystem').value);
    }

    // Stop the worker and restore idle controls.
    function finishWorker() {
        worker?.terminate();
        worker = null;
        busy = false;
        updateEstimates();
    }

    // Calculate in a worker and display completed results.
    function runSimulation() {
        if (busy || exporting) return;
        document.querySelectorAll('.sim-ctrl-card [aria-invalid="true"]').forEach(input => fieldError(input));
        try {
            ui.updateAllThermo();
            const config = buildConfig(),
                slabs = buildSlabs(),
                runRevision = revision;
            exportRequest = null;
            updateEstimates();
            if (estimates.runBytes > MEMORY_ACKNOWLEDGEMENT && estimates.runBytes > acknowledgedBytes) {
                acknowledgement.focus();
                return;
            }
            if (typeof Worker === 'undefined')
                throw new Error(
                    'This browser does not support simulation workers. Use a current browser.'
                );
            busy = true;
            progress.value = 0;
            lastProgressAnnouncement = -1;
            updateButtons();
            status.textContent = 'Running simulation…';
            const candidate = new Worker(new URL('./shock-physics.js', import.meta.url), {
                type: 'module'
            });
            worker = candidate;
            candidate.addEventListener('message', (event) => {
                if (worker !== candidate) return;
                if (event.data.type === 'progress') {
                    progress.value = event.data.progress;
                    const percentage = Math.floor(event.data.progress * 10) * 10;
                    if (percentage !== lastProgressAnnouncement) {
                        lastProgressAnnouncement = percentage;
                        status.textContent = `Running simulation… ${percentage}%`;
                    }
                } else if (event.data.type === 'complete') {
                    const result = event.data.result;
                    result.createdAt = new Date().toISOString();
                    const previous = solver;
                    try {
                        visualizer.setData(
                            result.history,
                            result.x,
                            result.tracers,
                            result.config,
                            result.ranges
                        );
                        visualizer.setDisplayUnits(document.getElementById('unitSystem').value);
                        visualizer.renderAll();
                        solver = result;
                        lastRunRevision = runRevision;
                        const warnings = result.diagnostics.warnings.join(' ');
                        const fallback = result.diagnostics.fallbackFluxes
                            ? ` ${result.diagnostics.fallbackFluxes} fallback flux evaluations.`
                            : '';
                        const changed =
                            revision !== runRevision
                                ? ' Inputs changed during the run; run again to apply them.'
                                : '';
                        const duration = (result.diagnostics.calculationMs / 1000).toFixed(2);
                        status.textContent = `Complete: ${result.diagnostics.timeSteps.toLocaleString()} steps - ${result.history.length.toLocaleString()} snapshots - ${duration} s compute time${changed}${fallback}${warnings ? ` ${warnings}` : ''}`;
                    } catch (error) {
                        if (previous) {
                            visualizer.setData(
                                previous.history,
                                previous.x,
                                previous.tracers,
                                previous.config,
                                previous.ranges
                            );
                            visualizer.renderAll();
                        }
                        status.textContent = `Could not display the run: ${error.message}`;
                    }
                    finishWorker();
                } else if (event.data.type === 'error') {
                    status.textContent = `Run failed: ${event.data.message}${solver ? ' Previous results are retained.' : ''}`;
                    finishWorker();
                }
            });
            candidate.addEventListener('error', (event) => {
                if (worker !== candidate) return;
                event.preventDefault();
                status.textContent = `Run failed: ${event.message || 'The simulation worker could not start.'}${solver ? ' Previous results are retained.' : ''}`;
                finishWorker();
            });
            candidate.postMessage({ config, slabs });
        } catch (error) {
            const match = error.message.match(/Section (\d+) (length|density|pressure|velocity|gamma|molecular weight|mw)/i);
            if (match) {
                const section = document.querySelectorAll('.slab-container')[Number(match[1]) - 1];
                const field = { length: 'Length', density: 'Density', pressure: 'Pressure', velocity: 'Velocity', gamma: 'Gamma', 'molecular weight': 'MW', mw: 'MW' }[match[2].toLowerCase()];
                const input = section?.querySelector(`[id^="sec${field}-"]`);
                if (input) fieldError(input, error.message);
            }
            document.querySelector('.sim-ctrl-card [aria-invalid="true"]')?.focus();
            status.textContent = `Check inputs: ${error.message}${solver ? ' Previous results are retained.' : ''}`;
            finishWorker();
        }
    }

    runBtn.addEventListener('click', runSimulation);
    cancelBtn.addEventListener('click', () => {
        if (exporting) { exportCancelled = true; return; }
        finishWorker();
        status.textContent = solver
            ? 'Run cancelled. Previous results are retained.'
            : 'Run cancelled.';
    });
    window.addEventListener('pagehide', () => {
        exportCancelled = true;
        if (estimateFrame !== null) cancelAnimationFrame(estimateFrame);
        estimateFrame = null;
        finishWorker();
    });
    const inputIds = [
        'gridCells',
        'cflNumber',
        'maxTime',
        'snapshotInterval',
        'snapshotPrecision',
        'leftBoundary',
        'rightBoundary'
    ];
    for (const event of ['input', 'change'])
        document.querySelector('.sim-ctrl-card').addEventListener(event, (e) => {
            if (inputIds.includes(e.target.id)) fieldError(e.target);
            if (inputIds.includes(e.target.id) || e.target.closest('.slab-container')) markChanged();
        });
    for (const id of ['xtColormap', 'xtVariable', 'showTracker', 'trackerColor', 'unitSystem']) {
        document.getElementById(id).addEventListener('change', () => {
            if (id === 'unitSystem') { if (!exporting) exportRequest = null; queueEstimates(); }
            if (!solver) return;
            if (id === 'unitSystem') visualizer.setDisplayUnits(document.getElementById(id).value);
            visualizer.renderAll();
        });
    }

    // Download a generated file and release its temporary URL.
    function downloadFile(blob, filename) {
        const url = URL.createObjectURL(blob),
            anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    // Build CSV in small chunks while keeping controls responsive.
    async function exportCSV(rows, filename, csvBytes) {
        const own = estimateResources(solver.config, solver.config.slabs.length, 0, visualizer.memoryBytes());
        exportRequest = { filename, peakBytes: Math.max(own.residentBytes + csvBytes * 3, exportRequest?.filename === filename ? exportRequest.peakBytes : 0) };
        updateEstimates();
        if (requiredBytes > MEMORY_ACKNOWLEDGEMENT && requiredBytes > acknowledgedBytes) {
            status.textContent = 'Acknowledge high memory use beside Run, then choose Export again.';
            acknowledgement.scrollIntoView?.({ block: 'center' });
            acknowledgement.focus();
            return;
        }
        exporting = true;
        exportCancelled = false;
        updateButtons();
        try {
            const parts = [];
            const checkPeak = bytes => {
                const peak = own.residentBytes + bytes * 3;
                if (peak > MEMORY_ACKNOWLEDGEMENT && peak > acknowledgedBytes) {
                    exportRequest.peakBytes = peak;
                    updateEstimates();
                    throw new Error('The file exceeded its estimate. Acknowledge the updated memory use and export again.');
                }
            };
            let chunk = '',
                count = 0, bytes = 0, lastYield = performance.now();
            const encoder = new TextEncoder();
            status.textContent = 'Preparing CSV…';
            for (const row of rows) {
                chunk += row;
                if (++count % 256 === 0 && (chunk.length >= 65536 || performance.now() - lastYield > 12)) {
                    const encoded = encoder.encode(chunk);
                    bytes += encoded.byteLength;
                    checkPeak(bytes);
                    parts.push(encoded);
                    chunk = '';
                    await new Promise((resolve) => setTimeout(resolve, 0));
                    if (exportCancelled) throw new Error('Export cancelled.');
                    lastYield = performance.now();
                }
            }
            if (exportCancelled) throw new Error('Export cancelled.');
            const last = encoder.encode(chunk);
            checkPeak(bytes + last.byteLength);
            parts.push(last);
            const blob = new Blob(parts, { type: 'text/csv;charset=utf-8' });
            downloadFile(blob, filename);
            exportRequest = null;
            status.textContent = `CSV prepared: ${(blob.size / 1e6).toFixed(2)} MB. Settings are in the first comment line.${revision !== lastRunRevision ? ' Current inputs differ. Run again to apply them.' : ''}`;
        } catch (error) {
            if (exportCancelled) exportRequest = null;
            status.textContent = exportCancelled ? 'Export cancelled. Previous results are retained.' : `Export failed: ${error.message}`;
        } finally {
            exporting = false;
            updateEstimates();
        }
    }

    document.getElementById('exportXTBtn').addEventListener('click', () => {
        if (solver && !busy && !exporting)
            exportCSV(xtCSVRows(solver, visualizer.displayUnits), 'xt_heatmap_data.csv', estimateResources(solver.config, solver.config.slabs.length).csvBytes);
    });
    document.getElementById('exportTracerBtn').addEventListener('click', () => {
        if (solver && !busy && !exporting)
            exportCSV(tracerCSVRows(solver, visualizer.displayUnits), 'tracer_data.csv', estimateResources(solver.config, solver.config.slabs.length).tracerCsvBytes);
    });
    document.getElementById('exportPngBtn').addEventListener('click', () => {
        if (!solver) return;
        visualizer.renderXTWithOverlay(false);
        visualizer.xtCanvas.toBlob((blob) => {
            if (blob) downloadFile(blob, 'xt_diagram.png');
            else status.textContent = 'Image export failed.';
        }, 'image/png');
    });

    updateEstimates();
    runSimulation();
}

// Material sections and gas dialogs.
// Connect material inputs and gas dialogs.
export function initShockUI(onChange) {
    let sectionCount = 0,
        customCount = 0,
        activeMixtureSectionId = null;
    let currentSystem = document.getElementById('unitSystem').value;
    let activeModal = null,
        returnFocus = null,
        savedOverflow = '',
        mixtureRowCount = 0;
    const container = document.getElementById('sectionContainer');
    const gasPresets = {
        ideal: { gamma: 1.4, mw: 28.97, name: 'Arbitrary Ideal Gas' },
        air: { gamma: 1.402, mw: 28.97, name: 'Air' },
        argon: { gamma: 1.67, mw: 39.95, name: 'Argon' },
        co2: { gamma: 1.289, mw: 44.01, name: 'Carbon Dioxide' },
        helium: { gamma: 1.667, mw: 4, name: 'Helium' },
        neon: { gamma: 1.667, mw: 20.18, name: 'Neon' },
        nitrogen: { gamma: 1.401, mw: 28.01, name: 'Nitrogen' },
        sf6: { gamma: 1.092, mw: 146.06, name: 'Sulfur Hexafluoride' },
        xenon: { gamma: 1.667, mw: 131.29, name: 'Xenon' }
    };

    // Open a dialog and focus its first control.
    function showModal(id) {
        returnFocus = document.activeElement;
        activeModal = document.getElementById(id);
        activeModal.style.display = 'flex';
        savedOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        document.querySelector('main').inert = true;
        document.querySelector('nav').inert = true;
        activeModal.querySelector('input, select, button').focus();
    }

    // Close the dialog and restore keyboard focus.
    function hideModal() {
        if (!activeModal) return;
        activeModal.style.display = 'none';
        activeModal = null;
        document.querySelector('main').inert = false;
        document.querySelector('nav').inert = false;
        document.body.style.overflow = savedOverflow;
        (returnFocus?.isConnected ? returnFocus : document.getElementById('runButton')).focus();
    }

    document.addEventListener('keydown', (event) => {
        if (!activeModal) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            hideModal();
        }
        if (event.key !== 'Tab') return;
        const controls = [...activeModal.querySelectorAll('input, select, button')].filter(
            (element) => !element.disabled
        );
        const first = controls[0],
            last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    });

    // Open the custom gas dialog and clear its error.
    function openCustomGasModal() {
        document.getElementById('customGasError').textContent = '';
        showModal('customGasModal');
    }

    // Validate and add a named gas preset.
    function saveCustomGas() {
        for (const id of ['customGasName', 'customGasGamma', 'customGasMW']) fieldError(document.getElementById(id));
        try {
            const name = document.getElementById('customGasName').value.trim();
            if (!name || name.length > 80)
                throw new Error('Use a gas name from 1 to 80 characters.');
            if (
                Object.values(gasPresets).some(
                    (gas) => gas.name.replace(/^★ /, '').toLowerCase() === name.toLowerCase()
                )
            )
                throw new Error('That gas name already exists. Choose a different name.');
            const gas = validateGas({
                gamma: document.getElementById('customGasGamma').value,
                mw: document.getElementById('customGasMW').value
            });
            gasPresets[`custom_${customCount++}`] = { ...gas, name: `★ ${name}` };
            // Add new presets to every material selector.
            refreshAllDropdowns();
            hideModal();
        } catch (error) {
            document.getElementById('customGasError').textContent = error.message;
            const id = /name/i.test(error.message) ? 'customGasName' : /gamma/i.test(error.message) ? 'customGasGamma' : 'customGasMW';
            fieldError(document.getElementById(id), error.message);
            document.getElementById(id).focus();
        }
    }

    // Refresh gas choices while preserving the selection.
    function fillGasOptions(select, includeManual = true) {
        const previous = select.value;
        select.replaceChildren();
        for (const [key, gas] of Object.entries(gasPresets)) select.add(new Option(gas.name, key));
        if (includeManual) {
            select.add(new Option('Manual Input / Mixture', 'manual'));
            select.add(new Option('Build Mixture', 'mixture'));
        }
        select.value = gasPresets[previous] || previous === 'manual' ? previous : 'ideal';
    }

    function refreshAllDropdowns() {
        container
            .querySelectorAll('select[id^="secGas-"]')
            .forEach((select) => fillGasOptions(select));
    }

    // Load a section's saved mixture into the dialog.
    function openMixtureModal(id) {
        activeMixtureSectionId = id;
        document.getElementById('mixtureRows').replaceChildren();
        document.getElementById('mixErrorMsg').classList.add('hidden');
        const saved = document.getElementById(`section-${id}`).dataset.mixture;
        const rows = saved
            ? JSON.parse(saved)
            : [
                  { gas: 'argon', percent: 50 },
                  { gas: 'helium', percent: 50 }
              ];
        rows.forEach((row) => addMixtureRow(row.gas, row.percent));
        // Show the percentage total and flag invalid mixtures.
        updateMixtureTotal();
        showModal('mixtureModal');
    }

    // Add one gas and mole percentage to the mixture.
    function addMixtureRow(defaultGas = 'air', defaultPct = 0) {
        const rows = document.getElementById('mixtureRows');
        if (rows.children.length >= MAX_MATERIALS) return;
        const row = document.createElement('div');
        const rowId = mixtureRowCount++;
        row.className = 'flex gap-2 items-center mix-row';
        row.innerHTML = `
            <select aria-label="Constituent gas" class="mix-gas-select flex-1 text-sm py-2 px-2 border border-black/20 dark:border-white/20 rounded bg-white dark:bg-[#18181b]"></select>
            <input id="mix-percentage-${rowId}" type="number" step="any" min="0" max="100" aria-label="Mole percentage" aria-describedby="mixErrorMsg" class="mix-pct-input w-20 py-2 px-2 border border-black/20 dark:border-white/20 rounded bg-white dark:bg-[#18181b] text-center">
            <span class="text-sm font-bold opacity-50">%</span>
            <button type="button" aria-label="Remove constituent" class="text-red-500 hover:text-red-700 px-2"><i class="fa-solid fa-trash"></i></button>
        `;
        fillGasOptions(row.querySelector('select'), false);
        row.querySelector('select').value = defaultGas;
        row.querySelector('input').value = defaultPct;
        row.querySelector('input').addEventListener('input', updateMixtureTotal);
        row.querySelector('button').addEventListener('click', () => {
            const next = row.nextElementSibling?.querySelector('select') || row.previousElementSibling?.querySelector('select') || document.getElementById('addMixtureBtn');
            const restore = row.contains(document.activeElement);
            row.remove();
            if (restore) next?.focus();
            updateMixtureTotal();
        });
        rows.appendChild(row);
        if (activeModal?.id === 'mixtureModal') row.querySelector('select').focus();
        updateMixtureTotal();
    }

    // Read the selected gases and their mole percentages.
    function readMixture() {
        document.querySelectorAll('.mix-pct-input').forEach(input => {
            fieldError(input);
            if (!Number.isFinite(input.valueAsNumber) || input.valueAsNumber < 0 || input.valueAsNumber > 100) fieldError(input, 'Enter a mole percentage from 0 to 100.');
        });
        return [...document.querySelectorAll('.mix-row')].map((row) => ({
            gas: row.querySelector('select').value,
            percent: readNumber(row.querySelector('input').value, 'Mole percentage')
        }));
    }

    function updateMixtureTotal() {
        const label = document.getElementById('mixTotalPct');
        try {
            const rows = readMixture();
            const total = rows.reduce((sum, row) => sum + row.percent, 0);
            label.textContent = Number(total.toPrecision(12)).toString();
            calculateMixture(rows.map((row) => ({ ...gasPresets[row.gas], percent: row.percent })));
            label.parentElement.classList.remove('text-red-500');
            document.getElementById('mixErrorMsg').classList.add('hidden');
        } catch {
            label.parentElement.classList.add('text-red-500');
            if (
                [...document.querySelectorAll('.mix-pct-input')].some((input) => input.value === '')
            )
                label.textContent = '—';
        }
    }

    // Save valid mixture properties to the selected section.
    function applyMixture() {
        try {
            const rows = readMixture();
            const mixture = calculateMixture(
                rows.map((row) => ({ ...gasPresets[row.gas], percent: row.percent }))
            );
            const id = activeMixtureSectionId;
            document.getElementById(`secGamma-${id}`).value = mixture.gamma;
            document.getElementById(`secMW-${id}`).value = mixture.mw;
            document.getElementById(`secGas-${id}`).value = 'manual';
            document.getElementById(`secGas-${id}`).dataset.previous = 'manual';
            document.getElementById(`section-${id}`).dataset.mixture = JSON.stringify(rows);
            // Calculate the selected property from the ideal gas law.
            updateThermo(id);
            onChange();
            hideModal();
        } catch (error) {
            const label = document.getElementById('mixErrorMsg');
            label.textContent = error.message;
            label.classList.remove('hidden');
            (document.querySelector('#mixtureRows [aria-invalid="true"]') || document.querySelector('.mix-pct-input'))?.focus();
        }
    }

    function updateThermo(id) {
        const mode = document.getElementById(`calcMode-${id}`).value;
        const fields = {
            P: document.getElementById(`secPressure-${id}`),
            rho: document.getElementById(`secDensity-${id}`),
            T: document.getElementById(`secTemperature-${id}`)
        };
        Object.entries(fields).forEach(([key, input]) => {
            input.disabled = false;
            input.readOnly = key === mode;
            input.setAttribute('aria-description', key === mode ? 'Calculated from the other thermodynamic inputs.' : '');
            fieldError(input);
        });
        const output = fields[mode];
        try {
            const molecularWeight = document.getElementById(`secMW-${id}`);
            let mw;
            try { mw = positiveNumber(molecularWeight.value, 'Molecular weight'); }
            catch (error) { fieldError(molecularWeight, error.message); throw error; }
            const R = getGasConstant(currentSystem, mw);
            const value = (key) => {
                try { return positiveNumber(fields[key].value, key); }
                catch (error) { fieldError(fields[key], error.message); throw error; }
            };
            const result =
                mode === 'P'
                    ? value('rho') * R * value('T')
                    : mode === 'rho'
                      ? value('P') / (R * value('T'))
                      : value('P') / (value('rho') * R);
            if (!Number.isFinite(result) || result <= 0) throw new Error('Invalid gas state.');
            output.value = result.toString();
        } catch {
            output.value = '';
        }
    }

    // Show physical units and leave arbitrary units blank.
    function updateUnitLabels() {
        const units = unitSystems[currentSystem];
        const labels = {
            Length: units.xLbl,
            Pressure: units.pLbl,
            Density: units.rhoLbl,
            Temperature: units.tempLbl,
            Velocity: units.uLbl
        };
        container.querySelectorAll('[data-unit-label]').forEach((label) => {
            const field = label.dataset.unitLabel;
            label.textContent = unitLabel(field, labels[field]);
        });
        document.querySelector('label[for="maxTime"]').textContent = unitLabel(
            'Max Time',
            units.tLbl
        );
        document.querySelector('label[for="snapshotInterval"]').textContent = unitLabel(
            'Snapshot Interval',
            units.tLbl
        );
    }

    // Convert physical inputs and refresh calculated properties.
    function updateAllThermo() {
        const nextSystem = document.getElementById('unitSystem').value;
        const physicalSwitch = currentSystem !== 'arbitrary' && nextSystem !== 'arbitrary';
        if (nextSystem !== currentSystem && physicalSwitch) {
            const oldUnits = unitSystems[currentSystem],
                newUnits = unitSystems[nextSystem];
            const fields = {
                Length: 'x',
                Pressure: 'p',
                Density: 'rho',
                Temperature: 'T',
                Velocity: 'u'
            };
            container.querySelectorAll('.slab-container').forEach((section) => {
                const id = section.id.split('-')[1];
                for (const [field, key] of Object.entries(fields)) {
                    const input = document.getElementById(`sec${field}-${id}`);
                    if (input.value !== '')
                        input.value = (Number(input.value) * oldUnits[key]) / newUnits[key];
                }
            });
        } else if (nextSystem !== currentSystem) {
            onChange(
                'Unit scales changed. Values were reinterpreted; run again to use these inputs.'
            );
        }
        currentSystem = nextSystem;
        container
            .querySelectorAll('.slab-container')
            .forEach((section) => updateThermo(section.id.split('-')[1]));
        updateUnitLabels();
    }

    // Apply gas properties or open the mixture dialog.
    function handlePresetChange(id) {
        const select = document.getElementById(`secGas-${id}`);
        const section = document.getElementById(`section-${id}`);
        if (select.value === 'mixture') {
            select.value = select.dataset.previous ?? 'ideal';
            openMixtureModal(id);
            return;
        }
        const preset = gasPresets[select.value];
        if (preset) {
            document.getElementById(`secGamma-${id}`).value = preset.gamma;
            document.getElementById(`secMW-${id}`).value = preset.mw;
            delete section.dataset.mixture;
        }
        updateThermo(id);
    }

    // Create one editable material section.
    function addMaterialSection(defaultLength = 0.5, defaultPres = 1, defaultDens = 1) {
        if (container.children.length >= MAX_MATERIALS) {
            onChange(`Use at most ${MAX_MATERIALS} material sections.`);
            return;
        }
        const id = sectionCount++;
        const section = document.createElement('div');
        section.className = 'slab-container';
        section.id = `section-${id}`;
        section.setAttribute('role', 'group');
        section.setAttribute('aria-labelledby', `section-title-${id}`);
        const field = (name, value, label = name) =>
            `<div><label class="input-label" for="sec${name}-${id}" ${['Length', 'Pressure', 'Density', 'Temperature', 'Velocity'].includes(name) ? `data-unit-label="${name}"` : ''}>${label}</label><input type="number" step="any" id="sec${name}-${id}" value="${value}" class="number-input"></div>`;
        section.innerHTML = `
            <button type="button" aria-label="Remove section ${id + 1}" class="slab-delete-btn"><i class="fa-solid fa-xmark"></i></button>
            <div class="slab-heading flex items-center justify-start gap-4 mb-3">
                <div id="section-title-${id}" class="font-bold text-sm uppercase tracking-wider opacity-80">Section ${id + 1}</div>
                <select id="calcMode-${id}" aria-label="Calculated property for section ${id + 1}" style="width: 160px;" class="text-xs bg-transparent border border-black/20 dark:border-white/20 rounded px-2 py-1 outline-none font-bold cursor-pointer">
                    <option value="T" selected>Auto-Calc: Temp</option>
                    <option value="rho">Auto-Calc: Density</option>
                    <option value="P">Auto-Calc: Pressure</option>
                </select>
            </div>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                ${field('Length', defaultLength)}
                <div><label class="input-label" for="secGas-${id}">Gas Type</label><select id="secGas-${id}"></select></div>
                ${field('Gamma', 1.4)}
                ${field('MW', 28.97, 'MW (g/mol)')}
            </div>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                ${field('Pressure', defaultPres)}
                ${field('Density', defaultDens)}
                ${field('Temperature', 1)}
                ${field('Velocity', 0)}
            </div>
        `;
        const select = section.querySelector(`#secGas-${id}`);
        fillGasOptions(select);
        select.addEventListener('focus', () => {
            select.dataset.previous = select.value;
        });
        select.addEventListener('change', () => {
            handlePresetChange(id);
            select.dataset.previous = select.value;
        });
        section.querySelector('button').addEventListener('click', () => {
            const next = section.nextElementSibling?.querySelector('input') || section.previousElementSibling?.querySelector('input') || document.getElementById('addSectionBtn');
            const restore = section.contains(document.activeElement);
            section.remove();
            if (restore) next?.focus();
            onChange();
        });
        section.querySelector(`#calcMode-${id}`).addEventListener('change', () => updateThermo(id));
        section.querySelectorAll('input').forEach((input) =>
            input.addEventListener('input', () => {
                fieldError(input);
                if (input.id === `secGamma-${id}` || input.id === `secMW-${id}`) {
                    select.value = 'manual';
                    select.dataset.previous = 'manual';
                    delete section.dataset.mixture;
                }
                updateThermo(id);
            })
        );
        container.appendChild(section);
        if (arguments.length === 0) section.querySelector('input').focus();
        updateThermo(id);
        updateUnitLabels();
        onChange();
    }

    // Keep the existing inline button handlers.
    Object.assign(window, {
        openCustomGasModal,
        closeCustomGasModal: hideModal,
        saveCustomGas,
        openMixtureModal,
        closeMixtureModal: hideModal,
        addMixtureRow,
        updateMixtureTotal,
        applyMixture,
        updateThermo,
        updateAllThermo,
        addMaterialSection,
        handlePresetChange
    });
    addMaterialSection(0.5, 1, 1);
    addMaterialSection(0.5, 0.1, 0.125);
    return { updateAllThermo };
}

// Export formatting.
// Describe the completed run and its export units.
export function resultMetadata(result, system = result.config.displayUnits) {
    if (
        !Object.hasOwn(unitSystems, system) ||
        (system === 'arbitrary') !== (result.config.unitSystem === 'arbitrary')
    )
        throw new Error('Export units must match the completed run.');
    return {
        solverVersion: SOLVER_VERSION,
        snapshotPrecision: result.config.snapshotPrecision ?? '64',
        fieldSignificantDigits: result.config.snapshotPrecision === '32' ? 9 : 17,
        createdAt: result.createdAt,
        model: '1D inviscid calorically perfect gases; no heat conduction, viscosity, reactions, or species diffusion',
        method: 'First-order finite volumes; HLLC with Rusanov fallback; SSP-RK(4,3)',
        temperature:
            result.config.unitSystem === 'arbitrary'
                ? 'p/rho; specific gas constant = 1 for all materials'
                : 'p / (Ru * sum(partial density / MW)); cell number-weighted temperature',
        internalUnits: result.config.unitSystem === 'arbitrary' ? 'arbitrary' : 'SI; MW in g/mol',
        universalGasConstant: result.config.unitSystem === 'arbitrary' ? null : Ru,
        outputUnits: system,
        config: result.config,
        diagnostics: result.diagnostics
    };
}

// Yield every stored cell and time as CSV rows.
export function* xtCSVRows(result, system = result.config.displayUnits) {
    const metadata = resultMetadata(result, system),
        units = unitSystems[system];
    yield `# ${JSON.stringify(metadata)}\r\n`;
    yield [
        ['Time', units.tLbl],
        ['Position', units.xLbl],
        ['Density', units.rhoLbl],
        ['Velocity', units.uLbl],
        ['Pressure', units.pLbl],
        ['Temperature', units.tempLbl]
    ]
        .map(([name, unit]) => unitLabel(name, unit, ''))
        .join(',') + '\r\n';
    for (const snap of result.history) {
        for (let i = 0; i < result.x.length; i++)
            yield [
                snap.t,
                result.x[i] / units.x,
                formatField(snap.rho[i] / units.rho, metadata.fieldSignificantDigits),
                formatField(snap.u[i] / units.u, metadata.fieldSignificantDigits),
                formatField(snap.p[i] / units.p, metadata.fieldSignificantDigits),
                formatField(snap.T[i] / units.T, metadata.fieldSignificantDigits)
            ].join(',') + '\r\n';
    }
}

// Export meaningful digits without padded zeros.
function formatField(value, digits) {
    if (!Number.isFinite(value)) throw new Error('Export units exceed numerical precision.');
    return Number(value.toPrecision(digits)).toString();
}

// Yield interface paths and boundary exits as CSV rows.
export function* tracerCSVRows(result, system = result.config.displayUnits) {
    const metadata = resultMetadata(result, system),
        units = unitSystems[system];
    yield `# ${JSON.stringify(metadata)}\r\n`;
    yield `TracerID,${unitLabel('Time', units.tLbl, '')},${unitLabel('Position', units.xLbl, '')},Event\r\n`;
    result.tracers.forEach((tracer) => {
        if (!tracer.path.length) throw new Error('Tracer history is missing.');
    });
    for (let i = 0; i < result.tracers.length; i++) {
        const tracer = result.tracers[i];
        for (const point of tracer.path)
            yield [
                i + 1,
                point.t,
                point.x / units.x,
                tracer.exit && point.t === tracer.exit.t ? 'exit' : 'snapshot'
            ].join(',') + '\r\n';
    }
}
