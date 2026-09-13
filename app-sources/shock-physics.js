// Units, validation, solver, and worker.
export const SOLVER_VERSION = '3.0.0';
export const Ru = 8314.46261815324;
export const MAX_MATERIALS = 16;
export const MEMORY_WARNING = 128e6;
export const MEMORY_ACKNOWLEDGEMENT = 256e6;
const MAX_ARRAY_LENGTH = 0xffffffff;

// Factors convert displayed values to SI; MW stays in g/mol.
export const unitSystems = {
    arbitrary: {
        x: 1,
        rho: 1,
        p: 1,
        u: 1,
        T: 1,
        xLbl: '',
        rhoLbl: '',
        pLbl: '',
        uLbl: '',
        tempLbl: '',
        tLbl: ''
    },
    mks: {
        x: 1,
        rho: 1,
        p: 1,
        u: 1,
        T: 1,
        xLbl: 'm',
        rhoLbl: 'kg/m³',
        pLbl: 'Pa',
        uLbl: 'm/s',
        tempLbl: 'K',
        tLbl: 's'
    },
    cgs: {
        x: 0.01,
        rho: 1000,
        p: 0.1,
        u: 0.01,
        T: 1,
        xLbl: 'cm',
        rhoLbl: 'g/cm³',
        pLbl: 'Ba',
        uLbl: 'cm/s',
        tempLbl: 'K',
        tLbl: 's'
    },
    fps: {
        x: 0.3048,
        rho: (0.45359237 * 9.80665) / 0.3048 ** 4,
        p: (0.45359237 * 9.80665) / 0.3048 ** 2,
        u: 0.3048,
        T: 5 / 9,
        xLbl: 'ft',
        rhoLbl: 'slug/ft³',
        pLbl: 'lbf/ft²',
        uLbl: 'ft/s',
        tempLbl: '°R',
        tLbl: 's'
    }
};

// Read a required finite number.
export function readNumber(value, label) {
    if (value === null || value === undefined || String(value).trim() === '')
        throw new Error(`${label} is required.`);
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error(`${label} must be finite.`);
    return number;
}

// Read a number greater than zero.
export function positiveNumber(value, label) {
    const number = readNumber(value, label);
    if (number <= 0) throw new Error(`${label} must be greater than zero.`);
    return number;
}

// Check the heat capacity ratio and molecular weight.
export function validateGas(gas, label = 'Gas') {
    const gamma = readNumber(gas.gamma, `${label} gamma`);
    const mw = positiveNumber(gas.mw, `${label} molecular weight`);
    if (gamma <= 1) throw new Error(`${label} gamma must be greater than 1.`);
    return { gamma, mw };
}

// Convert the specific gas constant to display units.
export function getGasConstant(system, mw) {
    if (!Object.hasOwn(unitSystems, system)) throw new Error('Unknown unit system.');
    positiveNumber(mw, 'Molecular weight');
    if (system === 'arbitrary') return 1;
    const units = unitSystems[system];
    return ((Ru / mw) * units.rho * units.T) / units.p;
}

// Check run settings and representable array sizes.
export function validateConfig(config = {}) {
    const result = {
        gridCells: readNumber(config.gridCells ?? 500, 'Grid cells'),
        cflNumber: readNumber(config.cflNumber ?? 0.75, 'CFL number'),
        maxTime: positiveNumber(config.maxTime ?? 0.2, 'Max time'),
        snapshotInterval: positiveNumber(config.snapshotInterval ?? 0.0005, 'Snapshot interval'),
        snapshotPrecision: String(config.snapshotPrecision ?? '32'),
        leftBoundary: config.leftBoundary ?? 'closed',
        rightBoundary: config.rightBoundary ?? 'closed',
        unitSystem: config.unitSystem ?? 'arbitrary',
        displayUnits: config.displayUnits ?? config.unitSystem ?? 'arbitrary'
    };
    if (!Number.isSafeInteger(result.gridCells) || result.gridCells < 100)
        throw new Error('Grid cells must be a whole number of at least 100.');
    if (!['32', '64'].includes(result.snapshotPrecision))
        throw new Error('Snapshot precision must be 32-bit or 64-bit.');
    if (result.cflNumber < 0.01 || result.cflNumber > 0.95)
        throw new Error('CFL number must be from 0.01 to 0.95.');
    if (
        !['closed', 'open'].includes(result.leftBoundary) ||
        !['closed', 'open'].includes(result.rightBoundary)
    )
        throw new Error('Unknown boundary condition.');
    if (!['arbitrary', 'mks'].includes(result.unitSystem))
        throw new Error('The solver requires SI or arbitrary inputs. Convert display units first.');
    if (!Object.hasOwn(unitSystems, result.displayUnits)) throw new Error('Unknown display units.');
    if ((result.unitSystem === 'arbitrary') !== (result.displayUnits === 'arbitrary'))
        throw new Error('Arbitrary and physical units require separate runs.');
    const snapshots = Math.max(2, Math.ceil(result.maxTime / result.snapshotInterval) + 1);
    if (!Number.isSafeInteger(snapshots) || snapshots > MAX_ARRAY_LENGTH ||
        !Number.isSafeInteger(snapshots * result.gridCells * 32) ||
        (result.gridCells + 1) * MAX_MATERIALS > MAX_ARRAY_LENGTH)
        throw new Error('Requested arrays exceed supported index sizes. Reduce cells or snapshots.');
    return result;
}

// Estimate storage without allocating the requested history.
export function estimateResources(config, materials = 2, retainedBytes = 0, plotBytes = 0) {
    const snapshots = Math.max(2, Math.ceil(config.maxTime / config.snapshotInterval) + 1);
    const cells = config.gridCells, tracers = Math.max(0, materials - 1);
    const digits = config.snapshotPrecision === '32' ? 9 : 17;
    const fieldBytes = cells * snapshots * 4 * (config.snapshotPrecision === '32' ? 4 : 8);
    const previewBytes = cells > 8192 ? 4 * 4096 * 4 : 0;
    const historyBytes = fieldBytes + cells * 8 + snapshots * (768 + tracers * 128 + previewBytes);
    const workingBytes = 8 * ((20 + 6 * materials) * cells + 4 + 2 * materials);
    const overheadBytes = 32 * 1024 * 1024;
    const csvBytes = cells * snapshots * (2 * 24 + 4 * (digits + 8) + 7) + 16384;
    const tracerCsvBytes = snapshots * tracers * 70 + 16384;
    const runBytes = retainedBytes + historyBytes + workingBytes + plotBytes + overheadBytes;
    return { snapshots, fieldBytes, historyBytes, workingBytes, csvBytes, tracerCsvBytes,
        runBytes, residentBytes: historyBytes + plotBytes + overheadBytes };
}

// Check every material section and its total length.
export function validateSlabs(slabs) {
    if (!Array.isArray(slabs) || slabs.length < 1 || slabs.length > MAX_MATERIALS)
        throw new Error(`Use 1 to ${MAX_MATERIALS} material sections.`);
    const result = slabs.map((slab, i) => {
        const label = `Section ${i + 1}`;
        return {
            name: String(slab.name ?? label),
            ...validateGas(slab, label),
            length: positiveNumber(slab.length, `${label} length`),
            density: positiveNumber(slab.density, `${label} density`),
            pressure: positiveNumber(slab.pressure, `${label} pressure`),
            velocity: readNumber(slab.velocity, `${label} velocity`)
        };
    });
    let length = 0;
    for (const slab of result) {
        const next = length + slab.length;
        if (!Number.isFinite(next) || next <= length)
            throw new Error('Section lengths exceed numerical precision.');
        length = next;
    }
    return result;
}

// Convert displayed section values to solver units.
export function toInternalSlabs(slabs, system) {
    if (!Object.hasOwn(unitSystems, system)) throw new Error('Unknown unit system.');
    const units = unitSystems[system];
    return validateSlabs(slabs).map((slab) => ({
        ...slab,
        length: slab.length * units.x,
        density: slab.density * units.rho,
        pressure: slab.pressure * units.p,
        velocity: slab.velocity * units.u
    }));
}

// Combine gases using normalized mole fractions.
export function calculateMixture(components) {
    if (!components.length || components.length > MAX_MATERIALS)
        throw new Error(`Use 1 to ${MAX_MATERIALS} constituents.`);
    let total = 0,
        sumMW = 0,
        sumCv = 0;
    for (const component of components) {
        const percent = readNumber(component.percent, 'Mole percentage');
        const gas = validateGas(component);
        if (percent < 0 || percent > 100)
            throw new Error('Each mole percentage must be from 0 to 100.');
        total += percent;
        sumMW += percent * gas.mw;
        sumCv += percent / (gas.gamma - 1);
    }
    if (Math.abs(total - 100) > 0.1 + 1e-12)
        throw new Error('Mole percentages must total 100% within 0.1%.');
    return validateGas({ gamma: 1 + total / sumCv, mw: sumMW / total }, 'Mixture');
}

// Add units only when a physical unit is selected.
export function unitLabel(label, units, separator = ' ') {
    return units ? `${label}${separator}(${units})` : label;
}

// Fluid solver.
// First-order finite volumes with coupled SSP-RK(4,3) stages.
export class EulerSolver {
    // Allocate the grid and reusable solver arrays.
    constructor(config = {}) {
        this.config = validateConfig(config);
        this.nx = this.config.gridCells;
        this.cfl = this.config.cflNumber;
        this.finalTime = this.config.maxTime;
        this.xtInterval = this.config.snapshotInterval;
        this.leftBoundary = this.config.leftBoundary;
        this.rightBoundary = this.config.rightBoundary;
        this.x = new Float64Array(this.nx);
        this.U = new Float64Array(this.nx * 3);
        this.Un = new Float64Array(this.U.length);
        this.rho = new Float64Array(this.nx);
        this.u = new Float64Array(this.nx);
        this.p = new Float64Array(this.nx);
        this.T = new Float64Array(this.nx);
        this.gamma = new Float64Array(this.nx);
        this.mw = new Float64Array(this.nx);
        this.soundSpeed = new Float64Array(this.nx);
        this.inverseDensity = new Float64Array(this.nx);
        this.flux = new Float64Array((this.nx + 1) * 3);
        this.faceVelocity = new Float64Array(this.nx + 1);
        this.oldVelocity = new Float64Array(this.nx);
        this.initialized = false;
    }

    // Fill cells from the initial material sections.
    initialize(slabs) {
        this.initialized = false;
        this.slabs = validateSlabs(slabs);
        this.totalLength = this.slabs.reduce((sum, slab) => sum + slab.length, 0);
        this.dx = this.totalLength / this.nx;
        if (!(this.dx > 0) || !Number.isFinite(1 / this.dx))
            throw new Error('The grid spacing exceeds numerical precision.');
        this.numMaterials = this.slabs.length;
        this.materialProperties = this.slabs.map((slab) => ({
            gamma: slab.gamma,
            mw: slab.mw,
            gasId: slab.name
        }));
        this.materialBeta = this.slabs.map((slab) => 1 / (slab.gamma - 1));
        this.materialInverseMW = this.slabs.map((slab) => 1 / slab.mw);
        const size = this.nx * this.numMaterials;
        this.materialFractions = new Float64Array(size);
        this.materialMass = new Float64Array(size);
        this.fractionsN = new Float64Array(size);
        this.massN = new Float64Array(size);
        this.materialFlux = new Float64Array((this.nx + 1) * this.numMaterials);
        this.fractionFlux = new Float64Array(this.materialFlux.length);
        this.U.fill(0);
        this.t = 0;
        this.dt = 0;
        this.timeSteps = 0;
        this.snapshotNumber = 1;
        this.nextSnapshotTime = Math.min(this.xtInterval, this.finalTime);
        this.history = [];
        this.ranges = Object.fromEntries(
            ['rho', 'u', 'p', 'T'].map((key) => [key, { min: Infinity, max: -Infinity }])
        );
        this.tracers = [];
        this.warnings = [];
        this.retries = 0;
        this.fallbackFluxes = 0;
        this.boundaryTransfer = new Float64Array(3);
        this.stepTransfer = new Float64Array(3);
        let start = 0;

        // Integrate slab overlaps so thin sections retain their mass.
        for (let m = 0; m < this.numMaterials; m++) {
            const slab = this.slabs[m];
            const end = start + slab.length;
            const cellStart = start / this.dx;
            const cellEnd = m === this.numMaterials - 1 ? this.nx : end / this.dx;
            if (cellEnd <= cellStart) throw new Error(`Section ${m + 1} cannot be represented on this grid.`);
            const energy =
                slab.pressure / (slab.gamma - 1) + 0.5 * slab.density * slab.velocity ** 2;
            if (slab.length < 2 * this.dx)
                this.warnings.push(
                    `Section ${m + 1} spans fewer than two cells; increase resolution for its wave structure.`
                );
            for (let i = 0; i < this.nx; i++) {
                // Measure overlap in cell coordinates to avoid subtracting nearby positions.
                const alpha = Math.max(0, Math.min(i + 1, cellEnd) - Math.max(i, cellStart));
                const mass = alpha * slab.density;
                this.materialFractions[i * this.numMaterials + m] = alpha;
                this.materialMass[i * this.numMaterials + m] = mass;
                this.U[3 * i] += mass;
                this.U[3 * i + 1] += mass * slab.velocity;
                this.U[3 * i + 2] += alpha * energy;
            }
            if (m < this.numMaterials - 1)
                this.tracers.push({ initialX: end, x: end, active: true, exit: null, path: [] });
            start = end;
        }
        for (let i = 0; i < this.nx; i++) this.x[i] = (i + 0.5) * this.dx;
        this.updatePrimitives();
        this.saveSnapshot();
        this.initialized = true;
    }

    // Recover gas properties and check each cell state.
    updatePrimitives() {
        this.maxWaveSpeed = 0;
        for (let i = 0; i < this.nx; i++) {
            let beta = 0,
                molarDensity = 0,
                mass = 0,
                totalAlpha = 0;
            const offset = i * this.numMaterials;
            for (let m = 0; m < this.numMaterials; m++) {
                const alpha = this.materialFractions[offset + m];
                const partialMass = this.materialMass[offset + m];
                if (
                    !Number.isFinite(alpha) ||
                    alpha < -1e-12 ||
                    alpha > 1 + 1e-12 ||
                    !Number.isFinite(partialMass) ||
                    partialMass < 0
                )
                    throw new Error(`Invalid material state in cell ${i + 1}.`);
                totalAlpha += alpha;
                beta += alpha * this.materialBeta[m];
                molarDensity += partialMass * this.materialInverseMW[m];
                mass += partialMass;
            }
            const rho = this.U[3 * i];
            const velocity = this.U[3 * i + 1] / rho;
            const internalEnergy = this.U[3 * i + 2] - 0.5 * rho * velocity ** 2;
            const pressure = internalEnergy / beta;
            if (
                Math.abs(totalAlpha - 1) > 1e-9 ||
                Math.abs(mass - rho) > 1e-9 * rho ||
                !(rho > 0) ||
                !(pressure > 0) ||
                !Number.isFinite(pressure) ||
                !Number.isFinite(velocity)
            )
                throw new Error(
                    `Nonphysical state in cell ${i + 1}. Reduce CFL or revise the initial conditions.`
                );
            this.rho[i] = rho;
            this.u[i] = velocity;
            this.p[i] = pressure;
            this.gamma[i] = 1 + 1 / beta;
            this.inverseDensity[i] = 1 / rho;
            this.soundSpeed[i] = Math.sqrt(this.gamma[i] * pressure * this.inverseDensity[i]);
            this.maxWaveSpeed = Math.max(
                this.maxWaveSpeed,
                Math.abs(velocity) + this.soundSpeed[i]
            );
            this.mw[i] = rho / molarDensity;
            this.T[i] =
                this.config.unitSystem === 'arbitrary'
                    ? pressure / rho
                    : pressure / (Ru * molarDensity);
            if (
                !(this.T[i] > 0) ||
                !Number.isFinite(this.T[i]) ||
                !Number.isFinite(this.gamma[i]) ||
                !Number.isFinite(this.soundSpeed[i])
            )
                throw new Error(`Invalid thermodynamic state in cell ${i + 1}.`);
        }
    }

    // Calculate fluid and material fluxes at cell faces.
    computeFluxes(forceFallback = false) {
        for (let i = 0; i <= this.nx; i++) {
            const left = Math.max(0, i - 1),
                right = Math.min(this.nx - 1, i);
            const rhoL = this.rho[left],
                rhoR = this.rho[right];
            const uL = i === 0 && this.leftBoundary === 'closed' ? -this.u[left] : this.u[left];
            const uR =
                i === this.nx && this.rightBoundary === 'closed' ? -this.u[right] : this.u[right];
            const pL = this.p[left],
                pR = this.p[right];
            const EL = this.U[3 * left + 2],
                ER = this.U[3 * right + 2];
            const fIdx = 3 * i;
            let faceVelocity, upwind;
            let fallback = false;
            let speed = 0;

            // Equal pressure and velocity give an exact upwind contact flux.
            if (!forceFallback && pL === pR && uL === uR) {
                faceVelocity = uL;
                upwind = uL >= 0 ? left : right;
                const density = this.rho[upwind];
                const energy = this.U[3 * upwind + 2];
                this.flux[fIdx] = density * uL;
                this.flux[fIdx + 1] = density * uL * uL + pL;
                this.flux[fIdx + 2] = uL * (energy + pL);
            } else {
                const aL = this.soundSpeed[left];
                const aR = this.soundSpeed[right];
                const SL = Math.min(uL - aL, uR - aR);
                const SR = Math.max(uL + aL, uR + aR);
                speed = Math.max(Math.abs(SL), Math.abs(SR));
                if (!(speed > 0) || !Number.isFinite(speed))
                    throw new Error('Invalid wave speed. Revise the initial conditions.');
                const denominator = rhoL * (SL - uL) - rhoR * (SR - uR);
                const SStar =
                    (pR - pL + rhoL * uL * (SL - uL) - rhoR * uR * (SR - uR)) / denominator;
                const starLeft = (rhoL * (SL - uL)) / (SL - SStar);
                const starRight = (rhoR * (SR - uR)) / (SR - SStar);
                const pStar = pL + rhoL * (SL - uL) * (SStar - uL);
                const EStarL = ((SL - uL) * EL - pL * uL + pStar * SStar) / (SL - SStar);
                const EStarR = ((SR - uR) * ER - pR * uR + pStar * SStar) / (SR - SStar);
                fallback =
                    forceFallback ||
                    !Number.isFinite(SStar) ||
                    SStar <= SL ||
                    SStar >= SR ||
                    !(pStar > 0) ||
                    !(starLeft > 0) ||
                    !(starRight > 0) ||
                    !(EStarL > 0.5 * starLeft * SStar ** 2) ||
                    !(EStarR > 0.5 * starRight * SStar ** 2);

                if (fallback) {
                    // Rusanov fallback uses matching diffusion for every field.
                    this.fallbackFluxes++;
                    faceVelocity = 0.5 * (uL + uR);
                    this.flux[fIdx] = 0.5 * (rhoL * uL + rhoR * uR - speed * (rhoR - rhoL));
                    this.flux[fIdx + 1] =
                        0.5 *
                        (rhoL * uL ** 2 +
                            pL +
                            rhoR * uR ** 2 +
                            pR -
                            speed * (rhoR * uR - rhoL * uL));
                    this.flux[fIdx + 2] =
                        0.5 * (uL * (EL + pL) + uR * (ER + pR) - speed * (ER - EL));
                } else if (SL >= 0) {
                    faceVelocity = uL;
                    upwind = left;
                    this.flux[fIdx] = rhoL * uL;
                    this.flux[fIdx + 1] = rhoL * uL ** 2 + pL;
                    this.flux[fIdx + 2] = uL * (EL + pL);
                } else if (SR <= 0) {
                    faceVelocity = uR;
                    upwind = right;
                    this.flux[fIdx] = rhoR * uR;
                    this.flux[fIdx + 1] = rhoR * uR ** 2 + pR;
                    this.flux[fIdx + 2] = uR * (ER + pR);
                } else {
                    faceVelocity = SStar;
                    upwind = SStar >= 0 ? left : right;
                    const starDensity = SStar >= 0 ? starLeft : starRight;
                    const starEnergy = SStar >= 0 ? EStarL : EStarR;
                    this.flux[fIdx] = starDensity * SStar;
                    this.flux[fIdx + 1] = starDensity * SStar ** 2 + pStar;
                    this.flux[fIdx + 2] = SStar * (starEnergy + pStar);
                }
            }
            this.faceVelocity[i] = faceVelocity;
            for (let m = 0; m < this.numMaterials; m++) {
                const f = i * this.numMaterials + m;
                const l = left * this.numMaterials + m,
                    r = right * this.numMaterials + m;
                if (fallback) {
                    this.materialFlux[f] =
                        0.5 *
                        (uL * this.materialMass[l] +
                            uR * this.materialMass[r] -
                            speed * (this.materialMass[r] - this.materialMass[l]));
                    this.fractionFlux[f] =
                        0.5 *
                        (uL * this.materialFractions[l] +
                            uR * this.materialFractions[r] -
                            speed * (this.materialFractions[r] - this.materialFractions[l]));
                } else {
                    const index = upwind * this.numMaterials + m;
                    this.materialFlux[f] =
                        this.flux[fIdx] * this.materialMass[index] * this.inverseDensity[upwind];
                    this.fractionFlux[f] = faceVelocity * this.materialFractions[index];
                }
            }
        }
        return this.maxWaveSpeed;
    }

    // Apply one coupled time stage to all cell fields.
    applyFluxes(dt, originalWeight = 0, stageWeight = 1) {
        const ratio = dt / this.dx;
        for (let i = 0; i < this.nx; i++) {
            const divergence = this.faceVelocity[i + 1] - this.faceVelocity[i];
            for (let k = 0; k < 3; k++) {
                const index = 3 * i + k;
                this.U[index] =
                    originalWeight * this.Un[index] +
                    stageWeight * this.U[index] -
                    ratio * (this.flux[index + 3] - this.flux[index]);
            }
            for (let m = 0; m < this.numMaterials; m++) {
                const index = i * this.numMaterials + m;
                const right = index + this.numMaterials;
                const alpha = this.materialFractions[index];
                this.materialMass[index] =
                    originalWeight * this.massN[index] +
                    stageWeight * this.materialMass[index] -
                    ratio * (this.materialFlux[right] - this.materialFlux[index]);
                this.materialFractions[index] =
                    originalWeight * this.fractionsN[index] +
                    stageWeight * alpha -
                    ratio *
                        (this.fractionFlux[right] - this.fractionFlux[index] - alpha * divergence);
            }
        }
        this.updatePrimitives();
    }

    // Interpolate the flow velocity at a tracer position.
    sampleVelocity(x, values) {
        if (x < this.x[0])
            return this.leftBoundary === 'closed'
                ? (values[0] * Math.max(0, x)) / this.x[0]
                : values[0];
        if (x > this.x[this.nx - 1])
            return this.rightBoundary === 'closed'
                ? (values[this.nx - 1] * Math.max(0, this.totalLength - x)) / (0.5 * this.dx)
                : values[this.nx - 1];
        const left = Math.min(this.nx - 2, Math.max(0, Math.floor(x / this.dx - 0.5)));
        const fraction = (x - this.x[left]) / this.dx;
        return values[left] * (1 - fraction) + values[left + 1] * fraction;
    }

    // Advance interfaces and record open-boundary exits.
    updateTracers(dt) {
        for (const tracer of this.tracers) {
            if (!tracer.active) continue;
            const velocity = this.sampleVelocity(tracer.x, this.oldVelocity);
            const predictor = tracer.x + dt * velocity;
            const next = tracer.x + 0.5 * dt * (velocity + this.sampleVelocity(predictor, this.u));
            if (next <= 0 || next >= this.totalLength) {
                const wall = next <= 0 ? 0 : this.totalLength;
                const boundary = next <= 0 ? this.leftBoundary : this.rightBoundary;
                if (boundary === 'closed') {
                    tracer.x = wall;
                    continue;
                }
                const exitTime = this.t - dt + (dt * (wall - tracer.x)) / (next - tracer.x);
                tracer.exit = { t: exitTime, x: wall };
                tracer.path.push(tracer.exit);
                tracer.x = wall;
                tracer.active = false;
            } else tracer.x = next;
        }
    }

    // Advance one stable step and honor exact snapshot times.
    step() {
        if (!this.initialized) throw new Error('Initialize the solver before stepping.');
        if (this.t >= this.finalTime) return false;
        if (!Number.isSafeInteger(this.timeSteps + 1))
            throw new Error('Step count exceeds numerical precision.');
        const speed = this.maxWaveSpeed;
        this.dt = Math.min(
            (this.cfl * this.dx) / speed,
            this.nextSnapshotTime - this.t,
            this.finalTime - this.t
        );
        this.Un.set(this.U);
        this.fractionsN.set(this.materialFractions);
        this.massN.set(this.materialMass);
        this.oldVelocity.set(this.u);
        let accepted = false,
            lastError;
        for (let attempt = 0; attempt < 12; attempt++) {
            if (!(this.dt > 0) || this.t + this.dt === this.t)
                throw new Error('Time step is below numerical precision. Revise the inputs.');
            try {
                const fallback = attempt > 0;
                this.stepTransfer.fill(0);
                for (let stage = 0; stage < 4; stage++) {
                    const stageSpeed = this.maxWaveSpeed;
                    if ((0.5 * this.dt * stageSpeed) / this.dx > 0.95)
                        throw new Error('Stage CFL limit exceeded.');
                    this.computeFluxes(fallback);
                    const weight = stage === 3 ? 0.5 : 1 / 6;
                    for (let k = 0; k < 3; k++)
                        this.stepTransfer[k] +=
                            this.dt * weight * (this.flux[k] - this.flux[3 * this.nx + k]);
                    if (stage === 2) this.applyFluxes(this.dt / 6, 2 / 3, 1 / 3);
                    else this.applyFluxes(this.dt / 2);
                }
                accepted = true;
                break;
            } catch (error) {
                lastError = error;
                this.U.set(this.Un);
                this.materialFractions.set(this.fractionsN);
                this.materialMass.set(this.massN);
                this.updatePrimitives();
                this.dt *= 0.5;
                this.retries++;
            }
        }
        if (!accepted) throw new Error(`Time step failed after retries: ${lastError.message}`);
        for (let k = 0; k < 3; k++) this.boundaryTransfer[k] += this.stepTransfer[k];
        this.t += this.dt;
        this.timeSteps++;
        const tolerance = 16 * Number.EPSILON * this.finalTime;
        if (Math.abs(this.t - this.nextSnapshotTime) <= tolerance) this.t = this.nextSnapshotTime;
        this.updateTracers(this.dt);
        if (this.t >= this.nextSnapshotTime || this.t >= this.finalTime) {
            this.saveSnapshot();
            this.snapshotNumber++;
            this.nextSnapshotTime = Math.min(this.snapshotNumber * this.xtInterval, this.finalTime);
        }
        return true;
    }

    // Store the current fields and update their extrema.
    saveSnapshot() {
        const FieldArray = this.config.snapshotPrecision === '32' ? Float32Array : Float64Array;
        const snapshot = {
            t: this.t,
            tracerX: this.tracers.map((tracer) => (tracer.active ? tracer.x : null))
        };
        snapshot.ranges = {};
        if (this.nx > 8192) snapshot.plotIndices = {};
        for (const key of ['rho', 'u', 'p', 'T']) {
            const values = snapshot[key] = new FieldArray(this[key]);
            const range = this.ranges[key];
            let min = Infinity, max = -Infinity;
            for (const value of values) {
                if (!Number.isFinite(value) || (key !== 'u' && value <= 0))
                    throw new Error('Snapshot precision cannot represent this state. Select 64-bit snapshots.');
                min = Math.min(min, value);
                max = Math.max(max, value);

            }
            snapshot.ranges[key] = { min, max };
            range.min = Math.min(range.min, min);
            range.max = Math.max(range.max, max);
            // Preserve local extrema while bounding plot drawing work.
            if (snapshot.plotIndices) {
                const indices = [], stride = Math.ceil(this.nx / 1024);
                for (let start = 0; start < this.nx; start += stride) {
                    const end = Math.min(this.nx - 1, start + stride - 1);
                    let low = start, high = start;
                    for (let i = start + 1; i <= end; i++) {
                        if (values[i] < values[low]) low = i;
                        if (values[i] > values[high]) high = i;
                    }
                    indices.push(start, Math.min(low, high), Math.max(low, high), end);
                }
                snapshot.plotIndices[key] = Uint32Array.from(indices);
            }
        }
        this.history.push(snapshot);
        for (const tracer of this.tracers)
            if (tracer.active) tracer.path.push({ t: this.t, x: tracer.x });
    }

    // Advance until the requested final time.
    runFullSimulation() {
        if (!this.initialized) throw new Error('Initialize the solver before running.');
        while (this.t < this.finalTime) this.step();
        return this.history;
    }

    // Collect fields, settings, and solver diagnostics.
    getResult() {
        // Keep long interface paths cheap to redraw without changing exports.
        for (const tracer of this.tracers) {
            if (tracer.path.length <= 8192) continue;
            const path = tracer.path, stride = Math.ceil(path.length / 1024);
            tracer.plotPath = [];
            for (let start = 0; start < path.length; start += stride) {
                const end = Math.min(path.length - 1, start + stride - 1);
                let low = start, high = start;
                for (let i = start + 1; i <= end; i++) {
                    if (path[i].x < path[low].x) low = i;
                    if (path[i].x > path[high].x) high = i;
                }
                for (const i of [start, Math.min(low, high), Math.max(low, high), end]) tracer.plotPath.push(path[i]);
            }
        }
        return {
            history: this.history,
            x: this.x,
            tracers: this.tracers,
            ranges: this.ranges,
            config: {
                ...this.config,
                slabs: this.slabs,
                totalLength: this.totalLength,
                dx: this.dx
            },
            diagnostics: {
                timeSteps: this.timeSteps,
                retries: this.retries,
                fallbackFluxes: this.fallbackFluxes,
                boundaryTransfer: Array.from(this.boundaryTransfer),
                warnings: this.warnings
            }
        };
    }
}

// Run the solver when this file is loaded as a worker.
if (typeof self !== 'undefined' && typeof document === 'undefined') {
    self.addEventListener('message', (event) => {
        try {
            const started = performance.now();
            const solver = new EulerSolver(event.data.config);
            solver.initialize(event.data.slabs);
            let lastProgress = started;
            while (solver.t < solver.finalTime) {
                solver.step();
                const now = performance.now();
                if (now - lastProgress > 100) {
                    self.postMessage({ type: 'progress', progress: solver.t / solver.finalTime });
                    lastProgress = now;
                }
            }
            const result = solver.getResult();
            result.diagnostics.calculationMs = performance.now() - started;
            const buffers = [result.x.buffer];
            for (const snap of result.history)
                for (const key of ['rho', 'u', 'p', 'T']) {
                    buffers.push(snap[key].buffer);
                    if (snap.plotIndices) buffers.push(snap.plotIndices[key].buffer);
                }
            self.postMessage({ type: 'complete', result }, buffers);
        } catch (error) {
            self.postMessage({ type: 'error', message: error.message });
        }
    });
}
