/** Collapses CR/LF and control characters to spaces and trims, so a value can't break a header or an inline string. */
export function cleanInline(value: string | null | undefined): string {
  return (value ?? '').replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').trim();
}
