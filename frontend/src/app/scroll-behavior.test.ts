import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('scroll behavior', () => {
  it('stops the page itself from rubber-banding', () => {
    expect(read('src/app/globals.css')).toMatch(/html,\s*body\s*\{\s*overscroll-behavior:\s*none;/);
  });

  it.each([
    'src/features/shell/app-shell.tsx',
    'src/features/shell/right-panel.tsx',
    'src/features/shell/sidebar.tsx',
    'src/features/chat/components/chat-frame.tsx',
  ])('%s contains its scroll inside the pane', (path) => {
    for (const match of read(path).matchAll(/className="[^"]*overflow-y-auto[^"]*"/g)) {
      expect(match[0]).toContain('overscroll-contain');
    }
  });
});
