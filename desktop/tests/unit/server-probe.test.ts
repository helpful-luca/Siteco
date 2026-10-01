import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { APP_ID, probeServer, waitForApp } from '../../src/server-probe';

let server: Server | undefined;

function serve(handler: Parameters<typeof createServer>[1]): Promise<string> {
  return new Promise((resolve) => {
    server = createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${(server!.address() as AddressInfo).port}`);
    });
  });
}

afterEach(async () => {
  server?.closeAllConnections();
  await new Promise((resolve) => (server ? server.close(resolve) : resolve(undefined)));
  server = undefined;
});

describe('probeServer', () => {
  it('recognises our app by its identity', async () => {
    const url = await serve((req, res) => {
      expect(req.url).toBe('/api/health/live');
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ app: APP_ID, status: 'ok' }));
    });
    expect(await probeServer(url)).toBe('ours');
  });

  it('calls another app on the port "other"', async () => {
    const url = await serve((_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ app: 'something-else' }));
    });
    expect(await probeServer(url)).toBe('other');
  });

  it('calls a non-JSON or failing answer "other"', async () => {
    const url = await serve((_req, res) => {
      res.statusCode = 502;
      res.end('<html>bad gateway</html>');
    });
    expect(await probeServer(url)).toBe('other');
  });

  it('does not follow redirects', async () => {
    const url = await serve((_req, res) => {
      res.statusCode = 302;
      res.setHeader('Location', 'https://example.com/');
      res.end();
    });
    expect(await probeServer(url)).toBe('other');
  });

  it('reports "down" when nothing listens', async () => {
    const url = await serve((_req, res) => res.end());
    server!.close();
    expect(await probeServer(url)).toBe('down');
  });

  it('times out a server that never answers', async () => {
    const url = await serve(() => {});
    const started = Date.now();
    expect(await probeServer(url, { timeoutMs: 200 })).toBe('down');
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe('waitForApp', () => {
  it('resolves true as soon as the probe says "ours"', async () => {
    const answers = ['down', 'other', 'ours'] as const;
    let calls = 0;
    const ok = await waitForApp(async () => answers[calls++] ?? 'ours', { timeoutMs: 5_000, intervalMs: 1 });
    expect(ok).toBe(true);
    expect(calls).toBe(3);
  });

  it('gives up after the timeout', async () => {
    const started = Date.now();
    const ok = await waitForApp(async () => 'down', { timeoutMs: 150, intervalMs: 20 });
    expect(ok).toBe(false);
    expect(Date.now() - started).toBeGreaterThanOrEqual(140);
  });

  it('stops when aborted', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    const ok = await waitForApp(async () => 'down', { timeoutMs: 10_000, intervalMs: 10, signal: controller.signal });
    expect(ok).toBe(false);
  });
});
