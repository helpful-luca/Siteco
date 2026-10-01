import { cn } from './cn';

/** Stem and extension (".pdf"); a tail longer than five characters is not an extension. */
export function splitExtension(name: string): [stem: string, extension: string] {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || name.length - dot > 6) return [name, ''];
  return [name.slice(0, dot), name.slice(dot)];
}

/**
 * A file name that truncates inside the stem and keeps the extension visible
 * ("EN_13201_Beleuchtungs….txt"), with the full name as tooltip (annex 10, C21).
 */
export function FileLabel({ name, className }: { name: string; className?: string }) {
  const [stem, extension] = splitExtension(name);
  return (
    <span title={name} className={cn('flex min-w-0', className)}>
      <span className="truncate">{stem}</span>
      <span className="shrink-0">{extension}</span>
    </span>
  );
}
