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
        const route = routes[path];
        if (!route) return next();
        if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
        if (!hasKey() && !isMock()) {
          return send(res, 503, { error: 'OPENROUTER_API_KEY is not set on the dev server (see RUN-SHEET.md)' });
        }
        try {
          send(res, 200, await route(await readBody(req)));
        } catch (err: any) {
          server.config.logger.error(`[muse] ${path}: ${err?.message ?? err}`);
          send(res, 502, { error: String(err?.message ?? err) });
        }
      });
    },
  };
}
