'use client';

import { useRef, useState } from 'react';
import { cn } from './cn';
import { Tooltip } from './tooltip';

/** Stem and extension (".pdf"); a tail longer than five characters is not an extension. */
export function splitExtension(name: string): [stem: string, extension: string] {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || name.length - dot > 6) return [name, ''];
  return [name.slice(0, dot), name.slice(dot)];
}

/**
 * A file name that truncates inside the stem and keeps the extension visible
 * ("EN_13201_Beleuchtungs….txt", annex 10, C21). Only when it is cut, hovering shows the full name.
 */
export function FileLabel({ name, className }: { name: string; className?: string }) {
  const [stem, extension] = splitExtension(name);
  const stemRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const truncated = () => {
    const element = stemRef.current;
    return element !== null && element.scrollWidth > element.clientWidth;
  };
  return (
    <Tooltip
      content={<span className="block max-w-80 wrap-anywhere">{name}</span>}
      open={open}
      onOpenChange={(next) => setOpen(next && truncated())}
    >
      <span className={cn('flex min-w-0', className)}>
        <span ref={stemRef} className="truncate">
          {stem}
        </span>
        <span className="shrink-0">{extension}</span>
      </span>
    </Tooltip>
  );
}
