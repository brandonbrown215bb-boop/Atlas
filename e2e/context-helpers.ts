import type { Page } from '@playwright/test';
export async function chooseTool(page: Page, tool: string) {
  // clearStage() may have closed the Tools panel.
  if (!await page.getByTestId('more-tools').count()) await page.evaluate(() => (window as any).__atlasHudStore.getState().openOrFocusPanel('tools'));
  const button = page.getByTestId(`tool-btn-${tool}`);
  if (!await button.isVisible()) await page.getByTestId('more-tools').locator('summary').click();
  await button.click();
}
/** Generation controls now live in the floating Generator panel; open it if needed. */
export async function generationPanel(page: Page) {
  const panel = page.getByTestId('panel-generator');
  if (!await panel.isVisible()) {
    await page.getByRole('banner').getByRole('button', { name: 'Generator', exact: true }).click();
    // It opens over the middle of the map; park it on the right so canvas clicks still land on the map.
    await page.evaluate(() => {
      const hud = (window as any).__atlasHudStore.getState(), inspector = hud.panels.inspector;
      hud.setPanelRect('generator', { x: inspector.x, y: inspector.y, w: inspector.w, h: inspector.h });
    });
  }
  return panel.getByTestId('generation-settings');
}
/** Kept for older specs: settings and actions are the same panel now. */
export const generationSettings = generationPanel;
export async function waitGeneration(page: Page) {
  await page.waitForFunction(() => !document.querySelector('[data-testid="generation-settings"][aria-busy="true"]'));
}
/** Map title in the top bar ("Name (kind)"); it used to sit inside the map panel. */
export const mapTitle = (page: Page) => page.getByTestId('active-map-title');
/** Close every floating panel, for checks that read map pixels: panels float over the canvas now. */
export async function clearStage(page: Page) {
  await page.evaluate(() => {
    const hud = (window as any).__atlasHudStore, closed: string[] = [];
    for (const p of Object.values(hud.getState().panels) as any[]) if (p.open && p.mode === 'floating' && p.kind !== 'map') { hud.getState().closePanel(p.id); closed.push(p.id); }
    (window as any).__e2eClosedPanels = closed;
  });
}
/** Reopen what clearStage() closed. */
export async function restoreStage(page: Page) {
  await page.evaluate(() => {
    const hud = (window as any).__atlasHudStore.getState();
    for (const id of (window as any).__e2eClosedPanels ?? []) hud.openOrFocusPanel(id);
    (window as any).__e2eClosedPanels = [];
  });
}
/** Top-left of a 320 px square in the middle of the canvas, clear of the floating panels at the edges. */
export function stageOrigin(box: { x: number; y: number; width: number; height: number }) {
  return { x: box.x + box.width / 2 - 160, y: box.y + box.height / 2 - 160 };
}
/** The main map is the window background and can't pop out; open a second map view and pop that out instead. */
export async function popOutMapView(page: Page, mapId: string, camera?: { x: number; y: number; zoom: number }) {
  const id = await page.evaluate(({ mapId, camera }) => {
    const id = (window as any).__atlasHudStore.getState().openOrFocusPanel('map', 'map', 'Map');
    const v = (window as any).__atlasViewStore.getState();
    v.setPanelMap(id, mapId);
    if (camera) v.setPanelCamera(id, camera);
    return id as string;
  }, { mapId, camera });
  const ready = page.waitForEvent('popup');
  await page.getByTestId(`popout-btn-${id}`).click();
  const popup = await ready;
  popup.setDefaultTimeout(10_000);
  return { id, popup };
}
/** Open (or bring forward) a floating panel by id, e.g. 'newMap', 'player', 'transfers'. */
export async function openPanel(page: Page, id: string) {
  await page.evaluate(id => (window as any).__atlasHudStore.getState().openOrFocusPanel(id), id);
}
