import type { MapDoc, Point } from '../model/schema';
import { distanceToSegment, pointInRing } from './hitTest';

export const METRES_PER_MILE = 1609.344;
export const CLOCK_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

const ROUTE_TIER_SPEED_FACTOR: Record<string, number> = {
  highway: 1.5,
  road: 1.0,
  track: 0.75,
  gameTrail: 0.67,
  secret: 0.67,
  sewer: 0.6,
};

export interface RouteTerrainSample {
  factor: number;
  weightedSecondsMultiplier: number;
  terrainLabel: string;
  lostChance: string;
  roadShare: number;
  domainBreakdown: {
    road: number;
    woods: number;
    rough: number;
    water: number;
    plains: number;
  };
}


/** Samples route terrain, path tiers, and terrain cells to derive speed factor and OSE getting-lost odds. */
export function sampleRouteTerrain(
  points: readonly Point[],
  map?: Pick<MapDoc, 'entities' | 'terrain'>,
): RouteTerrainSample {
  if (points.length < 2 || !map) {
    return {
      factor: 1,
      weightedSecondsMultiplier: 1,
      terrainLabel: 'Open plains',
      lostChance: '1-in-6',
      roadShare: 0,
      domainBreakdown: { road: 0, woods: 0, rough: 0, water: 0, plains: 1 },
    };
  }
  const entities = Object.values(map.entities);
  const roads = entities.filter((e): e is Extract<typeof entities[number], { type: 'path' }> =>
    (e.type === 'path' && (e.role === 'road' || e.role === 'trail') && e.routeTier !== 'sewer' && e.points.length >= 2));
  const areas = entities.filter((e): e is Extract<typeof entities[number], { type: 'area' }> =>
    e.type === 'area' && (e.role.startsWith('biome:') || e.role === 'plateau' || e.role === 'water'));
  const terrainCells = Object.values(map.terrain ?? {}).flatMap((t) => t.cells);

  const samplePts: Point[] = [];
  const segCount = 20;
  let totalLen = 0;
  for (let i = 1; i < points.length; i++) totalLen += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  if (totalLen <= 0) {
    return {
      factor: 1,
      weightedSecondsMultiplier: 1,
      terrainLabel: 'Open plains',
      lostChance: '1-in-6',
      roadShare: 0,
      domainBreakdown: { road: 0, woods: 0, rough: 0, water: 0, plains: 1 },
    };
  }
  for (let s = 0; s <= segCount; s++) {
    let target = (s / segCount) * totalLen;
    let chosen = points[points.length - 1]!;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!, b = points[i]!, len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len >= target || i === points.length - 1) {
        const t = len > 0 ? Math.max(0, Math.min(1, target / len)) : 0;
        chosen = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        break;
      }
      target -= len;
    }
    samplePts.push(chosen);
  }

  let factorSum = 0;
  let roadHits = 0;
  let woodsHits = 0;
  let roughHits = 0;
  let waterHits = 0;
  let plainsHits = 0;
  for (const pt of samplePts) {
    let bestRoadFactor: number | null = null;
    for (const r of roads) {
      const reach = Math.max(10, r.width * 1.2);
      const reachSq = reach * reach;
      for (let i = 1; i < r.points.length; i++) {
        if (distanceToSegment(pt, r.points[i - 1]!, r.points[i]!) ** 2 <= reachSq) {
          const rf = ROUTE_TIER_SPEED_FACTOR[r.routeTier ?? 'road'] ?? 1.0;
          if (bestRoadFactor === null || rf > bestRoadFactor) bestRoadFactor = rf;
          break;
        }
      }
    }
    if (bestRoadFactor !== null) {
      factorSum += bestRoadFactor;
      roadHits++;
      continue;
    }

    let areaFactor: number | null = null;
    for (const a of areas) {
      const ring = a.rings[0];
      if (!ring || ring.length < 3 || !pointInRing(pt, ring)) continue;
      if (a.role === 'water') {
        areaFactor = 0.8;
        waterHits++;
        break;
      }
      if (a.role === 'plateau' || /marsh|swamp|mountain|jungle|tundra|glacier/i.test(a.role)) {
        areaFactor = 0.5;
        roughHits++;
        break;
      }
      if (/forest|woods|hills|taiga|savanna/i.test(a.role)) {
        areaFactor = 0.67;
        woodsHits++;
      }
    }
    if (areaFactor !== null) {
      factorSum += areaFactor;
      continue;
    }

    if (terrainCells.length > 0) {
      let nearest = terrainCells[0]!;
      let bestD = (nearest.x - pt.x) ** 2 + (nearest.y - pt.y) ** 2;
      for (let i = 1; i < terrainCells.length; i++) {
        const c = terrainCells[i]!;
        const d = (c.x - pt.x) ** 2 + (c.y - pt.y) ** 2;
        if (d < bestD) { bestD = d; nearest = c; }
      }
      if (!nearest.land) {
        factorSum += 0.85;
        waterHits++;
        continue;
      }
      if (nearest.land && nearest.elevation > 0.65) {
        factorSum += 0.5;
        roughHits++;
        continue;
      }
      if (nearest.land && nearest.elevation > 0.42) {
        factorSum += 0.67;
        woodsHits++;
        continue;
      }
    }
    plainsHits++;
    factorSum += 1.0;
  }

  const total = Math.max(1, samplePts.length);
  const factor = Math.max(0.25, factorSum / total);
  const roadShare = roadHits / total;
  let terrainLabel = 'Open plains';
  if (waterHits > total * 0.45) terrainLabel = 'Sea / waterway';
  else if (roadShare >= 0.5) terrainLabel = factor >= 1.2 ? 'Highway' : factor < 0.85 ? 'Track / trail' : 'Road';
  else if (roughHits >= woodsHits && roughHits > total * 0.25) terrainLabel = 'Mountains / rough';
  else if (woodsHits > total * 0.25) terrainLabel = 'Woods / hills';

  const lostChance =
    roadShare >= 0.7 ? '0-in-6 (marked route)'
      : factor >= 0.9 ? '1-in-6'
        : factor >= 0.62 ? '2-in-6'
          : '3-in-6';

  return {
    factor,
    weightedSecondsMultiplier: 1 / factor,
    terrainLabel,
    lostChance,
    roadShare,
    domainBreakdown: {
      road: roadHits / total,
      woods: woodsHits / total,
      rough: roughHits / total,
      water: waterHits / total,
      plains: plainsHits / total,
    },
  };
}

/** Geometric sighting horizon in metres from eye elevation (default ~5.5ft standing human). */
export function horizonDistanceMetres(eyeHeightFt = 5.5, canopyReduction = 0): number {
  const heightMetres = Math.max(0.3, eyeHeightFt * 0.3048);
  const clearHorizon = 3570 * Math.sqrt(heightMetres);
  return Math.max(30, clearHorizon * (1 - Math.min(0.95, Math.max(0, canopyReduction))));
}

/** Daily march radius and +/-20% jitter band in metres. */
export function dailyTravelJitterBand(speedMph: number, hoursPerDay = 8): { nominalMetres: number; minMetres: number; maxMetres: number } {
  const nominalMetres = Math.max(0, speedMph) * Math.max(0.25, hoursPerDay) * METRES_PER_MILE;
  return { nominalMetres, minMetres: nominalMetres * 0.8, maxMetres: nominalMetres * 1.2 };
}
export interface TravelSchedule { startTime: string; hoursPerDay: number }
const clockSeconds = (time: string) => { const [h, m] = time.split(':').map(Number); return h! * 3600 + m! * 60; };

function travelWindow(departure: string, schedule: TravelSchedule) {
  const departed = clockSeconds(departure), start = clockSeconds(schedule.startTime), daily = schedule.hoursPerDay * 3600;
  let windowStart = Math.floor((departed - start) / 86400) * 86400 + start;
  if (departed >= windowStart + daily) windowStart += 86400;
  const begins = Math.max(departed, windowStart);
  return { departed, begins, first: windowStart + daily - begins, windowStart, daily };
}

export interface RouteMeasurement {
  metres: number;
  feet: number;
  miles: number;
  durationSeconds: number | null;
  elapsedSeconds: number | null;
  restStops: number;
  arrival: { time: string; dayOffset: number } | null;
}

/** A constant-speed route calculation on the map's metre coordinates. */
export function measureRoute(points: readonly Point[], speedMph?: number, departure?: string, schedule?: TravelSchedule): RouteMeasurement {
  if (points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
    throw new Error('Route coordinates must be finite.');
  }
  if (speedMph !== undefined && (!Number.isFinite(speedMph) || speedMph <= 0)) {
    throw new Error('Speed must be greater than zero.');
  }
  if (departure !== undefined && !CLOCK_TIME.test(departure)) {
    throw new Error('Departure must be a 24-hour time (HH:MM).');
  }
  if (schedule && (!CLOCK_TIME.test(schedule.startTime) || !Number.isFinite(schedule.hoursPerDay) || schedule.hoursPerDay <= 0 || schedule.hoursPerDay > 24)) {
    throw new Error('Travel schedule needs a valid start time and more than zero, up to 24 hours per day.');
  }
  if (schedule && (speedMph === undefined || departure === undefined)) throw new Error('A travel schedule needs speed and departure time.');
  let metres = 0;
  for (let i = 1; i < points.length; i++) {
    metres += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  }
  if (!Number.isFinite(metres)) throw new Error('Route distance is too large.');
  const miles = metres / METRES_PER_MILE;
  const durationSeconds = speedMph === undefined ? null : miles / speedMph * 3600;
  if (durationSeconds !== null && !Number.isSafeInteger(Math.round(durationSeconds / 60))) {
    throw new Error('Travel time is too large.');
  }
  let arrival: RouteMeasurement['arrival'] = null;
  let elapsedSeconds = durationSeconds, restStops = 0;
  if (durationSeconds !== null && departure !== undefined) {
    if (schedule && durationSeconds > 0 && schedule.hoursPerDay < 24) {
      const w = travelWindow(departure, schedule);
      if (durationSeconds <= w.first + 1e-7) elapsedSeconds = w.begins - w.departed + durationSeconds;
      else {
        const remaining = durationSeconds - w.first;
        const windows = Math.max(1, Math.ceil(remaining / w.daily - 1e-10));
        elapsedSeconds = w.windowStart + windows * 86400 + remaining - (windows - 1) * w.daily - w.departed;
        restStops = windows;
      }
    }
    if (elapsedSeconds !== null && !Number.isSafeInteger(Math.round(elapsedSeconds / 60))) throw new Error('Travel time is too large.');
    const total = clockSeconds(departure) / 60 + Math.round(elapsedSeconds! / 60);
    const minuteOfDay = total % 1440;
    arrival = {
      time: `${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`,
      dayOffset: Math.floor(total / 1440),
    };
  }
  return { metres, feet: metres / 0.3048, miles, durationSeconds, elapsedSeconds, restStops, arrival };
}

/** Bounded GM annotations, interpolated along the actual polyline. No save data. */
export function travelMarkers(points: readonly Point[], speedMph: number, departure: string, schedule?: TravelSchedule): Array<Point & { kind: 'watch' | 'camp' }> {
  const measurement = measureRoute(points, speedMph, departure, schedule);
  const duration = measurement.durationSeconds!;
  const times: Array<{ at: number; kind: 'watch' | 'camp' }> = [];
  for (let at = 14400; at < duration - 1e-7 && times.length < 128; at += 14400) times.push({ at, kind: 'watch' });
  if (schedule && schedule.hoursPerDay < 24) {
    const w = travelWindow(departure, schedule);
    for (let at = w.first; at < duration - 1e-7 && times.length < 256; at += w.daily) times.push({ at, kind: 'camp' });
  }
  return times.map(mark => {
    let remaining = mark.at * speedMph / 3600 * METRES_PER_MILE;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!, b = points[i]!, length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length > 0 && remaining <= length + 1e-7) return { x: a.x + (b.x - a.x) * remaining / length, y: a.y + (b.y - a.y) * remaining / length, kind: mark.kind };
      remaining -= length;
    }
    return { ...points[points.length - 1]!, kind: mark.kind };
  });
}

export function formatMeasureDistance(measurement: RouteMeasurement): string {
  return measurement.metres < METRES_PER_MILE
    ? `${measurement.feet.toLocaleString('en-US', { maximumFractionDigits: 1 })} ft`
    : `${measurement.miles.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} mi`;
}

export function formatTravelDuration(seconds: number): string {
  if (seconds > 0 && seconds < 60) return '<1 min';
  const minutes = Math.round(seconds / 60);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor(minutes % 1440 / 60);
  const remaining = minutes % 60;
  return [days ? `${days} d` : '', hours ? `${hours} h` : '', remaining || !minutes ? `${remaining} min` : ''].filter(Boolean).join(' ');
}
