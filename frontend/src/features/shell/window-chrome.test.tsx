import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import de from '../../../messages/de.json';
import { WindowDragStrip, WindowTitleBar } from './window-chrome';

const renderBar = () =>
  render(
    <NextIntlClientProvider locale="de" messages={de}>
      <WindowTitleBar />
    </NextIntlClientProvider>,
  );

afterEach(() => {
  delete window.desktop;
});

describe('WindowTitleBar', () => {
  it('draws nothing in a browser or on a Mac (native traffic lights)', () => {
    const { container } = renderBar();
    expect(container).toBeEmptyDOMElement();
    window.desktop = { isDesktop: true, platform: 'darwin', window: { openMenu: vi.fn(async () => {}) } };
    const mac = renderBar();
    expect(mac.container).toBeEmptyDOMElement();
  });

  it('shows the app name and the app menu on Windows, never drawn window buttons', async () => {
    const openMenu = vi.fn(async () => {});
    window.desktop = { isDesktop: true, platform: 'win32', window: { openMenu } };
    renderBar();
    expect(screen.getByText('Siteco Document Chat')).toBeInTheDocument();
    // Minimize, maximize and close are the native caption buttons (titleBarOverlay).
    expect(screen.getAllByRole('button')).toHaveLength(1);
    const menu = screen.getByRole('button', { name: 'Menü' });
    expect(menu.closest('[data-no-drag]')).not.toBeNull();
    await userEvent.setup().click(menu);
    expect(openMenu).toHaveBeenCalled();
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
