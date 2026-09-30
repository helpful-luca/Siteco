/** A table cell value that is not known (yet): visually empty, named for screen readers. */
export function EmptyValue({ label }: { label: string }) {
  return <span className="sr-only">{label}</span>;
}
