import type { Point } from '../model/schema';
import { viewStore } from '../model/viewStore';
import type { MapTool } from './types';

export function createFogTool(): MapTool {
  let points: Point[] = [], hover: Point | null = null;
  let mode: 'reveal' | 'hide' = 'reveal', radius = 3;
  return {
    id:'fog',
    onPointerDown(pt,e,ctx) {
      if(e.button !== 0) return false;
      points=[pt]; hover=pt;
      ({fogMode:mode,fogRadius:radius}=viewStore.getState());
      ctx.requestRedraw(); return true;
    },
    onPointerMove(pt,_e,ctx) {
      hover=pt;
      if(points.length && Math.hypot(pt.x-points[points.length-1]!.x,pt.y-points[points.length-1]!.y) > radius/4) points.push(pt);
      ctx.requestRedraw();
    },
    onPointerUp(pt,_e,ctx) {
      if(!points.length) return;
      points.push(pt);
      ctx.execute('fog.paint',{mapId:ctx.map.id,mode,radius,points}); points=[]; ctx.requestRedraw();
    },
    onKey(e,ctx) { if(e.key !== 'Escape') return false; points=[];ctx.requestRedraw();return true; },
    drawOverlay(gfx,ctx) {
      if(!hover) return;
      const r=viewStore.getState().fogRadius;
      gfx.circle(hover.x,hover.y,r).stroke({color:0xfbbf24,width:2/ctx.camera.zoom});
      for(const p of points) gfx.circle(p.x,p.y,r).fill({color:0xfbbf24,alpha:0.12});
    },
  };
}
