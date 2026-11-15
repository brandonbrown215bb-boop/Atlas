import type { Point } from '../model/schema';

export const METRES_PER_MILE = 1609.344;
export const CLOCK_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
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
