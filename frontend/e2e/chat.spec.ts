import { expect, test } from '@playwright/test';
import { ask, requireMode, resetStack, SENTENCE, uploadAndWaitReady } from './helpers';

test.describe('chat with the fake model', () => {
  test.beforeEach(async ({ request }) => {
    await requireMode(request, 'fake');
    await resetStack(request);
  });

  test('upload, ask, streamed answer with a citation chip, the PDF opens with the highlight', async ({ page }) => {
    await uploadAndWaitReady(page);
    await ask(page, 'Welche Schutzart hat die Mira?');

    const answer = page.getByRole('article', { name: 'Answer' }).last();
    await expect(answer).toContainText(SENTENCE);

    const chip = page.getByRole('button', { name: /^Source 1: e2e-mira\.pdf, page 1/ }).first();
    await chip.click();

    const panel = page.locator('aside[data-right-panel]');
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId('pdf-mark').first()).toBeVisible({ timeout: 30_000 });
  });

  test('stop during streaming keeps what arrived and marks the answer as stopped', async ({ page }) => {
    await uploadAndWaitReady(page);
    await ask(page, 'Welche Schutzart hat die Mira? #fake:slow');

    const stop = page.getByRole('button', { name: 'Stop answer' });
    await expect(stop).toBeVisible();
    await stop.click();

    await expect(page.getByText('Stopped', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();
  });

  test('a file of the wrong type shows the error row and nothing is added', async ({ page, request }) => {
    await page.goto('/library');
    await page.locator('input[type="file"]').setInputFiles({
      name: 'photo.png',
      mimeType: 'image/png',
      buffer: Buffer.from('not a document'),
    });
    await expect(page.getByText(/This format isn't supported/)).toBeVisible();
    const docs = (await (await request.get('/api/documents')).json()).documents;
    expect(docs).toHaveLength(0);
  });
});
