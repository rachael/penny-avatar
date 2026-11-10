// Offline stand-ins (MUSE_MOCK=1) so the whole loop can be tested without a
// key or network. These are hand-written examples, not Muse output.
const specs = [
  {
    name: 'Lumen',
    persona: 'A patient listener made of slow light.',
    greeting: 'Oh, hi. I was just thinking about you.',
    palette: { primary: '#6ee7ff', secondary: '#7c5cff', accent: '#ffd36e', glow: '#b8f3ff' },
    form: { base: 'orb', scale: 0.16, detail: 0.9, displacement: 0.35, noiseScale: 1.8 },
    surface: {
      style: 'iridescent',
      fresnel: 1.6,
      opacity: 0.85,
      glsl:
        'float bands = sin(p.y * 18.0 + t * 1.5 + snoise(p * 2.0) * 2.0) * 0.5 + 0.5;\n' +
        'vec3 base = mix(uPrimary, uSecondary, bands);\n' +
        'float rim = pow(1.0 - max(dot(n, viewDir), 0.0), 2.0);\n' +
        'return base + uGlow * rim * (0.6 + energy) + uAccent * attention * 0.25;',
    },
    features: {
      eyes: { count: 2, style: 'dot', followViewer: true },
      rings: { count: 2, tilt: 24, speed: 0.6 },
      particles: { count: 260, radius: 0.32, speed: 0.4, size: 7 },
    },
    glyphSvg: null,
    ambient: { pulseRate: 0.22, pulseDepth: 0.06, drift: 0.02, hueShift: 0.15 },
    reactions: {
      near: { energy: 0.45, spin: 0.4, scalePop: 0.08, burst: 0.2, tint: null },
      gaze: { energy: 0.65, spin: 0.2, scalePop: 0.05, burst: 0, tint: '#ffd36e' },
      press: { energy: 1, spin: 2.2, scalePop: 0.25, burst: 1, tint: '#ffffff' },
      leave: { energy: 0.1, spin: 0, scalePop: 0, burst: 0, tint: null },
    },
  },
  {
    name: 'Facet',
    persona: 'A precise, curious mind that refracts everything it sees.',
    greeting: 'Show me something I have not seen.',
    palette: { primary: '#e8f7ff', secondary: '#3dd6c6', accent: '#ff5fa2', glow: '#9ffcff' },
    form: { base: 'crystal', scale: 0.15, detail: 0.2, displacement: 0.05, noiseScale: 3 },
    surface: { style: 'glass', fresnel: 2.4, opacity: 0.6, glsl: 'return vec3(oops);' },
    features: {
      eyes: { count: 1, style: 'slit', followViewer: true },
      rings: { count: 3, tilt: 60, speed: -1.2 },
      particles: { count: 120, radius: 0.25, speed: 1.4, size: 4 },
    },
    glyphSvg:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><g fill="none" stroke="#ff5fa2" stroke-width="6">' +
      '<circle cx="128" cy="128" r="90"/><path d="M128 38 L206 172 L50 172 Z"/><circle cx="128" cy="128" r="14" fill="#ff5fa2"/></g></svg>',
    ambient: { pulseRate: 0.12, pulseDepth: 0.03, drift: 0.04, hueShift: 0.05 },
    reactions: {
      near: { energy: 0.3, spin: 1, scalePop: 0.05, burst: 0.1, tint: null },
      gaze: { energy: 0.7, spin: -0.5, scalePop: 0.1, burst: 0.2, tint: '#3dd6c6' },
      press: { energy: 1, spin: -3, scalePop: 0.3, burst: 1, tint: '#ff5fa2' },
      leave: { energy: 0, spin: 0.2, scalePop: 0, burst: 0, tint: null },
    },
  },
];

let i = 0;
export const mockSpec = () => structuredClone(specs[i++ % specs.length]);
export const mockReview = () => ({
  model: 'mock',
  ms: 0,
  verdict: 'Mock review: renders, reacts, pulses.',
  changes: ['(mock) no changes'],
});
export const mockCanvas = () => ({
  caption: 'Mock: I added a little sun in the corner.',
  model: 'mock',
  strokes: [
    {
      color: '#ffd36e',
      width: 10,
      points: Array.from({ length: 33 }, (_, k) => {
        const a = (k / 32) * Math.PI * 2;
        return [0.8 + Math.cos(a) * 0.08, 0.2 + Math.sin(a) * 0.08];
      }),
    },
  ],
});
