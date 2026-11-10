import { createSystem, UIKitMLAsset, VisibilityState } from '@iwsdk/core';
import { Text } from '@pmndrs/uikit';
import { ui } from './ui.js';

/** In-headset panel: same commands as the browser HUD, plus Enter/Exit AR. */
export class PanelSystem extends createSystem({}) {
  init(): void {
    const panel = this.world.getSceneObject<UIKitMLAsset>('welcome-panel');
    if (!panel) return;
    const on = (id: string, fn: () => void) => {
      const el = panel.getElementById(id);
      if (!el) return;
      el.addEventListener('click', fn);
      this.cleanupFuncs.push(() => el.removeEventListener('click', fn));
    };
    on('regen-button', () => ui.command('new-avatar', ''));
    on('canvas-button', () => ui.command('toggle-canvas'));
    on('muse-button', () => ui.command('canvas-muse'));

    // Status line. Keep it short in the headset; the browser HUD shows the full text.
    // UIKitML turns <div id="status">text</div> into a container holding a Text.
    const statusEl = panel.getElementById('status') as any;
    const status =
      statusEl instanceof Text ? statusEl : (statusEl?.children ?? []).find((c: unknown) => c instanceof Text) ?? statusEl;
    this.cleanupFuncs.push(
      ui.onStatus((text) => {
        const short = text.split('\n')[0].slice(0, 140);
        try {
          status?.setProperties?.({ text: short });
        } catch (err) {
          console.warn('[panel] status update failed', err);
        }
      }),
    );

    const xrButton = panel.getElementById('xr-button');
    const exitButton = panel.getElementById('exit-button');
    if (xrButton == null || exitButton == null) return;
    if (!this.world.xrEnabled) {
      xrButton.setProperties({ display: 'none' });
      exitButton.setProperties({ display: 'none' });
      return;
    }
    on('xr-button', () => this.world.launchXR());
    on('exit-button', () => this.world.exitXR());
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((v) => {
        const is2D = v === VisibilityState.NonImmersive;
        xrButton.setProperties({ display: is2D ? 'flex' : 'none' });
        exitButton.setProperties({ display: is2D ? 'none' : 'flex' });
      }),
    );
  }
}
