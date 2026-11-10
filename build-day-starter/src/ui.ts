// One tiny bus for status text and commands, shared by the flat-browser HUD
// (DOM) and the in-headset panel (UIKitML), so both stay in sync.
type Command = 'new-avatar' | 'toggle-canvas' | 'canvas-muse' | 'canvas-clear';

const statusListeners = new Set<(text: string) => void>();
const commandListeners = new Set<(cmd: Command, arg?: string) => void>();
let lastStatus = '';

export const ui = {
  setStatus(text: string) {
    lastStatus = text;
    statusListeners.forEach((fn) => fn(text));
    console.info('[status]', text);
  },
  onStatus(fn: (text: string) => void) {
    statusListeners.add(fn);
    fn(lastStatus);
    return () => statusListeners.delete(fn);
  },
  command(cmd: Command, arg?: string) {
    commandListeners.forEach((fn) => fn(cmd, arg));
  },
  onCommand(fn: (cmd: Command, arg?: string) => void) {
    commandListeners.add(fn);
    return () => commandListeners.delete(fn);
  },
};

/** Flat-browser HUD: brief box, buttons and status. Hidden while immersive. */
export function mountHud() {
  const hud = document.createElement('div');
  hud.id = 'hud';
  hud.innerHTML = `
    <style>
      #hud { position: fixed; left: 12px; top: 12px; z-index: 10; width: min(360px, calc(100vw - 24px));
        font: 13px/1.4 system-ui, sans-serif; color: #f4f4f5; background: rgba(15,15,20,.72);
        backdrop-filter: blur(8px); border: 1px solid rgba(255,255,255,.12); border-radius: 12px; padding: 12px; }
      #hud textarea { width: 100%; box-sizing: border-box; min-height: 44px; resize: vertical; border-radius: 8px;
        border: 1px solid rgba(255,255,255,.18); background: rgba(0,0,0,.35); color: inherit; padding: 6px 8px; font: inherit; }
      #hud .row { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
      #hud button { flex: 1; padding: 6px 8px; border-radius: 8px; border: 0; background: #2b2b33; color: inherit; cursor: pointer; font: inherit; }
      #hud button.primary { background: #4f46e5; }
      #hud .status { margin-top: 8px; white-space: pre-wrap; opacity: .9; max-height: 30vh; overflow: auto; }
      #hud .keys { margin-top: 6px; opacity: .55; font-size: 11px; }
    </style>
    <textarea id="brief" placeholder="Optional direction for Muse (prompts/avatar.md is the main prompt)"></textarea>
    <div class="row">
      <button class="primary" data-cmd="new-avatar">New avatar</button>
      <button data-cmd="toggle-canvas">AR canvas</button>
      <button data-cmd="canvas-muse">Muse, add to it</button>
    </div>
    <div class="status" id="hud-status"></div>
    <div class="keys">N new avatar · C canvas · M Muse draws · X clear canvas</div>`;
  document.body.appendChild(hud);
  const brief = hud.querySelector<HTMLTextAreaElement>('#brief')!;
  hud.querySelectorAll<HTMLButtonElement>('button[data-cmd]').forEach((b) =>
    b.addEventListener('click', () => ui.command(b.dataset.cmd as Command, brief.value)),
  );
  const statusEl = hud.querySelector<HTMLDivElement>('#hud-status')!;
  ui.onStatus((t) => (statusEl.textContent = t));
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLTextAreaElement) return;
    const key = e.key.toLowerCase();
    if (key === 'n') ui.command('new-avatar', brief.value);
    if (key === 'c') ui.command('toggle-canvas');
    if (key === 'm') ui.command('canvas-muse');
    if (key === 'x') ui.command('canvas-clear');
  });
  return {
    brief: () => brief.value,
    setVisible(v: boolean) {
      hud.style.display = v ? 'block' : 'none';
    },
  };
}
