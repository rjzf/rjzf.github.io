(function(){let e=8314.46261815324,t=4294967295,n={arbitrary:{x:1,rho:1,p:1,u:1,T:1,xLbl:``,rhoLbl:``,pLbl:``,uLbl:``,tempLbl:``,tLbl:``},mks:{x:1,rho:1,p:1,u:1,T:1,xLbl:`m`,rhoLbl:`kg/m³`,pLbl:`Pa`,uLbl:`m/s`,tempLbl:`K`,tLbl:`s`},cgs:{x:.01,rho:1e3,p:.1,u:.01,T:1,xLbl:`cm`,rhoLbl:`g/cm³`,pLbl:`Ba`,uLbl:`cm/s`,tempLbl:`K`,tLbl:`s`},fps:{x:.3048,rho:.45359237*9.80665/.3048**4,p:.45359237*9.80665/.3048**2,u:.3048,T:5/9,xLbl:`ft`,rhoLbl:`slug/ft³`,pLbl:`lbf/ft²`,uLbl:`ft/s`,tempLbl:`°R`,tLbl:`s`}};function r(e,t){if(e==null||String(e).trim()===``)throw Error(`${t} is required.`);let n=Number(e);if(!Number.isFinite(n))throw Error(`${t} must be finite.`);return n}function i(e,t){let n=r(e,t);if(n<=0)throw Error(`${t} must be greater than zero.`);return n}function a(e,t=`Gas`){let n=r(e.gamma,`${t} gamma`),a=i(e.mw,`${t} molecular weight`);if(n<=1)throw Error(`${t} gamma must be greater than 1.`);return{gamma:n,mw:a}}function o(e={}){let a={gridCells:r(e.gridCells??500,`Grid cells`),cflNumber:r(e.cflNumber??.75,`CFL number`),maxTime:i(e.maxTime??.2,`Max time`),snapshotInterval:i(e.snapshotInterval??5e-4,`Snapshot interval`),snapshotPrecision:String(e.snapshotPrecision??`32`),leftBoundary:e.leftBoundary??`closed`,rightBoundary:e.rightBoundary??`closed`,unitSystem:e.unitSystem??`arbitrary`,displayUnits:e.displayUnits??e.unitSystem??`arbitrary`};if(!Number.isSafeInteger(a.gridCells)||a.gridCells<100)throw Error(`Grid cells must be a whole number of at least 100.`);if(![`32`,`64`].includes(a.snapshotPrecision))throw Error(`Snapshot precision must be 32-bit or 64-bit.`);if(a.cflNumber<.01||a.cflNumber>.95)throw Error(`CFL number must be from 0.01 to 0.95.`);if(![`closed`,`open`].includes(a.leftBoundary)||![`closed`,`open`].includes(a.rightBoundary))throw Error(`Unknown boundary condition.`);if(![`arbitrary`,`mks`].includes(a.unitSystem))throw Error(`The solver requires SI or arbitrary inputs. Convert display units first.`);if(!Object.hasOwn(n,a.displayUnits))throw Error(`Unknown display units.`);if(a.unitSystem===`arbitrary`!=(a.displayUnits===`arbitrary`))throw Error(`Arbitrary and physical units require separate runs.`);let o=Math.max(2,Math.ceil(a.maxTime/a.snapshotInterval)+1);if(!Number.isSafeInteger(o)||o>t||!Number.isSafeInteger(o*a.gridCells*32)||(a.gridCells+1)*16>t)throw Error(`Requested arrays exceed supported index sizes. Reduce cells or snapshots.`);return a}function s(e){if(!Array.isArray(e)||e.length<1||e.length>16)throw Error(`Use 1 to 16 material sections.`);let t=e.map((e,t)=>{let n=`Section ${t+1}`;return{name:String(e.name??n),...a(e,n),length:i(e.length,`${n} length`),density:i(e.density,`${n} density`),pressure:i(e.pressure,`${n} pressure`),velocity:r(e.velocity,`${n} velocity`)}}),n=0;for(let e of t){let t=n+e.length;if(!Number.isFinite(t)||t<=n)throw Error(`Section lengths exceed numerical precision.`);n=t}return t}var c=class{constructor(e={}){this.config=o(e),this.nx=this.config.gridCells,this.cfl=this.config.cflNumber,this.finalTime=this.config.maxTime,this.xtInterval=this.config.snapshotInterval,this.leftBoundary=this.config.leftBoundary,this.rightBoundary=this.config.rightBoundary,this.x=new Float64Array(this.nx),this.U=new Float64Array(this.nx*3),this.Un=new Float64Array(this.U.length),this.rho=new Float64Array(this.nx),this.u=new Float64Array(this.nx),this.p=new Float64Array(this.nx),this.T=new Float64Array(this.nx),this.gamma=new Float64Array(this.nx),this.mw=new Float64Array(this.nx),this.soundSpeed=new Float64Array(this.nx),this.inverseDensity=new Float64Array(this.nx),this.flux=new Float64Array((this.nx+1)*3),this.faceVelocity=new Float64Array(this.nx+1),this.oldVelocity=new Float64Array(this.nx),this.initialized=!1}initialize(e){if(this.initialized=!1,this.slabs=s(e),this.totalLength=this.slabs.reduce((e,t)=>e+t.length,0),this.dx=this.totalLength/this.nx,!(this.dx>0)||!Number.isFinite(1/this.dx))throw Error(`The grid spacing exceeds numerical precision.`);this.numMaterials=this.slabs.length,this.materialProperties=this.slabs.map(e=>({gamma:e.gamma,mw:e.mw,gasId:e.name})),this.materialBeta=this.slabs.map(e=>1/(e.gamma-1)),this.materialInverseMW=this.slabs.map(e=>1/e.mw);let t=this.nx*this.numMaterials;this.materialFractions=new Float64Array(t),this.materialMass=new Float64Array(t),this.fractionsN=new Float64Array(t),this.massN=new Float64Array(t),this.materialFlux=new Float64Array((this.nx+1)*this.numMaterials),this.fractionFlux=new Float64Array(this.materialFlux.length),this.U.fill(0),this.t=0,this.dt=0,this.timeSteps=0,this.snapshotNumber=1,this.nextSnapshotTime=Math.min(this.xtInterval,this.finalTime),this.history=[],this.ranges=Object.fromEntries([`rho`,`u`,`p`,`T`].map(e=>[e,{min:1/0,max:-1/0}])),this.tracers=[],this.warnings=[],this.retries=0,this.fallbackFluxes=0,this.boundaryTransfer=new Float64Array(3),this.stepTransfer=new Float64Array(3);let n=0;for(let e=0;e<this.numMaterials;e++){let t=this.slabs[e],r=n+t.length,i=n/this.dx,a=e===this.numMaterials-1?this.nx:r/this.dx;if(a<=i)throw Error(`Section ${e+1} cannot be represented on this grid.`);let o=t.pressure/(t.gamma-1)+.5*t.density*t.velocity**2;t.length<2*this.dx&&this.warnings.push(`Section ${e+1} spans fewer than two cells. Increase resolution for its wave structure.`);for(let n=0;n<this.nx;n++){let r=Math.max(0,Math.min(n+1,a)-Math.max(n,i)),s=r*t.density;this.materialFractions[n*this.numMaterials+e]=r,this.materialMass[n*this.numMaterials+e]=s,this.U[3*n]+=s,this.U[3*n+1]+=s*t.velocity,this.U[3*n+2]+=r*o}e<this.numMaterials-1&&this.tracers.push({initialX:r,x:r,active:!0,exit:null,path:[]}),n=r}for(let e=0;e<this.nx;e++)this.x[e]=(e+.5)*this.dx;this.updatePrimitives(),this.saveSnapshot(),this.initialized=!0}updatePrimitives(){this.maxWaveSpeed=0;for(let t=0;t<this.nx;t++){let n=0,r=0,i=0,a=0,o=t*this.numMaterials;for(let e=0;e<this.numMaterials;e++){let s=this.materialFractions[o+e],c=this.materialMass[o+e];if(!Number.isFinite(s)||s<-1e-12||s>1.000000000001||!Number.isFinite(c)||c<0)throw Error(`Invalid material state in cell ${t+1}.`);a+=s,n+=s*this.materialBeta[e],r+=c*this.materialInverseMW[e],i+=c}let s=this.U[3*t],c=this.U[3*t+1]/s,l=(this.U[3*t+2]-.5*s*c**2)/n;if(Math.abs(a-1)>1e-9||Math.abs(i-s)>1e-9*s||!(s>0)||!(l>0)||!Number.isFinite(l)||!Number.isFinite(c))throw Error(`Nonphysical state in cell ${t+1}. Reduce CFL or revise the initial conditions.`);if(this.rho[t]=s,this.u[t]=c,this.p[t]=l,this.gamma[t]=1+1/n,this.inverseDensity[t]=1/s,this.soundSpeed[t]=Math.sqrt(this.gamma[t]*l*this.inverseDensity[t]),this.maxWaveSpeed=Math.max(this.maxWaveSpeed,Math.abs(c)+this.soundSpeed[t]),this.mw[t]=s/r,this.T[t]=this.config.unitSystem===`arbitrary`?l/s:l/(e*r),!(this.T[t]>0)||!Number.isFinite(this.T[t])||!Number.isFinite(this.gamma[t])||!Number.isFinite(this.soundSpeed[t]))throw Error(`Invalid thermodynamic state in cell ${t+1}.`)}}computeFluxes(e=!1){for(let t=0;t<=this.nx;t++){let n=Math.max(0,t-1),r=Math.min(this.nx-1,t),i=this.rho[n],a=this.rho[r],o=t===0&&this.leftBoundary===`closed`?-this.u[n]:this.u[n],s=t===this.nx&&this.rightBoundary===`closed`?-this.u[r]:this.u[r],c=this.p[n],l=this.p[r],u=this.U[3*n+2],d=this.U[3*r+2],f=3*t,p,m,h=!1,g=0;if(!e&&c===l&&o===s){p=o,m=o>=0?n:r;let e=this.rho[m],t=this.U[3*m+2];this.flux[f]=e*o,this.flux[f+1]=e*o*o+c,this.flux[f+2]=o*(t+c)}else{let t=this.soundSpeed[n],_=this.soundSpeed[r],v=Math.min(o-t,s-_),y=Math.max(o+t,s+_);if(g=Math.max(Math.abs(v),Math.abs(y)),!(g>0)||!Number.isFinite(g))throw Error(`Invalid wave speed. Revise the initial conditions.`);let b=i*(v-o)-a*(y-s),x=(l-c+i*o*(v-o)-a*s*(y-s))/b,S=i*(v-o)/(v-x),C=a*(y-s)/(y-x),w=c+i*(v-o)*(x-o),T=((v-o)*u-c*o+w*x)/(v-x),E=((y-s)*d-l*s+w*x)/(y-x);if(h=e||!Number.isFinite(x)||x<=v||x>=y||!(w>0)||!(S>0)||!(C>0)||!(T>.5*S*x**2)||!(E>.5*C*x**2),h)this.fallbackFluxes++,p=.5*(o+s),this.flux[f]=.5*(i*o+a*s-g*(a-i)),this.flux[f+1]=.5*(i*o**2+c+a*s**2+l-g*(a*s-i*o)),this.flux[f+2]=.5*(o*(u+c)+s*(d+l)-g*(d-u));else if(v>=0)p=o,m=n,this.flux[f]=i*o,this.flux[f+1]=i*o**2+c,this.flux[f+2]=o*(u+c);else if(y<=0)p=s,m=r,this.flux[f]=a*s,this.flux[f+1]=a*s**2+l,this.flux[f+2]=s*(d+l);else{p=x,m=x>=0?n:r;let e=x>=0?S:C,t=x>=0?T:E;this.flux[f]=e*x,this.flux[f+1]=e*x**2+w,this.flux[f+2]=x*(t+w)}}this.faceVelocity[t]=p;for(let e=0;e<this.numMaterials;e++){let i=t*this.numMaterials+e,a=n*this.numMaterials+e,c=r*this.numMaterials+e;if(h)this.materialFlux[i]=.5*(o*this.materialMass[a]+s*this.materialMass[c]-g*(this.materialMass[c]-this.materialMass[a])),this.fractionFlux[i]=.5*(o*this.materialFractions[a]+s*this.materialFractions[c]-g*(this.materialFractions[c]-this.materialFractions[a]));else{let t=m*this.numMaterials+e;this.materialFlux[i]=this.flux[f]*this.materialMass[t]*this.inverseDensity[m],this.fractionFlux[i]=p*this.materialFractions[t]}}}return this.maxWaveSpeed}applyFluxes(e,t=0,n=1){let r=e/this.dx;for(let e=0;e<this.nx;e++){let i=this.faceVelocity[e+1]-this.faceVelocity[e];for(let i=0;i<3;i++){let a=3*e+i;this.U[a]=t*this.Un[a]+n*this.U[a]-r*(this.flux[a+3]-this.flux[a])}for(let a=0;a<this.numMaterials;a++){let o=e*this.numMaterials+a,s=o+this.numMaterials,c=this.materialFractions[o];this.materialMass[o]=t*this.massN[o]+n*this.materialMass[o]-r*(this.materialFlux[s]-this.materialFlux[o]),this.materialFractions[o]=t*this.fractionsN[o]+n*c-r*(this.fractionFlux[s]-this.fractionFlux[o]-c*i)}}this.updatePrimitives()}sampleVelocity(e,t){if(e<this.x[0])return this.leftBoundary===`closed`?t[0]*Math.max(0,e)/this.x[0]:t[0];if(e>this.x[this.nx-1])return this.rightBoundary===`closed`?t[this.nx-1]*Math.max(0,this.totalLength-e)/(.5*this.dx):t[this.nx-1];let n=Math.min(this.nx-2,Math.max(0,Math.floor(e/this.dx-.5))),r=(e-this.x[n])/this.dx;return t[n]*(1-r)+t[n+1]*r}updateTracers(e){for(let t of this.tracers){if(!t.active)continue;let n=this.sampleVelocity(t.x,this.oldVelocity),r=t.x+e*n,i=t.x+.5*e*(n+this.sampleVelocity(r,this.u));if(i<=0||i>=this.totalLength){let n=i<=0?0:this.totalLength;if((i<=0?this.leftBoundary:this.rightBoundary)===`closed`){t.x=n;continue}t.exit={t:this.t-e+e*(n-t.x)/(i-t.x),x:n},t.path.push(t.exit),t.x=n,t.active=!1}else t.x=i}}step(){if(!this.initialized)throw Error(`Initialize the solver before stepping.`);if(this.t>=this.finalTime)return!1;if(!Number.isSafeInteger(this.timeSteps+1))throw Error(`Step count exceeds numerical precision.`);let e=this.maxWaveSpeed;this.dt=Math.min(this.cfl*this.dx/e,this.nextSnapshotTime-this.t,this.finalTime-this.t),this.Un.set(this.U),this.fractionsN.set(this.materialFractions),this.massN.set(this.materialMass),this.oldVelocity.set(this.u);let t=!1,n;for(let e=0;e<12;e++){if(!(this.dt>0)||this.t+this.dt===this.t)throw Error(`Time step is below numerical precision. Revise the inputs.`);try{let n=e>0;this.stepTransfer.fill(0);for(let e=0;e<4;e++){let t=this.maxWaveSpeed;if(.5*this.dt*t/this.dx>.95)throw Error(`Stage CFL limit exceeded.`);this.computeFluxes(n);let r=e===3?.5:1/6;for(let e=0;e<3;e++)this.stepTransfer[e]+=this.dt*r*(this.flux[e]-this.flux[3*this.nx+e]);e===2?this.applyFluxes(this.dt/6,2/3,1/3):this.applyFluxes(this.dt/2)}t=!0;break}catch(e){n=e,this.U.set(this.Un),this.materialFractions.set(this.fractionsN),this.materialMass.set(this.massN),this.updatePrimitives(),this.dt*=.5,this.retries++}}if(!t)throw Error(`Time step failed after retries: ${n.message}`);for(let e=0;e<3;e++)this.boundaryTransfer[e]+=this.stepTransfer[e];this.t+=this.dt,this.timeSteps++;let r=16*2**-52*this.finalTime;return Math.abs(this.t-this.nextSnapshotTime)<=r&&(this.t=this.nextSnapshotTime),this.updateTracers(this.dt),(this.t>=this.nextSnapshotTime||this.t>=this.finalTime)&&(this.saveSnapshot(),this.snapshotNumber++,this.nextSnapshotTime=Math.min(this.snapshotNumber*this.xtInterval,this.finalTime)),!0}saveSnapshot(){let e=this.config.snapshotPrecision===`32`?Float32Array:Float64Array,t={t:this.t,tracerX:this.tracers.map(e=>e.active?e.x:null)};t.ranges={},this.nx>8192&&(t.plotIndices={});for(let n of[`rho`,`u`,`p`,`T`]){let r=t[n]=new e(this[n]),i=this.ranges[n],a=1/0,o=-1/0;for(let e of r){if(!Number.isFinite(e)||n!==`u`&&e<=0)throw Error(`Snapshot precision cannot represent this state. Select 64-bit snapshots.`);a=Math.min(a,e),o=Math.max(o,e)}if(t.ranges[n]={min:a,max:o},i.min=Math.min(i.min,a),i.max=Math.max(i.max,o),t.plotIndices){let e=[],i=Math.ceil(this.nx/1024);for(let t=0;t<this.nx;t+=i){let n=Math.min(this.nx-1,t+i-1),a=t,o=t;for(let e=t+1;e<=n;e++)r[e]<r[a]&&(a=e),r[e]>r[o]&&(o=e);e.push(t,Math.min(a,o),Math.max(a,o),n)}t.plotIndices[n]=Uint32Array.from(e)}}this.history.push(t);for(let e of this.tracers)e.active&&e.path.push({t:this.t,x:e.x})}runFullSimulation(){if(!this.initialized)throw Error(`Initialize the solver before running.`);for(;this.t<this.finalTime;)this.step();return this.history}getResult(){for(let e of this.tracers){if(e.path.length<=8192)continue;let t=e.path,n=Math.ceil(t.length/1024);e.plotPath=[];for(let r=0;r<t.length;r+=n){let i=Math.min(t.length-1,r+n-1),a=r,o=r;for(let e=r+1;e<=i;e++)t[e].x<t[a].x&&(a=e),t[e].x>t[o].x&&(o=e);for(let n of[r,Math.min(a,o),Math.max(a,o),i])e.plotPath.push(t[n])}}return{history:this.history,x:this.x,tracers:this.tracers,ranges:this.ranges,config:{...this.config,slabs:this.slabs,totalLength:this.totalLength,dx:this.dx},diagnostics:{timeSteps:this.timeSteps,retries:this.retries,fallbackFluxes:this.fallbackFluxes,boundaryTransfer:Array.from(this.boundaryTransfer),warnings:this.warnings}}}};typeof self<`u`&&typeof document>`u`&&self.addEventListener(`message`,e=>{if(!e.data.gpuAcceleration)try{let t=performance.now(),n=new c(e.data.config);n.initialize(e.data.slabs);let r=t;for(;n.t<n.finalTime;){n.step();let e=performance.now();e-r>100&&(self.postMessage({type:`progress`,progress:n.t/n.finalTime}),r=e)}let i=n.getResult();i.diagnostics.calculationMs=performance.now()-t;let a=[i.x.buffer];for(let e of i.history)for(let t of[`rho`,`u`,`p`,`T`])a.push(e[t].buffer),e.plotIndices&&a.push(e.plotIndices[t].buffer);self.postMessage({type:`complete`,result:i},a)}catch(e){self.postMessage({type:`error`,message:e.message})}});let l=e=>`${Math.fround(e).toExponential(9)}f`;function u(e){let t=e.numMaterials;return`
const N = ${e.nx}u;
const M = ${t}u;
const GROUPS = ${Math.ceil(e.nx/128)}u;
const DX = ${l(1/e.nx)};
const CFL = ${l(e.cfl)};
const CLOSED_L = ${e.leftBoundary===`closed`};
const CLOSED_R = ${e.rightBoundary===`closed`};
const BETA = array<f32, M>(${e.materialBeta.map(l).join(`,`)});
const INV_MW = array<f32, M>(${e.materialInverseMW.map(t=>l(t*e.mwScale)).join(`,`)});
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

@compute @workgroup_size(128)
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

var<workgroup> speeds: array<f32, 128>;
var<workgroup> invalid: array<f32, 128>;

@compute @workgroup_size(128)
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
    for (var stride = ${128/2}u; stride > 0u; stride /= 2u) {
        if (lane < stride) {
            speeds[lane] = max(speeds[lane], speeds[lane + stride]);
            invalid[lane] = max(invalid[lane], invalid[lane + stride]);
        }
        workgroupBarrier();
    }
    if (lane == 0u) { metrics[group.x] = vec2f(speeds[0], invalid[0]); }
}

@compute @workgroup_size(128)
fn reduce(@builtin(local_invocation_index) lane: u32) {
    var speed = 0.0f; var bad = 0.0f;
    if (running()) {
        for (var i = lane; i < GROUPS; i += 128u) {
            speed = max(speed, metrics[i].x); bad = max(bad, metrics[i].y);
        }
    }
    speeds[lane] = speed; invalid[lane] = bad;
    workgroupBarrier();
    for (var stride = ${128/2}u; stride > 0u; stride /= 2u) {
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

@compute @workgroup_size(128)
fn restore(@builtin(global_invocation_id) id: vec3u) {
    if (id.x < N && control.enabled != 0u && control.failed != 0u) { destination[id.x] = original[id.x]; }
}

@compute @workgroup_size(128)
fn snapshot(@builtin(global_invocation_id) id: vec3u) {
    if (id.x < N) {
        let a = source[id.x];
        output[id.x] = vec4f(a.q.x, a.w.x, a.w.y, a.w.w);
    }
}
`}var d=class extends c{constructor(e={}){super(e),this.buffers=[],this.disposed=!1,this.pendingSnapshots=[],this.snapshotSlot=0,this.hostTimings={batches:0,encodedAttempts:0,controlWaitMs:0,snapshotWaitMs:0,snapshotProcessingMs:0}}async initialize(e){if(this.device||this.disposed)throw Error(`Create a new GPU solver for each run.`);if(!globalThis.navigator?.gpu)throw Error(`WebGPU is unavailable. Uncheck GPU acceleration to use the CPU solver.`);let t=performance.now();try{super.initialize(e),this.rhoScale=Math.max(...this.slabs.map(e=>e.density)),this.velocityScale=this.maxWaveSpeed,this.pressureScale=this.rhoScale*this.velocityScale**2,this.timeScale=this.totalLength/this.velocityScale,this.mwScale=Math.min(...this.slabs.map(e=>e.mw));for(let e of[this.rhoScale,this.velocityScale,this.pressureScale,this.timeScale,this.mwScale])if(!(e>0)||!Number.isFinite(e))throw Error(`Inputs exceed GPU scaling limits. Use the CPU solver.`);let n=await navigator.gpu.requestAdapter({powerPreference:`high-performance`});if(!n)throw Error(`No WebGPU adapter is available. Uncheck GPU acceleration to use the CPU solver.`);this.adapterInfo=n.info?{vendor:n.info.vendor,architecture:n.info.architecture,device:n.info.device,description:n.info.description,isFallbackAdapter:n.info.isFallbackAdapter}:{},this.cellStride=Math.ceil((32+8*this.numMaterials)/16)*16;let r=Math.ceil((16+8*this.numMaterials)/16)*16,i=this.nx*this.cellStride,a=(this.nx+1)*r,o=Math.max(i,a);if(o>n.limits.maxStorageBufferBindingSize||o>n.limits.maxBufferSize||Math.ceil((this.nx+1)/128)>n.limits.maxComputeWorkgroupsPerDimension)throw Error(`This grid exceeds the GPU buffer limits. Reduce cells or use the CPU solver.`);this.device=await n.requestDevice({requiredLimits:{maxStorageBufferBindingSize:Math.max(128*1024*1024,o),maxBufferSize:Math.max(256*1024*1024,o)}});let s=this.device;s.lost.then(e=>{this.disposed||(this.gpuError=Error(`GPU device lost: ${e.message}. Uncheck GPU acceleration to use the CPU solver.`))}),s.addEventListener(`uncapturederror`,e=>{this.gpuError=Error(e.error.message)}),s.pushErrorScope(`validation`),s.pushErrorScope(`out-of-memory`);let c=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST;this.state=[this.buffer(i,c),this.buffer(i,c)],this.original=this.buffer(i,c),this.faces=this.buffer(a,c),this.metrics=this.buffer(Math.ceil(this.nx/128)*8,c),this.control=this.buffer(384,c),this.output=this.buffer(this.nx*16,c),this.controlReadback=this.buffer(384,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST),this.snapshotReadbacks=Array.from({length:2},()=>this.buffer(this.nx*16,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST));let l=new Float32Array(i/4);for(let e=0;e<this.nx;e++){let t=e*this.cellStride/4;l[t]=this.U[3*e]/this.rhoScale,l[t+1]=this.U[3*e+1]/(this.rhoScale*this.velocityScale),l[t+2]=this.U[3*e+2]/this.pressureScale,l[t+4]=this.u[e]/this.velocityScale,l[t+5]=this.p[e]/this.pressureScale,l[t+6]=this.soundSpeed[e]/this.velocityScale,l[t+7]=this.rho[e]/this.mw[e]*this.mwScale/this.rhoScale;for(let n=0;n<this.numMaterials;n++)l[t+8+2*n]=this.materialFractions[e*this.numMaterials+n],l[t+9+2*n]=this.materialMass[e*this.numMaterials+n]/this.rhoScale;let n=(l[t+2]-.5*l[t+1]**2/l[t])/this.materialFractions.subarray(e*this.numMaterials,(e+1)*this.numMaterials).reduce((e,t,n)=>e+t*this.materialBeta[n],0);if(!(l[t]>0)||!(l[t+5]>0)||!(l[t+6]>0)||Math.abs(n/l[t+5]-1)>1e-4)throw Error(`These initial conditions need double precision. Uncheck GPU acceleration.`)}if(!l.every(Number.isFinite))throw Error(`Inputs exceed GPU single-precision limits. Use the CPU solver.`);s.queue.writeBuffer(this.state[0],0,l);let d=new Float32Array(384/4);d[1]=this.maxWaveSpeed/this.velocityScale;for(let e=0;e<this.tracers.length;e++)d[32+4*e]=this.tracers[e].x/this.totalLength,d[33+4*e]=1;s.queue.writeBuffer(this.control,0,d);let f=s.createBindGroupLayout({entries:Array.from({length:7},(e,t)=>({binding:t,visibility:GPUShaderStage.COMPUTE,buffer:{type:t===0?`read-only-storage`:`storage`}}))}),p=s.createPipelineLayout({bindGroupLayouts:[f]}),m=s.createShaderModule({code:u(this)}),h=(await m.getCompilationInfo()).messages.filter(e=>e.type===`error`);if(h.length)throw Error(`GPU shader: ${h.map(e=>`${e.lineNum}: ${e.message}`).join(`. `)}`);this.pipelines={};let g=[];for(let e of[`prepare`,`fluxes`,`restore`,`snapshot`,`update`,`reduce`])for(let t=0;t<([`fluxes`,`update`,`reduce`].includes(e)?4:1);t++){let n=[`fluxes`,`update`,`reduce`].includes(e)?`${e}${t}`:e;g.push(s.createComputePipelineAsync({layout:p,compute:{module:m,entryPoint:e,constants:{stage:t}}}).then(e=>{this.pipelines[n]=e}))}await Promise.all(g),this.bindings=this.state.map((e,t)=>s.createBindGroup({layout:f,entries:[e,this.state[1-t],this.original,this.faces,this.metrics,this.control,this.output].map((e,t)=>({binding:t,resource:{buffer:e}}))}));let _=await s.popErrorScope(),v=await s.popErrorScope();if(_||v)throw Error((_||v).message);this.assertDevice();for(let e of[`U`,`Un`,`gamma`,`mw`,`soundSpeed`,`inverseDensity`,`flux`,`faceVelocity`,`oldVelocity`,`materialFractions`,`materialMass`,`fractionsN`,`massN`,`materialFlux`,`fractionFlux`])this[e]=null;this.setupMs=performance.now()-t,this.warnings.push(`GPU acceleration: single-precision calculations. Snapshot precision controls storage only.`)}catch(e){throw this.dispose(),e}}buffer(e,t){let n=this.device.createBuffer({size:e,usage:t});return this.buffers.push(n),n}assertDevice(){if(this.gpuError)throw this.gpuError;if(this.disposed)throw Error(`GPU solver has been disposed.`)}dispatch(e,t,n=0,r=1){e.setPipeline(this.pipelines[t]),e.setBindGroup(0,this.bindings[n]),e.dispatchWorkgroups(r)}async advanceBatch(e){this.assertDevice();let t=this.device.createCommandEncoder(),n=t.beginComputePass(),r=Math.ceil(this.nx/128),i=Math.ceil((this.nx+1)/128);for(let t=0;t<e;t++){this.dispatch(n,`prepare`);for(let e=0;e<4;e++)this.dispatch(n,`fluxes${e}`,e%2,i),this.dispatch(n,`update${e}`,e%2,r),this.dispatch(n,`reduce${e}`,e%2);this.dispatch(n,`restore`,1,r)}n.end(),t.copyBufferToBuffer(this.control,0,this.controlReadback,0,384),this.device.queue.submit([t.finish()]),this.hostTimings.batches++,this.hostTimings.encodedAttempts+=e;let a=performance.now(),o=this.controlReadback.mapAsync(GPUMapMode.READ).then(()=>null,e=>e);await this.drainSnapshots();let s=await o;if(this.hostTimings.controlWaitMs+=performance.now()-a,s)throw s;let c=this.controlReadback.getMappedRange().slice(0);this.controlReadback.unmap(),this.assertDevice();let l=new Uint32Array(c),u=new Float32Array(c);if(l[11])throw Error(l[11]===2?`GPU timestep failed after 12 retries (${[``,`nonfinite material`,`volume fraction bounds`,`negative material density`,`material mass consistency`,`volume fraction sum`,`nonpositive state`,`nonfinite thermodynamics`,`stage CFL`][u[26]]},
                ${l[8]} steps). Reduce CFL or use the CPU solver for these conditions.`:`GPU timestep or step count exceeds numerical precision. Use the CPU solver.`);return this.timeSteps=l[8],this.retries=l[9],this.fallbackFluxes+=l[10]-(this.lastFallbackCount??0)>>>0,this.lastFallbackCount=l[10],this.maxWaveSpeed=u[1]*this.velocityScale,u}queueSnapshot(e,t){if(this.pendingSnapshots.length>=this.snapshotReadbacks.length)throw Error(`GPU snapshot queue is full.`);let n=this.snapshotReadbacks[this.snapshotSlot];this.snapshotSlot=(this.snapshotSlot+1)%this.snapshotReadbacks.length;let r=this.device.createCommandEncoder(),i=r.beginComputePass();this.dispatch(i,`snapshot`,0,Math.ceil(this.nx/128)),i.end(),r.copyBufferToBuffer(this.output,0,n,0,this.nx*16),this.device.queue.submit([r.finish()]);let a=n.mapAsync(GPUMapMode.READ).then(()=>null,e=>e);this.pendingSnapshots.push({buffer:n,mapped:a,values:e,time:t})}async drainSnapshots(){for(;this.pendingSnapshots.length;){let e=this.pendingSnapshots.shift(),t=performance.now(),n=await e.mapped;if(this.hostTimings.snapshotWaitMs+=performance.now()-t,n)throw n;try{this.assertDevice();let t=performance.now();this.saveDownloadedSnapshot(new Float32Array(e.buffer.getMappedRange()),e.values,e.time),this.hostTimings.snapshotProcessingMs+=performance.now()-t}finally{e.buffer.unmap()}}}saveDownloadedSnapshot(t,n,r){for(let e=0;e<this.tracers.length;e++){let t=this.tracers[e],r=32+4*e;t.x=n[r]*this.totalLength,t.active&&n[r+1]===0&&(t.active=!1,t.exit={t:n[r+2]*this.timeScale,x:t.x},t.path.push(t.exit))}let i={t:r,tracerX:this.tracers.map(e=>e.active?e.x:null),ranges:{}},a=this.config.snapshotPrecision===`32`?Float32Array:Float64Array,o=this.nx>8192,s=o?Math.ceil(this.nx/1024):this.nx;o&&(i.plotIndices={});let c=[`rho`,`u`,`p`,`T`],l=[this.rhoScale,this.velocityScale,this.pressureScale];for(let n=0;n<c.length;n++){let r=c[n],u=i[r]=new a(this.nx),d=this[r],f=o?i.plotIndices[r]=new Uint32Array(Math.ceil(this.nx/s)*4):null,p=1/0,m=-1/0,h=0;for(let r=0;r<this.nx;r+=s){let i=Math.min(this.nx,r+s),a=r,o=r;for(let s=r;s<i;s++){let r=4*s,i=n<3?t[r+n]*l[n]:this.config.unitSystem===`arbitrary`?t[r+2]*this.pressureScale/(t[r]*this.rhoScale):t[r+2]*this.pressureScale/(e*t[r+3]*this.rhoScale/this.mwScale);d[s]=i,u[s]=i;let c=u[s];if(!Number.isFinite(c)||n!==1&&c<=0)throw Error(`Snapshot precision cannot represent this state. Select 64-bit snapshots.`);p=Math.min(p,c),m=Math.max(m,c),f&&(c<u[a]&&(a=s),c>u[o]&&(o=s))}f&&(f[h++]=r,f[h++]=Math.min(a,o),f[h++]=Math.max(a,o),f[h++]=i-1)}i.ranges[r]={min:p,max:m},this.ranges[r].min=Math.min(this.ranges[r].min,p),this.ranges[r].max=Math.max(this.ranges[r].max,m)}let u=[this.rhoScale,this.rhoScale*this.velocityScale,this.pressureScale];for(let e=0;e<3;e++)this.boundaryTransfer[e]=n[12+e]*u[e]*this.totalLength;this.history.push(i);for(let e of this.tracers)e.active&&e.path.push({t:r,x:e.x})}async step(e=()=>{},t=!1){if(this.assertDevice(),!this.device||!this.initialized)throw Error(`Initialize the GPU solver before stepping.`);if(this.t>=this.finalTime)return!1;let n=this.nextSnapshotTime,r=Math.fround((n-this.t)/this.timeScale);if(!(r>0)||!Number.isFinite(r))throw Error(`Snapshot interval exceeds GPU precision. Use the CPU solver.`);this.device.queue.writeBuffer(this.control,8,new Float32Array([0,0,r])),this.device.queue.writeBuffer(this.control,100,new Float32Array([this.t/this.timeScale]));let i,a=r;do{let t=a*(this.maxWaveSpeed/this.velocityScale)*this.nx/this.cfl,n=this.nx>=16384?64:32;i=await this.advanceBatch(Math.min(n,Math.max(1,Math.ceil(t)))),a=Math.max(0,r-i[2]),e(Math.min(1,(this.t+i[2]*this.timeScale)/this.finalTime))}while(a>0);return this.t=n,this.queueSnapshot(i,n),t||await this.drainSnapshots(),this.snapshotNumber++,this.nextSnapshotTime=Math.min(this.snapshotNumber*this.xtInterval,this.finalTime),!0}async runFullSimulation(e){for(;await this.step(e,!0););return await this.drainSnapshots(),this.history}getResult(){let e=super.getResult();return e.config.gpuAcceleration=!0,Object.assign(e.diagnostics,{backend:`WebGPU`,computationPrecision:`32`,gpuSetupMs:this.setupMs,adapter:this.adapterInfo,hostTimings:{...this.hostTimings}}),e}dispose(){this.disposed=!0;for(let e of this.buffers)e.destroy();this.buffers=[],this.device?.destroy()}};typeof self<`u`&&typeof document>`u`&&self.addEventListener(`message`,async e=>{if(!e.data.gpuAcceleration)return;let t;try{let n=performance.now();t=new d(e.data.config),await t.initialize(e.data.slabs);let r=n;await t.runFullSimulation(e=>{performance.now()-r>100&&(self.postMessage({type:`progress`,progress:e}),r=performance.now())});let i=t.getResult();i.diagnostics.calculationMs=performance.now()-n;let a=[i.x.buffer];for(let e of i.history)for(let t of[`rho`,`u`,`p`,`T`])a.push(e[t].buffer),e.plotIndices&&a.push(e.plotIndices[t].buffer);self.postMessage({type:`complete`,result:i},a)}catch(e){self.postMessage({type:`error`,message:e.message})}finally{t?.dispose()}})})();