const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadAppSandbox(options = {}) {
  const scriptNames = [
    'grading-engine.js',
    'guided-inspection.js',
    'app-state.js',
    'record-sync.js',
    'offline-work.js',
    'import-workflow.js',
    'analytics-history.js',
    'label-printing.js',
    'i18n.js',
    'workspace-display.js',
    'ui-feedback.js',
    'ui-rendering.js',
    'app-workflow.js',
    'remarkt-grading.js',
  ];
  const scripts = scriptNames.map(name => ({
    name,
    source: fs.readFileSync(path.join(__dirname, '..', 'assets', name), 'utf8'),
  }));
  const appElement = {
    dataset: {},
    innerHTML: '',
    addEventListener() {},
  };
  const localStore = new Map();
  Object.entries(options.localStorage || {}).forEach(([key, value]) => {
    localStore.set(key, String(value));
  });

  const sessionStore = new Map();
  Object.entries(options.sessionStorage || {}).forEach(([key, value]) => {
    sessionStore.set(key, String(value));
  });

  const sandbox = {
    console,
    window: {
      location: {
        protocol: options.protocol || 'http:',
        search: options.search || '',
        pathname: options.pathname || '/',
        hash: options.hash || '',
      },
      history: {
        replacedUrl: null,
        replaceState(state, title, url) {
          this.replacedUrl = url;
        },
      },
      performance: {
        mark() {},
        measure() {},
      },
      crypto: {
        subtle: null,
      },
    },
    document: {
      getElementById(id) {
        if (id === 'app') return appElement;
        return null;
      },
      querySelectorAll() {
        return [];
      },
    },
    localStorage: {
      getItem(key) {
        return localStore.has(key) ? localStore.get(key) : null;
      },
      setItem(key, value) {
        localStore.set(key, String(value));
      },
      removeItem(key) {
        localStore.delete(key);
      },
    },
    sessionStorage: {
      getItem(key) {
        return sessionStore.has(key) ? sessionStore.get(key) : null;
      },
      setItem(key, value) {
        sessionStore.set(key, String(value));
      },
      removeItem(key) {
        sessionStore.delete(key);
      },
    },
    alert() {},
    confirm() {
      return true;
    },
    setTimeout,
    clearTimeout,
    TextEncoder,
    DOMParser: class {},
    Image: class {
      set src(value) {
        this._src = value;
      }
      get src() {
        return this._src;
      }
    },
  };
  sandbox.__appElement = appElement;
  if (options.indexedDB) sandbox.indexedDB = options.indexedDB;
  if (options.gzip) Object.assign(sandbox, { Blob, Response, CompressionStream, DecompressionStream, Uint8Array, atob, btoa });
  sandbox.structuredClone = structuredClone;

  vm.createContext(sandbox);
  scripts.forEach(script => {
    // Each test explicitly drives startup/networking. A parallel bootstrap
    // would otherwise consume its mocked response or re-render a form later.
    const source = script.name === 'remarkt-grading.js' ? script.source.replace(/^initApp\(\);$/m, '') : script.source;
    vm.runInContext(source, sandbox, { filename: `assets/${script.name}` });
  });
  return sandbox;
}
module.exports={loadAppSandbox};
