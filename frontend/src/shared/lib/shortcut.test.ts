import { describe, expect, it } from 'vitest';
import { isModShortcut, shortcutLabel } from './shortcut';

const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init);

describe('keyboard shortcuts', () => {
  it('uses Command on Apple platforms and Control elsewhere', () => {
    expect(isModShortcut(key({ key: 'k', metaKey: true }), 'k', true)).toBe(true);
    expect(isModShortcut(key({ key: 'k', ctrlKey: true }), 'k', true)).toBe(false);
    expect(isModShortcut(key({ key: 'k', ctrlKey: true }), 'k', false)).toBe(true);
    expect(isModShortcut(key({ key: 'k', metaKey: true }), 'k', false)).toBe(false);
  });

  it('ignores other keys, extra modifiers and IME composition', () => {
    expect(isModShortcut(key({ key: 'j', metaKey: true }), 'k', true)).toBe(false);
    expect(isModShortcut(key({ key: 'K', metaKey: true, shiftKey: true }), 'k', true)).toBe(false);
    expect(isModShortcut(key({ key: 'k', metaKey: true, altKey: true }), 'k', true)).toBe(false);
    expect(isModShortcut(key({ key: 'k', metaKey: true, isComposing: true }), 'k', true)).toBe(false);
  });

  it('labels the shortcut like the platform does', () => {
    expect(shortcutLabel('k', true)).toBe('⌘K');
    expect(shortcutLabel('k', false)).toBe('Ctrl K');
  });
});
