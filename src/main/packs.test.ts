import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { ASSET_TAG_VERSION, UNTAGGED_FILTER, classifyAsset } from '../renderer/model/assetTags';
import { imageDimensions, indexFolder, PackLibrary } from './packs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL9sAAAAASUVORK5CYII=', 'base64');
describe('asset folder indexing', () => {
  it('indexes nested images, tags names, skips corrupt files and caches unchanged metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'atlas-pack-'));
    await mkdir(join(root, 'Trees'));
    await writeFile(join(root, 'Trees', 'Oak_Green.png'), png);
    await writeFile(join(root, 'broken.png'), 'bad image');
    await writeFile(join(root, 'notes.txt'), 'ignore');
    const progress: number[] = [];
    const pack = await indexFolder(root, undefined, p => progress.push(p.indexed));
    expect(pack.assets).toHaveLength(1);
    expect(pack.assets[0]).toMatchObject({
      relativePath: 'Trees/Oak_Green.png',
      width: 1,
      height: 1,
      purposes: expect.arrayContaining(['tree']),
      biomes: expect.arrayContaining(['forest']),
    });
    expect(pack.assets[0]!.tags).toEqual(expect.arrayContaining(['trees', 'oak', 'green', 'tree', 'purpose:tree', 'biome:forest']));
    expect(pack.skipped).toBe(1);
    expect(progress.at(-1)).toBe(1);
    const again = await indexFolder(root, { ...pack, pxPerSquare: 256 });
    expect(again.assets).toEqual(pack.assets);
    expect(again.pxPerSquare).toBe(256);
  });

  it('classifies theme, biome, and purpose across CH, Nimblehold, TC, TCM, and TMC conventions', () => {
    const desert = classifyAsset('CH - BIOMES Desert New v1,4', 'objects/bush_1a.png');
    expect(desert.biomes).toContain('desert');
    expect(desert.purposes).toEqual(expect.arrayContaining(['prop', 'bush']));
    expect(desert.themes).toContain('fantasy');

    const teamLight = classifyAsset('CH - Team Light v0,6', 'objects/anchor_01.png');
    expect(teamLight.purposes).not.toContain('light');
    expect(teamLight.themes).toContain('nautical');

    const modern = classifyAsset('TCM Modern Assets Megapack', 'objects/TCM Modern Assets/TCM Vehicles/TCM Vehicles - Land/TCM_Car Classic Red_2x3.png');
    expect(modern.themes).toContain('modern');
    expect(modern.themes).not.toContain('fantasy');
    expect(modern.purposes).toEqual(expect.arrayContaining(['prop', 'vehicle']));

    const camel = classifyAsset('TMC Taverns 2', 'objects/MAD_Taverns2_Print_Chair_Wood_1x1.png');
    expect(camel.themes).toEqual(expect.arrayContaining(['fantasy', 'tavern']));
    expect(camel.purposes).toEqual(expect.arrayContaining(['prop', 'chair']));

    const snowy = classifyAsset('TMC Kanto', 'objects/MAD_Kanto_Print_Chest_Snowy.png');
    expect(snowy.biomes).toContain('winter');
    expect(snowy.purposes).toEqual(expect.arrayContaining(['prop', 'chest', 'snow']));

    const wallMounted = classifyAsset('CH - Buildings v1,1', 'objects/Light_Wall_Brazier_01.png');
    expect(wallMounted.purposes).toContain('light');
    expect(wallMounted.purposes).not.toContain('wall');

    const nimbleCliff = classifyAsset('Nimblehold Core', 'generation/terrain/cliffs/dirtcliff2/desert/cliff.png');
    expect(nimbleCliff.biomes).toContain('desert');
    expect(nimbleCliff.purposes).toEqual(expect.arrayContaining(['terrainTexture', 'cliff']));
  });

  it('persists registration and scale; a failed registration changes nothing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'atlas-library-'));
    const images = join(root, 'images'); await mkdir(images);
    await writeFile(join(images, 'tree.png'), png);
    const lib = new PackLibrary(join(root, 'cache')); await lib.load();
    await lib.register(images);
    await lib.setScale(lib.packs[0]!.id, 300);
    const saved = await readFile(join(root, 'cache', 'packs.json'), 'utf8');
    await expect(lib.register(join(root, 'missing'))).rejects.toThrow();
    expect(await readFile(join(root, 'cache', 'packs.json'), 'utf8')).toBe(saved);
    const restored = new PackLibrary(join(root, 'cache')); await restored.load();
    expect(restored.packs).toEqual(lib.packs);
  });

  it('auto-upgrades stale cached packs and persists manual tag overrides across reindex', async () => {
    const root = await mkdtemp(join(tmpdir(), 'atlas-retag-'));
    const cache = join(root, 'cache');
    const images = join(root, 'CH - BIOMES Winter v1,1');
    await mkdir(join(images, 'objects'), { recursive: true });
    await writeFile(join(images, 'objects', 'mystery_01.png'), png);

    const lib1 = new PackLibrary(cache);
    await lib1.register(images);
    // Simulate a legacy cached packs.json with tagVersion 0 and missing structured tags.
    const raw = JSON.parse(await readFile(join(cache, 'packs.json'), 'utf8')) as Array<Record<string, unknown>>;
    raw[0]!['tagVersion'] = 0;
    const asset0 = (raw[0]!['assets'] as Array<Record<string, unknown>>)[0]!;
    delete asset0['themes'];
    delete asset0['biomes'];
    delete asset0['purposes'];
    await writeFile(join(cache, 'packs.json'), JSON.stringify(raw));

    const lib2 = new PackLibrary(cache);
    await lib2.load();
    expect(lib2.packs[0]!.tagVersion).toBe(ASSET_TAG_VERSION);
    expect(lib2.packs[0]!.assets[0]!.biomes).toContain('winter');

    const id = lib2.packs[0]!.assets[0]!.id;
    const updated = await lib2.setAssetTags(id, { themes: ['arcane'], biomes: ['winter', 'fey'], purposes: ['altar'] });
    expect(updated).toMatchObject({ themes: ['arcane'], biomes: ['fey', 'winter'], purposes: ['altar'] });

    // Reindexing the folder must preserve manual overrides.
    await lib2.register(images);
    expect(lib2.packs[0]!.assets[0]).toMatchObject({ themes: ['arcane'], biomes: ['fey', 'winter'], purposes: ['altar'] });
  });

  it('reads PNG/JPEG/WebP dimensions and rejects unknown or truncated headers', () => {
    expect(imageDimensions(png)).toEqual({ width: 1, height: 1 });
    const jpeg = Buffer.from([255,216,255,192,0,17,8,0,64,0,128,3,1,0]);
    expect(imageDimensions(jpeg)).toEqual({ width: 128, height: 64 });
    const webp = Buffer.alloc(32); webp.write('RIFF'); webp.write('WEBPVP8X',8);
    webp.writeUIntLE(199,24,3); webp.writeUIntLE(99,27,3);
    expect(imageDimensions(webp)).toEqual({ width: 200, height: 100 });
    expect(imageDimensions(Buffer.from('garbage'))).toBeNull();
  });

  it('pages 50,000 assets without returning the entire library and filters folders/tags/facets', () => {
    const lib = new PackLibrary('unused');
    lib.packs = [{ id: 'p', name: 'Huge', root: 'unused', pxPerSquare: 200, skipped: 0, tagVersion: ASSET_TAG_VERSION,
      assets: Array.from({ length: 50_000 }, (_, i) => ({ id: String(i), name: `Oak ${i}.png`,
        relativePath: `Trees/Oak ${i}.png`, tags: ['trees','oak'],
        themes: ['fantasy'], biomes: i % 2 === 0 ? ['forest'] : [], purposes: ['tree'],
        size: 10, mtimeMs: 1, width: 200, height: 400 })) }];
    const result = lib.search({ query: 'oak', tag: 'trees', folder: 'Trees', offset: 49_900 });
    expect(result.total).toBe(50_000);
    expect(result.assets).toHaveLength(100);
    expect(result.assets[0]!.id).toBe('49900');
    expect(result.facets?.biomes).toEqual([{ value: 'forest', count: 25_000 }]);
    expect(result.facets?.untagged.biome).toBe(25_000);
    expect(lib.search({ biome: 'forest' }).total).toBe(25_000);
    expect(lib.search({ biome: UNTAGGED_FILTER }).total).toBe(25_000);
    expect(lib.search({ purpose: 'tree', theme: 'fantasy' }).total).toBe(50_000);
    expect(lib.search().folders).toEqual(['Trees']);
    expect(lib.search({ tag: 'rock' }).total).toBe(0);
  });
});
