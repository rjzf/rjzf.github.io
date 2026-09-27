// Compressible Euler flow with a conservative material tracer.
// GPU numerics, snapshots, worker, and page controls are kept together here.

function createRMEngine() {
  const GAMMA = 1.4
  // Browser snapshot budget in decimal MB, independent of numerical resolution.
  const HISTORY_BYTES = 192 * 1000 * 1000
  const CONFIG = Object.freeze({
    mach: 2,
    cfl: 0.35,
    atwood: 0.5,
    amplitude: 0.08,
    waves: 2,
    width: 0.025,
    frame: 'contact',
    direction: 'light-heavy',
    length: 4,
    saveInterval: 0.25,
    maxSnapshots: 30
  })

  // Same display palettes as RT and KH.
  const PALETTES = {
    'red-blue': { heavy: [0.96, 0.08, 0.12], light: [0.08, 0.24, 0.98], names: ['Red', 'blue'] },
    'orange-blue': { heavy: [230 / 255, 159 / 255, 0], light: [0, 114 / 255, 178 / 255], names: ['Orange', 'blue'] },
    'magenta-teal': { heavy: [204 / 255, 121 / 255, 167 / 255], light: [0, 158 / 255, 115 / 255], names: ['Magenta', 'teal'] },
    'black-white': { heavy: [0, 0, 0], light: [1, 1, 1], names: ['Black', 'white'] },
    'navy-gold': { heavy: [24 / 255, 45 / 255, 85 / 255], light: [250 / 255, 195 / 255, 50 / 255], names: ['Navy', 'gold'] },
    'purple-mint': { heavy: [106 / 255, 52 / 255, 163 / 255], light: [146 / 255, 235 / 255, 192 / 255], names: ['Purple', 'mint'] }
  }

  // Derive the Rankine-Hugoniot shock state and the Atwood density ratio.
  function parameters(options = {}) {
    const c = { ...CONFIG, ...options }
    const ranges = [
      ['mach', 1.1, 2.5], ['atwood', 0, 0.8], ['amplitude', 0, 0.15],
      ['waves', 1, 4], ['width', 0.0125, 0.075], ['saveInterval', 0.01, 1],
      ['maxSnapshots', 2, 50], ['cfl', 0.05, 0.5]
    ]
    for (const [key, lo, hi] of ranges) {
      if (!Number.isFinite(c[key]) || c[key] < lo || c[key] > hi) {
        throw Error(`Use ${key} from ${lo} to ${hi}.`)
      }
    }
    if (!Number.isInteger(c.waves) || !Number.isInteger(c.maxSnapshots)) {
      throw Error('Waves and snapshots must be whole numbers.')
    }
    if (!['contact', 'lab'].includes(c.frame) || ![4, 8].includes(c.length)) {
      throw Error('Choose a supported frame and domain.')
    }
    c.contrast = (1 + c.atwood) / (1 - c.atwood)
    if (!['light-heavy', 'heavy-light'].includes(c.direction)) throw Error('Choose a shock direction.')
    c.incidentDensity = c.direction === 'heavy-light' ? c.contrast : 1
    c.targetDensity = c.direction === 'heavy-light' ? 1 : c.contrast
    c.shockSpeed = c.mach * Math.sqrt(GAMMA / c.incidentDensity)
    const ratio = (GAMMA + 1) * c.mach ** 2 / ((GAMMA - 1) * c.mach ** 2 + 2)
    c.postShock = [
      ratio * c.incidentDensity,
      c.shockSpeed * (1 - 1 / ratio),
      0,
      1 + 2 * GAMMA / (GAMMA + 1) * (c.mach ** 2 - 1),
      c.direction === 'heavy-light' ? 1 : 0
    ]
    // Initial shock x = 0.6 and mean interface x = 1.5 in laboratory coordinates.
    c.impactTime = 0.9 / c.shockSpeed
    return c
  }

  // Solve the exact planar Riemann pressure equation for the contact-frame speed.
  function interaction(options = {}) {
    const cfg = parameters(options)
    const left = cfg.postShock
    const right = [cfg.targetDensity, 0, 0, 1, cfg.direction === 'heavy-light' ? 0 : 1]
    const gm = GAMMA - 1
    function wave(p, q) {
      if (p > q[3]) {
        return (p - q[3]) * Math.sqrt(2 / ((GAMMA + 1) * q[0]) / (p + gm / (GAMMA + 1) * q[3]))
      }
      return 2 * Math.sqrt(GAMMA * q[3] / q[0]) / gm * ((p / q[3]) ** (gm / (2 * GAMMA)) - 1)
    }
    // Positive pressure bracket for supported inputs, with 80 bisection iterations.
    let lo = 1e-12
    let hi = Math.max(10, left[3] * 4)
    let iterations = 80
    while (iterations > 0) {
      const mid = (lo + hi) / 2
      if (wave(mid, left) + wave(mid, right) - left[1] > 0) hi = mid
      else lo = mid
      iterations -= 1
    }
    const p = (lo + hi) / 2
    const density = q => {
      const ratio = p / q[3]
      const beta = gm / (GAMMA + 1)
      return q[0] * (ratio > 1 ? (ratio + beta) / (beta * ratio + 1) : ratio ** (1 / GAMMA))
    }
    return {
      speed: 0.5 * (left[1] + wave(p, right) - wave(p, left)),
      pressure: p, leftDensity: density(left), rightDensity: density(right)
    }
  }

  function contactSpeed(options = {}) {
    return interaction(options).speed
  }

  // Display scales include initial and planar post-impact states with 20% headroom.
  function fieldScales(options = {}) {
    const cfg = parameters(options)
    const star = interaction(cfg)
    return {
      density: [0, 1.2 * Math.max(cfg.contrast, cfg.postShock[0], star.leftDensity, star.rightDensity)],
      pressure: [0, 1.2 * Math.max(1, cfg.postShock[3], star.pressure)]
    }
  }

  // Transform velocity and total energy together before uploading the initial field.
  function initialState(resolution, options = {}) {
    if (![64, 128, 256, 512, 1024].includes(resolution)) throw Error('Choose a supported resolution.')
    const config = parameters(options)
    const ny = resolution / 4
    const nx = ny * config.length
    const dx = 1 / ny
    const origin = -(config.length - 4) / 2
    const frameSpeed = config.frame === 'contact' ? contactSpeed(config) : 0
    // Cell-major storage: density, x/y momentum, total energy, heavy-material mass.
    const U = new Float32Array(nx * ny * 5)
    let i = 0
    while (i < nx * ny) {
      const x = origin + (i % nx + 0.5) * dx
      const y = (Math.floor(i / nx) + 0.5) * dx
      const ripple = config.amplitude / config.waves * Math.cos(2 * Math.PI * config.waves * y)
      const rightFraction = 0.5 * (1 + Math.tanh((x - 1.5 - ripple) / config.width))
      const c = config.direction === 'heavy-light' ? 1 - rightFraction : rightFraction
      const [rho, labU, , p, fraction] = x < 0.6 ? config.postShock : [1 + (config.contrast - 1) * c, 0, 0, 1, c]
      const u = labU - frameSpeed
      U.set([rho, rho * u, 0, p / (GAMMA - 1) + 0.5 * rho * u * u, rho * fraction], 5 * i)
      i += 1
    }
    return { nx, ny, dx, dy: dx, origin, length: config.length, frameSpeed, impactTime: config.impactTime, config, U }
  }

  // GPU shaders use GLSL syntax.
  const VERTEX = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`
  // RGBA32F stateA stores rho, rho*u, rho*v, E at cell centers.
  // stateC stores heavy mass, light mass, rejection code, and an unused channel.
  const COMMON = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform ivec2 grid;
uniform float h, dt;
uniform sampler2D stateA, stateC;
struct S { vec4 a; float c; };
// Zero-gradient x boundaries and periodic y boundaries.
ivec2 cell(ivec2 p) { return ivec2(clamp(p.x,0,grid.x-1), (p.y%grid.y+grid.y)%grid.y); }
S state(ivec2 p) { p=cell(p); return S(texelFetch(stateA,p,0),texelFetch(stateC,p,0).r); }
// Shared ideal-gas gamma is 1.4, so gamma - 1 is 0.4.
float pressure(S u) { return .4*(u.a.w-dot(u.a.yz,u.a.yz)/(2.*u.a.x)); }
S primitive(S u) { return S(vec4(u.a.x,u.a.yz/u.a.x,pressure(u)),u.c/u.a.x); }
S conserved(S q) { return S(vec4(q.a.x,q.a.x*q.a.yz,q.a.w/.4+.5*q.a.x*dot(q.a.yz,q.a.yz)),q.a.x*q.c); }
bool finite4(vec4 a) { return !any(isnan(a))&&!any(isinf(a)); }
// Positive density/pressure floors and float32 material-fraction tolerance.
bool valid(S q) { return finite4(q.a)&&!isnan(q.c)&&!isinf(q.c)&&q.a.x>1e-9&&q.a.w>1e-9&&q.c>=-1e-6&&q.c<=1.000001; }
float invalidReason(S q) {
  return !finite4(q.a)||isnan(q.c)||isinf(q.c)?4.:q.a.x<=1e-9?3.:q.a.w<=1e-9?2.:!valid(q)?1.:0.;
}
`
  // Reconstruct both face states and fall back when HLLC is inadmissible.
  const FACE = COMMON + `
uniform int axis, lowOrder;
layout(location=0) out vec4 outA;
layout(location=1) out vec4 outC;
float mm(float a,float b) { return a*b<=0.?0.:sign(a)*min(abs(a),abs(b)); }
// Monotonized-central (MC) primitive-variable reconstruction.
float slope(float a,float b) { return mm(.5*(a+b),mm(2.*a,2.*b)); }
S reconstruct(ivec2 p,ivec2 d,float signFace) {
  S q=primitive(state(p));
  if(lowOrder==1||p.x<0||p.x>=grid.x)return q;
  S l=primitive(state(p-d)),r=primitive(state(p+d)),v=q;
  for(int k=0;k<4;k++)v.a[k]+=signFace*.5*slope(q.a[k]-l.a[k],r.a[k]-q.a[k]);
  v.c+=signFace*.5*slope(q.c-l.c,r.c-q.c);
  if(valid(v))return v;return q;
}
S physical(S q,S u) { return S(u.a*q.a.y+vec4(0,q.a.w,0,q.a.w*q.a.y),u.c*q.a.y); }
S star(S q,S u,float s,float sm) {
  float rho=q.a.x*(s-q.a.y)/(s-sm);
  return S(vec4(rho,rho*sm,rho*q.a.z,rho*(u.a.w/q.a.x+(sm-q.a.y)*(sm+q.a.w/(q.a.x*(s-q.a.y))))),rho*q.c);
}
void main() {
  ivec2 p=ivec2(gl_FragCoord.xy),d=axis==0?ivec2(1,0):ivec2(0,1);
  S L=reconstruct(p-d,d,1.),R=reconstruct(p,d,-1.);
  if(axis==1){L.a.yz=L.a.zy;R.a.yz=R.a.zy;}
  S UL=conserved(L),UR=conserved(R),FL=physical(L,UL),FR=physical(R,UR),F;
  float al=sqrt(1.4*L.a.w/L.a.x),ar=sqrt(1.4*R.a.w/R.a.x);
  float l=sqrt(L.a.x),r=sqrt(R.a.x);
  vec2 uv=(l*L.a.yz+r*R.a.yz)/(l+r);
  float H=(l*(UL.a.w+L.a.w)/L.a.x+r*(UR.a.w+R.a.w)/R.a.x)/(l+r);
  float a=sqrt(max(0.,.4*(H-.5*dot(uv,uv))));
  float sl=min(min(L.a.y-al,R.a.y-ar),uv.x-a),sr=max(max(L.a.y+al,R.a.y+ar),uv.x+a);
  float lightFlux;
  if(sl>=0.){F=FL;lightFlux=FL.a.x*(1.-L.c);}
  else if(sr<=0.){F=FR;lightFlux=FR.a.x*(1.-R.c);}
  else {
    // HLLE flux remains the fallback if either HLLC star state is inadmissible.
    F=S((sr*FL.a-sl*FR.a+sl*sr*(UR.a-UL.a))/(sr-sl),(sr*FL.c-sl*FR.c+sl*sr*(UR.c-UL.c))/(sr-sl));
    float lightL=UL.a.x*(1.-L.c),lightR=UR.a.x*(1.-R.c);
    lightFlux=(sr*lightL*L.a.y-sl*lightR*R.a.y+sl*sr*(lightR-lightL))/(sr-sl);
    if(lowOrder==0){
      float sm=(R.a.w-L.a.w+L.a.x*L.a.y*(sl-L.a.y)-R.a.x*R.a.y*(sr-R.a.y))/(L.a.x*(sl-L.a.y)-R.a.x*(sr-R.a.y));
      S ls=star(L,UL,sl,sm),rs=star(R,UR,sr,sm);
      if(sm>=sl&&sm<=sr&&valid(primitive(ls))&&valid(primitive(rs))){
        if(sm>=0.)F=S(FL.a+sl*(ls.a-UL.a),FL.c+sl*(ls.c-UL.c));
        else F=S(FR.a+sr*(rs.a-UR.a),FR.c+sr*(rs.c-UR.c));
        float fraction=sm>=0.?L.c:R.c;
        F.c=F.a.x*fraction;
        lightFlux=F.a.x*(1.-fraction);
      }
    }
  }
  // Equal fractions must share exactly the same mass flux arithmetic.
  if(L.c==R.c){F.c=F.a.x*L.c;lightFlux=F.a.x*(1.-L.c);}
  F.a.x=F.c+lightFlux;
  if(axis==1)F.a.yz=F.a.zy;
  outA=F.a;outC=vec4(F.c,lightFlux,0,0);
}`
  // SSP-RK2 conservative update using one shared flux per cell face.
  const UPDATE = COMMON + `
uniform sampler2D fxA,fxC,fyA,fyC,originalA,originalC;
uniform int stage;
layout(location=0) out vec4 outA;
layout(location=1) out vec4 outC;
void main(){
  ivec2 p=ivec2(gl_FragCoord.xy),r=p+ivec2(1,0),t=cell(p+ivec2(0,1));
  S u=state(p);
  // Carry the first RK stage check into the final reduction.
  float rejected=stage==1?invalidReason(primitive(u)):0.;
  if(rejected>0.){outA=u.a;outC=vec4(texelFetch(stateC,p,0).rg,rejected,0);return;}
  vec4 a=u.a-dt/h*(texelFetch(fxA,r,0)-texelFetch(fxA,p,0)+texelFetch(fyA,t,0)-texelFetch(fyA,p,0));
  // Evolve both material masses conservatively. Their sum supplies total density.
  vec2 masses=texelFetch(stateC,p,0).rg-dt/h*(
    texelFetch(fxC,r,0).rg-texelFetch(fxC,p,0).rg+
    texelFetch(fyC,t,0).rg-texelFetch(fyC,p,0).rg);
  if(stage==1){
    a=.5*(a+texelFetch(originalA,p,0));
    masses=.5*(masses+texelFetch(originalC,p,0).rg);
  }
  a.x=masses.x+masses.y;
  outA=a;outC=vec4(masses,rejected,0);
}`
  // Only this four-float reduction is read by the CPU during integration.
  const METRICS = COMMON + `
out vec4 color;
void main(){
  ivec2 base=ivec2(gl_FragCoord.xy)*4;
  color=vec4(-1e30);
  for(int y=0;y<4;y++)for(int x=0;x<4;x++){
    ivec2 p=base+ivec2(x,y);
    if(any(greaterThanEqual(p,grid)))continue;
    S q=primitive(state(p));
    float reason=max(invalidReason(q),texelFetch(stateC,p,0).b);
    float a=sqrt(max(0.,1.4*q.a.w/q.a.x));
    vec4 value=reason==0.?vec4((abs(q.a.y)+abs(q.a.z)+2.*a)/h,0,-q.a.w,-q.a.x):vec4(0,reason,0,0);
    color=max(color,value);
  }
}`
  const REDUCE = `#version 300 es
precision highp float;precision highp int;precision highp sampler2D;
uniform sampler2D source;uniform ivec2 sourceSize;out vec4 color;
void main(){ivec2 p=ivec2(gl_FragCoord.xy)*4;color=vec4(-1e30);
for(int y=0;y<4;y++)for(int x=0;x<4;x++){ivec2 q=p+ivec2(x,y);if(all(lessThan(q,sourceSize)))color=max(color,texelFetch(source,q,0));}}
`
  const DISPLAY = COMMON + `
uniform vec2 viewportSize,fieldRange;
uniform vec3 lightColor,heavyColor;
uniform int field;
uniform float overlay,viewStart,viewWidth;
out vec4 color;
vec3 sampleColor(ivec2 p){
 S q=primitive(state(p));float v=field==0?q.c:((field==1?q.a.x:q.a.w)-fieldRange.x)/(fieldRange.y-fieldRange.x);
 vec3 c=mix(lightColor,heavyColor,clamp(v,0.,1.));
 if(overlay>0.){
   float px=pressure(state(p+ivec2(1,0)))-pressure(state(p-ivec2(1,0)));
   float py=pressure(state(p+ivec2(0,1)))-pressure(state(p-ivec2(0,1)));
   float edge=1.-exp(-.07*length(vec2(px,py))/(2.*h*max(q.a.w,1e-6)));
   c=mix(c,vec3(.05),.55*edge);c+=vec3(.22*edge);
 }return c;
}
void main(){
 vec2 uv=gl_FragCoord.xy/viewportSize;
 // One finite-volume cell per color sample, including zoomed views.
 ivec2 p=ivec2(floor(vec2(viewStart+uv.x*viewWidth,uv.y*float(grid.y))));
 color=vec4(sampleColor(p),1);
}`


  // Each face flux is stored once and shared by its neighboring cells.
  class RMGPU {
    constructor(canvas, resolution = 256, options = {}) {
      this.canvas = canvas
      const gl = canvas.getContext('webgl2', { antialias: false, depth: false, stencil: false })
      this.gl = gl
      if (!gl || !gl.getExtension('EXT_color_buffer_float')) {
        throw Error('This simulation requires WebGL 2 with floating-point targets.')
      }
      this.resources = []
      this.programs = []
      try {
        this.faceProgram = this.program(FACE)
        this.updateProgram = this.program(UPDATE)
        this.metricProgram = this.program(METRICS)
        this.reduceProgram = this.program(REDUCE)
        this.displayProgram = this.program(DISPLAY)
        this.copyProgram = this.program(COMMON + `
layout(location=0) out vec4 outA;
layout(location=1) out vec4 outC;
void main() {
  S s = state(ivec2(gl_FragCoord.xy));
  outA = s.a;
  outC = texelFetch(stateC, cell(ivec2(gl_FragCoord.xy)), 0);
}`)
        this.reset(resolution, options)
      } catch (error) {
        this.dispose()
        throw error
      }
    }

    // Reuse shaders and same-sized working targets when starting a new case.
    reset(resolution, options = {}) {
      const seed = initialState(resolution, options)
      const resize = this.nx !== seed.nx || this.ny !== seed.ny
      for (const key of ['nx', 'ny', 'dx', 'dy', 'config', 'origin', 'length', 'frameSpeed', 'impactTime']) {
        this[key] = seed[key]
      }
      this.scales = fieldScales(this.config)
      this.time = 0
      this.steps = 0
      this.stats = { retries: 0 }
      const gl = this.gl
      if (this.nx + 1 > gl.getParameter(gl.MAX_TEXTURE_SIZE) || gl.getParameter(gl.MAX_DRAW_BUFFERS) < 2) {
        throw Error('The selected grid exceeds this GPU’s limits.')
      }
      if (resize) {
        for (const target of [...this.resources]) this.release(target)
        this.live = this.target(this.nx, this.ny)
        this.A = this.target(this.nx, this.ny)
        this.B = this.target(this.nx, this.ny)
        this.fx = this.target(this.nx + 1, this.ny)
        this.fy = this.target(this.nx, this.ny)
        this.reductions = []
        let w = Math.ceil(this.nx / 4)
        let h = Math.ceil(this.ny / 4)
        while (true) {
          this.reductions.push(this.target(w, h, 1))
          if (w === 1 && h === 1) break
          w = Math.ceil(w / 4)
          h = Math.ceil(h / 4)
        }
      }
      this.upload(seed.U)
      this.metrics = this.measure(this.live)
    }

    program(fragment) {
      const gl = this.gl
      const p = gl.createProgram()
      for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, fragment]]) {
        const shader = gl.createShader(type)
        gl.shaderSource(shader, source)
        gl.compileShader(shader)
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          const message = gl.getShaderInfoLog(shader)
          gl.deleteShader(shader)
          gl.deleteProgram(p)
          throw Error(message)
        }
        gl.attachShader(p, shader)
        gl.deleteShader(shader)
      }
      gl.linkProgram(p)
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        const message = gl.getProgramInfoLog(p)
        gl.deleteProgram(p)
        throw Error(message)
      }
      const uniforms = {}
      let i = 0
      while (i < gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS)) {
        const u = gl.getActiveUniform(p, i)
        uniforms[u.name] = { location: gl.getUniformLocation(p, u.name), type: u.type }
        i += 1
      }
      const result = { p, uniforms }
      this.programs.push(result)
      return result
    }

    target(w, h, count = 2) {
      const gl = this.gl
      if (gl.isContextLost()) throw Error('Graphics context lost. Reset to restart.')
      const fbo = gl.createFramebuffer()
      const textures = []
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
      const result = { w, h, fbo, textures }
      this.resources.push(result)
      try {
        if (!fbo) throw Error('GPU framebuffer allocation failed.')
        while (textures.length < count) {
          const texture = gl.createTexture()
          if (!texture) throw Error('GPU texture allocation failed.')
          textures.push(texture)
          gl.bindTexture(gl.TEXTURE_2D, texture)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
          gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, w, h)
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + textures.length - 1, gl.TEXTURE_2D, texture, 0)
        }
        gl.drawBuffers(textures.map((_, i) => gl.COLOR_ATTACHMENT0 + i))
        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER)
        const error = gl.getError()
        if (gl.isContextLost()) throw Error('Graphics context lost. Reset to restart.')
        if (error === gl.OUT_OF_MEMORY) throw Error('GPU memory allocation failed.')
        if (error !== gl.NO_ERROR) throw Error(`GPU texture allocation failed (WebGL error ${error}).`)
        if (status !== gl.FRAMEBUFFER_COMPLETE) throw Error(`GPU framebuffer is incomplete (status ${status}).`)
        return result
      } catch (error) {
        this.release(result)
        throw error
      }
    }

    release(target) {
      if (!target) return
      target.textures.forEach(texture => this.gl.deleteTexture(texture))
      this.gl.deleteFramebuffer(target.fbo)
      this.resources = this.resources.filter(item => item !== target)
    }

    draw(program, target, values = {}) {
      const gl = this.gl
      if (gl.isContextLost()) throw Error('Graphics context lost. Reset to restart.')
      gl.bindFramebuffer(gl.FRAMEBUFFER, target?.fbo ?? null)
      gl.viewport(0, 0, target?.w ?? this.canvas.width, target?.h ?? this.canvas.height)
      gl.useProgram(program.p)
      const supplied = { grid: [this.nx, this.ny], h: this.dx, ...values }
      let unit = 0
      for (const [name, uniform] of Object.entries(program.uniforms)) {
        const value = supplied[name]
        if (value === undefined) throw Error('Missing GPU uniform ' + name)
        if (uniform.type === gl.SAMPLER_2D) {
          gl.activeTexture(gl.TEXTURE0 + unit)
          gl.bindTexture(gl.TEXTURE_2D, value)
          gl.uniform1i(uniform.location, unit)
          unit += 1
        } else if (uniform.type === gl.INT) gl.uniform1i(uniform.location, value)
        else if (uniform.type === gl.INT_VEC2) gl.uniform2iv(uniform.location, value)
        else if (uniform.type === gl.FLOAT_VEC2) gl.uniform2fv(uniform.location, value)
        else if (uniform.type === gl.FLOAT_VEC3) gl.uniform3fv(uniform.location, value)
        else gl.uniform1f(uniform.location, value)
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }

    bindings(state) {
      return { stateA: state.textures[0], stateC: state.textures[1] }
    }

    upload(U) {
      const gl = this.gl
      const a = new Float32Array(this.nx * this.ny * 4)
      const c = new Float32Array(a.length)
      let cell = 0
      while (cell < this.nx * this.ny) {
        a.set(U.subarray(5 * cell, 5 * cell + 4), 4 * cell)
        c[4 * cell] = U[5 * cell + 4]
        c[4 * cell + 1] = U[5 * cell] - U[5 * cell + 4]
        cell += 1
      }
      for (const [i, data] of [a, c].entries()) {
        gl.bindTexture(gl.TEXTURE_2D, this.live.textures[i])
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.nx, this.ny, gl.RGBA, gl.FLOAT, data)
      }
    }

    // Reduce CFL and validity checks to four values without reading the full field.
    measure(state) {
      this.draw(this.metricProgram, this.reductions[0], this.bindings(state))
      let i = 1
      while (i < this.reductions.length) {
        const previous = this.reductions[i - 1]
        this.draw(this.reduceProgram, this.reductions[i], { source: previous.textures[0], sourceSize: [previous.w, previous.h] })
        i += 1
      }
      const gl = this.gl
      const data = new Float32Array(4)
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.reductions.at(-1).fbo)
      gl.readBuffer(gl.COLOR_ATTACHMENT0)
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, data)
      if (gl.getError() !== gl.NO_ERROR || !data.every(Number.isFinite)) throw Error('GPU reduction failed.')
      return data
    }

    stage(source, output, dt, stage, low) {
      const args = { ...this.bindings(source), lowOrder: low ? 1 : 0 }
      this.draw(this.faceProgram, this.fx, { ...args, axis: 0 })
      this.draw(this.faceProgram, this.fy, { ...args, axis: 1 })
      this.draw(this.updateProgram, output, {
        ...this.bindings(source),
        fxA: this.fx.textures[0], fxC: this.fx.textures[1],
        fyA: this.fy.textures[0], fyC: this.fy.textures[1],
        originalA: this.live.textures[0], originalC: this.live.textures[1], dt, stage
      })
    }

    // Commit only valid SSP-RK2 updates. Failed steps retry with conservative HLLE fluxes.
    // Retry rejected SSP-RK2 updates with first-order HLLE and a smaller timestep.
    step(limit = Infinity) {
      if (this.metrics[1] !== 0) throw Error('Invalid GPU initial state.')
      // Unsplit 2D CFL safety factor for the sum of directional wave speeds.
      let dt = Math.min(this.config.cfl / this.metrics[0], limit)
      if (!(dt > 0)) throw Error('Invalid GPU timestep.')
      let attempt = 0
      let rejection = 0
      // Bound retry work while retaining the last admissible conservative state.
      while (attempt < 12) {
        const low = attempt > 0
        this.stage(this.live, this.A, dt, 0, low)
        this.stage(this.A, this.B, dt, 1, low)
        const metrics = this.measure(this.B)
        rejection = metrics[1]
        if (rejection === 0) {
          const previous = this.live
          this.live = this.B
          this.B = previous
          this.metrics = metrics
          this.time += dt
          this.steps += 1
          return dt
        }
        this.stats.retries += 1
        if (attempt > 0) dt *= 0.5
        attempt += 1
      }
      const reasons = ['Validity', 'Material fraction', 'Pressure', 'Density', 'Finite state']
      throw Object.assign(Error(`${reasons[rejection] ?? reasons[0]} check failed after timestep retries. The last valid state is retained.`), { numerical: true })
    }

    snapshot() {
      const state = this.target(this.nx, this.ny)
      try {
        this.draw(this.copyProgram, state, this.bindings(this.live))
        const error = this.gl.getError()
        if (error !== this.gl.NO_ERROR) throw Error(`Snapshot copy failed (WebGL error ${error}).`)
        return state
      } catch (error) {
        this.release(state)
        throw error
      }
    }

    // Full readback is used only by numerical tests.
    readState(state = this.live) {
      const gl = this.gl
      const a = new Float32Array(this.nx * this.ny * 4)
      const c = new Float32Array(a.length)
      const U = new Float32Array(this.nx * this.ny * 5)
      gl.bindFramebuffer(gl.FRAMEBUFFER, state.fbo)
      gl.readBuffer(gl.COLOR_ATTACHMENT0)
      gl.readPixels(0, 0, this.nx, this.ny, gl.RGBA, gl.FLOAT, a)
      gl.readBuffer(gl.COLOR_ATTACHMENT1)
      gl.readPixels(0, 0, this.nx, this.ny, gl.RGBA, gl.FLOAT, c)
      if (gl.getError() !== gl.NO_ERROR) throw Error('GPU state readback failed.')
      let cell = 0
      while (cell < this.nx * this.ny) {
        U.set(a.subarray(4 * cell, 4 * cell + 4), 5 * cell)
        U[5 * cell + 4] = c[4 * cell]
        cell += 1
      }
      return U
    }

    render(state, display) {
      const { width, height, palette, overlay, field, start, cells } = display
      if (this.canvas.width !== width) this.canvas.width = width
      if (this.canvas.height !== height) this.canvas.height = height
      this.draw(this.displayProgram, null, {
        ...this.bindings(state ?? this.live), viewportSize: [width, height],
        lightColor: palette.light, heavyColor: palette.heavy, overlay: overlay ? 1 : 0,
        field: { material: 0, density: 1, pressure: 2 }[field], fieldRange: this.scales[field] ?? [0, 1],
        viewStart: start, viewWidth: cells
      })
    }

    dispose() {
      for (const target of [...this.resources]) this.release(target)
      for (const program of this.programs) this.gl.deleteProgram(program.p)
      this.programs = []
    }
  }

  // Retain the first saved states, as in RT. A full history never stops the live solver.
  class RMHistory {
    constructor(bytesPerSnapshot, requested = 30, release = () => {}) {
      this.limit = Math.min(requested, Math.floor(HISTORY_BYTES / bytesPerSnapshot))
      this.bytesPerSnapshot = bytesPerSnapshot
      this.release = release
      this.items = []
    }
    get recording() { return this.items.length < this.limit }
    get bytes() { return this.items.length * this.bytesPerSnapshot }
    add(time, state) {
      if (!this.recording) {
        this.release(state)
        return
      }
      this.items.push({ id: this.items.length, time, state })
    }
    clear() {
      this.items.forEach(item => this.release(item.state))
      this.items = []
    }
  }

  return { RMGPU, RMHistory, parameters, contactSpeed, fieldScales, initialState, PALETTES, HISTORY_BYTES }
}

const engine = createRMEngine()
export const { RMGPU, RMHistory, parameters, contactSpeed, fieldScales, initialState, PALETTES, HISTORY_BYTES } = engine

// Build the worker from this file without a circular Vite worker import.
function workerMain(makeEngine) {
  const { RMGPU, RMHistory, PALETTES } = makeEngine()
  let solver, canvas, history
  let viewId = -1
  let historyError = ''
  let simulationError = null
  let computeMs = 0
  let computeTime = 0
  let lastRender = 0
  let display = { palette: 'red-blue', field: 'material', overlay: true, width: 1000 }

  function recording() {
    return history.recording && !historyError
  }

  function nextTime() {
    return history.items.length * solver.config.saveInterval
  }

  function capture() {
    if (!recording()) return
    try {
      history.add(solver.time, solver.snapshot())
    } catch (error) {
      if (solver.gl.isContextLost()) throw error
      historyError = `Snapshot recording stopped: ${error.message}`
    }
  }

  function reply(id, render = true, failure = {}) {
    const saved = history.items.find(item => item.id === viewId)
    const time = saved?.time ?? solver.time
    if (!saved) viewId = -1
    const cells = solver.config.frame === 'contact' ? 2 * solver.ny : solver.nx
    const center = 1.5 - solver.frameSpeed * Math.min(time, solver.impactTime)
    const start = Math.max(0, Math.min(solver.nx - cells, (center - solver.origin) * solver.ny - cells / 2))
    // Bound bitmap transfer size without resampling the simulation fields.
    const width = Math.max(64, Math.min(1600, Math.round(display.width)))
    const height = Math.max(32, Math.round(width * solver.ny / cells))
    const palette = PALETTES[display.palette] ?? PALETTES['red-blue']
    let bitmap
    if (render) {
      solver.render(saved?.state, { ...display, width, height, palette, start, cells })
      bitmap = canvas.transferToImageBitmap()
      lastRender = performance.now()
    }
    self.postMessage({
      id, bitmap, viewTime: time, viewId, start, cells,
      time: solver.time, impactTime: solver.impactTime, scales: solver.scales,
      nx: solver.nx, ny: solver.ny, origin: solver.origin, frameSpeed: solver.frameSpeed,
      history: history.items.map(({ id, time }) => ({ id, time })),
      historyBytes: history.bytes, historyLimit: history.limit, historyError,
      recording: recording(), nextTime: nextTime(), computeMs, computeTime, ...failure
    }, bitmap ? [bitmap] : [])
  }

  // Advance in short batches so pause and display requests remain responsive.
  self.onmessage = ({ data }) => {
    try {
      if (data.type === 'reset') {
        history?.clear()
        viewId = -1
        historyError = ''
        simulationError = null
        computeMs = 0
        computeTime = 0
        if (solver) solver.reset(data.config.resolution, data.config)
        else {
          canvas = new OffscreenCanvas(1000, 250)
          solver = new RMGPU(canvas, data.config.resolution, data.config)
        }
        history = new RMHistory(solver.nx * solver.ny * 32, solver.config.maxSnapshots, state => solver.release(state))
        display = { ...display, ...data.display }
        capture()
      } else if (data.type === 'advance') {
        if (simulationError) throw simulationError
        viewId = -1
        const start = performance.now()
        const before = solver.time
        const target = data.target
        if (!Number.isFinite(target) || target < solver.time) throw Error('Invalid target time.')
        // 25 ms is the worker response budget, 1e-9 is a saved-time roundoff tolerance.
        while (solver.time < target - 1e-9 && performance.now() - start < 25) {
          const saveAt = recording() ? nextTime() : Infinity
          solver.step(Math.min(target, saveAt) - solver.time)
          if (solver.time >= saveAt - 1e-9) capture()
        }
        computeMs += performance.now() - start
        computeTime += solver.time - before
      } else if (data.type === 'view') viewId = data.viewId
      else if (data.type === 'display') display = { ...display, ...data.display }
      else throw Error('Unknown worker command.')
      const render = data.render !== 'paced' || performance.now() - lastRender >= 1000 / 30 || solver.time >= data.target - 1e-9
      reply(data.id, render)
    } catch (error) {
      // Numerical rejection stops stepping but leaves valid fields available to inspect.
      if (error.numerical && solver && !solver.gl.isContextLost()) {
        simulationError = error
        try {
          reply(data.id, true, { error: error.message, inspectable: true })
          return
        } catch (renderError) {
          error = renderError
        }
      }
      self.postMessage({ id: data.id, error: error.message })
    }
  }
}

export function createWorker() {
  const source = `(${workerMain.toString()})(${createRMEngine.toString()})`
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
  const worker = new Worker(url)
  worker.addEventListener('message', () => URL.revokeObjectURL(url), { once: true })
  worker.addEventListener('error', () => URL.revokeObjectURL(url), { once: true })
  return { worker, url }
}

// Page controls preserve the live state when viewing saved snapshots.
if (typeof document !== 'undefined' && document.getElementById('rm-canvas')) {
  const get = id => document.getElementById('rm-' + id)
  const canvas = get('canvas')
  const context = canvas.getContext('2d')
  const setup = ['atwood', 'mach', 'amplitude', 'waves', 'grid', 'width', 'cfl', 'direction', 'frame', 'domain', 'interval', 'limit']
  let worker, workerURL, latest, applied
  let running = false
  let busy = false
  let failed = false
  let inspectable = false
  let failureMessage = ''
  let pending = false
  let inputError = ''
  let goal = 0
  let advanceTo = null
  let previous = 0
  let sequence = 0
  let dirtyDisplay = false
  let pendingView = null
  let resetId = 0
  let sampleStart = 0
  let sampleTime = 0
  let frames = 0
  let fps = null

  function settings() {
    return {
      atwood: get('atwood').valueAsNumber,
      mach: get('mach').valueAsNumber,
      amplitude: get('amplitude').valueAsNumber,
      waves: get('waves').valueAsNumber,
      resolution: Number(get('grid').value),
      width: Number(get('width').value),
      cfl: get('cfl').valueAsNumber,
      frame: get('frame').value,
      direction: get('direction').value,
      length: Number(get('domain').value),
      saveInterval: get('interval').valueAsNumber,
      maxSnapshots: get('limit').valueAsNumber
    }
  }

  function display() {
    return {
      palette: get('palette').value,
      field: get('field').value,
      overlay: get('overlay').checked,
      width: Math.round(get('viewport').clientWidth * Math.min(devicePixelRatio || 1, 2) * Number(get('zoom').value))
    }
  }

  function pause() {
    running = false
    advanceTo = null
    goal = latest?.time ?? 0
    previous = 0
    sampleStart = 0
    dirtyDisplay = true
  }

  function refresh() {
    const viewing = latest && latest.viewId >= 0
    const blocked = failed || pending || Boolean(inputError) || !latest
    get('run').textContent = running ? 'Pause' : viewing ? 'Run Live' : 'Run'
    get('run').setAttribute('aria-pressed', String(running))
    get('run').disabled = blocked
    get('reset').textContent = pending ? 'Apply & Reset' : 'Reset'
    get('reset').disabled = Boolean(inputError)
    get('advance').disabled = blocked || running || !latest?.recording
    get('advance').textContent = viewing ? 'Next live snapshot' : 'Next snapshot'
    get('impact').disabled = blocked || running || latest?.time >= latest?.impactTime - 1e-8
    get('live').disabled = (failed && !inspectable) || !viewing
    get('pending').hidden = !pending
    get('input-error').textContent = inputError
    get('input-error').hidden = !inputError
    if (!latest) return
    const items = latest.history
    get('scrub').max = Math.max(0, items.length - 1)
    get('scrub').disabled = (failed && !inspectable) || items.length < 2
    get('scrub').value = viewing ? Math.max(0, items.findIndex(item => item.id === latest.viewId)) : items.length - 1
    get('scrub').setAttribute('aria-valuetext', viewing ? `Saved time ${latest.viewTime.toFixed(3)}` : 'Live state')
    get('view-state').textContent = viewing ? 'Saved' : 'Live'
    get('time').textContent = `t = ${latest.viewTime.toFixed(3)}`
    const offset = latest.viewTime - latest.impactTime
    get('impact-time').textContent = (Math.abs(offset) < 0.0005 ? 0 : offset).toFixed(3)
    get('saved').textContent = `${items.length} / ${latest.historyLimit} snapshots${latest.recording ? '' : latest.historyError ? ' - Stopped' : ' - Full'}`
    get('memory').textContent = `${(latest.historyBytes / 1000000).toFixed(1)} / ${HISTORY_BYTES / 1000000} MB`
    get('history-end').textContent = `History through t = ${((latest.historyLimit - 1) * applied.saveInterval).toFixed(2)}`
    const palette = PALETTES[get('palette').value]
    const field = get('field').value
    const range = latest.scales[field]
    get('legend').textContent = field === 'material'
      ? `${palette.names[0]}: heavy - ${palette.names[1]}: light - intermediate colors: mixed`
      : `${field === 'density' ? 'Density' : 'Pressure'}: ${palette.names[1].toLowerCase()} ≤ ${range[0]} - ${palette.names[0].toLowerCase()} ≥ ${range[1].toFixed(2)}`
    const color = values => `rgb(${values.map(value => Math.round(value * 255)).join(' ')})`
    const legend = get('material-legend')
    legend.style.setProperty('--rm-heavy', color(palette.heavy))
    legend.style.setProperty('--rm-light', color(palette.light))
    legend.style.setProperty('--rm-mixed', color(palette.heavy.map((value, i) => (value + palette.light[i]) / 2)))
    legend.hidden = get('field').value !== 'material'
    get('field-legend').hidden = !legend.hidden
    get('field-legend').textContent = legend.hidden ? get('legend').textContent : ''
    const x = latest.origin + latest.start / latest.ny + latest.frameSpeed * latest.viewTime
    get('coordinates').textContent = `Laboratory x = ${x.toFixed(2)} to ${(x + latest.cells / latest.ny).toFixed(2)}`
    get('fps').textContent = running && fps !== null && !document.hidden ? `${fps} FPS` : ''
    get('status').dataset.error = String(failed || Boolean(latest.historyError))
    if (failed) get('status').textContent = failureMessage
    else {
      get('status').textContent = inputError ? 'Check settings' : pending ? 'Changes ready' : document.hidden ? 'Paused while tab is hidden' :
        latest.historyError || (advanceTo !== null ? advanceTo === latest.impactTime ? 'Advancing to nominal impact' : 'Advancing to next snapshot' : running ? 'Running' : viewing ? 'Viewing saved state' : 'Ready')
    }
  }

  // Validate the next run without changing the current field or saved states.
  function describe() {
    for (const [id, digits] of [['atwood', 2], ['mach', 1], ['amplitude', 2], ['waves', 0]]) {
      get(id + '-value').value = get(id).valueAsNumber.toFixed(digits)
    }
    for (const option of get('grid').options) {
      const ny = Number(option.value) / 4
      option.textContent = `${option.textContent.split(' (')[0]} (${ny * Number(get('domain').value)} \u00d7 ${ny})`
    }
    inputError = ''
    for (const id of setup) {
      const valid = get(id).validity.valid
      get(id).setAttribute('aria-invalid', String(!valid))
      if (!valid && !inputError) inputError = 'Check the highlighted setting.'
    }
    const next = settings()
    try {
      parameters(next)
    } catch (error) {
      inputError = error.message
    }
    pending = Boolean(applied && JSON.stringify(next) !== JSON.stringify(applied))
    if (pending || inputError) pause()
    refresh()
  }

  function send(type, extra = {}) {
    if (busy || (failed && !(inspectable && ['view', 'display'].includes(type)))) return
    busy = true
    sequence += 1
    worker.postMessage({ id: sequence, type, ...extra })
  }

  function reset() {
    describe()
    if (inputError) return
    if (failed) {
      worker?.terminate()
      if (workerURL) URL.revokeObjectURL(workerURL)
      worker = null
    }
    pause()
    busy = false
    failed = false
    inspectable = false
    failureMessage = ''
    pending = false
    latest = null
    pendingView = null
    dirtyDisplay = false
    fps = null
    get('fps').textContent = ''
    get('fps').removeAttribute('title')
    applied = settings()
    get('status').textContent = 'Preparing simulation…'
    get('status').dataset.error = 'false'
    get('saved').textContent = 'No snapshots'
    get('history-end').textContent = ''
    refresh()
    if (!worker) {
      const created = createWorker()
      worker = created.worker
      workerURL = created.url
    }
    function fail(message, canInspect = false) {
      pause()
      busy = false
      failed = true
      inspectable = canInspect
      failureMessage = message
      get('status').textContent = message
      get('status').dataset.error = 'true'
      refresh()
    }
    worker.onerror = event => fail(event.message)
    worker.onmessage = ({ data }) => {
      if (data.id < resetId) {
        data.bitmap?.close()
        return
      }
      busy = false
      if (data.error && !data.inspectable) {
        fail(data.error)
        return
      }
      latest = data
      if (data.bitmap) {
        if (canvas.width !== data.bitmap.width) canvas.width = data.bitmap.width
        if (canvas.height !== data.bitmap.height) canvas.height = data.bitmap.height
        canvas.style.aspectRatio = `${data.cells} / ${data.ny}`
        const zoom = Number(get('zoom').value)
        get('stage').style.width = `${100 * Math.max(1, zoom)}%`
        canvas.style.width = `${100 * Math.min(1, zoom)}%`
        context.imageSmoothingEnabled = false
        context.drawImage(data.bitmap, 0, 0)
        data.bitmap.close()
        // Count displayed simulation frames, excluding metadata-only replies.
        if (sampleStart && running && !document.hidden) {
          frames += 1
          const now = performance.now()
          const elapsed = now - sampleStart
          if (elapsed >= 500) {
            fps = Math.round(frames * 1000 / elapsed)
            get('fps').title = `${((data.time - sampleTime) * 1000 / elapsed).toFixed(2)} simulation time units per second`
            sampleStart = now
            sampleTime = data.time
            frames = 0
          }
        }
      }
      if (data.error) fail(data.error, true)
      if (running && advanceTo !== null && data.time >= advanceTo - 1e-8) pause()
      refresh()
      pump(performance.now())
    }
    resetId = sequence + 1
    send('reset', { config: applied, display: display() })
  }

  // Start the next batch as soon as the worker is free. Drawing has its own cadence.
  function pump(now) {
    const elapsed = previous ? Math.max(0, Math.min(100, now - previous)) : 0
    previous = now
    if (!document.hidden && latest && (!failed || inspectable)) {
      if (running) {
        if (!sampleStart) {
          sampleStart = now
          sampleTime = latest.time
          frames = 0
          fps = null
        }
        goal = advanceTo ?? Math.min(latest.time + 0.1, Math.max(goal, latest.time) + elapsed / 1000 * Number(get('speed').value))
      }
      if (!busy) {
        if (pendingView !== null) {
          const viewId = pendingView
          pendingView = null
          send('view', { viewId })
        } else if (dirtyDisplay) {
          dirtyDisplay = false
          send('display', { display: display() })
        } else if (running && goal > latest.time + 1e-9) send('advance', { target: goal, render: 'paced' })
      }
    }
  }

  // Hidden tabs retain state and history without requesting more computation.
  function tick() {
    pump(performance.now())
    requestAnimationFrame(tick)
  }

  get('run').onclick = () => {
    if (running) pause()
    else {
      pendingView = -1
      running = true
      goal = latest.time
      previous = 0
    }
    refresh()
  }
  get('reset').onclick = reset
  get('advance').onclick = () => {
    pendingView = -1
    running = true
    advanceTo = latest.nextTime
    refresh()
  }
  get('impact').onclick = () => {
    pendingView = -1
    running = true
    advanceTo = latest.impactTime
    refresh()
  }
  get('speed').onchange = () => {
    previous = 0
    sampleStart = 0
    fps = null
    goal = latest?.time ?? 0
    refresh()
  }
  get('live').onclick = () => {
    pause()
    pendingView = -1
  }
  get('scrub').oninput = () => {
    pause()
    pendingView = latest.history[Number(get('scrub').value)]?.id ?? -1
    refresh()
  }
  for (const id of ['palette', 'field', 'zoom', 'overlay']) get(id).onchange = () => { dirtyDisplay = true }
  for (const id of setup) get(id).addEventListener('input', describe)
  new ResizeObserver(() => { dirtyDisplay = true }).observe(get('viewport'))
  document.addEventListener('visibilitychange', () => {
    previous = 0
    sampleStart = 0
    goal = latest?.time ?? 0
    refresh()
  })
  window.addEventListener('pagehide', () => {
    worker?.terminate()
    worker = null
    if (workerURL) URL.revokeObjectURL(workerURL)
  })
  window.addEventListener('pageshow', event => { if (event.persisted) reset() })
  reset()
  requestAnimationFrame(tick)
}
