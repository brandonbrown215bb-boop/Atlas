import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { AssetsIndexSchema, type AssetsIndex } from '../renderer/model/schema';
import { forkWorld, transferMap, validateWorld, type TransferInput } from '../renderer/model/transfer';
import type { WorldDocument } from '../renderer/model/commands';
import { atomicWriteFile, createBackup, openWorldFolder, readAssetsIndex, restoreFromBackup, saveDirtyWorldFiles } from './worldFs';

const inside=(root:string,path:string)=>{const r=relative(root,path);return !r || (!r.startsWith('..')&&!isAbsolute(r));};
export function readTransferWorld(path:string) {
  const root=realpathSync(path);
  const meta=JSON.parse(readFileSync(join(root,'world.json'),'utf8'));
  for(const summary of meta.maps ?? []) {
    if(typeof summary.id!=='string'||/[\\/:]/.test(summary.id)||summary.id==='.'||summary.id==='..') throw new Error('Unsafe map filename');
    const mapFile=realpathSync(join(root,'maps',`${summary.id}.json`));
    if(!inside(root,mapFile))throw new Error('Map file escaped the world');
  }
  return {world:validateWorld(openWorldFolder(root)),assets:readAssetsIndex(root)};
}

export function writeWorldTransaction(path:string,world:WorldDocument,assets:AssetsIndex,writer=saveDirtyWorldFiles) {
  validateWorld(world);AssetsIndexSchema.parse(assets);
  const backup=createBackup(path);
  const previousAssets=readAssetsIndex(path);
  try {
    writer(path,{maps:world.maps});
    atomicWriteFile(join(path,'assets','index.json'),JSON.stringify(assets,null,2));
    writer(path,{meta:world.meta});
    validateWorld(openWorldFolder(path));
  } catch(error) {
    restoreFromBackup(path,backup);
    atomicWriteFile(join(path,'assets','index.json'),JSON.stringify(previousAssets,null,2));
    throw error;
  }
}

export function transferWorldFolders(sourceDir:string,targetDir:string,input:TransferInput,expectedSource?:WorldDocument,writer=saveDirtyWorldFiles) {
  const sourcePath=realpathSync(sourceDir),targetPath=realpathSync(targetDir);
  if(inside(sourcePath,targetPath)||inside(targetPath,sourcePath)) throw new Error('World folders must be separate, not nested');
  const {world:source,assets:sourceAssets}=readTransferWorld(sourcePath),{world:target,assets:targetAssets}=readTransferWorld(targetPath);
  if(expectedSource && JSON.stringify(validateWorld(expectedSource))!==JSON.stringify(source)) throw new Error('Save the source world before transferring');
  const result=transferMap(source,target,input);
  copyAssetSet(sourcePath,targetPath,result.assetIds,sourceAssets,targetAssets);
  writeWorldTransaction(targetPath,result.target,targetAssets,writer);
  // Re-read the written target before a move is allowed to alter its source.
  const verified=validateWorld(openWorldFolder(targetPath));
  if(!verified.maps[result.mapId]) throw new Error('Written target is missing the transferred map');
  if(input.mode==='move'||input.mode==='linked') writeWorldTransaction(sourcePath,result.source,sourceAssets);
  return {before:source,after:result.source,mapId:result.mapId,targetWorldId:target.meta.id};
}

export function forkWorldFolder(sourceDir:string,targetDir:string,name:string) {
  const source=realpathSync(sourceDir),target=resolve(targetDir);
  let ancestor=target;while(!existsSync(ancestor)){const next=dirname(ancestor);if(next===ancestor)break;ancestor=next;}
  const canonicalTarget=resolve(realpathSync(ancestor),relative(ancestor,target));
  if(inside(source,canonicalTarget)||inside(canonicalTarget,source)) throw new Error('Fork folder must be separate from the source');
  if(existsSync(target)&&readdirSync(target).length) throw new Error('Choose an empty folder for the fork');
  const original=readTransferWorld(source).world,next=forkWorld(original,name);
  const copy=(from:string,to:string)=>{
    if(lstatSync(from).isSymbolicLink()) throw new Error('World forks cannot contain symbolic links');
    if(lstatSync(from).isDirectory()){mkdirSync(to,{recursive:true});for(const name of readdirSync(from))copy(join(from,name),join(to,name));}
    else copyFileSync(from,to);
  };
  copy(source,target);
  atomicWriteFile(join(target,'world.json'),JSON.stringify(next.meta,null,2));
  const verified=validateWorld(openWorldFolder(target));
  return {worldDir:target,meta:verified.meta,maps:verified.maps};
}

export function copyAssetSet(sourceDir:string,targetDir:string,ids:string[],sourceAssets:AssetsIndex,targetAssets:AssetsIndex) {
  const sourcePath=realpathSync(sourceDir),targetPath=realpathSync(targetDir);
  for(const id of ids) {
    const asset=sourceAssets[id];
    if(!asset || !/^[a-f0-9]{40}$/.test(id) || !/^[a-z0-9]+$/i.test(asset.ext)) throw new Error(`Missing or invalid asset: ${id}`);
    const file=realpathSync(join(sourcePath,'assets',`${id}.${asset.ext}`));
    if(!inside(join(sourcePath,'assets'),file)) throw new Error('Asset escaped the source world');
    const bytes=readFileSync(file);
    if(createHash('sha1').update(bytes).digest('hex')!==id) throw new Error(`Asset hash mismatch: ${id}`);
    if(!inside(targetPath,realpathSync(join(targetPath,'assets')))) throw new Error('Target assets escaped the world');
    const out=join(targetPath,'assets',`${id}.${asset.ext}`);
    if(existsSync(out) && !inside(targetPath,realpathSync(out))) throw new Error('Target asset escaped the world');
    if(existsSync(out) && createHash('sha1').update(readFileSync(out)).digest('hex')!==id) throw new Error(`Target asset is corrupt: ${id}`);
    if(!existsSync(out)) {createBackup(targetPath);copyFileSync(file,out);}
    targetAssets[id]=asset;
  }
}
