// @ts-check
/*
 * Splash and error page. The main process sends the startup state and the DE/EN copy through
 * the splash preload (`window.splash`); this script only renders it. No network, no storage.
 */
(() => {
  /** @typedef {{ step: string, phase?: string, error?: string, details?: string[] }} State */
  /** @type {{ init(): Promise<any>, onState(cb: (state: State) => void): void, action(name: string): Promise<void> }} */
  // @ts-ignore: provided by splash-preload.ts
  const bridge = window.splash;

  /** @param {string} id */
  const el = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

  /** @type {any} */
  let copy;
  let port = 0;

  /** @param {string} text */
  const fill = (text) => text.replaceAll('{port}', String(port));

  /** @param {State} state */
  function statusOf(state) {
    switch (state.step) {
      case 'docker-starting':
        return [copy.dockerStarting, copy.dockerStartingHint];
      case 'compose':
        if (state.phase === 'pulling') return [copy.pulling, copy.firstStartHint];
        if (state.phase === 'building') return [copy.building, copy.firstStartHint];
        return [copy.starting, ''];
      case 'waiting':
      case 'ready':
        return [copy.waiting, ''];
      case 'stopping':
        return [copy.stopping, ''];
      default:
        return [copy.checking, ''];
    }
  }

  /** @param {string} error */
  function actionsFor(error) {
    if (error === 'docker-missing') return [['download-docker', copy.downloadDocker, true], ['retry', copy.retry, false]];
    if (error === 'project-missing') return [['choose-folder', copy.chooseFolder, true], ['quit', copy.quit, false]];
    return [['retry', copy.retry, true], ['quit', copy.quit, false]];
  }

  /** @param {State} state */
  function render(state) {
    const isError = state.step === 'error';
    el('progress').hidden = isError;
    el('problem').hidden = !isError;
    document.querySelector('main')?.setAttribute('aria-busy', String(!isError));

    if (isError) {
      const text = copy.errors[state.error ?? 'compose-failed'] ?? copy.errors['compose-failed'];
      el('error-title').textContent = fill(text.title);
      el('error-body').textContent = fill(text.body);
      const actions = el('actions');
      actions.replaceChildren(
        ...actionsFor(state.error ?? '').map(([name, label, primary]) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = String(label);
          if (primary) button.className = 'primary';
          button.addEventListener('click', () => void bridge.action(String(name)));
          return button;
        }),
      );
    } else {
      const [status, hint] = statusOf(state);
      el('status').textContent = status;
      el('hint').textContent = hint;
    }

    const lines = state.details ?? [];
    el('details').hidden = lines.length === 0;
    const pre = el('details-text');
    pre.textContent = lines.join('\n');
    pre.scrollTop = pre.scrollHeight;
  }

  void bridge.init().then((init) => {
    if (!init) return;
    copy = init.messages;
    port = init.port;
    document.documentElement.lang = init.lang;
    document.title = init.appName;
    el('details-label').textContent = copy.details;
    render(init.state);
    bridge.onState(render);
  });
})();
