import { applyPatches, type Patch } from 'immer';

export const HISTORY_CAP = 200;

export interface HistoryEntry {
  label: string;
  patches: Patch[];
  inversePatches: Patch[];
  touchedMapIds: string[];
  worldMetaTouched: boolean;
}

export interface HistoryState {
  past: HistoryEntry[];
  future: HistoryEntry[];
}

export function createEmptyHistory(): HistoryState {
  return { past: [], future: [] };
}

export function pushHistory(
  history: HistoryState,
  entry: HistoryEntry,
): HistoryState {
  const nextPast = [...history.past, entry];
  if (nextPast.length > HISTORY_CAP) {
    nextPast.shift();
  }
  return {
    past: nextPast,
    future: [],
  };
}

export function applyHistoryUndo<T extends object>(
  state: T,
  history: HistoryState,
): { state: T; history: HistoryState; entry: HistoryEntry | null } {
  const entry = history.past[history.past.length - 1];
  if (!entry) {
    return { state, history, entry: null };
  }
  const nextState = applyPatches(state, entry.inversePatches);
  return {
    state: nextState,
    history: {
      past: history.past.slice(0, -1),
      future: [...history.future, entry],
    },
    entry,
  };
}

export function applyHistoryRedo<T extends object>(
  state: T,
  history: HistoryState,
): { state: T; history: HistoryState; entry: HistoryEntry | null } {
  const entry = history.future[history.future.length - 1];
  if (!entry) {
    return { state, history, entry: null };
  }
  const nextState = applyPatches(state, entry.patches);
  return {
    state: nextState,
    history: {
      past: [...history.past, entry],
      future: history.future.slice(0, -1),
    },
    entry,
  };
}
