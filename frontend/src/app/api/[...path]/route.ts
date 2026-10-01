import type { NextRequest } from "next/server";
import { BACKEND_URL, internalHeaders } from "@/shared/api/backend";
import { envelopeResponse } from "@/shared/api/errors";
import {
  checkMutationGuard,
  exceedsBodyLimit,
  FORWARD_RESPONSE_HEADERS,
  forwardRequestHeaders,
  isSafePath,
  pickHeaders,
} from "@/shared/api/proxy-rules";

// Own streaming proxy instead of next.config rewrites(): rewrites gzip and buffer SSE streams.

async function proxy(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const requestId = `req_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
  const { path } = await ctx.params;
  if (!isSafePath(path))
    return envelopeResponse(422, "VALIDATION_ERROR", requestId);
  if (
    checkMutationGuard(
      req.method,
      req.headers,
      req.headers.get("host") ?? "",
      path,
    ) !== "ok"
  ) {
    return envelopeResponse(403, "FORBIDDEN_ORIGIN", requestId);
  }
  if (exceedsBodyLimit(req.method, path, req.headers.get("content-length"))) {
    return envelopeResponse(413, "REQUEST_TOO_LARGE", requestId);
  }

  const headers = forwardRequestHeaders(req.headers, path);
  headers.set("x-request-id", requestId);
  for (const [name, value] of Object.entries(internalHeaders()))
    headers.set(name, value);

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  let upstream: Response;
  try {
    upstream = await fetch(
      `${BACKEND_URL}/api/${path.join("/")}${req.nextUrl.search}`,
      {
        method: req.method,
        headers,
        body: hasBody ? req.body : undefined,
        // Node's fetch requires duplex for streamed request bodies (uploads).
        ...(hasBody ? { duplex: "half" } : {}),
        signal: req.signal,
        redirect: "manual",
        cache: "no-store",
      } as RequestInit,
    );
  } catch {
    if (req.signal.aborted) return new Response(null, { status: 499 });
    return envelopeResponse(503, "BACKEND_UNAVAILABLE", requestId, true);
  }

  const responseHeaders = pickHeaders(
    upstream.headers,
    FORWARD_RESPONSE_HEADERS,
  );
  if (responseHeaders.get("content-type")?.startsWith("text/event-stream")) {
    responseHeaders.set("cache-control", "no-cache, no-transform");
    responseHeaders.set("x-accel-buffering", "no");
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export {
  proxy as DELETE,
  proxy as GET,
  proxy as HEAD,
  proxy as PATCH,
  proxy as POST,
  proxy as PUT,
};
