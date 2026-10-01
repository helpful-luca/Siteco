/** DE/EN copy for the menu, dialogs and splash. German uses "du", sentence case, no dashes. */
export type Lang = 'de' | 'en';

export function pickLang(preferred: readonly string[]): Lang {
  return preferred[0]?.toLowerCase().startsWith('de') ? 'de' : 'en';
}

const de = {
  appName: 'Siteco Document Chat',
  menu: {
    about: 'Über Siteco Document Chat',
    settings: 'Einstellungen …',
    stopServices: 'Dienste beenden',
    hide: 'Siteco Document Chat ausblenden',
    hideOthers: 'Andere ausblenden',
    showAll: 'Alle einblenden',
    quit: 'Siteco Document Chat beenden',
    edit: 'Bearbeiten',
    undo: 'Widerrufen',
    redo: 'Wiederholen',
    cut: 'Ausschneiden',
    copy: 'Kopieren',
    paste: 'Einsetzen',
    pasteAndMatchStyle: 'Einsetzen und Stil anpassen',
    delete: 'Löschen',
    selectAll: 'Alles auswählen',
    view: 'Ansicht',
    reload: 'Neu laden',
    actualSize: 'Originalgröße',
    zoomIn: 'Vergrößern',
    zoomOut: 'Verkleinern',
    fullScreen: 'Vollbildmodus',
    devTools: 'Entwicklerwerkzeuge',
    window: 'Fenster',
    minimize: 'Im Dock ablegen',
    zoom: 'Zoomen',
    front: 'Alle nach vorne bringen',
  },
  about: {
    credits: 'Fragen an deine Dokumente, mit Quellen. Läuft lokal in Docker.',
  },
  dialog: {
    pickProjectTitle: 'Projektordner wählen',
    pickProjectMessage: 'Wähle den Ordner von Siteco Document Chat, in dem compose.yaml liegt.',
    pickProjectButton: 'Ordner wählen',
    stopFailedTitle: 'Die Dienste konnten nicht beendet werden.',
    stopFailedDetail: 'Du kannst sie in Docker Desktop beenden.',
    ok: 'OK',
  },
  splash: {
    checking: 'Verbindung wird geprüft',
    dockerStarting: 'Docker wird gestartet',
    dockerStartingHint: 'Das kann bis zu einer Minute dauern.',
    pulling: 'Komponenten werden geladen',
    building: 'App wird eingerichtet',
    firstStartHint: 'Beim ersten Start dauert das einige Minuten.',
    starting: 'Dienste werden gestartet',
    waiting: 'App wird geladen',
    stopping: 'Dienste werden beendet',
    details: 'Details',
    retry: 'Erneut versuchen',
    chooseFolder: 'Ordner wählen',
    downloadDocker: 'Docker herunterladen',
    quit: 'Beenden',
    errors: {
      'docker-missing': {
        title: 'Docker wurde nicht gefunden',
        body: 'Siteco Document Chat läuft in Docker. Installiere Docker Desktop und versuche es dann erneut.',
      },
      'docker-not-running': {
        title: 'Docker startet nicht',
        body: 'Öffne Docker Desktop, warte, bis es bereit ist, und versuche es dann erneut.',
      },
      'project-missing': {
        title: 'Projektordner nicht gefunden',
        body: 'Wähle den Ordner von Siteco Document Chat, in dem compose.yaml liegt.',
      },
      'port-busy': {
        title: 'Port {port} ist belegt',
        body: 'Ein anderes Programm nutzt localhost:{port}. Beende es und versuche es erneut.',
      },
      'compose-failed': {
        title: 'Die Dienste konnten nicht starten',
        body: 'Docker hat einen Fehler gemeldet. Unter Details steht die letzte Ausgabe.',
      },
      'not-responding': {
        title: 'Die App antwortet nicht',
        body: 'Die Dienste laufen, aber die App meldet sich nicht unter localhost:{port}. Versuche es erneut.',
      },
      'dev-not-running': {
        title: 'Die App läuft nicht',
        body: 'Starte das Backend und next dev mit npm run dev, dann versuche es erneut.',
      },
    },
  },
};

export type Messages = typeof de;

const en: Messages = {
  appName: 'Siteco Document Chat',
  menu: {
    about: 'About Siteco Document Chat',
    settings: 'Settings…',
    stopServices: 'Stop services',
    hide: 'Hide Siteco Document Chat',
    hideOthers: 'Hide others',
    showAll: 'Show all',
    quit: 'Quit Siteco Document Chat',
    edit: 'Edit',
    undo: 'Undo',
    redo: 'Redo',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    pasteAndMatchStyle: 'Paste and match style',
    delete: 'Delete',
    selectAll: 'Select all',
    view: 'View',
    reload: 'Reload',
    actualSize: 'Actual size',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    fullScreen: 'Full screen',
    devTools: 'Developer tools',
    window: 'Window',
    minimize: 'Minimize',
    zoom: 'Zoom',
    front: 'Bring all to front',
  },
  about: {
    credits: 'Ask your documents, with sources. Runs locally in Docker.',
  },
  dialog: {
    pickProjectTitle: 'Choose the project folder',
    pickProjectMessage: 'Choose the Siteco Document Chat folder that contains compose.yaml.',
    pickProjectButton: 'Choose folder',
    stopFailedTitle: 'The services could not be stopped.',
    stopFailedDetail: 'You can stop them in Docker Desktop.',
    ok: 'OK',
  },
  splash: {
    checking: 'Checking the connection',
    dockerStarting: 'Starting Docker',
    dockerStartingHint: 'This can take up to a minute.',
    pulling: 'Downloading components',
    building: 'Setting up the app',
    firstStartHint: 'The first start takes a few minutes.',
    starting: 'Starting services',
    waiting: 'Loading the app',
    stopping: 'Stopping services',
    details: 'Details',
    retry: 'Try again',
    chooseFolder: 'Choose folder',
    downloadDocker: 'Download Docker',
    quit: 'Quit',
    errors: {
      'docker-missing': {
        title: 'Docker was not found',
        body: 'Siteco Document Chat runs in Docker. Install Docker Desktop, then try again.',
      },
      'docker-not-running': {
        title: 'Docker does not start',
        body: 'Open Docker Desktop, wait until it is ready, then try again.',
      },
      'project-missing': {
        title: 'Project folder not found',
        body: 'Choose the Siteco Document Chat folder that contains compose.yaml.',
      },
      'port-busy': {
        title: 'Port {port} is in use',
        body: 'Another program uses localhost:{port}. Quit it and try again.',
      },
      'compose-failed': {
        title: 'The services could not start',
        body: 'Docker reported an error. Details shows the last output.',
      },
      'not-responding': {
        title: 'The app does not respond',
        body: 'The services run, but the app does not answer on localhost:{port}. Try again.',
      },
      'dev-not-running': {
        title: 'The app is not running',
        body: 'Start the backend and next dev with npm run dev, then try again.',
      },
    },
  },
};

export const MESSAGES: Record<Lang, Messages> = { de, en };

export type SplashMessages = Messages['splash'];
