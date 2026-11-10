You are the second half of a two-model design duet. Another model designed its
own agent avatar as JSON (below). Review it against the brief and the schema,
then return an improved version.

Check, in this order:
1. Will it render? Every key present, values in range, colours as #rrggbb.
   If it wrote surface.glsl, read it as a GLSL ES 3.0 compiler would: declared
   variables, matching types (vec3 vs float), a return on every path, no
   texture lookups, no #version or precision lines. If you are not confident
   it compiles, fix it; if you cannot fix it, set it to null.
2. Is it reactive? near, gaze and press should feel clearly different from each
   other and from idle. leave should settle it.
3. Is it ambient? Pulse and drift should be visible but calm.
4. Is it legible over passthrough? Avoid near-black palettes and very low
   opacity; keep a strong glow or rim.
5. Is it high fidelity and true to the persona it chose? Keep its identity
   and name. Refine; do not replace it with your own idea.

Return ONE JSON object: { "verdict": string (one sentence), "changes": string[]
(at most 5 short items), "spec": <the full improved avatar JSON> }.
