# In-room plan (60 minutes)

The event page says the build prompt is revealed in the room and you get 60
minutes, then five volunteers demo for 3 minutes each. No rules about bringing
code are posted. If it turns out you must start from zero, rebuild from step 0
below: the pieces are small on purpose.

## Before 5:30
- `npm run dev` once at home with your key; press N twice; check `generated/`.
- Charge the Quest; join it and the laptop to your phone hotspot as a backup
  network; open the Network URL on the Quest once so the cert is accepted.
- Claim the free OpenRouter credits at the event (page says they're provided).

## The hour
| Min | Do |
| --- | --- |
| 0–5 | Read the challenge. `npm run ideas -- "<challenge>"`. Pick one in a minute. |
| 5–15 | Rewrite `prompts/avatar.md` toward the challenge. Press N until one lands. |
| 15–35 | One new behaviour: add a reaction, a schema field, or a canvas mode (ideas below). |
| 35–45 | On the Quest in passthrough. Fix only what breaks the demo. |
| 45–55 | Lock it: set `?auto=0`, keep a good result open, pick the demo spec in `generated/`. |
| 55–60 | Rehearse the 3 minutes once. |

## Step 0: rebuild from scratch (if no prior code is allowed)
1. `npm create @iwsdk@latest avatar -- --yes --target ar` (2 min)
2. Add the Vite plugin with one route: POST `/api/avatar` → OpenRouter
   chat/completions with `meta/muse-ember`, `response_format: {type: "json_object"}`.
3. One system: `createTransformEntity(group)` + `RayInteractable`; read
   `Hovered` / `Pressed`; pulse with `sin(t)`; spec drives colours and scale.
4. Paste the avatar prompt from memory: "design your own body… reactive,
   ambient, spatial, high fidelity… return JSON".

## The duet (mutual design / mutual review)
- Today: Muse Ember designs, Muse Spark 1.3 reviews and refines. Set
  `REVIEW_MODEL` to any OpenRouter model id (a Claude model, for example) to
  make it a cross-model review, and `DUET_ROUNDS=2` for two passes.
- Demo line: "It chose its own body; a second model checked it would actually
  render, react and pulse; here's the diff." `generated/*.json` holds the first
  draft and the reviewed spec side by side.

## Extension ideas that fit the hour
- **Show it the room:** send a passthrough-free screenshot or a photo of your
  surroundings to Ember (it takes images) and let it pick a body that belongs there.
- **Hear you:** Ember takes audio; record 5 seconds in the page and let the
  avatar's reaction to your voice come from Muse.
- **Avatar draws back:** the AR canvas already sends your sketch as an image;
  have the avatar fly to the canvas while Muse's strokes draw in.
- **Muse Image skin:** `/api/image` asks `meta/muse-image` for a texture; map it
  on the core (untested route, see below).
- **Two avatars:** call `/api/avatar` twice with different briefs and let them
  review each other.

## What Muse is good at (from OpenRouter's model pages, read Nov 9)
- **Muse Ember** (`meta/muse-ember`, released today): text, image, video, audio
  and PDF in; text out; tool calling, structured outputs, reasoning; about 1M
  context; $0.10 / $0.50 per million tokens. The default designer here.
- **Muse Spark 1.3** (`meta/muse-spark-1.3`): newest Spark, about 1M context,
  $1.25 / $4.25. Spark 1.1–1.2 list structured output, parallel function
  calling and configurable reasoning effort. Default reviewer here.
- **Muse Spark Open** (`meta/muse-spark-open`): coding-optimised open weights,
  text only. Worth trying as the GLSL writer.
- **Muse Wonder** (`meta/muse-wonder`): the large one, $4 / $20.
- **Muse Image** (`meta/muse-image`): image generation and editing, about $0.01
  an image.
- **Muse Voice Transcribe** (`meta/muse-voice-transcribe-1.0`): speech to text.
- No 3D-model generation is listed. How well it writes WebXR / Three.js / GLSL
  isn't published; tonight's talk is the place to ask. That's why the renderer
  owns the 3D and Muse writes a spec plus optional shader code with a fallback.
