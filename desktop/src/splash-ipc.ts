/** IPC between the splash page and the main process; shared by both sides. */
export const SPLASH_CHANNELS = {
  init: 'splash:init',
  state: 'splash:state',
  action: 'splash:action',
} as const;

export const SPLASH_ACTIONS = ['retry', 'choose-folder', 'download-docker', 'quit'] as const;
export type SplashAction = (typeof SPLASH_ACTIONS)[number];

export function isSplashAction(value: unknown): value is SplashAction {
  return typeof value === 'string' && (SPLASH_ACTIONS as readonly string[]).includes(value);
}
