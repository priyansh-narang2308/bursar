import { expect, type Page } from '@playwright/test';

/** Opens a populated demo workspace the way a visitor does: one click on the landing page. */
export async function openWorkspace(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open demo workspace' }).first().click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
}

/** Goes to a dashboard page through the sidebar, as a person would. */
export async function visit(page: Page, name: string) {
  // A sidebar entry can carry a count ("Approvals 1"), so the name is matched up to it.
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await page.getByRole('link', { name: new RegExp(`^${escaped}(\\s+\\d+)?$`) }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

/** Runs the agents on the first mission and waits for their cart to reach the approvals queue. */
export async function runAgents(page: Page) {
  await visit(page, 'Missions');
  await page.getByRole('row').nth(1).click();
  await page.getByRole('button', { name: 'Run agents' }).click();
  await expect(page.getByText('Agent trace')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run again' })).toBeVisible({ timeout: 30_000 });
}

/** Messages the page logs to the console that are about the product, not the third-party trial notices. */
export function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => {
    const text = message.text();
    // Studio's trial licence notice is printed as a box of asterisks; a 401 is the landing page asking who is signed in.
    if (message.type() === 'error' && !/^\*|License|favicon|401 \(Unauthorized\)/.test(text))
      problems.push(text);
  });
  return problems;
}
