import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import de from '../../../messages/de.json';
import type { DesktopWindowControls } from '@/shared/desktop/desktop-script';
import { WindowControls, WindowDragStrip } from './window-chrome';

function controls(): DesktopWindowControls & { emit: (maximized: boolean) => void } {
  let listener: (maximized: boolean) => void = () => {};
  return {
    minimize: vi.fn(async () => {}),
    toggleMaximize: vi.fn(async () => true),
    close: vi.fn(async () => {}),
    isMaximized: vi.fn(async () => false),
    openMenu: vi.fn(async () => {}),
    onMaximizedChange: (callback) => {
      listener = callback;
      return () => {
        listener = () => {};
      };
    },
    emit: (maximized) => listener(maximized),
  };
}

const renderControls = () =>
  render(
    <NextIntlClientProvider locale="de" messages={de}>
      <WindowControls />
    </NextIntlClientProvider>,
  );

afterEach(() => {
  delete window.desktop;
});

describe('WindowControls', () => {
  it('draws nothing in a browser or on a Mac (native traffic lights)', () => {
    const { container } = renderControls();
    expect(container).toBeEmptyDOMElement();
    window.desktop = { isDesktop: true, platform: 'darwin', window: controls() };
    const mac = renderControls();
    expect(mac.container).toBeEmptyDOMElement();
  });

  it('offers menu, minimize, maximize and close on Windows', async () => {
    const bridge = controls();
    window.desktop = { isDesktop: true, platform: 'win32', window: bridge };
    renderControls();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Minimieren' }));
    await user.click(screen.getByRole('button', { name: 'Maximieren' }));
    await user.click(screen.getByRole('button', { name: 'Schließen' }));
    await user.click(screen.getByRole('button', { name: 'Menü' }));
    expect(bridge.minimize).toHaveBeenCalled();
    expect(bridge.toggleMaximize).toHaveBeenCalled();
    expect(bridge.close).toHaveBeenCalled();
    expect(bridge.openMenu).toHaveBeenCalled();
  });

  it('follows the maximized state for the middle button', async () => {
    const bridge = controls();
    window.desktop = { isDesktop: true, platform: 'win32', window: bridge };
    renderControls();
    expect(await screen.findByRole('button', { name: 'Maximieren' })).toBeInTheDocument();
    act(() => bridge.emit(true));
    expect(screen.getByRole('button', { name: 'Wiederherstellen' })).toBeInTheDocument();
  });

  it('keeps every button out of the drag region', () => {
    window.desktop = { isDesktop: true, platform: 'win32', window: controls() };
    renderControls();
    for (const button of screen.getAllByRole('button')) expect(button.closest('[data-no-drag]')).not.toBeNull();
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
