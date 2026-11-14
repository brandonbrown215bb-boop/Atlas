import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { test, expect, _electron as electron } from '@playwright/test';
import type { MapDoc } from '../src/renderer/model/schema';

test('phase 5: previews and accepts a building interior, then MCP rerolls preserve edits and undo',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'atlas-generators-'));
  const app=await electron.launch({args:[resolve(__dirname,'../out/main/index.js'),`--user-data-dir=${join(dir,'profile')}`]});
  const client=new Client({name:'generator-test',version:'1'});
  try {
    const main=await app.firstWindow();
    await main.waitForFunction(()=>Boolean((window as any).__atlasWorldStore));
    const info=await main.evaluate(()=>(window as unknown as {atlasApi:import('../src/preload').AtlasApi}).atlasApi.getAgentInfo());
    await client.connect(new StreamableHTTPClientTransport(new URL(info.url),{requestInit:{headers:{Authorization:`Bearer ${info.token}`}}}));
    const call=async(name:string,args:Record<string,unknown>={})=>{
      const result=await client.callTool({name,arguments:args});
      expect(result.isError,`${name}: ${JSON.stringify(result.content)}`).toBeFalsy();
      return JSON.parse((result.content as Array<{text:string}>)[0]!.text);
    };
    const command=(name:string,input:Record<string,unknown>)=>call('command_run',{commands:[{name,input}]});
    await call('world_create',{worldDir:join(dir,'world'),name:'Generator world'});
    await call('command_run',{commands:[
      {name:'map.create',input:{id:'town',name:'Town',kind:'settlement'}},
      {name:'entity.add',input:{mapId:'town',entity:{id:'building',type:'area',role:'building',name:'The Anchor',layerId:'layer-base',origin:'manual',rev:0,
        rings:[[{x:100,y:200},{x:130,y:200},{x:130,y:224},{x:100,y:224}]]}}},
      {name:'place.create',input:{mapId:'town',id:'inn',name:'The Anchor',entityIds:['building'],notes:'Keep these notes',gmNotes:'Hidden cellar'}}
    ]});
    await main.evaluate(()=>{
      const w=window as any;
      w.__atlasWorldStore.getState().setActiveMap('town');
      w.__atlasViewStore.getState().setPanelMap('map-main','town');
      w.__atlasViewStore.getState().setSelection(['building']);
    });
    await main.getByTestId('btn-generator').click();
    await main.getByLabel('Room purpose',{exact:true}).selectOption('tavern');
    await main.getByRole('button',{name:'Preview interior',exact:true}).click();
    await expect(main.getByTestId('interior-preview')).toBeVisible();
    expect((await call('map_list')).length).toBe(2);
    await main.getByLabel('Room purpose',{exact:true}).selectOption('storage');
    await expect(main.getByRole('button',{name:'Accept interior',exact:true})).toBeDisabled();
    await main.getByLabel('Room purpose',{exact:true}).selectOption('tavern');
    await main.getByRole('button',{name:'Reroll preview',exact:true}).click();
    await expect(main.getByLabel('Generator seed')).toHaveValue('2');
    expect((await call('map_get',{mapId:'town'})).entities.inn.childMapId).toBeUndefined();
    await main.screenshot({path:resolve(__dirname,'../test-results/interior-preview.png')});
    await main.getByRole('button',{name:'Accept interior',exact:true}).click();
    const town:MapDoc=await call('map_get',{mapId:'town'});
    const place=town.entities.inn!;
    expect(place).toMatchObject({notes:'Keep these notes',gmNotes:'Hidden cellar'});
    const interiorId=place.type==='place'?place.childMapId!:'';
    const interior:MapDoc=await call('map_get',{mapId:interiorId});
    expect(interior.parent?.footprintEntityId).toBe('building');
    expect(interior.bounds).toEqual({x:0,y:0,w:30,h:24});
    await call('undo');
    expect((await call('map_list')).length).toBe(2);
    expect((await call('map_get',{mapId:'town'})).entities.inn.childMapId).toBeUndefined();
    await call('redo');
    // All remaining generation actions are exposed through command_run alone.
    const mapId='agent-interior';
    const rejected=await client.callTool({name:'command_run',arguments:{commands:[{name:'map.generateInterior',input:{parentMapId:'town',buildingId:'building',placeId:'inn',childMapId:mapId,seed:8}}]}});
    expect(rejected.isError).toBe(true);
    // A second footprint has no place yet: the command must create the place and link as well.
    await command('entity.add',{mapId:'town',entity:{id:'second',type:'area',role:'building',layerId:'layer-base',origin:'manual',rev:0,
      rings:[[{x:200,y:200},{x:230,y:200},{x:230,y:224},{x:200,y:224}]]}});
    await command('map.generateInterior',{parentMapId:'town',buildingId:'second',childMapId:mapId,seed:8,params:{mode:'dungeon',purpose:'storage'}});
    const generated:MapDoc=await call('map_get',{mapId});
    const prop=Object.values(generated.entities).find(e=>e.type==='prop')!;
    expect(prop).toBeDefined();
    await command('entity.update',{mapId,entityId:prop.id,patch:{name:'My barrel'}});
    const before:MapDoc=await call('map_get',{mapId});
    await command('generator.reroll',{mapId,genId:'interior-generator',seed:9,dressingOnly:true});
    const dressed:MapDoc=await call('map_get',{mapId});
    expect(dressed.entities[prop.id]).toEqual(before.entities[prop.id]);
    expect(Object.values(dressed.entities).filter(e=>e.type!=='prop')).toEqual(Object.values(before.entities).filter(e=>e.type!=='prop'));
    await call('undo');expect(await call('map_get',{mapId})).toEqual(before);
    await command('generator.reroll',{mapId,genId:'interior-generator',seed:10});
    const rerolled:MapDoc=await call('map_get',{mapId});
    expect(rerolled.entities[prop.id]).toEqual(before.entities[prop.id]);
    await call('undo');expect(await call('map_get',{mapId})).toEqual(before);
    await main.getByTestId('btn-save-now').click();
    await expect(main.getByTestId('save-status')).toContainText('Saved');
    expect(JSON.parse(readFileSync(join(dir,'world','maps',`${mapId}.json`),'utf8'))).toEqual(before);
    expect(JSON.parse(readFileSync(join(dir,'world','maps',`${interiorId}.json`),'utf8'))).toEqual(interior);
  } finally {await client.close();await app.close();}
});
