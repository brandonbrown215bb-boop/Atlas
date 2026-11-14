import type { Point } from '../model/schema';

export const METRES_PER_MILE = 1609.344;
export const CLOCK_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export interface RouteMeasurement {
  metres: number;
  feet: number;
  miles: number;
  durationSeconds: number | null;
  arrival: { time: string; dayOffset: number } | null;
}

/** A constant-speed route calculation on the map's metre coordinates. */
export function measureRoute(points: readonly Point[], speedMph?: number, departure?: string): RouteMeasurement {
  if (points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
    throw new Error('Route coordinates must be finite.');
  }
  if (speedMph !== undefined && (!Number.isFinite(speedMph) || speedMph <= 0)) {
    throw new Error('Speed must be greater than zero.');
  }
  if (departure !== undefined && !CLOCK_TIME.test(departure)) {
    throw new Error('Departure must be a 24-hour time (HH:MM).');
  }
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
  if (durationSeconds !== null && departure !== undefined) {
    const [hours, minutes] = departure.split(':').map(Number);
    const total = hours! * 60 + minutes! + Math.round(durationSeconds / 60);
    const minuteOfDay = total % 1440;
    arrival = {
      time: `${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`,
      dayOffset: Math.floor(total / 1440),
    };
  }
  return { metres, feet: metres / 0.3048, miles, durationSeconds, arrival };
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
