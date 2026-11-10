// Hands specs from live mode (phone sensing) and mirror mode (laptop follows
// the phone) to the AvatarSystem, without either side importing the other.
import type { AvatarSpec } from './avatar/spec.js';

type Listener = (spec: AvatarSpec) => void;
const listeners = new Set<Listener>();

export const liveBus = {
  emit(spec: AvatarSpec) {
    listeners.forEach((fn) => fn(spec));
  },
  on(fn: Listener) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
