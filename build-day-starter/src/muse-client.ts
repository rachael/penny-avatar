// Browser side of the Muse calls. Relative URLs, so it works the same on the
// laptop and on a headset that opened the laptop's LAN address.
import { sanitizeSpec, type AvatarSpec } from './avatar/spec.js';

export interface AvatarResult {
  spec: AvatarSpec;
  verdict: string | null;
  changes: string[];
  models: string;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

export async function requestAvatar(brief: string, review = true): Promise<AvatarResult> {
  const data = await post<any>('/api/avatar', { brief, review });
  return {
    spec: sanitizeSpec(data.spec),
    verdict: data.review?.verdict ?? null,
    changes: Array.isArray(data.review?.changes) ? data.review.changes.slice(0, 5) : [],
    models: [data.design?.model, data.review?.model].filter(Boolean).join(' + '),
  };
}

export interface Stroke {
  color: string;
  width: number;
  points: [number, number][];
}

export async function requestCanvasTurn(image: string, note: string) {
  const data = await post<any>('/api/canvas', { image, note });
  const strokes: Stroke[] = (Array.isArray(data.strokes) ? data.strokes : [])
    .slice(0, 24)
    .map((s: any) => ({
      color: /^#[0-9a-f]{6}$/i.test(s?.color) ? s.color : '#ffffff',
      width: Math.min(24, Math.max(1, Number(s?.width) || 4)),
      points: (Array.isArray(s?.points) ? s.points : [])
        .slice(0, 80)
        .filter((p: any) => Array.isArray(p) && p.length >= 2)
        .map((p: any) => [Math.min(1, Math.max(0, Number(p[0]) || 0)), Math.min(1, Math.max(0, Number(p[1]) || 0))]),
    }))
    .filter((s: Stroke) => s.points.length > 1);
  return { caption: String(data.caption ?? ''), strokes };
}

export async function requestImage(prompt: string): Promise<string> {
  return (await post<{ url: string }>('/api/image', { prompt })).url;
}

export async function health(): Promise<{ key: boolean; mock: boolean; models: Record<string, string> } | null> {
  try {
    return await (await fetch('/api/health')).json();
  } catch {
    return null;
  }
}
