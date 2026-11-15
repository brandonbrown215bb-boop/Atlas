import type { MapKind } from './schema';
export const MILE = 1609.344;
export const FOOT = .3048;
export function defaultBounds(kind: MapKind) {
  const [w, h] = kind === 'world' ? [1000 * MILE, 1000 * MILE] :
    kind === 'region' ? [100 * MILE, 100 * MILE] : kind === 'settlement' ? [MILE, MILE] :
    kind === 'site' ? [500 * FOOT, 500 * FOOT] : [150 * FOOT, 100 * FOOT];
  return { x: 0, y: 0, w: w!, h: h! };
}
export function distanceLabel(metres: number) {
  return metres >= MILE ? `${(metres / MILE).toFixed(2)} mi` : `${(metres / FOOT).toFixed(0)} ft`;
}
export function extentLabel(bounds: { w: number; h: number }) {
  return `${distanceLabel(bounds.w)} × ${distanceLabel(bounds.h)} · ${(bounds.w * bounds.h / (MILE * MILE)).toFixed(3)} sq mi`;
}
