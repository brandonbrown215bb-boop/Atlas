import { resolveWallChannels, type Entity, type MapDoc, type Point } from '../model/schema';
import { ExportRectSchema, imageSize } from './imageSize';
import type { Rect } from '../geom/fog';
import { wallSegmentOutsideDoors } from '../geom/visibility';
import { clipSegmentToRect } from '../geom/clipInherit';

/** Rectangle clipping that also drops pieces that only touch the edge. */
export function clipSegment(a: Point,b: Point,r: Rect): [Point,Point] | null {
  const clipped=clipSegmentToRect(a,b,r);
  return clipped && Math.hypot(clipped[1].x-clipped[0].x,clipped[1].y-clipped[0].y)>=1e-10*Math.hypot(b.x-a.x,b.y-a.y) ? clipped : null;
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
  const objects_line_of_sight: Point[][]=[];
  for(const wall of entities) {
    if(wall.type!=='wall') continue;
    const channels = resolveWallChannels(wall);
    if(!channels.blocksSight && !channels.blocksLight) continue;
    const target = channels.wallKind === 'terrain' ? objects_line_of_sight : line_of_sight;
    for(let i=1;i<wall.points.length;i++) {
      for(const piece of wallSegmentOutsideDoors(wall.points[i-1]!,wall.points[i]!,doors)) {
        const clipped=clipSegment(piece.a,piece.b,rect);
        if(clipped) target.push(clipped.map(unit));
      }
    }
  }
  const secretDoors: string[]=[];
  const portals=doors.flatMap(d=>{
    const segment=clipSegment(d.a,d.b,rect);
    if(!segment) return [];
    if(d.kind==='secret') secretDoors.push(d.name || d.id);
    return [{position:unit({x:(segment[0].x+segment[1].x)/2,y:(segment[0].y+segment[1].y)/2}),bounds:segment.map(unit),rotation:Math.atan2(d.b.y-d.a.y,d.b.x-d.a.x),closed:d.kind==='secret'||!d.open,freestanding:false,...(d.locked?{locked:true}:{}),...(d.kind==='secret'?{secret:true}:{})}];
  });
  const lights=entities.flatMap(e=>e.type==='light' && e.x>=rect.x && e.x<=rect.x+rect.w && e.y>=rect.y && e.y<=rect.y+rect.h?
    [{position:unit(e),range:e.radius/map.grid.size,intensity:1,color:`ff${/^#[0-9a-f]{6}$/i.test(e.color)?e.color.slice(1):'fde047'}`,shadows:true}]:[]);
  return { document:{format:0.2,resolution:{map_origin:{x:0,y:0},map_size:{x:rect.w/map.grid.size,y:rect.h/map.grid.size},pixels_per_grid:size.pixelsPerGrid},
    line_of_sight,objects_line_of_sight,portals,lights,environment:{baked_lighting:false,ambient_light:'ffffffff'},image},
    secretDoors,report:secretDoors.length?`Secret doors exported as closed portals with secret:true: ${secretDoors.join(', ')}. Set them to secret doors in Foundry after importing.`:''};
}
