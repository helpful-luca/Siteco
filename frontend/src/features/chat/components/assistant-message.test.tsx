import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { UIProvider } from '@/features/shell';
import { TooltipProvider } from '@/shared/ui';
import de from '../../../../messages/de.json';
import { answerFromMessage } from '../answer';
import { ChatSettingsProvider } from '../chat-settings';
import { message } from '../testing';
import { AssistantMessage } from './assistant-message';

function setup(patch: Parameters<typeof message>[0]) {
  const onRegenerate = vi.fn();
  const { container } = render(
    <NextIntlClientProvider locale="de" messages={de} timeZone="Europe/Berlin">
      <QueryClientProvider client={new QueryClient()}>
        <UIProvider>
          <TooltipProvider>
            <ChatSettingsProvider>
              <AssistantMessage answer={answerFromMessage(message(patch))} chatTitle="Mira" onRegenerate={onRegenerate} />
            </ChatSettingsProvider>
          </TooltipProvider>
        </UIProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
  return { container, onRegenerate };
}

describe('AssistantMessage after a restart', () => {
  it('offers to regenerate an answer that was cut off before any text, and shows nothing stray', () => {
    const { container, onRegenerate } = setup({ status: 'interrupted', content: '', sources: [], citations: [] });
    expect(screen.getByText(de.chat.answer.interrupted)).toBeInTheDocument();
    expect(container.querySelector('article')?.textContent).not.toMatch(/\b0\b/);
    fireEvent.click(screen.getByRole('button', { name: de.chat.answer.regenerate }));
    expect(onRegenerate).toHaveBeenCalledWith();
  });

  it('keeps the error id of a saved failed answer, so it can be copied after a reload', () => {
    setup({ status: 'error', content: '', error_code: 'INTERNAL_ERROR', error_request_id: 'req_0a1b2c3d', sources: [] });
    expect(screen.getByRole('alert')).toHaveTextContent(de.errors.INTERNAL_ERROR);
    expect(screen.getByText('Fehler-ID req_0a1b2c3d')).toBeInTheDocument();
  });
});
