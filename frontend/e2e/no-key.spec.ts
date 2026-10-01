import { expect, test } from '@playwright/test';
import { ask, requireMode, resetStack, uploadAndWaitReady } from './helpers';

test.describe('without an API key', () => {
  test.beforeEach(async ({ request }) => {
    await requireMode(request, 'nokey');
    await resetStack(request);
  });

  test('a question shows the matching passages as a sources card instead of an answer', async ({ page }) => {
    await uploadAndWaitReady(page);
    await ask(page, 'Welche Schutzart hat die Mira?');

    const card = page.getByRole('region', { name: 'Passages' });
    await expect(card).toBeVisible();
    await expect(card).toContainText('e2e-mira.pdf');
    await expect(card).toContainText('Schutzart IP66');
    await card.getByRole('button', { name: 'Open e2e-mira.pdf' }).click();
    await expect(page.locator('aside[data-right-panel]')).toBeVisible();
  });
});
