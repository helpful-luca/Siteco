import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';

/** Where the window was when it closed. Position is optional: a first start centres it. */
export interface WindowBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized?: boolean;
}

/** The app's own settings in `<userData>/config.json`. Everything else lives in the backend. */
export interface AppConfig {
  /** Folder with compose.yaml; when missing, the build-time repository root is used. */
  projectDir?: string;
  /** Host port of the frontend container (compose APP_PORT). */
  port: number;
  window?: WindowBounds;
}

export const DEFAULT_PORT = 3000;

const MIN_WINDOW = { width: 400, height: 300 };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1024 && value <= 65535;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseWindow(raw: unknown): WindowBounds | undefined {
  if (!isRecord(raw)) return undefined;
  const { x, y, width, height, maximized } = raw;
  if (!isFiniteNumber(width) || !isFiniteNumber(height)) return undefined;
  if (width < MIN_WINDOW.width || height < MIN_WINDOW.height) return undefined;
  const bounds: WindowBounds = { width: Math.round(width), height: Math.round(height) };
  if (isFiniteNumber(x) && isFiniteNumber(y)) {
    bounds.x = Math.round(x);
    bounds.y = Math.round(y);
  }
  if (maximized === true) bounds.maximized = true;
  return bounds;
}

/** Validates field by field: a broken field falls back to its default, the rest survives. */
export function parseConfig(raw: unknown): AppConfig {
  const config: AppConfig = { port: DEFAULT_PORT };
  if (!isRecord(raw)) return config;
  if (isPort(raw.port)) config.port = raw.port;
  if (typeof raw.projectDir === 'string' && isAbsolute(raw.projectDir)) config.projectDir = raw.projectDir;
  const window = parseWindow(raw.window);
  if (window) config.window = window;
  return config;
}

export function loadConfig(file: string): AppConfig {
  try {
    return parseConfig(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return parseConfig(undefined);
  }
}

/** Atomic write (temp file plus rename), readable by the owner only. */
export function saveConfig(file: string, config: AppConfig): void {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, file);
}

/** The app is always served from localhost; the port is the only variable part. */
export function appUrl(port: number): string {
  return `http://localhost:${port}`;
}
