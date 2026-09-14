var e=`#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`,t=`#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform ivec2 grid;
uniform float h, dt, atwood;
out vec4 color;

// Periodic x boundaries and scalar extension across the vertical walls.
// Keep modulo operands nonnegative for GLSL portability.
int wrap(int x, int size) {
  return x < 0 ? size - 1 - ((-1 - x) % size) : x % size;
}

ivec2 cell(ivec2 p) {
  return ivec2(wrap(p.x, grid.x), clamp(p.y, 0, grid.y - 1));
}

float scalar(sampler2D f, ivec2 p) {
  return texelFetch(f, cell(p), 0).r;
}

float rho(float c) {
  return 1.0 + atwood * (2.0 * c - 1.0);
}

float inverseFace(sampler2D c, ivec2 a, ivec2 b) {
  return 2.0 / (rho(scalar(c, a)) + rho(scalar(c, b)));
}

// MAC grid: u on left/right faces and v on bottom/top faces.
float face(sampler2D f, ivec2 p, int axis) {
  int x = wrap(p.x, grid.x);
  if (axis == 1 && (p.y <= 0 || p.y >= grid.y)) return 0.0;
  return texelFetch(f, ivec2(x, clamp(p.y, 0, grid.y - 1)), 0)[axis];
}

float linearFace(sampler2D f, vec2 p, int axis) {
  vec2 q = p / h - (axis == 0 ? vec2(0.0, 0.5) : vec2(0.5, 0.0));
  ivec2 i = ivec2(floor(q));
  vec2 w = fract(q);
  return mix(
    mix(face(f, i, axis), face(f, i + ivec2(1, 0), axis), w.x),
    mix(face(f, i + ivec2(0, 1), axis), face(f, i + ivec2(1, 1), axis), w.x),
    w.y
  );
}

vec2 velocityAt(sampler2D f, vec2 p) {
  return vec2(linearFace(f, p, 0), linearFace(f, p, 1));
}
`,n={material:t+`
uniform sampler2D source, original, velocity;
uniform float stage;

// Monotonized-central (MC) slope limiter.
float limited(float a, float b) {
  if (a * b <= 0.0) return 0.0;
  return sign(a) * min(0.5 * abs(a + b), min(2.0 * abs(a), 2.0 * abs(b)));
}

float slope(ivec2 p, ivec2 axis) {
  return limited(
    scalar(source, p) - scalar(source, p - axis),
    scalar(source, p + axis) - scalar(source, p)
  );
}

// Piecewise-linear upwind flux reconstruction.
float flux(ivec2 left, ivec2 axis, float u) {
  float c = u >= 0.0
    ? scalar(source, left) + 0.5 * slope(left, axis)
    : scalar(source, left + axis) - 0.5 * slope(left + axis, axis);
  return u * c;
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy), x = ivec2(1, 0), y = ivec2(0, 1);
  float right = flux(p, x, face(velocity, p + x, 0));
  float left = flux(p - x, x, face(velocity, p, 0));
  float top = flux(p, y, face(velocity, p + y, 1));
  float bottom = flux(p - y, y, face(velocity, p, 1));
  float next = scalar(source, p) - dt / h * (right - left + top - bottom);

  // SSP-RK2 stage blend.
  if (stage > 0.5) next = 0.5 * (scalar(original, p) + next);
  color = vec4(clamp(next, 0.0, 1.0), 0, 0, 1);
}`,momentum:t+`
uniform sampler2D velocity, material;
uniform float gravity, viscosity;

float advance(ivec2 i, int axis) {
  if (axis == 1 && (i.y == 0 || i.y == grid.y)) return 0.0;

  vec2 p = (vec2(i) + (axis == 0 ? vec2(0.0, 0.5) : vec2(0.5, 0.0))) * h;

  // Midpoint semi-Lagrangian characteristic trace.
  vec2 midpoint = p - 0.5 * dt * velocityAt(velocity, p);
  float value = linearFace(velocity, p - dt * velocityAt(velocity, midpoint), axis);

  // Explicit viscous diffusion.
  if (viscosity > 0.0) {
    float lap = face(velocity, i + ivec2(1, 0), axis)
      + face(velocity, i - ivec2(1, 0), axis)
      + face(velocity, i + ivec2(0, 1), axis)
      + face(velocity, i - ivec2(0, 1), axis)
      - 4.0 * face(velocity, i, axis);
    value += dt * viscosity * lap / (h * h);
  }

  // Density-dependent vertical body acceleration.
  if (axis == 1) value += dt * gravity * (1.0 - inverseFace(material, i - ivec2(0, 1), i));
  return value;
}

void main() {
  ivec2 i = ivec2(gl_FragCoord.xy);
  color = vec4(
    advance(ivec2(i.x, min(i.y, grid.y - 1)), 0),
    advance(i, 1),
    0,
    1
  );
}`,divergence:t+`
uniform sampler2D velocity;

void main() {
  ivec2 i = ivec2(gl_FragCoord.xy);

  // Projection RHS: divergence of the provisional velocity.
  color = vec4(
    (face(velocity, i + ivec2(1, 0), 0) - face(velocity, i, 0)
      + face(velocity, i + ivec2(0, 1), 1) - face(velocity, i, 1)) / h,
    0,
    0,
    1
  );
}`,smooth:t+`
uniform sampler2D pressure, rhs, material;

void main() {
  ivec2 i = ivec2(gl_FragCoord.xy),
      l = i - ivec2(1, 0),
      r = i + ivec2(1, 0),
      b = i - ivec2(0, 1),
      t = i + ivec2(0, 1);
  float al = inverseFace(material, i, l), ar = inverseFace(material, i, r);
  float ab = i.y > 0 ? inverseFace(material, i, b) : 0.0;
  float at = i.y < grid.y - 1 ? inverseFace(material, i, t) : 0.0;
  float next = (
    al * scalar(pressure, l)
    + ar * scalar(pressure, r)
    + ab * scalar(pressure, b)
    + at * scalar(pressure, t)
    - h * h * scalar(rhs, i)
  ) / (al + ar + ab + at);

  // Weighted Jacobi smoothing, omega = 2/3.
  color = vec4(mix(scalar(pressure, i), next, 0.6666666667), 0, 0, 1);
}`,residual:t+`
uniform sampler2D pressure, rhs, material;

void main() {
  ivec2 i = ivec2(gl_FragCoord.xy),
      l = i - ivec2(1, 0),
      r = i + ivec2(1, 0),
      b = i - ivec2(0, 1),
      t = i + ivec2(0, 1);
  float p = scalar(pressure, i);
  float lap = inverseFace(material, i, l) * (scalar(pressure, l) - p)
    + inverseFace(material, i, r) * (scalar(pressure, r) - p);
  if (i.y > 0) lap += inverseFace(material, i, b) * (scalar(pressure, b) - p);
  if (i.y < grid.y - 1) lap += inverseFace(material, i, t) * (scalar(pressure, t) - p);

  // Multigrid residual r = b - A p.
  color = vec4(scalar(rhs, i) - lap / (h * h), 0, 0, 1);
}`,restrict:t+`
uniform sampler2D source;

void main() {
  ivec2 i = ivec2(gl_FragCoord.xy) * 2;

  // Fine-to-coarse 2x2 averaging.
  color = vec4(
    0.25 * (
      texelFetch(source, i, 0).r
      + texelFetch(source, i + ivec2(1, 0), 0).r
      + texelFetch(source, i + ivec2(0, 1), 0).r
      + texelFetch(source, i + ivec2(1, 1), 0).r
    ),
    0,
    0,
    1
  );
}`,prolong:t+`
uniform sampler2D pressure, coarse;

float sampleCoarse(ivec2 i) {
  ivec2 s = textureSize(coarse, 0);
  return texelFetch(coarse, ivec2(wrap(i.x, s.x), clamp(i.y, 0, s.y - 1)), 0).r;
}

void main() {
  vec2 p = gl_FragCoord.xy * 0.5 - 0.5;
  ivec2 i = ivec2(floor(p));
  vec2 w = fract(p);

  // Bilinear coarse-grid correction.
  float c = mix(
    mix(sampleCoarse(i), sampleCoarse(i + ivec2(1, 0)), w.x),
    mix(sampleCoarse(i + ivec2(0, 1)), sampleCoarse(i + ivec2(1, 1)), w.x),
    w.y
  );
  color = vec4(texelFetch(pressure, ivec2(gl_FragCoord.xy), 0).r + c, 0, 0, 1);
}`,project:t+`
uniform sampler2D pressure, velocity, material;

void main() {
  ivec2 i = ivec2(gl_FragCoord.xy), u = ivec2(i.x, min(i.y, grid.y - 1));

  // Variable-density pressure projection on staggered faces.
  float x = face(velocity, u, 0)
    - inverseFace(material, u - ivec2(1, 0), u)
      * (scalar(pressure, u) - scalar(pressure, u - ivec2(1, 0))) / h;
  float y = 0.0;
  if (i.y > 0 && i.y < grid.y)
    y = face(velocity, i, 1)
      - inverseFace(material, i - ivec2(0, 1), i)
        * (scalar(pressure, i) - scalar(pressure, i - ivec2(0, 1))) / h;
  color = vec4(x, y, 0, 1);
}`,diagnostics:t+`
uniform sampler2D velocity, material;

void main() {
  ivec2 i = ivec2(gl_FragCoord.xy);
  float l = face(velocity, i, 0), r = face(velocity, i + ivec2(1, 0), 0);
  float b = face(velocity, i, 1), t = face(velocity, i + ivec2(0, 1), 1);
  vec4 faces = vec4(l, r, b, t);
  float concentration = scalar(material, i);

  // Negative mass marks an invalid cell before max can hide it.
  if (any(isnan(faces)) || any(isinf(faces)) || isnan(concentration) || isinf(concentration)) {
    color = vec4(0, 0, 0, -1);
    return;
  }

  // max |u|, max |v|, |div u|, and material fraction.
  color = vec4(max(abs(l), abs(r)), max(abs(b), abs(t)), abs(r - l + t - b) / h, concentration);
}`,reduce:t+`
uniform sampler2D source;

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy) * 2, s = textureSize(source, 0);
  vec4 value = vec4(0);

  // 2x2 reduction: maxima for diagnostics, sum for material.
  for (int y = 0; y < 2; y++)
    for (int x = 0; x < 2; x++) {
      ivec2 q = p + ivec2(x, y);
      if (all(lessThan(q, s))) {
        vec4 next = texelFetch(source, q, 0);

        // Carry invalid cells through every reduction level.
        if (next.w < 0.0 || any(isnan(next)) || any(isinf(next))) {
          color = vec4(0, 0, 0, -1);
          return;
        }
        value = vec4(max(value.xyz, next.xyz), value.w + next.w);
      }
    }
  color = value;
}`,snapshot:t+`
uniform sampler2D material;

void main() {
  // Pack [0, 1] material fraction into two 8-bit channels.
  float value = floor(clamp(scalar(material, ivec2(gl_FragCoord.xy)), 0.0, 1.0) * 65535.0 + 0.5);
  color = vec4(floor(value / 256.0), mod(value, 256.0), 0.0, 255.0) / 255.0;
}`,display:t+`
uniform sampler2D material;
uniform vec2 viewport;
uniform vec3 lightColor, heavyColor;
uniform float isSnapshot;

float fraction(ivec2 p) {
  vec2 value = texelFetch(material, cell(p), 0).rg;
  return isSnapshot > 0.5
    ? dot(floor(value * 255.0 + 0.5), vec2(256.0, 1.0)) / 65535.0
    : value.r;
}

void main() {
  vec2 p = gl_FragCoord.xy / viewport * vec2(grid) - 0.5;
  ivec2 i = ivec2(floor(p));
  vec2 w = fract(p);
  float c = mix(
    mix(fraction(i), fraction(i + ivec2(1, 0)), w.x),
    mix(fraction(i + ivec2(0, 1)), fraction(i + ivec2(1, 1)), w.x),
    w.y
  );
  color = vec4(mix(lightColor, heavyColor, clamp(c, 0.0, 1.0)), 1);
}`},r=Object.freeze([{label:`Lowest`,value:64},{label:`Low`,value:128},{label:`Medium`,value:192},{label:`High`,value:256},{label:`Highest`,value:384}]),i=128*1e3*1e3,a=Object.freeze({"red-blue":{heavy:[.96,.08,.12],light:[.08,.24,.98],names:[`Red`,`blue`]},"orange-blue":{heavy:[230/255,159/255,0],light:[0,114/255,178/255],names:[`Orange`,`blue`]},"magenta-teal":{heavy:[204/255,121/255,167/255],light:[0,158/255,115/255],names:[`Magenta`,`teal`]},"black-white":{heavy:[0,0,0],light:[1,1,1],names:[`Black`,`white`]},"navy-gold":{heavy:[24/255,45/255,85/255],light:[250/255,195/255,50/255],names:[`Navy`,`gold`]},"purple-mint":{heavy:[106/255,52/255,163/255],light:[146/255,235/255,192/255],names:[`Purple`,`mint`]}});function o(e,t){let n=e*t.width,r=e*t.height,a=1/e,o=[];for(let e=n,t=r,i=a;o.push({width:e,height:t,h:i}),!(Math.min(e,t)<=4||e%2||t%2);e/=2,t/=2,i*=2);let s=16*n*(r+1)+12*n*r;o.forEach((e,t)=>{s+=e.width*e.height*(t?20:16)});for(let e=n,t=r;s+=16*e*t,!(e===1&&t===1);e=Math.ceil(e/2),t=Math.ceil(t/2));let c=2*n*r,l=Math.min(t.maxSnapshots,Math.floor(i/c));return{cfg:t,nx:n,ny:r,h:a,levels:o,workingBytes:s,snapshotBytes:c,historyLimit:l,totalBytes:s+c*l}}var s=class{constructor(e,t,n,r){if(this.layout=t,this.canvas=e,this.config=this.layout.cfg,this.nx=this.layout.nx,this.ny=this.layout.ny,this.h=this.layout.h,this.history=[],this.historyLimit=this.layout.historyLimit,this.historyError=``,this.viewIndex=-1,this.palette=r,this.canvas.style.aspectRatio=`${this.nx} / ${this.ny}`,this.time=0,this.steps=0,this.stats=new Float32Array(4),this.targets=[],this.programs={},this.levels=[],this.reductions=[],this.gl=e.getContext(`webgl2`,{alpha:!1,antialias:!1,depth:!1,stencil:!1,preserveDrawingBuffer:!1}),!this.gl)throw Error(`WebGL 2 is unavailable on this device.`);let i=this.gl;try{if(!i.getExtension(`EXT_color_buffer_float`))throw Error(`This device cannot use the required floating-point graphics buffers.`);i.disable(i.BLEND),i.disable(i.DITHER),i.disable(i.DEPTH_TEST),this.vao=i.createVertexArray(),i.bindVertexArray(this.vao);for(let[e,t]of Object.entries(n))this.programs[e]=this.program(t,e);this.velocity=this.pair(this.nx,this.ny+1,2),this.material=this.pair(this.nx,this.ny,1),this.materialStage=this.target(this.nx,this.ny,1);for(let e of this.layout.levels){let{width:t,height:n}=e;this.levels.push({...e,pressure:this.pair(t,n,1),rhs:this.target(t,n,1),residual:this.target(t,n,1),material:this.levels.length?this.target(t,n,1):this.material.read})}for(let e=this.nx,t=this.ny;this.reductions.push(this.target(e,t,4)),!(e===1&&t===1);e=Math.ceil(e/2),t=Math.ceil(t/2));}catch(e){throw this.dispose(),e}}finishInitialization(){this.measure(this.velocity.read),this.initialMass=this.stats[3],this.captureSnapshot(),this.render()}program(t,n){let r=this.gl,i=[],a;try{for(let[a,o]of[[r.VERTEX_SHADER,e],[r.FRAGMENT_SHADER,t]]){let e=r.createShader(a);if(i.push(e),r.shaderSource(e,o),r.compileShader(e),!r.getShaderParameter(e,r.COMPILE_STATUS)){let t=a===r.VERTEX_SHADER?`vertex`:`fragment`,i=r.getShaderInfoLog(e)||`No WebGL compiler log was returned.`;throw Error(`GPU pass "${n}" ${t} shader failed to compile:\n${i}`)}}if(a=r.createProgram(),i.forEach(e=>r.attachShader(a,e)),r.linkProgram(a),!r.getProgramParameter(a,r.LINK_STATUS)){let e=r.getProgramInfoLog(a)||`No WebGL linker log was returned.`;throw Error(`GPU pass "${n}" failed to link:\n${e}`)}let o={};for(let e=0;e<r.getProgramParameter(a,r.ACTIVE_UNIFORMS);e++){let t=r.getActiveUniform(a,e).name;o[t]=r.getUniformLocation(a,t)}return{program:a,uniforms:o}}catch(e){throw a&&r.deleteProgram(a),e}finally{i.forEach(e=>r.deleteShader(e))}}target(e,t,n,r=!1){let i=this.gl,a=`The simulation buffers could not be allocated. Try the lower resolution.`,o={texture:null,framebuffer:null,width:e,height:t,channels:n,bytes:e*t*(r?2:n*4)};this.targets.push(o);try{o.texture=i.createTexture(),o.framebuffer=i.createFramebuffer();let{texture:s,framebuffer:c}=o;if(!s||!c)throw i.getError(),Error(a);i.bindTexture(i.TEXTURE_2D,s);for(let e of[i.TEXTURE_MIN_FILTER,i.TEXTURE_MAG_FILTER])i.texParameteri(i.TEXTURE_2D,e,i.NEAREST);for(let e of[i.TEXTURE_WRAP_S,i.TEXTURE_WRAP_T])i.texParameteri(i.TEXTURE_2D,e,i.CLAMP_TO_EDGE);let l=r?i.RG8:n===1?i.R32F:n===2?i.RG32F:i.RGBA32F,u=n===1?i.RED:n===2?i.RG:i.RGBA;i.texImage2D(i.TEXTURE_2D,0,l,e,t,0,u,r?i.UNSIGNED_BYTE:i.FLOAT,null),i.bindFramebuffer(i.FRAMEBUFFER,c),i.framebufferTexture2D(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0,i.TEXTURE_2D,s,0);let d=i.checkFramebufferStatus(i.FRAMEBUFFER)===i.FRAMEBUFFER_COMPLETE;this.clear(o);let f=i.getError();if(!d||f!==i.NO_ERROR)throw Error(a);return o}catch(e){throw this.release(o),e}}release(e){e.texture&&this.gl.deleteTexture(e.texture),e.framebuffer&&this.gl.deleteFramebuffer(e.framebuffer);let t=this.targets.indexOf(e);t>=0&&this.targets.splice(t,1)}pair(e,t,n){return{read:this.target(e,t,n),write:this.target(e,t,n)}}swap(e){[e.read,e.write]=[e.write,e.read]}clear(e){let t=this.gl;t.bindFramebuffer(t.FRAMEBUFFER,e.framebuffer),t.clearColor(0,0,0,0),t.clear(t.COLOR_BUFFER_BIT)}draw(e,t,n={},r={},i=this.layout.levels[0]){let a=this.gl,o=this.programs[e];a.useProgram(o.program);let s={grid:[i.width,i.height],h:i.h,dt:0,atwood:this.config.atwood,...r},c=0;for(let[e,t]of Object.entries(n))a.activeTexture(a.TEXTURE0+c),a.bindTexture(a.TEXTURE_2D,t.texture),a.uniform1i(o.uniforms[e],c++);for(let[e,t]of Object.entries(s))o.uniforms[e]!=null&&(e===`grid`?a.uniform2i(o.uniforms[e],...t):Array.isArray(t)&&t.length===3?a.uniform3f(o.uniforms[e],...t):Array.isArray(t)?a.uniform2f(o.uniforms[e],...t):a.uniform1f(o.uniforms[e],t));a.bindFramebuffer(a.FRAMEBUFFER,t?t.framebuffer:null),a.viewport(0,0,t?t.width:this.canvas.width,t?t.height:this.canvas.height),a.drawArrays(a.TRIANGLES,0,3)}smooth(e,t){for(let n=0;n<t;n++)this.draw(`smooth`,e.pressure.write,{pressure:e.pressure.read,rhs:e.rhs,material:e.material},{},e),this.swap(e.pressure)}cycle(e=0){let t=this.levels[e];if(e===this.levels.length-1){this.smooth(t,Math.max(40,Math.ceil(Math.max(t.width,t.height)**2/4)));return}this.smooth(t,4),this.draw(`residual`,t.residual,{pressure:t.pressure.read,rhs:t.rhs,material:t.material},{},t);let n=this.levels[e+1];this.draw(`restrict`,n.rhs,{source:t.residual},{},n),this.clear(n.pressure.read),this.cycle(e+1),this.draw(`prolong`,t.pressure.write,{pressure:t.pressure.read,coarse:n.pressure.read},{},t),this.swap(t.pressure),this.smooth(t,4)}measure(e){this.draw(`diagnostics`,this.reductions[0],{velocity:e,material:this.material.read});for(let e=1;e<this.reductions.length;e++)this.draw(`reduce`,this.reductions[e],{source:this.reductions[e-1]});let t=this.gl;if(this.stats.fill(NaN),t.readPixels(0,0,1,1,t.RGBA,t.FLOAT,this.stats),this.stats.some(e=>!Number.isFinite(e)))throw Error(`Graphics diagnostics could not be read. Reset to start again.`);if(this.stats.some(e=>e<0)||this.stats[3]===0)throw Error(`The simulation stopped after a numerical error. Reset to start again.`)}nextDt(){let e=this.h,t=this.config,n=Math.abs(t.gravity)*t.atwood/(1-t.atwood),r=this.stats[0]+this.stats[1],i=2*t.cfl*e/(r+Math.sqrt(r*r+4*n*t.cfl*e)+1e-12),a=t.viscosity>0?.2*e*e/(2*t.viscosity):1/0,o=Math.min(t.maxDt,i,a);return this.recording&&(o=Math.min(o,this.history.length*t.saveInterval-this.time)),o}step(e=this.nextDt()){if(e=Math.min(e,this.nextDt()),!Number.isFinite(e)||e<=0)throw Error(`The timestep could not be calculated. Reset to start again.`);this.draw(`material`,this.materialStage,{source:this.material.read,original:this.material.read,velocity:this.velocity.read},{dt:e,stage:0}),this.draw(`material`,this.material.write,{source:this.materialStage,original:this.material.read,velocity:this.velocity.read},{dt:e,stage:1}),this.swap(this.material),this.levels[0].material=this.material.read;for(let e=1;e<this.levels.length;e++)this.draw(`restrict`,this.levels[e].material,{source:this.levels[e-1].material},{},this.levels[e]);this.draw(`momentum`,this.velocity.write,{velocity:this.velocity.read,material:this.material.read},{dt:e,gravity:this.config.gravity,viscosity:this.config.viscosity}),this.swap(this.velocity),this.draw(`divergence`,this.levels[0].rhs,{velocity:this.velocity.read});let t=0;do this.cycle(),t++,this.draw(`project`,this.velocity.write,{velocity:this.velocity.read,pressure:this.levels[0].pressure.read,material:this.material.read}),this.measure(this.velocity.write);while(this.stats[2]*e>this.config.pressureTolerance&&t<6);if(this.stats[2]*e>.002)throw Error(`The pressure solve could not settle. Reset or try the lower resolution.`);if(this.swap(this.velocity),this.time+=e,this.steps++,this.lastCycles=t,Math.abs(this.stats[3]-this.initialMass)/this.initialMass>.02)throw Error(`Material balance changed too much. Reset to start a new run.`);this.recording&&this.time>=this.history.length*this.config.saveInterval-1e-10&&(this.time=this.history.length*this.config.saveInterval,this.captureSnapshot())}get recording(){return!this.historyError&&this.history.length<this.historyLimit}get displayedTime(){return this.viewIndex<0?this.time:this.history[this.viewIndex].time}captureSnapshot(){if(!this.recording)return;let e;try{if(e=this.target(this.nx,this.ny,2,!0),this.draw(`snapshot`,e,{material:this.material.read}),this.gl.getError()!==this.gl.NO_ERROR)throw Error(`Snapshot storage is unavailable.`);this.history.push({time:this.time,field:e})}catch{e&&this.release(e),this.historyError=`Snapshot recording stopped. The live simulation can continue.`}}showSnapshot(e){!Number.isInteger(e)||e<0||e>=this.history.length||(this.viewIndex=e,this.render())}showLive(){this.viewIndex=-1,this.render()}render(){let e=this.canvas.getBoundingClientRect(),t=Math.min(globalThis.devicePixelRatio||1,2),n=Math.max(2,Math.round(e.width*t)),r=Math.max(4,Math.round(e.height*t));(this.canvas.width!==n||this.canvas.height!==r)&&(this.canvas.width=n,this.canvas.height=r);let i=this.viewIndex<0?this.material.read:this.history[this.viewIndex].field;this.draw(`display`,null,{material:i},{viewport:[n,r],isSnapshot:this.viewIndex<0?0:1,lightColor:this.palette.light,heavyColor:this.palette.heavy})}dispose(){let e=this.gl;if(e){for(let t of this.targets)e.deleteTexture(t.texture),e.deleteFramebuffer(t.framebuffer);for(let t of Object.values(this.programs))e.deleteProgram(t.program);this.vao&&e.deleteVertexArray(this.vao),this.targets=[],this.programs={},this.history=[],this.viewIndex=-1}}};export{o as a,s as i,a as n,t as o,r,n as s,i as t};