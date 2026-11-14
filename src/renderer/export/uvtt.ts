import type { Entity, MapDoc, Point } from '../model/schema';
import { ExportRectSchema, imageSize } from './imageSize';
import type { Rect } from '../geom/fog';

/** Liang-Barsky segment clipping, including lines crossing the rectangle with both ends outside. */
export function clipSegment(a: Point,b: Point,r: Rect): [Point,Point] | null {
  const dx=b.x-a.x,dy=b.y-a.y;
  let lo=0,hi=1;
  for(const [p,q] of [[-dx,a.x-r.x],[dx,r.x+r.w-a.x],[-dy,a.y-r.y],[dy,r.y+r.h-a.y]]) {
    if(p===0) { if(q!<0) return null; continue; }
    const t=q!/p!;
    if(p!<0) lo=Math.max(lo,t); else hi=Math.min(hi,t);
    if(lo>hi) return null;
  }
  if(hi-lo<1e-10) return null;
  return [{x:a.x+lo*dx,y:a.y+lo*dy},{x:a.x+hi*dx,y:a.y+hi*dy}];
}

/** All positions are in grid squares. References: Arkenforge UVTT docs and FVTT-DD-Import/ddimport.js. */
export function exportUvtt(map: MapDoc, image: string, pixelsPerSquare=200, selectedRect?: Rect) {
  const rect=ExportRectSchema.parse(selectedRect ?? map.bounds);
  const size=imageSize(rect,map.grid.size,pixelsPerSquare);
  const layers=new Set(map.layers.filter(l=>l.visible && !l.gmOnly).map(l=>l.id));
  const entities=Object.values(map.entities).filter(e=>layers.has(e.layerId) && !e.gmOnly);
  const doors=entities.filter((e):e is Extract<Entity,{type:'door'}>=>e.type==='door');
  const unit=(p:Point):Point=>({x:(p.x-rect.x)/map.grid.size,y:(p.y-rect.y)/map.grid.size});
  const line_of_sight: Point[][]=[];
  for(const wall of entities) {
    if(wall.type!=='wall' || !wall.blocksSight) continue;
    for(let i=1;i<wall.points.length;i++) {
      const a=wall.points[i-1]!,b=wall.points[i]!,dx=b.x-a.x,dy=b.y-a.y,l2=dx*dx+dy*dy;
      if(!l2) continue;
      let pieces: Array<[number,number]>=[[0,1]];
      for(const door of doors) {
        const cross=(p:Point)=>Math.abs((p.x-a.x)*dy-(p.y-a.y)*dx)/Math.sqrt(l2);
        if(cross(door.a)>0.001 || cross(door.b)>0.001) continue;
        const t=(p:Point)=>((p.x-a.x)*dx+(p.y-a.y)*dy)/l2;
        const start=Math.max(0,Math.min(t(door.a),t(door.b))),end=Math.min(1,Math.max(t(door.a),t(door.b)));
        if(start>=end) continue;
        pieces=pieces.flatMap(([lo,hi])=>end<=lo || start>=hi?[[lo,hi] as [number,number]]:
          [...(start>lo?[[lo,start] as [number,number]]:[]),...(end<hi?[[end,hi] as [number,number]]:[])]);
      }
      for(const [lo,hi] of pieces) {
        const clipped=clipSegment({x:a.x+lo*dx,y:a.y+lo*dy},{x:a.x+hi*dx,y:a.y+hi*dy},rect);
        if(clipped) line_of_sight.push(clipped.map(unit));
      }
    }
  }
  const secretDoors: string[]=[];
  const portals=doors.flatMap(d=>{
    const segment=clipSegment(d.a,d.b,rect);
    if(!segment) return [];
    if(d.kind==='secret') secretDoors.push(d.name || d.id);
    return [{position:unit({x:(segment[0].x+segment[1].x)/2,y:(segment[0].y+segment[1].y)/2}),bounds:segment.map(unit),rotation:Math.atan2(d.b.y-d.a.y,d.b.x-d.a.x),closed:d.kind==='secret'||!d.open,freestanding:false,...(d.kind==='secret'?{secret:true}:{})}];
  });
  const lights=entities.flatMap(e=>e.type==='light' && e.x>=rect.x && e.x<=rect.x+rect.w && e.y>=rect.y && e.y<=rect.y+rect.h?
    [{position:unit(e),range:e.radius/map.grid.size,intensity:1,color:`ff${/^#[0-9a-f]{6}$/i.test(e.color)?e.color.slice(1):'fde047'}`,shadows:true}]:[]);
  return { document:{format:0.2,resolution:{map_origin:{x:0,y:0},map_size:{x:rect.w/map.grid.size,y:rect.h/map.grid.size},pixels_per_grid:size.pixelsPerGrid},
    line_of_sight,objects_line_of_sight:[],portals,lights,environment:{baked_lighting:false,ambient_light:'ffffffff'},image},
    secretDoors,report:secretDoors.length?`Secret doors exported as closed portals with secret:true: ${secretDoors.join(', ')}. Set them to secret doors in Foundry after importing.`:''};
}
