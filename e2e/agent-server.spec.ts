import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { test, expect, _electron as electron } from '@playwright/test';

test('MCP agent server: auth, world_create, command_run, map_get, render_png, undo, and invalid input rejection', async () => {
  const tempBase = mkdtempSync(join(tmpdir(), 'atlas-e2e-agent-'));
  const worldDir = join(tempBase, 'AgentWorld');
  const userDataDir = join(tempBase, 'userData');

  try {
    const app = await electron.launch({
      args: [
        resolve(__dirname, '../out/main/index.js'),
        `--user-data-dir=${userDataDir}`,
      ],
    });

    try {
      const win = await app.firstWindow();
      await win.waitForLoadState('domcontentloaded');

      // Open Settings panel to verify UI entry and read server URL + token
      await win.getByTestId('btn-settings').click();
      await expect(win.getByTestId('agent-url')).toBeVisible();
      const agentUrl = (await win.getByTestId('agent-url').textContent())!.trim();
      const agentToken = (await win.getByTestId('agent-token').textContent())!.trim();
      expect(agentUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
      expect(agentToken.length).toBeGreaterThanOrEqual(32);

      // 1. Request without token must be rejected (401)
      const unauthRes = await fetch(agentUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
      expect(unauthRes.status).toBe(401);

      // 2. Connect with MCP SDK client using bearer token
      const client = new Client({ name: 'e2e-test-client', version: '0.1.0' });
      const transport = new StreamableHTTPClientTransport(new URL(agentUrl), {
        requestInit: {
          headers: {
            Authorization: `Bearer ${agentToken}`,
          },
        },
      });
      await client.connect(transport);

      try {
        // Create world
        const createRes = await client.callTool({
          name: 'world_create',
          arguments: { worldDir, name: 'Agent Test World' },
        });
        expect(createRes.isError).toBeFalsy();

        // Add an area via command_run
        const addRes = await client.callTool({
          name: 'command_run',
          arguments: {
            commands: [
              {
                name: 'entity.add',
                input: {
                  mapId: 'map-1',
                  entity: {
                    id: 'agent-area-1',
                    type: 'area',
                    layerId: 'layer-base',
                    origin: 'manual',
                    rev: 0,
                    role: 'land',
                    rings: [
                      [
                        { x: 500, y: 500 },
                        { x: 2500, y: 500 },
                        { x: 2500, y: 2500 },
                        { x: 500, y: 2500 },
                      ],
                    ],
                  },
                },
              },
            ],
          },
        });
        expect(addRes.isError).toBeFalsy();

        // Read back with map_get
        const getRes = await client.callTool({
          name: 'map_get',
          arguments: { mapId: 'map-1' },
        });
        expect(getRes.isError).toBeFalsy();
        const mapJson = JSON.parse(
          (getRes.content as Array<{ type: string; text: string }>)[0]!.text,
        );
        expect(mapJson.entities['agent-area-1']).toBeDefined();

        // Render PNG
        const pngRes = await client.callTool({
          name: 'render_png',
          arguments: { mapId: 'map-1', width: 400, height: 300 },
        });
        expect(pngRes.isError).toBeFalsy();
        const imgContent = (
          pngRes.content as Array<{ type: string; data: string; mimeType: string }>
        )[0]!;
        expect(imgContent.type).toBe('image');
        expect(imgContent.mimeType).toBe('image/png');
        expect(imgContent.data.length).toBeGreaterThan(100);
        // PNG base64 magic header
        expect(imgContent.data.startsWith('iVBORw0KGgo')).toBe(true);

        // Invalid command_run input must be rejected and change nothing
        const invalidRes = await client.callTool({
          name: 'command_run',
          arguments: {
            commands: [
              {
                name: 'entity.add',
                input: { mapId: 'map-1', entity: { id: 'bad', type: 'area' } },
              },
            ],
          },
        });
        expect(invalidRes.isError).toBe(true);

        const afterInvalid = await client.callTool({
          name: 'map_get',
          arguments: { mapId: 'map-1' },
        });
        const mapAfterInvalid = JSON.parse(
          (afterInvalid.content as Array<{ type: string; text: string }>)[0]!.text,
        );
        expect(Object.keys(mapAfterInvalid.entities)).toEqual(['agent-area-1']);

        // Undo removes the area
        const undoRes = await client.callTool({ name: 'undo', arguments: {} });
        expect(undoRes.isError).toBeFalsy();

        const afterUndo = await client.callTool({
          name: 'map_get',
          arguments: { mapId: 'map-1' },
        });
        const mapAfterUndo = JSON.parse(
          (afterUndo.content as Array<{ type: string; text: string }>)[0]!.text,
        );
        expect(mapAfterUndo.entities['agent-area-1']).toBeUndefined();
      } finally {
        await client.close();
      }
    } finally {
      await app.close();
    }
  } finally {
    rmSync(tempBase, { recursive: true, force: true });
  }
});
