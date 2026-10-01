import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/errors';
import { TooltipProvider } from '@/shared/ui';
import de from '../../../../messages/de.json';
import { ChatSettingsProvider, useChatSettings } from '../chat-settings';
import { useRefusal } from '../use-refusal';
import { Composer } from './composer';
import { RefusalNotice } from './refusal-notice';

/** The composer dock as the chat views build it: a refusal note above the field. */
function Dock({ error, onSubmit }: { error: ApiError; onSubmit: (q: string) => void }) {
  const { refusal, refuse, clear, endWait, waiting } = useRefusal();
  const [draft, setDraft] = useState('Welche Schutzart hat die Mira?');
  const { pickerOpen } = useChatSettings();
  return (
    <>
      <button type="button" onClick={() => refuse(error)}>
        refuse
      </button>
      {refusal && <RefusalNotice id="n" refusal={refusal} onDismiss={clear} onWaitEnd={endWait} />}
      <Composer
        value={draft}
        onChange={setDraft}
        onSubmit={onSubmit}
        onStop={() => {}}
        onAttach={() => {}}
        busy={false}
        sending={false}
        blocked={waiting}
        maxChars={4000}
      />
      <output data-testid="picker">{pickerOpen ? 'open' : 'closed'}</output>
    </>
  );
}

function setup(error: ApiError) {
  const onSubmit = vi.fn();
  const client = new QueryClient();
  client.setQueryData(['config'], { models: [], default_model: 'claude-sonnet-5-5' });
  render(
    <NextIntlClientProvider locale="de" messages={de} timeZone="Europe/Berlin">
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <ChatSettingsProvider>
            <Dock error={error} onSubmit={onSubmit} />
          </ChatSettingsProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'refuse' }));
  return { onSubmit, send: () => fireEvent.click(screen.getByRole('button', { name: 'Senden' })) };
}

const rateLimited = () => new ApiError('RATE_LIMITED', 429, true, 23, 'req_1', { seconds: 23, scope: 'chat' });

describe('RefusalNotice in the composer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 30, 12, 0, 0));
  });
  afterEach(() => vi.useRealTimers());

  it('counts our own rate limit down, keeps the question and blocks sending until it is over', () => {
    const { onSubmit, send } = setup(rateLimited());
    expect(screen.getByText('Zu viele Anfragen. In 23 Sekunden kannst du weitermachen.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Deine Frage' })).toHaveValue('Welche Schutzart hat die Mira?');
    send();
    expect(onSubmit).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(22_000));
    expect(screen.getByText('Zu viele Anfragen. In einer Sekunde kannst du weitermachen.')).toBeInTheDocument();
    send();
    expect(onSubmit).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1_500));
    expect(screen.getAllByText(de.chat.composer.waitOver).length).toBeGreaterThan(0);
    send();
    expect(onSubmit).toHaveBeenCalledWith('Welche Schutzart hat die Mira?');
  });

  it('announces the pause once at the start and once at the end', () => {
    setup(rateLimited());
    const region = document.querySelector('#n [aria-live]');
    const heard = new Set<string>();
    for (let i = 0; i < 26; i += 1) {
      act(() => vi.advanceTimersByTime(1_000));
      if (region?.textContent) heard.add(region.textContent);
    }
    expect([...heard]).toEqual(['Zu viele Anfragen. In 23 Sekunden kannst du weitermachen.', de.chat.composer.waitOver]);
    expect(document.querySelector('#n')).not.toHaveAttribute('role');
  });

  it('opens the model picker for a model that is not available', () => {
    setup(new ApiError('MODEL_UNAVAILABLE', 503, false, null, 'req_2', { model: 'claude-sonnet-5-5' }));
    expect(screen.getByRole('alert')).toHaveTextContent('ist gerade nicht verfügbar');
    fireEvent.click(screen.getByRole('button', { name: de.chat.composer.chooseModel }));
    expect(screen.getByTestId('picker')).toHaveTextContent('open');
  });

  it('offers the error id for an unexpected failure', () => {
    setup(new ApiError('UNKNOWN_ERROR', 502, true, null, 'req_abcd1234', { status: 502 }));
    expect(screen.getByRole('alert')).toHaveTextContent(de.errors.UNKNOWN_ERROR);
    expect(screen.getByText('Fehler-ID req_abcd1234')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: de.chat.answer.copyErrorId })).toBeInTheDocument();
  });
});
