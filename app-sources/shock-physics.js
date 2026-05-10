/**
 * 1D Compressible Euler Solver
 * Features: HLLC Fluxes, SSP-RK3 Time Integration, Mixed-Cell Interface Tracking
 */

export class EulerSolver {
    constructor(config) {
        this.nx = config.gridCells || 500;
        this.cfl = config.cflNumber || 0.8;
        this.finalTime = config.maxTime || 0.2;
        this.xtInterval = config.snapshotInterval || 0.005;
        this.leftBoundary = config.leftBoundary || 'closed';
        this.rightBoundary = config.rightBoundary || 'closed';

        this.x = new Float64Array(this.nx);
        this.dx = 0;
        
        this.U = new Float64Array(this.nx * 3);   
        this.Un = new Float64Array(this.nx * 3);  
        this.Uk = new Float64Array(this.nx * 3);  
        
        this.rho = new Float64Array(this.nx);
        this.u = new Float64Array(this.nx);
        this.p = new Float64Array(this.nx);
        this.T = new Float64Array(this.nx);
        
        this.gamma = new Float64Array(this.nx);
        this.mw = new Float64Array(this.nx);
        this.gasId = new Array(this.nx);
        
        this.flux = new Float64Array((this.nx + 1) * 3);
        
        // Dynamically set Universal Gas Constant based on user's unit system
        const sys = config.unitSystem || 'arbitrary';
        if (sys === 'mks') this.Ru = 8314.46;
        else if (sys === 'cgs') this.Ru = 83144626;
        else if (sys === 'fps') this.Ru = 49719;
        else this.Ru = 1.0; 
        
        this.t = 0;
        this.dt = 0;
        this.timeSteps = 0;
        this.nextSnapshotTime = 0;
        this.history = []; 
        
        this.numMaterials = 0;
        this.materialFractions = null;
        this.materialFlux = null;
        this.materialProperties = [];
        
        // NEW: Interface Tracers
        this.tracers = []; 
    }

    initialize(slabs) {
        const totalLength = slabs.reduce((sum, slab) => sum + slab.length, 0);
        this.dx = totalLength / this.nx;
        
        this.numMaterials = slabs.length;
        this.materialFractions = new Float64Array(this.nx * this.numMaterials);
        this.materialFlux = new Float64Array((this.nx + 1) * this.numMaterials);
        
        let currentPos = 0;
        let slabIndex = 0;

        // NEW: Initialize tracer positions between slabs
        for (let i = 0; i < slabs.length - 1; i++) {
            currentPos += slabs[i].length;
            this.tracers.push({
                initialX: currentPos,
                path: [{t: 0, x: currentPos}]
            });
        }
        
        currentPos = 0;
        
        for (let i = 0; i < this.nx; i++) {
            this.x[i] = (i + 0.5) * this.dx;
            
            while (slabIndex < slabs.length - 1 && this.x[i] >= currentPos + slabs[slabIndex].length) {
                currentPos += slabs[slabIndex].length;
                slabIndex++;
            }
            
            const slab = slabs[slabIndex];
            
            this.gamma[i] = slab.gamma;
            this.mw[i] = slab.mw;
            this.gasId[i] = slab.name;
            
            const R = this.Ru / slab.mw;
            const rho = slab.density; 
            const u = slab.velocity;
            const p = slab.pressure;
            const E = p / (slab.gamma - 1) + 0.5 * rho * u * u;
            
            const idx = i * 3;
            this.U[idx] = rho;
            this.U[idx + 1] = rho * u;
            this.U[idx + 2] = E;

            this.materialFractions[i * this.numMaterials + slabIndex] = 1.0;
        }
        
        this.materialProperties = slabs.map(slab => ({
            gamma: slab.gamma,
            mw: slab.mw,
            gasId: slab.name
        }));
        
        this.updatePrimitives();
        this.saveSnapshot();
    }

    updatePrimitives() {
        const minDensity = 1e-10;
        for (let i = 0; i < this.nx; i++) {
            const idx = i * 3;
            const rho = Math.max(this.U[idx], minDensity);
            const rhou = this.U[idx + 1];
            const E = this.U[idx + 2];
            const gamma = this.gamma[i];

            this.rho[i] = rho;
            this.u[i] = rhou / rho;
            this.p[i] = Math.max((gamma - 1) * (E - 0.5 * rho * this.u[i] * this.u[i]), minDensity);
            this.T[i] = this.p[i] / (rho * (this.Ru / this.mw[i]));
        }
    }

    computeFluxes() {
        let maxWaveSpeed = 1e-10;
        for (let i = 0; i <= this.nx; i++) {
            let UL = new Float64Array(3);
            let UR = new Float64Array(3);
            let gammaL, gammaR;
            
            if (i === 0) { 
                const idx = 0;
                UL[0] = this.U[idx];
                UL[1] = this.leftBoundary === 'closed' ? -this.U[idx + 1] : this.U[idx + 1]; 
                UL[2] = this.U[idx + 2];
                UR.set(this.U.subarray(0, 3));
                gammaL = gammaR = this.gamma[0];
            } else if (i === this.nx) { 
                const idx = (this.nx - 1) * 3;
                UL.set(this.U.subarray(idx, idx + 3));
                UR[0] = this.U[idx];
                UR[1] = this.rightBoundary === 'closed' ? -this.U[idx + 1] : this.U[idx + 1];
                UR[2] = this.U[idx + 2];
                gammaL = gammaR = this.gamma[this.nx - 1];
            } else { 
                const idxL = (i - 1) * 3;
                const idxR = i * 3;
                UL.set(this.U.subarray(idxL, idxL + 3));
                UR.set(this.U.subarray(idxR, idxR + 3));
                gammaL = this.gamma[i - 1];
                gammaR = this.gamma[i];
            }
            
            const rhoL = Math.max(UL[0], 1e-10); const uL = UL[1] / rhoL; const EL = UL[2];
            const pL = Math.max((gammaL - 1) * (EL - 0.5 * rhoL * uL * uL), 1e-10);
            const aL = Math.sqrt(gammaL * pL / rhoL);

            const rhoR = Math.max(UR[0], 1e-10); const uR = UR[1] / rhoR; const ER = UR[2];
            const pR = Math.max((gammaR - 1) * (ER - 0.5 * rhoR * uR * uR), 1e-10);
            const aR = Math.sqrt(gammaR * pR / rhoR);
            
            const SL = Math.min(uL - aL, uR - aR);
            const SR = Math.max(uL + aL, uR + aR);
            const SStar = (pR - pL + rhoL * uL * (SL - uL) - rhoR * uR * (SR - uR)) /
                          (rhoL * (SL - uL) - rhoR * (SR - uR));
            
            const fIdx = i * 3;
            if (SL >= 0) {
                this.flux[fIdx] = rhoL * uL; this.flux[fIdx+1] = rhoL * uL * uL + pL; this.flux[fIdx+2] = uL * (EL + pL);
            } else if (SStar >= 0) {
                const pStar = pL + rhoL * (SL - uL) * (SStar - uL);
                const rhoStarL = rhoL * (SL - uL) / (SL - SStar);
                const EStarL = rhoStarL * (EL / rhoL + (SStar - uL) * (SStar + pL / (rhoL * (SL - uL))));
                this.flux[fIdx] = rhoStarL * SStar; this.flux[fIdx+1] = rhoStarL * SStar * SStar + pStar; this.flux[fIdx+2] = SStar * (EStarL + pStar);
            } else if (SR >= 0) {
                const pStar = pR + rhoR * (SR - uR) * (SStar - uR);
                const rhoStarR = rhoR * (SR - uR) / (SR - SStar);
                const EStarR = rhoStarR * (ER / rhoR + (SStar - uR) * (SStar + pR / (rhoR * (SR - uR))));
                this.flux[fIdx] = rhoStarR * SStar; this.flux[fIdx+1] = rhoStarR * SStar * SStar + pStar; this.flux[fIdx+2] = SStar * (EStarR + pStar);
            } else {
                this.flux[fIdx] = rhoR * uR; this.flux[fIdx+1] = rhoR * uR * uR + pR; this.flux[fIdx+2] = uR * (ER + pR);
            }
            maxWaveSpeed = Math.max(maxWaveSpeed, Math.abs(SL), Math.abs(SR));
        }
        return maxWaveSpeed;
    }

    applyFluxes(Uin, Uout, dt) {
        for (let i = 0; i < this.nx; i++) {
            const idx = i * 3; const fL = i * 3; const fR = (i + 1) * 3;
            for (let k = 0; k < 3; k++) Uout[idx + k] = Uin[idx + k] - (dt / this.dx) * (this.flux[fR + k] - this.flux[fL + k]);
        }
    }

    advectFractions(dt) {
        for (let i = 0; i <= this.nx; i++) {
            for (let m = 0; m < this.numMaterials; m++) {
                const fluxIdx = i * this.numMaterials + m;
                if (i === 0 || i === this.nx) this.materialFlux[fluxIdx] = 0;
                else {
                    const uInterface = 0.5 * (this.u[i - 1] + this.u[i]);
                    this.materialFlux[fluxIdx] = uInterface > 0 ? uInterface * this.materialFractions[(i - 1) * this.numMaterials + m] : uInterface * this.materialFractions[i * this.numMaterials + m];
                }
            }
        }
        const alphaNew = new Float64Array(this.nx * this.numMaterials);
        for (let i = 0; i < this.nx; i++) {
            let totalAlpha = 0;
            for (let m = 0; m < this.numMaterials; m++) {
                const idx = i * this.numMaterials + m; const fluxL = i * this.numMaterials + m; const fluxR = (i + 1) * this.numMaterials + m;
                alphaNew[idx] = Math.max(0, Math.min(1, this.materialFractions[idx] - (dt / this.dx) * (this.materialFlux[fluxR] - this.materialFlux[fluxL])));
                totalAlpha += alphaNew[idx];
            }
            if (totalAlpha > 1e-10) for (let m = 0; m < this.numMaterials; m++) alphaNew[i * this.numMaterials + m] /= totalAlpha;
        }
        this.materialFractions.set(alphaNew);

        for (let i = 0; i < this.nx; i++) {
            let gamma_mix_inv = 0; let mw_mix = 0;
            for (let m = 0; m < this.numMaterials; m++) {
                const alpha = this.materialFractions[i * this.numMaterials + m];
                gamma_mix_inv += alpha / (this.materialProperties[m].gamma - 1);
                mw_mix += alpha * this.materialProperties[m].mw;
            }
            this.gamma[i] = 1 + 1 / gamma_mix_inv;
            this.mw[i] = mw_mix;
        }
    }

    updateTracers(dt) {
        for (let tracer of this.tracers) {
            let currentX = tracer.path[tracer.path.length - 1].x;
            let cellIdx = Math.max(0, Math.min(this.nx - 1, Math.floor(currentX / this.dx)));
            let newX = currentX + this.u[cellIdx] * dt;
            tracer.path.push({t: this.t, x: newX});
        }
    }

    step() {
        const maxWaveSpeed = this.computeFluxes();
        this.dt = this.cfl * this.dx / maxWaveSpeed;
        if (this.t + this.dt > this.finalTime) this.dt = this.finalTime - this.t;

        const n = this.nx * 3;
        this.Un.set(this.U);
        
        this.applyFluxes(this.U, this.Uk, this.dt);
        for (let i = 0; i < n; i++) this.U[i] = this.U[i] + 0.5 * (this.Uk[i] - this.U[i]);
        
        this.computeFluxes();
        this.applyFluxes(this.U, this.Uk, this.dt);
        for (let i = 0; i < n; i++) this.U[i] = this.U[i] + 0.5 * (this.Uk[i] - this.U[i]);
        
        this.computeFluxes();
        this.applyFluxes(this.U, this.Uk, this.dt);
        for (let i = 0; i < n; i++) this.U[i] = (2.0/3.0) * this.Un[i] + (1.0/6.0) * this.U[i] + (1.0/6.0) * this.Uk[i];
        
        this.computeFluxes();
        this.applyFluxes(this.U, this.Uk, this.dt);
        for (let i = 0; i < n; i++) this.U[i] = 0.5 * this.U[i] + 0.5 * this.Uk[i];

        this.t += this.dt;
        this.timeSteps++;
        
        this.updatePrimitives();
        this.advectFractions(this.dt);
        this.updateTracers(this.dt);

        if (this.t >= this.nextSnapshotTime || this.t >= this.finalTime) {
            this.saveSnapshot();
            this.nextSnapshotTime += this.xtInterval;
        }
    }

    saveSnapshot() {
        this.history.push({
            t: this.t,
            rho: new Float64Array(this.rho),
            u: new Float64Array(this.u),
            p: new Float64Array(this.p),
            T: new Float64Array(this.T) // Save temperature for export and heatmap
        });
    }

    // Compute all data instantly!
    runFullSimulation() {
        while(this.t < this.finalTime) {
            this.step();
        }
        return this.history;
    }
}