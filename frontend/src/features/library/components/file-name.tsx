import { extensionOf } from '../upload/pre-check';

/**
 * File name that truncates in the middle of the stem and keeps the extension visible,
 * so "Katalog_Aussenleuchten_2026_final.pdf" becomes "Katalog_Aussenleu….pdf" (annex 10, C21).
 */
export function FileName({ name }: { name: string }) {
  const extension = extensionOf(name);
  const stem = extension ? name.slice(0, -extension.length) : name;
  return (
    <span title={name} className="flex min-w-0 text-body font-medium">
      <span className="truncate">{stem}</span>
      <span className="shrink-0">{extension}</span>
    </span>
  );
}
