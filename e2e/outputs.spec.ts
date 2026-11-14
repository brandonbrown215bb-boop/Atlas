import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { test, expect, _electron as electron } from '@playwright/test';

test('player PNG exports through UI and MCP preserve size, hide GM art and omit fog',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'atlas-outputs-'));
  const app=await electron.launch({args:[resolve(__dirname,'../out/main/index.js'),`--user-data-dir=${join(dir,'profile')}`]});
  const client=new Client({name:'outputs-test',version:'1'});
  try {
    const main=await app.firstWindow();
    await main.waitForFunction(() => Boolean((window as any).__atlasWorldStore));
    const info=await main.evaluate(()=>(window as unknown as {atlasApi:import('../src/preload').AtlasApi}).atlasApi.getAgentInfo());
    await client.connect(new StreamableHTTPClientTransport(new URL(info.url),{requestInit:{headers:{Authorization:`Bearer ${info.token}`}}}));
    const call=async(name:string,args:Record<string,unknown>={})=>{
      const result=await client.callTool({name,arguments:args});
      expect(result.isError, `${name}: ${JSON.stringify(result.content)}`).toBeFalsy();
      return JSON.parse((result.content as Array<{text:string}>)[0]!.text);
    };
    await call('world_create',{worldDir:join(dir,'world'),name:'Output world'});
    await call('command_run',{commands:[
      {name:'entity.add',input:{mapId:'map-1',entity:{id:'land',type:'area',role:'land',rings:[[{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}]],layerId:'layer-base',origin:'manual',rev:0}}},
      {name:'fog.paint',input:{mapId:'map-1',mode:'hideAll'}}
    ]});
    const args={mapId:'map-1',pixelsPerSquare:100,rect:{x:0,y:0,w:100,h:100}};
    const image=await call('export_player_image',args);
    expect(image).toMatchObject({width:100,height:100,capped:false});
    const pixel=await app.evaluate(({nativeImage},data)=>Array.from(nativeImage.createFromBuffer(Buffer.from(data,'base64')).toBitmap().subarray(0,3)),image.data);
    expect(pixel.some((v:number)=>v>0)).toBe(true);
    await call('command_run',{commands:[{name:'entity.add',input:{mapId:'map-1',entity:{id:'secret',type:'label',x:20,y:20,text:'SECRET',size:120,gmOnly:true,layerId:'layer-base',origin:'manual',rev:0}}}]});
    expect((await call('export_player_image',args)).data).toBe(image.data);
    const output=join(dir,'map.png');
    await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},output);
    await main.getByRole('button',{name:'Export',exact:true}).click();
    await main.getByLabel('Export region').selectOption('rectangle');
    await main.getByLabel('Export w',{exact:true}).fill('100');
    await main.getByLabel('Export h',{exact:true}).fill('100');
    await main.getByLabel('Export pixels per square').fill('100');
    await main.getByRole('button',{name:'Save player PNG',exact:true}).click();
    await expect(main.getByRole('status',{name:'Export result'})).toContainText(/Saved 100 . 100 PNG/);
    expect(readFileSync(output).toString('base64')).toBe(image.data);
  } finally {await client.close();await app.close();}
});
