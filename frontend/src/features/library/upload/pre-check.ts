/**
 * Checks a file before it is uploaded, to spare a round trip. The backend checks everything again
 * (annex 10, C1 to C4).
 */
export const ACCEPTED_EXTENSIONS = ['.pdf', '.txt', '.md', '.markdown'] as const;
export const ACCEPT_ATTRIBUTE = [...ACCEPTED_EXTENSIONS, 'application/pdf', 'text/plain', 'text/markdown'].join(',');

export type UploadError = {
  code: string;
  params: Record<string, string | number>;
  retryable: boolean;
  /** For our own rate limit: epoch ms from which trying again makes sense (annex 11, 6.3). */
  retryAt?: number | null;
  requestId?: string | null;
};

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot).toLowerCase();
}

export function preCheck(
  file: { name: string; size: number },
  maxUploadMb: number | undefined,
): UploadError | null {
  if (!(ACCEPTED_EXTENSIONS as readonly string[]).includes(extensionOf(file.name))) {
    return { code: 'UNSUPPORTED_TYPE', params: {}, retryable: false };
  }
  if (file.size === 0) return { code: 'EMPTY_FILE', params: {}, retryable: false };
  if (maxUploadMb !== undefined && file.size > maxUploadMb * 1024 * 1024) {
    return { code: 'UPLOAD_TOO_LARGE', params: { max_mb: maxUploadMb }, retryable: false };
  }
  return null;
}
