// WebGL2 kernels for variable-density incompressible flow on a staggered MAC grid.

export const INSTABILITY_VERTEX = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// Shared staggered-grid helpers for all CFD passes.
// Cell-centered scalars and pressure are surrounded by face-centered velocities:
//
//                    v(i, j + 1)
//                       |
//   u(i, j) --- c(i,j), rho(i,j), p(i,j) --- u(i + 1, j)
//                       |
//                    v(i, j)
//
// This MAC staggering avoids storing pressure and both velocity components at the same point.
export const INSTABILITY_GLSL = `#version 300 es
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
`;

export const INSTABILITY_SHADERS = {
  material:
    INSTABILITY_GLSL +
    `
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
}`,
  momentum:
    INSTABILITY_GLSL +
    `
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
}`,
  divergence:
    INSTABILITY_GLSL +
    `
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
}`,
  smooth:
    INSTABILITY_GLSL +
    `
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
}`,
  residual:
    INSTABILITY_GLSL +
    `
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
}`,
  restrict:
    INSTABILITY_GLSL +
    `
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
}`,
  smoothConstant:
    INSTABILITY_GLSL +
    `
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
}`,
  residualConstant:
    INSTABILITY_GLSL +
    `
uniform sampler2D pressure, rhs;

void main() {
  ivec2 i = ivec2(gl_FragCoord.xy), x = ivec2(1, 0), y = ivec2(0, 1);
  float p = scalar(pressure, i);
  float lap = (scalar(pressure, i - x) - p) + (scalar(pressure, i + x) - p);
  if (i.y > 0) lap += scalar(pressure, i - y) - p;
  if (i.y < grid.y - 1) lap += scalar(pressure, i + y) - p;
  color = vec4(scalar(rhs, i) - lap / (h * h), 0, 0, 1);
}`,
  restrictPressure:
    INSTABILITY_GLSL +
    `
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
}`,
  pressureApply:
    INSTABILITY_GLSL +
    `
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
}`,
  pressureVector:
    INSTABILITY_GLSL +
    `
uniform sampler2D a, b;
uniform float aScale, bScale, offset;

void main() {
  ivec2 i = ivec2(gl_FragCoord.xy);
  color = vec4(aScale * scalar(a, i) + bScale * scalar(b, i) + offset, 0, 0, 1);
}`,
  pressureCenter:
    INSTABILITY_GLSL +
    `
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
}`,
  pressureAxpy:
    INSTABILITY_GLSL +
    `
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
}`,
  pressureDirection:
    INSTABILITY_GLSL +
    `
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
}`,
  pressureProducts:
    INSTABILITY_GLSL +
    `
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
}`,
  pressureReduce:
    INSTABILITY_GLSL +
    `
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
}`,
  prolong:
    INSTABILITY_GLSL +
    `
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
}`,
  project:
    INSTABILITY_GLSL +
    `
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
}`,
  diagnostics:
    INSTABILITY_GLSL +
    `
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
}`,
  reduce:
    INSTABILITY_GLSL +
    `
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
}`,
  snapshot:
    INSTABILITY_GLSL +
    `
uniform sampler2D material;

void main() {
  // Quantize viewing snapshots to 16 bits, then store high/low bytes in RG8.
  // 65535 is the integer maximum, 256 the byte base, and 255 the UNORM scale.
  float value = floor(clamp(scalar(material, ivec2(gl_FragCoord.xy)), 0.0, 1.0) * 65535.0 + 0.5);
  color = vec4(floor(value / 256.0), mod(value, 256.0), 0.0, 255.0) / 255.0;
}`,
  display:
    INSTABILITY_GLSL +
    `
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
}`,
};
