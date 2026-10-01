export const SECTIONS = ['general', 'appearance', 'models', 'shortcuts', 'data', 'privacy'] as const;
export type Section = (typeof SECTIONS)[number];

/** `?section=` from a link; anything unknown opens the overview. */
export function parseSection(value: string | string[] | undefined): Section | null {
  const first = Array.isArray(value) ? value[0] : value;
  return SECTIONS.includes(first as Section) ? (first as Section) : null;
}

export const sectionHref = (section: Section) => `/settings?section=${section}`;
