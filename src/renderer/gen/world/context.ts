import type { WorldDocument } from '../../model/commands';
import type { MapDoc } from '../../model/schema';
import type { GeneratorInput } from '../framework';

export function climateContext(world: WorldDocument, map: MapDoc): NonNullable<GeneratorInput<unknown>['climate']> {
  let root = map;
  const transforms: Array<{ x: number; y: number; rotation: number }> = [];
  const visited = new Set<string>();
  while (root.parent && world.maps[root.parent.mapId] && !visited.has(root.id)) {
    visited.add(root.id); transforms.push(root.parent); root = world.maps[root.parent.mapId]!;
  }
  return { settings: world.meta.climate, bounds: root.bounds, transforms };
}
