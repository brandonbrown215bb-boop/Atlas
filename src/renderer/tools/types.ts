import type { Graphics } from 'pixi.js';
import type { Entity, MapDoc, Point } from '../model/schema';
import type { CommandCall } from '../model/store';
import type { CameraState } from '../render/camera';

export interface ToolPointerEvent {
  button: number;
  detail?: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

export function resolveTargetLayerId(
  map: MapDoc,
  preferredLayerId: string | null,
): string | null {
  if (preferredLayerId) {
    const preferred = map.layers.find((l) => l.id === preferredLayerId);
    if (preferred && preferred.visible && !preferred.locked) {
      return preferred.id;
    }
  }
  const firstUnlocked = map.layers.find((l) => l.visible && !l.locked);
  return firstUnlocked?.id ?? null;
}

export interface ToolContext {
  panelId: string;
  map: MapDoc;
  camera: CameraState;
  getSelectedIds: () => string[];
  setSelectedIds: (ids: string[]) => void;
  execute: (name: string, input: unknown) => unknown;
  executeBatch: (calls: readonly CommandCall[], label?: string) => unknown[];
  requestRedraw: () => void;
}

export interface MapTool {
  id: string;
  onPointerDown: (pt: Point, e: ToolPointerEvent, ctx: ToolContext) => boolean;
  onPointerMove: (pt: Point, e: ToolPointerEvent, ctx: ToolContext) => void;
  onPointerUp: (pt: Point, e: ToolPointerEvent, ctx: ToolContext) => void;
  onKey: (e: KeyboardEvent, ctx: ToolContext) => boolean;
  drawOverlay: (gfx: Graphics, ctx: ToolContext) => void;
  getPreviewEntities?: () => ReadonlyMap<string, Entity> | null;
}
