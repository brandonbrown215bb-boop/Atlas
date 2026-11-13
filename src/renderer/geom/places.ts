import type { MapDoc, PlaceEntity, Point } from '../model/schema';
import { getEntityBounds, mergeBBoxes, type BBox } from './hitTest';

export type PlaceWithId = PlaceEntity;

export function getPlaceBounds(map: MapDoc, place: PlaceEntity): BBox | null {
  const boxes: BBox[] = [];
  for (const entityId of place.entityIds) {
    const entity = map.entities[entityId];
    if (!entity || entity.type === 'place') {
      continue;
    }
    const bbox = getEntityBounds(entity);
    if (bbox) {
      boxes.push(bbox);
    }
  }
  return mergeBBoxes(boxes);
}

export function getPlaceCenter(map: MapDoc, place: PlaceEntity): Point | null {
  const bbox = getPlaceBounds(map, place);
  if (!bbox) {
    return null;
  }
  return {
    x: (bbox.minX + bbox.maxX) / 2,
    y: (bbox.minY + bbox.maxY) / 2,
  };
}

export function listPlaceCategories(places: readonly PlaceEntity[]): string[] {
  const categories = new Set<string>();
  for (const place of places) {
    const trimmed = place.category.trim();
    if (trimmed.length > 0) {
      categories.add(trimmed);
    }
  }
  return Array.from(categories).sort((a, b) => a.localeCompare(b));
}

export function filterPlaces(
  places: readonly PlaceEntity[],
  query: string,
  category: string,
): PlaceEntity[] {
  const q = query.trim().toLowerCase();
  const cat = category.trim();
  return places.filter((place) => {
    if (cat.length > 0 && place.category.trim() !== cat) {
      return false;
    }
    if (q.length === 0) {
      return true;
    }
    return (
      place.name.toLowerCase().includes(q) ||
      place.category.toLowerCase().includes(q) ||
      place.notes.toLowerCase().includes(q) ||
      place.gmNotes.toLowerCase().includes(q)
    );
  });
}
