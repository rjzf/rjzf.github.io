// Kelvin-Helmholtz problem definition and browser controls. KH-specific parameters, shear-layer
// initialization, and UI stay here so the shared GPU numerics and solver sequence remain reusable.

import {
  INSTABILITY_GLSL,
  INSTABILITY_SHADERS,
  INSTABILITY_VERTEX,
} from './instability-gpuaccel.js';
import {
  INSTABILITY_HISTORY_BYTES,
  INSTABILITY_PALETTES,
  INSTABILITY_RESOLUTIONS,
  InstabilitySolver,
  instabilityLayout,
} from './instability-solver.js';

export const KH_RESOLUTIONS = INSTABILITY_RESOLUTIONS;
export const KH_HISTORY_BYTES = INSTABILITY_HISTORY_BYTES;
export const KH_PALETTES = INSTABILITY_PALETTES;
export const KH_VERTEX = INSTABILITY_VERTEX;

// Simulation configuration. Change one setting at a time when comparing runs.
export const KH_CONFIG = Object.freeze({
  width: 2,
  height: 1, // Keep the domain at a fixed 2:1 aspect ratio.
  atwood: 0, // Start with equal densities to isolate shear.
  gravity: 0,
  shear: 1, // Difference between the upper and lower velocities.
  shearThickness: 0.05, // Half-width scale of the smooth velocity transition.
  amplitude: 0.025, // Amplitude divided by wavelength.
  waves: 3,
  thickness: 0.0078125, // Half the sharp material transition width.
  phase: -Math.PI / 2, // Center the first billow in the view.
  heavyAbove: true, // Place material A above the interface.
  viscosity: 0, // No explicit velocity diffusion.
  cfl: 0.4, // Compare with 0.2 for timestep sensitivity.
  maxDt: 0.012,
  pressureTolerance: 0.0001,
  saveInterval: 0.25,
  maxSnapshots: 30,
});

export function khLayout(resolution, overrides = {}) {
  const cfg = { ...KH_CONFIG, ...overrides };
  if (!KH_RESOLUTIONS.some((option) => option.value === resolution))
    throw new Error('Choose a supported grid resolution.');
  if (Object.entries(cfg).some(([key, value]) => key !== 'heavyAbove' && !Number.isFinite(value)))
    throw new Error('Simulation settings must be finite numbers.');
  if (cfg.width !== 2 || cfg.height !== 1) throw new Error('Keep the domain at 2 × 1.');
  if (cfg.atwood < 0 || cfg.atwood > 0.8 || cfg.viscosity < 0 || cfg.viscosity > 0.002)
    throw new Error('Use Atwood 0–0.8 and viscosity 0–0.002.');
  if (Math.abs(cfg.gravity) > 4) throw new Error('Use an acceleration magnitude from 0 to 4.');
  if (cfg.shear < 0 || cfg.shear > 4) throw new Error('Use a velocity difference from 0 to 4.');
  if (cfg.shearThickness !== 0.05) throw new Error('Keep the shear transition scale at 0.05.');
  if (!Number.isInteger(cfg.waves) || cfg.waves < 1 || cfg.waves > 6)
    throw new Error('Choose one to six waves.');
  if (
    cfg.amplitude < 0 ||
    cfg.amplitude > 0.05 ||
    cfg.thickness <= 0 ||
    (cfg.amplitude * cfg.width) / cfg.waves + cfg.thickness >= cfg.height / 2
  )
    throw new Error('Keep the initial interface inside the domain.');
  if (![0.0078125, 0.015625, 0.03125].includes(cfg.thickness))
    throw new Error('Choose Sharp, Normal, or Diffuse for the interface width.');
  if (
    cfg.cfl <= 0 ||
    cfg.cfl > 0.4 ||
    cfg.maxDt <= 0 ||
    cfg.pressureTolerance <= 0 ||
    cfg.pressureTolerance > 0.002
  )
    throw new Error('Use a CFL up to 0.4 and positive timestep and pressure settings.');
  if (typeof cfg.heavyAbove !== 'boolean') throw new Error('Use true or false for heavyAbove.');
  if (
    cfg.saveInterval < 0.01 ||
    cfg.saveInterval > 1 ||
    !Number.isInteger(cfg.maxSnapshots) ||
    cfg.maxSnapshots < 2 ||
    cfg.maxSnapshots > 50
  )
    throw new Error('Save every 0.01–1 time units and choose 2–50 snapshots.');
  return instabilityLayout(resolution, cfg);
}


export const KH_SHADERS = {
  initial:
    INSTABILITY_GLSL +
    `
uniform float amplitude, thickness, phase, heavyAbove, waves;

void main() {
  vec2 p = gl_FragCoord.xy * h;

  // Sinusoidal diffuse interface.
  float interfaceY = 0.5 * float(grid.y) * h
    + amplitude * cos(6.28318530718 * waves * p.x / (float(grid.x) * h) + phase);
  float c = smoothstep(-thickness, thickness, p.y - interfaceY);
  color = vec4(heavyAbove > 0.5 ? c : 1.0 - c, 0, 0, 1);
}`,
  initialVelocity:
    INSTABILITY_GLSL +
    `
uniform float shear, shearThickness, amplitude, waves, phase;

// Localized streamfunction perturbation with zero normal flow at the walls.
float stream(ivec2 vertex) {
  if (vertex.y <= 0 || vertex.y >= grid.y) return 0.0;
  float height = float(grid.y) * h;
  float x = float(wrap(vertex.x, grid.x)) * h;
  float y = float(vertex.y) * h;
  float k = 6.28318530718 * waves / (float(grid.x) * h);
  float distance = (y - 0.5 * height) / (0.15 * height);
  float wall = sin(3.14159265359 * y / height);
  float envelope = wall * wall * wall * wall * exp(-distance * distance);
  return -amplitude * shear * sin(k * x + phase) * envelope / k;
}

void main() {
  ivec2 i = ivec2(gl_FragCoord.xy);
  ivec2 row = ivec2(i.x, min(i.y, grid.y - 1));
  float y = (float(row.y) + 0.5) * h;
  float center = 0.5 * float(grid.y) * h;

  // Hyperbolic-tangent base shear layer.
  float u = 0.5 * shear * tanh((y - center) / shearThickness);

  // Discrete curl of the streamfunction keeps the perturbation divergence-free.
  u += (stream(row + ivec2(0, 1)) - stream(row)) / h;
  float v = -(stream(i + ivec2(1, 0)) - stream(i)) / h;
  color = vec4(u, v, 0, 1);
}`,
  ...INSTABILITY_SHADERS,
};

// Kelvin-Helmholtz initialization, all timestepping is inherited from InstabilitySolver.
export class KHSolver extends InstabilitySolver {
  constructor(canvas, resolution = 128, overrides = {}) {
    const layout = khLayout(resolution, overrides);
    super(canvas, layout, KH_SHADERS, KH_PALETTES['red-blue']);
    const cfg = this.config;
    try {
      // Initial material interface.
      this.draw(
        'initial',
        this.material.read,
        {},
        {
          amplitude: (cfg.amplitude * cfg.width) / cfg.waves,
          waves: cfg.waves,
          thickness: cfg.thickness,
          phase: cfg.phase,
          heavyAbove: cfg.heavyAbove ? 1 : 0,
        }
      );
      // Base shear layer plus divergence-free velocity perturbation.
      this.draw(
        'initialVelocity',
        this.velocity.read,
        {},
        {
          shear: cfg.shear,
          shearThickness: cfg.shearThickness,
          amplitude: cfg.amplitude,
          waves: cfg.waves,
          phase: cfg.phase,
        }
      );
      this.finishInitialization();
    } catch (error) {
      this.dispose();
      throw error;
    }
  }
}

// Browser UI, rendering controls, and animation loop.
export function initKH() {
  const canvas = document.getElementById('kh-canvas');
  if (!canvas) return;
  const get = (id) => document.getElementById(id);
  const text = (element, value) => {
    if (element.textContent !== value) element.textContent = value;
  };
  const timeLabel = (value) =>
    value.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
      useGrouping: false,
    });
  const run = get('kh-run'),
    reset = get('kh-reset'),
    status = get('kh-status'),
    setup = get('kh-setup');
  const resolution = get('kh-resolution'),
    waves = get('kh-waves');
  const atwood = get('kh-atwood'),
    amplitude = get('kh-amplitude'),
    acceleration = get('kh-acceleration'),
    shear = get('kh-shear');
  const interval = get('kh-interval'),
    limit = get('kh-limit'),
    palette = get('kh-palette'),
    zoom = get('kh-zoom');
  const arrangement = get('kh-arrangement'),
    viscosity = get('kh-viscosity'),
    thickness = get('kh-thickness');
  const scrub = get('kh-scrub'),
    live = get('kh-live'),
    clock = get('kh-time'),
    fps = get('kh-fps');
  const viewport = get('kh-viewport'),
    advance = get('kh-advance');
  let solver,
    applied,
    running = false,
    failed = false,
    lost = false,
    pending = false,
    inputError = '';
  let request = 0,
    previous = 0,
    accumulated = 0,
    stepMs = 0,
    samples = 0,
    sampleTime = 0,
    sampleSimulationTime = 0,
    advanceTo = null;

  // Remove the retired width control from existing HTML.
  get('kh-width')?.closest('.kh-wide')?.remove();
  get('kh-wavelength').setAttribute('for', 'kh-waves');

  // Choose defaults once and preserve them through window resizing.
  const narrow = window.matchMedia
    ? window.matchMedia('(max-width: 48rem)').matches
    : window.innerWidth <= 768;
  resolution.value = narrow ? '128' : '192';
  waves.value = String(KH_CONFIG.waves);
  atwood.value = String(KH_CONFIG.atwood);
  amplitude.value = String(KH_CONFIG.amplitude);
  shear.value = String(KH_CONFIG.shear);
  acceleration.value = String(Math.abs(KH_CONFIG.gravity));
  arrangement.value = KH_CONFIG.heavyAbove ? 'above' : 'below';
  viscosity.value = String(KH_CONFIG.viscosity);
  thickness.value = String(2 * KH_CONFIG.thickness);
  zoom.value = narrow ? '1' : '1';

  function settings() {
    return {
      resolution: Number(resolution.value),
      width: KH_CONFIG.width,
      waves: waves.valueAsNumber,
      atwood: atwood.valueAsNumber,
      amplitude: amplitude.valueAsNumber,
      gravity: -acceleration.valueAsNumber,
      shear: shear.valueAsNumber,
      saveInterval: interval.valueAsNumber,
      maxSnapshots: limit.valueAsNumber,
      heavyAbove: arrangement.value === 'above',
      viscosity: Number(viscosity.value),
      thickness: Number(thickness.value) / 2,
    };
  }
  function pause() {
    running = false;
    advanceTo = null;
    cancelAnimationFrame(request);
    request = 0;
    previous = 0;
    accumulated = 0;
    fps.textContent = '';
  }
  function refresh() {
    const viewing = solver && solver.viewIndex >= 0;
    text(run, running ? 'Pause' : viewing ? 'Run Live' : 'Run');
    run.setAttribute('aria-pressed', String(running));
    run.disabled = !solver || lost || failed || pending || Boolean(inputError);
    reset.disabled = lost || Boolean(inputError);
    advance.disabled =
      !solver || running || lost || failed || pending || Boolean(inputError) || !solver.recording;
    text(advance, viewing ? 'Next live snapshot' : 'Next snapshot');
    text(reset, pending ? 'Apply & Reset' : 'Reset');
    get('kh-pending').hidden = !pending;
    const count = solver?.history.length || 0;
    scrub.max = String(Math.max(0, count - 1));
    scrub.disabled = count < 2 || lost;
    scrub.value = String(viewing ? solver.viewIndex : Math.max(0, count - 1));
    text(clock, timeLabel(solver?.displayedTime || 0));
    scrub.setAttribute('aria-valuetext', viewing ? `Saved time ${clock.textContent}` : 'Live state');
    live.disabled = !viewing || lost;
    text(get('kh-view-state'), viewing ? 'Saved' : 'Live');
    text(
      get('kh-saved'),
      solver
        ? `${count} / ${solver.historyLimit} snapshots${!solver.recording && !solver.historyError ? ' · Full' : ''}`
        : 'No snapshots'
    );
    if (failed || lost) return;
    text(
      status,
      solver?.historyError ||
        (inputError
          ? 'Check settings'
          : pending
            ? 'Changes ready'
            : advanceTo !== null
            ? 'Advancing to next snapshot'
            : running
              ? 'Running'
              : viewing
              ? `Snapshot ${solver.viewIndex + 1} of ${count}`
              : solver?.steps
                ? 'Paused'
                : 'Ready')
    );
  }
  function fail(error) {
    pause();
    failed = true;
    status.textContent = error.message;
    status.dataset.error = 'true';
    refresh();
  }

  // Preview the next run without reallocating the current simulation.
  function describe() {
    const selected = resolution.value;
    for (const option of KH_RESOLUTIONS) {
      const element = [...resolution.options].find((item) => Number(item.value) === option.value);
      element.textContent = `${option.label} (${option.value * KH_CONFIG.width} × ${option.value * KH_CONFIG.height})`;
    }
    resolution.value = selected;
    get('kh-atwood-value').textContent = atwood.valueAsNumber.toFixed(2);
    get('kh-amplitude-value').textContent = amplitude.valueAsNumber.toFixed(3);
    get('kh-acceleration-value').textContent = acceleration.valueAsNumber.toFixed(2);
    get('kh-shear-value').textContent = shear.valueAsNumber.toFixed(2);
    get('kh-waves-value').textContent = waves.value;
    get('kh-wavelength').textContent = (KH_CONFIG.width / waves.valueAsNumber).toFixed(3);
    pending = Boolean(applied && JSON.stringify(settings()) !== JSON.stringify(applied));
    inputError = '';
    for (const input of setup.querySelectorAll('input, select')) {
      const valid = input.validity.valid;
      input.setAttribute('aria-invalid', String(!valid));
      if (!valid && !inputError)
        inputError = `Check ${get(input.id + '-label')?.textContent.toLowerCase() || 'the highlighted setting'}.`;
    }
    try {
      if (inputError) throw new Error(inputError);
      const next = settings(),
        layout = khLayout(next.resolution, next);
      get('kh-memory').textContent =
        `${pending ? 'Next run: ' : ''}≈ ${(layout.totalBytes / 1000000).toFixed(1)} MB`;
      get('kh-memory-limit').textContent =
        layout.historyLimit < next.maxSnapshots
          ? `${layout.historyLimit} snapshots fit the ${(KH_HISTORY_BYTES / 1000000).toFixed(1)} MB history budget.`
          : '';
      get('kh-memory-limit').hidden = layout.historyLimit >= next.maxSnapshots;
      get('kh-history-end').textContent =
        `History through time ${timeLabel((layout.historyLimit - 1) * next.saveInterval)}`;
    } catch (error) {
      inputError = error.message;
      get('kh-memory').textContent = '—';
      get('kh-history-end').textContent = '';
      get('kh-memory-limit').hidden = true;
    }
    text(get('kh-input-error'), inputError);
    get('kh-input-error').hidden = !inputError;
    refresh();
  }

  // Resize the view without changing fluid cells or saved snapshots.
  function resizeView() {
    if (!solver || lost) return;
    const available = viewport.clientWidth || viewport.getBoundingClientRect().width;
    if (!available) return;
    const height = window.visualViewport?.height || window.innerHeight;
    const base = Math.min(available, (0.72 * height * solver.nx) / solver.ny);
    canvas.style.width = `${Math.max(2, base * Number(zoom.value))}px`;
    if (!running) {
      try {
        solver.render();
      } catch (error) {
        fail(error);
      }
    }
  }

  // Recolor live or saved material without changing its numerical state.
  function recolor() {
    if (!solver || lost) return;
    solver.palette = KH_PALETTES[palette.value] || KH_PALETTES['red-blue'];
    const { heavy, light, names } = solver.palette;
    const mixed = heavy.map((x, i) => (x + light[i]) / 2);
    for (const [name, color] of [
      ['heavy', heavy],
      ['mixed', mixed],
      ['light', light],
    ]) {
      document.querySelector(`.kh-${name}`).style.backgroundColor =
        `rgb(${color.map((x) => Math.round(255 * x)).join(',')})`;
    }
    canvas.setAttribute(
      'aria-label',
      `Kelvin-Helmholtz material field. ${names[0]} is material A and ${names[1]} is material B. Blended colors show intermediate material fractions.`
    );
    try {
      solver.render();
    } catch (error) {
      fail(error);
    }
  }
  function initialize() {
    describe();
    if (inputError || lost) return;
    pause();
    failed = false;
    solver?.dispose();
    solver = null;
    accumulated = 0;
    stepMs = 0;
    delete status.dataset.error;
    status.textContent = 'Preparing simulation…';
    try {
      const next = settings();
      solver = new KHSolver(canvas, next.resolution, next);
      applied = next;
      pending = false;
      resizeView();
      recolor();
      describe();
    } catch (error) {
      fail(error);
    }
    refresh();
  }

  // Limit work per frame while allowing fast devices to catch up.
  function frame(now) {
    request = 0;
    if (!running || lost) return;
    if (document.hidden) {
      previous = 0;
      accumulated = 0;
      samples = 0;
      sampleTime = now;
      sampleSimulationTime = solver.time;
      request = requestAnimationFrame(frame);
      return;
    }
    // Cap long browser-frame gaps at 50 ms.
    const elapsed = previous ? Math.min((now - previous) / 1000, 0.05) : 0;
    previous = now;
    accumulated += elapsed;
    const started = performance.now();
    let steps = 0;
    try {
      // Bound both substeps and wall-clock work per animation frame.
      while (steps < 16 && (steps === 0 || performance.now() - started + stepMs < 18)) {
        let dt = solver.nextDt();
        if (advanceTo === null && accumulated + 1e-12 < dt) break;
        if (advanceTo !== null) dt = Math.min(dt, advanceTo - solver.time);
        const stepStart = performance.now();
        solver.step(dt);
        stepMs = performance.now() - stepStart;
        accumulated = Math.max(0, accumulated - dt);
        steps++;
        if (advanceTo !== null && (solver.time >= advanceTo - 1e-10 || !solver.recording)) {
          pause();
          break;
        }
      }
      accumulated = Math.min(accumulated, solver.nextDt());
      solver.render();
      samples++;
      // Update the FPS/sample-rate display twice per second.
      if (running && now - sampleTime > 500) {
        fps.textContent = `${Math.round((samples * 1000) / (now - sampleTime))} FPS`;
        fps.title = `${(((solver.time - sampleSimulationTime) * 1000) / (now - sampleTime)).toFixed(2)} simulation time units per second`;
        sampleTime = now;
        sampleSimulationTime = solver.time;
        samples = 0;
      }
      refresh();
      if (running) request = requestAnimationFrame(frame);
    } catch (error) {
      fail(error);
    }
  }
  function start(target = null) {
    if (!solver || lost || failed || pending || inputError) return;
    try {
      solver.showLive();
      running = true;
      advanceTo = target;
      previous = 0;
      accumulated = 0;
      sampleTime = performance.now();
      sampleSimulationTime = solver.time;
      samples = 0;
      refresh();
      request = requestAnimationFrame(frame);
    } catch (error) {
      fail(error);
    }
  }
  run.addEventListener('click', () => {
    if (running) {
      pause();
      refresh();
    } else start();
  });
  advance.addEventListener('click', () => {
    if (!running && solver?.recording) start(solver.history.length * solver.config.saveInterval);
  });
  reset.addEventListener('click', initialize);
  for (const input of [
    resolution,
    waves,
    atwood,
    amplitude,
    acceleration,
    shear,
    interval,
    limit,
    arrangement,
    viscosity,
    thickness,
  ]) {
    input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', () => {
      pause();
      describe();
    });
  }
  palette.addEventListener('change', recolor);
  zoom.addEventListener('change', resizeView);
  scrub.addEventListener('input', () => {
    if (!solver || lost) return;
    pause();
    try {
      solver.showSnapshot(Number(scrub.value));
      refresh();
    } catch (error) {
      fail(error);
    }
  });
  live.addEventListener('click', () => {
    if (!solver || lost) return;
    try {
      solver.showLive();
      refresh();
    } catch (error) {
      fail(error);
    }
  });
  const observer = new ResizeObserver(resizeView);
  observer.observe(viewport);
  window.addEventListener('resize', resizeView);
  window.visualViewport?.addEventListener('resize', resizeView);
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    lost = true;
    fail(new Error('Graphics interrupted. Waiting for the device to recover.'));
    setup.disabled = true;
    palette.disabled = true;
    zoom.disabled = true;
  });
  canvas.addEventListener('webglcontextrestored', () => {
    lost = false;
    setup.disabled = false;
    palette.disabled = false;
    zoom.disabled = false;
    initialize();
  });
  window.addEventListener('pagehide', () => {
    pause();
    observer.disconnect();
    solver?.dispose();
    solver = null;
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      observer.observe(viewport);
      initialize();
    }
  });
  initialize();
}

if (typeof document !== 'undefined') initKH();
