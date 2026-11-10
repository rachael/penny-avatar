# Penny Avatar

A phone watches and listens to the room, and Meta's Muse Ember reshapes a 3D avatar in response, every few seconds, for a fraction of a cent per look.

Built for the OpenRouter x Meta Build Day at Shack15, on the challenge "the most impressive project that can be built on Muse Ember for $1". It uses Muse Ember (`meta/muse-ember`) through OpenRouter.

The app is called Penny Avatar because it costs pennies to run, like a penny arcade. The avatar itself is not called Penny: it chooses its own name and form.


> **Update (after the event):** live mode now starts with one `/api/design` call where Muse Ember
> chooses its own avatar as a CGI asset (19 primitives with physically based materials; its first
> pick was "a small ember-fox wisp who collects warm moments"). Each look then only reacts on top:
> motion, energy and reactions, about once a second, at roughly $0.0006 per look.

## What it is

A reactive spatial avatar. A Pixel phone's camera and microphone sense the room. About every 6 seconds the phone sends 4 seconds of audio and one photo to the dev server, which asks Muse Ember what it saw and heard and how the avatar should respond.

Ember returns three things in one JSON reply:

- `saw`: a short description of the frame
- `heard`: a short description of the audio
- `spec`: the avatar's next form, palette, surface, energy and motion (where it goes in the scene; a path of orbit, dart, wander or hover; speed; jitter)

The spec is Ember's own reaction to the room. It does not copy the shape of what it sees: a red mug does not produce a red mug.

A spend meter shows the running cost, read from OpenRouter's `usage.cost` on each response, as `$spent of $1.00` (for example `$0.0042 of $1.00`; that is the display format, not a measurement). It also shows the number of looks, tokens used, and the latest `saw` and `heard`. If a response arrives without `usage.cost`, the server estimates that look's cost from its token counts and marks the total as estimated.

A laptop opened at `?mirror=1` follows the phone's avatar and meter, for presenting and recording.

## Why it is impressive for $1

Each look is a single multimodal call: one 512 px image, 4 seconds of audio, and a JSON answer. There is no separate speech-to-text model, vision model or design model. Ember perceives and designs in one step, so one look costs a fraction of a cent, and $1 buys hundreds to thousands of looks.

The meter is the source of truth. To work out what $1 buys, read two numbers off it and fill in:

```text
cost per look   = spent ÷ looks                 = $______ ÷ ______ = $______
looks per $1    = $1.00 ÷ cost per look          = ______ looks
minutes per $1  = looks per $1 × 6 s ÷ 60        = ______ minutes of continuous sensing
```

Cost per look depends on the image, the audio length and how long Ember's reply is, so read it from a real run rather than from this page.

## How it works

```text
Pixel phone, browser at ?live=1
  camera + mic; every ~6 s:
  4 s mono 16 kHz WAV + one 512 px JPEG
        │
        │  POST /api/sense
        ▼
Dev server (Vite plugin in Node; OPENROUTER_API_KEY from .env.local, never sent to the browser)
        │
        │  OpenRouter chat completion, model meta/muse-ember
        │  content: image_url (JPEG) + input_audio (wav)
        │  response_format: json_object, usage: { include: true }
        ▼
OpenRouter ── Muse Ember
        │
        │  { saw, heard, spec } + usage.cost
        ▼
Dev server: adds usage.cost to the running total, keeps the latest look
        │                                        │
        │  reply to the phone                    │  GET /api/state (polled)
        ▼                                        ▼
Phone renderer (IWSDK / Three.js)          Laptop at ?mirror=1
avatar + spend meter                       same avatar + meter, on the projector
```

## Run it

You need Node 20.19+ (or 22.12+ / 24+), an OpenRouter API key, a phone with Chrome (we used a Pixel), and a laptop.

1. Put your key in `build-day-starter/.env.local` (git-ignored):

   ```bash
   cd build-day-starter
   cp .env.example .env.local
   # edit .env.local so it contains:
   # OPENROUTER_API_KEY=sk-or-...
   ```

   The key is read by the dev server in Node only. Never paste it into the page.

2. Install and start the dev server:

   ```bash
   npm install
   npm run dev:runtime     # https://localhost:8081
   ```

   Check `https://localhost:8081/api/health`: it should show `key: true` (it never shows the key itself).

3. The phone needs HTTPS for the camera and microphone. In a second terminal, open a tunnel:

   ```bash
   npx cloudflared tunnel --url https://localhost:8081 --no-tls-verify
   ```

   The dev server only speaks HTTPS, with a local development certificate, hence `https://` and `--no-tls-verify`. cloudflared prints a URL like `https://<random-words>.trycloudflare.com`.

4. On the phone, open that URL with `?live=1` in Chrome:

   ```text
   https://<random-words>.trycloudflare.com/?live=1
   ```

   Allow camera and microphone access. Keep the screen on.

5. On the laptop, open the mirror and accept the certificate warning (it is the local dev certificate):

   ```text
   https://localhost:8081/?mirror=1
   ```

   Put this window on the projector, or record it for the video.

6. Optional: zero the meter right before you present.

   ```bash
   curl -sk -X POST https://localhost:8081/api/reset
   ```

## Demo script (3 minutes)

Setup: the laptop at `?mirror=1` is on the projector. The phone is at `?live=1`, unlocked, with permissions granted, and the first look has already landed. You hold the phone; the audience watches the projector.

Pacing: one look about every 6 seconds, plus Ember's reply time. Give each action 15 to 25 seconds before you expect the avatar to change, and keep holding the phone on the subject until it does.

| Time | Say | Do on the phone |
| --- | --- | --- |
| 0:00–0:20 | "This is Penny Avatar. A phone is watching and listening to this room, and Meta's Muse Ember, through OpenRouter, decides what this avatar looks like and how it moves. The budget for the whole thing is one dollar." | Hold the phone steady, camera toward the audience. |
| 0:20–0:45 | "Every six seconds the phone sends four seconds of sound and one small photo. Ember sends back what it saw, what it heard, and a new design for the avatar. You can read the last two lines here." (point to `saw` and `heard` on the meter) "That 'heard' line is picking up my voice right now." | Keep the camera on the audience and keep talking. Pan slowly across the room. |
| 0:45–1:10 | "We didn't design this avatar, and we didn't name it. Ember chose its name and its form, and it reshapes itself as the room changes." | Point the camera at a person close up, then at the ceiling or the screen. |
| 1:10–1:35 | "It doesn't copy what it sees. It reacts to it. Watch the color and where it goes in the scene." | Hold a bright object close to the lens (a colored notebook, a lit screen, a shiny can) and keep it there. |
| 1:35–2:00 | "Sound counts too. Can I get some noise?" | Clap a fast rhythm near the phone, and ask the audience to clap or cheer. Keep the camera on them. |
| 2:00–2:20 | "And when the room goes quiet, it changes again." | Stop talking. Point the phone at a plain wall and hold still for about 15 seconds. |
| 2:20–2:45 | "Here's the meter. It adds up OpenRouter's reported cost for every look. So far it's ______ for ______ looks. That's about ______ a look, so one dollar buys roughly ______ looks." (read the live numbers; do the division beforehand from a rehearsal run and update it on the spot if it differs) | Hold the phone still on the audience so the meter stays readable. |
| 2:45–3:00 | "Penny Avatar: one phone, one model, and a dollar's budget, and it keeps reacting to whatever is in the room. Thank you." | Turn the camera back to the audience and wave it slowly. |

## One-minute cut (submission video)

The timestamps are for the edited video. Record the laptop at `?mirror=1` with a screen recorder while you run the phone, and give each beat 15 to 25 seconds of real time so a look can land. Record the narration afterwards as a voiceover, so the quiet beat stays quiet for the microphone. You can trim the waiting between looks, but keep the meter readings as they were.

| Time | Say | Do on the phone |
| --- | --- | --- |
| 0:00–0:12 | "Penny Avatar. A phone watches and listens to the room, and Muse Ember, through OpenRouter, redesigns this avatar every few seconds, for a fraction of a cent each time." | Camera on a person or the room. |
| 0:12–0:27 | "Each look sends four seconds of sound and one photo. Ember says what it saw and heard, then chooses the avatar's form, colors and motion. It reacts; it doesn't copy." | Hold a bright object close to the lens. |
| 0:27–0:42 | "Noise changes it. So does quiet." | Clap near the phone; then point at a plain wall and stay silent. |
| 0:42–0:55 | "The meter reads OpenRouter's reported cost: ______ for ______ looks, about ______ each. A dollar buys roughly ______ looks." | Hold still so the meter is readable. |
| 0:55–1:00 | "One phone, one model, one dollar." | Camera back to the room. |

## Credits

Built on the Meta IWSDK build-day starter (`build-day-starter/`, an IWSDK + Vite + TypeScript WebXR app). Muse Ember by Meta, served through OpenRouter.
