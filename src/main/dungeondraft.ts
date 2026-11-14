import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import type { FileHandle } from 'node:fs/promises';
import { imageDimensions } from './packs';

export interface PackFile { path: string; offset: number; size: number; md5: string }
const fail = () => new Error('Corrupt or unsupported Dungeondraft pack. Expected an unencrypted Godot PCK v1 archive.');

function safePath(value: string): string {
  const path = value.replace(/^res:\/\//, '').replace(/\0+$/, '');
  if (!path || path.includes('\\') || path.split('/').some(p => !p || p === '.' || p === '..' || /[<>:"|?*\x00-\x1f]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(p))) throw fail();
  return path;
}

export async function readPackTable(handle: FileHandle, length: number): Promise<PackFile[]> {
  let cursor = 0;
  const read = async (size: number) => {
    if (cursor + size > length) throw fail();
    const data = Buffer.alloc(size);
    const { bytesRead } = await handle.read(data, 0, size, cursor);
    if (bytesRead !== size) throw fail();
    cursor += size; return data;
  };
  const header = await read(88);
  if (header.toString('ascii',0,4) !== 'GDPC' || header.readUInt32LE(4) !== 1 || header.readUInt32LE(8) !== 3) throw fail();
  const count = header.readUInt32LE(84);
  if (!count || count > 200_000) throw fail();
  const files: PackFile[] = [];
  const names = new Map<string,string>();
  for (let i=0;i<count;i++) {
    const nameLength = (await read(4)).readUInt32LE();
    if (!nameLength || nameLength > 4096) throw fail();
    const nameBytes = await read(nameLength);
    const path = safePath(new TextDecoder('utf-8', { fatal:true }).decode(nameBytes));
    const fields = await read(32);
    const offset = Number(fields.readBigUInt64LE(0)), size = Number(fields.readBigUInt64LE(8));
    const alias = names.get(path.toLowerCase());
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || size < 0 || offset + size > length || (alias && alias !== path)) throw fail();
    names.set(path.toLowerCase(),path);
    files.push({ path, offset, size, md5: fields.subarray(16).toString('hex') });
  }
  let end = cursor;
  for (const file of [...files].sort((a,b) => a.offset-b.offset)) {
    if (file.offset < end) throw fail();
    end = file.offset + file.size;
  }
  return files;
}

// The downloaded demo and Godot 3 source both use absolute payload offsets.
// Validate the entire directory before writing; a failed import never replaces a registered pack.
export async function extractDungeondraft(source: string, userData: string, progress?: (done: number, total: number) => void): Promise<{ root: string; name: string }> {
  const handle = await open(resolve(source), 'r');
  try {
    const info = await handle.stat();
    const files = await readPackTable(handle, info.size);
    const lastEntry = new Map(files.map(f => [f.path,f]));
    const hasTextures = files.some(f => f.path.includes('/textures/'));
    const isImage = (f: PackFile) => lastEntry.get(f.path) === f && /\.(png|jpe?g|webp|bmp)$/i.test(f.path) && (!hasTextures || f.path.includes('/textures/'));
    const images = files.filter(isImage);
    if (!images.length) throw new Error('This pack contains no supported images.');
    const root = join(userData, 'unpacked-packs', randomUUID());
    const chunk = Buffer.alloc(1024*1024);
    let done = 0;
    for (const file of files) {
      const image = isImage(file);
      const hasChecksum = !/^0+$/.test(file.md5);
      if (image || hasChecksum) {
        const md5 = createHash('md5');
        let output: FileHandle | null = null;
        try {
          if (image) {
            const target = join(root, file.path);
            await mkdir(dirname(target), { recursive: true });
            output = await open(target, 'wx');
          }
          let copied = 0;
          while (copied < file.size) {
            const n = Math.min(chunk.length, file.size-copied);
            const { bytesRead } = await handle.read(chunk,0,n,file.offset+copied);
            if (bytesRead !== n) throw fail();
            const bytes = chunk.subarray(0,n);
            if (image && copied === 0 && !imageDimensions(bytes)) throw new Error(`Unreadable pack image: ${file.path}`);
            md5.update(bytes);
            if (output) await output.writeFile(bytes);
            copied += n;
          }
          if (image && file.size === 0) throw fail();
          if (hasChecksum && md5.digest('hex') !== file.md5) throw new Error(`Pack checksum failed: ${file.path}`);
        } finally { await output?.close(); }
      }
      progress?.(++done,files.length);
    }
    const after = await stat(source);
    if (info.size !== after.size || info.mtimeMs !== after.mtimeMs) throw new Error('Pack changed during import. Try again.');
    return { root, name: basename(source,extname(source)) };
  } finally { await handle.close(); }
}
