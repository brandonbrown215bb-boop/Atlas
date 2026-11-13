import type { EntityType, MapDoc } from '../model/schema';
import { clipAndInheritEntities, type RectBounds } from './clipInherit';

export interface KeptEditedEntityInfo {
  id: string;
  type: EntityType;
  name?: string;
  parentEntityId: string;
}

export function getChildRectInParent(childMap: MapDoc): RectBounds | null {
  if (!childMap.parent) return null;
  return {
    x: childMap.parent.x,
    y: childMap.parent.y,
    w: childMap.bounds.w,
    h: childMap.bounds.h,
  };
}

export function hasParentChanged(childMap: MapDoc, parentMap: MapDoc): boolean {
  if (!childMap.parent || childMap.parent.mapId !== parentMap.id) {
    return false;
  }
  const rect = getChildRectInParent(childMap);
  if (!rect) return false;

  let maxInheritedRev = 0;
  const knownParentIds = new Set<string>();

  for (const ent of Object.values(childMap.entities)) {
    if (!ent.inheritedFrom) continue;
    knownParentIds.add(ent.inheritedFrom.entityId);
    if (ent.inheritedFrom.parentRev > maxInheritedRev) {
      maxInheritedRev = ent.inheritedFrom.parentRev;
    }
    if (ent.origin === 'inherited') {
      const parentEnt = parentMap.entities[ent.inheritedFrom.entityId];
      if (!parentEnt || parentEnt.rev > ent.inheritedFrom.parentRev) {
        return true;
      }
    }
  }

  // Check if any new or updated clippable parent entity inside rect has rev > maxInheritedRev
  if (parentMap.revision > maxInheritedRev) {
    const fresh = clipAndInheritEntities(parentMap, rect, 'layer-check');
    for (const candidate of fresh) {
      const srcId = candidate.inheritedFrom?.entityId;
      const srcRev = candidate.inheritedFrom?.parentRev ?? 0;
      if (!srcId) continue;
      if (!knownParentIds.has(srcId) || srcRev > maxInheritedRev) {
        return true;
      }
    }
  }

  return false;
}

export function listKeptEditedEntities(childMap: MapDoc): KeptEditedEntityInfo[] {
  const kept: KeptEditedEntityInfo[] = [];
  for (const ent of Object.values(childMap.entities)) {
    if (ent.origin === 'manual' && ent.inheritedFrom) {
      kept.push({
        id: ent.id,
        type: ent.type,
        name: ent.name,
        parentEntityId: ent.inheritedFrom.entityId,
      });
    }
  }
  return kept;
}
