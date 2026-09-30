import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UIProvider } from '@/features/shell';
import type { DocumentOut } from '@/shared/api/types';
import { TooltipProvider } from '@/shared/ui';
import de from '../../../../messages/de.json';
import { doc } from '../testing';
import { UploadProvider } from '../upload/upload-provider';
import { LibraryView } from './library-view';

const CONFIG = {
  version: 'test',
  commit: 'x',
  llm_status: 'missing_key',
  limits: { max_upload_mb: 1024, max_pdf_pages: 5000, max_storage_mb: 20480 },
  features: { retrieval_only: true, malware_scan: 'required' },
};

function setup(documents: DocumentOut[]) {
  let current = documents;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/config') return Response.json(CONFIG);
    if (init?.method === 'DELETE') {
      current = current.filter((d) => !url.endsWith(d.id));
      return new Response(null, { status: 204 });
    }
    return Response.json({ documents: current });
  });
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <NextIntlClientProvider locale="de" messages={de} timeZone="Europe/Berlin">
      <QueryClientProvider client={client}>
        <UIProvider>
          <TooltipProvider>
            <UploadProvider>
              <LibraryView />
            </UploadProvider>
          </TooltipProvider>
        </UIProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

const MIXED = [
  doc({ id: 'a', filename: 'Mira_L_Datenblatt.pdf' }),
  doc({ id: 'b', filename: 'Katalog_2026.pdf', status: 'parsing', progress: 0.4, page_count: 1500 }),
  doc({ id: 'c', filename: 'Montage.md', kind: 'md', status: 'queued', queue_position: 2, page_count: null }),
  doc({
    id: 'd',
    filename: 'Notizen.txt',
    kind: 'txt',
    status: 'scanning',
    page_count: null,
    notices: [{ code: 'SCANNER_STARTING', params: {} }],
  }),
  doc({
    id: 'e',
    filename: 'eicar.txt',
    kind: 'txt',
    status: 'failed',
    error_code: 'MALWARE_DETECTED',
    error_params: { signature: 'Eicar-Test-Signature' },
  }),
  doc({ id: 'f', filename: 'Formular.pdf', notices: [{ code: 'PDF_ACTIVE_CONTENT', params: {} }] }),
];

describe('LibraryView', () => {
  it('invites the first upload when the library is empty', async () => {
    setup([]);
    expect(await screen.findByRole('heading', { name: 'Deine Bibliothek ist noch leer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dateien auswählen' })).toBeInTheDocument();
    expect(await screen.findByText(/Bis 1 GB pro Datei/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows every status with text, progress and calm notices', async () => {
    setup(MIXED);
    const table = await screen.findByRole('table', { name: 'Dokumente in deiner Bibliothek' });
    expect(within(table).getAllByRole('row')).toHaveLength(MIXED.length + 1);
    expect(screen.getByText('6 Dokumente, 7,2 MB')).toBeInTheDocument();
    for (const text of ['Bereit', 'Wird gelesen, 40 %', 'Wartet, Platz 2', 'Wird geprüft', 'Fehler']) {
      expect(within(table).getAllByText(text).length).toBeGreaterThan(0);
    }
    expect(within(table).getAllByRole('progressbar').length).toBeGreaterThan(0);
    expect(screen.getByText(/Die Virenprüfung startet noch/)).toBeInTheDocument();
    expect(screen.getByText(/Die Virenprüfung hat in dieser Datei Schadsoftware gefunden/)).toBeInTheDocument();
    expect(screen.getByText('Gefunden: Eicar-Test-Signature')).toBeInTheDocument();
    expect(screen.getByText(/Dieses PDF enthält aktive Inhalte/)).toBeInTheDocument();
  });

  it('announces states politely, without every percent, and leaves unknown cells empty', async () => {
    setup(MIXED);
    const table = await screen.findByRole('table');
    const regions = table.querySelectorAll('[aria-live="polite"]');
    const texts = Array.from(regions, (r) => r.textContent);
    expect(texts).toContain('Katalog_2026.pdf: wird gelesen');
    expect(texts).toContain('Mira_L_Datenblatt.pdf: bereit');
    expect(texts.join(' ')).not.toMatch(/%/);
    expect(table.textContent).not.toContain('--');
    expect(within(table).getAllByText('keine Seitenangabe').length).toBeGreaterThan(0);
  });

  it('filters by status and searches by file name', async () => {
    setup(MIXED);
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('radio', { name: 'Fehler' }));
    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(screen.getByTitle('eicar.txt')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: 'Alle' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Dokumente durchsuchen' }), 'KATALOG');
    expect(screen.getAllByRole('row')).toHaveLength(2);

    await userEvent.type(screen.getByRole('searchbox'), 'xyz');
    expect(screen.getByText('Zu „KATALOGxyz“ gibt es kein Dokument.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }));
    expect(screen.getAllByRole('row')).toHaveLength(MIXED.length + 1);
  });

  it('deletes only after confirmation', async () => {
    const fetchMock = setup(MIXED);
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Mira_L_Datenblatt.pdf löschen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Dokument löschen?' });
    expect(within(dialog).getByText(/„Mira_L_Datenblatt.pdf“ wird mit allen Suchdaten/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    expect(fetchMock).not.toHaveBeenCalledWith('/api/documents/a', expect.anything());

    await userEvent.click(screen.getByRole('button', { name: 'Mira_L_Datenblatt.pdf löschen' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Löschen' }));
    await waitFor(() => expect(screen.queryByTitle('Mira_L_Datenblatt.pdf')).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith('/api/documents/a', expect.objectContaining({ method: 'DELETE' }));
  });

  it('shows a rejected file as its own row with the reason', async () => {
    setup([doc()]);
    await screen.findByRole('table');
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    await userEvent.upload(input!, new File(['x'], 'Angebot.docx'), { applyAccept: false });
    expect(await screen.findByRole('alert')).toHaveTextContent('Dieses Format wird nicht unterstützt');
    expect(screen.queryByRole('button', { name: 'Angebot.docx erneut hochladen' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Angebot.docx aus der Liste entfernen' }));
    expect(screen.queryByTitle('Angebot.docx')).not.toBeInTheDocument();
  });
});
