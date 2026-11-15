import type { Page } from '@playwright/test';
export async function chooseTool(page: Page, tool: string) {
  const button = page.getByTestId(`tool-btn-${tool}`);
  if (!await button.isVisible()) await page.getByTestId('more-tools').locator('summary').click();
  await button.click();
}
export async function generationSettings(page: Page) {
  const settings = page.getByTestId('generation-settings');
  if (!await settings.isVisible()) await page.getByTestId('panel-map-main').getByTestId('generation-strip').getByRole('button', { name: 'Settings…', exact: true }).click();
  return settings;
}
export async function waitGeneration(page: Page) {
  await page.waitForFunction(() => !document.querySelector('[data-testid="generation-strip"][aria-busy="true"]'));
}
