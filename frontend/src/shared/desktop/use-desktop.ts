'use client';

import { useSyncExternalStore } from 'react';
import type { DesktopBridge } from './desktop-script';

const noop = () => () => {};

/** The Electron bridge in the desktop app, undefined in a browser and on the server. */
export function useDesktop(): DesktopBridge | undefined {
  return useSyncExternalStore(
    noop,
    () => (window.desktop?.isDesktop ? window.desktop : undefined),
    () => undefined,
  );
}
