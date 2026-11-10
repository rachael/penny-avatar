// Places the avatar in the room and makes it reactive and ambient:
// - ambient: gentle pulse, drift, slow hue shift, blinking, idle particle orbit
// - reactive: viewer comes near (head or hands), looks/points at it (gaze or ray
//   hover), pinches/clicks it (press), walks away (leave)
import { createSystem, Group, Hovered, Pressed, RayInteractable, Vector3, type Entity } from '@iwsdk/core';
import { requestAvatar } from '../muse-client.js';
import { ui } from '../ui.js';
import { buildAvatar, type AvatarRig } from './build.js';
import { FALLBACK_SPEC, type AvatarSpec, type Reaction } from './spec.js';

// Where the avatar floats, relative to the player's starting spot (metres).
// Chest height and about a metre out keeps it inside Meta VR Glasses' narrow view.
const HOME = new Vector3(0, 1.3, -1.0);
const NEAR_HEAD = 0.85;
const NEAR_HAND = 0.35;

type Mode = 'idle' | 'near' | 'gaze' | 'press' | 'leave';

export class AvatarSystem extends createSystem({}) {
  private anchor = new Group();
  private entity!: Entity;
  private rig: AvatarRig | null = null;
  private spec: AvatarSpec = FALLBACK_SPEC;
  private customFailed = false;
  private busy = false;

  private energy = 0;
  private attention = 0;
  private spinVel = 0;
  private pop = 0;
  private burst = 0;
  private tintAmt = 0;
  private mode: Mode = 'idle';
  private wasPressed = false;
  private wasNear = false;
  private nextBlink = 3;
  private t = 0;

  private tmpA = new Vector3();
  private tmpB = new Vector3();

  init(): void {
    this.anchor.name = 'avatar-anchor';
    this.anchor.position.copy(HOME);
    this.entity = this.world.createTransformEntity(this.anchor);
    // One ray target for controllers, hands, gaze (glasses) and the mouse.
    this.entity.addComponent(RayInteractable);

    // If Muse's custom GLSL fails to compile, fall back to the built-in surface.
    const renderer = this.world.renderer;
    renderer.debug.checkShaderErrors = true;
    renderer.debug.onShaderError = (gl, _program, vs, fs) => {
      const src = gl.getShaderSource(fs) ?? '';
      const log = gl.getShaderInfoLog(fs) || gl.getShaderInfoLog(vs) || '';
      console.warn('[avatar] shader error\n', log);
      if (src.includes('HAS_MUSE_SURFACE') && !this.customFailed) {
        this.customFailed = true;
        ui.setStatus(`${this.spec.name}: Muse's custom shader didn't compile, using the built-in surface.`);
        queueMicrotask(() => this.show(this.spec, false));
      }
    };

    this.show(FALLBACK_SPEC);
    this.cleanupFuncs.push(
      ui.onCommand((cmd, arg) => {
        if (cmd === 'new-avatar') void this.generate(arg ?? '');
      }),
    );
  }

  /** Swap in a new body. Keeps the same entity so input targeting stays stable. */
  show(spec: AvatarSpec, allowCustomSurface = true) {
    this.rig?.dispose();
    this.spec = spec;
    if (allowCustomSurface) this.customFailed = false;
    this.rig = buildAvatar(spec, { allowCustomSurface: allowCustomSurface && !this.customFailed });
    this.anchor.add(this.rig.root);
    this.pop = 0.35; // little arrival pop
    this.burst = 1;
  }

  async generate(brief: string) {
    if (this.busy) return;
    this.busy = true;
    ui.setStatus('Muse is designing itself, then a second model reviews it...');
    try {
      const r = await requestAvatar(brief);
      this.show(r.spec);
      const notes = r.changes.length ? `\nReview: ${r.verdict ?? ''}\n- ${r.changes.join('\n- ')}` : '';
      ui.setStatus(`${r.spec.name}: ${r.spec.persona}\n(${r.models})${notes}`);
    } catch (err) {
      ui.setStatus(`Couldn't reach Muse: ${(err as Error).message}`);
    } finally {
      this.busy = false;
    }
  }

  private react(r: Reaction, dt: number, impulse = false) {
    const k = 1 - Math.exp(-dt * 4);
    this.energy += (r.energy - this.energy) * k;
    this.spinVel += (r.spin - this.spinVel) * k;
    if (r.tint) {
      this.rig?.coreUniforms.uTint.value.set(r.tint);
      this.tintAmt += (0.35 - this.tintAmt) * k;
    } else this.tintAmt *= 1 - k;
    if (impulse) {
      this.pop = Math.max(this.pop, r.scalePop);
      this.burst = Math.max(this.burst, r.burst);
    }
  }

  private distanceFromViewer(): { head: number; hand: number } {
    const center = this.anchor.getWorldPosition(this.tmpA);
    const head = this.player.head.getWorldPosition(this.tmpB).distanceTo(center);
    let hand = Infinity;
    const grips = (this.player as any).gripSpaces as Record<string, { getWorldPosition(v: Vector3): Vector3 }> | undefined;
    for (const side of ['left', 'right']) {
      const g = grips?.[side];
      if (!g || !this.world.session) continue;
      const p = g.getWorldPosition(this.tmpB);
      if (p.lengthSq() > 1e-4) hand = Math.min(hand, p.distanceTo(center));
    }
    return { head, hand };
  }

  update(delta: number): void {
    const rig = this.rig;
    if (!rig) return;
    const dt = Math.min(delta, 0.1);
    this.t += dt;
    const s = this.spec;

    // ---- reactive: decide what the viewer is doing ----
    const { head, hand } = this.distanceFromViewer();
    const near = head < NEAR_HEAD || hand < NEAR_HAND;
    const hovered = this.entity.hasComponent(Hovered);
    const pressed = this.entity.hasComponent(Pressed);
    const pressEdge = pressed && !this.wasPressed;
    const leaveEdge = this.wasNear && !near;
    this.wasPressed = pressed;
    this.wasNear = near;

    if (pressEdge) {
      this.mode = 'press';
      this.react(s.reactions.press, dt, true);
      ui.setStatus(`${s.name}: "${s.greeting}"`);
      speak(s.greeting);
    } else if (pressed) this.react(s.reactions.press, dt);
    else if (hovered) {
      if (this.mode !== 'gaze') this.react(s.reactions.gaze, dt, true);
      this.mode = 'gaze';
      this.react(s.reactions.gaze, dt);
    } else if (near) {
      if (this.mode !== 'near') this.react(s.reactions.near, dt, true);
      this.mode = 'near';
      this.react(s.reactions.near, dt);
    } else {
      if (leaveEdge) this.react(s.reactions.leave, dt, true);
      this.mode = 'idle';
      this.react(s.reactions.leave, dt);
    }
    const attentionTarget = hovered || pressed ? 1 : near ? 0.6 : Math.max(0, 1 - (head - NEAR_HEAD) / 2.5) * 0.3;
    this.attention += (attentionTarget - this.attention) * (1 - Math.exp(-dt * 3));

    // ---- ambient: pulse, drift, hue, decay impulses ----
    const pulse = Math.sin(this.t * Math.PI * 2 * s.ambient.pulseRate);
    const scale = 1 + pulse * s.ambient.pulseDepth * (1 - this.energy * 0.4) + this.pop;
    rig.root.scale.setScalar(scale);
    this.anchor.position.set(
      HOME.x + Math.sin(this.t * 0.31) * s.ambient.drift,
      HOME.y + Math.sin(this.t * 0.47) * s.ambient.drift * 0.8 + pulse * 0.01,
      HOME.z + Math.cos(this.t * 0.23) * s.ambient.drift,
    );
    this.pop *= Math.exp(-dt * 4);
    this.burst *= Math.exp(-dt * 2.5);

    rig.core.rotation.y += (0.08 + this.spinVel) * dt;
    rig.core.rotation.x = Math.sin(this.t * 0.2) * 0.15;
    rig.rings.forEach((r, i) => (r.rotation.z += s.features.rings.speed * dt * (1 + this.energy) * (i % 2 ? -1 : 1)));

    const u = rig.coreUniforms;
    u.uTime.value = this.t;
    u.uEnergy.value = this.energy;
    u.uAttention.value = this.attention;
    u.uTintAmt.value = this.tintAmt;
    u.uHue.value = Math.sin(this.t * 0.05) * s.ambient.hueShift * Math.PI;
    if (rig.particleUniforms) {
      rig.particleUniforms.uTime.value = this.t;
      rig.particleUniforms.uBurst.value = this.burst;
      rig.particleUniforms.uEnergy.value = this.energy;
    }

    // ---- face the viewer (yaw only), and blink ----
    if (s.features.eyes.followViewer) {
      const headPos = this.player.head.getWorldPosition(this.tmpB);
      const target = Math.atan2(headPos.x - this.anchor.position.x, headPos.z - this.anchor.position.z);
      let d = target - this.anchor.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.anchor.rotation.y += d * (1 - Math.exp(-dt * (2 + this.attention * 4)));
    }
    this.nextBlink -= dt;
    const blink = this.nextBlink < 0.12 ? Math.max(0.08, Math.abs(this.nextBlink - 0.06) / 0.06) : 1;
    if (this.nextBlink < 0) this.nextBlink = 2.5 + Math.random() * 4;
    rig.eyes.forEach((e) => (e.scale.y = (e.userData.baseScaleY ?? 1) * blink * (1 + this.attention * 0.15)));
  }
}

function speak(text: string) {
  try {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.02;
    window.speechSynthesis.speak(u);
  } catch {
    /* no voice on this browser */
  }
}
