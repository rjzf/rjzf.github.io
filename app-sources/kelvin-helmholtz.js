// Change one setting at a time when comparing runs.
export const KH_CONFIG = Object.freeze({
    width: 2,
    height: 1, // Keep the domain at a fixed 2:1 aspect ratio.
    atwood: 0, // Start with equal densities to isolate shear.
    gravity: 0,
    shear: 1, // Difference between the upper and lower velocities.
    shearThickness: 0.05, // Half-width scale of the smooth velocity transition.
    amplitude: 0.025, // Amplitude divided by wavelength.
    waves: 3,
    thickness: 0.0078125, // Half the sharp material transition width.
    phase: -Math.PI / 2, // Center the first billow in the view.
    heavyAbove: true, // Place material A above the interface.
    viscosity: 0, // No explicit velocity diffusion.
    cfl: 0.4, // Compare with 0.2 for timestep sensitivity.
    maxDt: 0.012,
    pressureTolerance: 0.0001,
    saveInterval: 0.25,
    maxSnapshots: 30,
});

export const KH_RESOLUTIONS = Object.freeze([
    { label: 'Lowest', value: 64 },
    { label: 'Low', value: 128 },
    { label: 'Medium', value: 192 },
    { label: 'High', value: 256 },
    { label: 'Highest', value: 384 },
]);
export const KH_HISTORY_BYTES = 128 * 1000 * 1000;

// Use the same grid and memory calculation for the controls and solver.
export function khLayout(resolution, overrides = {}) {
    const cfg = { ...KH_CONFIG, ...overrides };
    if (!KH_RESOLUTIONS.some((option) => option.value === resolution))
        throw new Error('Choose a supported grid resolution.');
    if (Object.entries(cfg).some(([key, value]) => key !== 'heavyAbove' && !Number.isFinite(value)))
        throw new Error('Simulation settings must be finite numbers.');
    if (cfg.width !== 2 || cfg.height !== 1) throw new Error('Keep the domain at 2 × 1.');
    if (cfg.atwood < 0 || cfg.atwood > 0.8 || cfg.viscosity < 0 || cfg.viscosity > 0.002)
        throw new Error('Use Atwood 0–0.8 and viscosity 0–0.002.');
    if (Math.abs(cfg.gravity) > 4) throw new Error('Use an acceleration magnitude from 0 to 4.');
    if (cfg.shear < 0 || cfg.shear > 4) throw new Error('Use a velocity difference from 0 to 4.');
    if (cfg.shearThickness !== 0.05) throw new Error('Keep the shear transition scale at 0.05.');
    if (!Number.isInteger(cfg.waves) || cfg.waves < 1 || cfg.waves > 6)
        throw new Error('Choose one to six waves.');
    if (
        cfg.amplitude < 0 ||
        cfg.amplitude > 0.05 ||
        cfg.thickness <= 0 ||
        (cfg.amplitude * cfg.width) / cfg.waves + cfg.thickness >= cfg.height / 2
    )
        throw new Error('Keep the initial interface inside the domain.');
    if (![0.0078125, 0.015625, 0.03125].includes(cfg.thickness))
        throw new Error('Choose Sharp, Normal, or Diffuse for the interface width.');
    if (
        cfg.cfl <= 0 ||
        cfg.cfl > 0.4 ||
        cfg.maxDt <= 0 ||
        cfg.pressureTolerance <= 0 ||
        cfg.pressureTolerance > 0.002
    )
        throw new Error('Use a CFL up to 0.4 and positive timestep and pressure settings.');
    if (typeof cfg.heavyAbove !== 'boolean') throw new Error('Use true or false for heavyAbove.');
    if (
        cfg.saveInterval < 0.01 ||
        cfg.saveInterval > 1 ||
        !Number.isInteger(cfg.maxSnapshots) ||
        cfg.maxSnapshots < 2 ||
        cfg.maxSnapshots > 50
    )
        throw new Error('Save every 0.01–1 time units and choose 2–50 snapshots.');
    const nx = resolution * cfg.width,
        ny = resolution * cfg.height,
        h = 1 / resolution;
    const levels = [];
    for (let width = nx, height = ny, spacing = h; ; width /= 2, height /= 2, spacing *= 2) {
        levels.push({ width, height, h: spacing });
        if (Math.min(width, height) <= 4 || width % 2 || height % 2) break;
    }
    let workingBytes = 16 * nx * (ny + 1) + 12 * nx * ny;
    levels.forEach((level, index) => {
        workingBytes += level.width * level.height * (index ? 20 : 16);
    });
    for (let width = nx, height = ny; ; width = Math.ceil(width / 2), height = Math.ceil(height / 2)) {
        workingBytes += 16 * width * height;
        if (width === 1 && height === 1) break;
    }
    const snapshotBytes = 2 * nx * ny;
    const historyLimit = Math.min(cfg.maxSnapshots, Math.floor(KH_HISTORY_BYTES / snapshotBytes));
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

// Palettes change the display without changing the material field.
export const KH_PALETTES = Object.freeze({
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

export const KH_VERTEX = `#version 300 es
void main() {
    vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const common = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform ivec2 grid;
uniform float h, dt, atwood;
out vec4 color;

// Wrap horizontally and extend scalar values across the vertical walls.
// Keep modulo operands nonnegative for GLSL portability.
int wrap(int x, int size) { return x < 0 ? size - 1 - ((-1-x) % size) : x % size; }
ivec2 cell(ivec2 p) { return ivec2(wrap(p.x,grid.x), clamp(p.y, 0, grid.y - 1)); }
float scalar(sampler2D f, ivec2 p) { return texelFetch(f, cell(p), 0).r; }
float rho(float c) { return 1.0 + atwood * (2.0 * c - 1.0); }
float inverseFace(sampler2D c, ivec2 a, ivec2 b) { return 2.0 / (rho(scalar(c, a)) + rho(scalar(c, b))); }

// Store horizontal velocity on left faces and vertical velocity on bottom faces.
float face(sampler2D f, ivec2 p, int axis) {
    int x = wrap(p.x,grid.x);
    if (axis == 1 && (p.y <= 0 || p.y >= grid.y)) return 0.0;
    return texelFetch(f, ivec2(x, clamp(p.y, 0, grid.y - 1)), 0)[axis];
}
float linearFace(sampler2D f, vec2 p, int axis) {
    vec2 q = p / h - (axis == 0 ? vec2(0.0, 0.5) : vec2(0.5, 0.0));
    ivec2 i = ivec2(floor(q)); vec2 w = fract(q);
    return mix(mix(face(f, i, axis), face(f, i + ivec2(1,0), axis), w.x),
               mix(face(f, i + ivec2(0,1), axis), face(f, i + ivec2(1,1), axis), w.x), w.y);
}
vec2 velocityAt(sampler2D f, vec2 p) { return vec2(linearFace(f,p,0), linearFace(f,p,1)); }
`;

export const KH_SHADERS = {
    initial:
        common +
        `
        uniform float amplitude, thickness, phase, heavyAbove, waves;
        void main() {
            vec2 p = gl_FragCoord.xy * h;
            float interfaceY = 0.5 * float(grid.y) * h + amplitude * cos(6.28318530718 * waves * p.x / (float(grid.x) * h) + phase);
            float c = smoothstep(-thickness, thickness, p.y - interfaceY);
            color = vec4(heavyAbove > 0.5 ? c : 1.0-c, 0, 0, 1);
        }`,
    initialVelocity:
        common +
        `
        uniform float shear, shearThickness, amplitude, waves, phase;

        // Form a localized perturbation with zero flow through the walls.
        float stream(ivec2 vertex) {
            if (vertex.y <= 0 || vertex.y >= grid.y) return 0.0;
            float height = float(grid.y) * h;
            float x = float(wrap(vertex.x, grid.x)) * h;
            float y = float(vertex.y) * h;
            float k = 6.28318530718 * waves / (float(grid.x) * h);
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
            float u = 0.5 * shear * tanh((y - center) / shearThickness);

            // A discrete curl keeps the seed velocity divergence-free.
            u += (stream(row + ivec2(0, 1)) - stream(row)) / h;
            float v = -(stream(i + ivec2(1, 0)) - stream(i)) / h;
            color = vec4(u, v, 0, 1);
        }`,
    material:
        common +
        `
        uniform sampler2D source, original, velocity;
        uniform float stage;
        float limited(float a, float b) {
            if (a * b <= 0.0) return 0.0;
            return sign(a) * min(0.5 * abs(a+b), min(2.0*abs(a), 2.0*abs(b)));
        }
        float slope(ivec2 p, ivec2 axis) {
            return limited(scalar(source,p)-scalar(source,p-axis), scalar(source,p+axis)-scalar(source,p));
        }
        float flux(ivec2 left, ivec2 axis, float u) {
            float c = u >= 0.0 ? scalar(source,left)+0.5*slope(left,axis)
                               : scalar(source,left+axis)-0.5*slope(left+axis,axis);
            return u * c;
        }
        void main() {
            ivec2 p = ivec2(gl_FragCoord.xy), x = ivec2(1,0), y = ivec2(0,1);
            float right = flux(p,x,face(velocity,p+x,0));
            float left = flux(p-x,x,face(velocity,p,0));
            float top = flux(p,y,face(velocity,p+y,1));
            float bottom = flux(p-y,y,face(velocity,p,1));
            float next = scalar(source,p) - dt/h * (right-left+top-bottom);
            if (stage > 0.5) next = 0.5 * (scalar(original,p) + next);
            color = vec4(clamp(next,0.0,1.0),0,0,1);
        }`,
    momentum:
        common +
        `
        uniform sampler2D velocity, material;
        uniform float gravity, viscosity;
        float advance(ivec2 i, int axis) {
            if (axis == 1 && (i.y == 0 || i.y == grid.y)) return 0.0;
            vec2 p = (vec2(i) + (axis == 0 ? vec2(0.0,0.5) : vec2(0.5,0.0))) * h;
            vec2 midpoint = p - 0.5 * dt * velocityAt(velocity,p);
            float value = linearFace(velocity, p-dt*velocityAt(velocity,midpoint), axis);
            if (viscosity > 0.0) {
                float lap = face(velocity,i+ivec2(1,0),axis)+face(velocity,i-ivec2(1,0),axis)
                          + face(velocity,i+ivec2(0,1),axis)+face(velocity,i-ivec2(0,1),axis)-4.0*face(velocity,i,axis);
                value += dt * viscosity * lap / (h*h);
            }
            if (axis == 1) value += dt * gravity * (1.0-inverseFace(material,i-ivec2(0,1),i));
            return value;
        }
        void main() {
            ivec2 i = ivec2(gl_FragCoord.xy);
            color = vec4(advance(ivec2(i.x,min(i.y,grid.y-1)),0), advance(i,1), 0, 1);
        }`,
    divergence:
        common +
        `
        uniform sampler2D velocity;
        void main() {
            ivec2 i = ivec2(gl_FragCoord.xy);
            color = vec4((face(velocity,i+ivec2(1,0),0)-face(velocity,i,0)
                        +face(velocity,i+ivec2(0,1),1)-face(velocity,i,1))/h,0,0,1);
        }`,
    smooth:
        common +
        `
        uniform sampler2D pressure, rhs, material;
        void main() {
            ivec2 i=ivec2(gl_FragCoord.xy), l=i-ivec2(1,0), r=i+ivec2(1,0), b=i-ivec2(0,1), t=i+ivec2(0,1);
            float al=inverseFace(material,i,l), ar=inverseFace(material,i,r);
            float ab=i.y>0 ? inverseFace(material,i,b) : 0.0;
            float at=i.y<grid.y-1 ? inverseFace(material,i,t) : 0.0;
            float next=(al*scalar(pressure,l)+ar*scalar(pressure,r)+ab*scalar(pressure,b)+at*scalar(pressure,t)
                       -h*h*scalar(rhs,i))/(al+ar+ab+at);
            color=vec4(mix(scalar(pressure,i),next,0.6666666667),0,0,1);
        }`,
    residual:
        common +
        `
        uniform sampler2D pressure, rhs, material;
        void main() {
            ivec2 i=ivec2(gl_FragCoord.xy), l=i-ivec2(1,0), r=i+ivec2(1,0), b=i-ivec2(0,1), t=i+ivec2(0,1);
            float p=scalar(pressure,i);
            float lap=inverseFace(material,i,l)*(scalar(pressure,l)-p)+inverseFace(material,i,r)*(scalar(pressure,r)-p);
            if(i.y>0) lap+=inverseFace(material,i,b)*(scalar(pressure,b)-p);
            if(i.y<grid.y-1) lap+=inverseFace(material,i,t)*(scalar(pressure,t)-p);
            color=vec4(scalar(rhs,i)-lap/(h*h),0,0,1);
        }`,
    restrict:
        common +
        `
        uniform sampler2D source;
        void main() {
            ivec2 i=ivec2(gl_FragCoord.xy)*2;
            color=vec4(0.25*(texelFetch(source,i,0).r+texelFetch(source,i+ivec2(1,0),0).r
                +texelFetch(source,i+ivec2(0,1),0).r+texelFetch(source,i+ivec2(1,1),0).r),0,0,1);
        }`,
    prolong:
        common +
        `
        uniform sampler2D pressure, coarse;
        float sampleCoarse(ivec2 i) {
            ivec2 s=textureSize(coarse,0);
            return texelFetch(coarse,ivec2(wrap(i.x,s.x),clamp(i.y,0,s.y-1)),0).r;
        }
        void main() {
            vec2 p=gl_FragCoord.xy*0.5-0.5;
            ivec2 i=ivec2(floor(p)); vec2 w=fract(p);
            float c=mix(mix(sampleCoarse(i),sampleCoarse(i+ivec2(1,0)),w.x),
                        mix(sampleCoarse(i+ivec2(0,1)),sampleCoarse(i+ivec2(1,1)),w.x),w.y);
            color=vec4(texelFetch(pressure,ivec2(gl_FragCoord.xy),0).r+c,0,0,1);
        }`,
    project:
        common +
        `
        uniform sampler2D pressure, velocity, material;
        void main() {
            ivec2 i=ivec2(gl_FragCoord.xy), u=ivec2(i.x,min(i.y,grid.y-1));
            float x=face(velocity,u,0)-inverseFace(material,u-ivec2(1,0),u)*(scalar(pressure,u)-scalar(pressure,u-ivec2(1,0)))/h;
            float y=0.0;
            if(i.y>0 && i.y<grid.y) y=face(velocity,i,1)-inverseFace(material,i-ivec2(0,1),i)*(scalar(pressure,i)-scalar(pressure,i-ivec2(0,1)))/h;
            color=vec4(x,y,0,1);
        }`,
    diagnostics:
        common +
        `
        uniform sampler2D velocity, material;
        void main() {
            ivec2 i=ivec2(gl_FragCoord.xy);
            float l=face(velocity,i,0), r=face(velocity,i+ivec2(1,0),0);
            float b=face(velocity,i,1), t=face(velocity,i+ivec2(0,1),1);
            vec4 faces = vec4(l, r, b, t);
            float concentration = scalar(material, i);

            // Negative mass marks an invalid cell before max can hide it.
            if (any(isnan(faces)) || any(isinf(faces)) || isnan(concentration) || isinf(concentration)) {
                color = vec4(0, 0, 0, -1);
                return;
            }
            color = vec4(max(abs(l), abs(r)), max(abs(b), abs(t)), abs(r-l+t-b)/h, concentration);
        }`,
    reduce:
        common +
        `
        uniform sampler2D source;
        void main() {
            ivec2 p=ivec2(gl_FragCoord.xy)*2, s=textureSize(source,0);
            vec4 value=vec4(0);
            for(int y=0;y<2;y++) for(int x=0;x<2;x++) {
                ivec2 q=p+ivec2(x,y);
                if(all(lessThan(q,s))) {
                    vec4 next=texelFetch(source,q,0);
                    // Carry invalid cells through every reduction level.
                    if (next.w < 0.0 || any(isnan(next)) || any(isinf(next))) {
                        color = vec4(0, 0, 0, -1);
                        return;
                    }
                    value=vec4(max(value.xyz,next.xyz),value.w+next.w);
                }
            }
            color=value;
        }`,
    snapshot:
        common +
        `
        uniform sampler2D material;
        void main() {
            float value = floor(clamp(scalar(material,ivec2(gl_FragCoord.xy)),0.0,1.0)*65535.0+0.5);
            color = vec4(floor(value/256.0),mod(value,256.0),0.0,255.0)/255.0;
        }`,
    display:
        common +
        `
        uniform sampler2D material;
        uniform vec2 viewport;
        uniform vec3 lightColor, heavyColor;
        uniform float isSnapshot;
        float fraction(ivec2 p) {
            vec2 value = texelFetch(material,cell(p),0).rg;
            return isSnapshot > 0.5 ? dot(floor(value*255.0+0.5),vec2(256.0,1.0))/65535.0 : value.r;
        }
        void main() {
            vec2 p=gl_FragCoord.xy/viewport*vec2(grid)-0.5;
            ivec2 i=ivec2(floor(p)); vec2 w=fract(p);
            float c=mix(mix(fraction(i),fraction(i+ivec2(1,0)),w.x),
                        mix(fraction(i+ivec2(0,1)),fraction(i+ivec2(1,1)),w.x),w.y);
            color=vec4(mix(lightColor,heavyColor,clamp(c,0.0,1.0)),1);
        }`,
};

export class KHSolver {
    constructor(canvas, resolution = 128, overrides = {}) {
        this.layout = khLayout(resolution, overrides);
        this.canvas = canvas;
        this.config = this.layout.cfg;
        const cfg = this.config;
        this.nx = this.layout.nx;
        this.ny = this.layout.ny;
        this.h = this.layout.h;
        this.history = [];
        this.historyLimit = this.layout.historyLimit;
        this.historyError = '';
        this.viewIndex = -1;
        this.palette = KH_PALETTES['red-blue'];
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
            for (const [name, source] of Object.entries(KH_SHADERS))
                this.programs[name] = this.program(source);
            this.velocity = this.pair(this.nx, this.ny + 1, 2);
            this.material = this.pair(this.nx, this.ny, 1);
            this.materialStage = this.target(this.nx, this.ny, 1);
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
            for (let w = this.nx, h = this.ny; ; w = Math.ceil(w / 2), h = Math.ceil(h / 2)) {
                this.reductions.push(this.target(w, h, 4));
                if (w === 1 && h === 1) break;
            }
            this.draw(
                'initial',
                this.material.read,
                {},
                {
                    amplitude: (cfg.amplitude * cfg.width) / cfg.waves,
                    waves: cfg.waves,
                    thickness: cfg.thickness,
                    phase: cfg.phase,
                    heavyAbove: cfg.heavyAbove ? 1 : 0,
                }
            );
            this.draw(
                'initialVelocity',
                this.velocity.read,
                {},
                {
                    shear: cfg.shear,
                    shearThickness: cfg.shearThickness,
                    amplitude: cfg.amplitude,
                    waves: cfg.waves,
                    phase: cfg.phase,
                }
            );
            this.measure(this.velocity.read);
            this.initialMass = this.stats[3];
            this.captureSnapshot();
            this.render();
        } catch (error) {
            this.dispose();
            throw error;
        }
    }

    // Compile programs once and release partial objects on failure.
    program(source) {
        const gl = this.gl,
            shaders = [];
        let program;
        try {
            for (const [type, text] of [
                [gl.VERTEX_SHADER, KH_VERTEX],
                [gl.FRAGMENT_SHADER, source],
            ]) {
                const shader = gl.createShader(type);
                shaders.push(shader);
                gl.shaderSource(shader, text);
                gl.compileShader(shader);
                if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
                    throw new Error(gl.getShaderInfoLog(shader));
            }
            program = gl.createProgram();
            shaders.forEach((shader) => gl.attachShader(program, shader));
            gl.linkProgram(program);
            if (!gl.getProgramParameter(program, gl.LINK_STATUS))
                throw new Error(gl.getProgramInfoLog(program));
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
            this.smooth(level, Math.max(40, Math.ceil(Math.max(level.width, level.height) ** 2 / 4)));
            return;
        }
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
        const acceleration = (Math.abs(cfg.gravity) * cfg.atwood) / (1 - cfg.atwood);
        const speed = this.stats[0] + this.stats[1];
        const advective =
            (2 * cfg.cfl * h) / (speed + Math.sqrt(speed * speed + 4 * acceleration * cfg.cfl * h) + 1e-12);
        const diffusion = cfg.viscosity > 0 ? (0.2 * h * h) / (2 * cfg.viscosity) : Infinity;
        let dt = Math.min(cfg.maxDt, advective, diffusion);
        if (this.recording) dt = Math.min(dt, this.history.length * cfg.saveInterval - this.time);
        return dt;
    }

    step(dt = this.nextDt()) {
        dt = Math.min(dt, this.nextDt());
        if (!Number.isFinite(dt) || dt <= 0)
            throw new Error('The timestep could not be calculated. Reset to start again.');
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
        this.levels[0].material = this.material.read;
        for (let i = 1; i < this.levels.length; i++)
            this.draw(
                'restrict',
                this.levels[i].material,
                { source: this.levels[i - 1].material },
                {},
                this.levels[i]
            );
        this.draw(
            'momentum',
            this.velocity.write,
            { velocity: this.velocity.read, material: this.material.read },
            { dt, gravity: this.config.gravity, viscosity: this.config.viscosity }
        );
        this.swap(this.velocity);
        this.draw('divergence', this.levels[0].rhs, { velocity: this.velocity.read });
        let cycles = 0;
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
        if (this.stats[2] * dt > 0.002)
            throw new Error('The pressure solve could not settle. Reset or try the lower resolution.');
        this.swap(this.velocity);
        this.time += dt;
        this.steps++;
        this.lastCycles = cycles;
        if (Math.abs(this.stats[3] - this.initialMass) / this.initialMass > 0.02)
            throw new Error('Material balance changed too much. Reset to start a new run.');
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

export function initKH() {
    const canvas = document.getElementById('kh-canvas');
    if (!canvas) return;
    const get = (id) => document.getElementById(id);
    const text = (element, value) => {
        if (element.textContent !== value) element.textContent = value;
    };
    const timeLabel = (value) =>
        value.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 6,
            useGrouping: false,
        });
    const run = get('kh-run'),
        reset = get('kh-reset'),
        status = get('kh-status'),
        setup = get('kh-setup');
    const resolution = get('kh-resolution'),
        waves = get('kh-waves');
    const atwood = get('kh-atwood'),
        amplitude = get('kh-amplitude'),
        acceleration = get('kh-acceleration'),
        shear = get('kh-shear');
    const interval = get('kh-interval'),
        limit = get('kh-limit'),
        palette = get('kh-palette'),
        zoom = get('kh-zoom');
    const arrangement = get('kh-arrangement'),
        viscosity = get('kh-viscosity'),
        thickness = get('kh-thickness');
    const scrub = get('kh-scrub'),
        live = get('kh-live'),
        clock = get('kh-time'),
        fps = get('kh-fps');
    const viewport = get('kh-viewport'),
        advance = get('kh-advance');
    let solver,
        applied,
        running = false,
        failed = false,
        lost = false,
        pending = false,
        inputError = '';
    let request = 0,
        previous = 0,
        accumulated = 0,
        stepMs = 0,
        samples = 0,
        sampleTime = 0,
        sampleSimulationTime = 0,
        advanceTo = null;

    // Remove the retired width control from existing HTML.
    get('kh-width')?.closest('.kh-wide')?.remove();
    get('kh-wavelength').setAttribute('for', 'kh-waves');

    // Choose defaults once and preserve them through window resizing.
    const narrow = window.matchMedia
        ? window.matchMedia('(max-width: 48rem)').matches
        : window.innerWidth <= 768;
    resolution.value = narrow ? '128' : '192';
    waves.value = String(KH_CONFIG.waves);
    atwood.value = String(KH_CONFIG.atwood);
    amplitude.value = String(KH_CONFIG.amplitude);
    shear.value = String(KH_CONFIG.shear);
    acceleration.value = String(Math.abs(KH_CONFIG.gravity));
    arrangement.value = KH_CONFIG.heavyAbove ? 'above' : 'below';
    viscosity.value = String(KH_CONFIG.viscosity);
    thickness.value = String(2 * KH_CONFIG.thickness);
    zoom.value = narrow ? '1' : '1';

    function settings() {
        return {
            resolution: Number(resolution.value),
            width: KH_CONFIG.width,
            waves: waves.valueAsNumber,
            atwood: atwood.valueAsNumber,
            amplitude: amplitude.valueAsNumber,
            gravity: -acceleration.valueAsNumber,
            shear: shear.valueAsNumber,
            saveInterval: interval.valueAsNumber,
            maxSnapshots: limit.valueAsNumber,
            heavyAbove: arrangement.value === 'above',
            viscosity: Number(viscosity.value),
            thickness: Number(thickness.value) / 2,
        };
    }
    function pause() {
        running = false;
        advanceTo = null;
        cancelAnimationFrame(request);
        request = 0;
        previous = 0;
        accumulated = 0;
        fps.textContent = '';
    }
    function refresh() {
        const viewing = solver && solver.viewIndex >= 0;
        text(run, running ? 'Pause' : viewing ? 'Run Live' : 'Run');
        run.setAttribute('aria-pressed', String(running));
        run.disabled = !solver || lost || failed || pending || Boolean(inputError);
        reset.disabled = lost || Boolean(inputError);
        advance.disabled =
            !solver || running || lost || failed || pending || Boolean(inputError) || !solver.recording;
        text(advance, viewing ? 'Next live snapshot' : 'Next snapshot');
        text(reset, pending ? 'Apply & Reset' : 'Reset');
        get('kh-pending').hidden = !pending;
        const count = solver?.history.length || 0;
        scrub.max = String(Math.max(0, count - 1));
        scrub.disabled = count < 2 || lost;
        scrub.value = String(viewing ? solver.viewIndex : Math.max(0, count - 1));
        text(clock, timeLabel(solver?.displayedTime || 0));
        scrub.setAttribute('aria-valuetext', viewing ? `Saved time ${clock.textContent}` : 'Live state');
        live.disabled = !viewing || lost;
        text(get('kh-view-state'), viewing ? 'Saved' : 'Live');
        text(
            get('kh-saved'),
            solver
                ? `${count} / ${solver.historyLimit} snapshots${!solver.recording && !solver.historyError ? ' · Full' : ''}`
                : 'No snapshots'
        );
        if (failed || lost) return;
        text(
            status,
            solver?.historyError ||
                (inputError
                    ? 'Check settings'
                    : pending
                      ? 'Changes ready'
                      : advanceTo !== null
                        ? 'Advancing to next snapshot'
                        : running
                          ? 'Running'
                          : viewing
                            ? `Snapshot ${solver.viewIndex + 1} of ${count}`
                            : solver?.steps
                              ? 'Paused'
                              : 'Ready')
        );
    }
    function fail(error) {
        pause();
        failed = true;
        status.textContent = error.message;
        status.dataset.error = 'true';
        refresh();
    }

    // Preview the next run without reallocating the current simulation.
    function describe() {
        const selected = resolution.value;
        for (const option of KH_RESOLUTIONS) {
            const element = [...resolution.options].find((item) => Number(item.value) === option.value);
            element.textContent = `${option.label} (${option.value * KH_CONFIG.width} × ${option.value * KH_CONFIG.height})`;
        }
        resolution.value = selected;
        get('kh-atwood-value').textContent = atwood.valueAsNumber.toFixed(2);
        get('kh-amplitude-value').textContent = amplitude.valueAsNumber.toFixed(3);
        get('kh-acceleration-value').textContent = acceleration.valueAsNumber.toFixed(2);
        get('kh-shear-value').textContent = shear.valueAsNumber.toFixed(2);
        get('kh-waves-value').textContent = waves.value;
        get('kh-wavelength').textContent = (KH_CONFIG.width / waves.valueAsNumber).toFixed(3);
        pending = Boolean(applied && JSON.stringify(settings()) !== JSON.stringify(applied));
        inputError = '';
        for (const input of setup.querySelectorAll('input, select')) {
            const valid = input.validity.valid;
            input.setAttribute('aria-invalid', String(!valid));
            if (!valid && !inputError)
                inputError = `Check ${get(input.id + '-label')?.textContent.toLowerCase() || 'the highlighted setting'}.`;
        }
        try {
            if (inputError) throw new Error(inputError);
            const next = settings(),
                layout = khLayout(next.resolution, next);
            get('kh-memory').textContent =
                `${pending ? 'Next run: ' : ''}≈ ${(layout.totalBytes / 1000000).toFixed(1)} MB`;
            get('kh-memory-limit').textContent =
                layout.historyLimit < next.maxSnapshots
                    ? `${layout.historyLimit} snapshots fit the ${(KH_HISTORY_BYTES / 1000000).toFixed(1)} MB history budget.`
                    : '';
            get('kh-memory-limit').hidden = layout.historyLimit >= next.maxSnapshots;
            get('kh-history-end').textContent =
                `History through time ${timeLabel((layout.historyLimit - 1) * next.saveInterval)}`;
        } catch (error) {
            inputError = error.message;
            get('kh-memory').textContent = '—';
            get('kh-history-end').textContent = '';
            get('kh-memory-limit').hidden = true;
        }
        text(get('kh-input-error'), inputError);
        get('kh-input-error').hidden = !inputError;
        refresh();
    }

    // Resize the view without changing fluid cells or saved snapshots.
    function resizeView() {
        if (!solver || lost) return;
        const available = viewport.clientWidth || viewport.getBoundingClientRect().width;
        if (!available) return;
        const height = window.visualViewport?.height || window.innerHeight;
        const base = Math.min(available, (0.72 * height * solver.nx) / solver.ny);
        canvas.style.width = `${Math.max(2, base * Number(zoom.value))}px`;
        if (!running) {
            try {
                solver.render();
            } catch (error) {
                fail(error);
            }
        }
    }

    // Recolor live or saved material without changing its numerical state.
    function recolor() {
        if (!solver || lost) return;
        solver.palette = KH_PALETTES[palette.value] || KH_PALETTES['red-blue'];
        const { heavy, light, names } = solver.palette;
        const mixed = heavy.map((x, i) => (x + light[i]) / 2);
        for (const [name, color] of [
            ['heavy', heavy],
            ['mixed', mixed],
            ['light', light],
        ]) {
            document.querySelector(`.kh-${name}`).style.backgroundColor =
                `rgb(${color.map((x) => Math.round(255 * x)).join(',')})`;
        }
        canvas.setAttribute(
            'aria-label',
            `Kelvin-Helmholtz material field. ${names[0]} is material A and ${names[1]} is material B. Blended colors show intermediate material fractions.`
        );
        try {
            solver.render();
        } catch (error) {
            fail(error);
        }
    }
    function initialize() {
        describe();
        if (inputError || lost) return;
        pause();
        failed = false;
        solver?.dispose();
        solver = null;
        accumulated = 0;
        stepMs = 0;
        delete status.dataset.error;
        status.textContent = 'Preparing simulation…';
        try {
            const next = settings();
            solver = new KHSolver(canvas, next.resolution, next);
            applied = next;
            pending = false;
            resizeView();
            recolor();
            describe();
        } catch (error) {
            fail(error);
        }
        refresh();
    }

    // Limit work per frame while allowing fast devices to catch up.
    function frame(now) {
        request = 0;
        if (!running || lost) return;
        if (document.hidden) {
            previous = 0;
            accumulated = 0;
            samples = 0;
            sampleTime = now;
            sampleSimulationTime = solver.time;
            request = requestAnimationFrame(frame);
            return;
        }
        const elapsed = previous ? Math.min((now - previous) / 1000, 0.05) : 0;
        previous = now;
        accumulated += elapsed;
        const started = performance.now();
        let steps = 0;
        try {
            while (steps < 16 && (steps === 0 || performance.now() - started + stepMs < 18)) {
                let dt = solver.nextDt();
                if (advanceTo === null && accumulated + 1e-12 < dt) break;
                if (advanceTo !== null) dt = Math.min(dt, advanceTo - solver.time);
                const stepStart = performance.now();
                solver.step(dt);
                stepMs = performance.now() - stepStart;
                accumulated = Math.max(0, accumulated - dt);
                steps++;
                if (advanceTo !== null && (solver.time >= advanceTo - 1e-10 || !solver.recording)) {
                    pause();
                    break;
                }
            }
            accumulated = Math.min(accumulated, solver.nextDt());
            solver.render();
            samples++;
            if (running && now - sampleTime > 500) {
                fps.textContent = `${Math.round((samples * 1000) / (now - sampleTime))} FPS`;
                fps.title = `${(((solver.time - sampleSimulationTime) * 1000) / (now - sampleTime)).toFixed(2)} simulation time units per second`;
                sampleTime = now;
                sampleSimulationTime = solver.time;
                samples = 0;
            }
            refresh();
            if (running) request = requestAnimationFrame(frame);
        } catch (error) {
            fail(error);
        }
    }
    function start(target = null) {
        if (!solver || lost || failed || pending || inputError) return;
        try {
            solver.showLive();
            running = true;
            advanceTo = target;
            previous = 0;
            accumulated = 0;
            sampleTime = performance.now();
            sampleSimulationTime = solver.time;
            samples = 0;
            refresh();
            request = requestAnimationFrame(frame);
        } catch (error) {
            fail(error);
        }
    }
    run.addEventListener('click', () => {
        if (running) {
            pause();
            refresh();
        } else start();
    });
    advance.addEventListener('click', () => {
        if (!running && solver?.recording) start(solver.history.length * solver.config.saveInterval);
    });
    reset.addEventListener('click', initialize);
    for (const input of [
        resolution,
        waves,
        atwood,
        amplitude,
        acceleration,
        shear,
        interval,
        limit,
        arrangement,
        viscosity,
        thickness,
    ]) {
        input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', () => {
            pause();
            describe();
        });
    }
    palette.addEventListener('change', recolor);
    zoom.addEventListener('change', resizeView);
    scrub.addEventListener('input', () => {
        if (!solver || lost) return;
        pause();
        try {
            solver.showSnapshot(Number(scrub.value));
            refresh();
        } catch (error) {
            fail(error);
        }
    });
    live.addEventListener('click', () => {
        if (!solver || lost) return;
        try {
            solver.showLive();
            refresh();
        } catch (error) {
            fail(error);
        }
    });
    const observer = new ResizeObserver(resizeView);
    observer.observe(viewport);
    window.addEventListener('resize', resizeView);
    window.visualViewport?.addEventListener('resize', resizeView);
    canvas.addEventListener('webglcontextlost', (event) => {
        event.preventDefault();
        lost = true;
        fail(new Error('Graphics interrupted. Waiting for the device to recover.'));
        setup.disabled = true;
        palette.disabled = true;
        zoom.disabled = true;
    });
    canvas.addEventListener('webglcontextrestored', () => {
        lost = false;
        setup.disabled = false;
        palette.disabled = false;
        zoom.disabled = false;
        initialize();
    });
    window.addEventListener('pagehide', () => {
        pause();
        observer.disconnect();
        solver?.dispose();
        solver = null;
    });
    window.addEventListener('pageshow', (event) => {
        if (event.persisted) {
            observer.observe(viewport);
            initialize();
        }
    });
    initialize();
}

if (typeof document !== 'undefined') initKH();
