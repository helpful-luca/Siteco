import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/shared/ui';
import de from '../../../../messages/de.json';
import type { UploadItem } from '../upload/upload-queue';
import { UploadRow } from './upload-row';

function item(error: UploadItem['error']): UploadItem {
  const file = new File(['x'], 'Datenblatt.pdf');
  return { id: 'u1', file, url: null, name: file.name, total: file.size, state: 'failed', loaded: 0, error, chatId: null, toLibrary: null };
}

function setup(upload: UploadItem) {
  const onRetry = vi.fn();
  render(
    <NextIntlClientProvider locale="de" messages={de} timeZone="Europe/Berlin">
      <QueryClientProvider client={new QueryClient()}>
        <TooltipProvider>
          <table>
            <tbody>
              <UploadRow item={upload} onRetry={onRetry} onDismiss={() => {}} />
            </tbody>
          </table>
        </TooltipProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
  return { onRetry, retry: () => screen.getByRole('button', { name: 'Datenblatt.pdf erneut hochladen' }) };
}

describe('UploadRow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 30, 12, 0, 0));
  });
  afterEach(() => vi.useRealTimers());

  it('shows our own upload limit as a pause with a countdown, retry only after it', () => {
    const { onRetry, retry } = setup(
      item({ code: 'RATE_LIMITED', params: { seconds: 20, scope: 'upload' }, retryable: true, retryAt: Date.now() + 20_000 }),
    );
    expect(screen.getAllByText(de.library.status.uploadPaused).length).toBeGreaterThan(0);
    expect(screen.getByText('Kurze Pause. In 20 Sekunden kannst du weitermachen.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull(); // a pause is no failure
    fireEvent.click(retry());
    expect(onRetry).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(20_500));
    expect(screen.getAllByText(de.library.pauseOver).length).toBeGreaterThan(0);
    fireEvent.click(retry());
    expect(onRetry).toHaveBeenCalledWith('u1');
  });

  it('shows an unsupported file as a failure right in its row', () => {
    setup(item({ code: 'UNSUPPORTED_TYPE', params: {}, retryable: false }));
    expect(screen.getByRole('alert')).toHaveTextContent(de.errors.UNSUPPORTED_TYPE);
  });

  it('offers the error id of an unexpected failure', () => {
    setup(item({ code: 'UNKNOWN_ERROR', params: { status: 502 }, retryable: true, requestId: 'req_1234abcd' }));
    expect(screen.getByText('Fehler-ID req_1234abcd')).toBeInTheDocument();
  });
});
