import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { openWorkspace, visit } from './support';

const RULES = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

// The landing page fades its sections in; a contrast check taken mid-fade reads half-transparent text.
// Only what is on screen matters: sections further down stay hidden until they are scrolled to.
async function settled(page: import('@playwright/test').Page) {
  await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll<HTMLElement>('[style*="opacity"]')]
          .filter((el) => {
            const box = el.getBoundingClientRect();
            return el.style.opacity !== '' && box.top < window.innerHeight && box.bottom > 0;
          })
          .every((el) => el.style.opacity === '1'),
      undefined,
      { timeout: 8000 },
    )
    .catch(() => undefined); // axe then reports what is still faded, which is the real finding
}

async function noViolations(page: import('@playwright/test').Page, exclude: string[] = []) {
  await settled(page);
  const builder = new AxeBuilder({ page }).withTags(RULES);
  for (const selector of exclude) builder.exclude(selector);
  const { violations } = await builder.analyze();
  expect(
    violations.map(
      (v) =>
        `${v.id}: ${v.nodes
          .map((n) => n.target.join(' '))
          .slice(0, 3)
          .join(' | ')}`,
    ),
  ).toEqual([]);
}

test.describe('accessibility (WCAG 2.1 A and AA)', () => {
  for (const path of ['/', '/security', '/limits']) {
    test(`the public page ${path} has no violations`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await noViolations(page);
    });
  }

  test('the dashboard pages have no violations', async ({ page }) => {
    await openWorkspace(page);
    for (const name of [
      'Overview',
      'Missions',
      'Approvals',
      'Activity',
      'Mandate',
      'Policy',
      'Incidents',
      'Agents & keys',
    ]) {
      await visit(page, name);
      await noViolations(page);
    }
  });
});
