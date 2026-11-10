// Vite dev-server plugin: /api/* routes that call Muse on OpenRouter from Node.
// The headset and the browser only ever talk to this server; the key stays here.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import {
  chatJson,
  generateImage,
  hasKey,
  isMock,
  loadPrompt,
  models,
  saveRun,
} from './openrouter.mjs';
import { mockCanvas, mockReview, mockSpec } from './mock.mjs';

function readBody(req: IncomingMessage, limit = 8_000_000): Promise<any> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) reject(new Error('body too large'));
      else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

// Live mode: the phone posts what it senses; the laptop mirror polls /api/state.
// One shared state per dev server (one phone driving, any number of mirrors).
// Fallback price if OpenRouter doesn't report usage.cost: $0.10 / $0.50 per M tokens.
const PRICE_IN = 0.1 / 1e6;
const PRICE_OUT = 0.5 / 1e6;
const live = {
  seq: 0,
  spec: null as unknown,
  base: null as unknown,
  saw: '',
  heard: '',
  feeling: '',
  frame: '',
  ms: 0,
  model: '',
  error: '',
  meter: { cost: 0, looks: 0, promptTokens: 0, completionTokens: 0, estimated: false, budget: 1 },
};

const MOTION_PATHS = ['orbit', 'dart', 'wander', 'hover'];
function mockSense() {
  const spec: any = mockSpec();
  const r = () => Math.round((Math.random() * 2 - 1) * 100) / 100;
  spec.motion = {
    x: r(), y: r() * 0.7, z: r() * 0.6,
    path: MOTION_PATHS[Math.floor(Math.random() * MOTION_PATHS.length)],
    speed: Math.random(), jitter: Math.random() * 0.6, radius: Math.random(),
  };
  return {
    saw: 'mock frame', heard: 'mock audio', feeling: 'pretending to look',
    spec, usage: { prompt_tokens: 1200, completion_tokens: 600 }, model: 'mock', ms: 5,
  };
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export function musePlugin(root: string): Plugin {
  const routes: Record<string, (body: any) => Promise<unknown>> = {
    // Designer (Muse) proposes, reviewer refines. rounds > 1 runs the duet again.
    '/api/avatar': async (body) => {
      const brief = String(body.brief ?? '').slice(0, 1000);
      const doReview = body.review !== false;
      const rounds = Math.max(1, Math.min(3, Number(body.rounds ?? process.env.DUET_ROUNDS ?? 1)));
      if (isMock()) {
        const spec = mockSpec();
        return { spec, design: { model: 'mock', ms: 0 }, review: doReview ? mockReview(spec) : null };
      }
      const [avatarPrompt, schema, reviewPrompt] = await Promise.all([
        loadPrompt(root, 'avatar.md'),
        loadPrompt(root, 'avatar-schema.md'),
        loadPrompt(root, 'review.md'),
      ]);
      const m = models();
      const designSystem = `${avatarPrompt}\n\n${schema}`;
      const design = await chatJson({
        model: m.designer,
        system: designSystem,
        user: brief ? `Extra direction for this one: ${brief}` : 'Design yourself.',
      });
      let spec = design.json;
      const reviews: unknown[] = [];
      if (doReview) {
        for (let i = 0; i < rounds; i++) {
          const review = await chatJson({
            model: m.reviewer,
            system: `${reviewPrompt}\n\nThe brief the designer had:\n${avatarPrompt}\n\n${schema}`,
            user: JSON.stringify({ brief, spec }),
            temperature: 0.4,
          });
          if (review.json?.spec) spec = review.json.spec;
          reviews.push({ model: review.model, ms: review.ms, verdict: review.json?.verdict, changes: review.json?.changes });
        }
      }
      const result = {
        spec,
        design: { model: design.model, ms: design.ms },
        review: reviews.at(-1) ?? null,
        reviews,
        firstDraft: design.json,
      };
      await saveRun(root, 'avatar', { brief, ...result });
      return result;
    },

    // AR canvas: Muse looks at the sketch and adds strokes.
    '/api/canvas': async (body) => {
      const image = String(body.image ?? '');
      if (!image.startsWith('data:image/')) throw new Error('expected a data:image URL');
      if (isMock()) return mockCanvas();
      const result = await chatJson({
        model: models().canvas,
        system:
          'You are sketching together with a person on a shared AR canvas floating in their room. ' +
          'Look at the sketch, decide what it wants to become, and add to it. ' +
          'Return ONE JSON object: {"caption": string (one short sentence about what you added), ' +
          '"strokes": [{"color": "#rrggbb", "width": 1-24, "points": [[u, v], ...]}]} ' +
          'where u and v are 0-1 across and down the canvas. At most 24 strokes, at most 80 points each.',
        user: [
          { type: 'text', text: String(body.note ?? 'Add to this.') },
          { type: 'image_url', image_url: { url: image } },
        ] as any,
        temperature: 0.8,
      });
      await saveRun(root, 'canvas', { note: body.note, result: result.json });
      return { ...result.json, model: result.model, ms: result.ms };
    },

    // Live mode: one camera frame + ~4 s of 16 kHz mono WAV → Ember reacts by
    // reshaping and moving its own body. Returns {saw, heard, feeling, spec, meter}.
    '/api/sense': async (body) => {
      const image = String(body.image ?? '');
      const audio = String(body.audio ?? '').replace(/^data:audio\/\w+;base64,/, '');
      if (!image.startsWith('data:image/')) throw new Error('expected image as a data:image URL');
      let r: any;
      if (isMock()) r = mockSense();
      else {
        const sensePrompt = await loadPrompt(root, 'sense.md');
        const content: any[] = [
          {
            type: 'text',
            text:
              `Your body (fixed): ${JSON.stringify({ name: (live.spec as any)?.name, persona: (live.spec as any)?.persona })}\n` +
              `Last time you saw: ${live.saw || 'nothing yet'}; heard: ${live.heard || 'nothing yet'}.\n` +
              'Here is what is in front of you now. React.',
          },
          { type: 'image_url', image_url: { url: image } },
        ];
        if (audio.length > 100) content.push({ type: 'input_audio', input_audio: { data: audio, format: 'wav' } });
        const res = await chatJson({
          model: models().designer,
          system: sensePrompt,
          user: content as any,
          temperature: 0.9,
          maxTokens: 1500, // reactions only; the body comes from /api/design
        });
        r = { ...res.json, usage: res.usage, model: res.model, ms: res.ms };
      }
      const u = r.usage ?? {};
      const pt = Number(u.prompt_tokens) || 0;
      const ct = Number(u.completion_tokens) || 0;
      const reported = Number(u.cost);
      const cost = Number.isFinite(reported) && u.cost != null ? reported : pt * PRICE_IN + ct * PRICE_OUT;
      const m = live.meter;
      m.cost += cost;
      m.looks += 1;
      m.promptTokens += pt;
      m.completionTokens += ct;
      if (!(Number.isFinite(reported) && u.cost != null)) m.estimated = true;
      live.seq += 1;
      if (r.spec && typeof r.spec === 'object') {
        // Parts are the expensive bit: Ember sends them only when it reshapes
        // its asset, so keep the previous parts when a look leaves them out.
        // The body is the base Ember designed in /api/design; a look only
        // changes motion, ambient and reactions on top of it.
        const base: any = live.base ?? live.spec ?? {};
        live.spec = { ...base, motion: r.spec.motion ?? base.motion, ambient: r.spec.ambient ?? base.ambient, reactions: r.spec.reactions ?? base.reactions };
      }
      live.saw = String(r.saw ?? '').slice(0, 120);
      live.heard = String(r.heard ?? '').slice(0, 120);
      live.feeling = String(r.feeling ?? '').slice(0, 80);
      live.frame = image.length < 400_000 ? image : '';
      live.ms = r.ms ?? 0;
      live.model = r.model ?? '';
      live.error = '';
      void saveRun(root, 'sense', { saw: live.saw, heard: live.heard, feeling: live.feeling, spec: live.spec, usage: u, cost, meter: m });
      return { seq: live.seq, spec: live.spec, saw: live.saw, heard: live.heard, feeling: live.feeling, ms: live.ms, model: live.model, lookCost: cost, meter: m };
    },

    // Once per live session: Ember chooses its own avatar as a CGI asset. This
    // becomes the base body the sensing loop reacts on top of.
    '/api/design': async () => {
      if (isMock()) {
        live.base = live.spec = mockSense().spec;
      } else {
        const [designPrompt, schema] = await Promise.all([loadPrompt(root, 'design.md'), loadPrompt(root, 'avatar-schema.md')]);
        // A long parts list sometimes comes back as malformed JSON: try up to 3 times.
        let res: any;
        for (let i = 0; i < 3 && !res; i++) {
          try {
            res = await chatJson({ model: models().designer, system: `${designPrompt}\n\n${schema}`, user: 'Choose and design your avatar.', temperature: 0.7, maxTokens: 6000 });
          } catch (err) {
            if (i === 2) throw err;
          }
        }
        const s: any = res.json?.spec ?? res.json;
        live.base = live.spec = s;
        const u: any = res.usage ?? {};
        const cost = u.cost != null && Number.isFinite(Number(u.cost)) ? Number(u.cost) : (Number(u.prompt_tokens) || 0) * PRICE_IN + (Number(u.completion_tokens) || 0) * PRICE_OUT;
        live.meter.cost += cost;
        live.meter.promptTokens += Number(u.prompt_tokens) || 0;
        live.meter.completionTokens += Number(u.completion_tokens) || 0;
        void saveRun(root, 'design', { spec: s, usage: u, cost, ms: res.ms });
      }
      live.seq += 1;
      live.feeling = 'chose its avatar';
      return { seq: live.seq, spec: live.spec, feeling: live.feeling, meter: live.meter };
    },

    '/api/reset': async () => {
      live.seq += 1;
      live.spec = null;
      live.base = null;
      live.saw = live.heard = live.feeling = live.frame = '';
      live.meter = { cost: 0, looks: 0, promptTokens: 0, completionTokens: 0, estimated: false, budget: 1 };
      return { ok: true };
    },

    // Optional: Muse Image texture for the avatar (?img=1 on the page).
    '/api/image': async (body) => {
      if (isMock()) throw new Error('image route has no mock');
      const url = await generateImage({ model: models().image, prompt: String(body.prompt ?? '').slice(0, 2000) });
      return { url };
    },
  };

  return {
    name: 'muse-openrouter',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = (req.url ?? '').split('?')[0];
        if (path === '/api/health') {
          return send(res, 200, { key: hasKey(), mock: isMock(), models: models() });
        }
        if (path === '/api/state') {
          // Mirror polling. ?since=N skips the frame when nothing changed.
          const since = Number(new URL(req.url ?? '', 'http://x').searchParams.get('since') ?? -1);
          const fresh = since !== live.seq;
          return send(res, 200, { ...live, frame: fresh ? live.frame : '', spec: fresh ? live.spec : null });
        }
        const route = routes[path];
        if (!route) return next();
        if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
        if (!hasKey() && !isMock()) {
          return send(res, 503, { error: 'OPENROUTER_API_KEY is not set on the dev server (see RUN-SHEET.md)' });
        }
        try {
          send(res, 200, await route(await readBody(req)));
        } catch (err: any) {
          if (path === '/api/sense') live.error = String(err?.message ?? err).slice(0, 300);
          server.config.logger.error(`[muse] ${path}: ${err?.message ?? err}`);
          send(res, 502, { error: String(err?.message ?? err) });
        }
      });
    },
  };
}
