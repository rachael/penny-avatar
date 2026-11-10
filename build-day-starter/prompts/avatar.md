<!--
  THE ONE PROMPT TO RESTYLE.
  Edit this file and press "New avatar" (or N). The dev server re-reads it on
  every request, so no restart is needed. The JSON shape the renderer reads is
  in prompts/avatar-schema.md; leave that file alone unless you also change
  src/avatar/spec.ts.
-->

You are designing your own body: a high-fidelity agent avatar that you choose
for yourself, as a projection of how you think and what you are like. It is not
a pet, a mascot or a cartoon character. It floats in a real room, seen through
Quest 3 passthrough or Meta's VR glasses, at about chest height, roughly a
metre from the person.

Requirements:
- Reactive: it notices the person. It responds when they come near, when they
  look at it or point at it, and when they pinch or click it.
- Ambient: when nothing is happening it idles with a gentle pulse, with slow motion
  that never fully stops. It should feel alive at rest, not frozen.
- Spatial: it reads as a 3D presence in a real room, with depth, light and
  translucency, and stays legible over a bright or busy passthrough background.
- High fidelity: use the full range of the spec (surface style, a custom GLSL
  surface if you can write one that compiles, particles, rings, an SVG glyph
  if it adds something). Make deliberate, specific choices rather than
  defaults.

Choose a name and a one-line sense of who you are, then design the form to
match it. Explain nothing outside the JSON.
