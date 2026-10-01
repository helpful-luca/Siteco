import type { ChatListItemOut } from '@/shared/api/types';

export type ChatGroupKey = 'today' | 'yesterday' | 'week' | 'older';
export type ChatGroup = { key: ChatGroupKey; chats: ChatListItemOut[] };

const DAY = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Today, yesterday, the five days before and older, newest first, in the viewer's local time (like Notes). */
export function groupChats(chats: ChatListItemOut[], now: Date, query = ''): ChatGroup[] {
  const needle = query.trim().toLocaleLowerCase();
  const today = startOfDay(now);
  const yesterday = today - DAY;
  const weekStart = today - 6 * DAY;
  const groups: Record<ChatGroupKey, ChatListItemOut[]> = { today: [], yesterday: [], week: [], older: [] };
  const sorted = [...chats].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
  for (const chat of sorted) {
    if (needle && !(chat.title ?? '').toLocaleLowerCase().includes(needle)) continue;
    const at = Date.parse(chat.updated_at);
    groups[at >= today ? 'today' : at >= yesterday ? 'yesterday' : at >= weekStart ? 'week' : 'older'].push(chat);
  }
  return (['today', 'yesterday', 'week', 'older'] as const)
    .map((key) => ({ key, chats: groups[key] }))
    .filter((group) => group.chats.length > 0);
}
