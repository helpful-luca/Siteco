/** Pure rules for the /api proxy. Kept separate from the route handler so they are unit tested. */

const SAFE_SEGMENT = /^[A-Za-z0-9_-]+$/;
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const FORWARD_REQUEST_HEADERS = [
  "content-type",
  "content-length",
  "accept",
  "range",
  "x-file-name",
] as const;

/** Only for `/api/mcp`: MCP clients authenticate with a bearer token and name the protocol version. */
const FORWARD_MCP_REQUEST_HEADERS = [
  "authorization",
  "mcp-protocol-version",
  "mcp-session-id",
] as const;

export const FORWARD_RESPONSE_HEADERS = [
  "content-type",
  "content-disposition",
  "content-length",
  "content-range",
  "accept-ranges",
  "retry-after",
  "allow",
  "www-authenticate",
  "x-request-id",
  "cache-control",
  "content-security-policy",
  "x-content-type-options",
  "cross-origin-resource-policy",
] as const;

export function isSafePath(segments: string[]): boolean {
  return (
    segments.length > 0 &&
    segments.every((segment) => SAFE_SEGMENT.test(segment))
  );
}

const LOCAL_HOSTNAME = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/** `/api/mcp`: the endpoint for MCP clients (Claude Desktop, Claude Code), not for browsers. */
export function isMcpPath(segments: string[]): boolean {
  return segments.length === 1 && segments[0] === "mcp";
}

export function forwardRequestHeaders(
  source: Headers,
  path: string[],
): Headers {
  const names = isMcpPath(path)
    ? [...FORWARD_REQUEST_HEADERS, ...FORWARD_MCP_REQUEST_HEADERS]
    : FORWARD_REQUEST_HEADERS;
  return pickHeaders(source, names);
}

/**
 * Blocks cross-site writes: any website could otherwise POST to http://localhost:3000.
 * Browsers never let a foreign page set X-Requested-With without a CORS preflight we do not answer.
 */
export function checkMutationGuard(
  method: string,
  headers: Headers,
  host: string,
  path: string[] = [],
): "ok" | "FORBIDDEN_ORIGIN" {
  if (isMcpPath(path)) return checkMcpGuard(headers, host);
  if (!MUTATING_METHODS.has(method.toUpperCase())) return "ok";
  if (headers.get("x-requested-with") !== "docchat") return "FORBIDDEN_ORIGIN";
  const origin = headers.get("origin");
  if (origin === null) return "ok";
  try {
    return new URL(origin).host === host ? "ok" : "FORBIDDEN_ORIGIN";
  } catch {
    return "FORBIDDEN_ORIGIN";
  }
}

/**
 * MCP clients are not browsers: they POST without X-Requested-With and usually without Origin,
 * so the CSRF header cannot be required. The same two threats stay covered another way:
 * - A web page in the browser (cross-site POST, or DNS rebinding) always sends an Origin, which
 *   must then be this app's own origin; a rebinding page also arrives with a foreign Host.
 * - The Host must be a loopback name, so the endpoint answers only for requests addressed to
 *   this machine. MCP_TOKEN (checked by the backend) is the optional second factor.
 */
function checkMcpGuard(
  headers: Headers,
  host: string,
): "ok" | "FORBIDDEN_ORIGIN" {
  if (!LOCAL_HOSTNAME.test(host)) return "FORBIDDEN_ORIGIN";
  const origin = headers.get("origin");
  if (origin === null) return "ok";
  try {
    return new URL(origin).host === host ? "ok" : "FORBIDDEN_ORIGIN";
  } catch {
    return "FORBIDDEN_ORIGIN";
  }
}

export function pickHeaders(
  source: Headers,
  allow: readonly string[],
): Headers {
  const picked = new Headers();
  for (const name of allow) {
    const value = source.get(name);
    if (value !== null) picked.set(name, value);
  }
  return picked;
}

/** JSON bodies are small; the raw upload (`POST /api/documents`) has its own limit (annex 10, P5). */
export const MAX_JSON_BODY_BYTES = 64 * 1024;

export function exceedsBodyLimit(
  method: string,
  path: string[],
  contentLength: string | null,
): boolean {
  if (!MUTATING_METHODS.has(method.toUpperCase())) return false;
  if (
    method.toUpperCase() === "POST" &&
    path.length === 1 &&
    path[0] === "documents"
  )
    return false;
  const length = Number(contentLength);
  return Number.isFinite(length) && length > MAX_JSON_BODY_BYTES;
}
