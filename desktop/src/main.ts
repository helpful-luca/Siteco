import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  app,
  BrowserWindow,
  crashReporter,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  protocol,
  screen,
  session,
  shell,
} from 'electron';
import { runCompose } from './compose-runner';
import { appUrl, loadConfig, saveConfig, type AppConfig } from './config';
import { dockerRunning, launchDockerApp, waitForDocker } from './docker-engine';
import { locateDocker, locateDockerApp } from './docker-locator';
import { MESSAGES, pickLang } from './i18n';
import { menuTemplate } from './menu';
import { isProjectDir, resolveProjectDir } from './project-dir';
import { probeServer, waitForApp } from './server-probe';
import { isSplashAction, SPLASH_CHANNELS, type SplashAction } from './splash-ipc';
import { runStartup, type StartupState } from './startup';
import { DEFAULT_WINDOW, restoreBounds } from './window-state';
import {
  hardenContents,
  hardenSession,
  isSplashUrl,
  SPLASH_ORIGIN,
  SPLASH_PATH,
  SPLASH_SCHEME,
} from './window-security';

/*
 * Lifecycle of the desktop app: single instance, splash with the startup orchestration
 * (Docker, compose, identity check), then the app window on http://localhost:<port>.
 */

const DOCKER_DOWNLOAD_URL = 'https://www.docker.com/products/docker-desktop/';
/** Matches the app's canvas token (globals.css), so no white flash before the first paint. */
const CANVAS = { light: '#f2f2f5', dark: '#000000' } as const;
/** Aligns the traffic lights with the sidebar's search field (inside the 28 px title bar inset). */
const TRAFFIC_LIGHTS = { x: 24, y: 22 } as const;
const SPLASH_SIZE = { width: 520, height: 380 } as const;
/** The only files the splash scheme serves, with their types. */
const SPLASH_FILES = new Map([
  ['/splash.html', 'text/html; charset=utf-8'],
  ['/splash.css', 'text/css; charset=utf-8'],
  ['/splash.js', 'text/javascript; charset=utf-8'],
  ['/icon.png', 'image/png'],
]);
const APP_WAIT_MS = 180_000;

// Test and development hooks; a packaged app ignores them.
const DEV = !app.isPackaged && (process.argv.includes('--dev') || process.env.DOCCHAT_DEV === '1');
if (!app.isPackaged && process.env.DOCCHAT_USER_DATA) app.setPath('userData', process.env.DOCCHAT_USER_DATA);
/** Shows the splash even when the app already answers (smoke test, screenshots). */
const ALWAYS_SPLASH = !app.isPackaged && process.env.DOCCHAT_SPLASH === '1';

// Crash dumps stay on this Mac; nothing is uploaded (team brief: no telemetry).
crashReporter.start({ uploadToServer: false });

protocol.registerSchemesAsPrivileged([{ scheme: SPLASH_SCHEME, privileges: { standard: true, secure: true } }]);

const configFile = join(app.getPath('userData'), 'config.json');
let config: AppConfig = loadConfig(configFile);
const devPort = Number(process.env.DOCCHAT_PORT);
const port = !app.isPackaged && Number.isInteger(devPort) && devPort > 0 ? devPort : config.port;
const APP_URL = appUrl(port);
const APP_ORIGIN = new URL(APP_URL).origin;

const lang = pickLang(app.getPreferredSystemLanguages());
const t = MESSAGES[lang];

let splash: BrowserWindow | undefined;
let mainWindow: BrowserWindow | undefined;
let lastState: StartupState = { step: 'checking' };
let starting = false;
let quitting = false;

function canvasColor(): string {
  return nativeTheme.shouldUseDarkColors ? CANVAS.dark : CANVAS.light;
}

function updateConfig(patch: Partial<AppConfig>): void {
  config = { ...config, ...patch };
  saveConfig(configFile, config);
}

function builtInProjectDir(): string | undefined {
  try {
    const info: unknown = JSON.parse(readFileSync(join(__dirname, 'build-info.json'), 'utf8'));
    const dir = (info as { projectDir?: unknown }).projectDir;
    return typeof dir === 'string' ? dir : undefined;
  } catch {
    return undefined;
  }
}

const secureWebPreferences = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webSecurity: true,
  webviewTag: false,
  navigateOnDragDrop: false,
  devTools: DEV,
} as const;

// Menu ------------------------------------------------------------------------------------------

function buildMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      menuTemplate(t, {
        dev: DEV,
        appReady: Boolean(mainWindow),
        openSettings: () => {
          if (!mainWindow) return;
          void mainWindow.loadURL(`${APP_URL}/settings`);
          mainWindow.show();
        },
        stopServices: () => void stopServices(),
      }),
    ),
  );
}

// Splash ----------------------------------------------------------------------------------------

function setState(state: StartupState): void {
  lastState = state;
  if (splash && !splash.isDestroyed()) splash.webContents.send(SPLASH_CHANNELS.state, state);
}

function showSplash(): BrowserWindow {
  if (splash && !splash.isDestroyed()) {
    splash.show();
    return splash;
  }
  const win = new BrowserWindow({
    ...SPLASH_SIZE,
    show: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: t.appName,
    titleBarStyle: 'hiddenInset',
    backgroundColor: canvasColor(),
    webPreferences: { ...secureWebPreferences, spellcheck: false, preload: join(__dirname, 'splash-preload.js') },
  });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    splash = undefined;
    // Closing the splash while nothing else is open ends the app: there is nothing to show.
    if (!mainWindow && !quitting) app.quit();
  });
  void win.loadURL(`${SPLASH_ORIGIN}${SPLASH_PATH}?lang=${lang}`);
  splash = win;
  return win;
}

function closeSplash(): void {
  const win = splash;
  splash = undefined;
  if (win && !win.isDestroyed()) win.close();
}

async function pickProjectFolder(): Promise<string | undefined> {
  const options = {
    title: t.dialog.pickProjectTitle,
    message: t.dialog.pickProjectMessage,
    buttonLabel: t.dialog.pickProjectButton,
    properties: ['openDirectory' as const],
  };
  const result = splash ? await dialog.showOpenDialog(splash, options) : await dialog.showOpenDialog(options);
  return result.canceled ? undefined : result.filePaths[0];
}

async function onSplashAction(action: SplashAction): Promise<void> {
  switch (action) {
    case 'retry':
      return startApp();
    case 'choose-folder': {
      const dir = await pickProjectFolder();
      if (dir && (await isProjectDir(dir))) {
        updateConfig({ projectDir: dir });
        return startApp();
      }
      return;
    }
    case 'download-docker':
      return shell.openExternal(DOCKER_DOWNLOAD_URL);
    case 'quit':
      app.quit();
  }
}

function registerSplashIpc(): void {
  const fromSplash = (event: Electron.IpcMainInvokeEvent) =>
    splash !== undefined && event.sender === splash.webContents && isSplashUrl(event.senderFrame?.url ?? '');
  ipcMain.handle(SPLASH_CHANNELS.init, (event) => {
    if (!fromSplash(event)) return undefined;
    return { lang, port, messages: t.splash, appName: t.appName, state: lastState };
  });
  ipcMain.handle(SPLASH_CHANNELS.action, (event, action: unknown) => {
    if (!fromSplash(event) || !isSplashAction(action)) return;
    return onSplashAction(action);
  });
}

function serveSplashFiles(): void {
  const root = join(__dirname, 'static');
  protocol.handle(SPLASH_SCHEME, async (request) => {
    const { host, pathname } = new URL(request.url);
    const type = SPLASH_FILES.get(pathname);
    if (host !== 'app' || !type) return new Response('Not found', { status: 404 });
    const body = await readFile(join(root, pathname.slice(1)));
    return new Response(body, { headers: { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' } });
  });
}

// App window ------------------------------------------------------------------------------------

function saveWindowBounds(win: BrowserWindow): void {
  const bounds = win.getNormalBounds();
  updateConfig({ window: { ...bounds, ...(win.isMaximized() ? { maximized: true } : {}) } });
}

function openMainWindow(): void {
  if (mainWindow) {
    mainWindow.show();
    closeSplash();
    return;
  }
  const bounds = restoreBounds(
    config.window,
    screen.getAllDisplays().map((display) => display.workArea),
  );
  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: DEFAULT_WINDOW.minWidth,
    minHeight: DEFAULT_WINDOW.minHeight,
    show: false,
    title: t.appName,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: TRAFFIC_LIGHTS,
    backgroundColor: canvasColor(),
    webPreferences: { ...secureWebPreferences, preload: join(__dirname, 'preload.js') },
  });
  if (bounds.maximized) win.maximize();
  win.once('ready-to-show', () => {
    win.show();
    closeSplash();
  });
  win.on('close', () => saveWindowBounds(win));
  win.on('closed', () => {
    mainWindow = undefined;
    buildMenu();
  });
  // The first load failed (the server went away between the check and the load): back to the splash.
  win.webContents.on('did-fail-load', (_event, code, _description, url, isMainFrame) => {
    if (!isMainFrame || code === -3 || win.isVisible() || url.startsWith(SPLASH_ORIGIN)) return;
    win.destroy();
    void startApp();
  });
  mainWindow = win;
  buildMenu();
  void win.loadURL(APP_URL);
}

// Startup and shutdown --------------------------------------------------------------------------

async function startApp(): Promise<void> {
  if (starting) return;
  if (mainWindow) return openMainWindow();
  starting = true;
  try {
    // Already running (the usual case after the first start): no splash at all.
    if (!ALWAYS_SPLASH && (await probeServer(APP_URL, { timeoutMs: 800 })) === 'ours') return openMainWindow();
    showSplash();
    const home = homedir();
    const ok = await runStartup({
      mode: DEV ? 'dev' : 'docker',
      probe: () => probeServer(APP_URL),
      waitForApp: () => waitForApp(() => probeServer(APP_URL), { timeoutMs: APP_WAIT_MS, intervalMs: 500 }),
      locateDocker: () => locateDocker(home),
      dockerRunning: (docker) => dockerRunning(docker, port),
      launchDocker: async () => launchDockerApp(await locateDockerApp(home)),
      waitForDocker: (docker) => waitForDocker(docker, port),
      resolveProject: () =>
        resolveProjectDir({
          remembered: config.projectDir,
          builtIn: builtInProjectDir(),
          pick: pickProjectFolder,
          remember: (dir) => updateConfig({ projectDir: dir }),
        }),
      composeUp: (docker, projectDir, onLine) => runCompose(docker, 'up', { projectDir, port }, onLine),
      onState: setState,
    });
    if (ok && !quitting) openMainWindow();
  } finally {
    starting = false;
  }
}

/** "Dienste beenden": `docker compose stop` in the project folder, then quit. Data stays in the volumes. */
async function stopServices(): Promise<void> {
  if (quitting) return;
  quitting = true;
  mainWindow?.close();
  showSplash();
  setState({ step: 'stopping' });
  const home = homedir();
  const docker = await locateDocker(home);
  const projectDir = [config.projectDir, builtInProjectDir()].find((dir) => dir !== undefined);
  const ok =
    docker !== undefined &&
    (await isProjectDir(projectDir)) &&
    (await runCompose(docker, 'stop', { projectDir: projectDir!, port })).ok;
  if (!ok) {
    await dialog.showMessageBox({
      type: 'warning',
      message: t.dialog.stopFailedTitle,
      detail: t.dialog.stopFailedDetail,
      buttons: [t.dialog.ok],
    });
  }
  app.quit();
}

// Wiring ----------------------------------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = mainWindow ?? splash;
    if (!win) return void startApp();
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  app.on('web-contents-created', (_event, contents) => {
    hardenContents(contents, APP_ORIGIN, (url) => void shell.openExternal(url));
  });

  nativeTheme.on('updated', () => {
    for (const win of BrowserWindow.getAllWindows()) win.setBackgroundColor(canvasColor());
  });

  app.on('before-quit', () => {
    quitting = true;
  });

  // macOS: the app stays in the Dock without windows; clicking it opens the window again.
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void startApp();
  });

  void app.whenReady().then(() => {
    app.setAboutPanelOptions({
      applicationName: t.appName,
      applicationVersion: app.getVersion(),
      version: '',
      credits: t.about.credits,
    });
    hardenSession(session.defaultSession, APP_ORIGIN);
    serveSplashFiles();
    registerSplashIpc();
    buildMenu();
    void startApp();
  });
}
