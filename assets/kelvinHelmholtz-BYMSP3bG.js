import"./modulepreload-polyfill-Ke7zwH0v.js";/* empty css              */var e=Object.freeze({width:2,height:1,atwood:0,gravity:0,shear:1,shearThickness:.05,amplitude:.025,waves:3,thickness:.0078125,phase:-Math.PI/2,heavyAbove:!0,viscosity:0,cfl:.4,maxDt:.012,pressureTolerance:1e-4,saveInterval:.25,maxSnapshots:30}),t=Object.freeze([{label:`Lowest`,value:64},{label:`Low`,value:128},{label:`Medium`,value:192},{label:`High`,value:256},{label:`Highest`,value:384}]),n=128*1e3*1e3;function r(r,i={}){let a={...e,...i};if(!t.some(e=>e.value===r))throw Error(`Choose a supported grid resolution.`);if(Object.entries(a).some(([e,t])=>e!==`heavyAbove`&&!Number.isFinite(t)))throw Error(`Simulation settings must be finite numbers.`);if(a.width!==2||a.height!==1)throw Error(`Keep the domain at 2 × 1.`);if(a.atwood<0||a.atwood>.8||a.viscosity<0||a.viscosity>.002)throw Error(`Use Atwood 0–0.8 and viscosity 0–0.002.`);if(Math.abs(a.gravity)>4)throw Error(`Use an acceleration magnitude from 0 to 4.`);if(a.shear<0||a.shear>4)throw Error(`Use a velocity difference from 0 to 4.`);if(a.shearThickness!==.05)throw Error(`Keep the shear transition scale at 0.05.`);if(!Number.isInteger(a.waves)||a.waves<1||a.waves>6)throw Error(`Choose one to six waves.`);if(a.amplitude<0||a.amplitude>.05||a.thickness<=0||a.amplitude*a.width/a.waves+a.thickness>=a.height/2)throw Error(`Keep the initial interface inside the domain.`);if(![.0078125,.015625,.03125].includes(a.thickness))throw Error(`Choose Sharp, Normal, or Diffuse for the interface width.`);if(a.cfl<=0||a.cfl>.4||a.maxDt<=0||a.pressureTolerance<=0||a.pressureTolerance>.002)throw Error(`Use a CFL up to 0.4 and positive timestep and pressure settings.`);if(typeof a.heavyAbove!=`boolean`)throw Error(`Use true or false for heavyAbove.`);if(a.saveInterval<.01||a.saveInterval>1||!Number.isInteger(a.maxSnapshots)||a.maxSnapshots<2||a.maxSnapshots>50)throw Error(`Save every 0.01–1 time units and choose 2–50 snapshots.`);let o=r*a.width,s=r*a.height,c=1/r,l=[];for(let e=o,t=s,n=c;l.push({width:e,height:t,h:n}),!(Math.min(e,t)<=4||e%2||t%2);e/=2,t/=2,n*=2);let u=16*o*(s+1)+12*o*s;l.forEach((e,t)=>{u+=e.width*e.height*(t?20:16)});for(let e=o,t=s;u+=16*e*t,!(e===1&&t===1);e=Math.ceil(e/2),t=Math.ceil(t/2));let d=2*o*s,f=Math.min(a.maxSnapshots,Math.floor(n/d));return{cfg:a,nx:o,ny:s,h:c,levels:l,workingBytes:u,snapshotBytes:d,historyLimit:f,totalBytes:u+d*f}}var i=Object.freeze({"red-blue":{heavy:[.96,.08,.12],light:[.08,.24,.98],names:[`Red`,`blue`]},"orange-blue":{heavy:[230/255,159/255,0],light:[0,114/255,178/255],names:[`Orange`,`blue`]},"magenta-teal":{heavy:[204/255,121/255,167/255],light:[0,158/255,115/255],names:[`Magenta`,`teal`]},"black-white":{heavy:[0,0,0],light:[1,1,1],names:[`Black`,`white`]},"navy-gold":{heavy:[24/255,45/255,85/255],light:[250/255,195/255,50/255],names:[`Navy`,`gold`]},"purple-mint":{heavy:[106/255,52/255,163/255],light:[146/255,235/255,192/255],names:[`Purple`,`mint`]}}),a=`#version 300 es
void main() {
    vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`,o=`#version 300 es
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
`,s={initial:o+`
        uniform float amplitude, thickness, phase, heavyAbove, waves;
        void main() {
            vec2 p = gl_FragCoord.xy * h;
            float interfaceY = 0.5 * float(grid.y) * h + amplitude * cos(6.28318530718 * waves * p.x / (float(grid.x) * h) + phase);
            float c = smoothstep(-thickness, thickness, p.y - interfaceY);
            color = vec4(heavyAbove > 0.5 ? c : 1.0-c, 0, 0, 1);
        }`,initialVelocity:o+`
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
        }`,material:o+`
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
        }`,momentum:o+`
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
        }`,divergence:o+`
        uniform sampler2D velocity;
        void main() {
            ivec2 i = ivec2(gl_FragCoord.xy);
            color = vec4((face(velocity,i+ivec2(1,0),0)-face(velocity,i,0)
                        +face(velocity,i+ivec2(0,1),1)-face(velocity,i,1))/h,0,0,1);
        }`,smooth:o+`
        uniform sampler2D pressure, rhs, material;
        void main() {
            ivec2 i=ivec2(gl_FragCoord.xy), l=i-ivec2(1,0), r=i+ivec2(1,0), b=i-ivec2(0,1), t=i+ivec2(0,1);
            float al=inverseFace(material,i,l), ar=inverseFace(material,i,r);
            float ab=i.y>0 ? inverseFace(material,i,b) : 0.0;
            float at=i.y<grid.y-1 ? inverseFace(material,i,t) : 0.0;
            float next=(al*scalar(pressure,l)+ar*scalar(pressure,r)+ab*scalar(pressure,b)+at*scalar(pressure,t)
                       -h*h*scalar(rhs,i))/(al+ar+ab+at);
            color=vec4(mix(scalar(pressure,i),next,0.6666666667),0,0,1);
        }`,residual:o+`
        uniform sampler2D pressure, rhs, material;
        void main() {
            ivec2 i=ivec2(gl_FragCoord.xy), l=i-ivec2(1,0), r=i+ivec2(1,0), b=i-ivec2(0,1), t=i+ivec2(0,1);
            float p=scalar(pressure,i);
            float lap=inverseFace(material,i,l)*(scalar(pressure,l)-p)+inverseFace(material,i,r)*(scalar(pressure,r)-p);
            if(i.y>0) lap+=inverseFace(material,i,b)*(scalar(pressure,b)-p);
            if(i.y<grid.y-1) lap+=inverseFace(material,i,t)*(scalar(pressure,t)-p);
            color=vec4(scalar(rhs,i)-lap/(h*h),0,0,1);
        }`,restrict:o+`
        uniform sampler2D source;
        void main() {
            ivec2 i=ivec2(gl_FragCoord.xy)*2;
            color=vec4(0.25*(texelFetch(source,i,0).r+texelFetch(source,i+ivec2(1,0),0).r
                +texelFetch(source,i+ivec2(0,1),0).r+texelFetch(source,i+ivec2(1,1),0).r),0,0,1);
        }`,prolong:o+`
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
        }`,project:o+`
        uniform sampler2D pressure, velocity, material;
        void main() {
            ivec2 i=ivec2(gl_FragCoord.xy), u=ivec2(i.x,min(i.y,grid.y-1));
            float x=face(velocity,u,0)-inverseFace(material,u-ivec2(1,0),u)*(scalar(pressure,u)-scalar(pressure,u-ivec2(1,0)))/h;
            float y=0.0;
            if(i.y>0 && i.y<grid.y) y=face(velocity,i,1)-inverseFace(material,i-ivec2(0,1),i)*(scalar(pressure,i)-scalar(pressure,i-ivec2(0,1)))/h;
            color=vec4(x,y,0,1);
        }`,diagnostics:o+`
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
        }`,reduce:o+`
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
        }`,snapshot:o+`
        uniform sampler2D material;
        void main() {
            float value = floor(clamp(scalar(material,ivec2(gl_FragCoord.xy)),0.0,1.0)*65535.0+0.5);
            color = vec4(floor(value/256.0),mod(value,256.0),0.0,255.0)/255.0;
        }`,display:o+`
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
        }`},c=class{constructor(e,t=128,n={}){this.layout=r(t,n),this.canvas=e,this.config=this.layout.cfg;let a=this.config;if(this.nx=this.layout.nx,this.ny=this.layout.ny,this.h=this.layout.h,this.history=[],this.historyLimit=this.layout.historyLimit,this.historyError=``,this.viewIndex=-1,this.palette=i[`red-blue`],this.canvas.style.aspectRatio=`${this.nx} / ${this.ny}`,this.time=0,this.steps=0,this.stats=new Float32Array(4),this.targets=[],this.programs={},this.levels=[],this.reductions=[],this.gl=e.getContext(`webgl2`,{alpha:!1,antialias:!1,depth:!1,stencil:!1,preserveDrawingBuffer:!1}),!this.gl)throw Error(`WebGL 2 is unavailable on this device.`);let o=this.gl;try{if(!o.getExtension(`EXT_color_buffer_float`))throw Error(`This device cannot use the required floating-point graphics buffers.`);o.disable(o.BLEND),o.disable(o.DITHER),o.disable(o.DEPTH_TEST),this.vao=o.createVertexArray(),o.bindVertexArray(this.vao);for(let[e,t]of Object.entries(s))this.programs[e]=this.program(t);this.velocity=this.pair(this.nx,this.ny+1,2),this.material=this.pair(this.nx,this.ny,1),this.materialStage=this.target(this.nx,this.ny,1);for(let e of this.layout.levels){let{width:t,height:n}=e;this.levels.push({...e,pressure:this.pair(t,n,1),rhs:this.target(t,n,1),residual:this.target(t,n,1),material:this.levels.length?this.target(t,n,1):this.material.read})}for(let e=this.nx,t=this.ny;this.reductions.push(this.target(e,t,4)),!(e===1&&t===1);e=Math.ceil(e/2),t=Math.ceil(t/2));this.draw(`initial`,this.material.read,{},{amplitude:a.amplitude*a.width/a.waves,waves:a.waves,thickness:a.thickness,phase:a.phase,heavyAbove:+!!a.heavyAbove}),this.draw(`initialVelocity`,this.velocity.read,{},{shear:a.shear,shearThickness:a.shearThickness,amplitude:a.amplitude,waves:a.waves,phase:a.phase}),this.measure(this.velocity.read),this.initialMass=this.stats[3],this.captureSnapshot(),this.render()}catch(e){throw this.dispose(),e}}program(e){let t=this.gl,n=[],r;try{for(let[r,i]of[[t.VERTEX_SHADER,a],[t.FRAGMENT_SHADER,e]]){let e=t.createShader(r);if(n.push(e),t.shaderSource(e,i),t.compileShader(e),!t.getShaderParameter(e,t.COMPILE_STATUS))throw Error(t.getShaderInfoLog(e))}if(r=t.createProgram(),n.forEach(e=>t.attachShader(r,e)),t.linkProgram(r),!t.getProgramParameter(r,t.LINK_STATUS))throw Error(t.getProgramInfoLog(r));let i={};for(let e=0;e<t.getProgramParameter(r,t.ACTIVE_UNIFORMS);e++){let n=t.getActiveUniform(r,e).name;i[n]=t.getUniformLocation(r,n)}return{program:r,uniforms:i}}catch(e){throw r&&t.deleteProgram(r),e}finally{n.forEach(e=>t.deleteShader(e))}}target(e,t,n,r=!1){let i=this.gl,a=`The simulation buffers could not be allocated. Try the lower resolution.`,o={texture:null,framebuffer:null,width:e,height:t,channels:n,bytes:e*t*(r?2:n*4)};this.targets.push(o);try{o.texture=i.createTexture(),o.framebuffer=i.createFramebuffer();let{texture:s,framebuffer:c}=o;if(!s||!c)throw i.getError(),Error(a);i.bindTexture(i.TEXTURE_2D,s);for(let e of[i.TEXTURE_MIN_FILTER,i.TEXTURE_MAG_FILTER])i.texParameteri(i.TEXTURE_2D,e,i.NEAREST);for(let e of[i.TEXTURE_WRAP_S,i.TEXTURE_WRAP_T])i.texParameteri(i.TEXTURE_2D,e,i.CLAMP_TO_EDGE);let l=r?i.RG8:n===1?i.R32F:n===2?i.RG32F:i.RGBA32F,u=n===1?i.RED:n===2?i.RG:i.RGBA;i.texImage2D(i.TEXTURE_2D,0,l,e,t,0,u,r?i.UNSIGNED_BYTE:i.FLOAT,null),i.bindFramebuffer(i.FRAMEBUFFER,c),i.framebufferTexture2D(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0,i.TEXTURE_2D,s,0);let d=i.checkFramebufferStatus(i.FRAMEBUFFER)===i.FRAMEBUFFER_COMPLETE;this.clear(o);let f=i.getError();if(!d||f!==i.NO_ERROR)throw Error(a);return o}catch(e){throw this.release(o),e}}release(e){e.texture&&this.gl.deleteTexture(e.texture),e.framebuffer&&this.gl.deleteFramebuffer(e.framebuffer);let t=this.targets.indexOf(e);t>=0&&this.targets.splice(t,1)}pair(e,t,n){return{read:this.target(e,t,n),write:this.target(e,t,n)}}swap(e){[e.read,e.write]=[e.write,e.read]}clear(e){let t=this.gl;t.bindFramebuffer(t.FRAMEBUFFER,e.framebuffer),t.clearColor(0,0,0,0),t.clear(t.COLOR_BUFFER_BIT)}draw(e,t,n={},r={},i=this.layout.levels[0]){let a=this.gl,o=this.programs[e];a.useProgram(o.program);let s={grid:[i.width,i.height],h:i.h,dt:0,atwood:this.config.atwood,...r},c=0;for(let[e,t]of Object.entries(n))a.activeTexture(a.TEXTURE0+c),a.bindTexture(a.TEXTURE_2D,t.texture),a.uniform1i(o.uniforms[e],c++);for(let[e,t]of Object.entries(s))o.uniforms[e]!=null&&(e===`grid`?a.uniform2i(o.uniforms[e],...t):Array.isArray(t)&&t.length===3?a.uniform3f(o.uniforms[e],...t):Array.isArray(t)?a.uniform2f(o.uniforms[e],...t):a.uniform1f(o.uniforms[e],t));a.bindFramebuffer(a.FRAMEBUFFER,t?t.framebuffer:null),a.viewport(0,0,t?t.width:this.canvas.width,t?t.height:this.canvas.height),a.drawArrays(a.TRIANGLES,0,3)}smooth(e,t){for(let n=0;n<t;n++)this.draw(`smooth`,e.pressure.write,{pressure:e.pressure.read,rhs:e.rhs,material:e.material},{},e),this.swap(e.pressure)}cycle(e=0){let t=this.levels[e];if(e===this.levels.length-1){this.smooth(t,Math.max(40,Math.ceil(Math.max(t.width,t.height)**2/4)));return}this.smooth(t,4),this.draw(`residual`,t.residual,{pressure:t.pressure.read,rhs:t.rhs,material:t.material},{},t);let n=this.levels[e+1];this.draw(`restrict`,n.rhs,{source:t.residual},{},n),this.clear(n.pressure.read),this.cycle(e+1),this.draw(`prolong`,t.pressure.write,{pressure:t.pressure.read,coarse:n.pressure.read},{},t),this.swap(t.pressure),this.smooth(t,4)}measure(e){this.draw(`diagnostics`,this.reductions[0],{velocity:e,material:this.material.read});for(let e=1;e<this.reductions.length;e++)this.draw(`reduce`,this.reductions[e],{source:this.reductions[e-1]});let t=this.gl;if(this.stats.fill(NaN),t.readPixels(0,0,1,1,t.RGBA,t.FLOAT,this.stats),this.stats.some(e=>!Number.isFinite(e)))throw Error(`Graphics diagnostics could not be read. Reset to start again.`);if(this.stats.some(e=>e<0)||this.stats[3]===0)throw Error(`The simulation stopped after a numerical error. Reset to start again.`)}nextDt(){let e=this.h,t=this.config,n=Math.abs(t.gravity)*t.atwood/(1-t.atwood),r=this.stats[0]+this.stats[1],i=2*t.cfl*e/(r+Math.sqrt(r*r+4*n*t.cfl*e)+1e-12),a=t.viscosity>0?.2*e*e/(2*t.viscosity):1/0,o=Math.min(t.maxDt,i,a);return this.recording&&(o=Math.min(o,this.history.length*t.saveInterval-this.time)),o}step(e=this.nextDt()){if(e=Math.min(e,this.nextDt()),!Number.isFinite(e)||e<=0)throw Error(`The timestep could not be calculated. Reset to start again.`);this.draw(`material`,this.materialStage,{source:this.material.read,original:this.material.read,velocity:this.velocity.read},{dt:e,stage:0}),this.draw(`material`,this.material.write,{source:this.materialStage,original:this.material.read,velocity:this.velocity.read},{dt:e,stage:1}),this.swap(this.material),this.levels[0].material=this.material.read;for(let e=1;e<this.levels.length;e++)this.draw(`restrict`,this.levels[e].material,{source:this.levels[e-1].material},{},this.levels[e]);this.draw(`momentum`,this.velocity.write,{velocity:this.velocity.read,material:this.material.read},{dt:e,gravity:this.config.gravity,viscosity:this.config.viscosity}),this.swap(this.velocity),this.draw(`divergence`,this.levels[0].rhs,{velocity:this.velocity.read});let t=0;do this.cycle(),t++,this.draw(`project`,this.velocity.write,{velocity:this.velocity.read,pressure:this.levels[0].pressure.read,material:this.material.read}),this.measure(this.velocity.write);while(this.stats[2]*e>this.config.pressureTolerance&&t<6);if(this.stats[2]*e>.002)throw Error(`The pressure solve could not settle. Reset or try the lower resolution.`);if(this.swap(this.velocity),this.time+=e,this.steps++,this.lastCycles=t,Math.abs(this.stats[3]-this.initialMass)/this.initialMass>.02)throw Error(`Material balance changed too much. Reset to start a new run.`);this.recording&&this.time>=this.history.length*this.config.saveInterval-1e-10&&(this.time=this.history.length*this.config.saveInterval,this.captureSnapshot())}get recording(){return!this.historyError&&this.history.length<this.historyLimit}get displayedTime(){return this.viewIndex<0?this.time:this.history[this.viewIndex].time}captureSnapshot(){if(!this.recording)return;let e;try{if(e=this.target(this.nx,this.ny,2,!0),this.draw(`snapshot`,e,{material:this.material.read}),this.gl.getError()!==this.gl.NO_ERROR)throw Error(`Snapshot storage is unavailable.`);this.history.push({time:this.time,field:e})}catch{e&&this.release(e),this.historyError=`Snapshot recording stopped. The live simulation can continue.`}}showSnapshot(e){!Number.isInteger(e)||e<0||e>=this.history.length||(this.viewIndex=e,this.render())}showLive(){this.viewIndex=-1,this.render()}render(){let e=this.canvas.getBoundingClientRect(),t=Math.min(globalThis.devicePixelRatio||1,2),n=Math.max(2,Math.round(e.width*t)),r=Math.max(4,Math.round(e.height*t));(this.canvas.width!==n||this.canvas.height!==r)&&(this.canvas.width=n,this.canvas.height=r);let i=this.viewIndex<0?this.material.read:this.history[this.viewIndex].field;this.draw(`display`,null,{material:i},{viewport:[n,r],isSnapshot:this.viewIndex<0?0:1,lightColor:this.palette.light,heavyColor:this.palette.heavy})}dispose(){let e=this.gl;if(e){for(let t of this.targets)e.deleteTexture(t.texture),e.deleteFramebuffer(t.framebuffer);for(let t of Object.values(this.programs))e.deleteProgram(t.program);this.vao&&e.deleteVertexArray(this.vao),this.targets=[],this.programs={},this.history=[],this.viewIndex=-1}}};function l(){let a=document.getElementById(`kh-canvas`);if(!a)return;let o=e=>document.getElementById(e),s=(e,t)=>{e.textContent!==t&&(e.textContent=t)},l=e=>e.toLocaleString(`en-US`,{minimumFractionDigits:2,maximumFractionDigits:6,useGrouping:!1}),u=o(`kh-run`),d=o(`kh-reset`),f=o(`kh-status`),p=o(`kh-setup`),m=o(`kh-resolution`),h=o(`kh-waves`),g=o(`kh-atwood`),_=o(`kh-amplitude`),v=o(`kh-acceleration`),y=o(`kh-shear`),ee=o(`kh-interval`),b=o(`kh-limit`),x=o(`kh-palette`),S=o(`kh-zoom`),C=o(`kh-arrangement`),w=o(`kh-viscosity`),T=o(`kh-thickness`),E=o(`kh-scrub`),te=o(`kh-live`),ne=o(`kh-time`),D=o(`kh-fps`),O=o(`kh-viewport`),k=o(`kh-advance`),A,j,M=!1,N=!1,P=!1,F=!1,I=``,L=0,R=0,z=0,B=0,V=0,H=0,U=0,W=null;o(`kh-width`)?.closest(`.kh-wide`)?.remove(),o(`kh-wavelength`).setAttribute(`for`,`kh-waves`),m.value=(window.matchMedia?window.matchMedia(`(max-width: 48rem)`).matches:window.innerWidth<=768)?`128`:`192`,h.value=String(e.waves),g.value=String(e.atwood),_.value=String(e.amplitude),y.value=String(e.shear),v.value=String(Math.abs(e.gravity)),C.value=e.heavyAbove?`above`:`below`,w.value=String(e.viscosity),T.value=String(2*e.thickness),S.value=`1`;function G(){return{resolution:Number(m.value),width:e.width,waves:h.valueAsNumber,atwood:g.valueAsNumber,amplitude:_.valueAsNumber,gravity:-v.valueAsNumber,shear:y.valueAsNumber,saveInterval:ee.valueAsNumber,maxSnapshots:b.valueAsNumber,heavyAbove:C.value===`above`,viscosity:Number(w.value),thickness:Number(T.value)/2}}function K(){M=!1,W=null,cancelAnimationFrame(L),L=0,R=0,z=0,D.textContent=``}function q(){let e=A&&A.viewIndex>=0;s(u,M?`Pause`:e?`Run Live`:`Run`),u.setAttribute(`aria-pressed`,String(M)),u.disabled=!A||P||N||F||!!I,d.disabled=P||!!I,k.disabled=!A||M||P||N||F||!!I||!A.recording,s(k,e?`Next live snapshot`:`Next snapshot`),s(d,F?`Apply & Reset`:`Reset`),o(`kh-pending`).hidden=!F;let t=A?.history.length||0;E.max=String(Math.max(0,t-1)),E.disabled=t<2||P,E.value=String(e?A.viewIndex:Math.max(0,t-1)),s(ne,l(A?.displayedTime||0)),E.setAttribute(`aria-valuetext`,e?`Saved time ${ne.textContent}`:`Live state`),te.disabled=!e||P,s(o(`kh-view-state`),e?`Saved`:`Live`),s(o(`kh-saved`),A?`${t} / ${A.historyLimit} snapshots${!A.recording&&!A.historyError?` · Full`:``}`:`No snapshots`),!(N||P)&&s(f,A?.historyError||(I?`Check settings`:F?`Changes ready`:W===null?M?`Running`:e?`Snapshot ${A.viewIndex+1} of ${t}`:A?.steps?`Paused`:`Ready`:`Advancing to next snapshot`))}function J(e){K(),N=!0,f.textContent=e.message,f.dataset.error=`true`,q()}function Y(){let i=m.value;for(let n of t){let t=[...m.options].find(e=>Number(e.value)===n.value);t.textContent=`${n.label} (${n.value*e.width} × ${n.value*e.height})`}m.value=i,o(`kh-atwood-value`).textContent=g.valueAsNumber.toFixed(2),o(`kh-amplitude-value`).textContent=_.valueAsNumber.toFixed(3),o(`kh-acceleration-value`).textContent=v.valueAsNumber.toFixed(2),o(`kh-shear-value`).textContent=y.valueAsNumber.toFixed(2),o(`kh-waves-value`).textContent=h.value,o(`kh-wavelength`).textContent=(e.width/h.valueAsNumber).toFixed(3),F=!!(j&&JSON.stringify(G())!==JSON.stringify(j)),I=``;for(let e of p.querySelectorAll(`input, select`)){let t=e.validity.valid;e.setAttribute(`aria-invalid`,String(!t)),!t&&!I&&(I=`Check ${o(e.id+`-label`)?.textContent.toLowerCase()||`the highlighted setting`}.`)}try{if(I)throw Error(I);let e=G(),t=r(e.resolution,e);o(`kh-memory`).textContent=`${F?`Next run: `:``}≈ ${(t.totalBytes/1e6).toFixed(1)} MB`,o(`kh-memory-limit`).textContent=t.historyLimit<e.maxSnapshots?`${t.historyLimit} snapshots fit the ${(n/1e6).toFixed(1)} MB history budget.`:``,o(`kh-memory-limit`).hidden=t.historyLimit>=e.maxSnapshots,o(`kh-history-end`).textContent=`History through time ${l((t.historyLimit-1)*e.saveInterval)}`}catch(e){I=e.message,o(`kh-memory`).textContent=`—`,o(`kh-history-end`).textContent=``,o(`kh-memory-limit`).hidden=!0}s(o(`kh-input-error`),I),o(`kh-input-error`).hidden=!I,q()}function X(){if(!A||P)return;let e=O.clientWidth||O.getBoundingClientRect().width;if(!e)return;let t=window.visualViewport?.height||window.innerHeight,n=Math.min(e,.72*t*A.nx/A.ny);if(a.style.width=`${Math.max(2,n*Number(S.value))}px`,!M)try{A.render()}catch(e){J(e)}}function re(){if(!A||P)return;A.palette=i[x.value]||i[`red-blue`];let{heavy:e,light:t,names:n}=A.palette,r=e.map((e,n)=>(e+t[n])/2);for(let[n,i]of[[`heavy`,e],[`mixed`,r],[`light`,t]])document.querySelector(`.kh-${n}`).style.backgroundColor=`rgb(${i.map(e=>Math.round(255*e)).join(`,`)})`;a.setAttribute(`aria-label`,`Kelvin-Helmholtz material field. ${n[0]} is material A and ${n[1]} is material B. Blended colors show intermediate material fractions.`);try{A.render()}catch(e){J(e)}}function Z(){if(Y(),!(I||P)){K(),N=!1,A?.dispose(),A=null,z=0,B=0,delete f.dataset.error,f.textContent=`Preparing simulation…`;try{let e=G();A=new c(a,e.resolution,e),j=e,F=!1,X(),re(),Y()}catch(e){J(e)}q()}}function Q(e){if(L=0,!M||P)return;if(document.hidden){R=0,z=0,V=0,H=e,U=A.time,L=requestAnimationFrame(Q);return}let t=R?Math.min((e-R)/1e3,.05):0;R=e,z+=t;let n=performance.now(),r=0;try{for(;r<16&&(r===0||performance.now()-n+B<18);){let e=A.nextDt();if(W===null&&z+1e-12<e)break;W!==null&&(e=Math.min(e,W-A.time));let t=performance.now();if(A.step(e),B=performance.now()-t,z=Math.max(0,z-e),r++,W!==null&&(A.time>=W-1e-10||!A.recording)){K();break}}z=Math.min(z,A.nextDt()),A.render(),V++,M&&e-H>500&&(D.textContent=`${Math.round(V*1e3/(e-H))} FPS`,D.title=`${((A.time-U)*1e3/(e-H)).toFixed(2)} simulation time units per second`,H=e,U=A.time,V=0),q(),M&&(L=requestAnimationFrame(Q))}catch(e){J(e)}}function ie(e=null){if(!(!A||P||N||F||I))try{A.showLive(),M=!0,W=e,R=0,z=0,H=performance.now(),U=A.time,V=0,q(),L=requestAnimationFrame(Q)}catch(e){J(e)}}u.addEventListener(`click`,()=>{M?(K(),q()):ie()}),k.addEventListener(`click`,()=>{!M&&A?.recording&&ie(A.history.length*A.config.saveInterval)}),d.addEventListener(`click`,Z);for(let e of[m,h,g,_,v,y,ee,b,C,w,T])e.addEventListener(e.tagName===`SELECT`?`change`:`input`,()=>{K(),Y()});x.addEventListener(`change`,re),S.addEventListener(`change`,X),E.addEventListener(`input`,()=>{if(!(!A||P)){K();try{A.showSnapshot(Number(E.value)),q()}catch(e){J(e)}}}),te.addEventListener(`click`,()=>{if(!(!A||P))try{A.showLive(),q()}catch(e){J(e)}});let $=new ResizeObserver(X);$.observe(O),window.addEventListener(`resize`,X),window.visualViewport?.addEventListener(`resize`,X),a.addEventListener(`webglcontextlost`,e=>{e.preventDefault(),P=!0,J(Error(`Graphics interrupted. Waiting for the device to recover.`)),p.disabled=!0,x.disabled=!0,S.disabled=!0}),a.addEventListener(`webglcontextrestored`,()=>{P=!1,p.disabled=!1,x.disabled=!1,S.disabled=!1,Z()}),window.addEventListener(`pagehide`,()=>{K(),$.disconnect(),A?.dispose(),A=null}),window.addEventListener(`pageshow`,e=>{e.persisted&&($.observe(O),Z())}),Z()}typeof document<`u`&&l();