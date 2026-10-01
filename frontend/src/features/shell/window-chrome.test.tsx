import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import de from '../../../messages/de.json';
import type { DesktopWindowControls } from '@/shared/desktop/desktop-script';
import { WindowControls, WindowDragStrip } from './window-chrome';

const renderControls = () =>
  render(
    <NextIntlClientProvider locale="de" messages={de}>
      <WindowControls />
    </NextIntlClientProvider>,
  );

function bridge(): DesktopWindowControls & { emit: (maximized: boolean) => void } {
  let listener: (maximized: boolean) => void = () => {};
  return {
    minimize: vi.fn(async () => {}),
    toggleMaximize: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    isMaximized: vi.fn(async () => false),
    onMaximizedChange: vi.fn((callback) => {
      listener = callback;
      return () => {};
    }),
    emit: (maximized) => listener(maximized),
  };
}

afterEach(() => {
  delete window.desktop;
});

describe('WindowControls', () => {
  it('draws nothing in a browser or with a system frame (Linux)', () => {
    expect(renderControls().container).toBeEmptyDOMElement();
    window.desktop = { isDesktop: true, platform: 'linux', window: bridge() };
    expect(renderControls().container).toBeEmptyDOMElement();
  });

  it.each(['darwin', 'win32'])('draws maximize, minimize and close in the top right corner on %s', async (platform) => {
    const controls = bridge();
    window.desktop = { isDesktop: true, platform, window: controls };
    renderControls();
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(['Maximieren', 'Minimieren', 'Schließen']);
    expect(buttons[0].closest('[data-no-drag]')).toHaveClass('fixed', 'top-0', 'right-0');

    const user = userEvent.setup();
    await user.click(buttons[0]);
    await user.click(buttons[1]);
    await user.click(buttons[2]);
    expect(controls.toggleMaximize).toHaveBeenCalled();
    expect(controls.minimize).toHaveBeenCalled();
    expect(controls.close).toHaveBeenCalled();
  });

  it('turns maximize into restore while the window is maximized or full screen', async () => {
    const controls = bridge();
    window.desktop = { isDesktop: true, platform: 'darwin', window: controls };
    renderControls();
    await act(async () => controls.emit(true));
    expect(screen.getByRole('button', { name: 'Wiederherstellen' })).toBeInTheDocument();
  });
});

describe('WindowDragStrip', () => {
  it('is a decorative strip the desktop CSS turns into the drag region', () => {
    const { container } = render(<WindowDragStrip />);
    const strip = container.firstElementChild;
    expect(strip).toHaveClass('window-drag-strip');
    expect(strip).toHaveAttribute('aria-hidden', 'true');
  });
});
