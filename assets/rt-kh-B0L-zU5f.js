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

// Reference density is one, with pure-fluid densities 1 - A and 1 + A.
float rho(float c) {
  return 1.0 + atwood * (2.0 * c - 1.0);
}

// Reciprocal of the arithmetic mean density at a cell face.
float inverseFace(sampler2D c, ivec2 a, ivec2 b) {
  return 2.0 / (rho(scalar(c, a)) + rho(scalar(c, b)));
}

// MAC grid: u on left/right faces and v on bottom/top faces.
float face(sampler2D f, ivec2 p, int axis) {
  int x = wrap(p.x, grid.x);
  if (axis == 1 && (p.y <= 0 || p.y >= grid.y)) return 0.0;
  return texelFetch(f, ivec2(x, clamp(p.y, 0, grid.y - 1)), 0)[axis];
}

// Bilinear sampling accounts for each velocity component's MAC offset.
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
  // Bound each material stage. Clipping can change the total material fraction.
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

  // Residual buoyancy after subtracting the reference-density hydrostatic force.
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
}`,smoothConstant:t+`
uniform sampler2D pressure, rhs;

void main() {
  ivec2 i = ivec2(gl_FragCoord.xy), x = ivec2(1, 0), y = ivec2(0, 1);
  // The CG preconditioner has unit density, so no material reads or face divisions.
  float neighbors = scalar(pressure, i - x) + scalar(pressure, i + x);
  float diagonal = 2.0;
  if (i.y > 0) { neighbors += scalar(pressure, i - y); diagonal += 1.0; }
  if (i.y < grid.y - 1) { neighbors += scalar(pressure, i + y); diagonal += 1.0; }
  float next = (neighbors - h * h * scalar(rhs, i)) / diagonal;
  // Weighted Jacobi smoothing with omega = 2/3.
  color = vec4(mix(scalar(pressure, i), next, 0.6666666667), 0, 0, 1);
}`,residualConstant:t+`
uniform sampler2D pressure, rhs;

void main() {
  ivec2 i = ivec2(gl_FragCoord.xy), x = ivec2(1, 0), y = ivec2(0, 1);
  float p = scalar(pressure, i);
  float lap = (scalar(pressure, i - x) - p) + (scalar(pressure, i + x) - p);
  if (i.y > 0) lap += scalar(pressure, i - y) - p;
  if (i.y < grid.y - 1) lap += scalar(pressure, i + y) - p;
  color = vec4(scalar(rhs, i) - lap / (h * h), 0, 0, 1);
}`,restrictPressure:t+`
uniform sampler2D source;

void main() {
  ivec2 base = ivec2(gl_FragCoord.xy) * 2, size = textureSize(source, 0);
  float value = 0.0;
  // Scaled transpose of bilinear prolongation, including periodic/Neumann edges.
  // This makes the constant-density V-cycle a symmetric CG preconditioner.
  for (int y = -1; y <= 2; y++) {
    float wy = (y == -1 || y == 2) ? 0.125 : 0.375;
    for (int x = -1; x <= 2; x++) {
      float wx = (x == -1 || x == 2) ? 0.125 : 0.375;
      ivec2 p = base + ivec2(x, y);
      p = ivec2(wrap(p.x, size.x), clamp(p.y, 0, size.y - 1));
      value += wx * wy * texelFetch(source, p, 0).r;
    }
  }
  color = vec4(value, 0, 0, 1);
}`,pressureApply:t+`
uniform sampler2D source, material;

void main() {
  ivec2 i = ivec2(gl_FragCoord.xy), x = ivec2(1, 0), y = ivec2(0, 1);
  float p = scalar(source, i);
  // Positive semidefinite operator L = -div((1/rho) grad).
  // Face coefficients and boundaries exactly match the velocity projection.
  float value = inverseFace(material, i, i - x) * (p - scalar(source, i - x))
    + inverseFace(material, i, i + x) * (p - scalar(source, i + x));
  if (i.y > 0) value += inverseFace(material, i, i - y) * (p - scalar(source, i - y));
  if (i.y < grid.y - 1) value += inverseFace(material, i, i + y) * (p - scalar(source, i + y));
  color = vec4(value / (h * h), 0, 0, 1);
}`,pressureVector:t+`
uniform sampler2D a, b;
uniform float aScale, bScale, offset;

void main() {
  ivec2 i = ivec2(gl_FragCoord.xy);
  color = vec4(aScale * scalar(a, i) + bScale * scalar(b, i) + offset, 0, 0, 1);
}`,pressureCenter:t+`
uniform sampler2D source, statistics;
uniform float scale;

void main() {
  vec4 sums = texelFetch(statistics, ivec2(0), 0);
  if (sums.w != 0.0 || any(isnan(sums)) || any(isinf(sums))) {
    color = vec4(uintBitsToFloat(0x7fc00000u));
    return;
  }
  float mean = sums.y / (float(grid.x) * float(grid.y));
  color = vec4(scale * (scalar(source, ivec2(gl_FragCoord.xy)) - mean), 0, 0, 1);
}`,pressureAxpy:t+`
uniform sampler2D a, b, numerator, denominator;
uniform float directionScale, residualTolerance;

void main() {
  vec4 n = texelFetch(numerator, ivec2(0), 0);
  vec4 d = texelFetch(denominator, ivec2(0), 0);
  if (n.w != 0.0 || d.w != 0.0 || any(isnan(n)) || any(isinf(n))
      || any(isnan(d)) || any(isinf(d))) {
    color = vec4(uintBitsToFloat(0x7fc00000u));
    return;
  }
  // Stop updating a converged recurrence until the next true-divergence check.
  float alpha = n.z > residualTolerance && n.x > 0.0 && d.x > 0.0 ? n.x / d.x : 0.0;
  ivec2 i = ivec2(gl_FragCoord.xy);
  color = vec4(scalar(a, i) + directionScale * alpha * scalar(b, i), 0, 0, 1);
}`,pressureDirection:t+`
uniform sampler2D preconditioned, direction, previous, next;

void main() {
  vec4 oldProduct = texelFetch(previous, ivec2(0), 0);
  vec4 newProduct = texelFetch(next, ivec2(0), 0);
  if (oldProduct.w != 0.0 || newProduct.w != 0.0
      || any(isnan(oldProduct)) || any(isinf(oldProduct))
      || any(isnan(newProduct)) || any(isinf(newProduct))) {
    color = vec4(uintBitsToFloat(0x7fc00000u));
    return;
  }
  float beta = oldProduct.x > 0.0 && newProduct.x > 0.0 ? newProduct.x / oldProduct.x : 0.0;
  ivec2 i = ivec2(gl_FragCoord.xy);
  color = vec4(scalar(preconditioned, i) + beta * scalar(direction, i), 0, 0, 1);
}`,pressureProducts:t+`
uniform sampler2D a, b;

void main() {
  ivec2 base = ivec2(gl_FragCoord.xy) * 4;
  vec4 value = vec4(0);
  // Fuse products with the first 4x4 reduction instead of writing a full-grid
  // RGBA intermediate for every CG dot product and convergence measurement.
  for (int y = 0; y < 4; y++)
    for (int x = 0; x < 4; x++) {
      ivec2 i = base + ivec2(x, y);
      if (all(lessThan(i, grid))) {
        float left = scalar(a, i), right = scalar(b, i);
        // Dot product, sum, infinity norm, and invalid-data flag.
        vec3 values = vec3(left * right, left, abs(left));
        if (any(isnan(values)) || any(isinf(values)) || isnan(right) || isinf(right)) {
          color = vec4(0, 0, 0, 1);
          return;
        }
        value.xy += values.xy;
        value.z = max(value.z, values.z);
      }
    }
  color = value;
}`,pressureReduce:t+`
uniform sampler2D source;
uniform float reductionScale;

void main() {
  int stride = int(reductionScale);
  ivec2 p = ivec2(gl_FragCoord.xy) * stride, size = textureSize(source, 0);
  vec4 value = vec4(0);
  for (int y = 0; y < stride; y++)
    for (int x = 0; x < stride; x++) {
      ivec2 q = p + ivec2(x, y);
      if (all(lessThan(q, size))) {
        vec4 next = texelFetch(source, q, 0);
        value.xy += next.xy;
        value.z = max(value.z, next.z);
        value.w += next.w;
      }
    }
  color = value;
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
  // The pressure field stores impulse, so its gradient already includes dt.
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

  // A negative material sum flags an invalid cell before max can hide it.
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
  // Quantize viewing snapshots to 16 bits, then store high/low bytes in RG8.
  // 65535 is the integer maximum, 256 the byte base, and 255 the UNORM scale.
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
}`},r=Object.freeze([{label:`Lowest`,value:64},{label:`Low`,value:128},{label:`Medium`,value:192},{label:`High`,value:256},{label:`Highest`,value:384}]),i=128*1e3*1e3,a=.8,o=Object.freeze({"red-blue":{heavy:[.96,.08,.12],light:[.08,.24,.98],names:[`Red`,`blue`]},"orange-blue":{heavy:[230/255,159/255,0],light:[0,114/255,178/255],names:[`Orange`,`blue`]},"magenta-teal":{heavy:[204/255,121/255,167/255],light:[0,158/255,115/255],names:[`Magenta`,`teal`]},"black-white":{heavy:[0,0,0],light:[1,1,1],names:[`Black`,`white`]},"navy-gold":{heavy:[24/255,45/255,85/255],light:[250/255,195/255,50/255],names:[`Navy`,`gold`]},"purple-mint":{heavy:[106/255,52/255,163/255],light:[146/255,235/255,192/255],names:[`Purple`,`mint`]}});function s(e,t){let n=e*t.width,r=e*t.height,o=1/e,s=[];for(let e=n,t=r,i=o;s.push({width:e,height:t,h:i}),!(Math.min(e,t)<=4||e%2||t%2);e/=2,t/=2,i*=2);let c=16*n*(r+1)+12*n*r;s.forEach((e,t)=>{c+=e.width*e.height*(t?20:16)});let l=t.atwood>a;l&&(c+=28*n*r+48);for(let e=n,t=r;c+=16*e*t,!(e===1&&t===1);e=Math.ceil(e/2),t=Math.ceil(t/2));let u=2*n*r,d=Math.min(t.maxSnapshots,Math.floor(i/u));return{cfg:t,nx:n,ny:r,h:o,levels:s,highContrast:l,workingBytes:c,snapshotBytes:u,historyLimit:d,totalBytes:c+u*d}}var c=class{constructor(e,t,n,r){if(this.layout=t,this.canvas=e,this.config=this.layout.cfg,this.nx=this.layout.nx,this.ny=this.layout.ny,this.h=this.layout.h,this.history=[],this.historyLimit=this.layout.historyLimit,this.historyError=``,this.viewIndex=-1,this.palette=r,this.canvas.style.aspectRatio=`${this.nx} / ${this.ny}`,this.time=0,this.steps=0,this.stats=new Float32Array(4),this.targets=[],this.programs={},this.levels=[],this.reductions=[],this.gl=e.getContext(`webgl2`,{alpha:!1,antialias:!1,depth:!1,stencil:!1,preserveDrawingBuffer:!1}),!this.gl)throw Error(`WebGL 2 is unavailable on this device.`);let i=this.gl;try{if(!i.getExtension(`EXT_color_buffer_float`))throw Error(`This device cannot use the required floating-point graphics buffers.`);i.disable(i.BLEND),i.disable(i.DITHER),i.disable(i.DEPTH_TEST),this.vao=i.createVertexArray(),i.bindVertexArray(this.vao);for(let[e,t]of Object.entries(n))this.programs[e]=this.program(t,e);this.velocity=this.pair(this.nx,this.ny+1,2),this.material=this.pair(this.nx,this.ny,1),this.materialStage=this.target(this.nx,this.ny,1);for(let e of this.layout.levels){let{width:t,height:n}=e;this.levels.push({...e,pressure:this.pair(t,n,1),rhs:this.target(t,n,1),residual:this.target(t,n,1),material:this.levels.length?this.target(t,n,1):this.material.read})}this.layout.highContrast&&(this.cg={pressure:this.pair(this.nx,this.ny,1),residual:this.pair(this.nx,this.ny,1),direction:this.pair(this.nx,this.ny,1),applied:this.target(this.nx,this.ny,1),products:this.pair(1,1,4),curvature:this.target(1,1,4),previousDt:0});for(let e=this.nx,t=this.ny;this.reductions.push(this.target(e,t,4)),!(e===1&&t===1);e=Math.ceil(e/2),t=Math.ceil(t/2));}catch(e){throw this.dispose(),e}}finishInitialization(){this.measure(this.velocity.read),this.initialMass=this.stats[3],this.captureSnapshot(),this.render()}program(t,n){let r=this.gl,i=[],a;try{for(let[a,o]of[[r.VERTEX_SHADER,e],[r.FRAGMENT_SHADER,t]]){let e=r.createShader(a);if(i.push(e),r.shaderSource(e,o),r.compileShader(e),!r.getShaderParameter(e,r.COMPILE_STATUS)){let t=a===r.VERTEX_SHADER?`vertex`:`fragment`,i=r.getShaderInfoLog(e)||`No WebGL compiler log was returned.`;throw Error(`GPU pass "${n}" ${t} shader failed to compile:\n${i}`)}}if(a=r.createProgram(),i.forEach(e=>r.attachShader(a,e)),r.linkProgram(a),!r.getProgramParameter(a,r.LINK_STATUS)){let e=r.getProgramInfoLog(a)||`No WebGL linker log was returned.`;throw Error(`GPU pass "${n}" failed to link:\n${e}`)}let o={};for(let e=0;e<r.getProgramParameter(a,r.ACTIVE_UNIFORMS);e++){let t=r.getActiveUniform(a,e).name;o[t]=r.getUniformLocation(a,t)}return{program:a,uniforms:o}}catch(e){throw a&&r.deleteProgram(a),e}finally{i.forEach(e=>r.deleteShader(e))}}target(e,t,n,r=!1){let i=this.gl,a=`The simulation buffers could not be allocated. Try the lower resolution.`,o={texture:null,framebuffer:null,width:e,height:t,channels:n,bytes:e*t*(r?2:n*4)};this.targets.push(o);try{o.texture=i.createTexture(),o.framebuffer=i.createFramebuffer();let{texture:s,framebuffer:c}=o;if(!s||!c)throw i.getError(),Error(a);i.bindTexture(i.TEXTURE_2D,s);for(let e of[i.TEXTURE_MIN_FILTER,i.TEXTURE_MAG_FILTER])i.texParameteri(i.TEXTURE_2D,e,i.NEAREST);for(let e of[i.TEXTURE_WRAP_S,i.TEXTURE_WRAP_T])i.texParameteri(i.TEXTURE_2D,e,i.CLAMP_TO_EDGE);let l=r?i.RG8:n===1?i.R32F:n===2?i.RG32F:i.RGBA32F,u=n===1?i.RED:n===2?i.RG:i.RGBA;i.texImage2D(i.TEXTURE_2D,0,l,e,t,0,u,r?i.UNSIGNED_BYTE:i.FLOAT,null),i.bindFramebuffer(i.FRAMEBUFFER,c),i.framebufferTexture2D(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0,i.TEXTURE_2D,s,0);let d=i.checkFramebufferStatus(i.FRAMEBUFFER)===i.FRAMEBUFFER_COMPLETE;this.clear(o);let f=i.getError();if(!d||f!==i.NO_ERROR)throw Error(a);return o}catch(e){throw this.release(o),e}}release(e){e.texture&&this.gl.deleteTexture(e.texture),e.framebuffer&&this.gl.deleteFramebuffer(e.framebuffer);let t=this.targets.indexOf(e);t>=0&&this.targets.splice(t,1)}pair(e,t,n){return{read:this.target(e,t,n),write:this.target(e,t,n)}}swap(e){[e.read,e.write]=[e.write,e.read]}clear(e){let t=this.gl;t.bindFramebuffer(t.FRAMEBUFFER,e.framebuffer),t.clearColor(0,0,0,0),t.clear(t.COLOR_BUFFER_BIT)}draw(e,t,n={},r={},i=this.layout.levels[0]){let a=this.gl,o=this.programs[e];a.useProgram(o.program);let s={grid:[i.width,i.height],h:i.h,dt:0,atwood:this.config.atwood,...r},c=0;for(let[e,t]of Object.entries(n))a.activeTexture(a.TEXTURE0+c),a.bindTexture(a.TEXTURE_2D,t.texture),a.uniform1i(o.uniforms[e],c++);for(let[e,t]of Object.entries(s))o.uniforms[e]!=null&&(e===`grid`?a.uniform2i(o.uniforms[e],...t):Array.isArray(t)&&t.length===3?a.uniform3f(o.uniforms[e],...t):Array.isArray(t)?a.uniform2f(o.uniforms[e],...t):a.uniform1f(o.uniforms[e],t));a.bindFramebuffer(a.FRAMEBUFFER,t?t.framebuffer:null),a.viewport(0,0,t?t.width:this.canvas.width,t?t.height:this.canvas.height),a.drawArrays(a.TRIANGLES,0,3)}smooth(e,t,n=!1){for(let r=0;r<t;r++)this.draw(n?`smoothConstant`:`smooth`,e.pressure.write,n?{pressure:e.pressure.read,rhs:e.rhs}:{pressure:e.pressure.read,rhs:e.rhs,material:e.material},{},e),this.swap(e.pressure)}cycle(e=0,t=!1){let n=this.levels[e];if(e===this.levels.length-1){this.smooth(n,Math.max(40,Math.ceil(Math.max(n.width,n.height)**2/4)),t);return}let r=t?2:4;this.smooth(n,r,t),this.draw(t?`residualConstant`:`residual`,n.residual,t?{pressure:n.pressure.read,rhs:n.rhs}:{pressure:n.pressure.read,rhs:n.rhs,material:n.material},{},n);let i=this.levels[e+1];this.draw(t?`restrictPressure`:`restrict`,i.rhs,{source:n.residual},{},i),this.clear(i.pressure.read),this.cycle(e+1,t),this.draw(`prolong`,n.pressure.write,{pressure:n.pressure.read,coarse:i.pressure.read},{},n),this.swap(n.pressure),this.smooth(n,r,t)}combinePressure(e,t,n,r,i,a=0){this.draw(`pressureVector`,e.write,{a:t,b:n},{aScale:r,bScale:i,offset:a}),this.swap(e)}pressureProducts(e,t,n=this.reductions[this.reductions.length-1]){this.draw(`pressureProducts`,this.reductions[2],{a:e,b:t});for(let e=2;e<this.reductions.length-1;){let t=Math.min(e+2,this.reductions.length-1);this.draw(`pressureReduce`,t===this.reductions.length-1?n:this.reductions[t],{source:this.reductions[e]},{reductionScale:2**(t-e)}),e=t}return n}centerPressure(e,t=1){let n=this.pressureProducts(e.read,e.read);this.draw(`pressureCenter`,e.write,{source:e.read,statistics:n},{scale:t}),this.swap(e)}preconditionPressure(){let e=this.levels[0],t=this.cg.residual.read;return this.draw(`pressureVector`,e.rhs,{a:t,b:t},{aScale:-1,bScale:0,offset:0}),this.clear(e.pressure.read),this.cycle(0,!0),this.centerPressure(e.pressure),e.pressure.read}solveHighContrastPressure(e){let t=this.cg,n=this.config.pressureTolerance;t.previousDt>0&&this.combinePressure(t.pressure,t.pressure.read,t.pressure.read,e/t.previousDt,0);let r=()=>{this.draw(`project`,this.velocity.write,{velocity:this.velocity.read,pressure:t.pressure.read,material:this.material.read}),this.measure(this.velocity.write)};r();let i=0;for(;this.stats[2]*e>n&&i<256;){this.draw(`divergence`,t.residual.read,{velocity:this.velocity.write}),this.centerPressure(t.residual,-1);let a=this.preconditionPressure();this.pressureProducts(t.residual.read,a,t.products.read),this.combinePressure(t.direction,a,a,1,0);for(let o=0;o<32&&i<256;o++){i++,this.draw(`pressureApply`,t.applied,{source:t.direction.read,material:this.material.read}),this.pressureProducts(t.direction.read,t.applied,t.curvature);for(let[r,i,a]of[[t.pressure,t.direction.read,1],[t.residual,t.applied,-1]])this.draw(`pressureAxpy`,r.write,{a:r.read,b:i,numerator:t.products.read,denominator:t.curvature},{directionScale:a,residualTolerance:.5*n/e}),this.swap(r);if(((o+1)%4==0||i===256)&&(r(),this.stats[2]*e<=n))return t.previousDt=e,i;if(o===31)break;a=this.preconditionPressure(),this.pressureProducts(t.residual.read,a,t.products.write),this.draw(`pressureDirection`,t.direction.write,{preconditioned:a,direction:t.direction.read,previous:t.products.read,next:t.products.write}),this.swap(t.direction),this.swap(t.products)}this.centerPressure(t.pressure),r()}return t.previousDt=e,i}measure(e){this.draw(`diagnostics`,this.reductions[0],{velocity:e,material:this.material.read});for(let e=1;e<this.reductions.length;e++)this.draw(`reduce`,this.reductions[e],{source:this.reductions[e-1]});let t=this.gl;if(this.stats.fill(NaN),t.readPixels(0,0,1,1,t.RGBA,t.FLOAT,this.stats),this.stats.some(e=>!Number.isFinite(e)))throw Error(`Graphics diagnostics could not be read. Reset to start again.`);if(this.stats.some(e=>e<0)||this.stats[3]===0)throw Error(`The simulation stopped after a numerical error. Reset to start again.`)}nextDt(){let e=this.h,t=this.config,n=Math.abs(t.gravity)*t.atwood/(1-t.atwood),r=this.stats[0]+this.stats[1],i=2*t.cfl*e/(r+Math.sqrt(r*r+4*n*t.cfl*e)+1e-12),a=t.viscosity>0?.2*e*e/(2*t.viscosity):1/0,o=Math.min(t.maxDt,i,a);return this.recording&&(o=Math.min(o,this.history.length*t.saveInterval-this.time)),o}step(e=this.nextDt()){if(e=Math.min(e,this.nextDt()),!Number.isFinite(e)||e<=0)throw Error(`The timestep could not be calculated. Reset to start again.`);this.draw(`material`,this.materialStage,{source:this.material.read,original:this.material.read,velocity:this.velocity.read},{dt:e,stage:0}),this.draw(`material`,this.material.write,{source:this.materialStage,original:this.material.read,velocity:this.velocity.read},{dt:e,stage:1}),this.swap(this.material),this.levels[0].material=this.material.read;for(let e=1;!this.cg&&e<this.levels.length;e++)this.draw(`restrict`,this.levels[e].material,{source:this.levels[e-1].material},{},this.levels[e]);this.draw(`momentum`,this.velocity.write,{velocity:this.velocity.read,material:this.material.read},{dt:e,gravity:this.config.gravity,viscosity:this.config.viscosity}),this.swap(this.velocity);let t=0;if(this.cg)t=this.solveHighContrastPressure(e);else{this.draw(`divergence`,this.levels[0].rhs,{velocity:this.velocity.read});do this.cycle(),t++,this.draw(`project`,this.velocity.write,{velocity:this.velocity.read,pressure:this.levels[0].pressure.read,material:this.material.read}),this.measure(this.velocity.write);while(this.stats[2]*e>this.config.pressureTolerance&&t<6)}if(this.stats[2]*e>.002)throw Error(`The pressure solve could not settle. Reset or try the lower resolution.`);if(this.swap(this.velocity),this.time+=e,this.steps++,this.lastCycles=t,Math.abs(this.stats[3]-this.initialMass)/this.initialMass>.02)throw Error(`Material balance changed too much. Reset to start a new run.`);this.recording&&this.time>=this.history.length*this.config.saveInterval-1e-10&&(this.time=this.history.length*this.config.saveInterval,this.captureSnapshot())}get recording(){return!this.historyError&&this.history.length<this.historyLimit}get displayedTime(){return this.viewIndex<0?this.time:this.history[this.viewIndex].time}captureSnapshot(){if(!this.recording)return;let e;try{if(e=this.target(this.nx,this.ny,2,!0),this.draw(`snapshot`,e,{material:this.material.read}),this.gl.getError()!==this.gl.NO_ERROR)throw Error(`Snapshot storage is unavailable.`);this.history.push({time:this.time,field:e})}catch{e&&this.release(e),this.historyError=`Snapshot recording stopped. The live simulation can continue.`}}showSnapshot(e){!Number.isInteger(e)||e<0||e>=this.history.length||(this.viewIndex=e,this.render())}showLive(){this.viewIndex=-1,this.render()}render(){let e=this.canvas.getBoundingClientRect(),t=Math.min(globalThis.devicePixelRatio||1,2),n=Math.max(2,Math.round(e.width*t)),r=Math.max(4,Math.round(e.height*t));(this.canvas.width!==n||this.canvas.height!==r)&&(this.canvas.width=n,this.canvas.height=r);let i=this.viewIndex<0?this.material.read:this.history[this.viewIndex].field;this.draw(`display`,null,{material:i},{viewport:[n,r],isSnapshot:this.viewIndex<0?0:1,lightColor:this.palette.light,heavyColor:this.palette.heavy})}dispose(){let e=this.gl;if(e){for(let t of this.targets)e.deleteTexture(t.texture),e.deleteFramebuffer(t.framebuffer);for(let t of Object.values(this.programs))e.deleteProgram(t.program);this.vao&&e.deleteVertexArray(this.vao),this.targets=[],this.programs={},this.history=[],this.viewIndex=-1}}},l=r,u=i,d=o,f=Object.freeze({width:2,height:1,atwood:0,gravity:0,shear:1,shearThickness:.05,amplitude:.025,waves:3,thickness:.0078125,phase:-Math.PI/2,heavyAbove:!0,viscosity:0,cfl:.4,maxDt:.012,pressureTolerance:1e-4,saveInterval:.25,maxSnapshots:30});function p(e,t={}){let n={...f,...t};if(!l.some(t=>t.value===e))throw Error(`Choose a supported grid resolution.`);if(Object.entries(n).some(([e,t])=>e!==`heavyAbove`&&!Number.isFinite(t)))throw Error(`Simulation settings must be finite numbers.`);if(n.width!==2||n.height!==1)throw Error(`Keep the domain at 2 × 1.`);if(n.atwood<0||n.atwood>.8||n.viscosity<0||n.viscosity>.002)throw Error(`Use Atwood 0–0.8 and viscosity 0–0.002.`);if(Math.abs(n.gravity)>4)throw Error(`Use an acceleration magnitude from 0 to 4.`);if(n.shear<0||n.shear>4)throw Error(`Use a velocity difference from 0 to 4.`);if(n.shearThickness!==.05)throw Error(`Keep the shear transition scale at 0.05.`);if(!Number.isInteger(n.waves)||n.waves<1||n.waves>6)throw Error(`Choose one to six waves.`);if(n.amplitude<0||n.amplitude>.05||n.thickness<=0||n.amplitude*n.width/n.waves+n.thickness>=n.height/2)throw Error(`Keep the initial interface inside the domain.`);if(![.0078125,.015625,.03125].includes(n.thickness))throw Error(`Choose Sharp, Normal, or Diffuse for the interface width.`);if(n.cfl<=0||n.cfl>.5||n.maxDt<=0||n.pressureTolerance<=0||n.pressureTolerance>.002)throw Error(`Use a CFL up to 0.5 and positive timestep and pressure settings.`);if(typeof n.heavyAbove!=`boolean`)throw Error(`Use true or false for heavyAbove.`);if(n.saveInterval<.01||n.saveInterval>1||!Number.isInteger(n.maxSnapshots)||n.maxSnapshots<2||n.maxSnapshots>50)throw Error(`Save every 0.01–1 time units and choose 2–50 snapshots.`);return s(e,n)}var m={initial:t+`
uniform float amplitude, thickness, phase, heavyAbove, waves;

void main() {
  vec2 p = gl_FragCoord.xy * h;

  // Sinusoidal diffuse interface.
  float interfaceY = 0.5 * float(grid.y) * h
    + amplitude * cos(6.28318530718 * waves * p.x / (float(grid.x) * h) + phase);
  float c = smoothstep(-thickness, thickness, p.y - interfaceY);
  color = vec4(heavyAbove > 0.5 ? c : 1.0 - c, 0, 0, 1);
}`,initialVelocity:t+`
uniform float shear, shearThickness, amplitude, waves, phase;

// Localized streamfunction perturbation with zero normal flow at the walls.
float stream(ivec2 vertex) {
  if (vertex.y <= 0 || vertex.y >= grid.y) return 0.0;
  float height = float(grid.y) * h;
  float x = float(wrap(vertex.x, grid.x)) * h;
  float y = float(vertex.y) * h;
  float k = 6.28318530718 * waves / (float(grid.x) * h);
  // Gaussian localization over 15% of the height, tapered by sin^4 at the walls.
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
}`,...n},ee=class extends c{constructor(e,t=128,n={}){let r=p(t,n);super(e,r,m,d[`red-blue`]);let i=this.config;try{this.draw(`initial`,this.material.read,{},{amplitude:i.amplitude*i.width/i.waves,waves:i.waves,thickness:i.thickness,phase:i.phase,heavyAbove:+!!i.heavyAbove}),this.draw(`initialVelocity`,this.velocity.read,{},{shear:i.shear,shearThickness:i.shearThickness,amplitude:i.amplitude,waves:i.waves,phase:i.phase}),this.finishInitialization()}catch(e){throw this.dispose(),e}}};function h(){let e=document.getElementById(`kh-canvas`);if(!e)return;let t=e=>document.getElementById(e),n=(e,t)=>{e.textContent!==t&&(e.textContent=t)},r=e=>e.toLocaleString(`en-US`,{minimumFractionDigits:2,maximumFractionDigits:6,useGrouping:!1}),i=t(`kh-run`),a=t(`kh-reset`),o=t(`kh-status`),s=t(`kh-setup`),c=t(`kh-resolution`),m=t(`kh-waves`),h=t(`kh-atwood`),g=t(`kh-amplitude`),te=t(`kh-acceleration`),_=t(`kh-shear`),v=t(`kh-interval`),ne=t(`kh-limit`),y=t(`kh-palette`),b=t(`kh-zoom`),re=t(`kh-arrangement`),x=t(`kh-viscosity`),S=t(`kh-cfl`),C=t(`kh-thickness`),w=t(`kh-scrub`),ie=t(`kh-live`),T=t(`kh-time`),E=t(`kh-fps`),D=t(`kh-viewport`),O=t(`kh-advance`),k,A,j=!1,M=!1,N=!1,P=!1,F=``,I=0,L=0,R=0,z=0,B=0,V=0,H=0,U=null;t(`kh-width`)?.closest(`.kh-wide`)?.remove(),t(`kh-wavelength`).setAttribute(`for`,`kh-waves`),c.value=(window.matchMedia?window.matchMedia(`(max-width: 48rem)`).matches:window.innerWidth<=768)?`128`:`192`,m.value=String(f.waves),h.value=String(f.atwood),g.value=String(f.amplitude),_.value=String(f.shear),te.value=String(Math.abs(f.gravity)),re.value=f.heavyAbove?`above`:`below`,x.value=String(f.viscosity),S.value=String(f.cfl),C.value=String(2*f.thickness),b.value=`1`;function W(){return{resolution:Number(c.value),width:f.width,waves:m.valueAsNumber,atwood:h.valueAsNumber,amplitude:g.valueAsNumber,gravity:-te.valueAsNumber,shear:_.valueAsNumber,saveInterval:v.valueAsNumber,maxSnapshots:ne.valueAsNumber,heavyAbove:re.value===`above`,viscosity:Number(x.value),cfl:S.valueAsNumber,thickness:Number(C.value)/2}}function G(){j=!1,U=null,cancelAnimationFrame(I),I=0,L=0,R=0,E.textContent=``}function K(){let e=k&&k.viewIndex>=0;n(i,j?`Pause`:e?`Run Live`:`Run`),i.setAttribute(`aria-pressed`,String(j)),i.disabled=!k||N||M||P||!!F,a.disabled=N||!!F,O.disabled=!k||j||N||M||P||!!F||!k.recording,n(O,e?`Next live snapshot`:`Next snapshot`),n(a,P?`Apply & Reset`:`Reset`),t(`kh-pending`).hidden=!P;let s=k?.history.length||0;w.max=String(Math.max(0,s-1)),w.disabled=s<2||N,w.value=String(e?k.viewIndex:Math.max(0,s-1)),n(T,r(k?.displayedTime||0)),w.setAttribute(`aria-valuetext`,e?`Saved time ${T.textContent}`:`Live state`),ie.disabled=!e||N,n(t(`kh-view-state`),e?`Saved`:`Live`),n(t(`kh-saved`),k?`${s} / ${k.historyLimit} snapshots${!k.recording&&!k.historyError?` - Full`:``}`:`No snapshots`),!(M||N)&&n(o,k?.historyError||(F?`Check settings`:P?`Changes ready`:U===null?j?`Running`:e?`Snapshot ${k.viewIndex+1} of ${s}`:k?.steps?`Paused`:`Ready`:`Advancing to next snapshot`))}function q(e){G(),M=!0,o.textContent=e.message,o.dataset.error=`true`,K()}function J(){let e=c.value;for(let e of l){let t=[...c.options].find(t=>Number(t.value)===e.value);t.textContent=`${e.label} (${e.value*f.width} × ${e.value*f.height})`}c.value=e,t(`kh-atwood-value`).textContent=h.valueAsNumber.toFixed(2),t(`kh-amplitude-value`).textContent=g.valueAsNumber.toFixed(3),t(`kh-acceleration-value`).textContent=te.valueAsNumber.toFixed(2),t(`kh-shear-value`).textContent=_.valueAsNumber.toFixed(2),t(`kh-waves-value`).textContent=m.value,t(`kh-wavelength`).textContent=(f.width/m.valueAsNumber).toFixed(3),P=!!(A&&JSON.stringify(W())!==JSON.stringify(A)),F=``;for(let e of s.querySelectorAll(`input, select`)){let n=e.validity.valid;e.setAttribute(`aria-invalid`,String(!n)),!n&&!F&&(F=`Check ${t(e.id+`-label`)?.textContent.toLowerCase()||`the highlighted setting`}.`)}try{if(F)throw Error(F);let e=W(),n=p(e.resolution,e);t(`kh-memory`).textContent=`${P?`Next run: `:``}≈ ${(n.totalBytes/1e6).toFixed(1)} MB`,t(`kh-memory-limit`).textContent=n.historyLimit<e.maxSnapshots?`${n.historyLimit} snapshots fit the ${(u/1e6).toFixed(1)} MB history budget.`:``,t(`kh-memory-limit`).hidden=n.historyLimit>=e.maxSnapshots,t(`kh-history-end`).textContent=`History through time ${r((n.historyLimit-1)*e.saveInterval)}`}catch(e){F=e.message,t(`kh-memory`).textContent=`—`,t(`kh-history-end`).textContent=``,t(`kh-memory-limit`).hidden=!0}n(t(`kh-input-error`),F),t(`kh-input-error`).hidden=!F,K()}function Y(){if(!k||N)return;let t=D.clientWidth||D.getBoundingClientRect().width;if(!t)return;let n=window.visualViewport?.height||window.innerHeight,r=Math.min(t,.72*n*k.nx/k.ny);if(e.style.width=`${Math.max(2,r*Number(b.value))}px`,!j)try{k.render()}catch(e){q(e)}}function X(){if(!k||N)return;k.palette=d[y.value]||d[`red-blue`];let{heavy:t,light:n,names:r}=k.palette,i=t.map((e,t)=>(e+n[t])/2);for(let[e,r]of[[`heavy`,t],[`mixed`,i],[`light`,n]])document.querySelector(`.kh-${e}`).style.backgroundColor=`rgb(${r.map(e=>Math.round(255*e)).join(`,`)})`;e.setAttribute(`aria-label`,`Kelvin-Helmholtz material field. ${r[0]} is material A and ${r[1]} is material B. Blended colors show intermediate material fractions.`);try{k.render()}catch(e){q(e)}}function Z(){if(J(),!(F||N)){G(),M=!1,k?.dispose(),k=null,R=0,z=0,delete o.dataset.error,o.textContent=`Preparing simulation…`;try{let t=W();k=new ee(e,t.resolution,t),A=t,P=!1,Y(),X(),J()}catch(e){q(e)}K()}}function Q(e){if(I=0,!j||N)return;if(document.hidden){L=0,R=0,B=0,V=e,H=k.time,I=requestAnimationFrame(Q);return}let t=L?Math.min((e-L)/1e3,.05):0;L=e,R+=t;let n=performance.now(),r=0;try{for(;r<16&&(r===0||performance.now()-n+z<18);){let e=k.nextDt();if(U===null&&R+1e-12<e)break;U!==null&&(e=Math.min(e,U-k.time));let t=performance.now();if(k.step(e),z=performance.now()-t,R=Math.max(0,R-e),r++,U!==null&&(k.time>=U-1e-10||!k.recording)){G();break}}R=Math.min(R,k.nextDt()),k.render(),B++,j&&e-V>500&&(E.textContent=`${Math.round(B*1e3/(e-V))} FPS`,E.title=`${((k.time-H)*1e3/(e-V)).toFixed(2)} simulation time units per second`,V=e,H=k.time,B=0),K(),j&&(I=requestAnimationFrame(Q))}catch(e){q(e)}}function ae(e=null){if(!(!k||N||M||P||F))try{k.showLive(),j=!0,U=e,L=0,R=0,V=performance.now(),H=k.time,B=0,K(),I=requestAnimationFrame(Q)}catch(e){q(e)}}i.addEventListener(`click`,()=>{j?(G(),K()):ae()}),O.addEventListener(`click`,()=>{!j&&k?.recording&&ae(k.history.length*k.config.saveInterval)}),a.addEventListener(`click`,Z);for(let e of[c,m,h,g,te,_,v,ne,re,x,S,C])e.addEventListener(e.tagName===`SELECT`?`change`:`input`,()=>{G(),J()});y.addEventListener(`change`,X),b.addEventListener(`change`,Y),w.addEventListener(`input`,()=>{if(!(!k||N)){G();try{k.showSnapshot(Number(w.value)),K()}catch(e){q(e)}}}),ie.addEventListener(`click`,()=>{if(!(!k||N))try{k.showLive(),K()}catch(e){q(e)}});let $=new ResizeObserver(Y);$.observe(D),window.addEventListener(`resize`,Y),window.visualViewport?.addEventListener(`resize`,Y),e.addEventListener(`webglcontextlost`,e=>{e.preventDefault(),N=!0,q(Error(`Graphics interrupted. Waiting for the device to recover.`)),s.disabled=!0,y.disabled=!0,b.disabled=!0}),e.addEventListener(`webglcontextrestored`,()=>{N=!1,s.disabled=!1,y.disabled=!1,b.disabled=!1,Z()}),window.addEventListener(`pagehide`,()=>{G(),$.disconnect(),k?.dispose(),k=null}),window.addEventListener(`pageshow`,e=>{e.persisted&&($.observe(D),Z())}),Z()}typeof document<`u`&&h();var g=r,te=i,_=o,v=Object.freeze({width:1,height:3,atwood:.1,extendedAtwood:!1,gravity:-1,amplitude:.025,waves:1,thickness:.015625,phase:0,heavyAbove:!0,viscosity:2e-4,cfl:.4,maxDt:.012,pressureTolerance:1e-4,saveInterval:.25,maxSnapshots:30});function ne(e){return e?.99:.8}function y(e,t={}){let n={...v,...t};if(!g.some(t=>t.value===e))throw Error(`Choose a supported grid resolution.`);if(Object.entries(n).some(([e,t])=>e!==`heavyAbove`&&e!==`extendedAtwood`&&!Number.isFinite(t)))throw Error(`Simulation settings must be finite numbers.`);if(typeof n.extendedAtwood!=`boolean`)throw Error(`Use true or false for extendedAtwood.`);if(![1,2,3].includes(n.width)||![2,2.5,3].includes(n.height))throw Error(`Choose a supported domain size.`);let r=ne(n.extendedAtwood);if(n.atwood<0||n.atwood>r||n.viscosity<0||n.viscosity>.002)throw Error(`Use Atwood 0–${r} and viscosity 0–0.002.`);if(Math.abs(n.gravity)>4)throw Error(`Use an acceleration magnitude from 0 to 4.`);if(!Number.isInteger(n.waves)||n.waves<1||n.waves>6)throw Error(`Choose one to six waves.`);if(n.amplitude<0||n.amplitude>.05||n.thickness<=0||n.amplitude*n.width/n.waves+n.thickness>=n.height/2)throw Error(`Keep the initial interface inside the domain.`);if(![.0078125,.015625,.03125].includes(n.thickness))throw Error(`Choose Sharp, Normal, or Diffuse for the interface width.`);if(n.cfl<=0||n.cfl>.5||n.maxDt<=0||n.pressureTolerance<=0||n.pressureTolerance>.002)throw Error(`Use a CFL up to 0.5 and positive timestep and pressure settings.`);if(typeof n.heavyAbove!=`boolean`)throw Error(`Use true or false for heavyAbove.`);if(n.saveInterval<.01||n.saveInterval>1||!Number.isInteger(n.maxSnapshots)||n.maxSnapshots<2||n.maxSnapshots>50)throw Error(`Save every 0.01–1 time units and choose 2–50 snapshots.`);return s(e,n)}var b={initial:t+`
uniform float amplitude, thickness, phase, heavyAbove, waves;

void main() {
  vec2 p = gl_FragCoord.xy * h;

  // Rayleigh-Taylor sinusoidal diffuse interface, with selectable heavy-fluid side.
  float interfaceY = 0.5 * float(grid.y) * h
    + amplitude * cos(6.28318530718 * waves * p.x / (float(grid.x) * h) + phase);
  float c = smoothstep(-thickness, thickness, p.y - interfaceY);
  color = vec4(heavyAbove > 0.5 ? c : 1.0 - c, 0, 0, 1);
}`,...n},re=class extends c{constructor(e,t=128,n={}){let r=y(t,n);super(e,r,b,_[`red-blue`]);let i=this.config;try{this.draw(`initial`,this.material.read,{},{amplitude:i.amplitude*i.width/i.waves,waves:i.waves,thickness:i.thickness,phase:i.phase,heavyAbove:+!!i.heavyAbove}),this.finishInitialization()}catch(e){throw this.dispose(),e}}};function x(){let e=document.getElementById(`rt-canvas`);if(!e)return;let t=e=>document.getElementById(e),n=(e,t)=>{e.textContent!==t&&(e.textContent=t)},r=e=>e.toLocaleString(`en-US`,{minimumFractionDigits:2,maximumFractionDigits:6,useGrouping:!1}),i=t(`rt-run`),a=t(`rt-reset`),o=t(`rt-status`),s=t(`rt-setup`),c=t(`rt-resolution`),l=t(`rt-width`),u=t(`rt-waves`),d=t(`rt-atwood`),f=t(`rt-extended-atwood`),p=t(`rt-amplitude`),m=t(`rt-acceleration`),ee=t(`rt-interval`),h=t(`rt-limit`),b=t(`rt-palette`),x=t(`rt-zoom`),S=t(`rt-arrangement`),C=t(`rt-viscosity`),w=t(`rt-cfl`),ie=t(`rt-thickness`),T=t(`rt-scrub`),E=t(`rt-live`),D=t(`rt-time`),O=t(`rt-fps`),k=t(`rt-viewport`),A=t(`rt-advance`),j,M,N=!1,P=!1,F=!1,I=!1,L=``,R=0,z=0,B=0,V=0,H=0,U=0,W=0,G=null,K=window.matchMedia?window.matchMedia(`(max-width: 48rem)`).matches:window.innerWidth<=768;c.value=K?`128`:`192`,l.value=u.value=K?`2`:`3`,x.value=`1`,f.checked=v.extendedAtwood;function q(){return{resolution:Number(c.value),width:Number(l.value),waves:u.valueAsNumber,atwood:d.valueAsNumber,extendedAtwood:f.checked,amplitude:p.valueAsNumber,gravity:-m.valueAsNumber,saveInterval:ee.valueAsNumber,maxSnapshots:h.valueAsNumber,heavyAbove:S.value===`above`,viscosity:Number(C.value),cfl:w.valueAsNumber,thickness:Number(ie.value)/2}}function J(){N=!1,G=null,cancelAnimationFrame(R),R=0,z=0,B=0,O.textContent=``}function Y(){let e=j&&j.viewIndex>=0;n(i,N?`Pause`:e?`Run Live`:`Run`),i.setAttribute(`aria-pressed`,String(N)),i.disabled=!j||F||P||I||!!L,a.disabled=F||!!L,A.disabled=!j||N||F||P||I||!!L||!j.recording,n(A,e?`Next live snapshot`:`Next snapshot`),n(a,I?`Apply & Reset`:`Reset`),t(`rt-pending`).hidden=!I;let s=j?.history.length||0;T.max=String(Math.max(0,s-1)),T.disabled=s<2||F,T.value=String(e?j.viewIndex:Math.max(0,s-1)),n(D,r(j?.displayedTime||0)),T.setAttribute(`aria-valuetext`,e?`Saved time ${D.textContent}`:`Live state`),E.disabled=!e||F,n(t(`rt-view-state`),e?`Saved`:`Live`),n(t(`rt-saved`),j?`${s} / ${j.historyLimit} snapshots${!j.recording&&!j.historyError?` - Full`:``}`:`No snapshots`),!(P||F)&&n(o,j?.historyError||(L?`Check settings`:I?`Changes ready`:G===null?N?`Running`:e?`Snapshot ${j.viewIndex+1} of ${s}`:j?.steps?`Paused`:`Ready`:`Advancing to next snapshot`))}function X(e){J(),P=!0,o.textContent=e.message,o.dataset.error=`true`,Y()}function Z(){let e=ne(f.checked);d.valueAsNumber>e&&(d.value=String(e)),d.max=String(e);let i=c.value;for(let e of g){let t=[...c.options].find(t=>Number(t.value)===e.value);t.textContent=`${e.label} (${e.value*Number(l.value)} × ${e.value*v.height})`}c.value=i,t(`rt-atwood-value`).textContent=d.valueAsNumber.toFixed(2),t(`rt-amplitude-value`).textContent=p.valueAsNumber.toFixed(3),t(`rt-acceleration-value`).textContent=m.valueAsNumber.toFixed(2),t(`rt-waves-value`).textContent=u.value,t(`rt-wavelength`).textContent=(Number(l.value)/u.valueAsNumber).toFixed(3),I=!!(M&&JSON.stringify(q())!==JSON.stringify(M)),L=``;for(let e of s.querySelectorAll(`input, select`)){let n=e.validity.valid;e.setAttribute(`aria-invalid`,String(!n)),!n&&!L&&(L=`Check ${t(e.id+`-label`)?.textContent.toLowerCase()||`the highlighted setting`}.`)}try{if(L)throw Error(L);let e=q(),n=y(e.resolution,e);t(`rt-memory`).textContent=`${I?`Next run: `:``}≈ ${(n.totalBytes/1e6).toFixed(1)} MB`,t(`rt-memory-limit`).textContent=n.historyLimit<e.maxSnapshots?`${n.historyLimit} snapshots fit the ${(te/1e6).toFixed(1)} MB history budget.`:``,t(`rt-memory-limit`).hidden=n.historyLimit>=e.maxSnapshots,t(`rt-history-end`).textContent=`History through time ${r((n.historyLimit-1)*e.saveInterval)}`}catch(e){L=e.message,t(`rt-memory`).textContent=`—`,t(`rt-history-end`).textContent=``,t(`rt-memory-limit`).hidden=!0}n(t(`rt-input-error`),L),t(`rt-input-error`).hidden=!L,Y()}function Q(){if(!j||F)return;let t=k.clientWidth||k.getBoundingClientRect().width;if(!t)return;let n=window.visualViewport?.height||window.innerHeight,r=Math.min(t,.72*n*j.nx/j.ny);if(e.style.width=`${Math.max(2,r*Number(x.value))}px`,!N)try{j.render()}catch(e){X(e)}}function ae(){if(!j||F)return;j.palette=_[b.value]||_[`red-blue`];let{heavy:t,light:n,names:r}=j.palette,i=t.map((e,t)=>(e+n[t])/2);for(let[e,r]of[[`heavy`,t],[`mixed`,i],[`light`,n]])document.querySelector(`.rt-${e}`).style.backgroundColor=`rgb(${r.map(e=>Math.round(255*e)).join(`,`)})`;e.setAttribute(`aria-label`,`Rayleigh-Taylor material field. ${r[0]} is heavy material and ${r[1]} is light material. Blended colors show intermediate material fractions.`);try{j.render()}catch(e){X(e)}}function $(){if(Z(),!(L||F)){J(),P=!1,j?.dispose(),j=null,B=0,V=0,delete o.dataset.error,o.textContent=`Preparing simulation…`;try{let t=q();j=new re(e,t.resolution,t),M=t,I=!1,Q(),ae(),Z()}catch(e){X(e)}Y()}}function oe(e){if(R=0,!N||F)return;if(document.hidden){z=0,B=0,H=0,U=e,W=j.time,R=requestAnimationFrame(oe);return}let t=z?Math.min((e-z)/1e3,.05):0;z=e,B+=t;let n=performance.now(),r=0;try{for(;r<16&&(r===0||performance.now()-n+V<18);){let e=j.nextDt();if(G===null&&B+1e-12<e)break;G!==null&&(e=Math.min(e,G-j.time));let t=performance.now();if(j.step(e),V=performance.now()-t,B=Math.max(0,B-e),r++,G!==null&&(j.time>=G-1e-10||!j.recording)){J();break}}B=Math.min(B,j.nextDt()),j.render(),H++,N&&e-U>500&&(O.textContent=`${Math.round(H*1e3/(e-U))} FPS`,O.title=`${((j.time-W)*1e3/(e-U)).toFixed(2)} simulation time units per second`,U=e,W=j.time,H=0),Y(),N&&(R=requestAnimationFrame(oe))}catch(e){X(e)}}function se(e=null){if(!(!j||F||P||I||L))try{j.showLive(),N=!0,G=e,z=0,B=0,U=performance.now(),W=j.time,H=0,Y(),R=requestAnimationFrame(oe)}catch(e){X(e)}}i.addEventListener(`click`,()=>{N?(J(),Y()):se()}),A.addEventListener(`click`,()=>{!N&&j?.recording&&se(j.history.length*j.config.saveInterval)}),a.addEventListener(`click`,$),l.addEventListener(`change`,()=>{u.value=l.value,J(),Z()});for(let e of[c,u,d,f,p,m,ee,h,S,C,w,ie])e.addEventListener(e.tagName===`SELECT`||e.type===`checkbox`?`change`:`input`,()=>{J(),Z()});b.addEventListener(`change`,ae),x.addEventListener(`change`,Q),T.addEventListener(`input`,()=>{if(!(!j||F)){J();try{j.showSnapshot(Number(T.value)),Y()}catch(e){X(e)}}}),E.addEventListener(`click`,()=>{if(!(!j||F))try{j.showLive(),Y()}catch(e){X(e)}});let ce=new ResizeObserver(Q);ce.observe(k),window.addEventListener(`resize`,Q),window.visualViewport?.addEventListener(`resize`,Q),e.addEventListener(`webglcontextlost`,e=>{e.preventDefault(),F=!0,X(Error(`Graphics interrupted. Waiting for the device to recover.`)),s.disabled=!0,b.disabled=!0,x.disabled=!0}),e.addEventListener(`webglcontextrestored`,()=>{F=!1,s.disabled=!1,b.disabled=!1,x.disabled=!1,$()}),window.addEventListener(`pagehide`,()=>{J(),ce.disconnect(),j?.dispose(),j=null}),window.addEventListener(`pageshow`,e=>{e.persisted&&(ce.observe(k),$())}),$()}typeof document<`u`&&x();