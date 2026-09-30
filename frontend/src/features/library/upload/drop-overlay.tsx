'use client';

import { FileUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useUploads } from './upload-provider';

function carriesFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

/**
 * Full-window drop target. Dropped files always land in the library (annex 11, 8.7), so a drop
 * elsewhere opens the library to show the progress. Never the only way to upload.
 */
export function DropOverlay() {
  const t = useTranslations('library.drop');
  const { addFiles } = useUploads();
  const router = useRouter();
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const depth = useRef(0);

  useEffect(() => {
    const enter = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth.current += 1;
      setVisible(true);
    };
    const over = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    };
    const leave = () => {
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setVisible(false);
    };
    const drop = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth.current = 0;
      setVisible(false);
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      addFiles(files);
      if (pathname !== '/library') router.push('/library');
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [addFiles, pathname, router]);

  if (!visible) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-canvas/40 p-4 backdrop-blur-[2px] lg:p-6"
    >
      <div className="glass-dense flex size-full rounded-panel p-3">
        <div className="flex flex-1 flex-col items-center justify-center rounded-[16px] border-2 border-dashed border-sodium/60">
          <div className="grid size-16 place-items-center rounded-full bg-highlight text-sodium-ink">
            <FileUp className="size-7" />
          </div>
          <p className="mt-5 text-title-3 font-semibold">{t('title')}</p>
          <p className="mt-1.5 max-w-sm px-6 text-center text-body text-ink-muted">{t('text')}</p>
        </div>
      </div>
    </div>
  );
}
