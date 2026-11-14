import { z } from 'zod';
export const ExportRectSchema = z.object({x:z.number().finite(),y:z.number().finite(),w:z.number().positive().finite(),h:z.number().positive().finite()});
export function imageSize(rect: {w:number;h:number}, gridSize: number, pixelsPerSquare: number) {
  z.number().positive().finite().parse(gridSize);
  z.number().positive().finite().parse(pixelsPerSquare);
  z.number().positive().finite().parse(rect.w);
  z.number().positive().finite().parse(rect.h);
  const factor=Math.min(1,8192/Math.max(rect.w,rect.h)*gridSize/pixelsPerSquare);
  const pixelsPerGrid=pixelsPerSquare*factor;
  const width=Math.max(1,Math.min(8192,Math.round(rect.w/gridSize*pixelsPerGrid)));
  const height=Math.max(1,Math.min(8192,Math.round(rect.h/gridSize*pixelsPerGrid)));
  return {width,height,pixelsPerGrid,capped:factor<1};
}
