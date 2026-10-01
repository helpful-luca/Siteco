# Desktop app

An Electron shell for Document Chat on macOS and Windows 10 and 11. It starts the Docker stack and shows the web app in a native window. It is optional: `docker compose up --build` remains the main way to run the project.

Needs Node 22.12 or newer and Docker Desktop.

## Run from the repository root

    npm install       # root scripts, then `npm ci` in desktop/
    npm run app       # builds desktop/ and opens the window

`npm install` does not download Electron itself: the `electron` package has no install script in version 44. The binary (about 130 MB on macOS, about 160 MB on Windows) is downloaded the first time Electron runs, so on the first `npm run app`, and kept in Electron's cache (`~/Library/Caches/electron` on macOS, `%LOCALAPPDATA%\electron\Cache` on Windows).

On start the app:

1. Checks `http://localhost:3000/api/health/live` (or the configured port). If the app answers, the window opens at once.
2. Otherwise a splash finds the docker CLI by absolute path (an app opened from the Finder or Start menu has no shell PATH) and starts Docker Desktop if the engine is off.
3. Runs `docker compose --file compose.yaml up --detach --build` in the project folder. The first start builds the images and takes a few minutes; later starts take seconds.
4. Waits until the app answers, then opens the window.

When a step fails (Docker missing or not starting, port taken, compose error), the splash says what to do, offers "Try again" and shows the last output lines under "Details".

The project folder is the repository the app was built from. If it moves, the app asks once for a folder whose `compose.yaml` belongs to this project and remembers it. Settings are in `config.json` in the app's data folder (`~/Library/Application Support/Siteco Document Chat` on macOS, `%APPDATA%\Siteco Document Chat` on Windows); `port` changes the port and is passed to compose as `APP_PORT`.

Quitting leaves the containers running, so the next start is fast. On macOS, "Stop services" in the app menu runs `docker compose stop` and quits; data stays in the Docker volumes. On Windows, run `docker compose stop` in the project folder.

`npm run dev` in the root starts the backend, `next dev` and the window in development mode, where the app only waits for the dev servers and does not touch Docker.

## Platform notes

- macOS: the window is frameless and the page draws its own window buttons. Builds are ad-hoc signed only. A build made and opened on the same Mac has no quarantine flag, so Gatekeeper opens it; handing it to others would need a Developer ID signature and notarization.
- Windows: needs Windows 10 22H2 (build 19045) or Windows 11, WSL 2 and hardware virtualization. When Docker is missing or does not start, the splash checks these and names the missing piece. The installer is unsigned, so SmartScreen asks once ("More info", "Run anyway").

## Build an installer

    npm run app:build       # macOS: unsigned .app for arm64 and x64 in desktop/release
    npm run app:install     # macOS: copies the .app to ~/Applications
    npm run app:build:win   # Windows: per-user NSIS installers for x64 and arm64 in desktop/release

The Windows installer also builds on a Mac. It installs to `%LOCALAPPDATA%\Programs` without admin rights and adds Start menu and desktop shortcuts. electron-builder downloads the Electron build for each target into the same cache.

## Tests

    npm run test:desktop    # from the root: Vitest unit tests

CI runs `npm run typecheck` and `npm test` in `desktop/`. The startup flow, Docker discovery, compose arguments, window rules and Windows checks are unit tested with injected side effects, so the tests need neither Docker nor a display.

## Layout

- `src/`: main process (`main.ts` wires the modules), preloads and the startup logic
- `static/`: the splash page
- `scripts/`: `build.mjs` (compiles to `dist/`), `make-icon.mjs` (app icons for electron-builder), `install-app.mjs`
- `electron-builder.yml`: packaging, Electron fuses and the Windows installer
