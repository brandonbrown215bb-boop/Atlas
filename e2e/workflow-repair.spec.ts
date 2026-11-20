import { chooseTool, generationPanel, clearStage, restoreStage, openPanel } from './context-helpers';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, expect, _electron as electron, type Page } from '@playwright/test';

// Read camera/model state for assertions and pointer placement; never set either.
async function snapshot(page:Page){return page.evaluate(()=>{const w=window as any,s=w.__atlasWorldStore.getState(),v=w.__atlasViewStore.getState();return {world:s.world,map:s.world.maps[s.activeMapId],camera:v.panels[v.activeMapPanelId??'map-main']?.camera,selected:v.selectedEntityIds};});}
async function screenPoint(page:Page,p:{x:number;y:number}){const camera=await page.evaluate(()=>{const v=(window as any).__atlasViewStore.getState();return v.panels[v.activeMapPanelId??'map-main'].camera;}),b=(await page.getByTestId('panel-map-main').locator('canvas').boundingBox())!;return{x:b.x+camera.x+p.x*camera.zoom,y:b.y+camera.y+p.y*camera.zoom};}
/** Click buildings (largest first) until one is selected on its own: a tree, prop or name can sit on top of any given roof. */
async function clickABuilding(page:Page,buildings:any[]){
  const size=(b:any)=>Math.hypot(b.rings[0][1].x-b.rings[0][0].x,b.rings[0][1].y-b.rings[0][0].y);
  for(const b of [...buildings].sort((x,y)=>size(y)-size(x)).slice(0,12)){
    const c=b.rings[0].reduce((a:any,p:any)=>({x:a.x+p.x/b.rings[0].length,y:a.y+p.y/b.rings[0].length}),{x:0,y:0}),q=await screenPoint(page,c);
    await page.mouse.click(q.x,q.y);
    // Any single building will do; a click near an edge can land on the neighbour.
    if(await page.evaluate(()=>{const ids=(window as any).__atlasViewStore.getState().selectedEntityIds,s=(window as any).__atlasWorldStore.getState(),e=s.world.maps[s.activeMapId].entities[ids[0]];return ids.length===1&&e?.type==='area'&&e.role==='building';}))return b;
    await page.waitForTimeout(500); // keep the next click from counting as a double-click
  }
  throw new Error('No building could be selected by clicking');
}
async function draw(page:Page,role:string,points:Array<{x:number;y:number}>){await chooseTool(page,'area');await page.getByTestId('select-area-role').selectOption(role);for(const p of points){const q=await screenPoint(page,p);await page.mouse.click(q.x,q.y);}await page.getByTestId('panel-map-main').locator('canvas').press('Enter');}
const rectangle=(x:number,y:number,w:number,h:number)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
async function waitGeneration(page:Page){await page.waitForFunction(()=>document.querySelector('[data-testid="panel-generator"] [data-testid="generation-settings"]')?.getAttribute('aria-busy')==='false');expect(await (await generationPanel(page)).getByRole('alert').allTextContents()).toEqual([]);}

test('empty world → grouped terrain → sized child → city → interior, then unrelated-map navigation and restart',async({},testInfo)=>{
  const dir=mkdtempSync(join(tmpdir(),'atlas-workflow-repair-')),args=[resolve(__dirname,'../out/main/index.js'),`--user-data-dir=${join(dir,'profile')}`];
  let app=await electron.launch({args});
  try{
    const page=await app.firstWindow(); page.setDefaultTimeout(10_000);await page.waitForLoadState('domcontentloaded');
    await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},join(dir,'world'));
    await page.getByTestId('btn-new-world').click();await expect(page.getByTestId('save-status')).toContainText('New World');
    await (await generationPanel(page)).getByRole('button',{name:'Generate terrain',exact:true}).click();await waitGeneration(page);
    let s=await snapshot(page);const worldMapId=s.map.id;
    expect(s.map.bounds.w).toBe(1609344);expect(Object.values(s.map.terrain)[0]).toMatchObject({algorithmVersion:2});
    const biomes=Object.values(s.map.entities).filter((e:any)=>e.type==='area'&&e.role.startsWith('biome:')) as any[];expect(new Set(biomes.map(e=>e.role)).size).toBeGreaterThan(2);
    await page.getByTestId('fit-map').click();
    s=await snapshot(page);const terrain=(Object.values(s.map.terrain)[0] as any),land=terrain.cells.filter((c:any)=>c.land&&c.elevation>.48&&c.elevation<.65).sort((a:any,b:any)=>Math.hypot(a.x-800000,a.y-800000)-Math.hypot(b.x-800000,b.y-800000))[0];expect(land).toBeTruthy();
    await page.getByTestId('tool-btn-select').click();let q=await screenPoint(page,land);await page.mouse.click(q.x,q.y);s=await snapshot(page);expect(s.selected.length).toBeGreaterThan(2);
    await page.getByTestId('panel-map-main').screenshot({path:testInfo.outputPath('world-cartography.png')});
    await chooseTool(page,'developArea');q=await screenPoint(page,land);await page.mouse.move(q.x-20,q.y-20);await page.mouse.down();await page.mouse.move(q.x+20,q.y+20,{steps:3});await page.mouse.up();
    await page.getByTestId('develop-area-name').fill('Walkthrough Town');await page.getByTestId('select-develop-kind').selectOption('settlement');await page.getByTestId('develop-area-width').fill('1');await page.getByTestId('develop-area-height').fill('1');await page.getByTestId('btn-confirm-develop').click();
    await expect(page.getByTestId('active-map-title')).toContainText('Walkthrough Town');await page.getByTestId('fit-map').click();
    s=await snapshot(page);const townId=s.map.id;expect(s.map.bounds.w).toBeCloseTo(1609.344,4);expect(s.map.bounds.w*s.camera.zoom).toBeLessThanOrEqual((await page.getByTestId('panel-map-main').locator('canvas').boundingBox())!.width);
    await draw(page,'district',rectangle(450,450,600,600));await (await generationPanel(page)).getByRole('button',{name:'Generate district',exact:true}).click();await waitGeneration(page);
    s=await snapshot(page);const buildings=Object.values(s.map.entities).filter((e:any)=>e.type==='area'&&e.role==='building') as any[];expect(buildings.length).toBeGreaterThan(0);
    await page.getByTestId('panel-map-main').screenshot({path:testInfo.outputPath('town-cartography.png')});
    await (await generationPanel(page)).getByRole('button',{name:'Edit parts',exact:true}).click();await page.getByTestId('tool-btn-select').click();await clearStage(page);await clickABuilding(page,buildings);await restoreStage(page);
    await (await generationPanel(page)).getByRole('button',{name:'Generate interior',exact:true}).click();
    await expect(page.getByTestId('active-map-title')).toContainText('(interior)');const interiorId=(await snapshot(page)).map.id;
    // A completely unrelated map must remain accessible after automatic zoom navigation.
    await openPanel(page, 'newMap');
    await page.getByTestId('input-new-map-name').fill('Unrelated Dungeon');await page.getByTestId('select-new-map-kind').selectOption('interior');await page.getByTestId('btn-create-map').click();const dungeonId=(await snapshot(page)).map.id;
    await page.getByTestId(`map-tree-item-${townId}`).click();await page.getByTestId('fit-map').click();const canvas=page.getByTestId('panel-map-main').locator('canvas'),box=(await canvas.boundingBox())!;await page.mouse.move(box.x+box.width/2,box.y+box.height/2);for(let i=0;i<7;i++)await page.mouse.wheel(0,100);await expect(page.getByTestId('active-map-title')).toContainText('Overworld');
    await page.getByTestId(`map-tree-item-${dungeonId}`).click();await expect(page.getByTestId('active-map-title')).toContainText('Unrelated Dungeon');expect((await snapshot(page)).map.id).toBe(dungeonId);
    await page.getByTestId(`map-tree-item-${interiorId}`).click();await expect(page.getByTestId('active-map-title')).toContainText('(interior)');
    await page.getByTestId('btn-save-now').click();await expect(page.getByTestId('save-status')).toContainText('Saved');await app.close();app=await electron.launch({args});const reopened=await app.firstWindow(); reopened.setDefaultTimeout(10_000);await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},join(dir,'world'));await reopened.getByTestId('btn-open-world').click();
    for(const id of [worldMapId,townId,dungeonId,interiorId]){await reopened.getByTestId(`map-tree-item-${id}`).click();expect((await snapshot(reopened)).map.id).toBe(id);}
  }finally{await app.close();}
});

test('backdrop → automatic review → populate → town → interior preserves the coastline',async({},testInfo)=>{
  const started=Date.now();const progress=(s:string)=>console.log(s,Date.now()-started);
  const dir=mkdtempSync(join(tmpdir(),'atlas-trace-workflow-')),app=await electron.launch({args:[resolve(__dirname,'../out/main/index.js'),`--user-data-dir=${join(dir,'profile')}`]});
  try{
    const page=await app.firstWindow(); page.setDefaultTimeout(10_000);await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},join(dir,'world'));await page.getByTestId('btn-new-world').click();await expect(page.getByTestId('save-status')).toContainText('New World');
    await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},resolve(__dirname,'../docs/bundle/reference-maps/02-world-map.jpg'));
    await openPanel(page, 'newMap');
    await page.getByTestId('btn-import-backdrop').click();await expect(page.getByTestId('panel-map-main')).toHaveAttribute('data-entity-count','1');
    await openPanel(page, 'newMap');
    const before=await snapshot(page);await page.getByTestId('btn-trace-geography').click();await expect(page.getByTestId('trace-accept')).toBeEnabled();await page.getByTestId('trace-preview').screenshot({path:testInfo.outputPath('trace-review.png')});
    // Cancel is strictly read-only.
    await page.getByRole('button',{name:'Cancel',exact:true}).click();expect((await snapshot(page)).map.entities).toEqual(before.map.entities);
    await openPanel(page, 'newMap');
    await page.getByTestId('btn-trace-geography').click();await expect(page.getByTestId('trace-accept')).toBeEnabled();await page.getByTestId('trace-accept').click();
    const traced=await snapshot(page);progress('traced');const land=Object.values(traced.map.entities).filter((e:any)=>e.type==='area'&&e.role==='land') as any[];expect(land.length).toBeGreaterThan(0);
    await page.evaluate(()=>(window as any).__atlasViewStore.getState().setSelection([]));await (await generationPanel(page)).getByRole('button',{name:'Add terrain detail',exact:true}).click();await waitGeneration(page);
    const populated=await snapshot(page);progress('populated');for(const e of land)expect(populated.map.entities[e.id].rings).toEqual(e.rings);
    expect(Object.values(populated.map.entities).some((e:any)=>e.type==='area'&&e.role.startsWith('biome:'))).toBe(true);
    await page.getByTestId('panel-map-main').screenshot({path:testInfo.outputPath('populated-trace.png')});
    const rootId=populated.map.id,model=Object.values(populated.map.terrain)[0] as any;
    const ground=model.cells.filter((c:any)=>c.land&&c.elevation<.7).sort((a:any,b:any)=>Math.hypot(a.x-model.bounds.w/2,a.y-model.bounds.h/2)-Math.hypot(b.x-model.bounds.w/2,b.y-model.bounds.h/2))[0];
    await chooseTool(page,'developArea');const q=await screenPoint(page,ground);await page.mouse.move(q.x-12,q.y-12);await page.mouse.down();await page.mouse.move(q.x+12,q.y+12,{steps:2});await page.mouse.up();
    await page.getByTestId('develop-area-name').fill('Traced Town');await page.getByTestId('select-develop-kind').selectOption('settlement');await page.getByTestId('develop-area-width').fill('1');await page.getByTestId('develop-area-height').fill('1');await page.getByTestId('btn-confirm-develop').click();await page.getByTestId('fit-map').click();
    await draw(page,'district',rectangle(500,500,400,400));await (await generationPanel(page)).getByRole('button',{name:'Generate district',exact:true}).click();await waitGeneration(page);
    const town=await snapshot(page),townBuildings=Object.values(town.map.entities).filter((e:any)=>e.type==='area'&&e.role==='building') as any[];progress('town');expect(townBuildings.length).toBeGreaterThan(0);
    await (await generationPanel(page)).getByRole('button',{name:'Edit parts',exact:true}).click();await page.getByTestId('tool-btn-select').click();await clearStage(page);await clickABuilding(page,townBuildings);await restoreStage(page);;
    await (await generationPanel(page)).getByRole('button',{name:'Generate interior',exact:true}).click();await expect(page.getByTestId('active-map-title')).toContainText('(interior)');
    await page.getByTestId('panel-map-main').screenshot({path:testInfo.outputPath('traced-town-interior.png')});
    progress('interior');
    await page.getByTestId(`map-tree-item-${rootId}`).click();progress('clicked root');const returned=await snapshot(page);progress('read root');for(const e of land)expect(returned.map.entities[e.id].rings).toEqual(e.rings);
    progress('returned');
    if(await page.getByTestId('btn-save-now').isEnabled())await page.getByTestId('btn-save-now').click();await expect(page.getByTestId('save-status')).toContainText('Saved');
    progress('saved');
  }finally{await app.close();}
});
