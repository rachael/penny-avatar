# Run sheet: Muse avatar starter

An IWSDK 1.1 WebXR app (mixed reality / passthrough target) where Muse designs
its own avatar as JSON, a second model reviews and refines it, and the page
renders it as a reactive, ambient 3D presence. Optional AR canvas you sketch
on and Muse adds to.

## 1. Run it on your laptop

```bash
cd build-day-starter
npm install            # already done if node_modules exists; Node 20.19+/22.12+/24+
cp .env.example .env.local
# open .env.local and paste your OpenRouter key after OPENROUTER_API_KEY=
npm run dev:runtime    # plain Vite: https://localhost:8081 (open it in Chrome)
```

`npm run dev` also works and adds IWSDK's managed browser and agent (MCP)
tooling; it downloads its own Chromium the first time.

- The key lives only in `.env.local` (git-ignored) or your shell
  (`export OPENROUTER_API_KEY=...`). It is read by the dev server in Node; the
  page and the headset never see it. Never paste it into the page or a prompt.
- No key or no network: `npm run dev:mock` runs the whole loop on canned specs.
- I tested with `npm run dev:runtime`. If `npm run dev` doesn't pick up the
  key, use `dev:runtime`; it's the same app and the same /api routes.
- Check the server side any time: open `https://localhost:8081/api/health`
  (shows `key: true/false` and the model ids, never the key).

In the browser: drag to look, **N** = new avatar, **C** = AR canvas,
**M** = Muse adds to the sketch, **X** = clear canvas. Click the avatar to poke it.
Press **Enter XR** to get the emulator (IWER) with a fake living room as
passthrough and virtual controllers; its toolbar has a "Gaze + Hands" mode for
the glasses flow.

## 2. Open it on Quest 3 (passthrough)

1. Laptop and Quest on the same Wi-Fi. If the venue Wi-Fi isolates devices, use
   a phone hotspot for both, or USB: `adb reverse tcp:8081 tcp:8081` and open
   `https://localhost:8081` on the headset.
2. Find the Network URL: Vite prints it on start (`Network: https://192.168.x.x:8081`).
3. In Quest Browser open that URL, accept the certificate warning (it's IWSDK's
   local dev certificate), then press **Enter AR** on the panel.
4. Controllers or hands: point and pull trigger / pinch on the avatar. Walk up
   to it. Gaze isn't eye-tracked on Quest 3; head direction stands in.

## 3. Meta glasses

- **Meta VR Glasses** (the gaze-and-pinch glasses IWSDK 1.0 targets): this app
  turns on `gazeTracking` and `handTracking` in `iwsdk.config.json`, so look at the
  avatar and pinch. To preview, set `dev.emulator.device` to `"metaVRGlasses"` in
  `iwsdk.config.json`; the avatar and panel sit inside that narrow view.
- **Ray-Ban Meta / Meta Ray-Ban Display**: as far as I know these don't run
  WebXR pages, so this app won't open there. Unverified; check in the room.

## 4. The one prompt to restyle

`prompts/avatar.md`. Edit it and press New avatar; no restart. The reviewer's
instructions are `prompts/review.md`. The HUD box adds one-off direction on top.
Swap models with env vars: `MUSE_MODEL`, `REVIEW_MODEL`, `CANVAS_MODEL`
(see `.env.example`). Every result is saved in `generated/` for your demo.

## 5. Ask Muse for ideas

```bash
npm run ideas -- "paste the challenge prompt here"
```

## What's where

| File | What it does |
| --- | --- |
| `prompts/avatar.md` | The designer prompt (restyle here) |
| `prompts/avatar-schema.md` | JSON shape Muse writes; custom GLSL contract |
| `prompts/review.md` | Second-pass reviewer |
| `server/muse-plugin.ts` | `/api/avatar` (design → review), `/api/canvas`, `/api/image`, `/api/health` |
| `server/openrouter.mjs` | OpenRouter calls, JSON extraction, run logging |
| `src/avatar/spec.ts` | Clamps any reply into a safe spec; fallback avatar |
| `src/avatar/build.ts` | Spec → Three.js: shader body, particles, rings, eyes, SVG glyph |
| `src/avatar/avatar-system.ts` | Reactive + ambient behaviour, shader-error fallback |
| `src/canvas-system.ts` | AR canvas stretch (sketch + Muse adds strokes from the image) |
| `src/ui.ts`, `src/panel.ts` | Browser HUD and in-headset panel |
