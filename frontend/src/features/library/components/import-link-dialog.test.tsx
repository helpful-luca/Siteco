import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import de from '../../../../messages/de.json';
import { ImportLinkDialog } from './import-link-dialog';

function setup() {
  const onImport = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <NextIntlClientProvider locale="de" messages={de} timeZone="Europe/Berlin">
      <ImportLinkDialog open onOpenChange={onOpenChange} onImport={onImport} />
    </NextIntlClientProvider>,
  );
  return { onImport, onOpenChange };
}

describe('ImportLinkDialog', () => {
  it('imports a web link with Enter and closes', async () => {
    const { onImport, onOpenChange } = setup();
    const field = screen.getByLabelText('Link');
    expect(field).toHaveFocus();
    await userEvent.type(field, '  https://www.siteco.de/katalog.pdf?_=1 {Enter}');
    expect(onImport).toHaveBeenCalledWith('https://www.siteco.de/katalog.pdf?_=1');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('explains what a link must look like instead of sending something else', async () => {
    const { onImport } = setup();
    await userEvent.type(screen.getByLabelText('Link'), 'file:///etc/passwd');
    await userEvent.click(screen.getByRole('button', { name: 'Importieren' }));
    expect(screen.getByRole('alert')).toHaveTextContent('http:// oder https://');
    expect(onImport).not.toHaveBeenCalled();
  });
});
