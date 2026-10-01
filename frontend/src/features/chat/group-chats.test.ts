import { describe, expect, it } from 'vitest';
import { groupChats } from './group-chats';
import { chat } from './testing';

const now = new Date(2026, 8, 30, 15, 0);
const at = (days: number, hour = 9) => new Date(2026, 8, 30 - days, hour, 0).toISOString();

describe('groupChats', () => {
  const chats = [
    chat({ id: 'old', updated_at: at(9) }),
    chat({ id: 'today', updated_at: at(0, 14) }),
    chat({ id: 'yesterday', updated_at: at(1) }),
    chat({ id: 'early', updated_at: at(0, 0) }),
    chat({ id: 'week', updated_at: at(6) }),
  ];

  it('groups into today, yesterday, this week and older, newest first', () => {
    expect(groupChats(chats, now).map((g) => [g.key, g.chats.map((c) => c.id)])).toEqual([
      ['today', ['today', 'early']],
      ['yesterday', ['yesterday']],
      ['week', ['week']],
      ['older', ['old']],
    ]);
  });

  it('filters by title, ignoring case, and drops empty groups', () => {
    const list = [chat({ id: 'a', title: 'Schutzart der Mira L', updated_at: at(0) }), chat({ id: 'b', title: 'Wartung', updated_at: at(3) })];
    expect(groupChats(list, now, '  mira ').map((g) => g.key)).toEqual(['today']);
    expect(groupChats(list, now, 'nichts')).toEqual([]);
  });

  it('never matches untitled chats by a query', () => {
    expect(groupChats([chat({ title: null })], now, 'x')).toEqual([]);
  });
});
