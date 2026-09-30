/** Liveness of the frontend container itself (used by the Docker healthcheck). */
export function GET() {
  return Response.json({ status: 'ok' });
}
