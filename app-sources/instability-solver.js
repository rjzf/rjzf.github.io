// Shared variable-density incompressible solver for the RT and KH demonstrations. This file
// owns grid layout, WebGL resources, timestepping, multigrid, diagnostics, and snapshots so each
// problem file can stay focused on its own initial conditions, parameters, and browser controls.

import { INSTABILITY_VERTEX } from './instability-gpuaccel.js';

// Numerical method used by both instability demonstrations:
// - Variable-density incompressible flow on a staggered MAC grid.
// - SSP-RK2 finite-volume advection for material fraction.
// - Midpoint semi-Lagrangian advection for face-centered velocity.
// - Pressure projection with a geometric multigrid pressure solve.

export const INSTABILITY_RESOLUTIONS = Object.freeze([
  { label: 'Lowest', value: 64 },
  { label: 'Low', value: 128 },
  { label: 'Medium', value: 192 },
  { label: 'High', value: 256 },
  { label: 'Highest', value: 384 },
]);

export const INSTABILITY_HISTORY_BYTES = 128 * 1000 * 1000;

// Display palettes. These never change the material field.
export const INSTABILITY_PALETTES = Object.freeze({
  'red-blue': { heavy: [0.96, 0.08, 0.12], light: [0.08, 0.24, 0.98], names: ['Red', 'blue'] },
  'orange-blue': {
    heavy: [230 / 255, 159 / 255, 0],
    light: [0, 114 / 255, 178 / 255],
    names: ['Orange', 'blue'],
  },
  'magenta-teal': {
    heavy: [204 / 255, 121 / 255, 167 / 255],
    light: [0, 158 / 255, 115 / 255],
    names: ['Magenta', 'teal'],
  },
  'black-white': { heavy: [0, 0, 0], light: [1, 1, 1], names: ['Black', 'white'] },
  'navy-gold': {
    heavy: [24 / 255, 45 / 255, 85 / 255],
    light: [250 / 255, 195 / 255, 50 / 255],
    names: ['Navy', 'gold'],
  },
  'purple-mint': {
    heavy: [106 / 255, 52 / 255, 163 / 255],
    light: [146 / 255, 235 / 255, 192 / 255],
    names: ['Purple', 'mint'],
  },
});

// Shared grid hierarchy and GPU-memory estimate after problem-specific validation.
export function instabilityLayout(resolution, cfg) {
  const nx = resolution * cfg.width,
    ny = resolution * cfg.height,
    h = 1 / resolution;
  const levels = [];
  for (let width = nx, height = ny, spacing = h; ; width /= 2, height /= 2, spacing *= 2) {
    levels.push({ width, height, h: spacing });
    if (Math.min(width, height) <= 4 || width % 2 || height % 2) break;
  }
  // Velocity ping-pong plus material ping-pong/stage textures.
  let workingBytes = 16 * nx * (ny + 1) + 12 * nx * ny;
  // Pressure, RHS, residual, and restricted material on the multigrid hierarchy.
  levels.forEach((level, index) => {
    workingBytes += level.width * level.height * (index ? 20 : 16);
  });
  // RGBA diagnostic reduction pyramid.
  for (let width = nx, height = ny; ; width = Math.ceil(width / 2), height = Math.ceil(height / 2)) {
    workingBytes += 16 * width * height;
    if (width === 1 && height === 1) break;
  }
  // Historical material fields are packed into RG8: two bytes per cell.
  const snapshotBytes = 2 * nx * ny;
  const historyLimit = Math.min(
    cfg.maxSnapshots,
    Math.floor(INSTABILITY_HISTORY_BYTES / snapshotBytes)
  );
  return {
    cfg,
    nx,
    ny,
    h,
    levels,
    workingBytes,
    snapshotBytes,
    historyLimit,
    totalBytes: workingBytes + snapshotBytes * historyLimit,
  };
}

export class InstabilitySolver {
  constructor(canvas, layout, shaders, palette) {
    this.layout = layout;
    this.canvas = canvas;
    this.config = this.layout.cfg;
    this.nx = this.layout.nx;
    this.ny = this.layout.ny;
    this.h = this.layout.h;
    this.history = [];
    this.historyLimit = this.layout.historyLimit;
    this.historyError = '';
    this.viewIndex = -1;
    this.palette = palette;
    this.canvas.style.aspectRatio = `${this.nx} / ${this.ny}`;
    this.time = 0;
    this.steps = 0;
    this.stats = new Float32Array(4);
    this.targets = [];
    this.programs = {};
    this.levels = [];
    this.reductions = [];
    this.gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
    });
    if (!this.gl) throw new Error('WebGL 2 is unavailable on this device.');
    const gl = this.gl;
    try {
      if (!gl.getExtension('EXT_color_buffer_float'))
        throw new Error('This device cannot use the required floating-point graphics buffers.');
      gl.disable(gl.BLEND);
      gl.disable(gl.DITHER);
      gl.disable(gl.DEPTH_TEST);
      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);
      // Compile all shared and problem-specific shader passes once.
      for (const [name, source] of Object.entries(shaders))
        this.programs[name] = this.program(source, name);

      // Ping-pong simulation fields.
      this.velocity = this.pair(this.nx, this.ny + 1, 2);
      this.material = this.pair(this.nx, this.ny, 1);
      this.materialStage = this.target(this.nx, this.ny, 1);

      // Variable-density pressure multigrid hierarchy.
      for (const geometry of this.layout.levels) {
        const { width, height } = geometry;
        this.levels.push({
          ...geometry,
          pressure: this.pair(width, height, 1),
          rhs: this.target(width, height, 1),
          residual: this.target(width, height, 1),
          material: this.levels.length ? this.target(width, height, 1) : this.material.read,
        });
      }
      // GPU reduction hierarchy for CFL and convergence diagnostics.
      for (let w = this.nx, h = this.ny; ; w = Math.ceil(w / 2), h = Math.ceil(h / 2)) {
        this.reductions.push(this.target(w, h, 4));
        if (w === 1 && h === 1) break;
      }
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  // Finish startup after the problem file has initialized material and velocity.
  finishInitialization() {
    this.measure(this.velocity.read);
    this.initialMass = this.stats[3];
    this.captureSnapshot();
    this.render();
  }

  // Compile programs once and report the exact failed GPU pass on error.
  program(source, passName) {
    const gl = this.gl,
      shaders = [];
    let program;
    try {
      for (const [type, text] of [
        [gl.VERTEX_SHADER, INSTABILITY_VERTEX],
        [gl.FRAGMENT_SHADER, source],
      ]) {
        const shader = gl.createShader(type);
        shaders.push(shader);
        gl.shaderSource(shader, text);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          const stage = type === gl.VERTEX_SHADER ? 'vertex' : 'fragment';
          const log = gl.getShaderInfoLog(shader) || 'No WebGL compiler log was returned.';
          throw new Error(`GPU pass "${passName}" ${stage} shader failed to compile:\n${log}`);
        }
      }
      program = gl.createProgram();
      shaders.forEach((shader) => gl.attachShader(program, shader));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(program) || 'No WebGL linker log was returned.';
        throw new Error(`GPU pass "${passName}" failed to link:\n${log}`);
      }
      const uniforms = {};
      for (let i = 0; i < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); i++) {
        const name = gl.getActiveUniform(program, i).name;
        uniforms[name] = gl.getUniformLocation(program, name);
      }
      return { program, uniforms };
    } catch (error) {
      if (program) gl.deleteProgram(program);
      throw error;
    } finally {
      shaders.forEach((shader) => gl.deleteShader(shader));
    }
  }

  // Store viewing snapshots in two bytes per cell without CPU readback.
  target(width, height, channels, packed = false) {
    const gl = this.gl;
    const allocationError = 'The simulation buffers could not be allocated. Try the lower resolution.';
    const target = {
      texture: null,
      framebuffer: null,
      width,
      height,
      channels,
      bytes: width * height * (packed ? 2 : channels * 4),
    };
    this.targets.push(target);
    try {
      // Register partial resources so every failure can release them.
      target.texture = gl.createTexture();
      target.framebuffer = gl.createFramebuffer();
      const { texture, framebuffer } = target;
      if (!texture || !framebuffer) {
        gl.getError();
        throw new Error(allocationError);
      }

      gl.bindTexture(gl.TEXTURE_2D, texture);
      for (const key of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER])
        gl.texParameteri(gl.TEXTURE_2D, key, gl.NEAREST);
      for (const key of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T])
        gl.texParameteri(gl.TEXTURE_2D, key, gl.CLAMP_TO_EDGE);
      const internal = packed
        ? gl.RG8
        : channels === 1
         ? gl.R32F
         : channels === 2
          ? gl.RG32F
          : gl.RGBA32F;
      const format = channels === 1 ? gl.RED : channels === 2 ? gl.RG : gl.RGBA;
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        internal,
        width,
        height,
        0,
        format,
        packed ? gl.UNSIGNED_BYTE : gl.FLOAT,
        null
      );
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      this.clear(target);
      const error = gl.getError();
      if (!complete || error !== gl.NO_ERROR) throw new Error(allocationError);
      return target;
    } catch (error) {
      this.release(target);
      throw error;
    }
  }
  release(target) {
    if (target.texture) this.gl.deleteTexture(target.texture);
    if (target.framebuffer) this.gl.deleteFramebuffer(target.framebuffer);
    const index = this.targets.indexOf(target);
    if (index >= 0) this.targets.splice(index, 1);
  }
  pair(w, h, c) {
    return { read: this.target(w, h, c), write: this.target(w, h, c) };
  }
  swap(pair) {
    [pair.read, pair.write] = [pair.write, pair.read];
  }
  clear(target) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  // Each pass reads existing textures and writes a separate target.
  draw(name, target, textures = {}, values = {}, geometry = this.layout.levels[0]) {
    const gl = this.gl,
      p = this.programs[name];
    gl.useProgram(p.program);
    const uniforms = {
      grid: [geometry.width, geometry.height],
      h: geometry.h,
      dt: 0,
      atwood: this.config.atwood,
      ...values,
    };
    let unit = 0;
    for (const [key, field] of Object.entries(textures)) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, field.texture);
      gl.uniform1i(p.uniforms[key], unit++);
    }
    for (const [key, value] of Object.entries(uniforms)) {
      if (p.uniforms[key] == null) continue;
      if (key === 'grid') gl.uniform2i(p.uniforms[key], ...value);
      else if (Array.isArray(value) && value.length === 3) gl.uniform3f(p.uniforms[key], ...value);
      else if (Array.isArray(value)) gl.uniform2f(p.uniforms[key], ...value);
      else gl.uniform1f(p.uniforms[key], value);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.framebuffer : null);
    gl.viewport(
      0,
      0,
      target ? target.width : this.canvas.width,
      target ? target.height : this.canvas.height
    );
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // Weighted Jacobi pressure smoothing.
  smooth(level, count) {
    for (let i = 0; i < count; i++) {
      this.draw(
        'smooth',
        level.pressure.write,
        { pressure: level.pressure.read, rhs: level.rhs, material: level.material },
        {},
        level
      );
      this.swap(level.pressure);
    }
  }

  // Multigrid removes large-scale pressure error without hundreds of fine-grid sweeps.
  cycle(index = 0) {
    const level = this.levels[index];
    if (index === this.levels.length - 1) {
      // Approximate the coarsest solve with many smoothing sweeps.
      this.smooth(level, Math.max(40, Math.ceil(Math.max(level.width, level.height) ** 2 / 4)));
      return;
    }
    // Pre-smooth, restrict the residual, solve coarse error, then correct.
    this.smooth(level, 4);
    this.draw(
      'residual',
      level.residual,
      { pressure: level.pressure.read, rhs: level.rhs, material: level.material },
      {},
      level
    );
    const coarse = this.levels[index + 1];
    this.draw('restrict', coarse.rhs, { source: level.residual }, {}, coarse);
    this.clear(coarse.pressure.read);
    this.cycle(index + 1);
    this.draw(
      'prolong',
      level.pressure.write,
      { pressure: level.pressure.read, coarse: coarse.pressure.read },
      {},
      level
    );
    this.swap(level.pressure);
    // Post-smoothing removes high-frequency error from prolongation.
    this.smooth(level, 4);
  }

  // Read four reduced values instead of copying the full fluid state to JavaScript.
  measure(velocity) {
    this.draw('diagnostics', this.reductions[0], { velocity, material: this.material.read });
    for (let i = 1; i < this.reductions.length; i++) {
      this.draw('reduce', this.reductions[i], { source: this.reductions[i - 1] });
    }

    // Failed or partial reads must never reuse earlier diagnostics.
    const gl = this.gl;
    this.stats.fill(NaN);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, this.stats);
    if (this.stats.some((value) => !Number.isFinite(value))) {
      throw new Error('Graphics diagnostics could not be read. Reset to start again.');
    }
    if (this.stats.some((value) => value < 0) || this.stats[3] === 0) {
      throw new Error('The simulation stopped after a numerical error. Reset to start again.');
    }
  }

  nextDt() {
    const h = this.h,
      cfg = this.config;
    // Acceleration-aware CFL limit combines current velocity and buoyancy growth.
    const acceleration = (Math.abs(cfg.gravity) * cfg.atwood) / (1 - cfg.atwood);
    const speed = this.stats[0] + this.stats[1];
    const advective =
      (2 * cfg.cfl * h) / (speed + Math.sqrt(speed * speed + 4 * acceleration * cfg.cfl * h) + 1e-12);
    // Conservative stability limit for explicit viscous diffusion.
    const diffusion = cfg.viscosity > 0 ? (0.2 * h * h) / (2 * cfg.viscosity) : Infinity;
    let dt = Math.min(cfg.maxDt, advective, diffusion);
    // Land exactly on scheduled snapshot times.
    if (this.recording) dt = Math.min(dt, this.history.length * cfg.saveInterval - this.time);
    return dt;
  }

  step(dt = this.nextDt()) {
    dt = Math.min(dt, this.nextDt());
    if (!Number.isFinite(dt) || dt <= 0)
      throw new Error('The timestep could not be calculated. Reset to start again.');
    // SSP-RK2 material advection.
    this.draw(
      'material',
      this.materialStage,
      { source: this.material.read, original: this.material.read, velocity: this.velocity.read },
      { dt, stage: 0 }
    );
    this.draw(
      'material',
      this.material.write,
      { source: this.materialStage, original: this.material.read, velocity: this.velocity.read },
      { dt, stage: 1 }
    );
    this.swap(this.material);

    // Restrict material/density to the multigrid hierarchy.
    this.levels[0].material = this.material.read;
    for (let i = 1; i < this.levels.length; i++)
      this.draw(
        'restrict',
        this.levels[i].material,
        { source: this.levels[i - 1].material },
        {},
        this.levels[i]
      );
    // Advect velocity, diffuse viscosity, and apply body acceleration.
    this.draw(
      'momentum',
      this.velocity.write,
      { velocity: this.velocity.read, material: this.material.read },
      { dt, gravity: this.config.gravity, viscosity: this.config.viscosity }
    );
    this.swap(this.velocity);

    // Pressure projection: solve for pressure and enforce divergence-free flow.
    // Pressure is defined only up to an additive constant. Projection uses only its gradient,
    // so the multigrid solve does not need to pin an arbitrary reference pressure.
    this.draw('divergence', this.levels[0].rhs, { velocity: this.velocity.read });
    let cycles = 0;
    // Cap pressure work to six V-cycles per timestep.
    do {
      this.cycle();
      cycles++;
      this.draw('project', this.velocity.write, {
        velocity: this.velocity.read,
        pressure: this.levels[0].pressure.read,
        material: this.material.read,
      });
      this.measure(this.velocity.write);
    } while (this.stats[2] * dt > this.config.pressureTolerance && cycles < 6);
    // Hard failure threshold after the bounded pressure solve.
    if (this.stats[2] * dt > 0.002)
      throw new Error('The pressure solve could not settle. Reset or try the lower resolution.');
    this.swap(this.velocity);

    // Advance bookkeeping and validate material conservation.
    this.time += dt;
    this.steps++;
    this.lastCycles = cycles;
    // Stop if total material fraction drifts by more than 2%.
    if (Math.abs(this.stats[3] - this.initialMass) / this.initialMass > 0.02)
      throw new Error('Material balance changed too much. Reset to start a new run.');
    // Small tolerance avoids missing a snapshot to floating-point roundoff.
    if (this.recording && this.time >= this.history.length * this.config.saveInterval - 1e-10) {
      this.time = this.history.length * this.config.saveInterval;
      this.captureSnapshot();
    }
  }

  get recording() {
    return !this.historyError && this.history.length < this.historyLimit;
  }
  get displayedTime() {
    return this.viewIndex < 0 ? this.time : this.history[this.viewIndex].time;
  }

  // Stop recording at the limit while keeping the live simulation available.
  captureSnapshot() {
    if (!this.recording) return;
    let field;
    try {
      field = this.target(this.nx, this.ny, 2, true);
      this.draw('snapshot', field, { material: this.material.read });
      if (this.gl.getError() !== this.gl.NO_ERROR) throw new Error('Snapshot storage is unavailable.');
      this.history.push({ time: this.time, field });
    } catch (error) {
      if (field) this.release(field);
      this.historyError = 'Snapshot recording stopped. The live simulation can continue.';
    }
  }
  showSnapshot(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.history.length) return;
    this.viewIndex = index;
    this.render();
  }
  showLive() {
    this.viewIndex = -1;
    this.render();
  }

  render() {
    const rect = this.canvas.getBoundingClientRect();
    // Cap display pixel density; simulation resolution is unchanged.
    const scale = Math.min(globalThis.devicePixelRatio || 1, 2);
    const width = Math.max(2, Math.round(rect.width * scale));
    const height = Math.max(4, Math.round(rect.height * scale));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    const field = this.viewIndex < 0 ? this.material.read : this.history[this.viewIndex].field;
    this.draw(
      'display',
      null,
      { material: field },
      {
        viewport: [width, height],
        isSnapshot: this.viewIndex < 0 ? 0 : 1,
        lightColor: this.palette.light,
        heavyColor: this.palette.heavy,
      }
    );
  }
  dispose() {
    const gl = this.gl;
    if (!gl) return;
    for (const t of this.targets) {
      gl.deleteTexture(t.texture);
      gl.deleteFramebuffer(t.framebuffer);
    }
    for (const p of Object.values(this.programs)) gl.deleteProgram(p.program);
    if (this.vao) gl.deleteVertexArray(this.vao);
    this.targets = [];
    this.programs = {};
    this.history = [];
    this.viewIndex = -1;
  }
}
