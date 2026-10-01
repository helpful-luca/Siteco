'use client';

import { useSyncExternalStore } from 'react';

type Options = { shift?: boolean };

/** macOS, iPadOS and iOS use Command for app shortcuts; everything else Control. */
export function isApplePlatform(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return /mac|iphone|ipad|ipod/i.test(nav.userAgentData?.platform || nav.platform || nav.userAgent);
}

/**
 * Command+key on Apple platforms, Control+key elsewhere, with Shift only when asked for; never
 * with Option and never in the middle of IME input. `key` is the unshifted key ("k", "\\").
 */
export function isModShortcut(event: KeyboardEvent, key: string, apple: boolean, { shift = false }: Options = {}): boolean {
  if (event.isComposing || event.altKey || event.shiftKey !== shift) return false;
  const mod = apple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  return mod && event.key.toLowerCase() === key;
}

export function shortcutLabel(key: string, apple: boolean, { shift = false }: Options = {}): string {
  const name = key.toUpperCase();
  if (apple) return `${shift ? '⇧' : ''}⌘${name}`;
  return `Ctrl ${shift ? 'Shift ' : ''}${name}`;
}

const noSubscription = () => () => undefined;

/** The shortcut's label for this platform; null while rendering on the server (no mismatch). */
export function useShortcutLabel(key: string, options: Options = {}): string | null {
  const shift = options.shift ?? false;
  return useSyncExternalStore(
    noSubscription,
    () => shortcutLabel(key, isApplePlatform(), { shift }),
    () => null,
  );
}
