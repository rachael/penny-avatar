// Live mode (?live=1, the phone): camera + mic → every ~6 s, 4 s of 16 kHz mono
// WAV plus one 512 px JPEG go to /api/sense; Muse Ember answers with a new body
// and motion as its own reaction, and a spend meter keeps the running cost.
// Mirror mode (?mirror=1, the laptop): polls /api/state and follows the phone.
import { sanitizeSpec } from './avatar/spec.js';
import { liveBus } from './live-bus.js';

const params = new URLSearchParams(location.search);
export const liveMode: 'live' | 'mirror' | null =
  params.get('mirror') === '1' ? 'mirror' : params.get('live') === '1' ? 'live' : null;

const LOOK_EVERY_MS = 6000;
const AUDIO_SECONDS = 4;
const TARGET_RATE = 16000;
const FRAME_PX = 512;

interface Meter {
  cost: number;
  looks: number;
  promptTokens: number;
  completionTokens: number;
  estimated: boolean;
  budget: number;
}

// ---------- overlay: meter + saw/heard (rows keep their space, nothing jumps) ----------
function mountOverlay() {
  const el = document.createElement('div');
  el.id = 'penny';
  el.innerHTML = `
    <style>
      #hud { display: none !important; }
      #penny { position: fixed; left: 0; right: 0; bottom: 0; z-index: 20; padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
        font: 14px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace; color: #f5f3ea;
        background: linear-gradient(to top, rgba(10,9,6,.88), rgba(10,9,6,.55) 75%, rgba(10,9,6,0)); pointer-events: none; }
      #penny .top { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
      #penny .brand { font-weight: 700; letter-spacing: .08em; text-transform: uppercase; font-size: 12px; color: #e9b949; }
      #penny .cost { font-size: 26px; font-weight: 700; color: #ffd66b; font-variant-numeric: tabular-nums; }
      #penny .cost small { font-size: 14px; color: #c9c3b0; font-weight: 400; }
      #penny .bar { height: 4px; background: rgba(255,255,255,.12); border-radius: 2px; margin: 6px 0 8px; overflow: hidden; }
      #penny .bar i { display: block; height: 100%; width: 0; background: #e9b949; transition: width .6s; }
      #penny .stats { color: #c9c3b0; font-size: 12px; min-height: 1.35em; }
      #penny .row { min-height: 1.35em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      #penny .row b { color: #e9b949; font-weight: 600; display: inline-block; width: 4.2em; }
      #penny .status { color: #9c968a; font-size: 12px; min-height: 1.35em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      #penny button { pointer-events: auto; font: inherit; font-size: 16px; font-weight: 700; padding: 12px 18px; border-radius: 999px;
        border: 0; background: #e9b949; color: #1a1406; margin-top: 8px; width: 100%; }
      #penny-cam { position: fixed; top: 12px; right: 12px; z-index: 20; width: 96px; border-radius: 10px; border: 1px solid rgba(255,255,255,.25);
        background: #000; aspect-ratio: 3/4; object-fit: cover; }
      #penny-cam:not([src]):not([srcObject]) { visibility: hidden; }
    </style>
    <div class="top"><span class="brand">Penny Avatar · Muse Ember</span><span class="name" id="p-name">&nbsp;</span></div>
    <div class="cost" id="p-cost">$0.0000 <small>of $1.00</small></div>
    <div class="bar"><i id="p-bar"></i></div>
    <div class="stats" id="p-stats">0 looks · 0 tokens</div>
    <div class="row"><b>saw</b><span id="p-saw">&nbsp;</span></div>
    <div class="row"><b>heard</b><span id="p-heard">&nbsp;</span></div>
    <div class="row"><b>feels</b><span id="p-feel">&nbsp;</span></div>
    <div class="status" id="p-status">&nbsp;</div>`;
  document.body.appendChild(el);
  const $ = (id: string) => el.querySelector<HTMLElement>('#' + id)!;
  return {
    el,
    meter(m: Meter) {
      $('p-cost').innerHTML = `$${m.cost.toFixed(4)} <small>of $${m.budget.toFixed(2)}${m.estimated ? ' (est.)' : ''}</small>`;
      $('p-bar').style.width = `${Math.min(100, (m.cost / m.budget) * 100)}%`;
      const tokens = m.promptTokens + m.completionTokens;
      const per = m.looks ? m.cost / m.looks : 0;
      const left = per > 0 ? Math.floor((m.budget - m.cost) / per) : 0;
      $('p-stats').textContent =
        `${m.looks} look${m.looks === 1 ? '' : 's'} · ${tokens.toLocaleString()} tokens` +
        (per > 0 ? ` · $${per.toFixed(5)}/look · ~${left.toLocaleString()} looks left` : '');
    },
    sensed(saw: string, heard: string, feeling: string, name: string) {
      $('p-saw').textContent = saw || ' ';
      $('p-heard').textContent = heard || ' ';
      $('p-feel').textContent = feeling || ' ';
      $('p-name').textContent = name || ' ';
    },
    status(t: string) {
      $('p-status').textContent = t || ' ';
    },
  };
}

// ---------- audio: keep a rolling buffer, cut 4 s, resample to 16 kHz, encode WAV ----------
class AudioTap {
  private ctx: AudioContext;
  private ring: Float32Array;
  private write = 0;
  private filled = 0;
  constructor(stream: MediaStream) {
    this.ctx = new AudioContext();
    const rate = this.ctx.sampleRate;
    this.ring = new Float32Array(Math.ceil(rate * AUDIO_SECONDS));
    const src = this.ctx.createMediaStreamSource(stream);
    // ScriptProcessor is deprecated but works everywhere without a worklet file.
    const proc = this.ctx.createScriptProcessor(4096, 1, 1);
    proc.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      for (let i = 0; i < input.length; i++) {
        this.ring[this.write] = input[i];
        this.write = (this.write + 1) % this.ring.length;
      }
      this.filled = Math.min(this.ring.length, this.filled + input.length);
    };
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    src.connect(proc);
    proc.connect(mute);
    mute.connect(this.ctx.destination);
  }
  resume() {
    return this.ctx.resume();
  }
  /** Last AUDIO_SECONDS as base64 16-bit PCM WAV at 16 kHz mono. */
  wavBase64(): string {
    const n = this.filled;
    if (n < 1000) return '';
    const ordered = new Float32Array(n);
    const start = (this.write - n + this.ring.length) % this.ring.length;
    for (let i = 0; i < n; i++) ordered[i] = this.ring[(start + i) % this.ring.length];
    const ratio = this.ctx.sampleRate / TARGET_RATE;
    const outLen = Math.floor(n / ratio);
    const pcm = new Int16Array(outLen);
    for (let i = 0; i < outLen; i++) {
      // average the source samples in this output slot (cheap low-pass + decimate)
      const a = Math.floor(i * ratio);
      const b = Math.min(n, Math.floor((i + 1) * ratio));
      let sum = 0;
      for (let j = a; j < b; j++) sum += ordered[j];
      const v = Math.max(-1, Math.min(1, sum / Math.max(1, b - a)));
      pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
    }
    const buf = new ArrayBuffer(44 + pcm.byteLength);
    const dv = new DataView(buf);
    const str = (o: number, s: string) => [...s].forEach((c, k) => dv.setUint8(o + k, c.charCodeAt(0)));
    str(0, 'RIFF');
    dv.setUint32(4, 36 + pcm.byteLength, true);
    str(8, 'WAVE');
    str(12, 'fmt ');
    dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true); // PCM
    dv.setUint16(22, 1, true); // mono
    dv.setUint32(24, TARGET_RATE, true);
    dv.setUint32(28, TARGET_RATE * 2, true);
    dv.setUint16(32, 2, true);
    dv.setUint16(34, 16, true);
    str(36, 'data');
    dv.setUint32(40, pcm.byteLength, true);
    new Uint8Array(buf, 44).set(new Uint8Array(pcm.buffer));
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
}

function grabFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement): string {
  const w = video.videoWidth, h = video.videoHeight;
  if (!w || !h) return '';
  const s = FRAME_PX / Math.max(w, h);
  canvas.width = Math.round(w * s);
  canvas.height = Math.round(h * s);
  canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.72);
}

// ---------- live (phone) ----------
async function startLive(ov: ReturnType<typeof mountOverlay>) {
  const btn = document.createElement('button');
  btn.textContent = 'Let it see and hear';
  ov.el.appendChild(btn);
  ov.status('Tap to give the avatar your camera and mic.');
  await new Promise<void>((r) => btn.addEventListener('click', () => r(), { once: true }));
  btn.remove();

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: true },
    });
  } catch (err) {
    ov.status(`Camera/mic blocked: ${(err as Error).message}. Needs HTTPS and permission.`);
    return;
  }
  const video = document.createElement('video');
  video.id = 'penny-cam';
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  document.body.appendChild(video);
  await video.play().catch(() => {});
  // index.ts puts the camera feed behind the avatar, so it floats in the room.
  window.dispatchEvent(new CustomEvent('penny-camera', { detail: video }));
  const tap = new AudioTap(stream);
  await tap.resume();
  const canvas = document.createElement('canvas');

  let inFlight = false;
  const look = async () => {
    if (inFlight) return;
    const image = grabFrame(video, canvas);
    if (!image) return;
    inFlight = true;
    ov.status('Ember is looking and listening…');
    const t0 = performance.now();
    try {
      const res = await fetch('/api/sense', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image, audio: tap.wavBase64() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      apply(ov, data);
      ov.status(`${data.model ?? 'ember'} · ${((performance.now() - t0) / 1000).toFixed(1)} s · $${Number(data.lookCost ?? 0).toFixed(5)} this look`);
    } catch (err) {
      ov.status(`Look failed: ${(err as Error).message}`);
    } finally {
      inFlight = false;
    }
  };
  // First look once the audio buffer has ~4 s in it, then every ~6 s.
  setTimeout(() => {
    void look();
    setInterval(() => void look(), LOOK_EVERY_MS);
  }, AUDIO_SECONDS * 1000);
}

let lastName = '';
function apply(ov: ReturnType<typeof mountOverlay>, data: any) {
  if (data.meter) ov.meter(data.meter);
  if (data.spec) {
    const spec = sanitizeSpec(data.spec);
    lastName = spec.name;
    liveBus.emit(spec);
  }
  ov.sensed(data.saw ?? '', data.heard ?? '', data.feeling ?? '', lastName);
}

// ---------- mirror (laptop) ----------
function startMirror(ov: ReturnType<typeof mountOverlay>) {
  const img = document.createElement('img');
  img.id = 'penny-cam';
  img.style.width = '160px';
  img.alt = 'What the phone last showed Ember';
  document.body.appendChild(img);
  let seq = -1;
  ov.status('Mirroring the phone. Waiting for its first look…');
  const poll = async () => {
    try {
      const data = await (await fetch(`/api/state?since=${seq}`)).json();
      if (data.seq !== seq) {
        seq = data.seq;
        if (data.frame) img.src = data.frame;
        apply(ov, data);
        if (data.seq > 0) ov.status(`mirroring · look #${data.meter.looks} · ${data.model} · ${(data.ms / 1000).toFixed(1)} s`);
      }
      if (data.error) ov.status(`phone's last look failed: ${data.error}`);
    } catch {
      ov.status('Lost the dev server; retrying…');
    }
  };
  void poll();
  setInterval(poll, 1000);
}

export function startLiveMode() {
  if (!liveMode) return;
  const ov = mountOverlay();
  if (liveMode === 'live') void startLive(ov);
  else startMirror(ov);
}
