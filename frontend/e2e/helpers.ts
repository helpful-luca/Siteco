import { expect, type APIRequestContext, type Page, test } from '@playwright/test';
import { makePdf } from './pdf';

export const SENTENCE = 'Die Leuchte Mira hat die Schutzart IP66.';
export const PDF_NAME = 'e2e-mira.pdf';
const CSRF = { 'X-Requested-With': 'docchat' };

export type Mode = 'fake' | 'nokey';

/** The stack's answer mode, from the readiness probe (`llm`: ok with the fake model, missing_key without). */
export async function stackMode(request: APIRequestContext): Promise<Mode | 'other'> {
  const body = await (await request.get('/api/health/ready')).json();
  return body.checks?.llm === 'ok' ? 'fake' : body.checks?.llm === 'missing_key' ? 'nokey' : 'other';
}

export async function requireMode(request: APIRequestContext, wanted: Mode) {
  const mode = await stackMode(request);
  test.skip(mode !== wanted, `needs a stack in mode "${wanted}" (this one is "${mode}")`);
}

/** Every spec starts from an empty library, no chats and the setup of a returning user (English, light). */
export async function resetStack(request: APIRequestContext) {
  const docs = (await (await request.get('/api/documents')).json()).documents as { id: string }[];
  for (const { id } of docs) await request.delete(`/api/documents/${id}`, { headers: CSRF });
  // Checked: a refused reset (a contract change) would leave the setup overlay over the app.
  const preferences = await request.put('/api/preferences', {
    headers: CSRF,
    data: {
      locale: 'en', theme: 'light', name: '', default_model: 'claude-sonnet-5-5', effort: 'low', style: 'concise',
      compare_models: ['claude-sonnet-5-5', 'claude-haiku-4-5'], onboarded: true,
    },
  });
  expect(preferences.ok(), await preferences.text()).toBe(true);
  const chats = (await (await request.get('/api/chats')).json()).chats as { id: string }[];
  for (const { id } of chats) await request.delete(`/api/chats/${id}`, { headers: CSRF });
}

export function pdfFile(name = PDF_NAME) {
  return { name, mimeType: 'application/pdf', buffer: makePdf([SENTENCE, 'Sie ist schlagfest nach IK08.']) };
}

export async function uploadAndWaitReady(page: Page, file = pdfFile()) {
  await page.goto('/library');
  await page.locator('input[type="file"]').setInputFiles(file);
  await expect(page.getByText(file.name).first()).toBeVisible();
  // The file's own row: the status filter above the table also reads "Ready", and leaving the
  // page before the upload finished would cancel it.
  const row = page.getByRole('row').filter({ hasText: file.name });
  await expect(row.getByText('Ready', { exact: true }).filter({ visible: true })).toBeVisible({ timeout: 60_000 });
}

export async function ask(page: Page, question: string) {
  await page.goto('/chat');
  const box = page.getByRole('textbox', { name: 'Your question' });
  await box.fill(question);
  const send = page.getByRole('button', { name: 'Send' });
  await expect(send).toBeEnabled(); // waits for the library to load, Enter would be ignored before
  await send.click();
}
