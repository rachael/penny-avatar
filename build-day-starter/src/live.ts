// Live mode (?live=1, the phone): camera + mic → every ~6 s, 4 s of 16 kHz mono
// WAV plus one 512 px JPEG go to /api/sense; Muse Ember answers with a new body
// and motion as its own reaction, and a slim spend meter keeps the running cost.
// The camera feed fills the screen behind a transparent canvas and the 3D camera
// turns with the phone, so the avatar stays put in the room.
// Mirror mode (?mirror=1, the laptop): polls /api/state and follows the phone,
// with the phone's last frame as the backdrop.
import { sanitizeSpec } from './avatar/spec.js';
import { recentreGyro, startGyro } from './gyro.js';
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

const fmtTokens = (n: number) => (n >= 10000 ? `${(n / 1000).toFixed(0)}k` : n.toLocaleString());

// ---------- slim meter: one strip at the top, two short lines (nothing jumps) ----------
function mountOverlay() {
  const el = document.createElement('div');
  el.id = 'penny';
  el.innerHTML = `
    <style>
      #hud { display: none !important; }
      #scene-container canvas { position: relative; z-index: 1; }
      .penny-backdrop { position: fixed; inset: 0; width: 100vw; height: 100vh; object-fit: cover; z-index: 0; background: #0d0b07; }
      #penny { position: fixed; left: 0; right: 0; top: 0; z-index: 20; pointer-events: none;
        padding: calc(6px + env(safe-area-inset-top)) 12px 0; font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
        color: rgba(245,243,234,.92); text-shadow: 0 1px 2px rgba(0,0,0,.7); }
      #penny .l1, #penny .l2 { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-height: 1.45em; }
      #penny .l1 b { color: #ffd66b; font-weight: 700; font-variant-numeric: tabular-nums; }
      #penny .l1 .dim, #penny .l2 { color: rgba(245,243,234,.62); }
      #penny .l2.err { color: #ff9d8a; }
      #penny .bar { height: 2px; margin-top: 3px; background: rgba(255,255,255,.14); border-radius: 1px; overflow: hidden; }
      #penny .bar i { display: block; height: 100%; width: 0; background: #e9b949; transition: width .6s; }
      #penny-go { position: fixed; left: 50%; bottom: calc(28px + env(safe-area-inset-bottom)); transform: translateX(-50%); z-index: 21;
        font: 600 15px/1 system-ui, sans-serif; padding: 14px 22px; border-radius: 999px; border: 0; background: #e9b949; color: #1a1406;
        box-shadow: 0 6px 24px rgba(0,0,0,.4); }
    </style>
    <div class="l1"><b id="p-cost">$0.0000</b> <span class="dim">of $1.00</span> · <span id="p-looks">0 looks</span> <span class="dim" id="p-tok">· 0 tokens</span> <span class="dim" id="p-name"></span></div>
    <div class="bar"><i id="p-bar"></i></div>
    <div class="l2" id="p-l2">Penny Avatar · Muse Ember</div>`;
  document.body.appendChild(el);
  const $ = (id: string) => el.querySelector<HTMLElement>('#' + id)!;
  let sensedText = '';
  return {
    meter(m: Meter) {
      $('p-cost').textContent = `$${m.cost.toFixed(4)}`;
      $('p-bar').style.width = `${Math.min(100, (m.cost / m.budget) * 100)}%`;
      $('p-looks').textContent = `${m.looks} look${m.looks === 1 ? '' : 's'}`;
      $('p-tok').textContent = `· ${fmtTokens(m.promptTokens + m.completionTokens)} tokens${m.estimated ? ' (est.)' : ''}`;
    },
    sensed(saw: string, heard: string, feeling: string, name: string) {
      sensedText = [saw && `saw ${saw}`, heard && `heard ${heard}`, feeling && `→ ${feeling}`].filter(Boolean).join(' · ');
      $('p-name').textContent = name ? `· ${name}` : '';
      this.status('');
    },
    /** Errors and hints borrow line 2 for a moment, then the last saw/heard returns. */
    status(t: string, isError = false) {
      const l2 = $('p-l2');
      l2.textContent = t || sensedText || 'Penny Avatar · Muse Ember';
      l2.classList.toggle('err', Boolean(t) && isError);
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
  btn.id = 'penny-go';
  btn.textContent = 'Let it see and hear';
  document.body.appendChild(btn);
  ov.status('Tap below to give it your camera and mic.');
  await new Promise<void>((r) => btn.addEventListener('click', () => r(), { once: true }));
  btn.remove();
  void startGyro(); // in the same gesture, for browsers that ask

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: true },
    });
  } catch (err) {
    ov.status(`Camera/mic blocked: ${(err as Error).message}. Needs HTTPS and permission.`, true);
    return;
  }
  // The live camera is the room; the transparent 3D canvas sits on top of it.
  const video = document.createElement('video');
  video.className = 'penny-backdrop';
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  document.body.prepend(video);
  await video.play().catch(() => {});
  recentreGyro(); // "home" is wherever the phone points now
  const tap = new AudioTap(stream);
  await tap.resume();
  const canvas = document.createElement('canvas');
  ov.status('Listening… first look in a few seconds.');

  let inFlight = false;
  const look = async () => {
    if (inFlight) return;
    const image = grabFrame(video, canvas);
    if (!image) return;
    inFlight = true;
    try {
      const res = await fetch('/api/sense', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image, audio: tap.wavBase64() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      apply(ov, data);
    } catch (err) {
      ov.status(`Look failed: ${(err as Error).message}`, true);
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
  img.className = 'penny-backdrop';
  img.alt = '';
  img.style.filter = 'brightness(.8)';
  document.body.prepend(img);
  img.style.visibility = 'hidden';
  img.addEventListener('load', () => (img.style.visibility = 'visible'));
  let seq = -1;
  ov.status('Mirroring the phone. Waiting for its first look…');
  const poll = async () => {
    try {
      const data = await (await fetch(`/api/state?since=${seq}`)).json();
      if (data.seq !== seq) {
        seq = data.seq;
        if (data.frame) img.src = data.frame;
        apply(ov, data);
      }
      if (data.error) ov.status(`Phone's last look failed: ${data.error}`, true);
    } catch {
      ov.status('Lost the dev server; retrying…', true);
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
