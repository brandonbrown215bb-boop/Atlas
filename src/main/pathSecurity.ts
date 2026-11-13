import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, normalize, relative, resolve } from 'node:path';

/**
 * Checks lexically whether `candidatePath` is inside (or equal to) `rootPath`.
 */
export function isPathInsideRoot(candidatePath: string, rootPath: string): boolean {
  if (!candidatePath || !rootPath || candidatePath.includes('\0') || rootPath.includes('\0')) {
    return false;
  }

  const resolvedRoot = normalize(resolve(rootPath));
  const resolvedCandidate = normalize(resolve(candidatePath));
  const rel = relative(resolvedRoot, resolvedCandidate);

  if (rel === '') {
    return true;
  }
  if (rel === '..' || rel.startsWith(`..\\`) || rel.startsWith('../')) {
    return false;
  }
  return !isAbsolute(rel);
}

function realpathDeepestExisting(targetPath: string): string {
  const abs = resolve(targetPath);
  let current = abs;
  const trailing: string[] = [];

  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) {
      return abs;
    }
    trailing.unshift(current.slice(parent.length).replace(/^[/\\]+/, ''));
    current = parent;
  }

  const realBase = realpathSync(current);
  return trailing.length > 0 ? resolve(realBase, ...trailing) : realBase;
}

/**
 * Resolves `candidatePath` and verifies it lies inside at least one of `allowedRoots`,
 * checking both lexical paths and realpaths (to block `..` and symlink/junction escapes).
 * Returns the resolved path if allowed, or `null` if rejected.
 */
export function resolveAllowedPath(
  candidatePath: string,
  allowedRoots: readonly string[],
): string | null {
  if (!candidatePath || candidatePath.includes('\0')) {
    return null;
  }

  const resolvedCandidate = resolve(candidatePath);
  const realCandidate = realpathDeepestExisting(resolvedCandidate);

  for (const root of allowedRoots) {
    if (!root || root.includes('\0')) {
      continue;
    }
    const resolvedRoot = resolve(root);
    if (!isPathInsideRoot(resolvedCandidate, resolvedRoot)) {
      continue;
    }

    const realRoot = existsSync(resolvedRoot) ? realpathSync(resolvedRoot) : resolvedRoot;
    if (isPathInsideRoot(realCandidate, realRoot)) {
      return resolvedCandidate;
    }
  }

  return null;
}

/**
 * Extracts a local filesystem path from an `atlas-file://` URL.
 * Supports `atlas-file://local/C:/...` and `atlas-file:///C:/...`.
 */
export function parseAtlasFileUrl(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'atlas-file:') {
    return null;
  }

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }

  if (!decodedPath || decodedPath.includes('\0')) {
    return null;
  }

  // On Windows, `/C:/foo/bar` -> `C:/foo/bar`
  if (process.platform === 'win32' && /^\/[A-Za-z]:/.test(decodedPath)) {
    decodedPath = decodedPath.slice(1);
  }

  return normalize(decodedPath);
}
