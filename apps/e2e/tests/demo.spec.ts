import { expect, test } from '@playwright/test';
import { openWorkspace, runAgents, visit, watchConsole } from './support';

test.describe('the scripted demo', () => {
  test('runs a purchase from the landing page to a verified receipt', async ({ page }) => {
    const problems = watchConsole(page);
    await openWorkspace(page);

    await runAgents(page);
    await visit(page, 'Approvals');
    await expect(page.getByRole('row').nth(1)).toContainText('Authorize');
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(page.getByText('Approved. PayPal: confirmed.')).toBeVisible();

    // The receipt names every stage and the chain still verifies.
    await visit(page, 'Activity');
    await expect(page.getByText('Audit chain verified')).toBeVisible();

    // The cockpit has drawn the same purchase: the envelope is in use and PayPal's record explains it.
    await visit(page, 'Studio');
    await expect(page.getByText('of the ceiling in use')).toBeVisible();
    await expect(
      page.getByText('Every movement of money is explained by an approved action.'),
    ).toBeVisible();
    await expect(page.getByRole('cell', { name: '1', exact: true }).first()).toBeVisible();
    expect(problems).toEqual([]);
  });

  test('holds the line when a person rejects the purchase: nothing is spent', async ({ page }) => {
    await openWorkspace(page);
    await runAgents(page);
    await visit(page, 'Approvals');
    await page.getByRole('button', { name: 'Reject' }).click();
    await expect(page.getByText('Rejected. Nothing will be spent.')).toBeVisible();
    await expect(page.getByText('Nothing is waiting')).toBeVisible();

    await visit(page, 'Studio');
    await expect(page.getByText('0%', { exact: true })).toBeVisible();
  });

  test('contains money that moves with no approved action behind it', async ({ page }) => {
    await openWorkspace(page);
    await runAgents(page);
    await visit(page, 'Approvals');
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(page.getByText('Approved.')).toBeVisible();

    await visit(page, 'Incidents');
    await page.getByRole('button', { name: 'Simulate a rogue capture' }).click();
    // The signed webhook arrives, nothing explains it, and the Verifier opens one incident.
    await expect(page.getByText(/unexplained movement/i).first()).toBeVisible({ timeout: 45_000 });
    await expect(
      page
        .getByText('Mandate')
        .locator('..')
        .getByText(/frozen|revoked/i),
    ).toBeVisible();
  });

  test('shows the guarded agent holding where the naive one is talked into paying', async ({
    page,
  }) => {
    await openWorkspace(page);
    await visit(page, 'Gauntlet');
    await page.getByRole('button', { name: /run/i }).first().click();
    await expect(page.getByText('Naive agent compromised')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('PayPal calls through Bursar').locator('..')).toContainText('0');
  });

  test('finds a hole in a weakened policy, shrinks it and proposes the fix', async ({ page }) => {
    await openWorkspace(page);
    await visit(page, 'Policy lab');
    await page.getByLabel('Policy').selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Run the lab' }).click();
    await expect(page.getByText('Broke the policy').first()).toBeVisible({ timeout: 60_000 });
  });

  test('draws the delivery schedule under the page policy, with nothing refused', async ({
    page,
  }) => {
    const problems = watchConsole(page);
    await openWorkspace(page);
    await runAgents(page);
    await visit(page, 'Schedule');
    await expect(page.locator('.b-gantt')).toBeVisible({ timeout: 30_000 });
    expect(problems).toEqual([]);
  });
});
