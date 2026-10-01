import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import de from '../../../../messages/de.json';
import { chat } from '../testing';
import { ChatList } from './chat-list';

const rename = vi.fn();
const chats = [
  chat({ id: 'a', title: 'Mira Schutzart', updated_at: new Date().toISOString() }),
  chat({ id: 'b', title: 'Wartung', updated_at: new Date(Date.now() - 60_000).toISOString() }),
  chat({ id: 'c', title: 'Normen', updated_at: new Date(Date.now() - 120_000).toISOString() }),
];

vi.mock('next/navigation', () => ({ usePathname: () => '/chat/b', useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/features/shell', () => ({ useUI: () => ({ setSidebarOpen: vi.fn() }) }));
vi.mock('../queries', () => ({
  useChats: () => ({ data: { chats }, error: null, refetch: vi.fn(), isFetching: false }),
  useUpdateChat: () => ({ mutate: rename }),
  useDeleteChat: () => ({ mutate: vi.fn() }),
}));
vi.mock('../stream/stream-provider', () => ({
  useStreamActions: () => ({ getRun: () => undefined, stop: vi.fn(), clear: vi.fn() }),
  useIsAnswering: () => false,
}));

const renderList = () =>
  render(
    <NextIntlClientProvider locale="de" messages={de}>
      <ChatList />
    </NextIntlClientProvider>,
  );

describe('ChatList', () => {
  it('is one Tab stop on the open chat and moves with the arrow keys', async () => {
    renderList();
    const row = (name: string) => screen.getByRole('link', { name: new RegExp(name) });
    expect(row('Wartung')).toHaveAttribute('tabindex', '0');
    expect(row('Mira')).toHaveAttribute('tabindex', '-1');
    row('Wartung').focus();
    await userEvent.keyboard('{ArrowDown}');
    await vi.waitFor(() => expect(row('Normen')).toHaveFocus());
    await userEvent.keyboard('{Home}');
    await vi.waitFor(() => expect(row('Mira')).toHaveFocus());
  });

  it('renames with F2 and asks before deleting with Delete', async () => {
    renderList();
    screen.getByRole('link', { name: /Wartung/ }).focus();
    await userEvent.keyboard('{F2}');
    const field = screen.getByRole('textbox', { name: 'Titel des Chats' });
    await userEvent.clear(field);
    await userEvent.type(field, 'Wartungsplan{Enter}');
    expect(rename).toHaveBeenCalledWith({ chatId: 'b', patch: { title: 'Wartungsplan' } });
    await vi.waitFor(() => expect(screen.getByRole('link', { name: /Wartung/ })).toHaveFocus());
    await userEvent.keyboard('{Delete}');
    expect(await screen.findByRole('dialog')).toHaveTextContent('Wartung');
  });
});
