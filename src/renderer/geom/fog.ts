import type { MultiPolygon } from 'polygon-clipping';
import clipping from './polygonClipping';
import type { Point, MapDoc } from '../model/schema';

export type Rect = {x:number;y:number;w:number;h:number};
export const rectRing = (r: Rect): Point[] => [{x:r.x,y:r.y},{x:r.x+r.w,y:r.y},{x:r.x+r.w,y:r.y+r.h},{x:r.x,y:r.y+r.h}];
export const toPolygons = (p: Point[][][]): MultiPolygon => p.map(poly => poly.map(ring => ring.map(p => [p.x,p.y])));
export const fromPolygons = (p: MultiPolygon): Point[][][] =>
  p
    .map((poly) =>
      poly
        .map((ring) => ring.slice(0, -1).map(([x, y]) => ({ x, y })))
        .filter((ring) => ring.length >= 3),
    )
    .filter((poly) => poly.length > 0);

function unionShapes(shapes: MultiPolygon): MultiPolygon {
  if (shapes.length === 0) return [];
  if (shapes.length <= 32) {
    return clipping.union(shapes[0]!, ...shapes.slice(1));
  }
  let acc: MultiPolygon = [];
  for (let i = 0; i < shapes.length; i += 32) {
    const chunk = shapes.slice(i, i + 32);
    const merged = clipping.union(chunk[0]!, ...chunk.slice(1));
    acc = acc.length ? clipping.union(acc, merged) : merged;
  }
  return acc;
}

export function paintFog(revealed: Point[][][], points: Point[], radius: number, hide: boolean): Point[][][] {
  if (!points.length) return revealed;
  const shapes: MultiPolygon = points.map(p => [Array.from({length:24},(_,i) => {
    const a = i * Math.PI / 12; return [p.x + Math.cos(a)*radius,p.y + Math.sin(a)*radius];
  })]);
  for (let i=1; i<points.length; i++) {
    const a=points[i-1]!, b=points[i]!, length=Math.hypot(b.x-a.x,b.y-a.y);
    if (!length) continue;
    const dx=-(b.y-a.y)/length*radius, dy=(b.x-a.x)/length*radius;
    shapes.push([[[a.x+dx,a.y+dy],[b.x+dx,b.y+dy],[b.x-dx,b.y-dy],[a.x-dx,a.y-dy]]]);
  }
  const brush = unionShapes(shapes);
  if (!brush.length) return revealed;
  if (!revealed.length) return hide ? [] : fromPolygons(brush);
  return fromPolygons(hide ? clipping.difference(toPolygons(revealed),brush) : clipping.union(toPolygons(revealed),brush));
}
export function mergeFogPolygons(a: Point[][][], b: Point[][][]): Point[][][] {
  if (!a.length) return b;
  if (!b.length) return a;
  return fromPolygons(clipping.union(toPolygons(a), toPolygons(b)));
}

export function fogCover(map: MapDoc, rect: Rect): Point[][][] {
  if (!map.fog.enabled) return [];
  const visible = [...map.fog.revealed, ...(map.fog.explored ?? [])];
  if (!visible.length) return [[rectRing(rect)]];
  return fromPolygons(clipping.difference(toPolygons([[rectRing(rect)]]), toPolygons(visible)));
}
export function fogMemoryCover(map: MapDoc, rect: Rect): Point[][][] {
  if (!map.fog.enabled) return [];
  const explored = map.fog.explored ?? [];
  if (!explored.length) return [];
  const clipped = clipping.intersection(toPolygons([[rectRing(rect)]]), toPolygons(explored));
  if (!clipped.length) return [];
  if (!map.fog.revealed.length) return fromPolygons(clipped);
  return fromPolygons(clipping.difference(clipped, toPolygons(map.fog.revealed)));
}
export function intersectsRevealed(map: MapDoc, rect: Rect): boolean {
  return !map.fog.enabled || clipping.intersection(toPolygons([[rectRing(rect)]]),toPolygons(map.fog.revealed)).length > 0;
}
export function intersectsExplored(map: MapDoc, rect: Rect): boolean {
  if (!map.fog.enabled) return true;
  const visible = [...map.fog.revealed, ...(map.fog.explored ?? [])];
  if (!visible.length) return false;
  return clipping.intersection(toPolygons([[rectRing(rect)]]), toPolygons(visible)).length > 0;
}
