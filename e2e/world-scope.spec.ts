import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, expect, _electron as electron } from '@playwright/test';

test('a selected trace group cannot silently restrict whole-map settlement generation',async()=>{
  const root=mkdtempSync(join(tmpdir(),'atlas-world-scope-'));
  const app=await electron.launch({args:[resolve(__dirname,'../out/main/index.js'),`--user-data-dir=${join(root,'profile')}`]});
  try {
    const page=await app.firstWindow();
    await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},join(root,'world'));
    await page.getByTestId('btn-new-world').click();
    await page.evaluate(()=>{
      const s=(window as any).__atlasWorldStore.getState(),map=s.world.maps[s.activeMapId];
      s.execute('map.setExtent',{mapId:map.id,bounds:{x:0,y:0,w:1000000,h:800000}});
      for(const [id,x,y,w,h]of [['tip',10000,200000,30000,30000],['west',100000,100000,300000,600000],['east',550000,100000,350000,600000]] as const)
        s.execute('entity.add',{mapId:map.id,entity:{id,type:'area',role:'land',name:'Traced land',groupId:'trace',layerId:map.layers[0].id,origin:'manual',rev:0,
          rings:[[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}]]}});
      (window as any).__atlasViewStore.getState().setSelection(['tip','west','east']);
    });
    const panel=page.getByTestId('generation-strip');
    // A mixed trace selection gets no generation action. Explicitly deselect to
    // work on the whole map; it automatically follows the traced coastlines.
    await expect(panel.getByRole('button',{name:'Add terrain detail',exact:true})).toHaveCount(0);
    await page.evaluate(()=>(window as any).__atlasViewStore.getState().setSelection([]));
    await panel.getByRole('button',{name:'Add terrain detail',exact:true}).click();
    await expect(panel).toHaveAttribute('aria-busy','false');await expect(panel.getByRole('alert')).toHaveCount(0);
    const snapshot=()=>page.evaluate(()=>{const s=(window as any).__atlasWorldStore.getState();return s.world.maps[s.activeMapId];});
    let map=await snapshot();const genId=Object.keys(map.generators)[0]!;
    const suggestions=Object.values(map.entities).filter((e:any)=>e.suggestedSettlement) as any[];
    expect(suggestions).toHaveLength(12);expect(suggestions.some(e=>e.x<400000)).toBe(true);expect(suggestions.some(e=>e.x>550000)).toBe(true);
    expect(map.generators[genId].boundary[0]).toEqual([{x:0,y:0},{x:map.bounds.w,y:0},{x:map.bounds.w,y:map.bounds.h},{x:0,y:map.bounds.h}]);
    await panel.getByRole('button',{name:'Try another',exact:true}).click();
    await expect(panel).toHaveAttribute('aria-busy','false');await expect(panel.getByRole('alert')).toHaveCount(0);
    map=await snapshot();expect(suggestions.every(e=>!map.entities[e.id])).toBe(true);
    expect(Object.values(map.entities).filter((e:any)=>e.suggestedSettlement)).toHaveLength(12);
    await panel.getByText('More…',{exact:true}).click();
    await panel.getByRole('button',{name:'Make independent',exact:true}).click();
    await expect(panel.getByRole('alert')).toHaveCount(0);expect((await snapshot()).generators[genId]).toBeUndefined();
  } finally {await app.close();}
});
