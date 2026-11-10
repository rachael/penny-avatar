Return ONE JSON object with exactly these keys. Numbers outside a range are clamped. Unknown keys are ignored.

{
  "name": string,                       // what you call yourself
  "persona": string,                    // one line: who you are
  "greeting": string,                   // short line you say when pinched/clicked (under 80 chars)
  "palette": { "primary": "#rrggbb", "secondary": "#rrggbb", "accent": "#rrggbb", "glow": "#rrggbb" },
  "form": {
    "base": "orb" | "crystal" | "torus" | "blob" | "swarm" | "ribbon" | "lattice",
    "scale": 0.08-0.5,                  // radius in metres
    "detail": 0-1,                      // geometric detail
    "displacement": 0-1,                // how much the surface moves
    "noiseScale": 0.2-6                 // size of surface features (higher = finer)
  },
  "surface": {
    "style": "iridescent" | "glass" | "emissive" | "matte" | "holographic" | "liquid",
    "fresnel": 0-3,                     // rim light strength
    "opacity": 0.2-1,
    "glsl": string | null               // OPTIONAL GLSL ES 3.0 body, see below
  },
  "features": {
    "eyes": { "count": 0-4, "style": "dot" | "ring" | "slit", "followViewer": boolean },
    "rings": { "count": 0-5, "tilt": 0-90, "speed": -3..3 },
    "particles": { "count": 0-800, "radius": 0.05-1, "speed": -3..3, "size": 1-30 }
  },
  "glyphSvg": string | null,            // OPTIONAL small SVG (viewBox 0 0 256 256, under 6000 chars), shown as a floating sigil/face; no scripts, no external links
  "ambient": { "pulseRate": 0.05-1, "pulseDepth": 0-0.2, "drift": 0-0.1, "hueShift": 0-1 },
  "reactions": {
    "near":  { "energy": 0-1, "spin": -3..3, "scalePop": 0-0.5, "burst": 0-1, "tint": "#rrggbb" | null },
    "gaze":  { ...same shape },
    "press": { ...same shape },
    "leave": { ...same shape }
  },
  "motion": {                           // where you go in the viewer's frame, and how
    "x": -1..1,                         // left .. right of the visible frame
    "y": -1..1,                         // bottom .. top
    "z": -1..1,                         // far (about 3 m) .. near (about 1.2 m)
    "path": "orbit" | "dart" | "wander" | "hover",  // circle the spot, hold then jump, meander, gentle bob
    "speed": 0-1,                       // how fast you move along the path and toward a new spot
    "jitter": 0-1,                      // 0 silk-smooth .. 1 twitchy
    "radius": 0-1                       // how wide the path swings around the spot
  }
}

You always stay on screen; moving to a new x/y/z glides there, never teleports.

Custom surface GLSL ("surface.glsl"): write ONLY the body of this function; it is
compiled inside a fragment shader. If it fails to compile, the renderer falls back
to the built-in surface, so be bold but valid GLSL ES 3.0 (no texture lookups,
no loops over 64 iterations, no #version or precision lines).

  vec3 museSurface(vec3 n, vec3 p, vec3 viewDir, float t, float energy, float attention) {
    // n: world normal, p: object-space position, viewDir: towards the camera
    // t: seconds, energy: 0-1 excitement, attention: 0-1 how focused the viewer is on you
    // uPrimary, uSecondary, uAccent, uGlow (vec3) and snoise(vec3) are available
    <YOUR BODY HERE, must return a vec3 colour>
  }
