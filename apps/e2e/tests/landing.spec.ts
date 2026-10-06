import { expect, test } from '@playwright/test';

test.describe('the landing page', () => {
  test('loads little code before the dashboard is opened', async ({ page }) => {
    const scripts: number[] = [];
    page.on('response', async (response) => {
      if (response.url().endsWith('.js')) scripts.push((await response.body()).length);
    });
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Let agents spend');
    // Studio and the Gantt are several megabytes; the front page must not carry them.
    expect(scripts.reduce((sum, bytes) => sum + bytes, 0)).toBeLessThan(500_000);
  });

  test('describes itself for search and sharing, and reads on a phone', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/spend control for AI agents/);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      'content',
      /spend money/,
    );
    await expect(page.locator('meta[property="og:title"]')).toHaveCount(1);
    await page.setViewportSize({ width: 390, height: 800 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(page.getByRole('button', { name: 'Open demo workspace' }).first()).toBeVisible();
  });

  test('links to the security model and the limits', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Security' }).first().click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'keeps agents from moving the wrong money',
    );
    await page.goto('/limits');
    await expect(page.getByText('Sandbox money only').first()).toBeVisible();
  });
});
