import type { ReactNode } from 'react';
import { fuzzyMatch } from '@/shared/lib/fuzzy';

export type CommandGroup = 'recent' | 'chats' | 'documents' | 'actions' | 'settings';

export type Command = {
  id: string;
  group: CommandGroup;
  title: string;
  /** Quiet text on the right (a date, a page count, a shortcut). */
  hint?: string;
  icon: ReactNode;
  /** Extra words that find the command without being shown ("theme" for "Dunkel"). */
  keywords?: string;
  run: () => void;
};

export type RankedCommand = { command: Command; indices: number[] };
export type RankedGroup = { group: CommandGroup; items: RankedCommand[] };

/** Groups always show in this order, so results never jump around while typing. */
const ORDER: CommandGroup[] = ['recent', 'chats', 'documents', 'actions', 'settings'];
const LIMIT: Partial<Record<CommandGroup, number>> = { recent: 5, chats: 6, documents: 6 };

/**
 * Without a query: the recent chats and the actions. With one: every group, each filtered by a
 * fuzzy match on the title (or, without highlight, on its keywords) and sorted by score.
 */
export function rankCommands(commands: Command[], query: string): RankedGroup[] {
  const empty = query.trim() === '';
  const groups = new Map<CommandGroup, Array<RankedCommand & { score: number }>>();
  for (const command of commands) {
    if (empty ? command.group !== 'recent' && command.group !== 'actions' : command.group === 'recent') continue;
    const onTitle = fuzzyMatch(query, command.title);
    const onKeywords = onTitle || !command.keywords ? null : fuzzyMatch(query, command.keywords);
    const match = onTitle ?? (onKeywords && { score: onKeywords.score - 50, indices: [] });
    if (!match) continue;
    const list = groups.get(command.group) ?? [];
    list.push({ command, indices: match.indices, score: match.score });
    groups.set(command.group, list);
  }
  return ORDER.flatMap((group) => {
    const list = groups.get(group);
    if (!list) return [];
    const sorted = empty ? list : [...list].sort((a, b) => b.score - a.score);
    const items = sorted.slice(0, LIMIT[group] ?? sorted.length).map(({ command, indices }) => ({ command, indices }));
    return [{ group, items }];
  });
}
