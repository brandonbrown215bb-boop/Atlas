import { createHash } from 'node:crypto';
import { mkdtemp, open, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractDungeondraft, readPackTable } from './dungeondraft';
import { PackLibrary } from './packs';

export function packFixture(files: Array<{ path:string; data:Buffer }>): Buffer {
  const header = Buffer.alloc(88); header.write('GDPC'); header.writeUInt32LE(1,4); header.writeUInt32LE(3,8); header.writeUInt32LE(4,12); header.writeUInt32LE(2,16); header.writeUInt32LE(files.length,84);
  let offset = 88 + files.reduce((n,f) => n+4+Buffer.byteLength(f.path)+32,0);
  const table = files.map(f => {
    const name = Buffer.from(f.path); const b = Buffer.alloc(4+name.length+32); b.writeUInt32LE(name.length); name.copy(b,4);
    b.writeBigUInt64LE(BigInt(offset),4+name.length); b.writeBigUInt64LE(BigInt(f.data.length),12+name.length);
    createHash('md5').update(f.data).digest().copy(b,20+name.length); offset += f.data.length; return b;
  });
  return Buffer.concat([header,...table,...files.map(f => f.data)]);
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL9sAAAAASUVORK5CYII=', 'base64');
describe('Dungeondraft PCK v1', () => {
  it('reads the verified file table layout, extracts textures and registers with the 256px scale', async () => {
    const root = await mkdtemp(join(tmpdir(),'atlas-pck-'));
    const source = join(root,'Demo.dungeondraft_pack');
    await writeFile(source,packFixture([
      {path:'res://packs/demo/pack.json',data:Buffer.from('{}')},
      {path:'res://packs/demo/textures/objects/Oak.png',data:png},
      {path:'res://packs/demo/thumbnails/cache.png',data:png},
    ]));
    const extracted = await extractDungeondraft(source,join(root,'cache'));
    expect(await readFile(join(extracted.root,'packs/demo/textures/objects/Oak.png'))).toEqual(png);
    const lib = new PackLibrary(join(root,'cache'));
    await lib.register(extracted.root,undefined,{name:extracted.name,pxPerSquare:256});
    expect(lib.packs[0]).toMatchObject({name:'Demo',pxPerSquare:256}); expect(lib.packs[0]!.assets).toHaveLength(1);
  });
  it('rejects traversal, Windows path aliases, duplicate names, unknown versions and out-of-range payloads', async () => {
    const root = await mkdtemp(join(tmpdir(),'atlas-pck-invalid-'));
    const source = join(root,'bad.pack');
    for (const path of ['res://../escape.png','res://C:/evil.png','res://a/CON.png','res://a/../evil.png','res://a\\evil.png']) {
      await writeFile(source,packFixture([{path,data:png}]));
      await expect(extractDungeondraft(source,root)).rejects.toThrow();
    }
    const valid = packFixture([{path:'res://tree.png',data:png}]);
    const version = Buffer.from(valid); version.writeUInt32LE(2,4);
    const range = Buffer.from(valid); range.writeBigUInt64LE(999999n,92+Buffer.byteLength('res://tree.png'));
    const duplicate = packFixture([{path:'res://Oak.png',data:png},{path:'res://oak.png',data:png}]);
    for (const bad of [Buffer.from('not a pack'),valid.subarray(0,100),version,range,duplicate]) {
      await writeFile(source,bad); await expect(extractDungeondraft(source,root)).rejects.toThrow();
    }
  });
  it('rejects checksum corruption without changing an existing library', async () => {
    const root = await mkdtemp(join(tmpdir(),'atlas-pck-checksum-')); const source=join(root,'bad.pack');
    const bytes=packFixture([{path:'res://tree.png',data:png}]); bytes[bytes.length-1]=bytes[bytes.length-1]!^1;
    await writeFile(source,bytes);
    const lib=new PackLibrary(root); const before=[...lib.packs];
    await expect(extractDungeondraft(source,root)).rejects.toThrow(/checksum/);
    expect(lib.packs).toEqual(before);
  });
  it('allows an empty thumbnail at offset zero without weakening payload overlap checks', async () => {
    const root = await mkdtemp(join(tmpdir(),'atlas-pck-placeholder-'));
    const source = join(root,'Natural.dungeondraft_pack');
    const thumbnail = 'res://packs/natural/thumbnails/missing.png';
    const bytes = packFixture([
      {path:thumbnail,data:Buffer.alloc(0)},
      {path:'res://packs/natural/textures/tree.png',data:png},
    ]);
    bytes.writeBigUInt64LE(0n,92+Buffer.byteLength(thumbnail));
    await writeFile(source,bytes);
    const extracted = await extractDungeondraft(source,root);
    expect(await readFile(join(extracted.root,'packs/natural/textures/tree.png'))).toEqual(png);
    // A nonempty entry pointing into the directory is still corrupt.
    bytes.writeBigUInt64LE(1n,100+Buffer.byteLength(thumbnail));
    await writeFile(source,bytes);
    await expect(extractDungeondraft(source,root)).rejects.toThrow(/Corrupt/);
  });
  if (process.env.ATLAS_REAL_PACK) it('validates and extracts the actual Arkenforge demo inspected before implementation', async () => {
    const source=process.env.ATLAS_REAL_PACK!;
    const handle=await open(source,'r');
    try { expect(await readPackTable(handle,(await handle.stat()).size)).toHaveLength(481); } finally { await handle.close(); }
    const root=await mkdtemp(join(tmpdir(),'atlas-pck-real-'));
    const extracted=await extractDungeondraft(source,root);
    const lib=new PackLibrary(root); await lib.register(extracted.root,undefined,{name:extracted.name,pxPerSquare:256});
    expect(lib.packs[0]!.assets.length).toBeGreaterThan(50);
    expect(lib.packs[0]!.skipped).toBe(0);
  });
});
