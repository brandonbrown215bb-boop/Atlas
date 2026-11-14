import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
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
    expect(pack.assets[0]).toMatchObject({ relativePath: 'Trees/Oak_Green.png', width: 1, height: 1 });
    expect(pack.assets[0]!.tags).toEqual(expect.arrayContaining(['trees', 'oak', 'green']));
    expect(pack.skipped).toBe(1);
    expect(progress.at(-1)).toBe(1);
    const again = await indexFolder(root, { ...pack, pxPerSquare: 256 });
    expect(again.assets).toEqual(pack.assets);
    expect(again.pxPerSquare).toBe(256);
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
  it('reads PNG/JPEG/WebP dimensions and rejects unknown or truncated headers', () => {
    expect(imageDimensions(png)).toEqual({ width: 1, height: 1 });
    const jpeg = Buffer.from([255,216,255,192,0,17,8,0,64,0,128,3,1,0]);
    expect(imageDimensions(jpeg)).toEqual({ width: 128, height: 64 });
    const webp = Buffer.alloc(32); webp.write('RIFF'); webp.write('WEBPVP8X',8);
    webp.writeUIntLE(199,24,3); webp.writeUIntLE(99,27,3);
    expect(imageDimensions(webp)).toEqual({ width: 200, height: 100 });
    expect(imageDimensions(Buffer.from('garbage'))).toBeNull();
  });
  it('pages 50,000 assets without returning the entire library and filters folders/tags', () => {
    const lib = new PackLibrary('unused');
    lib.packs = [{ id: 'p', name: 'Huge', root: 'unused', pxPerSquare: 200, skipped: 0,
      assets: Array.from({ length: 50_000 }, (_, i) => ({ id: String(i), name: `Oak ${i}.png`,
        relativePath: `Trees/Oak ${i}.png`, tags: ['trees','oak'], size: 10, mtimeMs: 1, width: 200, height: 400 })) }];
    const result = lib.search({ query: 'oak', tag: 'trees', folder: 'Trees', offset: 49_900 });
    expect(result.total).toBe(50_000);
    expect(result.assets).toHaveLength(100);
    expect(result.assets[0]!.id).toBe('49900');
    expect(lib.search().folders).toEqual(['Trees']);
    expect(lib.search({ tag: 'rock' }).total).toBe(0);
  });
});
