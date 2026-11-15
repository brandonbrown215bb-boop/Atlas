import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, expect, _electron as electron } from '@playwright/test';

test('repairs stranded ocean contents and populates the selected unlocked geography layer',async()=>{
  const root=mkdtempSync(join(tmpdir(),'atlas-layer-recovery-'));
  const app=await electron.launch({args:[resolve(__dirname,'../out/main/index.js'),`--user-data-dir=${join(root,'profile')}`]});
  try {
    const page=await app.firstWindow();
    await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},join(root,'world'));
    await page.getByTestId('btn-new-world').click();
    await page.evaluate(()=>{
      const s=(window as any).__atlasWorldStore.getState(),world=structuredClone(s.world),map=world.maps[s.activeMapId];
      map.bounds={x:0,y:0,w:1000,h:1000};map.layers[0].locked=true;
      map.layers.push({id:'geography',name:'Geography',visible:true,locked:false,gmOnly:false});
      const ring=(x:number,y:number,w:number,h:number)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
      const base={type:'area',origin:'manual',rev:1};
      // This is an existing file produced by the old layer-delete bug.
      map.entities={land:{...base,id:'land',role:'land',layerId:'geography',rings:[ring(100,100,800,800)]},
        ocean:{...base,id:'ocean',role:'water',waterKind:'ocean',layerId:'missing-layer',rings:[ring(0,0,1000,1000)]}};
      s.loadWorld(world.meta,world.maps,s.worldPath);
    });
    await page.getByRole('button',{name:'Repair Existing World…',exact:true}).click();
    await expect(page.getByRole('region',{name:'Repair preview'})).toContainText('deleted layers');
    await page.getByRole('button',{name:'Apply Repair',exact:true}).click();
    await expect(page.getByTestId('layer-delete-missing-layer')).toBeDisabled();
    await expect(page.getByTestId('layer-delete-geography')).toBeDisabled();
    await expect(page.getByText('Recovered contents',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Add terrain detail',exact:true}).click();
    await expect(page.getByTestId('generation-strip')).toHaveAttribute('aria-busy','false');
    await expect(page.getByTestId('generation-strip').getByRole('alert')).toHaveCount(0);
    const result=await page.evaluate(()=>{
      const s=(window as any).__atlasWorldStore.getState(),map=s.world.maps[s.activeMapId];
      return {entities:Object.values(map.entities) as any[],layers:map.layers};
    });
    const output=result.entities.filter(e=>e.origin==='generated');
    expect(output.length).toBeGreaterThan(0);expect(output.every(e=>e.layerId==='geography')).toBe(true);
    expect(result.entities.every(e=>result.layers.some((l:any)=>l.id===e.layerId))).toBe(true);
    expect(result.entities.find(e=>e.id==='ocean')).toMatchObject({layerId:'missing-layer',origin:'manual'});
    await page.getByTestId('btn-save-now').click();
    await expect(page.getByTestId('save-status')).toContainText('Saved');
  } finally {await app.close();}
});
