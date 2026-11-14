import { expect,it } from 'vitest';
import { imageSize } from './imageSize';
it('uses real grid dimensions and proportionally caps large exports', () => {
  expect(imageSize({w:15.24,h:7.62},1.524,200)).toEqual({width:2000,height:1000,pixelsPerGrid:200,capped:false});
  const capped=imageSize({w:152.4,h:76.2},1.524,200);
  expect(capped).toMatchObject({width:8192,height:4096,capped:true});
  expect(capped.pixelsPerGrid).toBeCloseTo(81.92);
  expect(()=>imageSize({w:1,h:1},1,0)).toThrow();
});
