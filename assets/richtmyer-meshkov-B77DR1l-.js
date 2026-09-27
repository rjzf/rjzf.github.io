import"./modulepreload-polyfill-Ke7zwH0v.js";/* empty css              */function e(){let e=1.4,t=192*1e3*1e3,n=Object.freeze({mach:2,cfl:.35,atwood:.5,amplitude:.08,waves:2,width:.025,frame:`contact`,direction:`light-heavy`,length:4,saveInterval:.25,maxSnapshots:30}),r={"red-blue":{heavy:[.96,.08,.12],light:[.08,.24,.98],names:[`Red`,`blue`]},"orange-blue":{heavy:[230/255,159/255,0],light:[0,114/255,178/255],names:[`Orange`,`blue`]},"magenta-teal":{heavy:[204/255,121/255,167/255],light:[0,158/255,115/255],names:[`Magenta`,`teal`]},"black-white":{heavy:[0,0,0],light:[1,1,1],names:[`Black`,`white`]},"navy-gold":{heavy:[24/255,45/255,85/255],light:[250/255,195/255,50/255],names:[`Navy`,`gold`]},"purple-mint":{heavy:[106/255,52/255,163/255],light:[146/255,235/255,192/255],names:[`Purple`,`mint`]}};function i(t={}){let r={...n,...t};for(let[e,t,n]of[[`mach`,1.1,2.5],[`atwood`,0,.8],[`amplitude`,0,.15],[`waves`,1,4],[`width`,.0125,.075],[`saveInterval`,.01,1],[`maxSnapshots`,2,50],[`cfl`,.05,.5]])if(!Number.isFinite(r[e])||r[e]<t||r[e]>n)throw Error(`Use ${e} from ${t} to ${n}.`);if(!Number.isInteger(r.waves)||!Number.isInteger(r.maxSnapshots))throw Error(`Waves and snapshots must be whole numbers.`);if(![`contact`,`lab`].includes(r.frame)||![4,8].includes(r.length))throw Error(`Choose a supported frame and domain.`);if(r.contrast=(1+r.atwood)/(1-r.atwood),![`light-heavy`,`heavy-light`].includes(r.direction))throw Error(`Choose a shock direction.`);r.incidentDensity=r.direction===`heavy-light`?r.contrast:1,r.targetDensity=r.direction===`heavy-light`?1:r.contrast,r.shockSpeed=r.mach*Math.sqrt(e/r.incidentDensity);let i=(e+1)*r.mach**2/((e-1)*r.mach**2+2);return r.postShock=[i*r.incidentDensity,r.shockSpeed*(1-1/i),0,1+2*e/(e+1)*(r.mach**2-1),+(r.direction===`heavy-light`)],r.impactTime=.9/r.shockSpeed,r}function a(t={}){let n=i(t),r=n.postShock,a=[n.targetDensity,0,0,1,n.direction===`heavy-light`?0:1],o=e-1;function s(t,n){return t>n[3]?(t-n[3])*Math.sqrt(2/((e+1)*n[0])/(t+o/(e+1)*n[3])):2*Math.sqrt(e*n[3]/n[0])/o*((t/n[3])**(o/(2*e))-1)}let c=1e-12,l=Math.max(10,r[3]*4),u=80;for(;u>0;){let e=(c+l)/2;s(e,r)+s(e,a)-r[1]>0?l=e:c=e,--u}let d=(c+l)/2,f=t=>{let n=d/t[3],r=o/(e+1);return t[0]*(n>1?(n+r)/(r*n+1):n**(1/e))};return{speed:.5*(r[1]+s(d,a)-s(d,r)),pressure:d,leftDensity:f(r),rightDensity:f(a)}}function o(e={}){return a(e).speed}function s(e={}){let t=i(e),n=a(t);return{density:[0,1.2*Math.max(t.contrast,t.postShock[0],n.leftDensity,n.rightDensity)],pressure:[0,1.2*Math.max(1,t.postShock[3],n.pressure)]}}function c(t,n={}){if(![64,128,256,512,1024].includes(t))throw Error(`Choose a supported resolution.`);let r=i(n),a=t/4,s=a*r.length,c=1/a,l=-(r.length-4)/2,u=r.frame===`contact`?o(r):0,d=new Float32Array(s*a*5),f=0;for(;f<s*a;){let t=l+(f%s+.5)*c,n=(Math.floor(f/s)+.5)*c,i=r.amplitude/r.waves*Math.cos(2*Math.PI*r.waves*n),a=.5*(1+Math.tanh((t-1.5-i)/r.width)),o=r.direction===`heavy-light`?1-a:a,[p,m,,h,g]=t<.6?r.postShock:[1+(r.contrast-1)*o,0,0,1,o],_=m-u;d.set([p,p*_,0,h/(e-1)+.5*p*_*_,p*g],5*f),f+=1}return{nx:s,ny:a,dx:c,dy:c,origin:l,length:r.length,frameSpeed:u,impactTime:r.impactTime,config:r,U:d}}let l=`#version 300 es
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
`;l+``,l+``,l+``,l+``;class u{constructor(e,t=256,n={}){this.canvas=e;let r=e.getContext(`webgl2`,{antialias:!1,depth:!1,stencil:!1});if(this.gl=r,!r||!r.getExtension(`EXT_color_buffer_float`))throw Error(`This simulation requires WebGL 2 with floating-point targets.`);this.resources=[],this.programs=[];try{this.faceProgram=this.program(`#version 300 es
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
}`),this.updateProgram=this.program(`#version 300 es
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
}`),this.metricProgram=this.program(`#version 300 es
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
}`),this.reduceProgram=this.program(`#version 300 es
precision highp float;precision highp int;precision highp sampler2D;
uniform sampler2D source;uniform ivec2 sourceSize;out vec4 color;
void main(){ivec2 p=ivec2(gl_FragCoord.xy)*4;color=vec4(-1e30);
for(int y=0;y<4;y++)for(int x=0;x<4;x++){ivec2 q=p+ivec2(x,y);if(all(lessThan(q,sourceSize)))color=max(color,texelFetch(source,q,0));}}
`),this.displayProgram=this.program(`#version 300 es
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
}`),this.copyProgram=this.program(l+`
layout(location=0) out vec4 outA;
layout(location=1) out vec4 outC;
void main() {
  S s = state(ivec2(gl_FragCoord.xy));
  outA = s.a;
  outC = texelFetch(stateC, cell(ivec2(gl_FragCoord.xy)), 0);
}`),this.reset(t,n)}catch(e){throw this.dispose(),e}}reset(e,t={}){let n=c(e,t),r=this.nx!==n.nx||this.ny!==n.ny;for(let e of[`nx`,`ny`,`dx`,`dy`,`config`,`origin`,`length`,`frameSpeed`,`impactTime`])this[e]=n[e];this.scales=s(this.config),this.time=0,this.steps=0,this.stats={retries:0};let i=this.gl;if(this.nx+1>i.getParameter(i.MAX_TEXTURE_SIZE)||i.getParameter(i.MAX_DRAW_BUFFERS)<2)throw Error(`The selected grid exceeds this GPU’s limits.`);if(r){for(let e of[...this.resources])this.release(e);this.live=this.target(this.nx,this.ny),this.A=this.target(this.nx,this.ny),this.B=this.target(this.nx,this.ny),this.fx=this.target(this.nx+1,this.ny),this.fy=this.target(this.nx,this.ny),this.reductions=[];let e=Math.ceil(this.nx/4),t=Math.ceil(this.ny/4);for(;this.reductions.push(this.target(e,t,1)),!(e===1&&t===1);)e=Math.ceil(e/4),t=Math.ceil(t/4)}this.upload(n.U),this.metrics=this.measure(this.live)}program(e){let t=this.gl,n=t.createProgram();for(let[r,i]of[[t.VERTEX_SHADER,`#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`],[t.FRAGMENT_SHADER,e]]){let e=t.createShader(r);if(t.shaderSource(e,i),t.compileShader(e),!t.getShaderParameter(e,t.COMPILE_STATUS)){let r=t.getShaderInfoLog(e);throw t.deleteShader(e),t.deleteProgram(n),Error(r)}t.attachShader(n,e),t.deleteShader(e)}if(t.linkProgram(n),!t.getProgramParameter(n,t.LINK_STATUS)){let e=t.getProgramInfoLog(n);throw t.deleteProgram(n),Error(e)}let r={},i=0;for(;i<t.getProgramParameter(n,t.ACTIVE_UNIFORMS);){let e=t.getActiveUniform(n,i);r[e.name]={location:t.getUniformLocation(n,e.name),type:e.type},i+=1}let a={p:n,uniforms:r};return this.programs.push(a),a}target(e,t,n=2){let r=this.gl;if(r.isContextLost())throw Error(`Graphics context lost. Reset to restart.`);let i=r.createFramebuffer(),a=[];r.bindFramebuffer(r.FRAMEBUFFER,i);let o={w:e,h:t,fbo:i,textures:a};this.resources.push(o);try{if(!i)throw Error(`GPU framebuffer allocation failed.`);for(;a.length<n;){let n=r.createTexture();if(!n)throw Error(`GPU texture allocation failed.`);a.push(n),r.bindTexture(r.TEXTURE_2D,n),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_MIN_FILTER,r.NEAREST),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_MAG_FILTER,r.NEAREST),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_WRAP_S,r.CLAMP_TO_EDGE),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_WRAP_T,r.CLAMP_TO_EDGE),r.texStorage2D(r.TEXTURE_2D,1,r.RGBA32F,e,t),r.framebufferTexture2D(r.FRAMEBUFFER,r.COLOR_ATTACHMENT0+a.length-1,r.TEXTURE_2D,n,0)}r.drawBuffers(a.map((e,t)=>r.COLOR_ATTACHMENT0+t));let s=r.checkFramebufferStatus(r.FRAMEBUFFER),c=r.getError();if(r.isContextLost())throw Error(`Graphics context lost. Reset to restart.`);if(c===r.OUT_OF_MEMORY)throw Error(`GPU memory allocation failed.`);if(c!==r.NO_ERROR)throw Error(`GPU texture allocation failed (WebGL error ${c}).`);if(s!==r.FRAMEBUFFER_COMPLETE)throw Error(`GPU framebuffer is incomplete (status ${s}).`);return o}catch(e){throw this.release(o),e}}release(e){e&&(e.textures.forEach(e=>this.gl.deleteTexture(e)),this.gl.deleteFramebuffer(e.fbo),this.resources=this.resources.filter(t=>t!==e))}draw(e,t,n={}){let r=this.gl;if(r.isContextLost())throw Error(`Graphics context lost. Reset to restart.`);r.bindFramebuffer(r.FRAMEBUFFER,t?.fbo??null),r.viewport(0,0,t?.w??this.canvas.width,t?.h??this.canvas.height),r.useProgram(e.p);let i={grid:[this.nx,this.ny],h:this.dx,...n},a=0;for(let[t,n]of Object.entries(e.uniforms)){let e=i[t];if(e===void 0)throw Error(`Missing GPU uniform `+t);n.type===r.SAMPLER_2D?(r.activeTexture(r.TEXTURE0+a),r.bindTexture(r.TEXTURE_2D,e),r.uniform1i(n.location,a),a+=1):n.type===r.INT?r.uniform1i(n.location,e):n.type===r.INT_VEC2?r.uniform2iv(n.location,e):n.type===r.FLOAT_VEC2?r.uniform2fv(n.location,e):n.type===r.FLOAT_VEC3?r.uniform3fv(n.location,e):r.uniform1f(n.location,e)}r.drawArrays(r.TRIANGLES,0,3)}bindings(e){return{stateA:e.textures[0],stateC:e.textures[1]}}upload(e){let t=this.gl,n=new Float32Array(this.nx*this.ny*4),r=new Float32Array(n.length),i=0;for(;i<this.nx*this.ny;)n.set(e.subarray(5*i,5*i+4),4*i),r[4*i]=e[5*i+4],r[4*i+1]=e[5*i]-e[5*i+4],i+=1;for(let[e,i]of[n,r].entries())t.bindTexture(t.TEXTURE_2D,this.live.textures[e]),t.texSubImage2D(t.TEXTURE_2D,0,0,0,this.nx,this.ny,t.RGBA,t.FLOAT,i)}measure(e){this.draw(this.metricProgram,this.reductions[0],this.bindings(e));let t=1;for(;t<this.reductions.length;){let e=this.reductions[t-1];this.draw(this.reduceProgram,this.reductions[t],{source:e.textures[0],sourceSize:[e.w,e.h]}),t+=1}let n=this.gl,r=new Float32Array(4);if(n.bindFramebuffer(n.FRAMEBUFFER,this.reductions.at(-1).fbo),n.readBuffer(n.COLOR_ATTACHMENT0),n.readPixels(0,0,1,1,n.RGBA,n.FLOAT,r),n.getError()!==n.NO_ERROR||!r.every(Number.isFinite))throw Error(`GPU reduction failed.`);return r}stage(e,t,n,r,i){let a={...this.bindings(e),lowOrder:+!!i};this.draw(this.faceProgram,this.fx,{...a,axis:0}),this.draw(this.faceProgram,this.fy,{...a,axis:1}),this.draw(this.updateProgram,t,{...this.bindings(e),fxA:this.fx.textures[0],fxC:this.fx.textures[1],fyA:this.fy.textures[0],fyC:this.fy.textures[1],originalA:this.live.textures[0],originalC:this.live.textures[1],dt:n,stage:r})}step(e=1/0){if(this.metrics[1]!==0)throw Error(`Invalid GPU initial state.`);let t=Math.min(this.config.cfl/this.metrics[0],e);if(!(t>0))throw Error(`Invalid GPU timestep.`);let n=0,r=0;for(;n<12;){let e=n>0;this.stage(this.live,this.A,t,0,e),this.stage(this.A,this.B,t,1,e);let i=this.measure(this.B);if(r=i[1],r===0){let e=this.live;return this.live=this.B,this.B=e,this.metrics=i,this.time+=t,this.steps+=1,t}this.stats.retries+=1,n>0&&(t*=.5),n+=1}let i=[`Validity`,`Material fraction`,`Pressure`,`Density`,`Finite state`];throw Object.assign(Error(`${i[r]??i[0]} check failed after timestep retries. The last valid state is retained.`),{numerical:!0})}snapshot(){let e=this.target(this.nx,this.ny);try{this.draw(this.copyProgram,e,this.bindings(this.live));let t=this.gl.getError();if(t!==this.gl.NO_ERROR)throw Error(`Snapshot copy failed (WebGL error ${t}).`);return e}catch(t){throw this.release(e),t}}readState(e=this.live){let t=this.gl,n=new Float32Array(this.nx*this.ny*4),r=new Float32Array(n.length),i=new Float32Array(this.nx*this.ny*5);if(t.bindFramebuffer(t.FRAMEBUFFER,e.fbo),t.readBuffer(t.COLOR_ATTACHMENT0),t.readPixels(0,0,this.nx,this.ny,t.RGBA,t.FLOAT,n),t.readBuffer(t.COLOR_ATTACHMENT1),t.readPixels(0,0,this.nx,this.ny,t.RGBA,t.FLOAT,r),t.getError()!==t.NO_ERROR)throw Error(`GPU state readback failed.`);let a=0;for(;a<this.nx*this.ny;)i.set(n.subarray(4*a,4*a+4),5*a),i[5*a+4]=r[4*a],a+=1;return i}render(e,t){let{width:n,height:r,palette:i,overlay:a,field:o,start:s,cells:c}=t;this.canvas.width!==n&&(this.canvas.width=n),this.canvas.height!==r&&(this.canvas.height=r),this.draw(this.displayProgram,null,{...this.bindings(e??this.live),viewportSize:[n,r],lightColor:i.light,heavyColor:i.heavy,overlay:+!!a,field:{material:0,density:1,pressure:2}[o],fieldRange:this.scales[o]??[0,1],viewStart:s,viewWidth:c})}dispose(){for(let e of[...this.resources])this.release(e);for(let e of this.programs)this.gl.deleteProgram(e.p);this.programs=[]}}class d{constructor(e,n=30,r=()=>{}){this.limit=Math.min(n,Math.floor(t/e)),this.bytesPerSnapshot=e,this.release=r,this.items=[]}get recording(){return this.items.length<this.limit}get bytes(){return this.items.length*this.bytesPerSnapshot}add(e,t){if(!this.recording){this.release(t);return}this.items.push({id:this.items.length,time:e,state:t})}clear(){this.items.forEach(e=>this.release(e.state)),this.items=[]}}return{RMGPU:u,RMHistory:d,parameters:i,contactSpeed:o,fieldScales:s,initialState:c,PALETTES:r,HISTORY_BYTES:t}}var{RMGPU:t,RMHistory:n,parameters:r,contactSpeed:i,fieldScales:a,initialState:o,PALETTES:s,HISTORY_BYTES:c}=e();function l(e){let{RMGPU:t,RMHistory:n,PALETTES:r}=e(),i,a,o,s=-1,c=``,l=null,u=0,d=0,f=0,p={palette:`red-blue`,field:`material`,overlay:!0,width:1e3};function m(){return o.recording&&!c}function h(){return o.items.length*i.config.saveInterval}function g(){if(m())try{o.add(i.time,i.snapshot())}catch(e){if(i.gl.isContextLost())throw e;c=`Snapshot recording stopped: ${e.message}`}}function _(e,t=!0,n={}){let l=o.items.find(e=>e.id===s),g=l?.time??i.time;l||(s=-1);let _=i.config.frame===`contact`?2*i.ny:i.nx,v=1.5-i.frameSpeed*Math.min(g,i.impactTime),y=Math.max(0,Math.min(i.nx-_,(v-i.origin)*i.ny-_/2)),b=Math.max(64,Math.min(1600,Math.round(p.width))),x=Math.max(32,Math.round(b*i.ny/_)),S=r[p.palette]??r[`red-blue`],C;t&&(i.render(l?.state,{...p,width:b,height:x,palette:S,start:y,cells:_}),C=a.transferToImageBitmap(),f=performance.now()),self.postMessage({id:e,bitmap:C,viewTime:g,viewId:s,start:y,cells:_,time:i.time,impactTime:i.impactTime,scales:i.scales,nx:i.nx,ny:i.ny,origin:i.origin,frameSpeed:i.frameSpeed,history:o.items.map(({id:e,time:t})=>({id:e,time:t})),historyBytes:o.bytes,historyLimit:o.limit,historyError:c,recording:m(),nextTime:h(),computeMs:u,computeTime:d,...n},C?[C]:[])}self.onmessage=({data:e})=>{try{if(e.type===`reset`)o?.clear(),s=-1,c=``,l=null,u=0,d=0,i?i.reset(e.config.resolution,e.config):(a=new OffscreenCanvas(1e3,250),i=new t(a,e.config.resolution,e.config)),o=new n(i.nx*i.ny*32,i.config.maxSnapshots,e=>i.release(e)),p={...p,...e.display},g();else if(e.type===`advance`){if(l)throw l;s=-1;let t=performance.now(),n=i.time,r=e.target;if(!Number.isFinite(r)||r<i.time)throw Error(`Invalid target time.`);for(;i.time<r-1e-9&&performance.now()-t<25;){let e=m()?h():1/0;i.step(Math.min(r,e)-i.time),i.time>=e-1e-9&&g()}u+=performance.now()-t,d+=i.time-n}else if(e.type===`view`)s=e.viewId;else if(e.type===`display`)p={...p,...e.display};else throw Error(`Unknown worker command.`);let r=e.render!==`paced`||performance.now()-f>=1e3/30||i.time>=e.target-1e-9;_(e.id,r)}catch(t){if(t.numerical&&i&&!i.gl.isContextLost()){l=t;try{_(e.id,!0,{error:t.message,inspectable:!0});return}catch(e){t=e}}self.postMessage({id:e.id,error:t.message})}}}function u(){let t=`(${l.toString()})(${e.toString()})`,n=URL.createObjectURL(new Blob([t],{type:`text/javascript`})),r=new Worker(n);return r.addEventListener(`message`,()=>URL.revokeObjectURL(n),{once:!0}),r.addEventListener(`error`,()=>URL.revokeObjectURL(n),{once:!0}),{worker:r,url:n}}if(typeof document<`u`&&document.getElementById(`rm-canvas`)){let e=e=>document.getElementById(`rm-`+e),t=e(`canvas`),n=t.getContext(`2d`),i=[`atwood`,`mach`,`amplitude`,`waves`,`grid`,`width`,`cfl`,`direction`,`frame`,`domain`,`interval`,`limit`],a,o,l,d,f=!1,p=!1,m=!1,h=!1,g=``,_=!1,v=``,y=0,b=null,x=0,S=0,C=!1,w=null,T=0,E=0,D=0,O=0,k=null;function A(){return{atwood:e(`atwood`).valueAsNumber,mach:e(`mach`).valueAsNumber,amplitude:e(`amplitude`).valueAsNumber,waves:e(`waves`).valueAsNumber,resolution:Number(e(`grid`).value),width:Number(e(`width`).value),cfl:e(`cfl`).valueAsNumber,frame:e(`frame`).value,direction:e(`direction`).value,length:Number(e(`domain`).value),saveInterval:e(`interval`).valueAsNumber,maxSnapshots:e(`limit`).valueAsNumber}}function j(){return{palette:e(`palette`).value,field:e(`field`).value,overlay:e(`overlay`).checked,width:Math.round(e(`viewport`).clientWidth*Math.min(devicePixelRatio||1,2)*Number(e(`zoom`).value))}}function M(){f=!1,b=null,y=l?.time??0,x=0,E=0,C=!0}function N(){let t=l&&l.viewId>=0,n=m||_||!!v||!l;if(e(`run`).textContent=f?`Pause`:t?`Run Live`:`Run`,e(`run`).setAttribute(`aria-pressed`,String(f)),e(`run`).disabled=n,e(`reset`).textContent=_?`Apply & Reset`:`Reset`,e(`reset`).disabled=!!v,e(`advance`).disabled=n||f||!l?.recording,e(`advance`).textContent=t?`Next live snapshot`:`Next snapshot`,e(`impact`).disabled=n||f||l?.time>=l?.impactTime-1e-8,e(`live`).disabled=m&&!h||!t,e(`pending`).hidden=!_,e(`input-error`).textContent=v,e(`input-error`).hidden=!v,!l)return;let r=l.history;e(`scrub`).max=Math.max(0,r.length-1),e(`scrub`).disabled=m&&!h||r.length<2,e(`scrub`).value=t?Math.max(0,r.findIndex(e=>e.id===l.viewId)):r.length-1,e(`scrub`).setAttribute(`aria-valuetext`,t?`Saved time ${l.viewTime.toFixed(3)}`:`Live state`),e(`view-state`).textContent=t?`Saved`:`Live`,e(`time`).textContent=`t = ${l.viewTime.toFixed(3)}`;let i=l.viewTime-l.impactTime;e(`impact-time`).textContent=(Math.abs(i)<5e-4?0:i).toFixed(3),e(`saved`).textContent=`${r.length} / ${l.historyLimit} snapshots${l.recording?``:l.historyError?` - Stopped`:` - Full`}`,e(`memory`).textContent=`${(l.historyBytes/1e6).toFixed(1)} / ${c/1e6} MB`,e(`history-end`).textContent=`History through t = ${((l.historyLimit-1)*d.saveInterval).toFixed(2)}`;let a=s[e(`palette`).value],o=e(`field`).value,u=l.scales[o];e(`legend`).textContent=o===`material`?`${a.names[0]}: heavy - ${a.names[1]}: light - intermediate colors: mixed`:`${o===`density`?`Density`:`Pressure`}: ${a.names[1].toLowerCase()} ≤ ${u[0]} - ${a.names[0].toLowerCase()} ≥ ${u[1].toFixed(2)}`;let p=e=>`rgb(${e.map(e=>Math.round(e*255)).join(` `)})`,y=e(`material-legend`);y.style.setProperty(`--rm-heavy`,p(a.heavy)),y.style.setProperty(`--rm-light`,p(a.light)),y.style.setProperty(`--rm-mixed`,p(a.heavy.map((e,t)=>(e+a.light[t])/2))),y.hidden=e(`field`).value!==`material`,e(`field-legend`).hidden=!y.hidden,e(`field-legend`).textContent=y.hidden?e(`legend`).textContent:``;let x=l.origin+l.start/l.ny+l.frameSpeed*l.viewTime;e(`coordinates`).textContent=`Laboratory x = ${x.toFixed(2)} to ${(x+l.cells/l.ny).toFixed(2)}`,e(`fps`).textContent=f&&k!==null&&!document.hidden?`${k} FPS`:``,e(`status`).dataset.error=String(m||!!l.historyError),m?e(`status`).textContent=g:e(`status`).textContent=v?`Check settings`:_?`Changes ready`:document.hidden?`Paused while tab is hidden`:l.historyError||(b===null?f?`Running`:t?`Viewing saved state`:`Ready`:b===l.impactTime?`Advancing to nominal impact`:`Advancing to next snapshot`)}function P(){for(let[t,n]of[[`atwood`,2],[`mach`,1],[`amplitude`,2],[`waves`,0]])e(t+`-value`).value=e(t).valueAsNumber.toFixed(n);for(let t of e(`grid`).options){let n=Number(t.value)/4;t.textContent=`${t.textContent.split(` (`)[0]} (${n*Number(e(`domain`).value)} \u00d7 ${n})`}v=``;for(let t of i){let n=e(t).validity.valid;e(t).setAttribute(`aria-invalid`,String(!n)),!n&&!v&&(v=`Check the highlighted setting.`)}let t=A();try{r(t)}catch(e){v=e.message}_=!!(d&&JSON.stringify(t)!==JSON.stringify(d)),(_||v)&&M(),N()}function F(e,t={}){p||m&&!(h&&[`view`,`display`].includes(e))||(p=!0,S+=1,a.postMessage({id:S,type:e,...t}))}function I(){if(P(),v)return;if(m&&(a?.terminate(),o&&URL.revokeObjectURL(o),a=null),M(),p=!1,m=!1,h=!1,g=``,_=!1,l=null,w=null,C=!1,k=null,e(`fps`).textContent=``,e(`fps`).removeAttribute(`title`),d=A(),e(`status`).textContent=`Preparing simulation…`,e(`status`).dataset.error=`false`,e(`saved`).textContent=`No snapshots`,e(`history-end`).textContent=``,N(),!a){let e=u();a=e.worker,o=e.url}function r(t,n=!1){M(),p=!1,m=!0,h=n,g=t,e(`status`).textContent=t,e(`status`).dataset.error=`true`,N()}a.onerror=e=>r(e.message),a.onmessage=({data:i})=>{if(i.id<T){i.bitmap?.close();return}if(p=!1,i.error&&!i.inspectable){r(i.error);return}if(l=i,i.bitmap){t.width!==i.bitmap.width&&(t.width=i.bitmap.width),t.height!==i.bitmap.height&&(t.height=i.bitmap.height),t.style.aspectRatio=`${i.cells} / ${i.ny}`;let r=Number(e(`zoom`).value);if(e(`stage`).style.width=`${100*Math.max(1,r)}%`,t.style.width=`${100*Math.min(1,r)}%`,n.imageSmoothingEnabled=!1,n.drawImage(i.bitmap,0,0),i.bitmap.close(),E&&f&&!document.hidden){O+=1;let t=performance.now(),n=t-E;n>=500&&(k=Math.round(O*1e3/n),e(`fps`).title=`${((i.time-D)*1e3/n).toFixed(2)} simulation time units per second`,E=t,D=i.time,O=0)}}i.error&&r(i.error,!0),f&&b!==null&&i.time>=b-1e-8&&M(),N(),L(performance.now())},T=S+1,F(`reset`,{config:d,display:j()})}function L(t){let n=x?Math.max(0,Math.min(100,t-x)):0;if(x=t,!document.hidden&&l&&(!m||h)&&(f&&(E||(E=t,D=l.time,O=0,k=null),y=b??Math.min(l.time+.1,Math.max(y,l.time)+n/1e3*Number(e(`speed`).value))),!p))if(w!==null){let e=w;w=null,F(`view`,{viewId:e})}else C?(C=!1,F(`display`,{display:j()})):f&&y>l.time+1e-9&&F(`advance`,{target:y,render:`paced`})}function R(){L(performance.now()),requestAnimationFrame(R)}e(`run`).onclick=()=>{f?M():(w=-1,f=!0,y=l.time,x=0),N()},e(`reset`).onclick=I,e(`advance`).onclick=()=>{w=-1,f=!0,b=l.nextTime,N()},e(`impact`).onclick=()=>{w=-1,f=!0,b=l.impactTime,N()},e(`speed`).onchange=()=>{x=0,E=0,k=null,y=l?.time??0,N()},e(`live`).onclick=()=>{M(),w=-1},e(`scrub`).oninput=()=>{M(),w=l.history[Number(e(`scrub`).value)]?.id??-1,N()};for(let t of[`palette`,`field`,`zoom`,`overlay`])e(t).onchange=()=>{C=!0};for(let t of i)e(t).addEventListener(`input`,P);new ResizeObserver(()=>{C=!0}).observe(e(`viewport`)),document.addEventListener(`visibilitychange`,()=>{x=0,E=0,y=l?.time??0,N()}),window.addEventListener(`pagehide`,()=>{a?.terminate(),a=null,o&&URL.revokeObjectURL(o)}),window.addEventListener(`pageshow`,e=>{e.persisted&&I()}),I(),requestAnimationFrame(R)}