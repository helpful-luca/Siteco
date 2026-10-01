import { describe, expect, it } from 'vitest';
import { type Command, rankCommands } from './rank';

const cmd = (id: string, group: Command['group'], title: string, keywords?: string): Command => ({
  id,
  group,
  title,
  keywords,
  icon: null,
  run: () => undefined,
});

const commands = [
  cmd('r1', 'recent', 'Mira Schutzart'),
  cmd('c1', 'chats', 'Mira Schutzart'),
  cmd('c2', 'chats', 'Wartung der Leuchte'),
  cmd('d1', 'documents', 'Mira_Datenblatt.pdf'),
  cmd('a1', 'actions', 'Neuer Chat'),
  cmd('a2', 'actions', 'Dunkel darstellen', 'theme dark'),
  cmd('s1', 'settings', 'Modelle'),
];

const ids = (query: string) => rankCommands(commands, query).map((g) => [g.group, g.items.map((i) => i.command.id)]);

describe('rankCommands', () => {
  it('shows recent chats and actions without a query', () => {
    expect(ids('')).toEqual([
      ['recent', ['r1']],
      ['actions', ['a1', 'a2']],
    ]);
  });

  it('searches every group but recent, in a stable group order', () => {
    expect(ids('mira')).toEqual([
      ['chats', ['c1']],
      ['documents', ['d1']],
    ]);
  });

  it('finds by keywords without highlighting the title', () => {
    const [group] = rankCommands(commands, 'theme');
    expect(group.items).toEqual([{ command: commands[5], indices: [] }]);
  });

  it('ranks the better match first inside a group', () => {
    expect(ids('leuchte')).toEqual([['chats', ['c2']]]);
    expect(rankCommands(commands, 'xyz')).toEqual([]);
  });
});
