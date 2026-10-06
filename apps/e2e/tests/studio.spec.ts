import { expect, test } from '@playwright/test';
import { openWorkspace, runAgents, visit, watchConsole } from './support';

test.describe('the Studio cockpit', () => {
  test('draws the workspace, narrows to a picked rule, and keeps its layout across a reload', async ({
    page,
  }) => {
    const problems = watchConsole(page);
    await openWorkspace(page);
    await runAgents(page);
    await visit(page, 'Studio');

    const heatmap = page.getByRole('table', { name: /how often each rule fired/i });
    await expect(heatmap).toBeVisible();
    await heatmap.getByRole('button', { name: 'R-NEW-VENDOR' }).click();
    await expect(page.getByRole('button', { name: /narrowed to r-new-vendor/i })).toBeVisible();
    await page.getByRole('button', { name: /narrowed to/i }).click();
    await expect(page.getByRole('button', { name: /narrowed to/i })).toHaveCount(0);

    await page.getByRole('button', { name: 'Edit layout' }).click();
    await expect(page.getByText('AI Assistant')).toBeVisible();
    await page.getByRole('button', { name: 'Done editing' }).click();
    await page.reload();
    await expect(heatmap).toBeVisible();
    expect(problems).toEqual([]);
  });

  test('answers in words, and can build a chart, through the Treasurer', async ({ page }) => {
    await openWorkspace(page);
    await runAgents(page);
    await visit(page, 'Studio');
    await page.getByRole('button', { name: 'Edit layout' }).click();

    await page.getByRole('button', { name: 'How much is left?' }).click();
    await expect(page.getByText(/of the ceiling is in use\. Ceiling \$/)).toBeVisible();
    const ask = async (question: string) => {
      await page.getByRole('textbox', { name: 'Message input' }).fill(question);
      await page.keyboard.press('Enter');
    };
    await ask('Why was the latest ruling held for approval?');
    await expect(page.getByText(/held for approval by R-NEW-VENDOR/)).toBeVisible();
    await ask('Add a widget of what is blocked by a rule.');
    await expect(page.getByText(/I added a widget to the cockpit/)).toBeVisible();
    await expect(page.getByText('Held back by each rule')).toBeVisible();
  });
});
