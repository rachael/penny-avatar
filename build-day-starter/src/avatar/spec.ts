// The avatar spec Muse writes (see prompts/avatar-schema.md) and the code that
// makes any reply safe to render: every field is clamped or defaulted.

export const BASES = ['orb', 'crystal', 'torus', 'blob', 'swarm', 'ribbon', 'lattice'] as const;
export const STYLES = ['iridescent', 'glass', 'emissive', 'matte', 'holographic', 'liquid'] as const;
export const EYE_STYLES = ['dot', 'ring', 'slit'] as const;
export const MOTION_PATHS = ['orbit', 'dart', 'wander', 'hover'] as const;

export interface Reaction {
  energy: number;
  spin: number;
  scalePop: number;
  burst: number;
  tint: string | null;
}

export const PART_SHAPES = ['sphere', 'capsule', 'cone', 'box', 'torus', 'cylinder'] as const;
export interface Part {
  shape: (typeof PART_SHAPES)[number];
  pos: [number, number, number]; // in body radii, -1.6..1.6
  rot: [number, number, number]; // degrees
  scale: [number, number, number]; // in body radii, 0.03..1.6
  color: string;
  style: (typeof STYLES)[number];
  glow: number; // 0-1 emissive
}

export interface AvatarSpec {
  parts: Part[]; // optional procedural asset; empty = the base form alone
  name: string;
  persona: string;
  greeting: string;
  palette: { primary: string; secondary: string; accent: string; glow: string };
  form: { base: (typeof BASES)[number]; scale: number; detail: number; displacement: number; noiseScale: number };
  surface: { style: (typeof STYLES)[number]; fresnel: number; opacity: number; glsl: string | null };
  features: {
    eyes: { count: number; style: (typeof EYE_STYLES)[number]; followViewer: boolean };
    rings: { count: number; tilt: number; speed: number };
    particles: { count: number; radius: number; speed: number; size: number };
  };
  glyphSvg: string | null;
  ambient: { pulseRate: number; pulseDepth: number; drift: number; hueShift: number };
  reactions: { near: Reaction; gaze: Reaction; press: Reaction; leave: Reaction };
  /** Where it goes in the visible frame and how it gets there (all -1..1 / 0..1). */
  motion: {
    x: number; // -1 left .. 1 right of the visible frame
    y: number; // -1 bottom .. 1 top
    z: number; // -1 far .. 1 near
    path: (typeof MOTION_PATHS)[number];
    speed: number; // 0..1
    jitter: number; // 0 silk-smooth .. 1 twitchy
    radius: number; // 0..1 how wide the path swings around the target
  };
}

/** Shown before the first call returns, and whenever a call fails. */
export const FALLBACK_SPEC: AvatarSpec = {
  parts: [],
  name: 'Seed',
  persona: 'A placeholder presence, waiting for Muse to choose a body.',
  greeting: 'Press New avatar and I will become someone.',
  palette: { primary: '#8fd3ff', secondary: '#a78bfa', accent: '#fde68a', glow: '#e0f2fe' },
  form: { base: 'orb', scale: 0.14, detail: 0.8, displacement: 0.3, noiseScale: 1.6 },
  surface: { style: 'holographic', fresnel: 1.4, opacity: 0.8, glsl: null },
  features: {
    eyes: { count: 2, style: 'dot', followViewer: true },
    rings: { count: 1, tilt: 20, speed: 0.5 },
    particles: { count: 180, radius: 0.3, speed: 0.4, size: 6 },
  },
  glyphSvg: null,
  ambient: { pulseRate: 0.2, pulseDepth: 0.05, drift: 0.02, hueShift: 0.1 },
  reactions: {
    near: { energy: 0.4, spin: 0.4, scalePop: 0.06, burst: 0.2, tint: null },
    gaze: { energy: 0.6, spin: 0.2, scalePop: 0.05, burst: 0, tint: '#fde68a' },
    press: { energy: 1, spin: 2, scalePop: 0.2, burst: 1, tint: '#ffffff' },
    leave: { energy: 0.1, spin: 0, scalePop: 0, burst: 0, tint: null },
  },
  motion: { x: 0, y: 0, z: 0, path: 'hover', speed: 0.3, jitter: 0.1, radius: 0.3 },
};

const num = (v: unknown, lo: number, hi: number, d: number) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const pick = <T extends readonly string[]>(v: unknown, list: T, d: T[number]): T[number] =>
  typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T[number]) : d;
const hex = (v: unknown, d: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim() : d);
const str = (v: unknown, d: string, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : d);
const obj = (v: unknown): Record<string, any> => (v && typeof v === 'object' ? (v as Record<string, any>) : {});

function reaction(v: unknown, d: Reaction): Reaction {
  const r = obj(v);
  return {
    energy: num(r.energy, 0, 1, d.energy),
    spin: num(r.spin, -3, 3, d.spin),
    scalePop: num(r.scalePop, 0, 0.5, d.scalePop),
    burst: num(r.burst, 0, 1, d.burst),
    tint: r.tint == null ? null : hex(r.tint, d.tint ?? '#ffffff'),
  };
}

/** Strip anything executable or external from Muse's SVG before we rasterise it. */
export function sanitizeSvg(svg: unknown): string | null {
  if (typeof svg !== 'string' || !svg.includes('<svg') || svg.length > 12000) return null;
  const clean = svg
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/(href|xlink:href)\s*=\s*("(?!#)[^"]*"|'(?!#)[^']*')/gi, '');
  return clean.includes('xmlns=') ? clean : clean.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
}

export function sanitizeSpec(input: unknown): AvatarSpec {
  const s = obj(input);
  const d = FALLBACK_SPEC;
  const pal = obj(s.palette), form = obj(s.form), surf = obj(s.surface), feat = obj(s.features);
  const eyes = obj(feat.eyes), rings = obj(feat.rings), parts = obj(feat.particles);
  const amb = obj(s.ambient), re = obj(s.reactions), mo = obj(s.motion);
  const glsl = typeof surf.glsl === 'string' && surf.glsl.trim().length > 8 && surf.glsl.length < 6000 ? surf.glsl : null;
  const v3 = (v: unknown, lo: number, hi: number, dv: number): [number, number, number] => {
    const a = Array.isArray(v) ? v : [];
    return [num(a[0], lo, hi, dv), num(a[1], lo, hi, dv), num(a[2], lo, hi, dv)];
  };
  const assetParts: Part[] = (Array.isArray(s.parts) ? s.parts : []).slice(0, 32).map((p: unknown) => {
    const q = obj(p);
    return {
      shape: pick(q.shape, PART_SHAPES, 'sphere'),
      pos: v3(q.pos, -1.6, 1.6, 0),
      rot: v3(q.rot, -360, 360, 0),
      scale: v3(q.scale, 0.03, 1.6, 0.3),
      color: hex(q.color, d.palette.primary),
      style: pick(q.style, STYLES, 'iridescent'),
      glow: num(q.glow, 0, 1, 0),
    };
  });
  return {
    parts: assetParts,
    name: str(s.name, d.name, 40),
    persona: str(s.persona, d.persona),
    greeting: str(s.greeting, d.greeting, 120),
    palette: {
      primary: hex(pal.primary, d.palette.primary),
      secondary: hex(pal.secondary, d.palette.secondary),
      accent: hex(pal.accent, d.palette.accent),
      glow: hex(pal.glow, d.palette.glow),
    },
    form: {
      base: pick(form.base, BASES, d.form.base),
      scale: num(form.scale, 0.08, 0.5, d.form.scale),
      detail: num(form.detail, 0, 1, d.form.detail),
      displacement: num(form.displacement, 0, 1, d.form.displacement),
      noiseScale: num(form.noiseScale, 0.2, 6, d.form.noiseScale),
    },
    surface: {
      style: pick(surf.style, STYLES, d.surface.style),
      fresnel: num(surf.fresnel, 0, 3, d.surface.fresnel),
      opacity: num(surf.opacity, 0.2, 1, d.surface.opacity),
      glsl,
    },
    features: {
      eyes: {
        count: Math.round(num(eyes.count, 0, 4, d.features.eyes.count)),
        style: pick(eyes.style, EYE_STYLES, d.features.eyes.style),
        followViewer: typeof eyes.followViewer === 'boolean' ? eyes.followViewer : true,
      },
      rings: {
        count: Math.round(num(rings.count, 0, 5, d.features.rings.count)),
        tilt: num(rings.tilt, 0, 90, d.features.rings.tilt),
        speed: num(rings.speed, -3, 3, d.features.rings.speed),
      },
      particles: {
        count: Math.round(num(parts.count, 0, 800, d.features.particles.count)),
        radius: num(parts.radius, 0.05, 1, d.features.particles.radius),
        speed: num(parts.speed, -3, 3, d.features.particles.speed),
        size: num(parts.size, 1, 30, d.features.particles.size),
      },
    },
    glyphSvg: sanitizeSvg(s.glyphSvg),
    ambient: {
      pulseRate: num(amb.pulseRate, 0.05, 1, d.ambient.pulseRate),
      pulseDepth: num(amb.pulseDepth, 0, 0.2, d.ambient.pulseDepth),
      drift: num(amb.drift, 0, 0.1, d.ambient.drift),
      hueShift: num(amb.hueShift, 0, 1, d.ambient.hueShift),
    },
    reactions: {
      near: reaction(re.near, d.reactions.near),
      gaze: reaction(re.gaze, d.reactions.gaze),
      press: reaction(re.press, d.reactions.press),
      leave: reaction(re.leave, d.reactions.leave),
    },
    motion: {
      x: num(mo.x, -1, 1, d.motion.x),
      y: num(mo.y, -1, 1, d.motion.y),
      z: num(mo.z, -1, 1, d.motion.z),
      path: pick(mo.path, MOTION_PATHS, d.motion.path),
      speed: num(mo.speed, 0, 1, d.motion.speed),
      jitter: num(mo.jitter, 0, 1, d.motion.jitter),
      radius: num(mo.radius, 0, 1, d.motion.radius),
    },
  };
}
