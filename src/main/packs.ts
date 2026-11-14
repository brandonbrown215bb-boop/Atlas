import { createHash } from 'node:crypto';
import { mkdir, open, readFile, readdir, stat, writeFile, rename } from 'node:fs/promises';
import { basename, extname, join, relative, resolve } from 'node:path';
import { PackSchema, PacksSchema, type Pack, type PackProgress, type AssetQuery, type AssetPage } from '../renderer/model/packs';
import { resolveAllowedPath } from './pathSecurity';

const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp']);
const hash = (value: string) => createHash('sha1').update(value).digest('hex');

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

export async function indexFolder(rootPath: string, previous?: Pack, progress?: (p: PackProgress) => void): Promise<Pack> {
  const root = resolve(rootPath);
  if (!(await stat(root)).isDirectory()) throw new Error('Choose an image folder.');
  const pack: Pack = { id: hash(root.toLowerCase()), root, name: basename(root), pxPerSquare: previous?.pxPerSquare ?? 200, assets: [], skipped: 0 };
  const cached = new Map(previous?.assets.map(a => [a.relativePath, a]));
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
        if (old && old.size === info.size && old.mtimeMs === info.mtimeMs) pack.assets.push(old);
        else {
          const handle = await open(path, 'r');
          let dimensions;
          try {
            const header = Buffer.alloc(Math.min(info.size, extname(path).match(/jpe?g/i) ? 1024 * 1024 : 32));
            const { bytesRead } = await handle.read(header, 0, header.length, 0);
            dimensions = imageDimensions(header.subarray(0, bytesRead));
          } finally { await handle.close(); }
          if (!dimensions) { pack.skipped++; continue; }
          pack.assets.push({ id: hash(`${pack.id}/${relativePath}`), relativePath, name: entry.name,
            tags: [...new Set(relativePath.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean))],
            size: info.size, mtimeMs: info.mtimeMs, ...dimensions });
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
  private busy = false;
  constructor(private readonly userData: string) {}
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
    const folder = (options.folder ?? '').replace(/\/$/, '');
    const prefix = folder ? `${folder}/` : '';
    const folders = new Set<string>();
    const result: AssetPage = { total: 0, assets: [], folders: [], packs: this.packs.map(p => ({ id: p.id, name: p.name, count: p.assets.length })) };
    const offset = Math.max(0, Math.floor(options.offset ?? 0));
    for (const pack of this.packs) {
      if (options.packId && options.packId !== pack.id) continue;
      for (const asset of pack.assets) {
        if (!asset.relativePath.startsWith(prefix)) continue;
        const rest = asset.relativePath.slice(prefix.length);
        if (rest.includes('/')) folders.add(prefix + rest.split('/')[0]);
        if (tag && !asset.tags.includes(tag)) continue;
        if (!words.every(w => asset.relativePath.toLowerCase().includes(w) || asset.tags.some(t => t.includes(w)))) continue;
        if (result.total >= offset && result.assets.length < 100) result.assets.push({ ...asset, packId: pack.id, packName: pack.name, pxPerSquare: pack.pxPerSquare });
        result.total++;
      }
    }
    result.folders = [...folders].sort();
    return result;
  }
  async load(): Promise<void> {
    try { this.packs = PacksSchema.parse(JSON.parse(await readFile(join(this.userData, 'packs.json'), 'utf8'))); }
    catch { this.packs = []; }
  }
  private async save(packs: Pack[]): Promise<void> {
    await mkdir(this.userData, { recursive: true });
    const path = join(this.userData, 'packs.json');
    await writeFile(`${path}.tmp`, JSON.stringify(packs));
    await rename(`${path}.tmp`, path);
    this.packs = packs;
  }
  async register(root: string, progress?: (p: PackProgress) => void): Promise<Pack[]> {
    if (this.busy) throw new Error('An asset folder is already being indexed.');
    this.busy = true;
    try {
      const old = this.packs.find(p => p.root.toLowerCase() === resolve(root).toLowerCase());
      const pack = await indexFolder(root, old, progress);
      await this.save([...this.packs.filter(p => p.id !== pack.id), pack]);
      return this.packs;
    } finally { this.busy = false; }
  }
  async setScale(id: string, pxPerSquare: number): Promise<Pack[]> {
    if (this.busy) throw new Error('Wait for indexing to finish.');
    if (!Number.isFinite(pxPerSquare) || pxPerSquare <= 0) throw new Error('Pixels per square must be positive.');
    if (!this.packs.some(p => p.id === id)) throw new Error('Unknown asset pack.');
    await this.save(this.packs.map(p => p.id === id ? { ...p, pxPerSquare } : p));
    return this.packs;
  }
}
