import { viewStore } from '../model/viewStore';
import { resolveTargetLayerId, type MapTool } from './types';
import type { Point } from '../model/schema';

export function createBiomeTool(): MapTool {
  let points: Point[] = [], hover: Point | null = null;
  return {
    id: 'biome',
    onPointerDown(p, e, ctx) { if(e.button!==0)return false; points=[p];hover=p;ctx.requestRedraw();return true; },
    onPointerMove(p, _e, ctx) { hover=p;if(points.length&&Math.hypot(p.x-points[points.length-1]!.x,p.y-points[points.length-1]!.y)>viewStore.getState().biomeRadius/5)points.push(p);ctx.requestRedraw(); },
    onPointerUp(p, _e, ctx) { if(!points.length)return;points.push(p);const v=viewStore.getState(),layerId=resolveTargetLayerId(ctx.map,v.activeLayerId);if(layerId)ctx.execute('map.paintBiome',{mapId:ctx.map.id,biome:v.biomeName,points,radius:v.biomeRadius,erase:v.biomeErase,layerId});points=[];ctx.requestRedraw(); },
    onKey(e,ctx) { if(e.key==='Escape'&&points.length){points=[];ctx.requestRedraw();return true;}return false; },
    drawOverlay(gfx,ctx) { const v=viewStore.getState();if(hover)gfx.circle(hover.x,hover.y,v.biomeRadius).fill({color:v.biomeErase?0xf87171:0x6cad68,alpha:.18}).stroke({color:0xe5e7eb,width:1.5/ctx.camera.zoom}); },
  };
}
