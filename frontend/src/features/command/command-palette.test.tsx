import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import de from '../../../messages/de.json';
import { CommandPalette } from './command-palette';
import type { Command } from './rank';

const openChat = vi.fn();
const newChat = vi.fn();
const setPaletteOpen = vi.fn();

const commands: Command[] = [
  { id: 'recent:a', group: 'recent', title: 'Mira Schutzart', icon: null, run: openChat },
  { id: 'chat:a', group: 'chats', title: 'Mira Schutzart', hint: '14:25', icon: null, run: openChat },
  { id: 'doc:d', group: 'documents', title: 'Katalog.pdf', icon: null, run: vi.fn() },
  { id: 'new-chat', group: 'actions', title: 'Neuer Chat', icon: null, run: newChat },
];

vi.mock('@/features/shell', () => ({ useUI: () => ({ paletteOpen: true, setPaletteOpen }) }));
vi.mock('./use-commands', () => ({ useCommands: () => commands }));

const renderPalette = () =>
  render(
    <NextIntlClientProvider locale="de" messages={de}>
      <CommandPalette />
    </NextIntlClientProvider>,
  );

describe('CommandPalette', () => {
  it('shows recent chats and actions, and runs the active one with Enter', async () => {
    renderPalette();
    const field = await screen.findByRole('combobox');
    expect(field).toHaveFocus();
    expect(screen.getByRole('group', { name: 'Zuletzt' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Mira/ })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: 'Neuer Chat' })).toHaveAttribute('aria-selected', 'true');
    expect(field.getAttribute('aria-activedescendant')).toBe(screen.getByRole('option', { name: 'Neuer Chat' }).id);
    await userEvent.keyboard('{Enter}');
    expect(newChat).toHaveBeenCalled();
  });

  it('filters by a fuzzy query and says when nothing matches', async () => {
    renderPalette();
    const field = await screen.findByRole('combobox');
    await userEvent.type(field, 'katpdf');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Katalog.pdf']);
    await userEvent.clear(field);
    await userEvent.type(field, 'qqq');
    expect(screen.getByRole('status')).toHaveTextContent('Keine Treffer für „qqq“');
  });
});
