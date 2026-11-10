// Server-side OpenRouter client. Runs only in Node (the Vite dev server and
// scripts/), so the API key never reaches the browser or the headset.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

export const models = () => ({
  // Muse Ember: newest Muse on OpenRouter (Nov 9 2026). Text/image/video/audio in,
  // text out, structured outputs, cheap. Swap with MUSE_MODEL.
  designer: process.env.MUSE_MODEL || 'meta/muse-ember',
  // Second pass of the duet. Any OpenRouter model id works here, Muse or not.
  reviewer: process.env.REVIEW_MODEL || 'meta/muse-spark-1.3',
  // Sketch partner on the AR canvas (needs image input).
  canvas: process.env.CANVAS_MODEL || process.env.MUSE_MODEL || 'meta/muse-ember',
  image: process.env.IMAGE_MODEL || 'meta/muse-image',
});

export const hasKey = () => Boolean(process.env.OPENROUTER_API_KEY);
export const isMock = () => process.env.MUSE_MOCK === '1';

export async function loadPrompt(root, name) {
  const text = await readFile(join(root, 'prompts', name), 'utf8');
  return text.replace(/<!--[\s\S]*?-->/g, '').trim();
}

/** Pull the first JSON object out of a model reply (handles ``` fences and chatter). */
export function extractJson(text) {
  if (typeof text !== 'string') throw new Error('empty reply');
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object in reply');
  return JSON.parse(body.slice(start, end + 1));
}

async function post(body) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'X-Title': 'Penny Avatar',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`OpenRouter ${res.status}: ${text.slice(0, 400)}`);
    err.status = res.status;
    throw err;
  }
  return JSON.parse(text);
}

/**
 * Chat call that returns parsed JSON. Tries structured output first and falls
 * back to plain text + extraction if the model or provider rejects it.
 */
export async function chatJson({ model, system, user, temperature = 0.9, maxTokens = 4000 }) {
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
  // usage.include asks OpenRouter to report the real cost (usage.cost) for the spend meter.
  const base = { model, messages, temperature, max_tokens: maxTokens, usage: { include: true } };
  if (process.env.MUSE_REASONING) base.reasoning = { effort: process.env.MUSE_REASONING };
  const t0 = Date.now();
  let data;
  try {
    data = await post({ ...base, response_format: { type: 'json_object' } });
  } catch (err) {
    if (err.status !== 400) throw err;
    data = await post(base); // provider didn't accept response_format
  }
  const content = data?.choices?.[0]?.message?.content;
  const text = Array.isArray(content) ? content.map((c) => c.text ?? '').join('') : content;
  return { json: extractJson(text), ms: Date.now() - t0, model: data?.model ?? model, usage: data?.usage };
}

/** Image generation (Muse Image). Returns a data: or https: URL, or throws. */
export async function generateImage({ model, prompt }) {
  const data = await post({
    model,
    messages: [{ role: 'user', content: prompt }],
    modalities: ['image', 'text'],
  });
  const msg = data?.choices?.[0]?.message ?? {};
  const url =
    msg.images?.[0]?.image_url?.url ??
    (Array.isArray(msg.content) ? msg.content.find((c) => c.type === 'image_url')?.image_url?.url : undefined);
  if (!url) throw new Error('no image in reply');
  return url;
}

/** Keep a record of every generation for the demo and for reuse. */
export async function saveRun(root, kind, payload) {
  try {
    const dir = join(root, 'generated');
    await mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await writeFile(join(dir, `${stamp}-${kind}.json`), JSON.stringify(payload, null, 2));
  } catch {
    /* best effort */
  }
}
