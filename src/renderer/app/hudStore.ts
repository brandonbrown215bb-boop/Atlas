import { createStore } from 'zustand/vanilla';

export type FloatingPanelKind =
  | 'tools'
  | 'maps'
  | 'layers'
  | 'inspector'
  | 'generator'
  | 'assets'
  | 'places'
  | 'settings'
  | 'map';

export interface PopoutBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FloatingPanelState {
  id: string;
  kind: FloatingPanelKind;
  title: string;
  open: boolean;
  mode: 'floating' | 'popout';
  x: number;
  y: number;
  w: number;
  h: number;
  collapsed: boolean;
  zIndex: number;
  popoutBounds?: PopoutBounds;
}

export interface HudStoreState {
  panels: Record<string, FloatingPanelState>;
  nextZ: number;
  dragOverMain: { id: string; relX: number; relY: number } | null;

  openOrFocusPanel: (id: string, kind?: FloatingPanelKind, title?: string) => string;
  togglePanel: (id: string) => void;
  closePanel: (id: string) => void;
  setPanelRect: (id: string, patch: Partial<Pick<FloatingPanelState, 'x' | 'y' | 'w' | 'h'>>) => void;
  toggleCollapse: (id: string) => void;
  bringToFront: (id: string) => void;
  popoutPanel: (id: string, bounds?: PopoutBounds) => void;
  dockBackPanel: (id: string, x?: number, y?: number) => void;
  setDragOverMain: (info: { id: string; relX: number; relY: number } | null) => void;
  clampToStage: (stageW: number, stageH: number) => void;
  resetLayout: (stageW?: number, stageH?: number) => void;
  hydrateLayout: (saved: unknown, stageW?: number, stageH?: number) => void;
}

export function buildDefaultPanels(stageW = 1280, stageH = 760): Record<string, FloatingPanelState> {
  const rightX256 = Math.max(12, stageW - 268);
  const rightX290 = Math.max(12, stageW - 302);
  const midCenter = Math.max(12, Math.round((stageW - 360) / 2));

  return {
    tools: {
      id: 'tools',
      kind: 'tools',
      title: 'Tools',
      open: true,
      mode: 'floating',
      x: 12,
      y: 12,
      w: 272,
      h: Math.min(340, Math.max(220, Math.round(stageH * 0.45))),
      collapsed: false,
      zIndex: 10,
    },
    maps: {
      id: 'maps',
      kind: 'maps',
      title: 'Maps',
      open: true,
      mode: 'floating',
      x: 12,
      y: Math.min(364, Math.max(120, Math.round(stageH * 0.45) + 24)),
      w: 240,
      h: Math.min(280, Math.max(180, stageH - Math.round(stageH * 0.45) - 48)),
      collapsed: false,
      zIndex: 11,
    },
    layers: {
      id: 'layers',
      kind: 'layers',
      title: 'Layers',
      open: true,
      mode: 'floating',
      x: rightX256,
      y: 12,
      w: 256,
      h: Math.min(270, Math.max(180, Math.round(stageH * 0.38))),
      collapsed: false,
      zIndex: 12,
    },
    inspector: {
      id: 'inspector',
      kind: 'inspector',
      title: 'Inspector',
      open: true,
      mode: 'floating',
      x: rightX290,
      y: Math.min(294, Math.max(120, Math.round(stageH * 0.38) + 24)),
      w: 290,
      h: Math.min(380, Math.max(200, stageH - Math.round(stageH * 0.38) - 48)),
      collapsed: false,
      zIndex: 13,
    },
    generator: {
      id: 'generator',
      kind: 'generator',
      title: 'Generator',
      open: false,
      mode: 'floating',
      x: midCenter,
      y: 24,
      w: 360,
      h: 440,
      collapsed: false,
      zIndex: 14,
    },
    assets: {
      id: 'assets',
      kind: 'assets',
      title: 'Assets',
      open: false,
      mode: 'floating',
      x: Math.max(12, midCenter - 40),
      y: 48,
      w: 420,
      h: 460,
      collapsed: false,
      zIndex: 15,
    },
    places: {
      id: 'places',
      kind: 'places',
      title: 'Places',
      open: false,
      mode: 'floating',
      x: Math.max(12, midCenter + 40),
      y: 48,
      w: 320,
      h: 400,
      collapsed: false,
      zIndex: 16,
    },
    settings: {
      id: 'settings',
      kind: 'settings',
      title: 'Settings',
      open: false,
      mode: 'floating',
      x: midCenter,
      y: 64,
      w: 360,
      h: 440,
      collapsed: false,
      zIndex: 17,
    },
  };
}

function clampPanel(p: FloatingPanelState, stageW: number, stageH: number): FloatingPanelState {
  if (stageW <= 0 || stageH <= 0) return p;
  const w = Math.min(Math.max(180, p.w), Math.max(180, stageW - 16));
  const h = Math.min(Math.max(120, p.h), Math.max(120, stageH - 16));
  const x = Math.max(4, Math.min(p.x, Math.max(4, stageW - Math.min(w, 120))));
  const y = Math.max(4, Math.min(p.y, Math.max(4, stageH - 36)));
  return { ...p, x, y, w, h };
}

export const hudStore = createStore<HudStoreState>((set, get) => ({
  panels: buildDefaultPanels(),
  nextZ: 20,
  dragOverMain: null,

  openOrFocusPanel(id, kind, title) {
    const state = get();
    if (kind === 'map') {
      const mapId = id === 'map' ? `map-${crypto.randomUUID().slice(0, 6)}` : id;
      const existing = state.panels[mapId];
      if (existing) {
        set({
          panels: {
            ...state.panels,
            [mapId]: { ...existing, open: true, collapsed: false, zIndex: state.nextZ },
          },
          nextZ: state.nextZ + 1,
        });
        return mapId;
      }
      const count = Object.values(state.panels).filter((p) => p.kind === 'map').length;
      const offset = (count % 5) * 28;
      set({
        panels: {
          ...state.panels,
          [mapId]: {
            id: mapId,
            kind: 'map',
            title: title ?? 'Map',
            open: true,
            mode: 'floating',
            x: 280 + offset,
            y: 40 + offset,
            w: 520,
            h: 400,
            collapsed: false,
            zIndex: state.nextZ,
          },
        },
        nextZ: state.nextZ + 1,
      });
      return mapId;
    }

    const existing = state.panels[id];
    if (existing) {
      set({
        panels: {
          ...state.panels,
          [id]: { ...existing, open: true, collapsed: false, zIndex: state.nextZ },
        },
        nextZ: state.nextZ + 1,
      });
      return id;
    }

    const defaults = buildDefaultPanels();
    const fallback = defaults[id];
    if (fallback) {
      set({
        panels: {
          ...state.panels,
          [id]: { ...fallback, open: true, collapsed: false, zIndex: state.nextZ },
        },
        nextZ: state.nextZ + 1,
      });
    }
    return id;
  },

  togglePanel(id) {
    const p = get().panels[id];
    if (!p) {
      get().openOrFocusPanel(id);
      return;
    }
    if (p.open) {
      get().closePanel(id);
    } else {
      get().openOrFocusPanel(id);
    }
  },

  closePanel(id) {
    const state = get();
    const p = state.panels[id];
    if (!p) return;
    if (p.mode === 'popout') {
      void window.atlasApi?.closePopout(id);
    }
    if (p.kind === 'map') {
      const next = { ...state.panels };
      delete next[id];
      set({ panels: next });
      return;
    }
    set({
      panels: {
        ...state.panels,
        [id]: { ...p, open: false, mode: 'floating' },
      },
    });
  },

  setPanelRect(id, patch) {
    set((state) => {
      const p = state.panels[id];
      if (!p) return state;
      return {
        panels: {
          ...state.panels,
          [id]: { ...p, ...patch },
        },
      };
    });
  },

  toggleCollapse(id) {
    set((state) => {
      const p = state.panels[id];
      if (!p) return state;
      return {
        panels: {
          ...state.panels,
          [id]: { ...p, collapsed: !p.collapsed, zIndex: state.nextZ },
        },
        nextZ: state.nextZ + 1,
      };
    });
  },

  bringToFront(id) {
    set((state) => {
      const p = state.panels[id];
      if (!p || p.zIndex === state.nextZ - 1) return state;
      return {
        panels: {
          ...state.panels,
          [id]: { ...p, zIndex: state.nextZ },
        },
        nextZ: state.nextZ + 1,
      };
    });
  },

  popoutPanel(id, bounds) {
    set((state) => {
      const p = state.panels[id];
      if (!p) return state;
      return {
        panels: {
          ...state.panels,
          [id]: {
            ...p,
            open: true,
            mode: 'popout',
            collapsed: false,
            popoutBounds: bounds ?? p.popoutBounds ?? {
              x: Math.round(window.screenX + p.x),
              y: Math.round(window.screenY + p.y),
              width: Math.max(280, p.w),
              height: Math.max(240, p.h),
            },
          },
        },
      };
    });
  },

  dockBackPanel(id, x, y) {
    set((state) => {
      const p = state.panels[id];
      if (!p) return state;
      const nextX = x !== undefined ? Math.max(4, Math.round(x - p.w / 2)) : p.x;
      const nextY = y !== undefined ? Math.max(4, Math.round(y - 16)) : p.y;
      return {
        panels: {
          ...state.panels,
          [id]: {
            ...p,
            open: true,
            mode: 'floating',
            x: nextX,
            y: nextY,
            zIndex: state.nextZ,
          },
        },
        nextZ: state.nextZ + 1,
      };
    });
  },

  setDragOverMain(dragOverMain) {
    set({ dragOverMain });
  },

  clampToStage(stageW, stageH) {
    if (stageW <= 0 || stageH <= 0) return;
    set((state) => {
      const next: Record<string, FloatingPanelState> = {};
      for (const [id, p] of Object.entries(state.panels)) {
        next[id] = p.mode === 'floating' ? clampPanel(p, stageW, stageH) : p;
      }
      return { panels: next };
    });
  },

  resetLayout(stageW, stageH) {
    const current = get().panels;
    for (const p of Object.values(current)) {
      if (p.mode === 'popout') {
        void window.atlasApi?.closePopout(p.id);
      }
    }
    set({
      panels: buildDefaultPanels(stageW, stageH),
      nextZ: 20,
      dragOverMain: null,
    });
  },

  hydrateLayout(saved, stageW, stageH) {
    if (!saved || typeof saved !== 'object') return;
    const raw = (saved as { panels?: Record<string, Partial<FloatingPanelState>> }).panels;
    if (!raw || typeof raw !== 'object') return;
    const defaults = buildDefaultPanels(stageW, stageH);
    const merged: Record<string, FloatingPanelState> = { ...defaults };
    let maxZ = 20;

    for (const [id, entry] of Object.entries(raw)) {
      if (!entry || typeof entry !== 'object') continue;
      const base = defaults[id];
      const kind = (entry.kind ?? base?.kind) as FloatingPanelKind | undefined;
      if (!kind) continue;
      const candidate: FloatingPanelState = {
        id,
        kind,
        title: typeof entry.title === 'string' ? entry.title : (base?.title ?? id),
        open: typeof entry.open === 'boolean' ? entry.open : (base?.open ?? false),
        mode: entry.mode === 'popout' ? 'popout' : 'floating',
        x: typeof entry.x === 'number' && Number.isFinite(entry.x) ? entry.x : (base?.x ?? 20),
        y: typeof entry.y === 'number' && Number.isFinite(entry.y) ? entry.y : (base?.y ?? 20),
        w: typeof entry.w === 'number' && Number.isFinite(entry.w) ? entry.w : (base?.w ?? 280),
        h: typeof entry.h === 'number' && Number.isFinite(entry.h) ? entry.h : (base?.h ?? 320),
        collapsed: Boolean(entry.collapsed),
        zIndex: typeof entry.zIndex === 'number' && Number.isFinite(entry.zIndex) ? entry.zIndex : (base?.zIndex ?? 10),
        popoutBounds: entry.popoutBounds,
      };
      if (candidate.zIndex >= maxZ) maxZ = candidate.zIndex + 1;
      merged[id] = stageW && stageH ? clampPanel(candidate, stageW, stageH) : candidate;
    }

    set({ panels: merged, nextZ: maxZ });
  },
}));
