import { createNoise2D } from 'simplex-noise';
import clipping from '../../geom/polygonClipping';
import { bboxFromPoints } from '../../geom/hitTest';
import { fromPolygons, toPolygons } from '../../geom/fog';
import { ClimateSchema, type Climate, type Entity, type Point } from '../../model/schema';
import type { GeneratorInput } from '../framework';
import { mulberry32 } from '../rng';
import { smoothPolygons, traceCellBoundaries } from './boundaries';
import { contains, type Area, type Terrain } from './terrain';

const clamp = (n: number) => Math.max(0, Math.min(1, n));

function mapPoint(
  point: Point,
  context: GeneratorInput<unknown>['climate'],
): { x: number; y: number } {
  let p = point;
  for (const t of context?.transforms ?? []) {
    p = {
      x: p.x * Math.cos(t.rotation) - p.y * Math.sin(t.rotation) + t.x,
      y: p.x * Math.sin(t.rotation) + p.y * Math.cos(t.rotation) + t.y,
    };
  }
  const b = context?.bounds ?? { x: 0, y: 0, w: 1000000, h: 1000000 };
  return { x: (p.x - b.x) / b.w, y: (p.y - b.y) / b.h };
}

function latitudeFor(yNorm: number, climate: Climate): number {
  return Math.max(-90, Math.min(90, climate.northLatitude + Math.max(0, Math.min(1, yNorm)) * (climate.southLatitude - climate.northLatitude)));
}

function windVector(lat: number): [number, number] {
  const abs = Math.abs(lat);
  const hemi = lat >= 0 ? 1 : -1;
  if (abs < 30) return [-1, 0.28 * hemi]; // Trade winds: E -> W, toward equator
  if (abs < 60) return [1, -0.18 * hemi]; // Westerlies: W -> E, poleward
  return [-1, 0.22 * hemi]; // Polar easterlies
}

function latitudeMoistureBias(lat: number): number {
  const abs = Math.abs(lat);
  // Equatorial rain belt, subtropical dry belt (~25 deg), temperate storm track (~50 deg).
  const eq = Math.exp(-Math.pow(abs / 14, 2)) * 0.16;
  const sub = Math.exp(-Math.pow((abs - 26) / 10, 2)) * -0.14;
  const temp = Math.exp(-Math.pow((abs - 50) / 12, 2)) * 0.10;
  return eq + sub + temp;
}

export function climateAt(
  point: Point,
  elevation: number,
  seed: number,
  context: GeneratorInput<unknown>['climate'],
  noise = createNoise2D(mulberry32(seed ^ 0x81b3)),
  settings?: Climate,
): { temperature: number; moisture: number; rule: Climate['biomes'][number] } {
  const climate = settings ?? ClimateSchema.parse(context?.settings ?? {});
  const { x, y } = mapPoint(point, context);
  const latitude = latitudeFor(y, climate);
  const temperature = clamp(
    1 - Math.abs(latitude) / 90 - Math.max(0, elevation - 0.45) * 0.75 + climate.temperature + noise(x * 3 + 12, y * 3) * 0.07,
  );
  const moisture = clamp(0.5 + noise(x * 3, y * 3 + 21) * 0.3 + noise(x * 8, y * 8) * 0.08 + climate.moisture);
  const rule =
    climate.biomes.find(
      r => temperature >= r.temperatureMin && temperature <= r.temperatureMax && moisture >= r.moistureMin && moisture <= r.moistureMax,
    ) ?? climate.biomes[climate.biomes.length - 1]!;
  return { temperature, moisture, rule };
}

export function buildClimate(terrain: Terrain, input: GeneratorInput<unknown>) {
  const noise = createNoise2D(mulberry32(input.seed ^ 0x81b3));
  const b = bboxFromPoints(terrain.region[0]!)!;
  const context = input.climate ?? { bounds: { x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY }, transforms: [] };
  const settings = ClimateSchema.parse(context.settings ?? {});
  const cells = terrain.cells;
  const seaLevel = terrain.seaLevel ?? 0.45;
  const hasWaterCells = cells.some(c => !c.land);

  const coords = cells.map(c => mapPoint(c.point, context));
  const lats = coords.map(({ y }) => latitudeFor(y, settings));
  const isOcean = cells.map(c => (hasWaterCells ? !c.land && !c.lake : c.elevation <= seaLevel));

  // Advect oceanic moisture along prevailing winds with orographic lift and leeward rain shadows.
  const air = new Float64Array(cells.length);
  const oroRain = new Float64Array(cells.length);
  const winds = lats.map(windVector);
  const mountainProps = input.constraints.filter(
    (e): e is Extract<Entity, { type: 'prop' }> => e.type === 'prop' && e.symbolKind === 'mountain',
  );
  const propLift = cells.map((c) => {
    if (!c.land || !mountainProps.length) return 0;
    let boost = 0;
    for (const m of mountainProps) {
      const r = Math.max(m.w ?? 0, m.h ?? 0, terrain.size * 0.025);
      const d = Math.hypot(c.point.x - m.x, c.point.y - m.y);
      if (d < r * 1.4) boost = Math.max(boost, (1 - d / (r * 1.4)) * 0.22);
    }
    return boost;
  });

  if (cells.length > 0) {
    for (let i = 0; i < cells.length; i++) air[i] = isOcean[i] ? 1.0 : 0.35;
    // Order cells upwind-to-downwind so moisture & rain shadows cross the full continent in 2 sweeps.
    const order = cells.map((c, i) => {
      const [wx, wy] = winds[i]!;
      return { i, key: c.point.x * wx + c.point.y * wy };
    }).sort((a, b) => a.key - b.key).map(o => o.i);

    for (let pass = 0; pass < 2; pass++) {
      for (const i of order) {
        if (isOcean[i]) {
          air[i] = 1.0;
          continue;
        }
        const ci = cells[i]!;
        const [wx, wy] = winds[i]!;
        let wSum = 0, aSum = 0, eSum = 0, dSum = 0;
        for (const j of ci.neighbors) {
          const cj = cells[j]!;
          const dx = ci.point.x - cj.point.x, dy = ci.point.y - cj.point.y;
          const len = Math.hypot(dx, dy) || 1;
          const align = (dx * wx + dy * wy) / len;
          if (align > 0.05) {
            wSum += align;
            aSum += align * air[j]!;
            eSum += align * (cj.elevation + propLift[j]!);
            dSum += align * len;
          }
        }
        if (wSum <= 0) {
          air[i] = air[i]! * 0.92;
          continue;
        }
        const upwindAir = aSum / wSum;
        const upwindElev = eSum / wSum;
        const stepDist = dSum / wSum;
        const decay = Math.exp(-1.8 * (stepDist / (terrain.size || 1)));
        const climb = Math.max(0, (ci.elevation + propLift[i]!) - upwindElev);
        const condensed = Math.min(upwindAir * 0.72, climb * 2.4 * upwindAir);
        oroRain[i] = condensed * 1.45;
        const lakeBoost = ci.lake ? 0.14 : 0;
        air[i] = clamp(upwindAir * decay - condensed + lakeBoost);
      }
    }
  }

  const values = cells.map((c, i) => {
    const { x, y } = coords[i]!;
    const lat = lats[i]!;
    // Western coastal waters chill slightly vs warm eastern ocean gyres in temperate belts
    const hasWestOcean = c.land && c.neighbors.some((n) => isOcean[n] && cells[n]!.point.x < c.point.x);
    const hasEastOcean = c.land && c.neighbors.some((n) => isOcean[n] && cells[n]!.point.x > c.point.x);
    const gyreTemp = hasWestOcean && !hasEastOcean ? -0.04 : hasEastOcean && !hasWestOcean ? 0.04 : 0;
    const gyreRain = hasWestOcean && !hasEastOcean ? -0.03 : hasEastOcean && !hasWestOcean ? 0.04 : 0;
    const temperature = clamp(
      1 - Math.abs(lat) / 90 - Math.max(0, c.elevation + propLift[i]! - 0.45) * 0.75 + settings.temperature + gyreTemp + noise(x * 3 + 12, y * 3) * 0.07,
    );
    const localNoise = noise(x * 3, y * 3 + 21) * 0.16 + noise(x * 8, y * 8) * 0.06;
    const baseMoisture = hasWaterCells || cells.some(cell => cell.elevation <= seaLevel)
      ? 0.26 + air[i]! * 0.46 + oroRain[i]! * 0.45 + latitudeMoistureBias(lat) + gyreRain
      : 0.5 + noise(x * 3, y * 3 + 21) * 0.14;
    const moisture = clamp(baseMoisture + localNoise + settings.moisture);
    const rule =
      settings.biomes.find(
        r => temperature >= r.temperatureMin && temperature <= r.temperatureMax && moisture >= r.moistureMin && moisture <= r.moistureMax,
      ) ?? settings.biomes[settings.biomes.length - 1]!;
    return { temperature, moisture, rule };
  });

  const overrides = input.constraints.filter((e): e is Area => e.type === 'area' && e.role.startsWith('biome:'));
  const groups = terrain.cells.map((c, i) => (c.land && !overrides.some(e => contains(e.rings, c.point)) ? values[i]!.rule.name : null));
  const traced = traceCellBoundaries(terrain.cells.map(c => c.ring), groups);
  const entities: Entity[] = [];
  for (const [name, polygons] of traced) {
    const smoothed = smoothPolygons(polygons, 2);
    const worldPolys = smoothed.map(poly => poly.map(r => r.map(p => ({ x: b.minX + p.x * terrain.size, y: b.minY + p.y * terrain.size }))));
    let clipped = clipping.intersection(toPolygons(worldPolys), toPolygons(terrain.land));
    if (overrides.length && clipped.length) clipped = clipping.difference(clipped, ...overrides.map(e => toPolygons([e.rings])));
    const color = values.find(v => v.rule.name === name)!.rule.color;
    for (const rings of fromPolygons(clipped)) {
      entities.push({
        id: `biome-${entities.length}`,
        type: 'area',
        role: `biome:${name}`,
        name,
        fill: color,
        rings,
        layerId: 'base',
        origin: 'generated',
        rev: 0,
      });
    }
  }
  return { values, entities };
}
