// Places the avatar in the room and makes it reactive and ambient:
// - ambient: gentle pulse, drift, slow hue shift, blinking, idle particle orbit
// - reactive: viewer comes near (head or hands), looks/points at it (gaze or ray
//   hover), pinches/clicks it (press), walks away (leave)
import { createSystem, Group, Hovered, Pressed, RayInteractable, Vector3, type Entity } from '@iwsdk/core';
import { liveBus } from '../live-bus.js';
import { requestAvatar } from '../muse-client.js';
import { ui } from '../ui.js';
import { buildAvatar, type AvatarRig } from './build.js';
import { FALLBACK_SPEC, type AvatarSpec, type Reaction } from './spec.js';

// Where the avatar floats, relative to the player's starting spot (metres).
// Chest height and about a metre out keeps it inside Meta VR Glasses' narrow view.
const HOME = new Vector3(0, 1.3, -1.0);
const NEAR_HEAD = 0.85;
const NEAR_HAND = 0.35;
// Flat (phone/laptop) framing: depth band in front of the camera, and how much
// bigger the body is drawn so a 0.14 m avatar reads at 1.5-3 m on a phone.
const DEPTH_NEAR = 1.2;
const DEPTH_FAR = 3.0;
const FLAT_SCALE = 1.0; // small enough to read as a thing in the room, not a sticker
const EDGE_MARGIN = 0.06; // fraction of the half-frame kept clear at the edges

const smooth01 = (x: number) => x * x * (3 - 2 * x);

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

  // ---- free movement (all preallocated; no per-frame allocation) ----
  private camPos = new Vector3();
  private camRight = new Vector3();
  private camUp = new Vector3();
  private camFwd = new Vector3();
  private target = new Vector3();
  private basePos = new Vector3().copy(HOME); // critically-damped follow of the target
  private baseVel = new Vector3();
  private offset = new Vector3(); // smoothed path offset (camera-frame u, v, depth)
  private rawOffset = new Vector3();
  private finalPos = new Vector3();
  private pathPhase = 0;
  private dartFrom = new Vector3();
  private dartTo = new Vector3();
  private dartT = 1; // 0..1 progress of the current dart
  private dartHold = 0.5; // seconds until the next dart
  private flatMul = 1;

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
      // Live mode: Muse's reaction every few seconds. Rebuild the body but keep
      // the anchor where it is, so it glides on toward the new motion target.
      // live.ts owns the status line in live mode.
      liveBus.on((spec) => {
        // A new look every ~6 s: a softer pop than a fresh avatar, and the
        // reaction's own energy carries the feeling into the next frames.
        this.show(spec);
        this.pop = 0.12;
        this.burst = Math.max(0.3, spec.reactions.near.burst);
        this.energy = Math.max(this.energy, spec.reactions.near.energy);
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

  /**
   * Free movement. Flat mode maps motion x/y/z to a point inside the camera's
   * visible frustum (works for portrait phone and landscape laptop), adds the
   * path offset (orbit/dart/wander/hover) plus jitter, glides there with a
   * critically-damped follow, and clamps the result on screen every frame.
   * In a headset session it moves around HOME instead.
   */
  private move(dt: number, pulse: number) {
    const s = this.spec;
    const m = s.motion;
    const flat = !this.world.session;
    const cam = this.world.camera;

    // Camera frame (world axes around HOME in XR).
    let halfTan = 0;
    let aspect = 1;
    if (flat) {
      cam.updateMatrixWorld();
      this.camPos.setFromMatrixPosition(cam.matrixWorld);
      this.camRight.setFromMatrixColumn(cam.matrixWorld, 0).normalize();
      this.camUp.setFromMatrixColumn(cam.matrixWorld, 1).normalize();
      this.camFwd.setFromMatrixColumn(cam.matrixWorld, 2).normalize().negate();
      const fov = (cam as { fov?: number }).fov ?? 70;
      halfTan = Math.tan((fov * Math.PI) / 360);
      const a = (cam as { aspect?: number }).aspect;
      aspect = a && Number.isFinite(a) ? a : window.innerWidth / Math.max(1, window.innerHeight);
      // Bigger body for flat screens, capped so it never fills a portrait phone.
      const midHalf = ((DEPTH_NEAR + DEPTH_FAR) / 2) * halfTan * Math.min(1, aspect);
      this.flatMul = Math.max(0.5, Math.min(FLAT_SCALE, (0.14 * midHalf) / s.form.scale));
    } else {
      this.camPos.copy(HOME);
      this.camRight.set(1, 0, 0);
      this.camUp.set(0, 1, 0);
      this.camFwd.set(0, 0, -1);
      this.flatMul = 1;
    }
    const bodyR = s.form.scale * this.flatMul * 1.2;

    // Target in camera-frame units: depth d, then lateral u / vertical v.
    let d: number;
    let u: number;
    let v: number;
    if (flat) {
      d = DEPTH_FAR + ((m.z + 1) / 2) * (DEPTH_NEAR - DEPTH_FAR);
      const hy = Math.max(0, d * halfTan * (1 - EDGE_MARGIN) - bodyR);
      const hx = Math.max(0, d * halfTan * aspect * (1 - EDGE_MARGIN) - bodyR);
      u = m.x * hx;
      v = m.y * hy;
    } else {
      d = -m.z * 0.4; // HOME is the origin here; near = towards the player
      u = m.x * 0.5;
      v = m.y * 0.3;
    }
    this.target
      .copy(this.camPos)
      .addScaledVector(this.camFwd, d)
      .addScaledVector(this.camRight, u)
      .addScaledVector(this.camUp, v);

    // Critically-damped follow so new specs glide, never teleport.
    const omega = 1.2 + m.speed * 2.5;
    const x = omega * dt;
    const ex = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    this.tmpA.subVectors(this.basePos, this.target); // change
    this.tmpB.copy(this.baseVel).addScaledVector(this.tmpA, omega).multiplyScalar(dt); // temp
    this.baseVel.addScaledVector(this.tmpB, -omega).multiplyScalar(ex);
    this.basePos.copy(this.target).add(this.tmpA.add(this.tmpB).multiplyScalar(ex));

    // Path offset around the target (u, v, depth), scaled by radius and speed.
    const depthScale = flat ? d / 2 : 0.5;
    const A = (0.03 + m.radius * 0.45) * depthScale;
    const rate = 0.15 + m.speed * 1.6;
    this.pathPhase += rate * dt;
    const p = this.pathPhase;
    const t = this.t;
    switch (m.path) {
      case 'orbit':
        this.rawOffset.set(Math.cos(p * 2) * A, Math.sin(p * 2) * A * 0.55, Math.sin(p * 2) * A * 0.6);
        break;
      case 'wander':
        this.rawOffset.set(
          A * (Math.sin(p * 0.73) * 0.6 + Math.sin(p * 1.37 + 2.1) * 0.4),
          A * 0.7 * (Math.sin(p * 0.91 + 0.7) * 0.6 + Math.sin(p * 1.79 + 4.2) * 0.4),
          A * 0.6 * Math.sin(p * 0.53 + 1.1),
        );
        break;
      case 'dart': {
        if (this.dartT >= 1) {
          this.dartHold -= dt;
          if (this.dartHold <= 0) {
            this.dartFrom.copy(this.dartTo);
            this.dartTo.set((Math.random() * 2 - 1) * A, (Math.random() * 2 - 1) * A * 0.7, (Math.random() * 2 - 1) * A * 0.6);
            this.dartT = 0;
          }
        } else {
          this.dartT = Math.min(1, this.dartT + dt / (0.28 - m.speed * 0.16));
          if (this.dartT >= 1) this.dartHold = (2.6 - m.speed * 2.2) * (0.5 + Math.random());
        }
        this.rawOffset.lerpVectors(this.dartFrom, this.dartTo, smooth01(this.dartT));
        break;
      }
      default: // hover
        this.rawOffset.set(Math.sin(p * 0.9) * A * 0.12, Math.sin(p * 3) * A * 0.3, 0);
    }
    if (m.path !== 'dart') {
      this.dartFrom.copy(this.rawOffset);
      this.dartTo.copy(this.rawOffset);
      this.dartT = 1;
    }
    // Ambient drift and pulse bob ride on top.
    const drift = s.ambient.drift * (flat ? depthScale * 2 : 1);
    this.rawOffset.x += Math.sin(t * 0.31) * drift;
    this.rawOffset.y += Math.sin(t * 0.47) * drift * 0.8 + pulse * 0.01;
    this.rawOffset.z += Math.cos(t * 0.23) * drift;
    // Offset is smoothed too, so switching path or radius never jumps.
    const ok = 1 - Math.exp(-dt * (m.path === 'dart' ? 14 : 6));
    this.offset.lerp(this.rawOffset, ok);

    // Jitter: high-frequency shake (0 = none, 1 = twitchy).
    const J = m.jitter * m.jitter * 0.035 * (flat ? depthScale * 2 : 1);
    const jx = J * (Math.sin(t * 37.1) * 0.5 + Math.sin(t * 59.3 + 1.3) * 0.3 + (Math.random() - 0.5) * 0.4);
    const jy = J * (Math.sin(t * 43.7 + 0.4) * 0.5 + Math.sin(t * 67.9 + 2.2) * 0.3 + (Math.random() - 0.5) * 0.4);

    this.finalPos
      .copy(this.basePos)
      .addScaledVector(this.camRight, this.offset.x + jx)
      .addScaledVector(this.camUp, this.offset.y + jy)
      .addScaledVector(this.camFwd, this.offset.z);

    // Clamp on screen every frame (flat mode).
    if (flat) {
      this.tmpA.subVectors(this.finalPos, this.camPos);
      const fd = Math.min(DEPTH_FAR + 0.3, Math.max(DEPTH_NEAR - 0.2, this.tmpA.dot(this.camFwd)));
      const hy = Math.max(0, fd * halfTan * (1 - EDGE_MARGIN) - bodyR);
      const hx = Math.max(0, fd * halfTan * aspect * (1 - EDGE_MARGIN) - bodyR);
      const fu = Math.min(hx, Math.max(-hx, this.tmpA.dot(this.camRight)));
      const fv = Math.min(hy, Math.max(-hy, this.tmpA.dot(this.camUp)));
      this.finalPos
        .copy(this.camPos)
        .addScaledVector(this.camFwd, fd)
        .addScaledVector(this.camRight, fu)
        .addScaledVector(this.camUp, fv);
    }
    this.anchor.position.copy(this.finalPos);
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
    this.move(dt, pulse);
    rig.root.scale.setScalar(scale * this.flatMul);
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
