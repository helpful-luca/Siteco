'use client';

import { useSyncExternalStore } from 'react';

/** macOS, iPadOS and iOS use Command for app shortcuts; everything else Control. */
export function isApplePlatform(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return /mac|iphone|ipad|ipod/i.test(nav.userAgentData?.platform || nav.platform || nav.userAgent);
}

/** Command+key on Apple platforms, Control+key elsewhere; no Shift or Option, never mid IME input. */
export function isModShortcut(event: KeyboardEvent, key: string, apple: boolean): boolean {
  if (event.isComposing || event.shiftKey || event.altKey) return false;
  const mod = apple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  return mod && event.key.toLowerCase() === key;
}

export function shortcutLabel(key: string, apple: boolean): string {
  return apple ? `⌘${key.toUpperCase()}` : `Ctrl ${key.toUpperCase()}`;
}

const noSubscription = () => () => undefined;

/** The shortcut's label for this platform; null while rendering on the server (no mismatch). */
export function useShortcutLabel(key: string): string | null {
  return useSyncExternalStore(
    noSubscription,
    () => shortcutLabel(key, isApplePlatform()),
    () => null,
  );
}
