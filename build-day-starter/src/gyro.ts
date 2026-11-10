// Phone AR without WebXR: the camera feed sits behind a transparent canvas and
// the 3D camera turns with the phone (gyro), so the avatar stays put in the room
// while you look around. Systems always see the un-rotated "home" camera; the
// phone's rotation is applied only for the render itself, then undone.
import { Euler, Quaternion, Vector3, type PerspectiveCamera, type Scene } from '@iwsdk/core';

const ZEE = new Vector3(0, 0, 1);
const Q_X = new Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // -90° about X: camera looks out the back
const euler = new Euler();
const qTmp = new Quaternion();
const qNow = new Quaternion();
const qInitInv = new Quaternion();
const qRel = new Quaternion();
const qSmooth = new Quaternion();
const qSaved = new Quaternion();
let haveInit = false;
let active = false;

function deviceQuat(out: Quaternion, alpha: number, beta: number, gamma: number, orient: number) {
  euler.set(beta, alpha, -gamma, 'YXZ');
  out.setFromEuler(euler);
  out.multiply(Q_X);
  out.multiply(qTmp.setFromAxisAngle(ZEE, -orient));
  return out;
}

function onOrientation(e: DeviceOrientationEvent) {
  if (e.alpha == null || e.beta == null || e.gamma == null) return;
  const d = Math.PI / 180;
  const orient = ((screen.orientation?.angle ?? (window as any).orientation ?? 0) as number) * d;
  deviceQuat(qNow, e.alpha * d, e.beta * d, e.gamma * d, orient);
  if (!haveInit) {
    qInitInv.copy(qNow).invert();
    qSmooth.identity();
    haveInit = true;
  }
  qRel.copy(qInitInv).multiply(qNow);
  active = true;
}

/** Re-centre: the current phone pose becomes "looking at home". */
export function recentreGyro() {
  haveInit = false;
}

/** Start listening (call from a user gesture on iOS; Android needs none). */
export async function startGyro() {
  const DOE = (window as any).DeviceOrientationEvent;
  try {
    if (DOE?.requestPermission) await DOE.requestPermission();
  } catch {
    /* denied: stays a flat overlay */
  }
  window.addEventListener('deviceorientation', onOrientation);
}

/** Rotate the camera by the phone's motion for each render, and put it back after. */
export function installGyroCamera(scene: Scene, camera: PerspectiveCamera) {
  const before = scene.onBeforeRender;
  const after = scene.onAfterRender;
  scene.onBeforeRender = function (...args: Parameters<Scene['onBeforeRender']>) {
    before.apply(this, args);
    if (!active || args[2] !== camera) return;
    qSmooth.slerp(qRel, 0.5);
    qSaved.copy(camera.quaternion);
    camera.quaternion.multiply(qSmooth);
    camera.updateMatrixWorld(true);
  };
  scene.onAfterRender = function (...args: Parameters<Scene['onAfterRender']>) {
    after.apply(this, args);
    if (!active || args[2] !== camera) return;
    camera.quaternion.copy(qSaved);
    camera.updateMatrixWorld(true);
  };
}
