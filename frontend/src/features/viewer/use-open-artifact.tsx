'use client';

import { useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { useUI } from '@/features/shell';
import { ArtifactView, type Artifact } from './artifact-view';

export function useOpenArtifact() {
  const { openPanel } = useUI();
  const t = useTranslations('viewer.artifact');
  return useCallback(
    (artifact: Artifact, id: string) =>
      openPanel({
        id: `artifact:${id}`,
        title: t(artifact.kind),
        subtitle: artifact.chatTitle ?? undefined,
        size: 'wide',
        body: <ArtifactView artifact={artifact} />,
      }),
    [openPanel, t],
  );
}
