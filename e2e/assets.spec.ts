import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, expect, _electron as electron } from '@playwright/test';
import type { AtlasApi } from '../src/preload';

test('indexes an asset folder, browses nested folders, searches tags and loads cached thumbnails', async () => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-e2e-assets-'));
  const images = join(root, 'Art', 'Trees'); mkdirSync(images, { recursive: true });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL9sAAAAASUVORK5CYII=', 'base64');
  writeFileSync(join(images, 'Oak_Green.png'), png);
  const app = await electron.launch({ args: [resolve(__dirname, '../out/main/index.js'), `--user-data-dir=${join(root,'userData')}`] });
  try {
    const win = await app.firstWindow();
    await win.evaluate(async path => { await (window as unknown as { atlasApi: AtlasApi }).atlasApi.registerPack(path); }, join(root,'Art'));
    await win.getByTestId('btn-assets').click();
    const panel = win.getByTestId('assets-panel');
    await expect(panel.getByText('1 assets', { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: '▸ Trees' }).click();
    await expect(panel.getByRole('button', { name: 'Oak_Green.png' })).toBeVisible();
    await expect(panel.locator('img')).toHaveJSProperty('naturalWidth', 96);
    await panel.getByLabel('Asset tag', { exact: true }).fill('stone');
    await expect(panel.getByText('0 assets', { exact: true })).toBeVisible();
    await panel.getByLabel('Asset tag', { exact: true }).fill('oak');
    await expect(panel.getByText('1 assets', { exact: true })).toBeVisible();
  } finally { await app.close(); }
});
