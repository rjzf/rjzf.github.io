// WebGL2/GLSL acceleration for the instability solvers. GPU numerical kernels live here
// so the discretization stays searchable without mixing it with solver orchestration or browser UI.

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

  // Negative mass marks an invalid cell before max can hide it.
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
  // Pack [0, 1] material fraction into two 8-bit channels.
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
