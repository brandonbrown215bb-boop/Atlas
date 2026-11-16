import { createHash } from 'node:crypto';
import { mkdir, open, readFile, readdir, stat, writeFile, rename } from 'node:fs/promises';
import { basename, extname, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import { ASSET_TAG_VERSION, UNTAGGED_FILTER, applyTagOverrides, classifyAsset, type AssetTagOverride } from '../renderer/model/assetTags';
import { PackSchema, PacksSchema, type Pack, type PackAsset, type PackProgress, type AssetQuery, type AssetPage } from '../renderer/model/packs';
import { resolveAllowedPath } from './pathSecurity';

const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp']);
const hash = (value: string) => createHash('sha1').update(value).digest('hex');

const TagOverrideSchema = z.object({
  themes: z.array(z.string()).optional(),
  biomes: z.array(z.string()).optional(),
  purposes: z.array(z.string()).optional(),
});
const TagOverridesSchema = z.record(z.string(), TagOverrideSchema);

function tagAsset(packName: string, asset: PackAsset, overrides?: Record<string, AssetTagOverride>): PackAsset {
  const classified = applyTagOverrides(classifyAsset(packName, asset.relativePath), overrides?.[asset.id]);
  return { ...asset, ...classified };
}

function normalizeTagList(values?: string[]): string[] | undefined {
  if (!values) return undefined;
  return [...new Set(values.map(v => v.trim().toLowerCase()).filter(Boolean))].sort();
}

// Read image headers only; registering a pack must not decode thousands of textures.
export function imageDimensions(b: Buffer): { width: number; height: number } | null {
  let width = 0, height = 0;
  if (b.length >= 24 && b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    width = b.readUInt32BE(16); height = b.readUInt32BE(20);
  } else if (b.length >= 26 && b.toString('ascii', 0, 2) === 'BM') {
    if (b.readUInt32LE(14) === 12) { width = b.readUInt16LE(18); height = b.readUInt16LE(20); }
    else { width = b.readInt32LE(18); height = Math.abs(b.readInt32LE(22)); }
  } else if (b.length >= 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const kind = b.toString('ascii', 12, 16);
    if (kind === 'VP8X') { width = b.readUIntLE(24, 3) + 1; height = b.readUIntLE(27, 3) + 1; }
    else if (kind === 'VP8 ' && b[23] === 0x9d && b[24] === 1 && b[25] === 0x2a) {
      width = b.readUInt16LE(26) & 0x3fff; height = b.readUInt16LE(28) & 0x3fff;
    } else if (kind === 'VP8L' && b[20] === 0x2f) {
      const bits = b.readUInt32LE(21); width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1;
    }
  } else if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let p = 2;
    while (p + 8 < b.length) {
      if (b[p++] !== 0xff) break;
      while (b[p] === 0xff) p++;
      const marker = b[p++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || marker === 0xd8 || (marker! >= 0xd0 && marker! <= 0xd7)) continue;
      const length = b.readUInt16BE(p);
      if (length < 2) break;
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker!)) {
        height = b.readUInt16BE(p + 3); width = b.readUInt16BE(p + 5); break;
      }
      p += length;
    }
  }
  return width > 0 && height > 0 ? { width, height } : null;
}

export async function indexFolder(
  rootPath: string,
  previous?: Pack,
  progress?: (p: PackProgress) => void,
  options?: { packName?: string; overrides?: Record<string, AssetTagOverride> },
): Promise<Pack> {
  const root = resolve(rootPath);
  if (!(await stat(root)).isDirectory()) throw new Error('Choose an image folder.');
  const name = options?.packName ?? previous?.name ?? basename(root);
  const pack: Pack = {
    id: hash(root.toLowerCase()),
    root,
    name,
    pxPerSquare: previous?.pxPerSquare ?? 200,
    assets: [],
    skipped: 0,
    tagVersion: ASSET_TAG_VERSION,
  };
  const cached = new Map(previous?.assets.map(a => [a.relativePath, a]));
  const staleTags = (previous?.tagVersion ?? 0) !== ASSET_TAG_VERSION || previous?.name !== name;
  let scanned = 0;
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (!resolveAllowedPath(path, [root])) continue;
      if (entry.isDirectory()) { await walk(path); continue; }
      if (!entry.isFile() || !imageExtensions.has(extname(path).toLowerCase())) continue;
      scanned++;
      try {
        const info = await stat(path);
        const relativePath = relative(root, path).replace(/\\/g, '/');
        const old = cached.get(relativePath);
        if (old && old.size === info.size && old.mtimeMs === info.mtimeMs) {
          pack.assets.push(staleTags || options?.overrides?.[old.id] ? tagAsset(pack.name, old, options?.overrides) : old);
        } else {
          const handle = await open(path, 'r');
          let dimensions;
          try {
            const header = Buffer.alloc(Math.min(info.size, extname(path).match(/jpe?g/i) ? 1024 * 1024 : 32));
            const { bytesRead } = await handle.read(header, 0, header.length, 0);
            dimensions = imageDimensions(header.subarray(0, bytesRead));
          } finally { await handle.close(); }
          if (!dimensions) { pack.skipped++; continue; }
          const id = hash(`${pack.id}/${relativePath}`);
          const classified = applyTagOverrides(classifyAsset(pack.name, relativePath), options?.overrides?.[id]);
          pack.assets.push({
            id,
            relativePath,
            name: entry.name,
            ...classified,
            size: info.size,
            mtimeMs: info.mtimeMs,
            ...dimensions,
          });
        }
      } catch { pack.skipped++; }
      if (scanned % 32 === 0) { progress?.({ scanned, indexed: pack.assets.length, path }); await new Promise<void>(r => setImmediate(r)); }
    }
  };
  await walk(root);
  pack.assets.sort((a,b) => a.relativePath.localeCompare(b.relativePath));
  progress?.({ scanned, indexed: pack.assets.length, path: root });
  return PackSchema.parse(pack);
}

export class PackLibrary {
  packs: Pack[] = [];
  overrides: Record<string, AssetTagOverride> = {};
  private busy = false;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly userData: string) {}
  // Read-modify-write jobs run one at a time, so two quick edits cannot overwrite each other.
  private serial<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job, job);
    this.queue = run.catch(() => {});
    return run;
  }
  findAsset(id: string) {
    for (const pack of this.packs) {
      const asset = pack.assets.find(a => a.id === id);
      if (!asset) continue;
      const path = resolveAllowedPath(join(pack.root, asset.relativePath), [pack.root]);
      if (!path) throw new Error('Asset is outside its registered folder.');
      return { pack, asset, path };
    }
    throw new Error('Asset not found. Reindex its folder.');
  }
  search(options: AssetQuery = {}): AssetPage {
    const words = (options.query ?? '').toLowerCase().trim().split(/\s+/).filter(Boolean);
    const tag = options.tag?.toLowerCase().trim();
    const theme = options.theme?.toLowerCase().trim();
    const biome = options.biome?.toLowerCase().trim();
    const purpose = options.purpose?.toLowerCase().trim();
    const folder = (options.folder ?? '').replace(/\/$/, '');
    const prefix = folder ? `${folder}/` : '';
    const folders = new Set<string>();
    const themeCounts = new Map<string, number>();
    const biomeCounts = new Map<string, number>();
    const purposeCounts = new Map<string, number>();
    const untagged = { theme: 0, biome: 0, purpose: 0 };
    const result: AssetPage = { total: 0, assets: [], folders: [], packs: this.packs.map(p => ({ id: p.id, name: p.name, count: p.assets.length })) };
    const offset = Math.max(0, Math.floor(options.offset ?? 0));
    for (const pack of this.packs) {
      if (options.packId && options.packId !== pack.id) continue;
      for (const asset of pack.assets) {
        if (!asset.relativePath.startsWith(prefix)) continue;
        const rest = asset.relativePath.slice(prefix.length);
        if (rest.includes('/')) folders.add(prefix + rest.split('/')[0]);
        if (tag && !asset.tags.includes(tag)) continue;
        if (words.length && !words.every(w => asset.relativePath.toLowerCase().includes(w) || asset.tags.some(t => t.includes(w)))) continue;

        const themes = asset.themes ?? [];
        const biomes = asset.biomes ?? [];
        const purposes = asset.purposes ?? [];
        if (themes.length === 0) untagged.theme++;
        else for (const t of themes) themeCounts.set(t, (themeCounts.get(t) ?? 0) + 1);
        if (biomes.length === 0) untagged.biome++;
        else for (const b of biomes) biomeCounts.set(b, (biomeCounts.get(b) ?? 0) + 1);
        if (purposes.length === 0) untagged.purpose++;
        else for (const p of purposes) purposeCounts.set(p, (purposeCounts.get(p) ?? 0) + 1);

        if (theme === UNTAGGED_FILTER) { if (themes.length > 0) continue; }
        else if (theme && !themes.includes(theme)) continue;
        if (biome === UNTAGGED_FILTER) { if (biomes.length > 0) continue; }
        else if (biome && !biomes.includes(biome)) continue;
        if (purpose === UNTAGGED_FILTER) { if (purposes.length > 0) continue; }
        else if (purpose && !purposes.includes(purpose)) continue;

        if (result.total >= offset && result.assets.length < 100) result.assets.push({ ...asset, themes, biomes, purposes, packId: pack.id, packName: pack.name, pxPerSquare: pack.pxPerSquare });
        result.total++;
      }
    }
    result.folders = [...folders].sort();
    const toFacets = (counts: Map<string, number>) =>
      [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([value, count]) => ({ value, count }));
    result.facets = { themes: toFacets(themeCounts), biomes: toFacets(biomeCounts), purposes: toFacets(purposeCounts), untagged };
    return result;
  }
  async load(): Promise<void> {
    // A damaged file is moved aside (not overwritten by the next save) so it can be recovered.
    const readOrSetAside = async <T>(file: string, parse: (raw: unknown) => T, empty: T): Promise<T> => {
      const path = join(this.userData, file);
      try { return parse(JSON.parse(await readFile(path, 'utf8'))); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') await rename(path, `${path}.damaged-${Date.now()}`).catch(() => {});
        return empty;
      }
    };
    this.overrides = await readOrSetAside('asset-tag-overrides.json', raw => TagOverridesSchema.parse(raw), {});
    this.packs = await readOrSetAside('packs.json', raw => PacksSchema.parse(raw), []);
    if (this.packs.some(p => p.tagVersion !== ASSET_TAG_VERSION)) {
      const upgraded = this.packs.map(p => p.tagVersion === ASSET_TAG_VERSION ? p : {
        ...p,
        tagVersion: ASSET_TAG_VERSION,
        assets: p.assets.map(a => tagAsset(p.name, a, this.overrides)),
      });
      await this.save(upgraded);
    }
  }
  private async save(packs: Pack[]): Promise<void> {
    await mkdir(this.userData, { recursive: true });
    const path = join(this.userData, 'packs.json');
    await writeFile(`${path}.tmp`, JSON.stringify(packs));
    await rename(`${path}.tmp`, path);
    this.packs = packs;
  }
  private async saveOverrides(overrides: Record<string, AssetTagOverride>): Promise<void> {
    await mkdir(this.userData, { recursive: true });
    const path = join(this.userData, 'asset-tag-overrides.json');
    await writeFile(`${path}.tmp`, JSON.stringify(overrides, null, 2));
    await rename(`${path}.tmp`, path);
    this.overrides = overrides;
  }
  async setAssetTags(id: string, input: AssetTagOverride): Promise<PackAsset> {
    if (this.busy) throw new Error('Wait for indexing to finish.');
    return this.serial(async () => {
      const { pack } = this.findAsset(id);
      const nextOverride: AssetTagOverride = {
        ...(input.themes !== undefined ? { themes: normalizeTagList(input.themes) } : {}),
        ...(input.biomes !== undefined ? { biomes: normalizeTagList(input.biomes) } : {}),
        ...(input.purposes !== undefined ? { purposes: normalizeTagList(input.purposes) } : {}),
      };
      const nextOverrides = { ...this.overrides, [id]: { ...this.overrides[id], ...nextOverride } };
      await this.saveOverrides(nextOverrides);
      let updated!: PackAsset;
      const nextPacks = this.packs.map(p => p.id !== pack.id ? p : {
        ...p,
        assets: p.assets.map(a => {
          if (a.id !== id) return a;
          updated = tagAsset(p.name, a, nextOverrides);
          return updated;
        }),
      });
      await this.save(nextPacks);
      return updated;
    });
  }
  async register(root: string, progress?: (p: PackProgress) => void, defaults?: { name: string; pxPerSquare: number }): Promise<Pack[]> {
    if (this.busy) throw new Error('An asset folder is already being indexed.');
    this.busy = true;
    try {
      const old = this.packs.find(p => p.root.toLowerCase() === resolve(root).toLowerCase());
      const pack = await indexFolder(root, old, progress, { packName: defaults?.name, overrides: this.overrides });
      if (defaults) { pack.name = defaults.name; pack.pxPerSquare = old?.pxPerSquare ?? defaults.pxPerSquare; }
      return await this.serial(async () => {
        await this.save([...this.packs.filter(p => p.id !== pack.id), pack]);
        return this.packs;
      });
    } finally { this.busy = false; }
  }
  async setScale(id: string, pxPerSquare: number): Promise<Pack[]> {
    if (this.busy) throw new Error('Wait for indexing to finish.');
    if (!Number.isFinite(pxPerSquare) || pxPerSquare <= 0) throw new Error('Pixels per square must be positive.');
    return this.serial(async () => {
      if (!this.packs.some(p => p.id === id)) throw new Error('Unknown asset pack.');
      await this.save(this.packs.map(p => p.id === id ? { ...p, pxPerSquare } : p));
      return this.packs;
    });
  }
}
