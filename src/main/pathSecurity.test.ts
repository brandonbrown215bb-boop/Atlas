import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isPathInsideRoot, parseAtlasFileUrl, resolveAllowedPath } from './pathSecurity';

describe('pathSecurity', () => {
  let tempDir: string;
  let allowedRoot: string;
  let outsideRoot: string;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'atlas-sec-'));
    allowedRoot = join(tempDir, 'world');
    outsideRoot = join(tempDir, 'secret');
    mkdirSync(join(allowedRoot, 'assets'), { recursive: true });
    mkdirSync(outsideRoot, { recursive: true });
    writeFileSync(join(allowedRoot, 'assets', 'tree.png'), 'ok');
    writeFileSync(join(outsideRoot, 'secret.txt'), 'nope');
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('accepts paths inside an allowed root', () => {
    const inside = join(allowedRoot, 'assets', 'tree.png');
    expect(isPathInsideRoot(inside, allowedRoot)).toBe(true);
    expect(resolveAllowedPath(inside, [allowedRoot])).toBe(inside);
  });

  it('rejects paths outside allowed roots, including .. traversal tricks', () => {
    const traversal = join(allowedRoot, 'assets', '..', '..', 'secret', 'secret.txt');
    expect(isPathInsideRoot(traversal, allowedRoot)).toBe(false);
    expect(resolveAllowedPath(traversal, [allowedRoot])).toBeNull();
    expect(resolveAllowedPath(join(outsideRoot, 'secret.txt'), [allowedRoot])).toBeNull();
  });

  it('rejects sibling prefix tricks (e.g. world-evil vs world)', () => {
    const sibling = join(tempDir, 'world-evil', 'file.png');
    expect(isPathInsideRoot(sibling, allowedRoot)).toBe(false);
    expect(resolveAllowedPath(sibling, [allowedRoot])).toBeNull();
  });

  it('rejects null bytes and empty paths', () => {
    expect(resolveAllowedPath('', [allowedRoot])).toBeNull();
    expect(resolveAllowedPath(join(allowedRoot, 'a\0b.png'), [allowedRoot])).toBeNull();
  });

  it('parses atlas-file:// URLs cleanly', () => {
    const url = 'atlas-file://local/C:/Users/test/world/assets/tree%201.png';
    const parsed = parseAtlasFileUrl(url);
    expect(parsed).toContain('tree 1.png');
    expect(parseAtlasFileUrl('http://example.com/a.png')).toBeNull();
  });
});
