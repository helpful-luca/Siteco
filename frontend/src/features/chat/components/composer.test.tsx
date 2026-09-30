import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { useState, type ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/shared/ui';
import de from '../../../../messages/de.json';
import { Composer } from './composer';

type Props = Partial<ComponentProps<typeof Composer>>;

function Harness(props: Props) {
  const [value, setValue] = useState(props.value ?? '');
  return (
    <Composer
      value={value}
      onChange={setValue}
      onSubmit={props.onSubmit ?? (() => {})}
      onStop={props.onStop ?? (() => {})}
      onAttach={() => {}}
      busy={props.busy ?? false}
      sending={props.sending ?? false}
      blocked={props.blocked ?? false}
      maxChars={props.maxChars ?? 4000}
    />
  );
}

function setup(props: Props = {}) {
  render(
    <NextIntlClientProvider locale="de" messages={de}>
      <TooltipProvider>
        <Harness {...props} />
      </TooltipProvider>
    </NextIntlClientProvider>,
  );
  return screen.getByRole('textbox', { name: 'Deine Frage' });
}

describe('Composer', () => {
  it('sends the trimmed question with Enter', async () => {
    const onSubmit = vi.fn();
    const field = setup({ onSubmit });
    await userEvent.type(field, '  Welche Schutzart?  {Enter}');
    expect(onSubmit).toHaveBeenCalledWith('Welche Schutzart?');
  });

  it('adds a line with Shift+Enter instead of sending', async () => {
    const onSubmit = vi.fn();
    const field = setup({ onSubmit });
    await userEvent.type(field, 'Zeile eins{Shift>}{Enter}{/Shift}Zeile zwei');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(field).toHaveValue('Zeile eins\nZeile zwei');
  });

  it('does not send while an IME composes', () => {
    const onSubmit = vi.fn();
    const field = setup({ onSubmit, value: 'にほん' });
    fireEvent.keyDown(field, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(field, { key: 'Enter', keyCode: 229 });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('never sends an empty question', async () => {
    const onSubmit = vi.fn();
    const field = setup({ onSubmit });
    await userEvent.type(field, '   {Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Senden' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('keeps sending off while blocked or on the way, but typing works', async () => {
    const onSubmit = vi.fn();
    const field = setup({ onSubmit, blocked: true });
    await userEvent.type(field, 'Frage{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(field).toHaveValue('Frage');
  });

  it('shows a stop button while an answer runs; Escape stops too', async () => {
    const onStop = vi.fn();
    const onSubmit = vi.fn();
    const field = setup({ onStop, onSubmit, busy: true });
    await userEvent.type(field, 'Entwurf{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Antwort stoppen' }));
    await userEvent.type(field, '{Escape}');
    expect(onStop).toHaveBeenCalledTimes(2);
  });

  it('keeps keyboard focus on the one send and stop button while the answer starts and ends', async () => {
    const onSubmit = vi.fn();
    function Busy() {
      const [value, setValue] = useState('Frage');
      const [busy, setBusy] = useState(false);
      return (
        <Composer
          value={value}
          onChange={setValue}
          onSubmit={() => {
            onSubmit();
            setBusy(true);
          }}
          onStop={() => setBusy(false)}
          onAttach={() => {}}
          busy={busy}
          sending={false}
          blocked={false}
          maxChars={4000}
        />
      );
    }
    render(
      <NextIntlClientProvider locale="de" messages={de}>
        <TooltipProvider>
          <Busy />
        </TooltipProvider>
      </NextIntlClientProvider>,
    );
    const send = screen.getByRole('button', { name: 'Senden' });
    await userEvent.click(send);
    expect(onSubmit).toHaveBeenCalledOnce();
    const stop = screen.getByRole('button', { name: 'Antwort stoppen' });
    expect(stop).toBe(send);
    expect(stop).toHaveFocus();
    await userEvent.click(stop);
    expect(screen.getByRole('button', { name: 'Senden' })).toHaveFocus();
  });

  it('keeps focus on the send button while the question is on its way', async () => {
    const field = setup({ value: 'Frage', sending: true });
    const send = screen.getByRole('button', { name: 'Senden' });
    send.focus();
    expect(send).toHaveAttribute('aria-disabled', 'true');
    expect(send).toHaveFocus();
    expect(field).toHaveValue('Frage');
  });

  it('counts characters from 80 percent and blocks above the limit', async () => {
    const onSubmit = vi.fn();
    const field = setup({ onSubmit, maxChars: 10 });
    await userEvent.type(field, '1234567');
    expect(screen.queryByText(/von 10 Zeichen/)).toBeNull();
    await userEvent.type(field, '8');
    expect(screen.getByText('8 von 10 Zeichen')).toBeInTheDocument();
    await userEvent.type(field, '901{Enter}');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
