import { EulerSolver, Ru } from './shock-physics.js';

// Optional WebGPU backend. The CPU solver remains the reference/default.
// All four SSP-RK(4,3) stages, HLLC/Rusanov fluxes, CFL reductions, retries and
// tracer updates stay on the device. Only completed snapshots leave the GPU.
// Units are normalized before upload to improve f32 conditioning in SI runs.
// Power-of-two workgroup size for parallel reductions, not a CFL parameter.
const WORKGROUP = 128;
const CONTROL_BYTES = 384; // 128-byte header and up to 16 vec4 tracers
const floatLiteral = value => `${Math.fround(value).toExponential(9)}f`;

function shaderSource(solver) {
    const m = solver.numMaterials;
    return `
const N = ${solver.nx}u;
const M = ${m}u;
const GROUPS = ${Math.ceil(solver.nx / WORKGROUP)}u;
const DX = ${floatLiteral(1 / solver.nx)};
const CFL = ${floatLiteral(solver.cfl)};
const CLOSED_L = ${solver.leftBoundary === 'closed'};
const CLOSED_R = ${solver.rightBoundary === 'closed'};
const BETA = array<f32, M>(${solver.materialBeta.map(floatLiteral).join(',')});
const INV_MW = array<f32, M>(${solver.materialInverseMW.map(v => floatLiteral(v * solver.mwScale)).join(',')});
override stage: u32 = 0u;

struct Cell {
    q: vec4f,                 // density, momentum, total energy, unused
    w: vec4f,                 // velocity, pressure, sound speed, molar density
    material: array<vec2f, M> // volume fraction, partial density
}
struct Face {
    flux: vec4f,              // three conservative fluxes and face velocity
    material: array<vec2f, M>
}
struct Control {
    dt: f32, speed: f32, elapsed: f32, correction: f32,
    duration: f32, enabled: u32, failed: u32, attempt: u32,
    steps: u32, retries: u32, fallbacks: atomic<u32>, fatal: u32,
    boundary: vec4f,
    transfer: vec4f,
    boundaryCorrection: vec4f,
    originalSpeed: f32, startTime: f32, pad0: f32, pad1: f32,
    pad2: vec4f,
    tracers: array<vec4f, 16> // position, active, exit time, position compensation
}
@group(0) @binding(0) var<storage, read> source: array<Cell>;
@group(0) @binding(1) var<storage, read_write> destination: array<Cell>;
@group(0) @binding(2) var<storage, read_write> original: array<Cell>;
@group(0) @binding(3) var<storage, read_write> faces: array<Face>;
@group(0) @binding(4) var<storage, read_write> metrics: array<vec2f>;
@group(0) @binding(5) var<storage, read_write> control: Control;
@group(0) @binding(6) var<storage, read_write> output: array<vec4f>;

// Bit tests also reject infinities/NaNs on implementations optimizing f32 math.
fn finite(v: f32) -> bool { return (bitcast<u32>(v) & 0x7f800000u) != 0x7f800000u; }
fn running() -> bool { return control.enabled != 0u && control.failed == 0u; }

@compute @workgroup_size(1)
fn prepare() {
    control.enabled = 0u;
    if (control.fatal != 0u || control.elapsed >= control.duration) { return; }
    control.failed = 0u;
    if (control.attempt == 0u) {
        control.dt = min(CFL * DX / control.speed, control.duration - control.elapsed);
        control.originalSpeed = control.speed;
    }
    if (!(control.dt > 0.0f) || !finite(control.dt) || control.elapsed + control.dt == control.elapsed) {
        control.fatal = 1u;
        return;
    }
    control.transfer = vec4f(0.0f);
    control.enabled = 1u;
}

@compute @workgroup_size(${WORKGROUP})
fn fluxes(@builtin(global_invocation_id) id: vec3u) {
    let i = id.x;
    if (i > N || !running()) { return; }
    // The first flux dispatch also saves each cell exactly once. Later stages
    // and tracer integration read this backup only after this dispatch finishes.
    if (stage == 0u && i < N && control.attempt == 0u) { original[i] = source[i]; }
    let l = select(i - 1u, 0u, i == 0u);
    let r = min(N - 1u, i);
    let a = source[l]; let b = source[r];
    let rhoL = a.q.x; let rhoR = b.q.x;
    let uL = select(a.w.x, -a.w.x, i == 0u && CLOSED_L);
    let uR = select(b.w.x, -b.w.x, i == N && CLOSED_R);
    let pL = a.w.y; let pR = b.w.y;
    let EL = a.q.z; let ER = b.q.z;
    var f: vec3f;
    var velocity = 0.0f;
    var upwind = l;
    var fallback = false;
    var speed = 0.0f;
    if (control.attempt == 0u && pL == pR && uL == uR) {
        velocity = uL;
        upwind = select(r, l, uL >= 0.0f);
        let q = source[upwind].q;
        f = vec3f(q.x * uL, q.x * uL * uL + pL, uL * (q.z + pL));
    } else {
        let SL = min(uL - a.w.z, uR - b.w.z);
        let SR = max(uL + a.w.z, uR + b.w.z);
        speed = max(abs(SL), abs(SR));
        let ss = (pR - pL + rhoL * uL * (SL - uL) - rhoR * uR * (SR - uR)) /
                 (rhoL * (SL - uL) - rhoR * (SR - uR));
        let starL = rhoL * (SL - uL) / (SL - ss);
        let starR = rhoR * (SR - uR) / (SR - ss);
        let ps = pL + rhoL * (SL - uL) * (ss - uL);
        let esL = ((SL - uL) * EL - pL * uL + ps * ss) / (SL - ss);
        let esR = ((SR - uR) * ER - pR * uR + ps * ss) / (SR - ss);
        fallback = control.attempt > 0u || !finite(ss) || ss <= SL || ss >= SR ||
            !(ps > 0.0f) || !(starL > 0.0f) || !(starR > 0.0f) ||
            !(esL > 0.5f * starL * ss * ss) || !(esR > 0.5f * starR * ss * ss);
        if (fallback) {
            atomicAdd(&control.fallbacks, 1u);
            velocity = 0.5f * (uL + uR);
            f = 0.5f * (vec3f(rhoL * uL, rhoL * uL * uL + pL, uL * (EL + pL)) +
                        vec3f(rhoR * uR, rhoR * uR * uR + pR, uR * (ER + pR)) -
                        speed * vec3f(rhoR - rhoL, rhoR * uR - rhoL * uL, ER - EL));
        } else if (SL >= 0.0f) {
            velocity = uL; upwind = l;
            f = vec3f(rhoL * uL, rhoL * uL * uL + pL, uL * (EL + pL));
        } else if (SR <= 0.0f) {
            velocity = uR; upwind = r;
            f = vec3f(rhoR * uR, rhoR * uR * uR + pR, uR * (ER + pR));
        } else {
            velocity = ss; upwind = select(r, l, ss >= 0.0f);
            let density = select(starR, starL, ss >= 0.0f);
            let energy = select(esR, esL, ss >= 0.0f);
            f = vec3f(density * ss, density * ss * ss + ps, ss * (energy + ps));
        }
    }
    faces[i].flux = vec4f(f, velocity);
    for (var k = 0u; k < M; k++) {
        if (fallback) {
            faces[i].material[k] = 0.5f * (uL * a.material[k] + uR * b.material[k] -
                                               speed * (b.material[k] - a.material[k]));
        } else {
            let material = source[upwind].material[k];
            faces[i].material[k] = vec2f(velocity * material.x, f.x * material.y / source[upwind].q.x);
        }
    }
}

var<workgroup> speeds: array<f32, ${WORKGROUP}>;
var<workgroup> invalid: array<f32, ${WORKGROUP}>;

@compute @workgroup_size(${WORKGROUP})
fn update(@builtin(global_invocation_id) id: vec3u, @builtin(local_invocation_index) lane: u32,
          @builtin(workgroup_id) group: vec3u) {
    // All lanes reach barriers, including the padding in the last workgroup.
    var speed = 0.0f;
    var bad = 0.0f;
    let i = id.x;
    if (i < N && running()) {
        let a = source[i];
        let left = faces[i]; let right = faces[i + 1u];
        let ratio = control.dt / DX * select(0.5f, 1.0f / 6.0f, stage == 2u);
        var b = a;
        if (stage == 2u) {
            // Difference form preserves uniform states exactly in f32.
            b.q = original[i].q + (a.q - original[i].q) / 3.0f;
        }
        b.q = vec4f(b.q.xyz - ratio * (right.flux.xyz - left.flux.xyz), 0.0f);
        var beta = 0.0f; var molar = 0.0f; var mass = 0.0f; var alpha = 0.0f;
        for (var k = 0u; k < M; k++) {
            var value = a.material[k];
            if (stage == 2u) { value = original[i].material[k] + (value - original[i].material[k]) / 3.0f; }
            value -= ratio * (right.material[k] - left.material[k] -
                                  vec2f(a.material[k].x * (right.flux.w - left.flux.w), 0.0f));
            b.material[k] = value;
            if (!finite(value.x) || !finite(value.y)) { bad = max(bad, 1.0f); }
            // Float32 bound tolerance is wider than the CPU reference's f64 tolerance.
            if (value.x < -2e-6f || value.x > 1.000002f) { bad = max(bad, 2.0f); }
            if (value.y < 0.0f) { bad = max(bad, 3.0f); }
            // Volume fractions are nonconservative and must partition unity.
            // Project only roundoff-sized bound errors, then renormalize locally.
            // Conserved energy, momentum, and partial masses are never clipped.
            b.material[k].x = clamp(value.x, 0.0f, 1.0f);
            beta += b.material[k].x * BETA[k];
            molar += value.y * INV_MW[k];
            mass += value.y; alpha += b.material[k].x;
        }
        // Reject partition errors above 0.02% before normalizing fractions.
        if (abs(alpha - 1.0f) > 2e-4f) { bad = max(bad, 5.0f); }
        for (var k = 0u; k < M; k++) { b.material[k].x /= alpha; }
        beta /= alpha;
        // Recover density from partial masses after a 0.02% consistency check.
        // This avoids float32 drift without rescaling conserved material masses.
        if (abs(mass - b.q.x) > 2e-4f * b.q.x) { bad = max(bad, 4.0f); }
        b.q.x = mass;
        let rho = b.q.x;
        let u = b.q.y / rho;
        let p = (b.q.z - 0.5f * rho * u * u) / beta;
        let sound = sqrt((1.0f + 1.0f / beta) * p / rho);
        speed = abs(u) + sound;
        if (!(rho > 0.0f) || !(p > 0.0f) || !(molar > 0.0f)) { bad = max(bad, 6.0f); }
        if (!finite(molar) || !finite(p) || !finite(u) || !finite(speed)) { bad = max(bad, 7.0f); }
        b.w = vec4f(u, p, sound, molar);
        destination[i] = b;
    }
    speeds[lane] = speed; invalid[lane] = bad;
    workgroupBarrier();
    for (var stride = ${WORKGROUP / 2}u; stride > 0u; stride /= 2u) {
        if (lane < stride) {
            speeds[lane] = max(speeds[lane], speeds[lane + stride]);
            invalid[lane] = max(invalid[lane], invalid[lane + stride]);
        }
        workgroupBarrier();
    }
    if (lane == 0u) { metrics[group.x] = vec2f(speeds[0], invalid[0]); }
}

@compute @workgroup_size(${WORKGROUP})
fn reduce(@builtin(local_invocation_index) lane: u32) {
    var speed = 0.0f; var bad = 0.0f;
    if (running()) {
        for (var i = lane; i < GROUPS; i += ${WORKGROUP}u) {
            speed = max(speed, metrics[i].x); bad = max(bad, metrics[i].y);
        }
    }
    speeds[lane] = speed; invalid[lane] = bad;
    workgroupBarrier();
    for (var stride = ${WORKGROUP / 2}u; stride > 0u; stride /= 2u) {
        if (lane < stride) {
            speeds[lane] = max(speeds[lane], speeds[lane + stride]);
            invalid[lane] = max(invalid[lane], invalid[lane + stride]);
        }
        workgroupBarrier();
    }
    if (lane == 0u) {
        if (running()) {
            speed = speeds[0]; bad = invalid[0];
            if (bad != 0.0f || (stage < 3u && 0.5f * control.dt * speed / DX > 0.95f)) {
                control.failed = 1u;
                control.pad0 = select(bad, 8.0f, bad == 0.0f);
            }
            control.speed = speed;
            control.transfer += control.dt * select(1.0f / 6.0f, 0.5f, stage == 3u) *
                                    vec4f(faces[0].flux.xyz - faces[N].flux.xyz, 0.0f);
        }
        // Even an earlier rejected stage must reach the retry handler. The
        // final update's destination is the completed state for the tracers.
        if (stage == 3u) { finishStep(); }
    }
}

fn velocity(x: f32, old: bool) -> f32 {
    if (x < 0.5f * DX) {
        var u = destination[0].w.x; if (old) { u = original[0].w.x; }
        return select(u, u * max(0.0f, x) / (0.5f * DX), CLOSED_L);
    }
    if (x > 1.0f - 0.5f * DX) {
        var u = destination[N - 1u].w.x; if (old) { u = original[N - 1u].w.x; }
        return select(u, u * max(0.0f, 1.0f - x) / (0.5f * DX), CLOSED_R);
    }
    let l = u32(clamp(floor(x / DX - 0.5f), 0.0f, f32(N - 2u)));
    let fraction = (x - (f32(l) + 0.5f) * DX) / DX;
    var a = destination[l].w.x; var b = destination[l + 1u].w.x;
    if (old) { a = original[l].w.x; b = original[l + 1u].w.x; }
    return a * (1.0f - fraction) + b * fraction;
}

// Accept the step and advance Heun tracers, or halve dt for a rejected stage.
fn finishStep() {
    if (control.enabled == 0u) { return; }
    if (control.failed != 0u) {
        control.attempt++; control.retries++;
        control.dt *= 0.5f;
        control.speed = control.originalSpeed;
        if (control.attempt >= 12u) { control.fatal = 2u; }
        return;
    }
    for (var k = 0u; k + 1u < M; k++) {
        var tracer = control.tracers[k];
        if (tracer.y == 0.0f) { continue; }
        let u = velocity(tracer.x, true);
        let delta = 0.5f * control.dt * (u + velocity(tracer.x + control.dt * u, false)) - tracer.w;
        let next = tracer.x + delta;
        tracer.w = (next - tracer.x) - delta;
        if (next <= 0.0f || next >= 1.0f) {
            let wall = select(1.0f, 0.0f, next <= 0.0f);
            if (!select(CLOSED_R, CLOSED_L, next <= 0.0f)) {
                tracer.y = 0.0f;
                tracer.z = control.startTime + control.elapsed + control.dt * (wall - tracer.x) / (next - tracer.x);
            }
            tracer.x = wall; tracer.w = 0.0f;
        } else { tracer.x = next; }
        control.tracers[k] = tracer;
    }
    // Compensated sums avoid accumulating time, tracer and conservation drift.
    let boundaryDelta = control.transfer - control.boundaryCorrection;
    let boundaryNext = control.boundary + boundaryDelta;
    control.boundaryCorrection = (boundaryNext - control.boundary) - boundaryDelta;
    control.boundary = boundaryNext;
    let delta = control.dt - control.correction;
    let next = control.elapsed + delta;
    control.correction = (next - control.elapsed) - delta;
    if (control.dt >= control.duration - control.elapsed) {
        control.elapsed = control.duration; control.correction = 0.0f;
    } else { control.elapsed = next; }
    control.steps++;
    if (control.steps == 0u) { control.fatal = 3u; }
    control.attempt = 0u;
}

@compute @workgroup_size(${WORKGROUP})
fn restore(@builtin(global_invocation_id) id: vec3u) {
    if (id.x < N && control.enabled != 0u && control.failed != 0u) { destination[id.x] = original[id.x]; }
}

@compute @workgroup_size(${WORKGROUP})
fn snapshot(@builtin(global_invocation_id) id: vec3u) {
    if (id.x < N) {
        let a = source[id.x];
        output[id.x] = vec4f(a.q.x, a.w.x, a.w.y, a.w.w);
    }
}
`;
}

export class EulerGPUSolver extends EulerSolver {
    constructor(config = {}) {
        super(config);
        this.buffers = [];
        this.disposed = false;
        this.pendingSnapshots = [];
        this.snapshotSlot = 0;
        // Host intervals overlap GPU execution and must not be summed as GPU time.
        this.hostTimings = { batches: 0, encodedAttempts: 0, controlWaitMs: 0, snapshotWaitMs: 0, snapshotProcessingMs: 0 };
    }

    async initialize(slabs) {
        if (this.device || this.disposed) throw new Error('Create a new GPU solver for each run.');
        if (!globalThis.navigator?.gpu) throw new Error('WebGPU is unavailable. Uncheck GPU acceleration to use the CPU solver.');
        const started = performance.now();
        try {
            // The reference performs exactly the same validation and slab/cell overlap integration.
            super.initialize(slabs);
            this.rhoScale = Math.max(...this.slabs.map(s => s.density));
            this.velocityScale = this.maxWaveSpeed;
            this.pressureScale = this.rhoScale * this.velocityScale ** 2;
            this.timeScale = this.totalLength / this.velocityScale;
            this.mwScale = Math.min(...this.slabs.map(s => s.mw));
            for (const scale of [this.rhoScale, this.velocityScale, this.pressureScale, this.timeScale, this.mwScale]) {
                if (!(scale > 0) || !Number.isFinite(scale)) throw new Error('Inputs exceed GPU scaling limits. Use the CPU solver.');
            }
            const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
            if (!adapter) throw new Error('No WebGPU adapter is available. Uncheck GPU acceleration to use the CPU solver.');
            this.adapterInfo = adapter.info ? {
                vendor: adapter.info.vendor, architecture: adapter.info.architecture,
                device: adapter.info.device, description: adapter.info.description,
                isFallbackAdapter: adapter.info.isFallbackAdapter
            } : {};
            this.cellStride = Math.ceil((32 + 8 * this.numMaterials) / 16) * 16;
            const faceStride = Math.ceil((16 + 8 * this.numMaterials) / 16) * 16;
            const cellBytes = this.nx * this.cellStride, faceBytes = (this.nx + 1) * faceStride;
            const largest = Math.max(cellBytes, faceBytes);
            if (largest > adapter.limits.maxStorageBufferBindingSize || largest > adapter.limits.maxBufferSize ||
                Math.ceil((this.nx + 1) / WORKGROUP) > adapter.limits.maxComputeWorkgroupsPerDimension) {
                throw new Error('This grid exceeds the GPU buffer limits. Reduce cells or use the CPU solver.');
            }
            this.device = await adapter.requestDevice({ requiredLimits: {
                maxStorageBufferBindingSize: Math.max(128 * 1024 * 1024, largest),
                maxBufferSize: Math.max(256 * 1024 * 1024, largest)
            } });
            const device = this.device;
            device.lost.then(info => { if (!this.disposed) this.gpuError = new Error(`GPU device lost: ${info.message}. Uncheck GPU acceleration to use the CPU solver.`); });
            device.addEventListener('uncapturederror', event => { this.gpuError = new Error(event.error.message); });
            device.pushErrorScope('validation');
            device.pushErrorScope('out-of-memory');
            const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
            this.state = [this.buffer(cellBytes, storage), this.buffer(cellBytes, storage)];
            this.original = this.buffer(cellBytes, storage);
            this.faces = this.buffer(faceBytes, storage);
            this.metrics = this.buffer(Math.ceil(this.nx / WORKGROUP) * 8, storage);
            this.control = this.buffer(CONTROL_BYTES, storage);
            this.output = this.buffer(this.nx * 16, storage);
            this.controlReadback = this.buffer(CONTROL_BYTES, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
            this.snapshotReadbacks = Array.from({ length: 2 }, () =>
                this.buffer(this.nx * 16, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST));
            const initial = new Float32Array(cellBytes / 4);
            for (let i = 0; i < this.nx; i++) {
                const o = i * this.cellStride / 4;
                initial[o] = this.U[3 * i] / this.rhoScale;
                initial[o + 1] = this.U[3 * i + 1] / (this.rhoScale * this.velocityScale);
                initial[o + 2] = this.U[3 * i + 2] / this.pressureScale;
                initial[o + 4] = this.u[i] / this.velocityScale;
                initial[o + 5] = this.p[i] / this.pressureScale;
                initial[o + 6] = this.soundSpeed[i] / this.velocityScale;
                initial[o + 7] = this.rho[i] / this.mw[i] * this.mwScale / this.rhoScale;
                for (let m = 0; m < this.numMaterials; m++) {
                    initial[o + 8 + 2 * m] = this.materialFractions[i * this.numMaterials + m];
                    initial[o + 9 + 2 * m] = this.materialMass[i * this.numMaterials + m] / this.rhoScale;
                }
                // Reject underflow/poorly conditioned kinetic/internal energy before dispatch.
                const pressure = (initial[o + 2] - 0.5 * initial[o + 1] ** 2 / initial[o]) /
                    this.materialFractions.subarray(i * this.numMaterials, (i + 1) * this.numMaterials)
                        .reduce((sum, alpha, m) => sum + alpha * this.materialBeta[m], 0);
                if (!(initial[o] > 0) || !(initial[o + 5] > 0) || !(initial[o + 6] > 0) ||
                    Math.abs(pressure / initial[o + 5] - 1) > 1e-4) {
                    throw new Error('These initial conditions need double precision. Uncheck GPU acceleration.');
                }
            }
            if (!initial.every(Number.isFinite)) throw new Error('Inputs exceed GPU single-precision limits. Use the CPU solver.');
            device.queue.writeBuffer(this.state[0], 0, initial);
            const controls = new Float32Array(CONTROL_BYTES / 4);
            controls[1] = this.maxWaveSpeed / this.velocityScale;
            for (let i = 0; i < this.tracers.length; i++) {
                controls[32 + 4 * i] = this.tracers[i].x / this.totalLength;
                controls[33 + 4 * i] = 1;
            }
            device.queue.writeBuffer(this.control, 0, controls);
            const layout = device.createBindGroupLayout({ entries: Array.from({ length: 7 }, (_, binding) => ({
                binding, visibility: GPUShaderStage.COMPUTE, buffer: { type: binding === 0 ? 'read-only-storage' : 'storage' }
            })) });
            const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
            const module = device.createShaderModule({ code: shaderSource(this) });
            const info = await module.getCompilationInfo();
            const errors = info.messages.filter(message => message.type === 'error');
            if (errors.length) throw new Error(`GPU shader: ${errors.map(e => `${e.lineNum}: ${e.message}`).join('. ')}`);
            this.pipelines = {};
            const requests = [];
            for (const name of ['prepare', 'fluxes', 'restore', 'snapshot', 'update', 'reduce']) {
                for (let stage = 0; stage < (['fluxes', 'update', 'reduce'].includes(name) ? 4 : 1); stage++) {
                    const key = ['fluxes', 'update', 'reduce'].includes(name) ? `${name}${stage}` : name;
                    requests.push(device.createComputePipelineAsync({ layout: pipelineLayout,
                        compute: { module, entryPoint: name, constants: { stage } }
                    }).then(pipeline => { this.pipelines[key] = pipeline; }));
                }
            }
            await Promise.all(requests);
            this.bindings = this.state.map((source, i) => device.createBindGroup({ layout, entries:
                [source, this.state[1 - i], this.original, this.faces, this.metrics, this.control, this.output]
                    .map((buffer, binding) => ({ binding, resource: { buffer } }))
            }));
            const memoryError = await device.popErrorScope(), validationError = await device.popErrorScope();
            if (memoryError || validationError) throw new Error((memoryError || validationError).message);
            this.assertDevice();
            // Drop CPU-only working arrays after initialization. Snapshot formatting
            // needs only x/rho/u/p/T, avoiding duplicate material storage on large grids.
            for (const key of ['U', 'Un', 'gamma', 'mw', 'soundSpeed', 'inverseDensity',
                'flux', 'faceVelocity', 'oldVelocity', 'materialFractions', 'materialMass',
                'fractionsN', 'massN', 'materialFlux', 'fractionFlux']) this[key] = null;
            this.setupMs = performance.now() - started;
            this.warnings.push('GPU acceleration: single-precision calculations. Snapshot precision controls storage only.');
        } catch (error) {
            this.dispose();
            throw error;
        }
    }

    buffer(size, usage) {
        const buffer = this.device.createBuffer({ size, usage });
        this.buffers.push(buffer);
        return buffer;
    }

    assertDevice() {
        if (this.gpuError) throw this.gpuError;
        if (this.disposed) throw new Error('GPU solver has been disposed.');
    }

    dispatch(pass, name, binding = 0, count = 1) {
        pass.setPipeline(this.pipelines[name]);
        pass.setBindGroup(0, this.bindings[binding]);
        pass.dispatchWorkgroups(count);
    }

    // Encode bounded batches: no CPU/GPU round trip between timesteps or stages.
    async advanceBatch(count) {
        this.assertDevice();
        const encoder = this.device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        const cells = Math.ceil(this.nx / WORKGROUP), faces = Math.ceil((this.nx + 1) / WORKGROUP);
        for (let i = 0; i < count; i++) {
            this.dispatch(pass, 'prepare');
            for (let stage = 0; stage < 4; stage++) {
                this.dispatch(pass, `fluxes${stage}`, stage % 2, faces);
                this.dispatch(pass, `update${stage}`, stage % 2, cells);
                this.dispatch(pass, `reduce${stage}`, stage % 2);
            }
            // Fourth reduction also finishes the step, leaving state[0] current.
            this.dispatch(pass, 'restore', 1, cells);
        }
        pass.end();
        encoder.copyBufferToBuffer(this.control, 0, this.controlReadback, 0, CONTROL_BYTES);
        this.device.queue.submit([encoder.finish()]);
        this.hostTimings.batches++;
        this.hostTimings.encodedAttempts += count;
        const waitStarted = performance.now();
        // Attach a rejection handler immediately, including while an older
        // snapshot is being processed or a device is being lost.
        const mapped = this.controlReadback.mapAsync(GPUMapMode.READ).then(() => null, error => error);
        await this.drainSnapshots();
        const mapError = await mapped;
        this.hostTimings.controlWaitMs += performance.now() - waitStarted;
        if (mapError) throw mapError;
        const data = this.controlReadback.getMappedRange().slice(0);
        this.controlReadback.unmap();
        this.assertDevice();
        const integers = new Uint32Array(data), values = new Float32Array(data);
        if (integers[11]) throw new Error(integers[11] === 2
            ? `GPU timestep failed after 12 retries (${['', 'nonfinite material', 'volume fraction bounds', 'negative material density',
                'material mass consistency', 'volume fraction sum', 'nonpositive state', 'nonfinite thermodynamics', 'stage CFL'][values[26]]},
                ${integers[8]} steps). Reduce CFL or use the CPU solver for these conditions.`
            : 'GPU timestep or step count exceeds numerical precision. Use the CPU solver.');
        this.timeSteps = integers[8]; this.retries = integers[9];
        // Count modulo-u32 GPU atomics in double precision between bounded batches.
        this.fallbackFluxes += (integers[10] - (this.lastFallbackCount ?? 0)) >>> 0;
        this.lastFallbackCount = integers[10];
        this.maxWaveSpeed = values[1] * this.velocityScale;
        return values;
    }

    queueSnapshot(values, time) {
        if (this.pendingSnapshots.length >= this.snapshotReadbacks.length) throw new Error('GPU snapshot queue is full.');
        const buffer = this.snapshotReadbacks[this.snapshotSlot];
        this.snapshotSlot = (this.snapshotSlot + 1) % this.snapshotReadbacks.length;
        const encoder = this.device.createCommandEncoder(), pass = encoder.beginComputePass();
        this.dispatch(pass, 'snapshot', 0, Math.ceil(this.nx / WORKGROUP));
        pass.end();
        encoder.copyBufferToBuffer(this.output, 0, buffer, 0, this.nx * 16);
        this.device.queue.submit([encoder.finish()]);
        const mapped = buffer.mapAsync(GPUMapMode.READ).then(() => null, error => error);
        // Control readbacks are already owned copies. Keep the matching time and
        // tracer/conservation state with this download, never with a later step.
        this.pendingSnapshots.push({ buffer, mapped, values, time });
    }

    async drainSnapshots() {
        while (this.pendingSnapshots.length) {
            const pending = this.pendingSnapshots.shift();
            const started = performance.now();
            const error = await pending.mapped;
            this.hostTimings.snapshotWaitMs += performance.now() - started;
            if (error) throw error;
            try {
                this.assertDevice();
                const processing = performance.now();
                this.saveDownloadedSnapshot(new Float32Array(pending.buffer.getMappedRange()), pending.values, pending.time);
                this.hostTimings.snapshotProcessingMs += performance.now() - processing;
            } finally { pending.buffer.unmap(); }
        }
    }

    saveDownloadedSnapshot(fields, values, time) {
        for (let i = 0; i < this.tracers.length; i++) {
            const tracer = this.tracers[i], o = 32 + 4 * i;
            tracer.x = values[o] * this.totalLength;
            if (tracer.active && values[o + 1] === 0) {
                tracer.active = false;
                tracer.exit = { t: values[o + 2] * this.timeScale, x: tracer.x };
                tracer.path.push(tracer.exit);
            }
        }
        const snapshot = { t: time, tracerX: this.tracers.map(tracer => tracer.active ? tracer.x : null), ranges: {} };
        const FieldArray = this.config.snapshotPrecision === '32' ? Float32Array : Float64Array;
        const decimate = this.nx > 8192, stride = decimate ? Math.ceil(this.nx / 1024) : this.nx;
        if (decimate) snapshot.plotIndices = {};
        const keys = ['rho', 'u', 'p', 'T'], factors = [this.rhoScale, this.velocityScale, this.pressureScale];
        for (let field = 0; field < keys.length; field++) {
            const key = keys[field], output = snapshot[key] = new FieldArray(this.nx), working = this[key];
            const indices = decimate ? snapshot.plotIndices[key] = new Uint32Array(Math.ceil(this.nx / stride) * 4) : null;
            let min = Infinity, max = -Infinity, bucket = 0;
            for (let start = 0; start < this.nx; start += stride) {
                const end = Math.min(this.nx, start + stride);
                let low = start, high = start;
                for (let i = start; i < end; i++) {
                    const offset = 4 * i;
                    const value = field < 3 ? fields[offset + field] * factors[field]
                        : this.config.unitSystem === 'arbitrary'
                            ? fields[offset + 2] * this.pressureScale / (fields[offset] * this.rhoScale)
                            : fields[offset + 2] * this.pressureScale / (Ru * fields[offset + 3] * this.rhoScale / this.mwScale);
                    working[i] = value;
                    output[i] = value;
                    const stored = output[i];
                    if (!Number.isFinite(stored) || (field !== 1 && stored <= 0))
                        throw new Error('Snapshot precision cannot represent this state. Select 64-bit snapshots.');
                    min = Math.min(min, stored); max = Math.max(max, stored);
                    if (indices) {
                        if (stored < output[low]) low = i;
                        if (stored > output[high]) high = i;
                    }
                }
                if (indices) {
                    indices[bucket++] = start;
                    indices[bucket++] = Math.min(low, high);
                    indices[bucket++] = Math.max(low, high);
                    indices[bucket++] = end - 1;
                }
            }
            snapshot.ranges[key] = { min, max };
            this.ranges[key].min = Math.min(this.ranges[key].min, min);
            this.ranges[key].max = Math.max(this.ranges[key].max, max);
        }
        const scales = [this.rhoScale, this.rhoScale * this.velocityScale, this.pressureScale];
        for (let i = 0; i < 3; i++) this.boundaryTransfer[i] = values[12 + i] * scales[i] * this.totalLength;
        this.history.push(snapshot);
        for (const tracer of this.tracers) if (tracer.active) tracer.path.push({ t: time, x: tracer.x });
    }

    // Public step advances to the next saved time (individual CFL steps stay on GPU).
    async step(onProgress = () => {}, deferSnapshot = false) {
        this.assertDevice();
        if (!this.device || !this.initialized) throw new Error('Initialize the GPU solver before stepping.');
        if (this.t >= this.finalTime) return false;
        const end = this.nextSnapshotTime;
        const duration = Math.fround((end - this.t) / this.timeScale);
        if (!(duration > 0) || !Number.isFinite(duration)) throw new Error('Snapshot interval exceeds GPU precision. Use the CPU solver.');
        // Reset the interval clock while retaining retry, statistics, and tracer state.
        this.device.queue.writeBuffer(this.control, 8, new Float32Array([0, 0, duration]));
        this.device.queue.writeBuffer(this.control, 100, new Float32Array([this.t / this.timeScale]));
        let values;
        let remaining = duration;
        do {
            const estimatedSteps = remaining * (this.maxWaveSpeed / this.velocityScale) * this.nx / this.cfl;
            const batchLimit = this.nx >= 16384 ? 64 : 32;
            values = await this.advanceBatch(Math.min(batchLimit, Math.max(1, Math.ceil(estimatedSteps))));
            remaining = Math.max(0, duration - values[2]);
            onProgress(Math.min(1, (this.t + values[2] * this.timeScale) / this.finalTime));
        } while (remaining > 0);
        this.t = end; // snapshot timestamps retain CPU double precision and exact scheduling
        this.queueSnapshot(values, end);
        if (!deferSnapshot) await this.drainSnapshots();
        this.snapshotNumber++;
        this.nextSnapshotTime = Math.min(this.snapshotNumber * this.xtInterval, this.finalTime);
        return true;
    }

    async runFullSimulation(onProgress) {
        while (await this.step(onProgress, true)) { /* process saved frames during the next GPU batch */ }
        await this.drainSnapshots();
        return this.history;
    }

    getResult() {
        const result = super.getResult();
        result.config.gpuAcceleration = true;
        Object.assign(result.diagnostics, { backend: 'WebGPU', computationPrecision: '32',
            gpuSetupMs: this.setupMs, adapter: this.adapterInfo, hostTimings: { ...this.hostTimings } });
        return result;
    }

    dispose() {
        this.disposed = true;
        for (const buffer of this.buffers) buffer.destroy();
        this.buffers = [];
        this.device?.destroy();
    }
}

if (typeof self !== 'undefined' && typeof document === 'undefined') {
    self.addEventListener('message', async event => {
        if (!event.data.gpuAcceleration) return;
        let solver;
        try {
            const started = performance.now();
            solver = new EulerGPUSolver(event.data.config);
            await solver.initialize(event.data.slabs);
            let lastProgress = started;
            await solver.runFullSimulation(progress => {
                if (performance.now() - lastProgress > 100) {
                    self.postMessage({ type: 'progress', progress });
                    lastProgress = performance.now();
                }
            });
            const result = solver.getResult();
            result.diagnostics.calculationMs = performance.now() - started;
            const buffers = [result.x.buffer];
            for (const snapshot of result.history) for (const key of ['rho', 'u', 'p', 'T']) {
                buffers.push(snapshot[key].buffer);
                if (snapshot.plotIndices) buffers.push(snapshot.plotIndices[key].buffer);
            }
            self.postMessage({ type: 'complete', result }, buffers);
        } catch (error) {
            self.postMessage({ type: 'error', message: error.message });
        } finally { solver?.dispose(); }
    });
}
