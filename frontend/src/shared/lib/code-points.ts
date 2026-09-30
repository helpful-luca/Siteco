/**
 * The backend counts characters in Unicode code points (Python), JavaScript strings in UTF-16
 * units. Offsets from the API go through here before slicing a JavaScript string.
 */
export function utf16Index(text: string, codePoints: number): number {
  let index = 0;
  let seen = 0;
  while (index < text.length && seen < codePoints) {
    const code = text.codePointAt(index) ?? 0;
    index += code > 0xffff ? 2 : 1;
    seen += 1;
  }
  return index;
}
