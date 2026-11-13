import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ipcMain, type BrowserWindow } from 'electron';
import { z } from 'zod';
import { atomicWriteFile } from './worldFs';

export interface AgentServerDeps {
  userDataDir: string;
  getMainWindow: () => BrowserWindow | null;
  createWorld: (worldDir: string, name: string) => unknown;
  openWorld: (worldDir: string) => unknown;
}

export interface AgentServerHandle {
  getInfo: () => { enabled: boolean; url: string; token: string };
  setEnabled: (enabled: boolean) => void;
  close: () => Promise<void>;
}

function loadOrCreateToken(userDataDir: string): string {
  mkdirSync(userDataDir, { recursive: true });
  const tokenPath = join(userDataDir, 'agent-token.txt');
  if (existsSync(tokenPath)) {
    const existing = readFileSync(tokenPath, 'utf-8').trim();
    if (existing.length >= 32) {
      return existing;
    }
  }
  const token = randomBytes(32).toString('hex');
  atomicWriteFile(tokenPath, token);
  return token;
}

function isAuthorized(req: IncomingMessage, expectedToken: string): boolean {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return false;
  }
  const provided = header.slice('Bearer '.length).trim();
  const a = Buffer.from(provided, 'utf-8');
  const b = Buffer.from(expectedToken, 'utf-8');
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (!raw) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

export async function startAgentServer(
  deps: AgentServerDeps,
): Promise<AgentServerHandle> {
  const token = loadOrCreateToken(deps.userDataDir);
  let enabled = true;
  let port = 0;

  const pendingCalls = new Map<
    string,
    { resolve: (val: unknown) => void; reject: (err: Error) => void }
  >();

  ipcMain.on(
    'atlas:agent-reply',
    (
      _event,
      reqId: string,
      payload: { ok: boolean; result?: unknown; error?: string },
    ) => {
      const entry = pendingCalls.get(reqId);
      if (!entry) return;
      pendingCalls.delete(reqId);
      if (payload.ok) {
        entry.resolve(payload.result);
      } else {
        entry.reject(new Error(payload.error ?? 'Renderer error'));
      }
    },
  );

  const callRenderer = (
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<unknown> => {
    const win = deps.getMainWindow();
    if (!win || win.isDestroyed()) {
      return Promise.reject(new Error('Main window is not available'));
    }
    const reqId = randomBytes(12).toString('hex');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pendingCalls.delete(reqId)) {
          reject(new Error(`Agent call timed out: ${method}`));
        }
      }, 15_000);

      pendingCalls.set(reqId, {
        resolve: (val) => {
          clearTimeout(timer);
          resolve(val);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });

      win.webContents.send('atlas:agent-call', reqId, method, params);
    });
  };

  const buildMcpServer = (): McpServer => {
    const server = new McpServer({
      name: 'campaign-atlas',
      version: '0.1.0',
    });

    const jsonText = (data: unknown) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
    });

    const errorResult = (err: unknown) => ({
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: err instanceof Error ? err.message : String(err),
        },
      ],
    });

    server.registerTool(
      'world_create',
      {
        description: 'Create a new Campaign Atlas world folder and open it.',
        inputSchema: {
          worldDir: z.string().min(1),
          name: z.string().min(1),
        },
      },
      async ({ worldDir, name }) => {
        try {
          const loaded = deps.createWorld(worldDir, name) as Record<string, unknown>;
          await callRenderer('world_loaded', loaded);
          return jsonText({ ok: true, worldDir: loaded['worldDir'] });
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    server.registerTool(
      'world_open',
      {
        description: 'Open an existing Campaign Atlas world folder.',
        inputSchema: {
          worldDir: z.string().min(1),
        },
      },
      async ({ worldDir }) => {
        try {
          const res = deps.openWorld(worldDir) as {
            ok: boolean;
            error?: string;
            [k: string]: unknown;
          };
          if (!res.ok) {
            return errorResult(res.error ?? 'Failed to open world');
          }
          await callRenderer('world_loaded', res);
          return jsonText({ ok: true, worldDir: res['worldDir'] });
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    server.registerTool(
      'world_status',
      {
        description: 'Report whether a world is open, its active map, and dirty state.',
      },
      async () => {
        try {
          return jsonText(await callRenderer('world_status'));
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    server.registerTool(
      'schema_get',
      {
        description: 'Get JSON Schemas for MapDoc and Entity.',
      },
      async () => {
        try {
          return jsonText(await callRenderer('schema_get'));
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    server.registerTool(
      'command_list',
      {
        description: 'List all registered commands with their descriptions and input JSON Schemas.',
      },
      async () => {
        try {
          return jsonText(await callRenderer('command_list'));
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    server.registerTool(
      'command_run',
      {
        description: 'Run a list of commands as a single undo step.',
        inputSchema: {
          commands: z
            .array(
              z.object({
                name: z.string().min(1),
                input: z.unknown(),
              }),
            )
            .min(1),
          label: z.string().optional(),
        },
      },
      async ({ commands, label }) => {
        try {
          return jsonText(
            await callRenderer('command_run', { commands, label }),
          );
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    server.registerTool(
      'undo',
      { description: 'Undo the last command batch.' },
      async () => {
        try {
          return jsonText(await callRenderer('undo'));
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    server.registerTool(
      'redo',
      { description: 'Redo the last undone command batch.' },
      async () => {
        try {
          return jsonText(await callRenderer('redo'));
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    server.registerTool(
      'map_list',
      { description: 'List all maps in the open world.' },
      async () => {
        try {
          return jsonText(await callRenderer('map_list'));
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    server.registerTool(
      'map_get',
      {
        description: 'Get a map and its entities, optionally filtered by type, layerId, origin, or bounding box.',
        inputSchema: {
          mapId: z.string().min(1),
          type: z.string().optional(),
          layerId: z.string().optional(),
          origin: z.enum(['manual', 'generated', 'inherited']).optional(),
          bbox: z
            .object({
              x: z.number(),
              y: z.number(),
              w: z.number().positive(),
              h: z.number().positive(),
            })
            .optional(),
        },
      },
      async (input) => {
        try {
          return jsonText(await callRenderer('map_get', input));
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    server.registerTool(
      'render_png',
      {
        description: 'Render a map or rectangle to a PNG image (GM or player view).',
        inputSchema: {
          mapId: z.string().min(1).optional(),
          rect: z
            .object({
              x: z.number(),
              y: z.number(),
              w: z.number().positive(),
              h: z.number().positive(),
            })
            .optional(),
          width: z.number().int().positive().max(2048).optional(),
          height: z.number().int().positive().max(2048).optional(),
          view: z.enum(['gm', 'player']).optional(),
        },
      },
      async (input) => {
        try {
          const res = (await callRenderer('render_png', input)) as {
            mimeType: string;
            data: string;
          };
          return {
            content: [
              {
                type: 'image' as const,
                data: res.data,
                mimeType: 'image/png',
              },
            ],
          };
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    return server;
  };

  const httpServer: Server = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      if (!enabled) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Agent server is disabled' }));
        return;
      }

      if (!isAuthorized(req, token)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      const reqUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (reqUrl.pathname !== '/mcp') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not Found' }));
        return;
      }

      try {
        const body = req.method === 'POST' ? await readJsonBody(req) : undefined;
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });
        const mcp = buildMcpServer();
        res.on('close', () => {
          void transport.close();
          void mcp.close();
        });
        await mcp.connect(transport);
        await transport.handleRequest(req, res, body);
      } catch (err) {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              error: err instanceof Error ? err.message : 'Internal error',
            }),
          );
        }
      }
    },
  );

  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => {
      const addr = httpServer.address();
      if (addr && typeof addr === 'object') {
        port = addr.port;
      }
      resolve();
    });
  });

  const getInfo = () => ({
    enabled,
    url: `http://127.0.0.1:${port}/mcp`,
    token,
  });

  ipcMain.handle('atlas:agent-info', () => getInfo());
  ipcMain.handle('atlas:agent-set-enabled', (_event, nextEnabled: boolean) => {
    enabled = Boolean(nextEnabled);
    return getInfo();
  });

  return {
    getInfo,
    setEnabled: (nextEnabled: boolean) => {
      enabled = Boolean(nextEnabled);
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
