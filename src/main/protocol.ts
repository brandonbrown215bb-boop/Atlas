import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { net, protocol } from 'electron';
import { parseAtlasFileUrl, resolveAllowedPath } from './pathSecurity';

/**
 * Registers custom `app://` and `atlas-file://` schemes.
 * Must be called before `app.whenReady()`.
 */
export function registerAtlasSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'app',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
    {
      scheme: 'atlas-file',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
      },
    },
  ]);
}

export interface ProtocolHandlerOptions {
  rendererDir: string;
  getAllowedRoots: () => readonly string[];
}

/**
 * Installs `app://` (for production renderer bundle) and `atlas-file://`
 * (for lazy asset loading restricted to allowed roots).
 */
export function setupProtocolHandlers(options: ProtocolHandlerOptions): void {
  protocol.handle('app', (request) => {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return new Response('Bad Request', { status: 400 });
    }

    if (url.hostname !== 'atlas') {
      return new Response('Not Found', { status: 404 });
    }

    const relPath = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const candidate = join(options.rendererDir, relPath);
    const resolved = resolveAllowedPath(candidate, [options.rendererDir]);
    if (!resolved) {
      return new Response('Forbidden', { status: 403 });
    }

    return net.fetch(pathToFileURL(resolved).toString());
  });

  protocol.handle('atlas-file', (request) => {
    const filePath = parseAtlasFileUrl(request.url);
    if (!filePath) {
      return new Response('Bad Request', { status: 400 });
    }

    const resolved = resolveAllowedPath(filePath, options.getAllowedRoots());
    if (!resolved) {
      return new Response('Forbidden', { status: 403 });
    }

    return net.fetch(pathToFileURL(resolved).toString());
  });
}
