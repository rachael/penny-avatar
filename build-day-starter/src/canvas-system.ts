// STRETCH: an AR canvas you sketch on, and Muse adds to (it sees the sketch as
// an image). Hidden until toggled: C key, the HUD, the panel, or ?canvas=1.
// Draw with: mouse drag (browser), controller trigger or hand pinch while
// pointing (Quest), gaze + pinch (Meta VR Glasses).
import {
  CanvasTexture,
  createSystem,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Pressed,
  RayInteractable,
  Raycaster,
  Vector2,
  Vector3,
  type Entity,
  type Object3D,
} from '@iwsdk/core';
import { requestCanvasTurn, type Stroke } from './muse-client.js';
import { ui } from './ui.js';

const SIZE = 1024;
const W = 0.9; // metres
const H = 0.6;

export class CanvasSystem extends createSystem({}) {
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private texture = new CanvasTexture(this.canvas);
  private plane!: Mesh;
  private entity!: Entity;
  private raycaster = new Raycaster();
  private mouse = new Vector2();
  private mouseDown = false;
  private last = new Map<string, Vector2>();
  private color = '#f4f4f5';
  private pending: Stroke[] = [];
  private busy = false;

  init(): void {
    this.canvas.width = SIZE;
    this.canvas.height = Math.round((SIZE * H) / W);
    this.clear();
    this.plane = new Mesh(
      new PlaneGeometry(W, H),
      new MeshBasicMaterial({ map: this.texture, transparent: true, side: DoubleSide, depthWrite: false }),
    );
    this.plane.name = 'ar-canvas';
    this.plane.position.set(0.7, 1.3, -1.15);
    this.plane.rotation.y = -0.45;
    this.plane.visible = new URLSearchParams(location.search).has('canvas');
    this.entity = this.world.createTransformEntity(this.plane);
    this.entity.addComponent(RayInteractable);

    const el = this.world.renderer.domElement;
    const toNdc = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    };
    const down = (e: PointerEvent) => (toNdc(e), (this.mouseDown = true));
    const move = (e: PointerEvent) => toNdc(e);
    const up = () => ((this.mouseDown = false), this.last.delete('mouse'));
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    this.cleanupFuncs.push(
      () => el.removeEventListener('pointerdown', down),
      () => el.removeEventListener('pointermove', move),
      () => window.removeEventListener('pointerup', up),
      ui.onCommand((cmd) => {
        if (cmd === 'toggle-canvas') {
          this.plane.visible = !this.plane.visible;
          ui.setStatus(this.plane.visible ? 'AR canvas on. Sketch, then ask Muse to add to it.' : 'AR canvas hidden.');
        }
        if (cmd === 'canvas-clear') this.clear();
        if (cmd === 'canvas-muse') void this.museTurn();
      }),
    );
  }

  private clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.fillStyle = 'rgba(12,12,18,0.55)';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    this.ctx.lineWidth = 4;
    this.ctx.strokeRect(2, 2, this.canvas.width - 4, this.canvas.height - 4);
    this.texture.needsUpdate = true;
  }

  private line(from: Vector2, to: Vector2, color: string, width: number) {
    const c = this.ctx;
    c.strokeStyle = color;
    c.lineWidth = width;
    c.lineCap = 'round';
    c.shadowColor = color;
    c.shadowBlur = width * 1.5;
    c.beginPath();
    c.moveTo(from.x * this.canvas.width, from.y * this.canvas.height);
    c.lineTo(to.x * this.canvas.width, to.y * this.canvas.height);
    c.stroke();
    c.shadowBlur = 0;
    this.texture.needsUpdate = true;
  }

  /** Cast one ray; if it hits the canvas, extend that source's stroke. */
  private paintFrom(key: string, origin: Vector3, dir: Vector3) {
    this.raycaster.set(origin, dir);
    const hit = this.raycaster.intersectObject(this.plane, false)[0];
    if (!hit?.uv) return this.last.delete(key);
    const uv = new Vector2(hit.uv.x, 1 - hit.uv.y);
    const prev = this.last.get(key);
    if (prev) this.line(prev, uv, this.color, 8);
    this.last.set(key, uv);
  }

  private rayFrom(obj: Object3D, key: string) {
    const o = obj.getWorldPosition(new Vector3());
    const d = new Vector3(0, 0, -1).applyQuaternion(obj.getWorldQuaternion(new Quaternion()));
    this.paintFrom(key, o, d);
  }

  private async museTurn() {
    if (this.busy) return;
    if (!this.plane.visible) this.plane.visible = true;
    this.busy = true;
    ui.setStatus('Muse is looking at the sketch...');
    try {
      const small = document.createElement('canvas');
      small.width = 768;
      small.height = Math.round((768 * H) / W);
      small.getContext('2d')!.drawImage(this.canvas, 0, 0, small.width, small.height);
      const { caption, strokes } = await requestCanvasTurn(small.toDataURL('image/png'), 'Add to this sketch.');
      this.pending.push(...strokes);
      ui.setStatus(`Muse: ${caption || 'added to the sketch.'}`);
    } catch (err) {
      ui.setStatus(`Canvas: couldn't reach Muse (${(err as Error).message}).`);
    } finally {
      this.busy = false;
    }
  }

  update(): void {
    if (!this.plane.visible) return;
    // Muse's strokes draw in over a few frames so you can watch it work.
    const s = this.pending[0];
    if (s) {
      for (const p of s.points.splice(0, 3)) {
        const v = new Vector2(p[0], p[1]);
        const prev = this.last.get('muse');
        if (prev) this.line(prev, v, s.color, s.width);
        this.last.set('muse', v);
      }
      if (s.points.length === 0) {
        this.pending.shift();
        this.last.delete('muse');
      }
    }

    if (!this.world.session) {
      if (this.mouseDown) {
        this.raycaster.setFromCamera(this.mouse, this.world.camera);
        this.paintFrom('mouse', this.raycaster.ray.origin.clone(), this.raycaster.ray.direction.clone());
      }
      return;
    }
    if (!this.entity.hasComponent(Pressed)) {
      this.last.delete('left');
      this.last.delete('right');
      this.last.delete('gaze');
      return;
    }
    const player = this.player as any;
    this.rayFrom(player.raySpaces.left, 'left');
    this.rayFrom(player.raySpaces.right, 'right');
    // Glasses: gaze is the pointer and the pinch is the press.
    if (player.gazeOrigin && player.gazeOrigin !== 'none' && player.eyeSpace) this.rayFrom(player.eyeSpace, 'gaze');
  }
}
