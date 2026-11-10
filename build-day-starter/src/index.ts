import { VisibilityState, World, type PerspectiveCamera } from '@iwsdk/core';
import { installGyroCamera } from './gyro.js';
import projectOptions from 'virtual:iwsdk-project';
import { AvatarSystem } from './avatar/avatar-system.js';
import { CanvasSystem } from './canvas-system.js';
import { liveMode, startLiveMode } from './live.js';
import { health } from './muse-client.js';
import { PanelSystem } from './panel.js';
import { mountHud, ui } from './ui.js';

const hud = mountHud();

World.create(document.getElementById('scene-container') as HTMLDivElement, projectOptions).then(async (world) => {
  world.registerSystem(AvatarSystem);
  world.registerSystem(CanvasSystem);
  world.registerSystem(PanelSystem);
  world.visibilityState.subscribe((v) => hud.setVisible(v === VisibilityState.NonImmersive));

  if (liveMode) {
    // Phone and mirror are flat screens: no starter panel, and a transparent
    // canvas over a backdrop (the phone's live camera, or the last frame the
    // phone sent, on the mirror). On the phone the camera turns with the gyro.
    const panel = world.getSceneObject('welcome-panel') as any;
    if (panel) panel.visible = false;
    world.scene.background = null;
    world.renderer.setClearColor(0x000000, 0);
    document.body.style.background = '#0d0b07';
    if (liveMode === 'live') installGyroCamera(world.scene, world.camera as PerspectiveCamera);
  }
  startLiveMode();
  const h = await health();
  if (!h) ui.setStatus('Dev server API not reachable.');
  else if (h.mock) ui.setStatus('Mock mode: no network calls. Press N or New avatar.');
  else if (!h.key) ui.setStatus('No OPENROUTER_API_KEY on the dev server yet (see RUN-SHEET.md).');
  else {
    ui.setStatus(`Ready. Designer ${h.models.designer}, reviewer ${h.models.reviewer}.`);
    // Live/mirror modes take their bodies from /api/sense, not the design duet.
    if (!liveMode && new URLSearchParams(location.search).get('auto') !== '0') ui.command('new-avatar', '');
  }
});
