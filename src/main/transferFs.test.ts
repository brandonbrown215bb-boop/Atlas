import { expect,it } from 'vitest';
import { mkdtempSync,readFileSync,writeFileSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createWorldFolder,openWorldFolder,saveDirtyWorldFiles,listBackups } from './worldFs';
import { forkWorldFolder,transferWorldFolders } from './transferFs';

function fixture(){const dir=mkdtempSync(join(tmpdir(),'atlas-transfer-')),source=join(dir,'source'),target=join(dir,'target');const w=createWorldFolder(source,'Source');createWorldFolder(target,'Target');return {dir,source,target,w};}
it('copies portable used art and forks the entire folder with a fresh world identity',()=>{
  const {dir,source,target,w}=fixture();const bytes=Buffer.from('fixture image bytes'),id=createHash('sha1').update(bytes).digest('hex');
  writeFileSync(join(source,'assets',`${id}.png`),bytes);writeFileSync(join(source,'assets','index.json'),JSON.stringify({[id]:{originalName:'Fixture.png',packName:'Pack',pxPerSquare:200,width:20,height:10,ext:'png'}}));
  w.maps['map-1']!.entities.image={id:'image',type:'image',assetId:id,x:0,y:0,w:20,h:10,rotation:0,layerId:'layer-base',origin:'manual',rev:1};saveDirtyWorldFiles(source,w);
  const result=transferWorldFolders(source,target,{mapId:'map-1',mode:'copy'},w);
  expect(openWorldFolder(target).maps[result.mapId]).toBeDefined();expect(readFileSync(join(target,'assets',`${id}.png`))).toEqual(bytes);
  const fork=forkWorldFolder(source,join(dir,'fork'),'Fork');expect(fork.meta.id).not.toBe(w.meta.id);expect(fork.maps).toEqual(w.maps);expect(existsSync(join(dir,'fork','assets',`${id}.png`))).toBe(true);
});
it('move verifies target, removes source map from the saved world and preserves a source backup',()=>{
  const {source,target,w}=fixture();const result=transferWorldFolders(source,target,{mapId:'map-1',mode:'move'},w);
  expect(openWorldFolder(source).meta.maps).toEqual([]);expect(openWorldFolder(target).maps[result.mapId]).toBeDefined();
  expect(listBackups(source).some(b=>JSON.parse(readFileSync(join(source,'backups',b,'world.json'),'utf8')).maps.length===1)).toBe(true);
});
it('failed target write leaves source byte-for-byte intact and restores target metadata',()=>{
  const {source,target,w}=fixture(),before=readFileSync(join(source,'world.json'),'utf8'),targetBefore=readFileSync(join(target,'world.json'),'utf8');
  expect(()=>transferWorldFolders(source,target,{mapId:'map-1',mode:'move'},w,()=>{throw new Error('disk full');})).toThrow('disk full');
  expect(readFileSync(join(source,'world.json'),'utf8')).toBe(before);expect(readFileSync(join(target,'world.json'),'utf8')).toBe(targetBefore);
  expect(openWorldFolder(source).maps['map-1']).toEqual(w.maps['map-1']);
});
it('refuses overwriting a fork destination or nesting it in the source',()=>{
  const {source,target}=fixture();expect(()=>forkWorldFolder(source,target,'Fork')).toThrow('empty');expect(()=>forkWorldFolder(source,join(source,'nested'),'Fork')).toThrow('separate');
});
