/**
 * Static Content Security Policy for production builds. It blocks foreign origins, plugins, framing and `eval`.
 * - `script-src 'unsafe-inline'`: the App Router streams its payload in inline scripts, and the
 *   theme and desktop scripts run before first paint. `'wasm-unsafe-eval'` lets PDF.js compile its
 *   image decoders (WebAssembly only, not JavaScript eval).
 * - `worker-src 'self' blob:`: the PDF.js worker is a same-origin file.
 * Development (`next dev`) needs eval for Fast Refresh and gets no policy.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');
