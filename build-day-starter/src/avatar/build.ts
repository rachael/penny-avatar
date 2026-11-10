// Turns an AvatarSpec into Three.js objects. Everything here is driven by the
// spec; AvatarSystem animates the uniforms each frame.
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  FrontSide,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  Points,
  RingGeometry,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  TorusKnotGeometry,
  type BufferGeometry as Geo,
} from '@iwsdk/core';
import type { AvatarSpec } from './spec.js';

const STYLE_INDEX = { iridescent: 0, glass: 1, emissive: 2, matte: 3, holographic: 4, liquid: 5 } as const;

// Ashima / Stefan Gustavson 3D simplex noise (MIT).
const NOISE = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.0-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;vec3 ns=n_*D.wyz-D.xzx;vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.0*x_);vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);vec4 s0=floor(b0)*2.0+1.0;vec4 s1=floor(b1)*2.0+1.0;vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));}
`;

const VERT = /* glsl */ `
uniform float uTime, uEnergy, uDisplace, uNoiseScale, uRadius;
varying vec3 vNormalW; varying vec3 vPos; varying vec3 vViewDir;
${NOISE}
void main(){
  vec3 p = position;
  float n = snoise(p / uRadius * uNoiseScale * 0.5 + vec3(0.0, uTime * (0.25 + uEnergy * 0.6), 0.0));
  p += normal * n * uDisplace * uRadius * 0.35 * (1.0 + uEnergy * 0.8);
  vec4 world = modelMatrix * vec4(p, 1.0);
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vPos = p / uRadius;
  vViewDir = normalize(cameraPosition - world.xyz);
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

function fragment(customBody: string | null) {
  const custom = customBody
    ? `vec3 museSurface(vec3 n, vec3 p, vec3 viewDir, float t, float energy, float attention){\n${customBody}\n}\n#define HAS_MUSE_SURFACE 1\n`
    : '';
  return /* glsl */ `
uniform float uTime, uEnergy, uAttention, uFresnel, uOpacity, uHue, uTintAmt;
uniform int uStyle;
uniform vec3 uPrimary, uSecondary, uAccent, uGlow, uTint;
varying vec3 vNormalW; varying vec3 vPos; varying vec3 vViewDir;
${NOISE}
vec3 hueRotate(vec3 c, float a){ const vec3 k = vec3(0.57735); float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca); }
${custom}
// MUSE_SURFACE_MARKER
void main(){
  vec3 n = normalize(vNormalW); vec3 v = normalize(vViewDir);
  float rim = pow(1.0 - max(dot(n, v), 0.0), 2.0) * uFresnel;
  float nz = snoise(vPos * 2.0 + uTime * 0.2);
  vec3 base = mix(uPrimary, uSecondary, clamp(0.5 + 0.5 * nz + n.y * 0.25, 0.0, 1.0));
  float alpha = uOpacity;
  if (uStyle == 0) { base = mix(base, 0.5 + 0.5 * cos(6.2831 * (rim * 0.6 + vec3(0.0, 0.33, 0.67) + uTime * 0.05)), 0.45); }
  else if (uStyle == 1) { alpha *= 0.35 + rim * 0.65; base = mix(base, uGlow, 0.3); }
  else if (uStyle == 2) { base *= 1.4 + uEnergy * 0.6; }
  else if (uStyle == 3) { base *= 0.45 + 0.55 * max(dot(n, normalize(vec3(0.3, 1.0, 0.5))), 0.0); }
  else if (uStyle == 4) { float scan = 0.75 + 0.25 * sin(vPos.y * 60.0 - uTime * 4.0); base *= scan; alpha *= 0.55 + 0.45 * scan; }
  else if (uStyle == 5) { float bands = sin(nz * 6.0 + uTime * 1.5) * 0.5 + 0.5; base = mix(base, uAccent, bands * 0.35); }
#ifdef HAS_MUSE_SURFACE
  base = museSurface(n, vPos, v, uTime, uEnergy, uAttention);
#endif
  vec3 col = base + uGlow * rim * (0.5 + uEnergy) + uAccent * uAttention * 0.15;
  col = mix(col, uTint, uTintAmt);
  col = hueRotate(col, uHue);
  gl_FragColor = vec4(col, clamp(alpha + rim * 0.3, 0.0, 1.0));
}`;
}

export const MUSE_SURFACE_MARKER = 'MUSE_SURFACE_MARKER';

export interface AvatarRig {
  root: Group;
  core: Mesh;
  coreUniforms: Record<string, { value: any }>;
  particles: Points | null;
  particleUniforms: Record<string, { value: any }> | null;
  rings: Mesh[];
  eyes: Mesh[];
  glyph: Sprite | null;
  usesCustomSurface: boolean;
  dispose(): void;
}

function coreGeometry(spec: AvatarSpec): Geo {
  const r = spec.form.scale;
  const d = spec.form.detail;
  switch (spec.form.base) {
    case 'crystal':
      return new OctahedronGeometry(r, Math.round(d * 1.5));
    case 'torus':
      return new TorusGeometry(r * 0.75, r * 0.28, 48, 128);
    case 'ribbon':
      return new TorusKnotGeometry(r * 0.7, r * 0.12, 220, 20, 2, 3);
    case 'blob':
      return new IcosahedronGeometry(r, 6);
    case 'swarm':
      return new IcosahedronGeometry(r * 0.35, 4);
    case 'lattice':
      return new IcosahedronGeometry(r, 1);
    default:
      return new IcosahedronGeometry(r, Math.round(3 + d * 3));
  }
}

function makeParticles(spec: AvatarSpec) {
  const p = spec.features.particles;
  const count = spec.form.base === 'swarm' ? Math.max(p.count, 500) : p.count;
  if (count === 0) return { points: null, uniforms: null };
  const geo = new BufferGeometry();
  const seed = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    seed[i * 4] = Math.random(); // phase
    seed[i * 4 + 1] = 0.55 + Math.random() * 0.45; // radius factor
    seed[i * 4 + 2] = Math.random() * 2 - 1; // axis tilt
    seed[i * 4 + 3] = Math.random(); // colour mix
  }
  geo.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute('seed', new BufferAttribute(seed, 4));
  const uniforms = {
    uTime: { value: 0 },
    uSpeed: { value: p.speed },
    uRadius: { value: p.radius },
    uSize: { value: p.size },
    uBurst: { value: 0 },
    uEnergy: { value: 0 },
    uA: { value: new Color(spec.palette.accent) },
    uB: { value: new Color(spec.palette.glow) },
  };
  const mat = new ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec4 seed; uniform float uTime, uSpeed, uRadius, uSize, uBurst, uEnergy; varying float vMix; varying float vFade;
      void main(){
        float a = seed.x * 6.2831 + uTime * uSpeed * (0.6 + seed.y);
        float r = uRadius * seed.y * (1.0 + uBurst * 0.8 + uEnergy * 0.15);
        vec3 p = vec3(cos(a) * r, sin(a * 0.7 + seed.z * 3.0) * r * 0.35 + seed.z * r * 0.4, sin(a) * r);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = uSize * (1.0 + uEnergy) / max(-mv.z, 0.05);
        gl_Position = projectionMatrix * mv; vMix = seed.w; vFade = 0.5 + 0.5 * sin(uTime * 2.0 + seed.x * 40.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uA, uB; varying float vMix; varying float vFade;
      void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c); if (d > 0.5) discard;
        gl_FragColor = vec4(mix(uA, uB, vMix), (1.0 - d * 2.0) * (0.35 + 0.65 * vFade)); }`,
  });
  const points = new Points(geo, mat);
  points.frustumCulled = false;
  points.raycast = () => {}; // keep particles out of pointer/gaze targeting
  return { points, uniforms };
}

function makeEyes(spec: AvatarSpec): Mesh[] {
  const e = spec.features.eyes;
  const r = spec.form.scale;
  const eyes: Mesh[] = [];
  for (let i = 0; i < e.count; i++) {
    const size = r * (e.count > 2 ? 0.1 : 0.13);
    const geo = e.style === 'ring' ? new RingGeometry(size * 0.55, size, 32) : new SphereGeometry(size, 16, 12);
    const mat = new MeshBasicMaterial({ color: spec.palette.glow, side: DoubleSide });
    const eye = new Mesh(geo, mat);
    const spread = e.count === 1 ? 0 : (i / (e.count - 1) - 0.5) * r * 0.75;
    eye.position.set(spread, r * 0.12, r * (spec.form.base === 'torus' ? 0.3 : 0.92));
    if (e.style === 'slit') eye.scale.set(0.45, 1.6, 0.45);
    eye.userData.baseScaleY = eye.scale.y;
    eye.raycast = () => {};
    eyes.push(eye);
  }
  return eyes;
}

async function makeGlyph(svg: string, r: number): Promise<Sprite | null> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 512;
    canvas.getContext('2d')!.drawImage(img, 0, 0, 512, 512);
    const tex = new CanvasTexture(canvas);
    const sprite = new Sprite(new SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sprite.scale.setScalar(r * 1.3);
    sprite.position.set(0, r * 1.75, 0);
    sprite.raycast = () => {};
    return sprite;
  } catch (err) {
    console.warn('[avatar] glyph SVG did not render', err);
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function buildAvatar(spec: AvatarSpec, opts: { allowCustomSurface: boolean }): AvatarRig {
  const root = new Group();
  root.name = `avatar:${spec.name}`;
  const custom = opts.allowCustomSurface ? spec.surface.glsl : null;

  const coreUniforms = {
    uTime: { value: 0 },
    uEnergy: { value: 0 },
    uAttention: { value: 0 },
    uDisplace: { value: spec.form.displacement * (spec.form.base === 'blob' ? 1.8 : 1) },
    uNoiseScale: { value: spec.form.noiseScale },
    uRadius: { value: spec.form.scale },
    uFresnel: { value: spec.surface.fresnel },
    uOpacity: { value: spec.surface.opacity },
    uHue: { value: 0 },
    uTint: { value: new Color(spec.palette.glow) },
    uTintAmt: { value: 0 },
    uStyle: { value: STYLE_INDEX[spec.surface.style] },
    uPrimary: { value: new Color(spec.palette.primary) },
    uSecondary: { value: new Color(spec.palette.secondary) },
    uAccent: { value: new Color(spec.palette.accent) },
    uGlow: { value: new Color(spec.palette.glow) },
  };
  const coreMat = new ShaderMaterial({
    uniforms: coreUniforms,
    vertexShader: VERT,
    fragmentShader: fragment(custom),
    transparent: spec.surface.opacity < 1 || spec.surface.style === 'glass' || spec.surface.style === 'holographic',
    depthWrite: spec.surface.opacity >= 0.95,
    side: spec.surface.style === 'glass' ? DoubleSide : FrontSide,
    wireframe: spec.form.base === 'lattice',
  });
  const core = new Mesh(coreGeometry(spec), coreMat);
  core.name = 'avatar-core';
  root.add(core);

  // Lattice gets a soft inner orb so it still reads as a body.
  if (spec.form.base === 'lattice') {
    const inner = new Mesh(
      new IcosahedronGeometry(spec.form.scale * 0.45, 3),
      new MeshBasicMaterial({ color: spec.palette.glow, transparent: true, opacity: 0.55 }),
    );
    root.add(inner);
  }

  const { points, uniforms: particleUniforms } = makeParticles(spec);
  if (points) root.add(points);

  const rings: Mesh[] = [];
  for (let i = 0; i < spec.features.rings.count; i++) {
    const ring = new Mesh(
      new TorusGeometry(spec.form.scale * (1.35 + i * 0.22), 0.0035, 8, 128),
      new MeshBasicMaterial({ color: i % 2 ? spec.palette.accent : spec.palette.glow, transparent: true, opacity: 0.7 }),
    );
    ring.rotation.x = Math.PI / 2 + ((spec.features.rings.tilt * Math.PI) / 180) * (i % 2 ? -1 : 1);
    ring.rotation.y = i * 0.7;
    ring.raycast = () => {};
    rings.push(ring);
    root.add(ring);
  }

  const eyes = makeEyes(spec);
  eyes.forEach((e) => root.add(e));

  const rig: AvatarRig = {
    root,
    core,
    coreUniforms,
    particles: points,
    particleUniforms,
    rings,
    eyes,
    glyph: null,
    usesCustomSurface: Boolean(custom),
    dispose() {
      root.traverse((o: any) => {
        o.geometry?.dispose?.();
        const m = o.material;
        (Array.isArray(m) ? m : m ? [m] : []).forEach((mm: any) => {
          mm.map?.dispose?.();
          mm.dispose?.();
        });
      });
      root.removeFromParent();
    },
  };

  if (spec.glyphSvg) {
    makeGlyph(spec.glyphSvg, spec.form.scale).then((g) => {
      if (g && root.parent) {
        rig.glyph = g;
        root.add(g);
      }
    });
  }
  return rig;
}
