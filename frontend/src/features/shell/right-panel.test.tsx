import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import de from '../../../messages/de.json';
import { RightPanel } from './right-panel';
import { UIProvider, useUI } from './ui-context';

function Opener() {
  const { openPanel } = useUI();
  return (
    <>
      <button type="button" onClick={() => openPanel({ id: 'p', title: 'Mira.pdf', subtitle: <span>Seite 4 von 12</span>, body: <p>Inhalt</p> })}>
        Quelle 1
      </button>
      <input aria-label="Eingabe" onKeyDown={(event) => event.key === 'Escape' && event.preventDefault()} />
    </>
  );
}

function setup() {
  render(
    <NextIntlClientProvider locale="de" messages={de}>
      <UIProvider>
        <Opener />
        <RightPanel />
      </UIProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  // A wide window: the panel is a column beside the chat, not a modal sheet.
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(min-width: 1280px)',
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('RightPanel', () => {
  it('closes on Escape and gives focus back to the chip that opened it', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: 'Quelle 1' }));
    expect(screen.getByRole('complementary', { name: 'Mira.pdf' })).toHaveTextContent('Seite 4 von 12');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.getByRole('button', { name: 'Quelle 1' })).toHaveFocus();
  });

  it('leaves Escape to a field that uses it', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: 'Quelle 1' }));
    await user.click(screen.getByLabelText('Eingabe'));
    await user.keyboard('{Escape}');
    expect(screen.getByRole('complementary')).toBeInTheDocument();
  });

  it('returns focus after the close button too', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: 'Quelle 1' }));
    await act(() => user.click(screen.getByRole('button', { name: 'Bereich schließen' })));
    expect(screen.getByRole('button', { name: 'Quelle 1' })).toHaveFocus();
  });
});
