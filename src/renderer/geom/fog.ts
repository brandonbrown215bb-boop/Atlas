import clipping, { type MultiPolygon } from 'polygon-clipping';
import type { Point, MapDoc } from '../model/schema';

export type Rect = {x:number;y:number;w:number;h:number};
export const rectRing = (r: Rect): Point[] => [{x:r.x,y:r.y},{x:r.x+r.w,y:r.y},{x:r.x+r.w,y:r.y+r.h},{x:r.x,y:r.y+r.h}];
export const toPolygons = (p: Point[][][]): MultiPolygon => p.map(poly => poly.map(ring => ring.map(p => [p.x,p.y])));
export const fromPolygons = (p: MultiPolygon): Point[][][] => p.map(poly => poly.map(ring => ring.slice(0,-1).map(([x,y]) => ({x,y}))));

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
  const brush = clipping.union(shapes);
  return fromPolygons(hide ? clipping.difference(toPolygons(revealed),brush) : clipping.union(toPolygons(revealed),brush));
}
export function fogCover(map: MapDoc, rect: Rect): Point[][][] {
  if (!map.fog.enabled) return [];
  return fromPolygons(clipping.difference(toPolygons([[rectRing(rect)]]),toPolygons(map.fog.revealed)));
}
export function intersectsRevealed(map: MapDoc, rect: Rect): boolean {
  return !map.fog.enabled || clipping.intersection(toPolygons([[rectRing(rect)]]),toPolygons(map.fog.revealed)).length > 0;
}
