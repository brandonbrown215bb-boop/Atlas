import type { MapDoc } from '../model/schema';
import { renderMapToPngBase64 } from '../render/renderPng';
import { ExportRectSchema, imageSize } from './imageSize';
export async function exportPlayerImage(map: MapDoc, pixelsPerSquare=200, selectedRect?: {x:number;y:number;w:number;h:number}) {
  const rect=ExportRectSchema.parse(selectedRect ?? map.bounds);
  const size=imageSize(rect,map.grid.size,pixelsPerSquare);
  const data=await renderMapToPngBase64({map:{...map,fog:{enabled:false,revealed:[]}},rect,...size,view:'player'});
  return {...size,rect,data,mimeType:'image/png' as const,report:size.capped?'Image capped at 8192 pixels per side. Pixels per square reduced to fit.':''};
}
