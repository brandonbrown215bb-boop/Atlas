import { distanceToSegment, getEntityBounds } from '../../geom/hitTest';
import type { Entity, Point } from '../../model/schema';
import { themeAssets } from '../../model/themes';
import type { GeneratorInput } from '../framework';
import { mulberry32 } from '../rng';
import type { buildClimate } from './climate';
import { contains, type Terrain } from './terrain';

type DecorationParams = { density: number; settlements: number; seaLevel: number };
type ClimateValues = ReturnType<typeof buildClimate>['values'];

/** Symbols use metres at continent scale. Seeded weighted sampling gives clusters and gaps. */
export function decorateWorld(terrain: Terrain, climate: ClimateValues, input: GeneratorInput<DecorationParams>, rivers: Entity[]): Entity[] {
  const random = mulberry32(input.seed ^ 0x651fea), result: Entity[] = [];
  const bounds = input.constraints.flatMap(e => {
    if (e.type === 'area' && (e.role === 'land' || e.role.startsWith('biome:'))) return [];
    if (e.type === 'path' || e.type === 'wall' || e.type === 'place') return [];
    const b = getEntityBounds(e); return b ? [b] : [];
  });
  const lines = [...input.constraints, ...rivers].flatMap(e => e.type === 'path' || e.type === 'wall'
    ? e.points.slice(1).map((b, i) => ({ a: e.points[i]!, b, width: e.type === 'path' ? e.width : 0 })) : []);
  const safe = (p: Point, radius: number) => {
    const samples = [p, ...[-1, 1].flatMap(x => [-1, 1].map(y => ({ x: p.x + x * radius, y: p.y + y * radius })))];
    return samples.every(q => terrain.land.some(r => contains(r, q)))
      && !bounds.some(b => p.x + radius > b.minX && p.x - radius < b.maxX && p.y + radius > b.minY && p.y - radius < b.maxY)
      && !lines.some(s => distanceToSegment(p, s.a, s.b) < radius + s.width / 2)
      && !result.some(e => e.type === 'prop' && Math.hypot(p.x - e.x, p.y - e.y) < radius + Math.max(e.w!, e.h!) / 2);
  };
  const symbol = (role: string, point: Point, size: number, name: string, suggestion = false): Entity => {
    const assets = themeAssets(input.theme, role), asset = assets[Math.floor(random() * assets.length)]!;
    return { id: `${role}-${result.length}`, type: 'prop', layerId: 'base', origin: 'generated', rev: 0,
      name, ...point, w: size, h: size, scale: 1, rotation: 0, flipX: random() < .5,
      ...(asset.startsWith('builtin:') ? { builtin: asset.slice(8) } : { assetId: asset }),
      ...(suggestion ? { suggestedSettlement: true, gmOnly: true } : {}) };
  };
  const habitable = terrain.cells.map((c, i) => ({ c, i })).filter(({ c, i }) => c.land && c.elevation < input.params.seaLevel + .28
    && climate[i]!.temperature > .18 && climate[i]!.moisture > .15);
  const hubs = Array.from({ length: 3 }, () => habitable[Math.floor(random() * habitable.length)]?.c.point).filter((p): p is Point => !!p);
  const ranked = habitable.map(({ c, i }) => {
    const coast = c.neighbors.some(n => !terrain.cells[n]!.land);
    const clustered = hubs.reduce((sum, p) => sum + Math.exp(-Math.pow(Math.hypot(p.x - c.point.x, p.y - c.point.y) / (terrain.size * .12), 2)), 0);
    const weight = (.15 + clustered * 3 + (coast ? 1 : 0)) * (.3 + climate[i]!.moisture);
    return { point: c.point, score: -Math.log(Math.max(1e-10, random())) / weight, size: terrain.size * (.007 + random() * .005) };
  }).sort((a, b) => a.score - b.score);
  for (const candidate of ranked) {
    if (result.length >= input.params.settlements) break;
    if (safe(candidate.point, candidate.size * .6)) result.push(symbol('settlement', candidate.point, candidate.size, `Settlement suggestion ${result.length + 1}`, true));
  }
  if (!input.params.density) return result;
  const manualBiomes = input.constraints.filter(e => e.type === 'area' && e.role.startsWith('biome:'));
  for (const [i, c] of terrain.cells.entries()) {
    if (!c.land || random() > .1 * input.params.density) continue;
    const manual = manualBiomes.find(e => e.type === 'area' && contains(e.rings, c.point));
    const biome = manual?.type === 'area' ? manual.role.slice(6) : climate[i]!.rule.name;
    const height = c.elevation - input.params.seaLevel;
    const role = height > .28 ? 'mountain' : /forest|wood|jungle/i.test(biome) ? 'forest' : height > .14 ? 'hill' : null;
    if (!role) continue;
    const size = terrain.size * (role === 'mountain' ? .018 : .012) * (.75 + random() * .5);
    if (safe(c.point, size * .55)) result.push(symbol(role, c.point, size, { mountain: 'Mountain', forest: 'Forest', hill: 'Hills' }[role]));
  }
  return result;
}
