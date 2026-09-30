import type { ReactNode } from 'react';
import { Page } from './page';

/** Placeholder page for a feature that follows in a later step. Quiet, honest, no fake UI. */
export function ComingSoon({ icon, title, text, note }: { icon: ReactNode; title: string; text: string; note: string }) {
  return (
    <Page width="reading" center>
      <div className="grid size-12 place-items-center rounded-card bg-fill text-ink-muted ring-1 ring-inset ring-hairline [&_svg]:size-6">
        {icon}
      </div>
      <h1 className="mt-4 text-title-2 font-semibold">{title}</h1>
      <p className="mt-2 max-w-[60ch] text-reading text-ink-muted">{text}</p>
      <p className="mt-6 text-footnote text-ink-muted">{note}</p>
    </Page>
  );
}
