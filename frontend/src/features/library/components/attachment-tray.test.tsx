import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocumentOut } from '@/shared/api/types';
import { TooltipProvider } from '@/shared/ui';
import de from '../../../../messages/de.json';
import { doc } from '../testing';
import { UploadProvider, useUploads } from '../upload/upload-provider';
import { AttachmentsButton } from './attachments-button';
import { AttachmentTray } from './attachment-tray';

const CONFIG = { limits: { max_upload_mb: 1024 }, features: { retrieval_only: true } };

class HeldXhr {
  static all: HeldXhr[] = [];
  url = '';
  upload = { onprogress: null as ((e: { loaded: number; total: number }) => void) | null };
  status = 0;
  responseText = '';
  onload: (() => void) | null = null;
  onloadend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  constructor() {
    HeldXhr.all.push(this);
  }
  open(_method: string, url: string) {
    this.url = url;
  }
  setRequestHeader() {}
  getResponseHeader() {
    return 'application/json';
  }
  send() {}
  abort() {}
  finish(document: DocumentOut) {
    this.status = 202;
    this.responseText = JSON.stringify({ document });
    this.onload?.();
    this.onloadend?.();
  }
}

const grabbed: { addFiles: ((files: File[], chatId?: string | null) => void) | null } = { addFiles: null };
function Grab() {
  const { addFiles } = useUploads();
  useEffect(() => {
    grabbed.addFiles = addFiles;
  }, [addFiles]);
  return null;
}

function setup(attachments: DocumentOut[]) {
  let current = attachments;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/config') return Response.json(CONFIG);
    if (url.endsWith('/library') && init?.method === 'POST') {
      const id = url.split('/')[3];
      current = current.map((d) => (d.id === id ? { ...d, in_library: true } : d));
      return Response.json({ document: current.find((d) => d.id === id) });
    }
    if (init?.method === 'DELETE') {
      current = current.filter((d) => !url.endsWith(d.id));
      return new Response(null, { status: 204 });
    }
    if (url === '/api/chats/c1/attachments') return Response.json({ documents: current });
    return Response.json({ documents: [] });
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('XMLHttpRequest', HeldXhr);
  HeldXhr.all = [];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <NextIntlClientProvider locale="de" messages={de} timeZone="Europe/Berlin">
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <UploadProvider>
            <Grab />
            <AttachmentsButton chatId="c1" />
            <AttachmentTray chatId="c1" />
          </UploadProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

const PDF = new File(['%PDF-1.7 data'], 'Angebot.pdf');

describe('attachment tray', () => {
  it('asks while the upload runs and applies the answer once it is done', async () => {
    const fetchMock = setup([]);
    act(() => grabbed.addFiles?.([PDF], 'c1'));
    const tray = await screen.findByRole('list', { name: 'Anhänge dieses Chats' });
    expect(within(tray).getByText('Angebot.pdf')).toBeInTheDocument();
    expect(within(tray).getByText('Auch in die Bibliothek aufnehmen?')).toBeInTheDocument();
    await userEvent.click(within(tray).getByRole('button', { name: 'In Bibliothek' }));
    expect(HeldXhr.all[0].url).toBe('/api/documents?chat_id=c1');
    act(() => HeldXhr.all[0].finish(doc({ id: 'n1', filename: 'Angebot.pdf', in_library: false, status: 'scanning' })));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/documents/n1/library', expect.objectContaining({ method: 'POST' })),
    );
  });

  it('keeps asking after the upload when nobody answered, until "Nur in diesem Chat"', async () => {
    const fetchMock = setup([]);
    act(() => grabbed.addFiles?.([PDF], 'c1'));
    await screen.findByText('Auch in die Bibliothek aufnehmen?');
    act(() => HeldXhr.all[0].finish(doc({ id: 'n1', filename: 'Angebot.pdf', in_library: false, status: 'ready' })));
    const tray = await screen.findByRole('list', { name: 'Anhänge dieses Chats' });
    await userEvent.click(await within(tray).findByRole('button', { name: 'Nur in diesem Chat' }));
    await waitFor(() => expect(screen.queryByText('Auch in die Bibliothek aufnehmen?')).not.toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalledWith('/api/documents/n1/library', expect.anything());
  });

  it('lists the attachments and moves one into the library later', async () => {
    const fetchMock = setup([
      doc({ id: 'a1', filename: 'Angebot.pdf', in_library: false }),
      doc({ id: 'a2', filename: 'Katalog.pdf', in_library: true }),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Anhänge: 2' }));
    const panel = await screen.findByRole('dialog', { name: 'Anhänge dieses Chats' });
    expect(within(panel).getByText('In der Bibliothek')).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: 'Angebot.pdf zur Bibliothek hinzufügen' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/documents/a1/library', expect.objectContaining({ method: 'POST' }));
    await userEvent.click(within(panel).getByRole('button', { name: 'Katalog.pdf aus diesem Chat entfernen' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/chats/c1/attachments/a2', expect.objectContaining({ method: 'DELETE' }));
  });
});
