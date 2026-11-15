import type { Entity, MapDoc, Point } from '../model/schema';

/** Recover the affine change from a group's unchanged boundary topology. */
export function affineFromRings(before:Point[][],after:Point[][]){
  const a=before[0],b=after[0];if(!a||!b||a.length!==b.length||a.length<3)return null;
  const p=a[0]!,q=b[0]!;
  for(let j=2;j<a.length;j++){
    const u={x:a[1]!.x-p.x,y:a[1]!.y-p.y},v={x:a[j]!.x-p.x,y:a[j]!.y-p.y},det=u.x*v.y-u.y*v.x;if(Math.abs(det)<1e-10)continue;
    const U={x:b[1]!.x-q.x,y:b[1]!.y-q.y},V={x:b[j]!.x-q.x,y:b[j]!.y-q.y};
    const xx=(U.x*v.y-V.x*u.y)/det,xy=(V.x*u.x-U.x*v.x)/det,yx=(U.y*v.y-V.y*u.y)/det,yy=(V.y*u.x-U.y*v.x)/det;
    return {point:(r:Point)=>({x:q.x+xx*(r.x-p.x)+xy*(r.y-p.y),y:q.y+yx*(r.x-p.x)+yy*(r.y-p.y)}),vector:(r:Point)=>({x:xx*r.x+xy*r.y,y:yx*r.x+yy*r.y}),sx:Math.hypot(xx,yx),sy:Math.hypot(xy,yy),angle:Math.atan2(yx,xx)};
  }return null;
}
export function inheritTerrain(parent:MapDoc,rect:{x:number;y:number;w:number;h:number}):MapDoc['terrain']{
  const result:NonNullable<MapDoc['terrain']>={};
  for(const [id,model]of Object.entries(parent.terrain??{})){
    const pad=model.cells.length?Math.max(model.bounds.w,model.bounds.h)/Math.sqrt(model.cells.length)*1.5:0;
    const entries=model.cells.map((c,i)=>({c,i})).filter(({c})=>c.x>=rect.x-pad&&c.y>=rect.y-pad&&c.x<=rect.x+rect.w+pad&&c.y<=rect.y+rect.h+pad);if(!entries.length)continue;
    const indices=new Map(entries.map(({i},j)=>[i,j]));
    result[`inherited:${id}`]={...model,bounds:{...model.bounds,x:model.bounds.x-rect.x,y:model.bounds.y-rect.y},cells:entries.map(({c})=>({...c,x:c.x-rect.x,y:c.y-rect.y,downstream:c.downstream===undefined?undefined:indices.get(c.downstream)??-1}))};
  }return result;
}

/** Bake a parent transform into developed geography; interiors keep their dimensions. */
export function transformChildren(maps:Record<string,MapDoc>,parentId:string,t:NonNullable<ReturnType<typeof affineFromRings>>,include?:(child:MapDoc)=>boolean){
  for(const child of Object.values(maps))if(child.parent?.mapId===parentId&&(!include||include(child))){
    const anchor=t.point(child.parent);
    if(child.kind==='interior'){child.parent.x=anchor.x;child.parent.y=anchor.y;child.parent.rotation+=t.angle;child.revision++;continue;}
    const b=child.bounds,corners=[{x:b.x,y:b.y},{x:b.x+b.w,y:b.y},{x:b.x+b.w,y:b.y+b.h},{x:b.x,y:b.y+b.h}].map(t.vector);
    const minX=Math.min(...corners.map(p=>p.x)),minY=Math.min(...corners.map(p=>p.y));
    const local=(p:Point)=>{const q=t.vector(p);return{x:q.x-minX,y:q.y-minY};};
    const scale=Math.sqrt(t.sx*t.sy);
    child.parent.x=anchor.x+minX;child.parent.y=anchor.y+minY;
    child.bounds={x:0,y:0,w:Math.max(...corners.map(p=>p.x))-minX,h:Math.max(...corners.map(p=>p.y))-minY};
    child.revision++;
    for(const e of Object.values(child.entities)){
      if(e.type==='area')e.rings=e.rings.map(r=>r.map(local));
      else if(e.type==='path'||e.type==='wall'){e.points=e.points.map(local);if(e.type==='path')e.width*=scale;}
      else if(e.type==='door'){e.a=local(e.a);e.b=local(e.b);}
      else if('x'in e){Object.assign(e,local(e));if(e.type==='image'){e.w*=scale;e.h*=scale;e.rotation+=t.angle;}else if(e.type==='prop'){e.rotation+=t.angle;if(e.w)e.w*=scale;if(e.h)e.h*=scale;if(!e.w&&!e.h)e.scale*=scale;}else if(e.type==='light')e.radius*=scale;}
      if((e.type==='area'||e.type==='path'||e.type==='wall')&&e.texture)e.texture.metersPerPixel*=scale;
      e.rev=child.revision;
    }
    for(const r of Object.values(child.generators))if(r.boundary)r.boundary=r.boundary.map(ring=>ring.map(local));
    for(const g of Object.values(child.groups??{}))if(g.boundary)g.boundary=g.boundary.map(ring=>ring.map(local));
    for(const [id,p]of Object.entries(child.riverNodes??{}))child.riverNodes![id]=local(p);
    child.fog.revealed=child.fog.revealed.map(p=>p.map(r=>r.map(local)));
    for(const model of Object.values(child.terrain??{})){model.cells=model.cells.map(c=>({...c,...local(c)}));const a=local(model.bounds);model.bounds={...a,w:model.bounds.w*scale,h:model.bounds.h*scale};}
    transformChildren(maps,child.id,{...t,point:local});
  }
}
