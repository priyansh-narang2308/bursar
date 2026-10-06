import type { Cockpit } from '@bursar/schemas';
import { useSyncExternalStore } from 'react';

/*
 * What the six custom widgets share. Studio mounts a widget in its own tree, so the widgets read the cockpit
 * and the cross-filter from this small store rather than from React context. A rule picked in one widget
 * narrows the others.
 */
interface State {
  readonly cockpit: Cockpit | null;
  readonly rule: string | null;
}

let state: State = { cockpit: null, rule: null };
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const cockpitStore = {
  setCockpit(cockpit: Cockpit | null) {
    state = { ...state, cockpit };
    emit();
  },
  /** Picks a rule to narrow every widget to, or clears it when it is already the one picked. */
  toggleRule(rule: string) {
    state = { ...state, rule: state.rule === rule ? null : rule };
    emit();
  },
  clearRule() {
    if (state.rule === null) return;
    state = { ...state, rule: null };
    emit();
  },
  get: () => state,
};

export const useCockpitStore = (): State => useSyncExternalStore(subscribe, cockpitStore.get);
