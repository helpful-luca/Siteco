'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, fetchJson } from '@/shared/api/client';
import type {
  ChatEnvelopeOut,
  ChatListOut,
  CreateChatIn,
  MessageListOut,
  UpdateChatIn,
} from '@/shared/api/types';

export const CHATS_KEY = ['chats'] as const;
export const chatKey = (chatId: string) => ['chat', chatId] as const;
export const messagesKey = (chatId: string) => ['messages', chatId] as const;

const POLL_MS = 1500;
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const notFound = (error: unknown) =>
  error instanceof ApiError && (error.code === 'CHAT_NOT_FOUND' || error.code === 'NOT_FOUND');

export function useChats() {
  return useQuery({
    queryKey: CHATS_KEY,
    queryFn: () => fetchJson<ChatListOut>('/api/chats'),
    refetchOnWindowFocus: true, // another window may have added or removed chats (annex 10, E11)
  });
}

export function useChat(chatId: string) {
  return useQuery({
    queryKey: chatKey(chatId),
    queryFn: () => fetchJson<ChatEnvelopeOut>(`/api/chats/${chatId}`),
    retry: (count, error) => !notFound(error) && count < 1,
  });
}

/** Polls while an answer is saved as `streaming` that this window does not stream (annex 10, E11). */
export function useMessages(chatId: string, { poll = true }: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: messagesKey(chatId),
    queryFn: () => fetchJson<MessageListOut>(`/api/chats/${chatId}/messages`),
    retry: (count, error) => !notFound(error) && count < 1,
    refetchOnWindowFocus: true,
    refetchInterval: (query) =>
      poll && query.state.data?.messages.some((m) => m.status === 'streaming') ? POLL_MS : false,
  });
}

export function isNotFound(error: unknown): boolean {
  return notFound(error);
}

export function useCreateChat() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateChatIn) =>
      fetchJson<ChatEnvelopeOut>('/api/chats', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) }),
    onSuccess: ({ chat }) => {
      client.setQueryData(chatKey(chat.id), { chat });
      client.setQueryData(messagesKey(chat.id), { messages: [] });
    },
  });
}

export function useUpdateChat() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ chatId, patch }: { chatId: string; patch: UpdateChatIn }) =>
      fetchJson<ChatEnvelopeOut>(`/api/chats/${chatId}`, {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify(patch),
      }),
    onMutate: async ({ chatId, patch }) => {
      await client.cancelQueries({ queryKey: CHATS_KEY });
      const previous = client.getQueryData<ChatListOut>(CHATS_KEY);
      if (patch.title) {
        client.setQueryData<ChatListOut>(CHATS_KEY, (current) =>
          current
            ? { chats: current.chats.map((c) => (c.id === chatId ? { ...c, title: patch.title ?? c.title } : c)) }
            : current,
        );
      }
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) client.setQueryData(CHATS_KEY, context.previous);
    },
    onSuccess: ({ chat }) => client.setQueryData(chatKey(chat.id), { chat }),
    onSettled: () => client.invalidateQueries({ queryKey: CHATS_KEY }),
  });
}

export function useDeleteChat() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (chatId: string) => {
      try {
        await fetchJson<unknown>(`/api/chats/${chatId}`, { method: 'DELETE' });
      } catch (error) {
        if (!notFound(error)) throw error; // already gone: the goal is reached
      }
    },
    onMutate: async (chatId) => {
      await client.cancelQueries({ queryKey: CHATS_KEY });
      const previous = client.getQueryData<ChatListOut>(CHATS_KEY);
      client.setQueryData<ChatListOut>(CHATS_KEY, (current) =>
        current ? { chats: current.chats.filter((c) => c.id !== chatId) } : current,
      );
      return { previous };
    },
    onError: (_error, _id, context) => {
      if (context?.previous) client.setQueryData(CHATS_KEY, context.previous);
    },
    onSuccess: (_data, chatId) => {
      client.removeQueries({ queryKey: messagesKey(chatId) });
      client.removeQueries({ queryKey: chatKey(chatId) });
    },
    onSettled: () => client.invalidateQueries({ queryKey: CHATS_KEY }),
  });
}

/** "Diese Antwort behalten": the kept answer of a comparison goes into the history (annex 11, 1.3). */
export function usePreferAnswer() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ chatId, assistantId }: { chatId: string; assistantId: string; comparisonId: string }) =>
      fetchJson<unknown>(`/api/chats/${chatId}/messages/${assistantId}/prefer`, { method: 'POST' }),
    onMutate: async ({ chatId, assistantId, comparisonId }) => {
      await client.cancelQueries({ queryKey: messagesKey(chatId) });
      const previous = client.getQueryData<MessageListOut>(messagesKey(chatId));
      client.setQueryData<MessageListOut>(messagesKey(chatId), (current) =>
        current
          ? {
              messages: current.messages.map((m) =>
                m.comparison_id === comparisonId ? { ...m, is_preferred: m.id === assistantId } : m,
              ),
            }
          : current,
      );
      return { previous };
    },
    onError: (_error, { chatId }, context) => {
      if (context?.previous) client.setQueryData(messagesKey(chatId), context.previous);
    },
    onSettled: (_data, _error, { chatId }) => client.invalidateQueries({ queryKey: messagesKey(chatId) }),
  });
}
