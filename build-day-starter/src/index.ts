import { VisibilityState, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { AvatarSystem } from './avatar/avatar-system.js';
import { CanvasSystem } from './canvas-system.js';
import { health } from './muse-client.js';
import { PanelSystem } from './panel.js';
import { mountHud, ui } from './ui.js';

const hud = mountHud();

World.create(document.getElementById('scene-container') as HTMLDivElement, projectOptions).then(async (world) => {
  world.registerSystem(AvatarSystem);
  world.registerSystem(CanvasSystem);
  world.registerSystem(PanelSystem);
  world.visibilityState.subscribe((v) => hud.setVisible(v === VisibilityState.NonImmersive));

  const h = await health();
  if (!h) ui.setStatus('Dev server API not reachable.');
  else if (h.mock) ui.setStatus('Mock mode: no network calls. Press N or New avatar.');
  else if (!h.key) ui.setStatus('No OPENROUTER_API_KEY on the dev server yet (see RUN-SHEET.md).');
  else {
    ui.setStatus(`Ready. Designer ${h.models.designer}, reviewer ${h.models.reviewer}.`);
    if (new URLSearchParams(location.search).get('auto') !== '0') ui.command('new-avatar', '');
  }
});
