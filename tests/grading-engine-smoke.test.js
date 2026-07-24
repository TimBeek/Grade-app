const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadAppSandbox(options = {}) {
  const scriptNames = [
    'grading-engine.js',
    'app-state.js',
    'import-workflow.js',
    'analytics-history.js',
    'label-printing.js',
    'i18n.js',
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

  vm.createContext(sandbox);
  scripts.forEach(script => {
    vm.runInContext(script.source, sandbox, { filename: `assets/${script.name}` });
  });
  return sandbox;
}

function allChoices(sandbox, letter) {
  return Object.fromEntries(
    sandbox.getGradingOnderdelen().map(component => [component.id, letter])
  );
}

// Bouwt een lichtgewicht DOM-mock voor het "Monitor handmatig invoeren" scherm
// zodat de autofill-/poort-lifecycle getest kan worden. Referenties komen op
// globalThis (__mmFields / __mmPorts) voor assertions.
function setupMonitorManualDom(app) {
  vm.runInContext(`
    globalThis.__mmFields = {};
    globalThis.__mmPorts = {};
    (function () {
      const F = globalThis.__mmFields;
      function field(id, tag) {
        F[id] = {
          id, value: '', dataset: {}, tagName: tag || 'INPUT', hidden: false, textContent: '',
          setAttribute(k, v) { if (k === 'hidden') this.hidden = true; this['attr_' + k] = v; },
          removeAttribute(k) { if (k === 'hidden') this.hidden = false; },
          scrollIntoView() {},
        };
      }
      ['mm_merk','mm_series','mm_model','mm_resolution','mm_device_preview','mm_serial','mm_sticker','mm_herkomst','monitorManualSeriesSuggestions','monitorManualModelSuggestions','monitorManualBrandSuggestions','mm_error'].forEach(id => field(id));
      field('mm_display', 'SELECT');

      const ports = ['HDMI','DisplayPort','Mini DisplayPort','DVI','VGA','USB-C','Thunderbolt'];
      const selects = [];
      ports.forEach(port => {
        const buttons = [0,1,2].map(count => {
          const b = { dataset: { port, count: String(count) }, _active: false, _pressed: 'false' };
          b.classList = { toggle(cls, on) { if (cls === 'active') b._active = !!on; } };
          b.setAttribute = (k, v) => { if (k === 'aria-pressed') b._pressed = v; };
          return b;
        });
        const select = { dataset: { monitorVideoPort: port }, value: '0' };
        const group = { querySelectorAll(sel) {
          if (sel === '[data-monitor-video-port-count-button]') return buttons;
          if (sel === '[data-monitor-video-port-count-select]') return [select];
          return [];
        } };
        select.closest = () => group;
        globalThis.__mmPorts[port] = { select, buttons, group };
        selects.push(select);
      });
      globalThis.__mmSelects = selects;

      document.getElementById = (id) => id === 'app' ? __appElement : (F[id] || null);
      document.querySelectorAll = (sel) => sel === '[data-monitor-video-port-count-select]' ? __mmSelects : [];
    })();
  `, app);
}

// Seed de (in tests lege) monitor-poortdatabase met echte entries.
function seedMonitorPortDatabase(app, entries) {
  vm.runInContext(`
    MONITOR_PORT_DATABASE.splice(0, MONITOR_PORT_DATABASE.length, ...(${JSON.stringify(entries)})
      .map(normalizeMonitorPortDatabaseEntry).filter(Boolean));
    rebuildMonitorPortDatabaseIndex();
  `, app);
}

test('alles A geeft grade A met score 0', () => {
  const app = loadAppSandbox();
  const result = app.calculateGrade(allChoices(app, 'A'), {});

  assert.equal(result.eindgrade, 'A');
  assert.equal(result.score, 0);
});

test('LCD defect trigger geeft reparatie/defect', () => {
  const app = loadAppSandbox();
  const result = app.calculateGrade(allChoices(app, 'A'), { pixel_lcd: true });

  assert.equal(result.eindgrade, 'D');
  assert.match(result.plafondReden, /LCD/i);
});

test('scharnier defect trigger geeft reparatie/defect', () => {
  const app = loadAppSandbox();
  const result = app.calculateGrade(allChoices(app, 'A'), { scharnier_kapot: true });

  assert.equal(result.eindgrade, 'D');
  assert.match(result.plafondReden, /Hinges/i);
});

test('veel kleine B-schade blijft binnen B-band', () => {
  const app = loadAppSandbox();
  const result = app.calculateGrade(allChoices(app, 'B'), {});

  assert.equal(result.eindgrade, 'B');
  assert.equal(result.score, 22);
});

test('max-C trigger geeft nooit hoger dan C', () => {
  const app = loadAppSandbox();
  const result = app.calculateGrade(allChoices(app, 'A'), { barst_lcd: true });

  assert.equal(result.eindgrade, 'C');
  assert.equal(result.score, 0);
});

test('incomplete grading wordt als ontbrekend herkend', () => {
  const app = loadAppSandbox();
  const missing = app.getMissingGradingOnderdelen({ keuzes: { lcd: 'A' } });

  assert.ok(missing.length > 0);
  assert.ok(missing.some(component => component.id === 'bovenkap'));
});

test('actieve sessie blijft bewaard na refresh en logout wist sessie', async () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    saveSessionUser(USERS.find(user => user.id === 'tim'));
    STATE.currentUser = null;
    STATE.currentScreen = 'login';
    loadSessionUser();
  `, app);

  assert.equal(vm.runInContext('STATE.currentUser.id', app), 'tim');
  assert.equal(vm.runInContext('STATE.currentScreen', app), 'home');
  // De sessie staat in sessionStorage (wist bij tab/browser sluiten), niet in localStorage.
  assert.equal(vm.runInContext('sessionStorage.getItem(DEMO_STORAGE_KEYS.session)', app), 'tim');
  assert.equal(vm.runInContext('localStorage.getItem(DEMO_STORAGE_KEYS.session)', app), null);

  await app.handleAction('logout', { dataset: {} });

  assert.equal(vm.runInContext('STATE.currentUser', app), null);
  assert.equal(vm.runInContext('STATE.currentScreen', app), 'login');
  assert.equal(vm.runInContext('sessionStorage.getItem(DEMO_STORAGE_KEYS.session)', app), null);
});

test('login reset link wist lokale users en sessie zonder gedeelde backup te verwijderen', () => {
  const app = loadAppSandbox({
    search: '?resetLogin=1',
    localStorage: {
      remarktDemoUsersV2: JSON.stringify([{ id: 'stale', naam: 'Oud', rol: 'Grader', initialen: 'O', voorkeur: 'beginner', passwordHash: 'oud' }]),
      remarktSessionUserV1: JSON.stringify({ id: 'stale' }),
      remarktDemoStateBackupV1: JSON.stringify({ updatedAt: '2026-06-19T00:00:00.000Z' }),
    },
  });

  assert.equal(vm.runInContext('localStorage.getItem(DEMO_STORAGE_KEYS.users)', app), null);
  assert.equal(vm.runInContext('localStorage.getItem(DEMO_STORAGE_KEYS.session)', app), null);
  assert.match(vm.runInContext('localStorage.getItem(DEMO_STORAGE_KEYS.sharedBackup)', app), /2026-06-19/);
  assert.equal(vm.runInContext('window.history.replacedUrl', app), '/');
});

test('taalvertaling laat productnamen en poortnamen ongemoeid', () => {
  const app = loadAppSandbox();

  vm.runInContext(`STATE.language = 'nl';`, app);

  assert.equal(app.translateCopy('HP EliteDisplay E243i'), 'HP EliteDisplay E243i');
  assert.equal(app.translateCopy('HP EliteDesk 800 G5'), 'HP EliteDesk 800 G5');
  assert.equal(app.translateCopy('DisplayPort / HDMI / VGA'), 'DisplayPort / HDMI / VGA');
  assert.equal(app.translateCopy('Mini DisplayPort / USB-C'), 'Mini DisplayPort / USB-C');
  assert.equal(app.translateCopy('Display'), 'Scherm');
});

test('gedeelde demo-state heeft lokale backup voor geschiedenis en labels', async () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    STATE.history = [{
      id: 'hist_5CG30429G0',
      sticker: '7771198',
      serial: '5CG30429G0',
      batchNummer: '50375',
      merk: 'HP',
      model: 'EliteBook 860 G9',
      grade: 'B',
      user_id: 'tim',
      user_naam: 'Tim',
      modus: 'expert',
      tijd: '10:30',
      duurSec: 42,
      result: { problems: [] }
    }];
    STATE.labelPrints = [{
      sticker: '7771198',
      merk: 'HP',
      model: 'EliteBook 860 G9',
      batchNummer: '50375',
      user_id: 'tim',
      user_naam: 'Tim',
      printedAt: '2026-05-20T10:30:00.000Z'
    }];
  `, app);

  const savedToServer = await app.saveSharedDemoState();
  assert.equal(savedToServer, false);
  assert.match(vm.runInContext('localStorage.getItem(DEMO_STORAGE_KEYS.sharedBackup)', app), /5CG30429G0/);

  vm.runInContext(`
    STATE.history = [];
    STATE.labelPrints = [];
    loadLocalDemoStateBackup();
  `, app);

  assert.equal(vm.runInContext('STATE.history.length', app), 1);
  assert.equal(vm.runInContext('STATE.history[0].serial', app), '5CG30429G0');
  assert.equal(vm.runInContext('STATE.labelPrints.length', app), 1);
});

test('lokale monitorimport blijft staan wanneer gedeelde state ouder is', async () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    window.location = { protocol: 'https:' };
    localStorage.setItem(DEMO_STORAGE_KEYS.sharedBackup, JSON.stringify({
      version: 1,
      users: [],
      batches: [],
      monitorBatches: [{
        id: 'monitor_batch_local',
        nummer: 'LOCAL',
        leverancier: 'Monitor import',
        geimporteerd: '20-5-2026',
        monitors: [{
          sticker: 'MON-LOCAL-1',
          deviceName: 'Dell P2422H Monitor',
          merk: 'Dell',
          model: 'P2422H',
          videoInputs: 'HDMI / DisplayPort',
          batchId: 'monitor_batch_local',
          batchNummer: 'LOCAL'
        }]
      }],
      history: [],
      labelPrints: [],
      monitorLabelPrints: [],
      auditLogs: [],
      updatedAt: '2026-05-20T09:00:00.000Z'
    }));
  `, app);
  app.fetch = async () => ({
    ok: true,
    json: async () => ({
      version: 1,
      users: [],
      batches: [],
      monitorBatches: [],
      history: [],
      labelPrints: [],
      monitorLabelPrints: [],
      auditLogs: [],
      updatedAt: '2026-05-20T08:00:00.000Z',
    }),
  });

  assert.equal(await app.loadSharedDemoState(), true);
  assert.equal(vm.runInContext('MONITOR_BATCHES.length', app), 1);
  assert.equal(vm.runInContext('MONITOR_BATCHES[0].monitors[0].sticker', app), 'MON-LOCAL-1');
});

test('lokale monitorimport blijft staan wanneer gedeelde state nieuwer maar leeg is', async () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    window.location = { protocol: 'https:' };
    localStorage.setItem(DEMO_STORAGE_KEYS.sharedBackup, JSON.stringify({
      version: 1,
      users: [],
      batches: [],
      monitorBatches: [{
        id: 'monitor_batch_local_newer_remote',
        nummer: 'LOCAL2',
        leverancier: 'Monitor import',
        geimporteerd: '20-5-2026',
        monitors: [{
          sticker: 'MON-LOCAL-2',
          deviceName: 'HP E243i',
          merk: 'HP',
          model: 'E243i',
          videoInputs: 'DisplayPort / HDMI',
          batchId: 'monitor_batch_local_newer_remote',
          batchNummer: 'LOCAL2'
        }]
      }],
      history: [],
      labelPrints: [],
      monitorLabelPrints: [],
      auditLogs: [],
      restoreDeletedMonitorBatchIds: ['monitor_batch_local_newer_remote'],
      restoreDeletedMonitorStickers: ['MON-LOCAL-2'],
      updatedAt: '2026-05-20T08:00:00.000Z'
    }));
  `, app);
  app.fetch = async () => ({
    ok: true,
    json: async () => ({
      version: 1,
      users: [],
      batches: [],
      monitorBatches: [],
      history: [{ id: 'remote_history_marker' }],
      labelPrints: [],
      monitorLabelPrints: [],
      auditLogs: [],
      deletedMonitorBatchIds: ['monitor_batch_local_newer_remote'],
      updatedAt: '2026-05-20T09:00:00.000Z',
    }),
  });

  assert.equal(await app.loadSharedDemoState(), true);
  assert.equal(vm.runInContext("Boolean(getMonitorBySticker('MON-LOCAL-2'))", app), true);
  assert.equal(vm.runInContext('STATE.history[0].id', app), 'remote_history_marker');
  assert.equal(vm.runInContext("STATE.deletedMonitorBatchIds.includes('monitor_batch_local_newer_remote')", app), false);
  assert.match(vm.runInContext('localStorage.getItem(DEMO_STORAGE_KEYS.sharedBackup)', app), /MON-LOCAL-2/);
});

test('verwijderde laptop komt niet terug uit een oude lokale batchbackup', () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    const staleLocal = {
      version: 1,
      users: [],
      batches: [{
        id: 'batch_stale_laptop',
        nummer: 'STALE',
        leverancier: 'Supplier import',
        geimporteerd: '18-6-2026',
        laptops: [{
          sticker: 'STALE-1',
          merk: 'HP',
          model: 'EliteBook',
          batchId: 'batch_stale_laptop',
          batchNummer: 'STALE'
        }]
      }],
      monitorBatches: [],
      history: [],
      labelPrints: [],
      monitorLabelPrints: [],
      auditLogs: [],
      updatedAt: '2026-06-18T12:00:00.000Z'
    };
    const remoteWithDeletion = {
      version: 1,
      users: [],
      batches: [],
      monitorBatches: [],
      history: [],
      labelPrints: [],
      monitorLabelPrints: [],
      auditLogs: [],
      deletedLaptopStickers: ['STALE-1'],
      updatedAt: '2026-06-18T11:00:00.000Z'
    };
    const merged = chooseSharedDemoState(remoteWithDeletion, staleLocal);
    applySharedDemoState(merged);
  `, app);

  assert.equal(vm.runInContext("STATE.deletedLaptopStickers.includes('STALE-1')", app), true);
  assert.equal(vm.runInContext("Boolean(getLaptopBySticker('STALE-1'))", app), false);
});

test('dashboard scheidt werkstroom, support en analyse', () => {
  const app = loadAppSandbox();
  vm.runInContext(`
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    STATE.currentScreen = 'home';
    STATE.homeTab = 'workflow';
    render();
  `, app);

  assert.match(app.__appElement.innerHTML, /Grade Device/);
  assert.match(app.__appElement.innerHTML, /Laptop Workflow/);
  assert.match(app.__appElement.innerHTML, /Monitor Workflow/);
  assert.match(app.__appElement.innerHTML, /Grade Device from list/);
  assert.match(app.__appElement.innerHTML, /action-info-btn/);
  assert.match(app.__appElement.innerHTML, /Label Scan/);
  assert.match(app.__appElement.innerHTML, /Print a specs label with a blank grade line/);
  assert.match(app.__appElement.innerHTML, /grade-work/);
  assert.match(app.__appElement.innerHTML, /sticker-work/);
  assert.match(app.__appElement.innerHTML, /Test Grading/);
  assert.match(app.__appElement.innerHTML, /Delete batch/);
  assert.doesNotMatch(app.__appElement.innerHTML, /Volgende open laptop/);
  assert.doesNotMatch(app.__appElement.innerHTML, /Batch Import/);

  vm.runInContext(`STATE.homeTab = 'support'; render();`, app);
  assert.match(app.__appElement.innerHTML, /Batch Import/);
  assert.match(app.__appElement.innerHTML, /User Management/);
  assert.doesNotMatch(app.__appElement.innerHTML, /Grade Device/);

  vm.runInContext(`
    STATE.monitorLabelPrints = [{
      sticker: 'MON-DASH-1',
      deviceName: 'Dell P2422H Monitor',
      grade: 'B',
      user_id: 'tim',
      user_naam: 'Tim',
      printedAt: '2026-05-20T12:00:00.000Z'
    }];
    rebuildMonitorLabelPrintIndexes();
    STATE.homeTab = 'monitor';
    render();
  `, app);
  assert.match(app.__appElement.innerHTML, /Label Scan/);
  assert.match(app.__appElement.innerHTML, /Separated monitor intake with scan, grade choice and label print/);
  assert.match(app.__appElement.innerHTML, /Latest Result/);
  assert.match(app.__appElement.innerHTML, /B · Dell P2422H Monitor/);
  assert.match(app.__appElement.innerHTML, /Grade Mix/);
  assert.doesNotMatch(app.__appElement.innerHTML, /Label Content/);
  assert.doesNotMatch(app.__appElement.innerHTML, /Grade Moment/);
  assert.doesNotMatch(app.__appElement.innerHTML, /Grade Device/);

  vm.runInContext(`STATE.currentScreen = 'analytics'; render();`, app);
  assert.match(app.__appElement.innerHTML, /Management dashboard/);
  assert.match(app.__appElement.innerHTML, /Open Full History/);
});

test('analytics dashboard toont KPI filters en operationele BI-panelen', () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    STATE.currentScreen = 'analytics';
    STATE.history = [{
      sticker: 'DASH-1',
      batchNummer: 'BI-1',
      merk: 'Dell',
      model: 'Latitude 5420',
      serial: 'SN-DASH-1',
      battery: '86%',
      grade: 'A',
      score: 0,
      duurSec: 42,
      user_id: 'tim',
      user_naam: 'Tim',
      leverancier_class: 'Class B',
      result: { problems: [], detailRows: [] }
    }, {
      sticker: 'DASH-2',
      batchNummer: 'BI-1',
      merk: 'HP',
      model: 'EliteBook 840',
      serial: 'SN-DASH-2',
      battery: '71%',
      grade: 'D',
      score: 80,
      duurSec: 66,
      user_id: 'tim',
      user_naam: 'Tim',
      leverancier_class: 'Class C',
      result: {
        problems: ['Pixel line'],
        detailRows: [{ naam: 'LCD', keuze: 'X', punten: 80 }]
      }
    }];
    STATE.labelPrints = [{
      sticker: 'DASH-LABEL',
      merk: 'Lenovo',
      model: 'ThinkPad T14',
      batchNummer: 'BI-2',
      user_id: 'tim',
      user_naam: 'Tim',
      printedAt: new Date().toISOString()
    }];
    STATE.monitorLabelPrints = [{
      sticker: 'MON-BI-1',
      merk: 'Dell',
      model: 'P2422H',
      grade: 'B',
      videoInputs: 'HDMI / DisplayPort',
      user_id: 'tim',
      user_naam: 'Tim',
      printedAt: new Date().toISOString()
    }];
    rebuildHistoryIndexes();
    rebuildLabelPrintIndexes();
    rebuildMonitorLabelPrintIndexes();
    render();
  `, app);

  // Standaard = Overzicht-tab: sub-tabs + de nieuwe favourability-charts.
  assert.match(app.__appElement.innerHTML, /analytics-pro-screen/);
  assert.match(app.__appElement.innerHTML, /analytics-kpi-grid/);
  assert.match(app.__appElement.innerHTML, /data-analytics-filter="dateRange"/);
  assert.match(app.__appElement.innerHTML, /analytics-subtabs/);
  assert.match(app.__appElement.innerHTML, /data-analytics-tab="repair"/);
  assert.match(app.__appElement.innerHTML, /Grade uplift/);
  assert.match(app.__appElement.innerHTML, /Yield per batch/);
  assert.match(app.__appElement.innerHTML, /grade-stacked/);
  // "Recent activity" en de oude losse panelen zijn bewust weg.
  assert.doesNotMatch(app.__appElement.innerHTML, /Recent activity/);
  assert.doesNotMatch(app.__appElement.innerHTML, /Repair bottlenecks/);
  assert.doesNotMatch(app.__appElement.innerHTML, /Productivity heatmap/);

  // Batchkwaliteit-tab: leveranciersvergelijking + favourability-index.
  vm.runInContext("setAnalyticsTab('batch'); render();", app);
  assert.match(app.__appElement.innerHTML, /Supplier vs ReMarkt/);
  assert.match(app.__appElement.innerHTML, /supplier-scorecard-table/);
  assert.match(app.__appElement.innerHTML, /score-bar/);

  // Doorloop-tab: output per dag + medewerkerprestatie.
  vm.runInContext("setAnalyticsTab('throughput'); render();", app);
  assert.match(app.__appElement.innerHTML, /area-chart/);
  assert.match(app.__appElement.innerHTML, /chart-legend-item/);
  assert.match(app.__appElement.innerHTML, /Batch completion/);

  // Reparatiebakken-tab: route-split, bakken en Pareto.
  vm.runInContext("setAnalyticsTab('repair'); render();", app);
  assert.match(app.__appElement.innerHTML, /repair-route/);
  assert.match(app.__appElement.innerHTML, /repair-bins/);
  assert.match(app.__appElement.innerHTML, /analytics-pareto/);

  vm.runInContext(`setAnalyticsFilter('brand', 'Dell');`, app);
  assert.equal(vm.runInContext(`getAnalyticsFilters().brand`, app), 'Dell');
});

test('historie zoekt op serienummer en toont leverancier tegenover ReMarkt', () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    STATE.currentScreen = 'history';
    STATE.history = [{
      id: 'hist_serial_lookup',
      sticker: '8460024',
      serial: '5CD3258381',
      batchNummer: '50375',
      merk: 'HP',
      model: 'EliteBook 645 G9',
      processor: 'Ryzen 5',
      ram: '8GB',
      ssd: '256GB',
      display: '14"',
      battery: '95%',
      leverancier_class: 'Class B',
      leverancier_meldingen: 'Lichte krassen op scherm',
      grade: 'A',
      score: 0,
      user_id: 'tim',
      user_naam: 'Tim',
      modus: 'expert',
      tijd: '11:15',
      duurSec: 38,
      result: { problems: [], detailRows: [] }
    }];
    rebuildHistoryIndexes();
    STATE.historySearch = '5CD3258381';
    render();
  `, app);

  assert.match(app.__appElement.innerHTML, /serial number/);
  assert.match(app.__appElement.innerHTML, /SN 5CD3258381/);
  assert.match(app.__appElement.innerHTML, /Supplier B -&gt; ReMarkt A|Supplier B -> ReMarkt A/);

  vm.runInContext(`
    STATE.historyOpenId = getHistoryItemId(STATE.history[0], 0);
    render();
  `, app);

  assert.match(app.__appElement.innerHTML, /Serial Number:<\/strong> 5CD3258381/);
  assert.match(app.__appElement.innerHTML, /Supplier vs ReMarkt:<\/strong> B -&gt; A|Supplier vs ReMarkt:<\/strong> B -> A/);
  assert.match(app.__appElement.innerHTML, /Supplier notes:<\/strong> Lichte krassen op scherm/);
});

test('stickeraar ziet alleen scan-en-print werkstroom', async () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    STATE.currentUser = { id: 'labelaar', naam: 'Labelaar', rol: 'Stickeraar', initialen: 'L', voorkeur: 'label' };
    STATE.currentScreen = 'home';
    STATE.homeTab = 'workflow';
    render();
  `, app);

  assert.match(app.__appElement.innerHTML, /Labeling/);
  assert.match(app.__appElement.innerHTML, /Scan &amp; Print|Scan & Print/);
  assert.match(app.__appElement.innerHTML, /repair labels print automatically/);
  assert.doesNotMatch(app.__appElement.innerHTML, /Test Grading/);
  assert.doesNotMatch(app.__appElement.innerHTML, /Manual Entry/);
  assert.doesNotMatch(app.__appElement.innerHTML, /Insights/);
  assert.doesNotMatch(app.__appElement.innerHTML, /Batch Import/);
  assert.doesNotMatch(app.__appElement.innerHTML, /User Management/);
  assert.doesNotMatch(app.__appElement.innerHTML, /Grade Device/);

  await app.handleAction('sticker_scan', {});
  assert.equal(vm.runInContext('STATE.currentScreen', app), 'sticker_scan');
  assert.match(app.__appElement.innerHTML, /Label Scan/);
  assert.doesNotMatch(app.__appElement.innerHTML, /Specs-label zonder grade printen/);

  await app.handleAction('start_expert', {});
  assert.equal(vm.runInContext('STATE.currentGrading', app), null);
  assert.match(vm.runInContext('STATE.appMessage && STATE.appMessage.text', app), /Labeler-only|without grading/);

  const rows = vm.runInContext(`
    getLabelRows(getLaptopBySticker('7771198'), { eindgrade: '', problems: [] }, 'specs', { hideGrade: true })
  `, app);
  assert.match(rows[2], /^Grade \.\.\.\.\.\. \/ Touch (Ja|Nee)$/);
});

test('grader ziet alleen begeleide modus en kan expertmodus niet starten', async () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    STATE.currentUser = USERS.find(user => user.id === 'thibault');
    STATE.currentLaptop = getLaptopBySticker('7771198');
    STATE.currentScreen = 'laptop_info';
    render();
  `, app);

  assert.equal(vm.runInContext('STATE.currentUser.rol', app), 'Grader');
  assert.equal(vm.runInContext('STATE.currentUser.voorkeur', app), 'beginner');
  assert.match(app.__appElement.innerHTML, /Guided Mode/);
  assert.doesNotMatch(app.__appElement.innerHTML, /Expert Mode/);
  assert.doesNotMatch(app.__appElement.innerHTML, /data-action="start_expert"/);

  await app.handleAction('start_expert', { dataset: {} });
  assert.equal(vm.runInContext('STATE.currentGrading', app), null);
  assert.match(vm.runInContext('STATE.appMessage && STATE.appMessage.text', app), /Expert Mode is only available/);

  vm.runInContext(`STATE.appMessage = null; STATE.currentScreen = 'test_start'; render();`, app);
  assert.match(app.__appElement.innerHTML, /Guided Mode/);
  assert.doesNotMatch(app.__appElement.innerHTML, /data-action="start_test_expert"/);
});

test('expert-grader kan expertmodus gebruiken zonder managerrechten', async () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    STATE.currentUser = { id: 'danny', naam: 'Danny', rol: 'Grader', initialen: 'D', voorkeur: 'expert', passwordHash: 'x' };
    STATE.currentLaptop = getLaptopBySticker('7771198');
    STATE.currentScreen = 'laptop_info';
    render();
  `, app);

  assert.equal(vm.runInContext('isAdminUser()', app), false);
  assert.equal(vm.runInContext('canUseExpertMode()', app), true);
  assert.match(app.__appElement.innerHTML, /Guided Mode/);
  assert.match(app.__appElement.innerHTML, /data-action="start_expert"/);

  await app.handleAction('start_expert', { dataset: {} });
  assert.equal(vm.runInContext('STATE.currentGrading.modus', app), 'expert');
  assert.equal(vm.runInContext('STATE.currentScreen', app), 'grading_expert');
});

test('live gebruikerssync werkt actieve gebruiker bij zonder volledige refresh', () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    USERS.push({ id: 'danny', naam: 'Danny', rol: 'Grader', initialen: 'D', voorkeur: 'beginner', passwordHash: 'x' });
    STATE.currentUser = USERS.find(user => user.id === 'danny');
    STATE.currentScreen = 'home';
  `, app);

  const changed = app.applySharedUsers({
    users: [
      { id: 'danny', naam: 'Danny', rol: 'Grader', initialen: 'D', voorkeur: 'expert', passwordHash: 'x' },
    ],
  });

  assert.equal(changed, true);
  assert.equal(vm.runInContext('STATE.currentUser.id', app), 'danny');
  assert.equal(vm.runInContext('STATE.currentUser.voorkeur', app), 'expert');
  assert.equal(vm.runInContext('canUseExpertMode()', app), true);
  assert.match(vm.runInContext('localStorage.getItem(DEMO_STORAGE_KEYS.users)', app), /expert/);
});

test('lokale demo-backup bewaart gebruikers ook bij gewone state-save', () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    USERS.find(user => user.id === 'thibault').passwordHash = 'custom-thibault-hash';
    saveLocalDemoStateBackup(getSharedDemoSnapshot());
  `, app);

  const backup = JSON.parse(vm.runInContext(`localStorage.getItem(DEMO_STORAGE_KEYS.sharedBackup)`, app));
  const thibault = backup.users.find(user => user.id === 'thibault');
  assert.equal(backup.userSync, 'user-management');
  assert.equal(thibault.passwordHash, 'custom-thibault-hash');
});

test('login haalt eerst live gebruikers op zodat wachtwoorden niet terugvallen', async () => {
  const app = loadAppSandbox();
  const remoteHash = await app.hashDemoPassword('nieuw-thibault');

  vm.runInContext(`
    window.location = { protocol: 'https:' };
    fetch = async function() {
      return {
        ok: true,
        async json() {
          return {
            users: [
              { id: 'thibault', naam: 'Thibault', rol: 'Manager', initialen: 'TH', voorkeur: 'expert', passwordHash: '${remoteHash}' },
            ],
          };
        },
      };
    };
    const loginElements = {
      loginUser: { value: 'thibault' },
      loginPassword: { value: 'nieuw-thibault' },
    };
    document.getElementById = function(id) {
      if (id === 'app') return __appElement;
      return loginElements[id] || null;
    };
  `, app);

  await app.loginWithPassword();

  assert.equal(vm.runInContext('STATE.currentUser && STATE.currentUser.id', app), 'thibault');
  assert.equal(vm.runInContext('STATE.currentUser && STATE.currentUser.rol', app), 'Manager');
  assert.equal(vm.runInContext('STATE.currentScreen', app), 'home');
});

test('nieuwe gebruiker krijgt startwachtwoord en moet dit bij eerste login wijzigen', async () => {
  const app = loadAppSandbox();
  const startPassword = vm.runInContext('FIRST_LOGIN_PASSWORD', app);
  const startHash = await app.hashDemoPassword(startPassword);

  vm.runInContext(`
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    STATE.currentScreen = 'accounts';
    const newUserElements = {
      newUserName: { value: 'Nieuwe Grader' },
      newUserId: { value: 'Nieuwe Grader' },
      newUserRole: { value: 'Grader' },
      newUserMode: { value: 'beginner' },
    };
    document.getElementById = function(id) {
      if (id === 'app') return __appElement;
      return newUserElements[id] || null;
    };
  `, app);

  await app.createUserFromForm();

  const created = vm.runInContext(`USERS.find(user => user.id === 'nieuwegrader')`, app);
  assert.equal(created.naam, 'Nieuwe Grader');
  assert.equal(created.passwordHash, startHash);
  assert.equal(created.mustChangePassword, true);
  assert.match(vm.runInContext('STATE.appMessage && STATE.appMessage.text', app), /Start password/);
  assert.match(vm.runInContext('localStorage.getItem(DEMO_STORAGE_KEYS.users)', app), /mustChangePassword/);
});

test('eerste login verplicht eigen wachtwoord en bewaart dit in gebruikersbeheer', async () => {
  const app = loadAppSandbox();
  const startPassword = vm.runInContext('FIRST_LOGIN_PASSWORD', app);
  const startHash = await app.hashDemoPassword(startPassword);

  vm.runInContext(`
    USERS.push({
      id: 'firstlogin',
      naam: 'First Login',
      rol: 'Grader',
      initialen: 'FL',
      voorkeur: 'beginner',
      passwordHash: '${startHash}',
      mustChangePassword: true,
      passwordUpdatedAt: '',
    });
    const passwordElements = {
      loginUser: { value: 'firstlogin' },
      loginPassword: { value: '${startPassword}' },
      newOwnPassword: { value: 'eigen-wachtwoord-2026' },
      confirmOwnPassword: { value: 'eigen-wachtwoord-2026' },
    };
    document.getElementById = function(id) {
      if (id === 'app') return __appElement;
      return passwordElements[id] || null;
    };
  `, app);

  await app.loginWithPassword();

  assert.equal(vm.runInContext('STATE.currentUser && STATE.currentUser.id', app), 'firstlogin');
  assert.equal(vm.runInContext('STATE.currentScreen', app), 'password_change');

  await app.handleAction('home', { dataset: {} });
  assert.equal(vm.runInContext('STATE.currentScreen', app), 'password_change');

  await app.changeOwnPassword();

  const updated = vm.runInContext(`USERS.find(user => user.id === 'firstlogin')`, app);
  assert.equal(updated.mustChangePassword, false);
  assert.notEqual(updated.passwordHash, startHash);
  assert.match(updated.passwordUpdatedAt, /^20/);
  assert.equal(vm.runInContext('STATE.currentScreen', app), 'home');
  assert.match(vm.runInContext('localStorage.getItem(DEMO_STORAGE_KEYS.users)', app), /eigen wachtwoord actief|mustChangePassword/);
});

test('admin kan gebruiker resetten naar startwachtwoord met verplichte wijziging', async () => {
  const app = loadAppSandbox();
  const startPassword = vm.runInContext('FIRST_LOGIN_PASSWORD', app);
  const startHash = await app.hashDemoPassword(startPassword);
  const customHash = await app.hashDemoPassword('bestaand-wachtwoord');

  vm.runInContext(`
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    USERS.push({
      id: 'resetcase',
      naam: 'Reset Case',
      rol: 'Grader',
      initialen: 'RC',
      voorkeur: 'beginner',
      passwordHash: '${customHash}',
      mustChangePassword: false,
      passwordUpdatedAt: '2026-06-01T10:00:00.000Z',
    });
  `, app);

  await app.resetUserPassword('resetcase');

  const resetUser = vm.runInContext(`USERS.find(user => user.id === 'resetcase')`, app);
  assert.equal(resetUser.passwordHash, startHash);
  assert.equal(resetUser.mustChangePassword, true);
  assert.equal(resetUser.passwordUpdatedAt, '');
  assert.match(vm.runInContext('STATE.appMessage && STATE.appMessage.text', app), /Start password/);
});

test('scan-en-print markeert label klaar en sluit digitale grading af', async () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    STATE.currentUser = { id: 'labelaar', naam: 'Labelaar', rol: 'Stickeraar', initialen: 'L', voorkeur: 'label' };
    STATE.currentScreen = 'sticker_scan';
    globalThis.printCalls = [];
    printLabelFor = async function(laptop, result, type, options) {
      printCalls.push({ sticker: laptop.sticker, type, hideGrade: Boolean(options && options.hideGrade) });
      return true;
    };
  `, app);

  await app.scanAndPrintStickerLabel('7771198');

  const calls = vm.runInContext('printCalls', app);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].sticker, '7771198');
  assert.equal(calls[0].type, 'specs');
  assert.equal(calls[0].hideGrade, true);
  assert.equal(vm.runInContext("isLaptopLabelPrinted('7771198')", app), true);
  assert.equal(vm.runInContext("getStickerOpenLaptops().some(laptop => laptop.sticker === '7771198')", app), false);
  assert.equal(vm.runInContext("getOpenLaptops().some(laptop => laptop.sticker === '7771198')", app), false);
  assert.match(vm.runInContext('STATE.appMessage && STATE.appMessage.text', app), /blank grade line|Device completed/);
  vm.runInContext("selectLaptop('7771198')", app);
  assert.equal(vm.runInContext('STATE.currentScreen', app), 'sticker_scan');
  assert.match(vm.runInContext('STATE.appMessage && STATE.appMessage.text', app), /complete in the digital workflow/);

  vm.runInContext(`STATE.history = [{ sticker: '8460024' }]; rebuildHistoryIndexes();`, app);
  assert.equal(vm.runInContext("getStickerOpenLaptops().some(laptop => laptop.sticker === '8460024')", app), false);
});

test('scan-en-print herkent voorloopnullen en print reparatie-label indien nodig', async () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    STATE.currentUser = { id: 'labelaar', naam: 'Labelaar', rol: 'Stickeraar', initialen: 'L', voorkeur: 'label' };
    STATE.currentScreen = 'sticker_scan';
    globalThis.printCalls = [];
    window.open = function() {
      return {
        closed: false,
        document: { write() {}, close() {} },
        close() { this.closed = true; },
        focus() {},
        print() {},
      };
    };
    printLabelFor = async function(laptop, result, type, options) {
      printCalls.push({ sticker: laptop.sticker, type, hideGrade: Boolean(options && options.hideGrade) });
      return true;
    };
  `, app);

  assert.equal(vm.runInContext("getLaptopBySticker('007386699').sticker", app), '7386699');

  await app.scanAndPrintStickerLabel('007386699');

  const calls = vm.runInContext('printCalls', app);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].sticker, '7386699');
  assert.equal(calls[0].type, 'specs');
  assert.equal(calls[0].hideGrade, true);
  assert.equal(calls[1].type, 'problems');
  assert.equal(calls[1].hideGrade, false);
  assert.equal(vm.runInContext("isLaptopLabelPrinted('007386699')", app), true);
  assert.equal(vm.runInContext("getOpenLaptops().some(laptop => laptop.sticker === '7386699')", app), false);
  assert.match(vm.runInContext('STATE.appMessage && STATE.appMessage.text', app), /repair label printed|Device completed/);
});

test('scan-en-print met DYMO-direct opent geen Chrome printvenster', async () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    const openedPrintWindows = [];
    const printCalls = [];
    window.open = function(url, name) {
      openedPrintWindows.push({ url, name });
      return {
        closed: false,
        document: { write() {}, close() {} },
        close() { this.closed = true; },
        focus() {},
        print() {},
      };
    };
    printRowsWithDymo = async function(rows, type, grade) {
      printCalls.push({ rows: rows.slice(), type, grade });
      return { printerName: 'DYMO LabelWriter 450' };
    };
    window.__openedPrintWindows = openedPrintWindows;
    window.__printCalls = printCalls;
    STATE.currentUser = { id: 'labelaar', naam: 'Labelaar', rol: 'Stickeraar', initialen: 'L', voorkeur: 'label' };
    STATE.currentScreen = 'sticker_scan';
  `, app);

  await app.scanAndPrintStickerLabel('7771198');

  assert.equal(vm.runInContext('window.__openedPrintWindows.length', app), 0);
  assert.equal(vm.runInContext('window.__printCalls.length', app), 1);
  assert.equal(vm.runInContext('window.__printCalls[0].type', app), 'specs');
  assert.equal(vm.runInContext("isLaptopLabelPrinted('7771198')", app), true);
});

test('laptoplabel toont accuwaarde als percentage', () => {
  const app = loadAppSandbox();
  const rows = app.getLabelRows({
    merk: 'HP',
    model: 'EliteBook 840',
    processor: 'i5',
    ram: '16GB',
    ssd: '512GB',
    display: '14"',
    battery: '0.73',
  }, { eindgrade: 'B', problems: [] }, 'specs');

  assert.match(rows[3], /Accu 73%/);
});

test('afgeronde laptop kan via dezelfde scan opnieuw worden geprint', async () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    const calls = [];
    const confirmCalls = [];
    printLabelFor = async function(laptop, result, type, options) {
      calls.push({ sticker: laptop.sticker, grade: result.eindgrade, type, hideGrade: Boolean(options && options.hideGrade) });
      return true;
    };
    confirm = function(message) {
      confirmCalls.push(message);
      return true;
    };
    window.__printCalls = calls;
    window.__confirmCalls = confirmCalls;
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    STATE.history = [{
      sticker: '8460024',
      merk: 'HP',
      model: 'EliteBook 645 G9',
      grade: 'A',
      score: 0,
      result: { eindgrade: 'A', score: 0, problems: [] },
      user_id: 'tim',
      user_naam: 'Tim',
      batchNummer: '50375'
    }];
    rebuildHistoryIndexes();
  `, app);

  await app.selectLaptop('8460024');

  assert.equal(vm.runInContext('window.__confirmCalls.length', app), 1);
  assert.match(vm.runInContext('window.__confirmCalls[0]', app), /already been scanned and graded/);
  assert.match(vm.runInContext('window.__confirmCalls[0]', app), /print the label again/);
  assert.equal(vm.runInContext('window.__printCalls.length', app), 1);
  assert.equal(vm.runInContext('window.__printCalls[0].type', app), 'specs');
  assert.equal(vm.runInContext('STATE.currentScreen', app), 'scan');
  assert.match(vm.runInContext('STATE.appMessage && STATE.appMessage.text', app), /reprinted/);
});

test('afgeronde laptop print niet opnieuw als bevestiging wordt geweigerd', async () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    const calls = [];
    const confirmCalls = [];
    printLabelFor = async function(laptop, result, type, options) {
      calls.push({ sticker: laptop.sticker, type });
      return true;
    };
    confirm = function(message) {
      confirmCalls.push(message);
      return false;
    };
    window.__printCalls = calls;
    window.__confirmCalls = confirmCalls;
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    STATE.history = [{
      sticker: '8460024',
      merk: 'HP',
      model: 'EliteBook 645 G9',
      grade: 'A',
      score: 0,
      result: { eindgrade: 'A', score: 0, problems: [] },
      user_id: 'tim',
      user_naam: 'Tim',
      batchNummer: '50375'
    }];
    rebuildHistoryIndexes();
  `, app);

  await app.selectLaptop('8460024');

  assert.equal(vm.runInContext('window.__confirmCalls.length', app), 1);
  assert.equal(vm.runInContext('window.__printCalls.length', app), 0);
  assert.equal(vm.runInContext('STATE.currentScreen', app), 'scan');
  assert.match(vm.runInContext('STATE.appMessage && STATE.appMessage.text', app), /cancelled/);
});

test('kleine leveranciersmelding verschijnt inline bij het passende grading-onderdeel', async () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    BATCHES[0].laptops.push({
      sticker: '5460898',
      merk: 'HP',
      model: 'EliteBook 840 G8',
      processor: 'i5-1145G7',
      ram: '16GB',
      ssd: '512GB',
      display: '14"',
      serial: '5CG1276L4P',
      leverancier_class: 'Class C',
      meldingen: 'Used touchpad',
      batchId: BATCHES[0].id,
      batchNummer: BATCHES[0].nummer
    });
    rebuildLaptopIndex();
  `, app);

  await app.selectLaptop('5460898');
  assert.doesNotMatch(app.__appElement.innerHTML, /supplier-notice-modal/);

  vm.runInContext(`startGrading('beginner'); render();`, app);
  assert.doesNotMatch(app.__appElement.innerHTML, /supplier-notice-modal/);

  const touchpadIndex = vm.runInContext(`getGradingOnderdelen().findIndex(component => component.id === 'touchpad')`, app);
  for (let index = 0; index < touchpadIndex; index++) {
    await app.handleAction('next_q', { dataset: {} });
  }

  assert.doesNotMatch(app.__appElement.innerHTML, /supplier-notice-modal/);
  assert.match(app.__appElement.innerHTML, /component-notice-inline/);
  assert.match(app.__appElement.innerHTML, /Touchpad.*Used touchpad/s);
});

test('belangrijke schermmelding verschijnt pas als popup bij LCD grading', async () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    BATCHES[0].laptops.push({
      sticker: '5460899',
      merk: 'HP',
      model: 'EliteBook 840 G8',
      processor: 'i5-1145G7',
      ram: '16GB',
      ssd: '512GB',
      display: '14"',
      serial: '5CG1276L5P',
      leverancier_class: 'Class C',
      meldingen: 'Dent on corner(s),Major wear mark/scratch on screen,Used case,Used touchpad',
      batchId: BATCHES[0].id,
      batchNummer: BATCHES[0].nummer
    });
    rebuildLaptopIndex();
  `, app);

  await app.selectLaptop('5460899');
  assert.doesNotMatch(app.__appElement.innerHTML, /supplier-notice-modal/);

  vm.runInContext(`startGrading('beginner'); render();`, app);
  assert.doesNotMatch(app.__appElement.innerHTML, /supplier-notice-modal/);

  const lcdIndex = vm.runInContext(`getGradingOnderdelen().findIndex(component => component.id === 'lcd')`, app);
  for (let index = 0; index < lcdIndex; index++) {
    await app.handleAction('next_q', { dataset: {} });
  }

  assert.match(app.__appElement.innerHTML, /supplier-notice-modal/);
  assert.match(app.__appElement.innerHTML, /LCD &amp; Glass.*Major wear mark\/scratch on screen/s);

  await app.handleAction('confirm_supplier_notice', { dataset: {} });
  assert.equal(vm.runInContext('STATE.supplierNotice', app), null);
});

test('expertmodus toont zware leveranciersmelding als popup en lichte melding inline', async () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    BATCHES[0].laptops.push({
      sticker: '5460900',
      merk: 'HP',
      model: 'EliteBook 840 G8',
      processor: 'i5-1145G7',
      ram: '16GB',
      ssd: '512GB',
      display: '14"',
      serial: '5CG1276L6P',
      leverancier_class: 'Class C',
      meldingen: 'Major wear mark/scratch on screen,Used touchpad',
      batchId: BATCHES[0].id,
      batchNummer: BATCHES[0].nummer
    });
    rebuildLaptopIndex();
  `, app);

  await app.selectLaptop('5460900');
  vm.runInContext(`startGrading('expert'); render();`, app);

  assert.match(app.__appElement.innerHTML, /supplier-notice-modal/);
  assert.match(app.__appElement.innerHTML, /LCD &amp; Glass = Major wear mark\/scratch on screen/);
  assert.match(app.__appElement.innerHTML, /expert-supplier-inline/);
  assert.match(app.__appElement.innerHTML, /Touchpad = Used touchpad/);

  await app.handleAction('confirm_supplier_notice', { dataset: {} });
  assert.equal(vm.runInContext('STATE.supplierNotice', app), null);
  assert.doesNotMatch(app.__appElement.innerHTML, /supplier-notice-modal/);
  assert.match(app.__appElement.innerHTML, /Touchpad = Used touchpad/);
});

test('Class D waarschuwing toont reden uit leverancierslijst', async () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    BATCHES[0].laptops.push({
      sticker: '5460901',
      merk: 'HP',
      model: 'EliteBook 840 G8',
      processor: 'i5-1145G7',
      ram: '16GB',
      ssd: '512GB',
      display: '14"',
      serial: '5CG1276L7P',
      leverancier_class: 'Class D',
      meldingen: 'Gebarsten scherm,Missing rubber feet',
      batchId: BATCHES[0].id,
      batchNummer: BATCHES[0].nummer
    });
    rebuildLaptopIndex();
  `, app);

  await app.selectLaptop('5460901');

  assert.match(app.__appElement.innerHTML, /Supplier marked this device as Class D/);
  assert.match(app.__appElement.innerHTML, /Reason from supplier list/);
  assert.match(app.__appElement.innerHTML, /Gebarsten scherm/);
  assert.match(app.__appElement.innerHTML, /Missing rubber feet/);
});

test('beheerder kan een verkeerde batch verwijderen', () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    STATE.currentScreen = 'home';
  `, app);

  assert.equal(vm.runInContext('BATCHES.length', app), 1);
  return app.handleAction('remove_batch', { dataset: { removeBatch: 'batch_50375' } }).then(() => {
    assert.equal(vm.runInContext('BATCHES.length', app), 0);
    assert.equal(vm.runInContext('getAllLaptops().length', app), 0);
    assert.match(vm.runInContext('JSON.stringify(STATE.auditLogs)', app), /remove_batch/);
  });
});

test('handmatige invoer blokkeert dubbele stickers', () => {
  const app = loadAppSandbox();
  vm.runInContext(`
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    STATE.currentScreen = 'manual';
    document.getElementById = id => ({
      m_merk: { value: 'Dell' },
      m_model: { value: 'Latitude 7420' },
      m_sticker: { value: '7771198' },
      m_serial: { value: '' },
      m_processor: { value: '' },
      m_ram: { value: '' },
      m_ssd: { value: '' },
      m_display: { value: '' },
      m_battery: { value: '' },
      m_gpu: { value: '' },
      m_herkomst: { value: '' },
      app: __appElement,
    }[id] || null);
  `, app);

  return app.handleAction('manual_submit', {}).then(() => {
    assert.match(vm.runInContext('STATE.manualError', app), /already exists/);
    assert.equal(vm.runInContext('STATE.currentScreen', app), 'manual');
  });
});

test('leveranciersrij wordt genormaliseerd naar laptopdata', () => {
  const app = loadAppSandbox();
  const laptop = app.importedRowToLaptop({
    'Product Group': 'Laptops',
    'Sticker Number': 'ABC-123',
    'BIOS Make': 'Dell',
    'BIOS Model': 'Latitude 7420',
    'Processor Name': 'Intel Core i5',
    Memory: '8192',
    'Hard Drive Count': '512GB',
    Display: 'touch 14',
    'Serial Number': 'SER123',
    '[GPU]': 'NVIDIA Corporation RTX 3050',
  }, 'Terabyte 50737.xlsx');

  assert.equal(laptop.sticker, 'ABC-123');
  assert.equal(laptop.ram, '8GB');
  assert.equal(laptop.ssd, '512GB');
  assert.equal(laptop.display, 'touch 14"');
  assert.equal(laptop.labelGpu, 'NVIDIA RTX 3050');
});

test('Aronto laptoplijst wordt herkend en PC sheet wordt genegeerd', () => {
  const app = loadAppSandbox();
  const laptop = app.importedRowToLaptop({
    ID: '26L-047-0014',
    Naam: 'Latitude 5511',
    Klasse: 'Consumer',
    'Processor Model': 'Intel Core i5',
    'Processor Generatie': '10e Generatie',
    Schermgrootte: '15 inch',
    Touchscreen: 'Nee',
    Videokaart: 'Nee',
    Werkgeheugen: '16GB',
    Opslag: '256GB',
    Grade: 'C',
  }, '2026047 Envalior Wout import.xlsx:Laptop');

  assert.equal(laptop.sticker, '26L-047-0014');
  assert.equal(laptop.merk, 'Dell');
  assert.equal(laptop.model, 'Latitude 5511');
  assert.equal(laptop.processor, 'Intel Core i5 10e Generatie');
  assert.equal(laptop.ram, '16GB');
  assert.equal(laptop.ssd, '256GB');
  assert.equal(laptop.display, '15"');
  assert.equal(laptop.leverancier_class, 'C');

  const parsedPcSheet = app.parseSupplierRows([
    ['ID', 'Naam', 'Formfactor', 'Klasse', 'Processor Model', 'Processor Generatie', 'Werkgeheugen', 'Opslag', 'Grade'],
    ['26P-047-0005', 'OptiPlex 7060', 'Desktop', 'Business', 'Core i5', '8e Generatie', '16GB', '256GB', 'A'],
  ], '2026047 Envalior Wout import.xlsx:PC');

  assert.equal(parsedPcSheet.totalRows, 0);
  assert.equal(parsedPcSheet.laptops.length, 0);
  assert.equal(parsedPcSheet.monitors.length, 0);
});

test('gemengde leveranciersrijen scheiden laptops en monitoren', () => {
  const app = loadAppSandbox();

  const laptop = app.importedRowToLaptop({
    ProductType: 'LAPTOP',
    UnitID: '13817657',
    Manufacturer: 'DYNABOOK INC.',
    Model: 'SATELLITE PRO C50-E-112',
    SerialNumber: '80034971A',
    OpticalGrade: 'B',
    RAM: '8 GB',
    Storage1Size: '256GB',
  }, 'mixed.xlsx:Sale ready');
  const desktop = app.importedRowToLaptop({
    ProductType: 'DESKTOP',
    UnitID: '13819999',
    Manufacturer: 'HP',
    Model: 'EliteDesk',
  }, 'mixed.xlsx:Sale ready');
  const monitor = app.importedRowToMonitor({
    ProductType: 'MONITOR',
    UnitID: 'MON-100',
    Manufacturer: 'Dell',
    Model: 'P2422H',
    DeviceName: 'Dell P2422H 24 inch Monitor',
    SerialNumber: 'CN0ABC123',
    DisplaySize: '24"',
    Resolution: '1920x1080',
    OpticalGrade: 'A',
    Ports: 'HDMI, DisplayPort, VGA',
  }, 'monitors.xlsx:Sheet1');

  assert.equal(laptop.sticker, '13817657');
  assert.equal(laptop.merk, 'DYNABOOK INC.');
  assert.equal(desktop, null);
  assert.equal(monitor.sticker, 'MON-100');
  assert.equal(monitor.deviceName, 'Dell P2422H 24 inch Monitor');
  assert.equal(monitor.videoInputs, 'HDMI / DisplayPort / VGA');
});

test('monitor database vult video-in aan op modelmatch zonder batchimport', () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    MONITOR_PORT_DATABASE.splice(0, MONITOR_PORT_DATABASE.length,
      normalizeMonitorPortDatabaseEntry({
        model: 'Dell Professional P2422H',
        displaySize: '24',
        resolution: '1920x1080',
        videoInputs: 'DisplayPort / HDMI / VGA'
      })
    );
    rebuildMonitorPortDatabaseIndex();
  `, app);

  const monitor = app.importedRowToMonitor({
    ProductType: 'MONITOR',
    UnitID: 'MON-DB-1',
    Manufacturer: 'Dell',
    Model: 'P2422H',
    DeviceName: 'Dell P2422H Monitor',
    SerialNumber: 'CN0DB123',
  }, 'monitors.xlsx:Sheet1');

  assert.equal(monitor.videoInputs, 'DisplayPort / HDMI / VGA');
  assert.equal(monitor.resolution, '1920x1080');
  assert.equal(monitor.display, '24"');
  assert.equal(monitor.monitorDatabaseModel, 'Dell Professional P2422H');
});

test('monitor database blokkeert modelmatch met ander merk en normaliseert schermport', () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    MONITOR_PORT_DATABASE.splice(0, MONITOR_PORT_DATABASE.length,
      normalizeMonitorPortDatabaseEntry({
        model: 'AOC B24-8T',
        displaySize: '24',
        resolution: '1920x1080',
        videoInputs: 'Schermport / DVI / HDMI'
      })
    );
    rebuildMonitorPortDatabaseIndex();
  `, app);

  const fujitsu = app.importedRowToMonitor({
    ProductType: 'MONITOR',
    UnitID: '8808680',
    Manufacturer: 'Fujitsu',
    Model: 'B24-8T W24"',
    DeviceName: 'Fujitsu B24-8T W24"',
  }, 'remarkt-supplier.xlsx:Sheet1');
  assert.notEqual(fujitsu.monitorDatabaseModel, 'AOC B24-8T');
  assert.equal(fujitsu.videoInputs, '');

  const aoc = app.importedRowToMonitor({
    ProductType: 'MONITOR',
    UnitID: 'AOC-1',
    Manufacturer: 'AOC',
    Model: 'B24-8T',
    DeviceName: 'AOC B24-8T Monitor',
  }, 'monitor-database.xlsx:Sheet1');
  assert.equal(aoc.monitorDatabaseModel, 'AOC B24-8T');
  assert.equal(aoc.videoInputs, 'DisplayPort / DVI / HDMI');
  assert.doesNotMatch(aoc.videoInputs, /Schermport/i);
});

test('monitor labelscan vraagt keuze bij afwijkende device name en account device name', async () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    MONITOR_PORT_DATABASE.splice(0, MONITOR_PORT_DATABASE.length,
      normalizeMonitorPortDatabaseEntry({
        model: 'HP EliteDisplay E243i',
        displaySize: '24',
        resolution: '1920x1200',
        videoInputs: 'DisplayPort / HDMI / VGA'
      }),
      normalizeMonitorPortDatabaseEntry({
        model: 'HP EliteDisplay E231',
        displaySize: '23',
        resolution: '1920x1080',
        videoInputs: 'DisplayPort / DVI / VGA'
      })
    );
    rebuildMonitorPortDatabaseIndex();
  `, app);

  const monitor = app.importedRowToMonitor({
    ProductType: 'MONITOR',
    UnitID: '8808680',
    Manufacturer: 'HP',
    DeviceName: 'HP EliteDisplay E243i',
    'Account Device Name': 'HP EliteDisplay E231 W23"',
    SerialNumber: 'SN8808680',
  }, 'remarkt-supplier.xlsx:Sheet1');

  assert.equal(monitor.sticker, '8808680');
  assert.equal(monitor.identityOptions.length, 2);
  assert.equal(monitor.identityOptions[0].videoInputs, 'DisplayPort / HDMI / VGA');
  assert.equal(monitor.identityOptions[1].videoInputs, 'DisplayPort / DVI / VGA');

  app.__monitorUnderTest = monitor;
  vm.runInContext(`
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    MONITOR_BATCHES.splice(0, MONITOR_BATCHES.length, {
      id: 'monitor_batch_identity',
      nummer: 'IDENTITY',
      leverancier: 'Monitor supplier import',
      geimporteerd: '20-5-2026',
      monitors: [__monitorUnderTest]
    });
    rebuildMonitorIndex();
    globalThis.monitorPrintCalls = [];
    printMonitorLabelFor = async function(monitor, grade) {
      monitorPrintCalls.push({ sticker: monitor.sticker, grade, rows: getMonitorLabelRows(monitor, grade), deviceName: monitor.deviceName, videoInputs: monitor.videoInputs });
      return true;
    };
    STATE.currentScreen = 'monitor_label_scan';
    render();
  `, app);

  vm.runInContext(`selectMonitorForLabel('8808680');`, app);
  assert.match(app.__appElement.innerHTML, /Choose the correct monitor name/);
  assert.match(app.__appElement.innerHTML, /HP EliteDisplay E243i/);
  assert.match(app.__appElement.innerHTML, /HP EliteDisplay E231 W23&quot;/);
  assert.doesNotMatch(app.__appElement.innerHTML, /data-monitor-print-grade="A"/);

  assert.equal(await app.scanAndPrintMonitorLabel('8808680', 'A'), false);
  assert.equal(vm.runInContext('monitorPrintCalls.length', app), 0);

  vm.runInContext(`chooseMonitorIdentityForLabel(1);`, app);
  assert.match(app.__appElement.innerHTML, /Choose the grade/);
  assert.match(app.__appElement.innerHTML, /HP EliteDisplay E231 W23&quot;/);
  assert.match(app.__appElement.innerHTML, /DisplayPort \/ DVI \/ VGA/);
  assert.equal(vm.runInContext('STATE.currentMonitor.deviceName', app), 'HP EliteDisplay E231 W23"');
  assert.equal(vm.runInContext('STATE.currentMonitor.videoInputs', app), 'DisplayPort / DVI / VGA');

  assert.equal(await app.scanAndPrintMonitorLabel('8808680', 'B'), true);
  assert.equal(vm.runInContext('monitorPrintCalls.length', app), 1);
  assert.equal(vm.runInContext('monitorPrintCalls[0].deviceName', app), 'HP EliteDisplay E231 W23"');
  assert.match(vm.runInContext('monitorPrintCalls[0].rows.join(" | ")', app), /Video in: DP \/ DVI \/ VGA/);
});

test('monitor labelscan print gekozen grade en bewaart monitorhistorie', async () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    MONITOR_BATCHES.splice(0, MONITOR_BATCHES.length, {
      id: 'monitor_batch_test',
      nummer: 'MONTEST',
      leverancier: 'Monitor supplier import',
      geimporteerd: '20-5-2026',
      monitors: [{
        sticker: 'MON-100',
        deviceName: 'Dell P2422H 24 inch Monitor',
        merk: 'Dell',
        model: 'P2422H',
        serial: 'CN0ABC123',
        display: '24"',
        resolution: '1920x1080',
        videoInputs: 'HDMI / DisplayPort / VGA',
        leverancier_class: 'A',
        batchId: 'monitor_batch_test',
        batchNummer: 'MONTEST'
      }]
    });
    rebuildMonitorIndex();
    globalThis.monitorPrintCalls = [];
    printMonitorLabelFor = async function(monitor, grade) {
      monitorPrintCalls.push({ sticker: monitor.sticker, grade, rows: getMonitorLabelRows(monitor, grade) });
      return true;
    };
    STATE.currentScreen = 'monitor_label_scan';
    render();
  `, app);

  assert.match(app.__appElement.innerHTML, /Label Scan/);
  assert.match(app.__appElement.innerHTML, /Dell P2422H 24 inch Monitor/);
  assert.doesNotMatch(app.__appElement.innerHTML, /data-monitor-print-grade="C"/);

  vm.runInContext(`selectMonitorForLabel('MON-100');`, app);
  assert.match(app.__appElement.innerHTML, /Choose the grade/);
  assert.match(app.__appElement.innerHTML, /Light signs of use/);
  assert.match(app.__appElement.innerHTML, /Pixel line, dead pixels/);
  assert.match(app.__appElement.innerHTML, /data-monitor-print-grade="C"/);

  await app.scanAndPrintMonitorLabel('MON-100', 'C');

  assert.equal(vm.runInContext('monitorPrintCalls.length', app), 1);
  assert.equal(vm.runInContext('monitorPrintCalls[0].grade', app), 'C');
  assert.equal(vm.runInContext('monitorPrintCalls[0].rows.length', app), 3);
  assert.match(vm.runInContext('monitorPrintCalls[0].rows.join(" | ")', app), /Video in: HDMI \/ DP \/ VGA/);
  assert.doesNotMatch(vm.runInContext('monitorPrintCalls[0].rows.join(" | ")', app), /SN |Barcode/);
  assert.equal(vm.runInContext('getBrowserLabelMarkup(monitorPrintCalls[0].rows, "monitor").scaleClass.includes("monitor-label")', app), true);
  assert.doesNotMatch(vm.runInContext('buildDymoLabelXml(monitorPrintCalls[0].rows, "monitor")', app), /ROW_4/);
  assert.equal(vm.runInContext('STATE.monitorLabelPrints.length', app), 1);
  assert.equal(vm.runInContext('STATE.monitorLabelPrints[0].grade', app), 'C');
  assert.equal(vm.runInContext("isMonitorLabelPrinted('MON-100')", app), true);
});

test('monitor grade info opent uitleg zonder label te printen', async () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    MONITOR_BATCHES.splice(0, MONITOR_BATCHES.length, {
      id: 'monitor_batch_info',
      nummer: 'INFO',
      leverancier: 'Monitor supplier import',
      geimporteerd: '20-5-2026',
      monitors: [{
        sticker: 'MON-INFO-1',
        deviceName: 'Dell P2422H Monitor',
        merk: 'Dell',
        model: 'P2422H',
        display: '24"',
        resolution: '1920x1080',
        videoInputs: 'HDMI / DisplayPort / VGA',
        leverancier_class: 'Class A',
        batchId: 'monitor_batch_info',
        batchNummer: 'INFO'
      }]
    });
    rebuildMonitorIndex();
    globalThis.monitorPrintCalls = [];
    printMonitorLabelFor = async function(monitor, grade) {
      monitorPrintCalls.push({ sticker: monitor.sticker, grade });
      return true;
    };
    STATE.currentScreen = 'monitor_label_scan';
    selectMonitorForLabel('MON-INFO-1');
  `, app);

  await app.handleDelegatedClick({
    target: {
      closest(selector) {
        if (selector === '[data-monitor-grade-info]') return { dataset: { monitorGradeInfo: 'B' } };
        return null;
      }
    },
    preventDefault() {},
    stopPropagation() {},
  });

  assert.equal(vm.runInContext('monitorPrintCalls.length', app), 0);
  assert.equal(vm.runInContext('STATE.monitorGradeInfoOpen', app), 'B');
  assert.match(app.__appElement.innerHTML, /Clear signs of use/);
  assert.match(app.__appElement.innerHTML, /monitor-grade-video-banner/);
  assert.match(app.__appElement.innerHTML, /monitor-port-art/);
  assert.doesNotMatch(app.__appElement.innerHTML, /monitor-grade-info[^>]*title=/);
  assert.match(app.__appElement.innerHTML, /monitor-port-hdmi-clean-ai\.png/);
  assert.match(app.__appElement.innerHTML, /monitor-port-dp-clean-ai\.png/);
  assert.match(app.__appElement.innerHTML, /monitor-port-vga-clean-ai\.png/);
  assert.match(app.__appElement.innerHTML, /monitor-port-count[^>]*>1x</);
  assert.doesNotMatch(app.__appElement.innerHTML, /<strong>HDMI \/ DisplayPort \/ VGA<\/strong>/);
});

test('monitor poortvisuals tonen aantallen zonder ruwe video-in tekst', () => {
  const app = loadAppSandbox();
  const html = vm.runInContext(`renderMonitorPortVisuals('2x DisplayPort / HDMI x2 / VGA')`, app);

  assert.match(html, /monitor-port-count[^>]*>2x<\/strong><span>DP</);
  assert.match(html, /monitor-port-count[^>]*>2x<\/strong><span>HDMI</);
  assert.match(html, /monitor-port-count[^>]*>1x<\/strong><span>VGA</);
  assert.doesNotMatch(html, /DisplayPort \/ HDMI/);
});

test('monitor handmatige invoer maakt monitor aan en print na gradekeuze', async () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    STATE.currentScreen = 'monitor_manual';
    document.getElementById = id => ({
      app: __appElement,
      mm_merk: { value: 'Dell' },
      mm_series: { value: '' },
      mm_model: { value: 'P2422H' },
      mm_sticker: { value: 'MON-MAN-1' },
      mm_serial: { value: 'SNMAN1' },
      mm_display: { value: '24"' },
      mm_resolution: { value: '1920x1080' },
      mm_herkomst: { value: 'losse voorraad' }
    }[id] || null);
    document.querySelectorAll = selector => selector === '[data-monitor-video-port-count-select]'
      ? [
          { value: '2', dataset: { monitorVideoPort: 'HDMI' } },
          { value: '1', dataset: { monitorVideoPort: 'DisplayPort' } },
          { value: '0', dataset: { monitorVideoPort: 'Mini DisplayPort' } },
          { value: '0', dataset: { monitorVideoPort: 'DVI' } },
          { value: '1', dataset: { monitorVideoPort: 'VGA' } },
          { value: '0', dataset: { monitorVideoPort: 'USB-C' } },
          { value: '0', dataset: { monitorVideoPort: 'Thunderbolt' } },
        ]
      : [];
    globalThis.monitorPrintCalls = [];
    printMonitorLabelFor = async function(monitor, grade) {
      monitorPrintCalls.push({ sticker: monitor.sticker, grade, rows: getMonitorLabelRows(monitor, grade), deviceName: monitor.deviceName });
      return true;
    };
  `, app);

  vm.runInContext('render();', app);
  assert.match(app.__appElement.innerHTML, /monitors without a reliable scan/);
  assert.match(app.__appElement.innerHTML, /Brand and model number are required/);
  assert.match(app.__appElement.innerHTML, /Choose screen size/);
  assert.match(app.__appElement.innerHTML, /17 inch/);
  assert.match(app.__appElement.innerHTML, /55 inch/);
  assert.match(app.__appElement.innerHTML, /list="monitorManualBrandSuggestions"/);
  assert.match(app.__appElement.innerHTML, /list="monitorManualSeriesSuggestions"/);
  assert.match(app.__appElement.innerHTML, /list="monitorManualModelSuggestions"/);
  assert.match(app.__appElement.innerHTML, /Model number \*/);
  assert.match(app.__appElement.innerHTML, /Label name/);
  assert.match(app.__appElement.innerHTML, /data-monitor-video-port="HDMI"/);
  assert.match(app.__appElement.innerHTML, /data-monitor-video-port="DisplayPort"/);
  assert.match(app.__appElement.innerHTML, /data-monitor-video-port="Thunderbolt"/);
  assert.match(app.__appElement.innerHTML, /data-monitor-video-port-count-button/);
  assert.match(app.__appElement.innerHTML, />0x<\/button>/);
  assert.match(app.__appElement.innerHTML, />2x<\/button>/);

  await app.handleAction('monitor_manual_submit', { dataset: {} });

  assert.equal(vm.runInContext('STATE.currentScreen', app), 'monitor_label_scan');
  assert.equal(vm.runInContext('STATE.currentMonitor.sticker', app), 'MON-MAN-1');
  assert.equal(vm.runInContext('STATE.currentMonitor.deviceName', app), 'Dell P2422H');
  assert.equal(vm.runInContext('STATE.currentMonitor.display', app), '24"');
  assert.equal(vm.runInContext('STATE.currentMonitor.videoInputs', app), '2x HDMI / DisplayPort / VGA');
  assert.match(app.__appElement.innerHTML, /Choose the grade/);

  await app.scanAndPrintMonitorLabel('MON-MAN-1', 'A');

  assert.equal(vm.runInContext('monitorPrintCalls.length', app), 1);
  assert.equal(vm.runInContext('monitorPrintCalls[0].deviceName', app), 'Dell P2422H');
  assert.match(vm.runInContext('monitorPrintCalls[0].rows.join(" | ")', app), /Dell P2422H/);
  assert.match(vm.runInContext('monitorPrintCalls[0].rows.join(" | ")', app), /Video in: 2x HDMI \/ DP \/ VGA/);
  assert.doesNotMatch(vm.runInContext('monitorPrintCalls[0].rows.join(" | ")', app), /SN |Barcode/);
  assert.equal(vm.runInContext('STATE.monitorLabelPrints[0].grade', app), 'A');

  // Na het graden keert een handmatig ingevoerde monitor terug naar een leeg
  // invoerscherm zodat de volgende meteen ingevoerd kan worden.
  assert.equal(vm.runInContext('STATE.currentScreen', app), 'monitor_manual');
  assert.equal(vm.runInContext('STATE.currentMonitor', app), null);
});

test('databasematch vult resolutie/scherm/poorten en normaliseert decimale schermmaat', () => {
  const app = loadAppSandbox();
  setupMonitorManualDom(app);
  vm.runInContext(`
    STATE.currentScreen = 'monitor_manual';
    __mmFields.mm_merk.value = 'HP';
    __mmFields.mm_model.value = 'E233';
    applyMonitorManualDatabaseMatch({ model: 'HP EliteDisplay E233', resolution: '1920x1080', displaySize: '23.8', videoInputs: '2x HDMI / DisplayPort' });
  `, app);

  assert.equal(vm.runInContext('__mmFields.mm_resolution.value', app), '1920x1080');
  // Decimale maat (23.8") wordt genormaliseerd naar kale inch die als <option value> bestaat.
  assert.equal(vm.runInContext('__mmFields.mm_display.value', app), '23');
  assert.equal(vm.runInContext('__mmPorts.HDMI.select.value', app), '2');
  assert.equal(vm.runInContext('__mmPorts.DisplayPort.select.value', app), '1');
  assert.equal(vm.runInContext('__mmFields.mm_resolution.dataset.autoFilled', app), 'true');
  assert.equal(vm.runInContext('STATE.monitorManualPortsAutoFilled', app), true);
});

test('automatisch ingevulde poorten worden gewist bij wisselen naar onbekend model', () => {
  const app = loadAppSandbox();
  setupMonitorManualDom(app);
  vm.runInContext(`
    STATE.currentScreen = 'monitor_manual';
    STATE.monitorManualAutoKey = 'iets';
    __mmFields.mm_merk.value = 'HP';
    __mmFields.mm_model.value = 'E233';
    applyMonitorManualDatabaseMatch({ model: 'HP EliteDisplay E233', resolution: '1920x1080', displaySize: '23', videoInputs: 'HDMI / DisplayPort / VGA' });
  `, app);
  assert.equal(vm.runInContext('__mmPorts.HDMI.select.value', app), '1');

  // Nu geen match meer (lege database): oude auto-gegevens en poorten wissen.
  vm.runInContext('syncMonitorManualDatabaseAssist();', app);
  assert.equal(vm.runInContext('__mmFields.mm_resolution.value', app), '');
  assert.equal(vm.runInContext('__mmFields.mm_display.value', app), '');
  assert.equal(vm.runInContext('__mmPorts.HDMI.select.value', app), '0');
  assert.equal(vm.runInContext('__mmPorts.DisplayPort.select.value', app), '0');
  assert.equal(vm.runInContext('__mmPorts.VGA.select.value', app), '0');
  // Onbekend model krijgt een 'raw:'-contextsleutel (niet meer null).
  assert.equal(vm.runInContext('STATE.monitorManualAutoKey', app), 'raw:e233');
});

test('handmatig gekozen poort blijft behouden bij herhaalde sync van hetzelfde model', () => {
  const app = loadAppSandbox();
  setupMonitorManualDom(app);
  seedMonitorPortDatabase(app, [
    { model: 'HP EliteDisplay E233', displaySize: '23', resolution: '1920x1080', videoInputs: 'HDMI / DisplayPort / VGA' },
  ]);
  vm.runInContext(`
    STATE.currentScreen = 'monitor_manual';
    __mmFields.mm_merk.value = 'HP';
    __mmFields.mm_model.value = 'E233';
    syncMonitorManualDatabaseAssist();
  `, app);
  const keyAfterMatch = vm.runInContext('STATE.monitorManualAutoKey', app);
  assert.ok(keyAfterMatch, 'match moet een identiteitssleutel opleveren');
  assert.equal(vm.runInContext('__mmFields.mm_resolution.value', app), '1920x1080');

  // Medewerker corrigeert de VGA-poort naar 2x en typt daarna verder in het model.
  vm.runInContext(`
    setMonitorManualPortCount({ dataset: { port: 'VGA', count: '2' }, closest: () => __mmPorts.VGA.group });
    syncMonitorManualDatabaseAssist();
  `, app);

  // Zelfde databasemodel => geen her-invulling => correctie blijft staan.
  assert.equal(vm.runInContext('__mmPorts.VGA.select.value', app), '2');
  assert.equal(vm.runInContext('STATE.monitorManualPortsAutoFilled', app), false);
  assert.equal(vm.runInContext('STATE.monitorManualAutoKey', app), keyAfterMatch);
});

test('validatiefout bij handmatige monitor wist de ingevulde velden niet', async () => {
  const app = loadAppSandbox();
  setupMonitorManualDom(app);
  vm.runInContext(`
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    STATE.currentScreen = 'monitor_manual';
    __mmFields.mm_merk.value = '';
    __mmFields.mm_model.value = 'E233';
    __mmFields.mm_resolution.value = '1920x1080';
  `, app);

  const before = app.__appElement.innerHTML;
  await vm.runInContext('submitMonitorManualEntry()', app);

  assert.equal(vm.runInContext('STATE.manualError', app), 'Brand and model number are required.');
  assert.equal(vm.runInContext('__mmFields.mm_error.textContent', app), 'Brand and model number are required.');
  assert.equal(vm.runInContext('__mmFields.mm_error.hidden', app), false);
  // Geen render() => ingevulde velden intact en scherm niet herbouwd.
  assert.equal(vm.runInContext('__mmFields.mm_model.value', app), 'E233');
  assert.equal(vm.runInContext('__mmFields.mm_resolution.value', app), '1920x1080');
  assert.equal(app.__appElement.innerHTML, before);
  assert.equal(vm.runInContext('STATE.currentScreen', app), 'monitor_manual');
});

test('al geprinte monitor opent reprint-popup en print opnieuw met vastgelegde grade', async () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    MONITOR_BATCHES.splice(0, MONITOR_BATCHES.length, {
      id: 'monitor_batch_reprint',
      nummer: 'RP',
      leverancier: 'Monitor supplier import',
      geimporteerd: '1-7-2026',
      monitors: [{
        sticker: 'MON-RP-1',
        deviceName: 'Dell P2422H Monitor',
        merk: 'Dell',
        model: 'P2422H',
        display: '24"',
        resolution: '1920x1080',
        videoInputs: 'HDMI / DisplayPort',
        batchId: 'monitor_batch_reprint',
        batchNummer: 'RP',
      }],
    });
    rebuildMonitorIndex();
    rebuildMonitorLabelPrintIndexes();
    globalThis.reprintCalls = [];
    printMonitorLabelFor = async function(monitor, grade) {
      reprintCalls.push({ sticker: monitor.sticker, grade });
      return true;
    };
    recordMonitorLabelPrint(getMonitorBySticker('MON-RP-1'), 'B');
  `, app);

  // Scannen van een al-geprinte monitor loopt niet dood maar opent de LOSSE pop-up.
  vm.runInContext("selectMonitorForLabel('MON-RP-1');", app);
  assert.equal(vm.runInContext('STATE.monitorReprintPrompt && STATE.monitorReprintPrompt.sticker', app), 'MON-RP-1');
  // Kritiek: currentMonitor is null zodat het gradescherm NIET over de pop-up ligt.
  assert.equal(vm.runInContext('STATE.currentMonitor', app), null);
  assert.doesNotMatch(app.__appElement.innerHTML, /data-monitor-print-grade/);
  assert.match(app.__appElement.innerHTML, /You already scanned this monitor/);
  assert.match(app.__appElement.innerHTML, /data-action="monitor_reprint_confirm"[^>]*>Print again/);
  assert.match(app.__appElement.innerHTML, /data-action="monitor_regrade"[^>]*>Grade again/);
  assert.match(app.__appElement.innerHTML, /data-action="monitor_reprint_cancel"[^>]*>Back/);
  assert.match(app.__appElement.innerHTML, /grade B/);

  // Bevestigen => opnieuw printen met de eerder vastgelegde grade (B).
  await vm.runInContext("handleAction('monitor_reprint_confirm', { dataset: {} });", app);
  assert.equal(vm.runInContext('reprintCalls.length', app), 1);
  assert.equal(vm.runInContext('reprintCalls[0].grade', app), 'B');
  assert.equal(vm.runInContext('STATE.monitorReprintPrompt', app), null);
  assert.equal(vm.runInContext("STATE.auditLogs.some(log => log.action === 'monitor_label_reprinted')", app), true);

  // Annuleren sluit de pop-up zonder te printen.
  vm.runInContext("STATE.monitorReprintPrompt = { sticker: 'MON-RP-1' };", app);
  await vm.runInContext("handleAction('monitor_reprint_cancel', { dataset: {} });", app);
  assert.equal(vm.runInContext('STATE.monitorReprintPrompt', app), null);
  assert.equal(vm.runInContext('reprintCalls.length', app), 1);
});

test('opnieuw graden overschrijft grade en blijft niet hangen op grade-klik', async () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    MONITOR_BATCHES.splice(0, MONITOR_BATCHES.length, {
      id: 'monitor_batch_regrade',
      nummer: 'RG',
      leverancier: 'Monitor supplier import',
      geimporteerd: '1-7-2026',
      monitors: [{
        sticker: 'MON-RG-1',
        deviceName: 'Dell P2422H Monitor',
        merk: 'Dell', model: 'P2422H',
        display: '24"', resolution: '1920x1080',
        videoInputs: 'HDMI / DisplayPort',
        batchId: 'monitor_batch_regrade', batchNummer: 'RG',
      }],
    });
    rebuildMonitorIndex();
    rebuildMonitorLabelPrintIndexes();
    globalThis.printCalls = [];
    printMonitorLabelFor = async function(monitor, grade) { printCalls.push({ sticker: monitor.sticker, grade }); return true; };
    recordMonitorLabelPrint(getMonitorBySticker('MON-RG-1'), 'A');
  `, app);

  // Al geprint => scan opent de waarschuwing (geen dead-end).
  vm.runInContext("selectMonitorForLabel('MON-RG-1');", app);
  assert.equal(vm.runInContext('STATE.monitorReprintPrompt && STATE.monitorReprintPrompt.sticker', app), 'MON-RG-1');

  // "Opnieuw graden" => terug naar gradescherm met regrade-toestemming.
  await vm.runInContext("handleAction('monitor_regrade', { dataset: {} });", app);
  assert.equal(vm.runInContext('STATE.monitorRegradeSticker', app), 'MON-RG-1');
  assert.equal(vm.runInContext('STATE.monitorReprintPrompt', app), null);
  assert.equal(vm.runInContext('STATE.currentScreen', app), 'monitor_label_scan');

  // Nieuwe grade klikken print echt (geen popup-loop/hang) en overschrijft grade.
  const printed = await vm.runInContext("scanAndPrintMonitorLabel('MON-RG-1', 'C');", app);
  assert.equal(printed, true);
  assert.equal(vm.runInContext('printCalls.length', app), 1);
  assert.equal(vm.runInContext('printCalls[0].grade', app), 'C');
  assert.equal(vm.runInContext("getLatestMonitorLabelPrintForSticker('MON-RG-1').grade", app), 'C');
  assert.equal(vm.runInContext('STATE.monitorRegradeSticker', app), null);
  assert.equal(vm.runInContext('STATE.monitorPrintInProgress', app), false);
  // Geen dubbel record: nog steeds precies 1 printrecord voor deze barcode.
  assert.equal(vm.runInContext("STATE.monitorLabelPrints.filter(p => p.sticker === 'MON-RG-1').length", app), 1);
});

test('elke pagina heeft een logische terug-actie in de topbar', () => {
  const app = loadAppSandbox();
  const cases = {
    sticker_scan: 'home', scan: 'home', monitor_label_scan: 'home',
    monitor_manual: 'monitor_label_scan', import: 'home', accounts: 'home',
    analytics: 'home', history: 'analytics', laptop_info: 'back_scan',
    result: 'back_scan', home: null, login: null, password_change: null,
  };
  for (const [screen, expected] of Object.entries(cases)) {
    assert.equal(vm.runInContext(`getScreenBackAction(${JSON.stringify(screen)})`, app), expected);
  }
  vm.runInContext("STATE.currentUser = USERS.find(u => u.id === 'tim'); STATE.currentScreen = 'import';", app);
  assert.match(vm.runInContext('renderTopbar()', app), /data-action="home"[^>]*>← Back/);
  vm.runInContext("STATE.currentScreen = 'home';", app);
  assert.doesNotMatch(vm.runInContext('renderTopbar()', app), /← Back/);
});

test('monitor zonder poortinfo toont bewerkbare poortkiezer op het gradescherm', () => {
  const app = loadAppSandbox();
  const html = vm.runInContext(`
    STATE.currentUser = USERS.find(u => u.id === 'tim');
    renderMonitorGradeChoiceModal({ sticker: 'X1', deviceName: 'Onbekend Model Z', merk: 'OnbekendMerk', model: 'Model Z', videoInputs: '' });
  `, app);
  assert.match(html, /data-monitor-grade-port-editor/);
  assert.match(html, /data-monitor-video-port-count-button/);

  // Met bekende poorten juist read-only visuals en geen editor.
  const html2 = vm.runInContext("renderMonitorGradeChoiceModal({ sticker: 'X2', deviceName: 'Dell P2422H', merk: 'Dell', model: 'P2422H', videoInputs: 'HDMI / DisplayPort' });", app);
  assert.doesNotMatch(html2, /data-monitor-grade-port-editor/);
  assert.match(html2, /monitor-port-visuals/);
});

test('withPrintTimeout laat een hangende DYMO-print niet eeuwig blokkeren', async () => {
  const app = loadAppSandbox();
  // Een DYMO-print die nooit reageert -> na de timeout wordt hij afgewezen,
  // zodat de app kan terugvallen op het browser-printvenster.
  const result = await vm.runInContext(`
    (async () => {
      try { await withPrintTimeout(new Promise(() => {}), 20, 'timeout'); return 'resolved'; }
      catch (e) { return 'rejected:' + e.message; }
    })()
  `, app);
  assert.equal(result, 'rejected:timeout');
  // Een snelle print lost gewoon normaal op.
  const ok = await vm.runInContext("withPrintTimeout(Promise.resolve('printed'), 1000)", app);
  assert.equal(ok, 'printed');
});

test('labeltitel zet het merk niet twee keer neer (HP HP)', () => {
  const app = loadAppSandbox();
  // Monitor: merk staat al in deviceName én model.
  const monRows = app.getMonitorLabelRows({ deviceName: 'HP HP E233', merk: 'HP', model: 'HP E233', display: '23"', resolution: '1920x1080', videoInputs: 'HDMI' }, 'A');
  assert.equal(monRows[0], 'HP E233');
  // Monitor zonder deviceName: de merk+model-fallback dupliceert het merk.
  const monRows2 = app.getMonitorLabelRows({ deviceName: '', merk: 'HP', model: 'HP EliteDisplay E233', videoInputs: 'HDMI' }, 'A');
  assert.equal(monRows2[0], 'HP EliteDisplay E233');
  // Laptop: idem.
  const lapRows = app.getSpecsLabelRows({ merk: 'HP', model: 'HP EliteBook 840', processor: 'i5', ram: '8GB', ssd: '256GB', battery: '' }, { eindgrade: 'A' });
  assert.equal(lapRows[0], 'HP EliteBook 840');
  // Correcte namen blijven ongewijzigd.
  const monRows3 = app.getMonitorLabelRows({ deviceName: 'Dell U2415', merk: 'Dell', model: 'U2415', videoInputs: 'HDMI' }, 'A');
  assert.equal(monRows3[0], 'Dell U2415');
  // Opbouw van de monitornaam ontdubbelt ook.
  assert.equal(app.buildMonitorDeviceName('HP', '', 'HP E233'), 'HP E233');
});

test('reparatielabels worden per batch geteld en in bakken (productie/afkeur) verdeeld', () => {
  const app = loadAppSandbox();
  vm.runInContext(`
    STATE.history = [
      { batchId: 'B1', batchNummer: '900', grade: 'C', leverancier_meldingen: '', result: { forceProblemLabel: true, repairLabelType: 'production', problems: ['toets'], repairActions: [{ issue: 'toets' }] } },
      { batchId: 'B1', batchNummer: '900', grade: 'X', leverancier_meldingen: '', result: { repairActions: [{ issue: 'lcd' }], repairLabelType: 'reject' } },
      { batchId: 'B1', batchNummer: '900', grade: 'A', leverancier_meldingen: '', result: { forceProblemLabel: false, problems: [], repairActions: [] } },
      { batchId: 'B2', batchNummer: '901', grade: 'X', leverancier_meldingen: '', result: { forceProblemLabel: true, repairLabelType: 'reject' } },
    ];
  `, app);
  const stats = vm.runInContext('getBatchRepairStats()', app);
  assert.equal(stats.B1.graded, 3);
  assert.equal(stats.B1.repair, 2);
  assert.equal(stats.B1.production, 1);
  assert.equal(stats.B1.reject, 1);
  assert.equal(stats.B2.repair, 1);
  assert.equal(stats.B2.reject, 1);
  const forB1 = vm.runInContext("getBatchRepairStatsFor({ id: 'B1', nummer: '900' })", app);
  assert.equal(forB1.repair, 2);
});

test('contrast-toggle schakelt tussen normaal en hoog contrast', async () => {
  const app = loadAppSandbox();
  vm.runInContext("STATE.currentUser = USERS.find(u => u.id === 'tim'); STATE.currentScreen = 'home';", app);
  const html = vm.runInContext('renderContrastToggle()', app);
  assert.match(html, /data-action="toggle_contrast"/);
  assert.match(html, /data-contrast-value="normal"/);
  assert.match(html, /data-contrast-value="high"/);
  assert.match(html, /contrast-icon/);
  // Hoog-contrast icoon heeft een gevulde helft.
  assert.match(html, /data-contrast-value="high"[\s\S]*?fill="currentColor"/);

  await vm.runInContext("handleAction('toggle_contrast', { dataset: { contrastValue: 'high' } });", app);
  assert.equal(vm.runInContext('STATE.contrast', app), 'high');
  await vm.runInContext("handleAction('toggle_contrast', { dataset: { contrastValue: 'normal' } });", app);
  assert.equal(vm.runInContext('STATE.contrast', app), 'normal');
});

test('monitorlabel printen toont bezigstatus en blokkeert dubbele gradekeuze', async () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    MONITOR_BATCHES.splice(0, MONITOR_BATCHES.length, {
      id: 'monitor_batch_busy',
      nummer: 'BUSY',
      leverancier: 'Monitor supplier import',
      geimporteerd: '18-6-2026',
      monitors: [{
        sticker: 'MON-BUSY-1',
        deviceName: 'Dell P2422H Monitor',
        merk: 'Dell',
        model: 'P2422H',
        display: '24"',
        resolution: '1920x1080',
        videoInputs: 'HDMI / DisplayPort',
        batchId: 'monitor_batch_busy',
        batchNummer: 'BUSY'
      }]
    });
    rebuildMonitorIndex();
    globalThis.monitorPrintCalls = [];
    globalThis.resolveMonitorPrint = null;
    printMonitorLabelFor = async function(monitor, grade) {
      monitorPrintCalls.push({ sticker: monitor.sticker, grade });
      return await new Promise(resolve => {
        resolveMonitorPrint = () => resolve(true);
      });
    };
    STATE.currentScreen = 'monitor_label_scan';
    selectMonitorForLabel('MON-BUSY-1');
  `, app);

  const printPromise = app.scanAndPrintMonitorLabel('MON-BUSY-1', 'B');

  assert.equal(vm.runInContext('STATE.monitorPrintInProgress', app), true);
  assert.equal(vm.runInContext('STATE.monitorSelectedGrade', app), 'B');
  assert.match(app.__appElement.innerHTML, /The monitor label is being printed and saved live/);
  assert.match(app.__appElement.innerHTML, /data-monitor-print-grade="B"[^>]*disabled/);

  assert.equal(await app.scanAndPrintMonitorLabel('MON-BUSY-1', 'C'), false);
  assert.equal(vm.runInContext('monitorPrintCalls.length', app), 1);

  vm.runInContext('resolveMonitorPrint()', app);
  assert.equal(await printPromise, true);
  assert.equal(vm.runInContext('STATE.monitorPrintInProgress', app), false);
  assert.equal(vm.runInContext('monitorPrintCalls.length', app), 1);
  assert.equal(vm.runInContext('monitorPrintCalls[0].grade', app), 'B');
  assert.equal(vm.runInContext('STATE.monitorLabelPrints.length', app), 1);
  assert.equal(vm.runInContext('STATE.currentMonitor', app), null);
});

test('monitorlabel printfout laat monitor opnieuw proberen zonder vast te hangen', async () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    MONITOR_BATCHES.splice(0, MONITOR_BATCHES.length, {
      id: 'monitor_batch_fail',
      nummer: 'FAIL',
      leverancier: 'Monitor supplier import',
      geimporteerd: '18-6-2026',
      monitors: [{
        sticker: 'MON-FAIL-1',
        deviceName: 'HP E24 G4 Monitor',
        merk: 'HP',
        model: 'E24 G4',
        display: '24"',
        resolution: '1920x1080',
        videoInputs: 'HDMI / USB-C',
        batchId: 'monitor_batch_fail',
        batchNummer: 'FAIL'
      }]
    });
    rebuildMonitorIndex();
    globalThis.monitorPrintCalls = [];
    printMonitorLabelFor = async function(monitor, grade) {
      monitorPrintCalls.push({ sticker: monitor.sticker, grade });
      throw new Error('printer vast');
    };
    STATE.currentScreen = 'monitor_label_scan';
    selectMonitorForLabel('MON-FAIL-1');
  `, app);

  assert.equal(await app.scanAndPrintMonitorLabel('MON-FAIL-1', 'A'), false);

  assert.equal(vm.runInContext('STATE.monitorPrintInProgress', app), false);
  assert.equal(vm.runInContext('STATE.currentMonitor.sticker', app), 'MON-FAIL-1');
  assert.equal(vm.runInContext('STATE.monitorLabelPrints.length', app), 0);
  assert.equal(vm.runInContext('monitorPrintCalls.length', app), 1);
  assert.match(vm.runInContext('STATE.appMessage && STATE.appMessage.text', app), /was not completed/);
  assert.match(app.__appElement.innerHTML, /Choose the grade/);
});

test('monitor handmatige invoer gebruikt database autocomplete en vult specs automatisch', () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    MONITOR_PORT_DATABASE.splice(0, MONITOR_PORT_DATABASE.length,
      normalizeMonitorPortDatabaseEntry({
        model: 'Dell P2422H',
        displaySize: '24',
        resolution: '1920x1080',
        videoInputs: 'HDMI / DisplayPort / VGA'
      }),
      normalizeMonitorPortDatabaseEntry({
        model: 'HP E24 G4',
        displaySize: '24',
        resolution: '1920x1200',
        videoInputs: '2x HDMI / USB-C'
      })
    );
    rebuildMonitorPortDatabaseIndex();
  `, app);

  assert.equal(vm.runInContext("getMonitorManualBrandSuggestions('D').join('|')", app), 'Dell');
  assert.equal(vm.runInContext("getMonitorManualModelSuggestions('Dell', '', '2422').join('|')", app), 'P2422H');
  assert.equal(vm.runInContext("findMonitorManualDatabaseMatch('Dell', '', 'P2422H').resolution", app), '1920x1080');
  assert.equal(vm.runInContext("getMonitorManualBrandSuggestions('H').includes('HP')", app), true);
  assert.equal(vm.runInContext("findMonitorManualDatabaseMatch('HP', '', 'E24 G4').displaySize", app), '24');
  assert.equal(vm.runInContext("findMonitorManualDatabaseMatch('HP', '', 'E24 G4').videoInputs", app), '2x HDMI / USB-C');
  assert.equal(vm.runInContext("splitMonitorModelParts('HP EliteDisplay E243i', 'HP').series", app), 'EliteDisplay');
  assert.equal(vm.runInContext("splitMonitorModelParts('HP EliteDisplay E243i', 'HP').modelNumber", app), 'E243i');
  assert.equal(vm.runInContext("buildMonitorDeviceName('HP', 'EliteDisplay', 'E243i')", app), 'HP EliteDisplay E243i');
  assert.equal(vm.runInContext("getMonitorManualPortSelections('HDMI / DisplayPort / VGA').length", app), 7);
  assert.equal(vm.runInContext("getMonitorManualPortSelections('HDMI / DisplayPort / VGA').filter(item => item.count > 0).map(item => item.port).join(' / ')", app), 'HDMI / DisplayPort / VGA');
  assert.equal(vm.runInContext(`
    const fields = {
      app: __appElement,
      mm_merk: { value: 'HP', dataset: {} },
      mm_series: { value: '', dataset: {} },
      mm_model: { value: 'LA2306x', dataset: {} },
      mm_resolution: { value: '', dataset: {} },
      mm_display: { value: '', dataset: {} },
      mm_device_preview: { value: '', dataset: {} },
    };
    STATE.currentScreen = 'monitor_manual';
    document.getElementById = id => fields[id] || null;
    document.querySelectorAll = () => [];
    MONITOR_PORT_DATABASE.push(normalizeMonitorPortDatabaseEntry({
      model: 'HP Compaq LA2306x',
      displaySize: '23',
      resolution: '1920x1080',
      videoInputs: 'DVI / VGA'
    }));
    rebuildMonitorPortDatabaseIndex();
    syncMonitorManualDatabaseAssist();
    const filled = fields.mm_series.value + '|' + fields.mm_display.value + '|' + fields.mm_resolution.value;
    fields.mm_merk.value = 'Acer';
    fields.mm_model.value = 'ZZZ999';
    syncMonitorManualDatabaseAssist();
    filled + ' -> ' + fields.mm_series.value + '|' + fields.mm_display.value + '|' + fields.mm_resolution.value;
  `, app), 'Compaq|23|1920x1080 -> ||');
});

test('monitor labelscan kan verkeerde leveranciersgegevens corrigeren voor dezelfde barcode', async () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    MONITOR_BATCHES.splice(0, MONITOR_BATCHES.length, {
      id: 'monitor_batch_fix',
      nummer: 'FIX',
      leverancier: 'Monitor supplier import',
      geimporteerd: '20-5-2026',
      monitors: [{
        sticker: 'MON-FIX-1',
        deviceName: 'AOC B24-8T',
        merk: 'AOC',
        model: 'B24-8T',
        serial: 'WRONGSN',
        display: '24"',
        resolution: '1920x1080',
        videoInputs: 'HDMI',
        leverancier_class: 'Class B',
        meldingen: 'Diepere kras op voet',
        batchId: 'monitor_batch_fix',
        batchNummer: 'FIX'
      }]
    });
    rebuildMonitorIndex();
    STATE.currentScreen = 'monitor_label_scan';
    selectMonitorForLabel('MON-FIX-1');
  `, app);

  assert.match(app.__appElement.innerHTML, /Correct details/);

  await app.handleAction('monitor_manual_from_current', { dataset: {} });
  assert.equal(vm.runInContext('STATE.currentScreen', app), 'monitor_manual');
  assert.match(app.__appElement.innerHTML, /Correct monitor details/);
  assert.match(app.__appElement.innerHTML, /MON-FIX-1/);

  vm.runInContext(`
    document.getElementById = id => ({
      app: __appElement,
      mm_merk: { value: 'Fujitsu' },
      mm_series: { value: '' },
      mm_model: { value: 'B24-8T W24"' },
      mm_sticker: { value: 'MON-FIX-1' },
      mm_serial: { value: 'NEWSN' },
      mm_display: { value: '24"' },
      mm_resolution: { value: '1920x1080' },
      mm_herkomst: { value: 'gecorrigeerde leveranciersregel' }
    }[id] || null);
    document.querySelectorAll = selector => selector === '[data-monitor-video-port-count-select]'
      ? [
          { value: '1', dataset: { monitorVideoPort: 'DisplayPort' } },
          { value: '1', dataset: { monitorVideoPort: 'DVI' } },
          { value: '1', dataset: { monitorVideoPort: 'HDMI' } },
        ]
      : [];
    globalThis.monitorPrintCalls = [];
    printMonitorLabelFor = async function(monitor, grade) {
      monitorPrintCalls.push({ sticker: monitor.sticker, grade, rows: getMonitorLabelRows(monitor, grade), deviceName: monitor.deviceName, videoInputs: monitor.videoInputs });
      return true;
    };
  `, app);

  await app.handleAction('monitor_manual_submit', { dataset: {} });

  assert.equal(vm.runInContext("getMonitorBySticker('MON-FIX-1').merk", app), 'Fujitsu');
  assert.equal(vm.runInContext("getMonitorBySticker('MON-FIX-1').model", app), 'B24-8T W24"');
  assert.equal(vm.runInContext("getMonitorBySticker('MON-FIX-1').videoInputs", app), 'DisplayPort / DVI / HDMI');
  assert.equal(vm.runInContext("getMonitorBySticker('MON-FIX-1').leverancier_class", app), 'Class B');
  assert.match(app.__appElement.innerHTML, /Note: supplier notice/);
  assert.match(app.__appElement.innerHTML, /Diepere kras op voet/);

  await app.scanAndPrintMonitorLabel('MON-FIX-1', 'B');

  assert.equal(vm.runInContext('monitorPrintCalls.length', app), 1);
  assert.match(vm.runInContext('monitorPrintCalls[0].rows.join(" | ")', app), /Fujitsu B24-8T W24&quot;|Fujitsu B24-8T W24"/);
  assert.doesNotMatch(vm.runInContext('monitorPrintCalls[0].rows.join(" | ")', app), /AOC/);
  assert.match(vm.runInContext('monitorPrintCalls[0].rows.join(" | ")', app), /Video in: DP \/ DVI \/ HDMI/);
});

test('monitor grade popup toont merk groot en waarschuwt bij grote problemen', () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    MONITOR_BATCHES.splice(0, MONITOR_BATCHES.length, {
      id: 'monitor_batch_problem',
      nummer: 'MONPROBLEM',
      leverancier: 'Monitor supplier import',
      geimporteerd: '20-5-2026',
      monitors: [{
        sticker: 'MON-X-1',
        deviceName: 'HP EliteDisplay E243i',
        merk: 'HP',
        model: 'EliteDisplay E243i',
        serial: 'SNMONX1',
        display: '24"',
        resolution: '1920x1200',
        videoInputs: 'DisplayPort / HDMI / VGA',
        leverancier_class: 'X-grade',
        meldingen: 'Pixel line, no power issue reported',
        batchId: 'monitor_batch_problem',
        batchNummer: 'MONPROBLEM'
      }]
    });
    rebuildMonitorIndex();
    STATE.currentScreen = 'monitor_label_scan';
    selectMonitorForLabel('MON-X-1');
  `, app);

  assert.match(app.__appElement.innerHTML, /<span>Brand<\/span>\s*<strong>HP<\/strong>/);
  assert.match(app.__appElement.innerHTML, /<span>Model<\/span>\s*<strong>EliteDisplay E243i<\/strong>/);
  assert.match(app.__appElement.innerHTML, /Note: supplier notice/);
  assert.match(app.__appElement.innerHTML, /Device Errors/);
  assert.match(app.__appElement.innerHTML, /Pixel line/);
  assert.doesNotMatch(app.__appElement.innerHTML, /X-grade in Excel/);
});

test('monitor grade popup toont alleen waarschuwing wanneer Device Errors gevuld is', () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    MONITOR_BATCHES.splice(0, MONITOR_BATCHES.length, {
      id: 'monitor_batch_supplier_grade',
      nummer: 'MONGRADE',
      leverancier: 'Monitor supplier import',
      geimporteerd: '20-5-2026',
      monitors: [{
        sticker: 'MON-B-1',
        deviceName: 'Dell P2422H Monitor',
        merk: 'Dell',
        model: 'P2422H',
        videoInputs: 'DisplayPort / HDMI',
        leverancier_class: 'Class B',
        meldingen: 'Diepere kras op voet',
        batchId: 'monitor_batch_supplier_grade',
        batchNummer: 'MONGRADE'
      }, {
        sticker: 'MON-B-2',
        deviceName: 'Dell P2422H Monitor',
        merk: 'Dell',
        model: 'P2422H',
        videoInputs: 'DisplayPort / HDMI',
        leverancier_class: 'Class B',
        meldingen: '',
        batchId: 'monitor_batch_supplier_grade',
        batchNummer: 'MONGRADE'
      }, {
        sticker: 'MON-FUNC-1',
        deviceName: 'Dell P2422H Monitor',
        merk: 'Dell',
        model: 'P2422H',
        videoInputs: 'DisplayPort / HDMI',
        leverancier_class: 'Class B',
        meldingen: 'Functional unit, not refurbished',
        batchId: 'monitor_batch_supplier_grade',
        batchNummer: 'MONGRADE'
      }, {
        sticker: 'MON-A-1',
        deviceName: 'Dell P2422H Monitor',
        merk: 'Dell',
        model: 'P2422H',
        videoInputs: 'DisplayPort / HDMI',
        leverancier_class: 'Class A',
        meldingen: '',
        batchId: 'monitor_batch_supplier_grade',
        batchNummer: 'MONGRADE'
      }]
    });
    rebuildMonitorIndex();
    STATE.currentScreen = 'monitor_label_scan';
    selectMonitorForLabel('MON-B-1');
  `, app);

  assert.match(app.__appElement.innerHTML, /Note: supplier notice/);
  assert.match(app.__appElement.innerHTML, /Device Errors/);
  assert.match(app.__appElement.innerHTML, /Diepere kras op voet/);
  assert.match(app.__appElement.innerHTML, /monitor-port-count[^>]*>1x<\/strong><span>DP</);
  assert.match(app.__appElement.innerHTML, /monitor-port-count[^>]*>1x<\/strong><span>HDMI</);
  assert.doesNotMatch(app.__appElement.innerHTML, /B-grade in Excel/);

  vm.runInContext(`selectMonitorForLabel('MON-B-2');`, app);
  assert.doesNotMatch(app.__appElement.innerHTML, /Note: supplier notice/);
  assert.doesNotMatch(app.__appElement.innerHTML, /Device Errors/);

  vm.runInContext(`selectMonitorForLabel('MON-FUNC-1');`, app);
  assert.doesNotMatch(app.__appElement.innerHTML, /Note: supplier notice/);
  assert.doesNotMatch(app.__appElement.innerHTML, /Functional unit/);
  assert.doesNotMatch(app.__appElement.innerHTML, /not refurbished/);

  vm.runInContext(`selectMonitorForLabel('MON-A-1');`, app);
  assert.doesNotMatch(app.__appElement.innerHTML, /Note: supplier notice/);
  assert.doesNotMatch(app.__appElement.innerHTML, /Device Errors/);
});

test('specs-label bevat kernspecificaties en grade', () => {
  const app = loadAppSandbox();
  const rows = app.getLabelRows({
    merk: 'Dell',
    model: 'Latitude 7420',
    processor: 'i5-1135G7',
    ram: '16GB',
    ssd: '512GB',
    display: 'touch 14"',
    battery: '88%',
    gpu: '',
  }, { eindgrade: 'B' });

  assert.equal(rows[0], 'Dell Latitude 7420');
  assert.match(rows[1], /i5-1135G7 \/ 16GB \/ 512GB/);
  assert.equal(rows[2], 'Grade B / Touch Ja');
  assert.equal(rows[3], 'Accu 88%');
});

test('origineel specs-label houdt lange laptoptekst binnen 54x25mm', () => {
  const app = loadAppSandbox();
  const rows = app.getLabelRows({
    merk: 'HP',
    model: 'ZBook Fury 15 G8 Mobile Workstation',
    processor: 'i7-11850H',
    ram: '32GB',
    ssd: '510GB',
    display: '15"',
    battery: '74%',
    gpu: 'NVIDIA GA107GLM [RTX A2000 Mobile]',
  }, { eindgrade: 'A' }, 'specs');

  assert.equal(rows[2], 'Grade A / Touch Nee');
  assert.equal(rows[3], 'Accu 74% / NVIDIA RTX A2000');
  assert.doesNotMatch(rows[3], /GA107GLM/);

  const xml = app.buildDymoLabelXml(rows, 'specs');
  assert.match(xml, /HP ZBook Fury 15 G8 Mobile Workstation/);
  assert.match(xml, /<Bounds X="170" Y="50" Width="2770" Height="330"/);
  assert.doesNotMatch(xml, /<Name>GRADE_DIVIDER<\/Name>/);
  assert.doesNotMatch(xml, /<Name>GRADE_BADGE<\/Name>/);
  assert.doesNotMatch(xml, /<Name>GRADE_BAR_/);

  const bounds = Array.from(xml.matchAll(/<Bounds X="(\d+)" Y="(\d+)" Width="(\d+)" Height="(\d+)"/g))
    .map(match => match.slice(1).map(Number));
  assert.equal(bounds.length, 4);
  bounds.forEach(([x, y, width, height]) => {
    assert.ok(x >= 0, `negative X ${x}`);
    assert.ok(y >= 0, `negative Y ${y}`);
    assert.ok(x + width <= 3060, `DYMO object exceeds label width: ${x} + ${width}`);
    assert.ok(y + height <= 1440, `DYMO object exceeds label height: ${y} + ${height}`);
  });

  const printHtml = vm.runInContext(`
    let html = '';
    window.open = function() {
      return {
        document: {
          write(value) { html += value; },
          close() {}
        },
        focus() {},
        print() {}
      };
    };
    openBrowserPrintLabel(${JSON.stringify(rows)}, 'specs', null, getBrowserPrintProfiles().dymoLabel);
    html;
  `, app);

  assert.doesNotMatch(printHtml, /specs-has-grade/);
  assert.doesNotMatch(printHtml, /specs-grade-box/);
  assert.doesNotMatch(printHtml, /grade-bars/);
  assert.match(printHtml, /NVIDIA RTX A2000/);
  assert.doesNotMatch(printHtml, /GA107GLM/);
});

test('DYMO originele specs-layout blijft full-width bij ThinkPad tekst', () => {
  const app = loadAppSandbox();
  const rows = app.getLabelRows({
    merk: 'Lenovo',
    model: 'ThinkPad T590',
    processor: 'i7-8665U',
    ram: '16GB',
    ssd: '512GB',
    display: '15"',
    battery: '81%',
    gpu: '',
  }, { eindgrade: 'B' }, 'specs');
  const xml = app.buildDymoLabelXml(rows, 'specs');

  assert.equal(rows[0], 'Lenovo ThinkPad T590');
  assert.equal(rows[2], 'Grade B / Touch Nee');
  assert.equal(rows[3], 'Accu 81%');
  assert.doesNotMatch(xml, /<Name>GRADE_BADGE<\/Name>/);
  assert.doesNotMatch(xml, /<Name>GRADE_DIVIDER<\/Name>/);
  assert.match(xml, /<Bounds X="170" Y="970" Width="2770" Height="310"/);

  const bounds = Array.from(xml.matchAll(/<Bounds X="(\d+)" Y="(\d+)" Width="(\d+)" Height="(\d+)"/g))
    .map(match => match.slice(1).map(Number));
  assert.equal(bounds.length, 4);
  bounds.forEach(([x, y, width, height]) => {
    assert.ok(x >= 0 && y >= 0, `object starts outside label: ${x},${y}`);
    assert.ok(x + width <= 3060, `object exceeds label width: ${x} + ${width}`);
    assert.ok(y + height <= 1440, `object exceeds label height: ${y} + ${height}`);
  });
});

test('touchcorrectie overschrijft leveranciersdisplay op specs-label', () => {
  const app = loadAppSandbox();
  const correctedNo = app.getLabelRows({
    merk: 'Dell',
    model: 'Latitude 7420',
    processor: 'i5-1135G7',
    ram: '16GB',
    ssd: '512GB',
    display: 'touch 14"',
    touchOverride: 'no',
  }, { eindgrade: 'B' });
  const correctedYes = app.getLabelRows({
    merk: 'HP',
    model: 'EliteBook 840',
    processor: 'i5',
    ram: '16GB',
    ssd: '512GB',
    display: '14"',
    touchOverride: 'yes',
  }, { eindgrade: 'B' });

  assert.equal(correctedNo[2], 'Grade B / Touch Nee');
  assert.equal(correctedYes[2], 'Grade B / Touch Ja');
});

test('touchcorrectie wordt bewaard in gedeelde state en historie', async () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    BATCHES[0].laptops.push({
      sticker: 'TOUCH-OVERRIDE-1',
      merk: 'Dell',
      model: 'Latitude 7420',
      processor: 'i5-1135G7',
      ram: '16GB',
      ssd: '512GB',
      display: 'touch 14"',
      battery: '91%',
      gpu: '',
      leverancier_class: 'Class B',
      meldingen: '',
      batchId: BATCHES[0].id,
      batchNummer: BATCHES[0].nummer
    });
    rebuildLaptopIndex();
  `, app);

  await app.selectLaptop('TOUCH-OVERRIDE-1');
  assert.doesNotMatch(app.__appElement.innerHTML, /touch-override-panel/);

  vm.runInContext(`startGrading('beginner'); render();`, app);
  const lcdIndex = vm.runInContext(`getGradingOnderdelen().findIndex(component => component.id === 'lcd')`, app);
  for (let index = 0; index < lcdIndex; index++) {
    await app.handleAction('next_q', { dataset: {} });
  }
  assert.match(app.__appElement.innerHTML, /Touch yes/);
  assert.match(app.__appElement.innerHTML, /Touch no/);
  assert.doesNotMatch(app.__appElement.innerHTML, /Volgens lijst \(/);

  await app.handleAction('set_touch_override', { dataset: { touchOverride: 'no' } });

  assert.equal(vm.runInContext("getLaptopBySticker('TOUCH-OVERRIDE-1').touchOverride", app), 'no');
  assert.equal(vm.runInContext("isTouchscreenLaptop(getLaptopBySticker('TOUCH-OVERRIDE-1'))", app), false);
  assert.equal(vm.runInContext("getLabelRows(getLaptopBySticker('TOUCH-OVERRIDE-1'), { eindgrade: 'B' })[2]", app), 'Grade B / Touch Nee');
  assert.equal(vm.runInContext("getSharedDemoSnapshot().batches[0].laptops.find(laptop => laptop.sticker === 'TOUCH-OVERRIDE-1').touchOverride", app), 'no');

  vm.runInContext(`
    STATE.currentLaptop = getLaptopBySticker('TOUCH-OVERRIDE-1');
    STATE.currentGrading = {
      gestart: Date.now() - 1000,
      bevestigd: Date.now(),
      modus: 'expert',
      keuzes: {},
      triggers: {},
      impactOverrides: {},
      repairIssues: {},
      result: { eindgrade: 'B', score: 10, problems: [] }
    };
    saveGrading();
  `, app);

  assert.equal(vm.runInContext("STATE.history.find(item => item.sticker === 'TOUCH-OVERRIDE-1').touchOverride", app), 'no');
});

test('DYMO specs-label gebruikt 25x54mm S0722520 template', () => {
  const app = loadAppSandbox();
  const config = app.getDymoLabelConfig();
  const xml = app.buildDymoLabelXml([
    'Dell Latitude 7420',
    'i5-1135G7 / 16GB / 512GB',
    'Grade B / Touch Ja',
    'Accu 88%',
  ], 'specs');

  assert.equal(config.productCode, 'S0722520');
  assert.equal(config.labelSize, 'LW 25x54mm');
  assert.equal(config.paperName, '11352 Return Address Int');
  assert.match(xml, /<PaperOrientation>Landscape<\/PaperOrientation>/);
  assert.match(xml, /<Id>ReturnAddressInt<\/Id>/);
  assert.match(xml, /<PaperName>11352 Return Address Int<\/PaperName>/);
  assert.match(xml, /<RoundRectangle X="0" Y="0" Width="1440" Height="3060"/);
  assert.match(xml, /<Name>ROW_1<\/Name>/);
  assert.match(xml, /<Bounds X="170" Y="50" Width="2770" Height="330"/);
  assert.match(xml, /<Font Family="Arial" Size="13"/);
  assert.match(xml, /Dell Latitude 7420/);
});

test('DYMO printerselectie kiest LabelWriter 450 wanneer beschikbaar', () => {
  const app = loadAppSandbox();
  const printer = app.findPreferredDymoPrinter([
    { name: 'Microsoft Print to PDF', modelName: '', isConnected: true },
    { name: 'DYMO LabelWriter 550', modelName: 'LabelWriter 550', isConnected: true },
    { name: 'DYMO LabelWriter 450', modelName: 'LabelWriter 450', isConnected: true },
  ]);

  assert.equal(printer.name, 'DYMO LabelWriter 450');
});

test('browserfallback gebruikt korte HP Engage bon op 80mm papier', () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    navigator = {
      userAgent: 'Mozilla/5.0 (Linux; Android 13; HP Engage One Prime) Chrome/125',
      platform: 'Linux armv8l',
      maxTouchPoints: 10
    };
  `, app);

  const profile = app.getBrowserPrintProfile();
  const markup = app.getBrowserLabelMarkup([
    'HP EliteBook 840',
    'i5 / 16GB / 512GB',
    'Grade B / Touch Nee',
    'Accu 90%'
  ], 'specs', profile);

  assert.equal(profile.id, 'hp-engage-80x297');
  assert.equal(profile.widthMm, 80);
  assert.equal(profile.heightMm, 86);
  assert.equal(profile.printableWidthMm, 48);
  assert.equal(profile.leftOffsetMm, 22);
  assert.equal(markup.scaleClass, 'receipt-mode');
  assert.match(markup.labelHtml, /SPECS LABEL/);
  assert.match(markup.labelHtml, /HP EliteBook 840/);
  const printHtml = vm.runInContext(`
    let html = '';
    window.open = function() {
      return {
        document: {
          write(value) { html += value; },
          close() {}
        },
        focus() {},
        print() {}
      };
    };
    openBrowserPrintLabel([
      'HP EliteBook 840',
      'i5 / 16GB / 512GB',
      'Grade B / Touch Nee',
      'Accu 90%'
    ], 'specs', null, getBrowserPrintProfile());
    html;
  `, app);
  assert.match(printHtml, /width: 48mm/);
  assert.match(printHtml, /margin: 0 0 0 22mm/);
  assert.match(printHtml, /font-size: 9\.5pt/);
  assert.equal(app.getHpEngagePageHeightMm([
    'HP EliteBook 840',
    'i5 / 16GB / 512GB',
    'Grade B / Touch Nee',
    'Accu 90%'
  ], 'specs'), 78);
});

test('monitor browserfallback blijft exact DYMO 54x25mm op touchapparaat', () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    navigator = {
      userAgent: 'Mozilla/5.0 (Linux; Android 13; HP Engage One Prime) Chrome/125',
      platform: 'Linux armv8l',
      maxTouchPoints: 10
    };
  `, app);

  const defaultProfile = app.getBrowserPrintProfile();
  const monitorProfile = app.getMonitorBrowserPrintProfile();
  const markup = app.getBrowserLabelMarkup([
    'Demo P2422H Monitor',
    'Grade B / 24" / 1920x1080',
    'Video in: HDMI / DP'
  ], 'monitor', monitorProfile);

  assert.equal(defaultProfile.id, 'hp-engage-80x297');
  assert.equal(monitorProfile.id, 'dymo-label-54x25');
  assert.equal(monitorProfile.widthMm, 54);
  assert.equal(monitorProfile.heightMm, 25);
  assert.match(markup.scaleClass, /monitor-label/);

  const printHtml = vm.runInContext(`
    let html = '';
    window.open = function() {
      return {
        document: {
          write(value) { html += value; },
          close() {}
        },
        focus() {},
        print() {}
      };
    };
    openBrowserPrintLabel([
      'Demo P2422H Monitor',
      'Grade B / 24" / 1920x1080',
      'Video in: HDMI / DP'
    ], 'monitor', null, getMonitorBrowserPrintProfile());
    html;
  `, app);

  assert.match(printHtml, /@page \{ size: 54mm 25mm; margin: 0; \}/);
  assert.match(printHtml, /width: 54mm;/);
  assert.match(printHtml, /height: 25mm;/);
  assert.match(printHtml, /setTimeout\(printLabel, 500\)/);
});

test('analyse vergelijkt leverancier-grading met ReMarkt-grading per batch', () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    STATE.history = [
      { sticker: 'UP-1', batchNummer: '50737', merk: 'Dell', model: 'Latitude', grade: 'A', score: 0, leverancier_class: 'Class B', user_id: 'tim', user_naam: 'Tim', result: { problems: [] } },
      { sticker: 'EQ-1', batchNummer: '50737', merk: 'HP', model: 'EliteBook', grade: 'B', score: 10, leverancier_class: 'Class B', user_id: 'tim', user_naam: 'Tim', result: { problems: [] } },
      { sticker: 'DOWN-1', batchNummer: '50737', merk: 'Lenovo', model: 'ThinkPad', grade: 'C', score: 25, leverancier_class: 'Class B', user_id: 'tim', user_naam: 'Tim', result: { problems: ['LCD kras'] } },
    ];
  `, app);

  const stats = vm.runInContext('getSupplierComparisonStats(STATE.history)', app);
  assert.equal(stats.summary.total, 3);
  assert.equal(stats.summary.improved, 1);
  assert.equal(stats.summary.same, 1);
  assert.equal(stats.summary.downgraded, 1);
  assert.equal(stats.summary.improvedPercent, 33);
  assert.equal(stats.summary.netDelta, 0);
  assert.equal(stats.batches[0].toAFromLower, 1);

  const exportRows = vm.runInContext("getSupplierComparisonExportRows('50737')", app);
  assert.equal(exportRows.length, 3);
  assert.equal(exportRows[0]['Supplier grade'], 'B');
  assert.equal(exportRows[0]['ReMarkt grade'], 'A');
  assert.equal(exportRows[0].Status, 'Improved');

  // De leveranciersvergelijking staat nu op de Batchkwaliteit-tab.
  vm.runInContext(`STATE.currentScreen = 'analytics'; setAnalyticsTab('batch'); render();`, app);
  assert.match(app.__appElement.innerHTML, /Supplier vs ReMarkt/);
  assert.match(app.__appElement.innerHTML, /B -&gt; A/);
  assert.match(app.__appElement.innerHTML, /Export Report/);
});

test('leverancierexport bevat ook niet gescande laptops uit de batch', () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    STATE.history = [{
      sticker: '8460024',
      batchId: 'batch_50375',
      batchNummer: '50375',
      merk: 'HP',
      model: 'EliteBook 645 G9',
      grade: 'A',
      score: 0,
      leverancier_class: 'Class A',
      user_id: 'tim',
      user_naam: 'Tim',
      result: { problems: [] }
    }];
    rebuildHistoryIndexes();
  `, app);

  const exportRows = vm.runInContext("getSupplierComparisonExportRows('batch_50375')", app);
  const gradedRow = exportRows.find(row => row.Barcode === '8460024');
  const openRow = exportRows.find(row => row.Barcode === '7268073');

  assert.equal(exportRows.filter(row => row.Barcode === '8460024').length, 1);
  assert.equal(gradedRow.Status, 'Matched');
  assert.equal(openRow.Status, 'Not scanned');
  assert.equal(openRow['Supplier grade'], 'C');
  assert.equal(openRow['ReMarkt grade'], '-');
  assert.match(openRow['Supplier notes'], /Behuizingsschade/);
});

test('analyse houdt nieuwe batches apart bij gelijke zichtbare batchnaam', () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    STATE.history = [
      { sticker: 'BATCH-A-1', batchId: 'batch_50737_first', batchNummer: '50737', merk: 'Dell', model: 'Latitude', grade: 'A', score: 0, leverancier_class: 'Class B', user_id: 'tim', user_naam: 'Tim', result: { problems: [] } },
      { sticker: 'BATCH-B-1', batchId: 'batch_50737_second', batchNummer: '50737', merk: 'HP', model: 'EliteBook', grade: 'C', score: 25, leverancier_class: 'Class B', user_id: 'tim', user_naam: 'Tim', result: { problems: [] } },
    ];
  `, app);

  const stats = vm.runInContext('getSupplierComparisonStats(STATE.history)', app);
  assert.equal(stats.batches.length, 2);
  assert.equal(stats.batches.find(batch => batch.batchKey === 'batch_50737_first').improved, 1);
  assert.equal(stats.batches.find(batch => batch.batchKey === 'batch_50737_second').downgraded, 1);

  const firstExport = vm.runInContext("getSupplierComparisonExportRows('batch_50737_first')", app);
  const secondExport = vm.runInContext("getSupplierComparisonExportRows('batch_50737_second')", app);
  assert.equal(firstExport.length, 1);
  assert.equal(secondExport.length, 1);
  assert.equal(firstExport[0].Barcode, 'BATCH-A-1');
  assert.equal(secondExport[0].Barcode, 'BATCH-B-1');
});

test('probleem-label zet X-keuze en defect-trigger als reparatie op sticker', () => {
  const app = loadAppSandbox();
  const laptop = {
    merk: 'Dell',
    model: 'Latitude 7420',
    sticker: 'REP-001',
    display: '14"',
  };

  const xChoices = allChoices(app, 'A');
  xChoices.lcd = 'D';
  const xResult = app.calculateGrade(xChoices, {});
  xResult.problems = app.buildProblemRows(xChoices, {});
  const xRows = app.getLabelRows(laptop, xResult, 'problems');

  assert.equal(xResult.eindgrade, 'D');
  assert.equal(xRows[0], 'REPARATIE');
  assert.doesNotMatch(xRows.join('|'), /GRADE/i);
  assert.match(xRows[1], /Geen reparatieomschrijving/i);

  const triggerChoices = allChoices(app, 'A');
  const triggerResult = app.calculateGrade(triggerChoices, { touchpad_kapot: true });
  triggerResult.problems = app.buildProblemRows(triggerChoices, { touchpad_kapot: true });
  const triggerRows = app.getLabelRows(laptop, triggerResult, 'problems');

  assert.equal(triggerResult.eindgrade, 'D');
  assert.equal(triggerRows[0], 'REPARATIE');
  assert.doesNotMatch(triggerRows.join('|'), /GRADE/i);
  assert.match(triggerRows[1], /TP not working|Touchpad not working/i);
});

test('reparatielabel neemt missing key mee maar negeert safety marking', () => {
  const app = loadAppSandbox();
  const laptop = {
    merk: 'Dell',
    model: 'Latitude 7420',
    sticker: 'REP-KEY',
    meldingen: 'Safety marking',
  };
  const result = {
    eindgrade: 'D',
    problems: ['Missing key'],
    forceProblemLabel: true,
  };
  const rows = app.getLabelRows(laptop, result, 'problems');

  assert.equal(rows[0], 'REPARATIE');
  assert.match(rows.join('|'), /Missing key/);
  assert.doesNotMatch(rows.join('|'), /Safety marking/i);
  assert.doesNotMatch(rows.join('|'), /GRADE/i);
});

test('X-keuze vraagt specifieke reden en zet die op het reparatielabel', () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    STATE.currentLaptop = getLaptopBySticker('8460024');
    startGrading('beginner');
    getGradingOnderdelen().forEach(component => {
      STATE.currentGrading.keuzes[component.id] = 'A';
    });
    STATE.currentGrading.huidigeIndex = getGradingOnderdelen().findIndex(component => component.id === 'lcd');
    applyComponentChoice('lcd', 'D', false);
  `, app);

  assert.match(vm.runInContext('STATE.pendingDecision && STATE.pendingDecision.title', app), /LCD X Reden/);
  assert.match(app.__appElement.innerHTML, /Pixel line/);
  assert.match(app.__appElement.innerHTML, /Cracked screen/);

  vm.runInContext(`
    resolvePendingDecision(0);
    finishGrading();
  `, app);

  assert.equal(vm.runInContext('STATE.currentGrading.result.eindgrade', app), 'A');
  assert.equal(vm.runInContext('STATE.currentGrading.result.gradeAfterRepair', app), true);
  assert.equal(vm.runInContext('STATE.currentGrading.result.repairLabelType', app), 'direct');
  assert.equal(vm.runInContext('STATE.currentGrading.result.forceProblemLabel', app), true);
  assert.match(vm.runInContext('STATE.currentGrading.result.problems.join("|")', app), /LCD pixel line/);

  const rows = vm.runInContext("getLabelRows(STATE.currentLaptop, STATE.currentGrading.result, 'problems')", app);
  assert.equal(rows[0], 'REPARATIE');
  assert.match(rows.join('|'), /LCD pixel line/);
  assert.doesNotMatch(rows.join('|'), /GRADE/i);
});

test('twee lichte productie-reparaties houden grade na reparatie en productie-label', () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    STATE.currentLaptop = getLaptopBySticker('8460024');
    startGrading('beginner');
    getGradingOnderdelen().forEach(component => {
      STATE.currentGrading.keuzes[component.id] = 'A';
    });
    STATE.currentGrading.keuzes.keyboard = 'D';
    STATE.currentGrading.impactOverrides.keyboard = 'x';
    STATE.currentGrading.repairIssues.keyboard = 'Missing key';
    STATE.currentGrading.repairActions.keyboard = createRepairAction('keyboard', 'Missing key', { repairRoute: 'production', repairSeverity: 'light' });
    STATE.currentGrading.keuzes.touchpad = 'D';
    STATE.currentGrading.impactOverrides.touchpad = 'x';
    STATE.currentGrading.repairIssues.touchpad = 'Touchpad werkt niet';
    STATE.currentGrading.repairActions.touchpad = createRepairAction('touchpad', 'Touchpad werkt niet', { repairRoute: 'production', repairSeverity: 'light' });
    finishGrading();
  `, app);

  assert.equal(vm.runInContext('STATE.currentGrading.result.eindgrade', app), 'A');
  assert.equal(vm.runInContext('STATE.currentGrading.result.gradeAfterRepair', app), true);
  assert.equal(vm.runInContext('STATE.currentGrading.result.repairLabelType', app), 'production');
  assert.equal(vm.runInContext('STATE.currentGrading.result.repairPolicy.lightCount', app), 2);

  const specsRows = vm.runInContext("getLabelRows(STATE.currentLaptop, STATE.currentGrading.result, 'specs')", app);
  assert.match(specsRows[2], /Grade A/);

  const productionRows = vm.runInContext("getLabelRows(STATE.currentLaptop, STATE.currentGrading.result, 'problems')", app);
  assert.equal(productionRows[0], 'PRODUCTIE');
  assert.equal(productionRows[1], 'Tijdens productie repareren');
  assert.match(productionRows.join('|'), /Missing key/);
  assert.match(productionRows.join('|'), /TP werkt niet|Touchpad werkt niet/);
});

test('keyboard defect, keyboard ontbreekt en dead battery zijn productie-reparaties', () => {
  const app = loadAppSandbox();
  const keyboardReasons = app.getChoiceDecision('keyboard', 'D').options[1].nextDecision.options;

  assert.equal(keyboardReasons[1].label, 'Keyboard defect');
  assert.equal(keyboardReasons[1].repairRoute, 'production');
  assert.equal(keyboardReasons[1].repairSeverity, 'light');
  assert.equal(keyboardReasons[2].label, 'Keyboard ontbreekt');
  assert.equal(keyboardReasons[2].repairRoute, 'production');
  assert.equal(keyboardReasons[2].repairSeverity, 'light');

  const inferredActions = JSON.parse(vm.runInContext(`JSON.stringify([
    createRepairAction('keyboard', 'Keyboard ontbreekt'),
    createRepairAction('battery', 'dead battery')
  ].map(action => ({ route: action.repairRoute, severity: action.repairSeverity })))`, app));
  assert.deepEqual(inferredActions, [
    { route: 'production', severity: 'light' },
    { route: 'production', severity: 'light' },
  ]);

  vm.runInContext(`
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    STATE.currentLaptop = getLaptopBySticker('8460024');
    startGrading('beginner');
    getGradingOnderdelen().forEach(component => {
      STATE.currentGrading.keuzes[component.id] = 'A';
    });
    STATE.currentGrading.huidigeIndex = getGradingOnderdelen().findIndex(component => component.id === 'keyboard');
    applyComponentChoice('keyboard', 'D', false);
    resolvePendingDecision(1);
    resolvePendingDecision(1);
    finishGrading();
  `, app);

  assert.equal(vm.runInContext('STATE.currentGrading.result.repairLabelType', app), 'production');
  assert.equal(vm.runInContext('STATE.currentGrading.result.repairPolicy.lightCount', app), 1);
  assert.match(vm.runInContext('STATE.currentGrading.result.problems.join("|")', app), /Keyboard defect/);

  const rows = vm.runInContext("getLabelRows(STATE.currentLaptop, STATE.currentGrading.result, 'problems')", app);
  assert.equal(rows[0], 'PRODUCTIE');
  assert.equal(rows[1], 'Tijdens productie repareren');
});

test('twee zware reparaties blijven X en krijgen niet-verkoopbaar label', () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    STATE.currentLaptop = getLaptopBySticker('8460024');
    startGrading('beginner');
    getGradingOnderdelen().forEach(component => {
      STATE.currentGrading.keuzes[component.id] = 'A';
    });
    STATE.currentGrading.keuzes.lcd = 'D';
    STATE.currentGrading.impactOverrides.lcd = 'x';
    STATE.currentGrading.repairIssues.lcd = 'LCD pixel line';
    STATE.currentGrading.repairActions.lcd = createRepairAction('lcd', 'LCD pixel line', { repairRoute: 'direct', repairSeverity: 'heavy' });
    STATE.currentGrading.keuzes.scharnieren = 'D';
    STATE.currentGrading.impactOverrides.scharnieren = 'x';
    STATE.currentGrading.repairIssues.scharnieren = 'Scharnier werkt niet';
    STATE.currentGrading.repairActions.scharnieren = createRepairAction('scharnieren', 'Scharnier werkt niet', { repairRoute: 'direct', repairSeverity: 'heavy' });
    finishGrading();
  `, app);

  assert.equal(vm.runInContext('STATE.currentGrading.result.eindgrade', app), 'D');
  assert.equal(vm.runInContext('STATE.currentGrading.result.gradeAfterRepair', app), undefined);
  assert.equal(vm.runInContext('STATE.currentGrading.result.repairLabelType', app), 'reject');
  assert.equal(vm.runInContext('STATE.currentGrading.result.repairPolicy.heavyCount', app), 2);

  const specsRows = vm.runInContext("getLabelRows(STATE.currentLaptop, STATE.currentGrading.result, 'specs')", app);
  assert.match(specsRows[2], /Grade X/);

  const rejectRows = vm.runInContext("getLabelRows(STATE.currentLaptop, STATE.currentGrading.result, 'problems')", app);
  assert.equal(rejectRows[0], 'NIET VERKOOPBAAR');
  assert.match(rejectRows[1], /Te veel zware reparaties/);
  assert.match(rejectRows.join('|'), /LCD pixel line/);
  assert.match(rejectRows.join('|'), /Hinge werkt niet|Scharnier werkt niet/);
});

test('nieuwe detailkeuzes voor schermrand bovenkap en zijkant sturen score scherper', () => {
  const app = loadAppSandbox();

  assert.equal(app.getChoiceDecision('bezel', 'B').options[0].impact, 'a-minus');
  assert.equal(app.getChoiceDecision('bezel', 'B').options[1].impact, 'b-minus');
  assert.equal(app.getChoiceDecision('bezel', 'C').options[0].impact, 'b-minus');
  assert.equal(app.getChoiceDecision('bezel', 'C').options[1].impact, 'c');
  assert.notEqual(app.getChoiceDecision('bezel', 'B').options[1].image, app.getChoiceDecision('bezel', 'C').options[0].image);

  assert.equal(app.getChoiceDecision('bovenkap', 'B').options[0].impact, 'a-minus');
  assert.equal(app.getChoiceDecision('bovenkap', 'B').options[1].impact, 'b');
  assert.equal(app.getChoiceDecision('bovenkap', 'B').options[2].impact, 'b');
  assert.equal(app.getChoiceDecision('bovenkap', 'C').options[0].impact, 'b-minus');
  assert.equal(app.getChoiceDecision('bovenkap', 'C').options[1].impact, 'c');
  assert.equal(app.getChoiceDecision('bovenkap', 'C').options[2].impact, 'c');

  const repairableSide = app.getChoiceDecision('randen', 'C').options[0];
  const nonRepairableSide = app.getChoiceDecision('randen', 'C').options[1];
  assert.equal(repairableSide.impact, 'a');
  assert.match(repairableSide.repairIssue, /Zijkant open\/verbogen rechtmaken/);
  assert.match(repairableSide.image, /randen-open-verbogen-herstelbaar-v3-ai\.jpg$/);
  assert.equal(nonRepairableSide.impact, 'c');
  assert.match(nonRepairableSide.image, /randen-open-verbogen-niet-herstelbaar-dell-ai\.jpg$/);
  assert.equal(vm.runInContext("IMPACT_PROFILES['b-minus'].minGrade", app), 'B');
});

test('LCD toetsafdruk B vraagt grootte en kan lichte impact geven', () => {
  const app = loadAppSandbox();

  const lcdB = app.getChoiceDecision('lcd', 'B');
  assert.match(lcdB.options[0].label, /Toetsafdrukken/);
  assert.equal(lcdB.options[0].impact, 'a-minus');
  assert.match(lcdB.options[0].image, /lcd-keyinprint-b\.jpg$/);
  assert.equal(lcdB.options[0].nextDecision.options[0].impact, 'a-minus');
  assert.equal(lcdB.options[0].nextDecision.options[1].impact, 'a-minus-if-all-other-a');
  assert.equal(lcdB.options[0].nextDecision.options[2].impact, 'b');
  assert.match(lcdB.options[0].nextDecision.options[0].image, /lcd-keyinprint-0-5cm\.jpg$/);
  assert.match(lcdB.options[0].nextDecision.options[1].image, /lcd-keyinprint-5-10cm\.jpg$/);
  assert.match(lcdB.options[0].nextDecision.options[2].image, /lcd-keyinprint-10-plus-cm\.jpg$/);
  assert.equal(lcdB.options[1].impact, 'b');
  assert.equal(lcdB.options[2].impact, 'b');

  const choices = allChoices(app, 'A');
  choices.lcd = 'B';

  const smallKeyprint = app.calculateGrade(choices, {}, { lcd: 'a-minus' });
  assert.equal(smallKeyprint.eindgrade, 'A');
  assert.equal(smallKeyprint.score, 2);
  assert.equal(smallKeyprint.detailRows.find(row => row.naam === 'LCD & Glass').impact, 'A-');

  const mediumKeyprintWithAllOtherA = app.calculateGrade(choices, {}, { lcd: 'a-minus-if-all-other-a' });
  assert.equal(mediumKeyprintWithAllOtherA.eindgrade, 'A');
  assert.equal(mediumKeyprintWithAllOtherA.score, 2);
  assert.equal(mediumKeyprintWithAllOtherA.detailRows.find(row => row.naam === 'LCD & Glass').impact, 'A-');

  const mediumKeyprintWithOtherB = app.calculateGrade({
    ...choices,
    bovenkap: 'B',
  }, {}, {
    bovenkap: 'a-minus',
    lcd: 'a-minus-if-all-other-a',
  });
  assert.equal(mediumKeyprintWithOtherB.eindgrade, 'B');
  assert.equal(mediumKeyprintWithOtherB.score, 10);
  assert.equal(mediumKeyprintWithOtherB.detailRows.find(row => row.naam === 'LCD & Glass').impact, 'B');

  const largeKeyprint = app.calculateGrade(choices, {}, { lcd: 'b' });
  assert.equal(largeKeyprint.eindgrade, 'B');
  assert.equal(largeKeyprint.score, 8);
});

test('LCD toetsafdruk workflow opent na B eerst de groottekeuze', () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    STATE.currentLaptop = getLaptopBySticker('8460024');
    startGrading('beginner');
    getGradingOnderdelen().forEach(component => {
      STATE.currentGrading.keuzes[component.id] = 'A';
    });
    STATE.currentGrading.huidigeIndex = getGradingOnderdelen().findIndex(component => component.id === 'lcd');
    applyComponentChoice('lcd', 'B', false);
  `, app);

  assert.match(vm.runInContext('STATE.pendingDecision && STATE.pendingDecision.title', app), /LCD B Detail/);
  assert.match(app.__appElement.innerHTML, /Toetsafdrukken/);

  vm.runInContext(`resolvePendingDecision(0);`, app);
  assert.match(vm.runInContext('STATE.pendingDecision && STATE.pendingDecision.title', app), /toetsafdruk grootte/i);
  assert.match(app.__appElement.innerHTML, /0-5 cm/);
  assert.match(app.__appElement.innerHTML, /5-10 cm/);
  assert.match(app.__appElement.innerHTML, /10\+ cm/);

  vm.runInContext(`
    resolvePendingDecision(1);
    finishGrading();
  `, app);

  assert.equal(vm.runInContext('STATE.currentGrading.result.eindgrade', app), 'A');
  assert.equal(vm.runInContext('STATE.currentGrading.result.score', app), 2);
});

test('herstelbare zijkant geeft A-impact en reparatielabel', async () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    const calls = [];
    printRowsWithDymo = async function(rows, type) {
      calls.push({ type, rows: rows.slice() });
      return { printerName: 'DYMO LabelWriter 450' };
    };
    window.__printCalls = calls;
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    STATE.currentLaptop = getLaptopBySticker('8460024');
    startGrading('beginner');
    getGradingOnderdelen().forEach(component => {
      STATE.currentGrading.keuzes[component.id] = 'A';
    });
    STATE.currentGrading.keuzes.randen = 'C';
    STATE.currentGrading.impactOverrides.randen = 'a';
    STATE.currentGrading.repairIssues.randen = 'Zijkant open/verbogen rechtmaken';
    finishGrading();
  `, app);

  assert.equal(vm.runInContext('STATE.currentGrading.result.eindgrade', app), 'A');
  assert.match(vm.runInContext('STATE.currentGrading.result.problems.join("|")', app), /Zijkant open\/verbogen rechtmaken/);

  await app.confirmSaveWithAutomaticLabels();
  assert.equal(vm.runInContext('window.__printCalls.length', app), 2);
  assert.equal(vm.runInContext('window.__printCalls[1].type', app), 'problems');
});

test('scharnier X opent eerst detailmenu en daarna redenkeuze', () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    startTestGrading('beginner');
    STATE.currentGrading.huidigeIndex = getGradingOnderdelen().findIndex(component => component.id === 'scharnieren');
    applyComponentChoice('scharnieren', 'D', true);
  `, app);

  assert.match(vm.runInContext('STATE.pendingDecision && STATE.pendingDecision.title', app), /Scharnier X Detail/);
  assert.match(app.__appElement.innerHTML, /decision-inline/);
  assert.match(app.__appElement.innerHTML, /Functioneel/);
  assert.match(app.__appElement.innerHTML, /Niet functioneel/);
  assert.match(app.__appElement.innerHTML, /assets\/dell-grading-fast\/scharnier/);

  vm.runInContext(`resolvePendingDecision(1);`, app);
  assert.match(vm.runInContext('STATE.pendingDecision && STATE.pendingDecision.title', app), /Scharnier X Reden/);
  assert.match(app.__appElement.innerHTML, /Scharnier werkt niet/);

  vm.runInContext(`
    STATE.pendingDecision = null;
    startTestGrading('expert');
    applyComponentChoice('scharnieren', 'D', false);
  `, app);

  assert.match(vm.runInContext('STATE.pendingDecision && STATE.pendingDecision.title', app), /Scharnier X Detail/);
});

test('keyboard X behoudt detailmenu en vraagt reparatiereden na defectkeuze', () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    STATE.currentLaptop = getLaptopBySticker('8460024');
    startGrading('beginner');
    STATE.currentGrading.huidigeIndex = getGradingOnderdelen().findIndex(component => component.id === 'keyboard');
    applyComponentChoice('keyboard', 'D', false);
  `, app);

  assert.match(vm.runInContext('STATE.pendingDecision && STATE.pendingDecision.title', app), /Keyboard X Detail/);
  assert.match(app.__appElement.innerHTML, /Toetsen ontbreken/);
  assert.match(app.__appElement.innerHTML, /Keyboard ontbreekt \/ defect/);
  assert.match(app.__appElement.innerHTML, /keyboard-many-missing-keys-ai\.jpg/);

  vm.runInContext(`resolvePendingDecision(0);`, app);
  assert.match(vm.runInContext('STATE.pendingDecision && STATE.pendingDecision.title', app), /Toetsenbord X Reden/);
  assert.match(app.__appElement.innerHTML, /Missing key/);

  vm.runInContext(`resolvePendingDecision(1);`, app);
  assert.equal(vm.runInContext('STATE.currentGrading.repairIssues.keyboard', app), 'Meerdere toetsen ontbreken');

  vm.runInContext(`
    applyComponentChoice('keyboard', 'D', false);
    resolvePendingDecision(1);
  `, app);
  assert.match(vm.runInContext('STATE.pendingDecision && STATE.pendingDecision.title', app), /Toetsenbord X Reden/);
  assert.match(app.__appElement.innerHTML, /Toets werkt niet/);
  assert.match(app.__appElement.innerHTML, /Keyboard defect/);
});

test('keuze-afbeeldingen zijn gecentreerd voor tabletweergave', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'assets', 'remarkt-grading.css'), 'utf8');
  const ui = fs.readFileSync(path.join(__dirname, '..', 'assets', 'ui-rendering.js'), 'utf8');
  const workflow = fs.readFileSync(path.join(__dirname, '..', 'assets', 'app-workflow.js'), 'utf8');

  assert.match(css, /\.decision-option img \{[^}]*object-position: center center/s);
  assert.match(css, /\.workflow-route-card\.monitor-route-card \.workflow-route-banner img \{[^}]*min-height: 260px/s);
  assert.match(css, /\.workflow-route-card\.monitor-route-card \.workflow-route-banner img \{[^}]*object-fit: cover/s);
  assert.match(css, /\.workflow-route-labels\.route-steps-6 \{[^}]*repeat\(6, minmax\(0, 1fr\)\)/s);
  assert.match(css, /\.visual-thumb img \{[^}]*object-position: center center/s);
  assert.match(css, /\.visual-thumb \{[^}]*aspect-ratio: 3 \/ 2/s);
  assert.match(css, /\.grading-visual-screen \.visual-thumb \{[^}]*height: clamp\(288px, 34vh, 394px\)/s);
  assert.match(css, /@media \(max-width: 1100px\) and \(min-width: 641px\) \{[\s\S]*\.grading-visual-screen \.visual-thumb \{ height: clamp\(263px, 31vh, 356px\)/);
  assert.match(css, /\.visual-choice \{[^}]*grid-template-columns: 1fr/s);
  assert.match(css, /\.visual-choice \{[^}]*grid-template-rows: auto minmax\(104px, auto\)/s);
  assert.match(css, /\.visual-copy \{[^}]*min-height: 104px/s);
  assert.match(css, /\.image-preview-overlay \{[^}]*position: fixed/s);
  assert.match(css, /\.image-preview-overlay \{[^}]*top: 0/s);
  assert.match(css, /\.image-preview-overlay \{[^}]*right: 0/s);
  assert.match(css, /\.image-preview-overlay \{[^}]*bottom: 0/s);
  assert.match(css, /\.image-preview-overlay \{[^}]*left: 0/s);
  assert.match(css, /\.image-preview-overlay \{[^}]*align-items: center/s);
  assert.match(css, /\.image-preview-modal \{[^}]*width: 920px/s);
  assert.match(css, /\.image-preview-modal \{[^}]*max-width: calc\(100% - 32px\)/s);
  assert.match(css, /\.image-preview-modal \{[^}]*max-height: calc\(100vh - 32px\)/s);
  assert.match(css, /\.image-preview-body \{[^}]*display: flex/s);
  assert.match(css, /\.image-preview-body \{[^}]*height: 70vh/s);
  assert.match(css, /\.image-preview-body \{[^}]*max-height: calc\(100vh - 96px\)/s);
  assert.match(css, /\.image-preview-modal img \{[^}]*object-fit: contain/s);
  assert.match(css, /\.image-preview-modal img \{[^}]*object-position: center center/s);
  assert.match(css, /\.image-preview-close \{[^}]*min-height: 40px/s);
  assert.match(css, /\.visual-zoom-action \{[^}]*position: absolute/s);
  assert.match(css, /\.visual-zoom-action \{[^}]*width: 48px/s);
  assert.match(css, /\.visual-zoom-action \{[^}]*height: 48px/s);
  assert.match(css, /\.visual-zoom-action \{[^}]*z-index: 30/s);
  assert.match(css, /\.visual-zoom-action \{[^}]*touch-action: manipulation/s);
  assert.match(css, /@media \(max-width: 1100px\) and \(min-width: 641px\) \{[^}]*\.visual-choice-grid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/s);
  assert.match(css, /@media \(max-width: 640px\) \{[\s\S]*\.visual-choice-grid \{ grid-template-columns: 1fr/s);
  assert.match(css, /\.decision-inline \{[^}]*position: fixed/s);
  assert.match(css, /\.decision-inline \{[^}]*top: 0/s);
  assert.match(css, /\.decision-inline \{[^}]*right: 0/s);
  assert.match(css, /\.decision-inline \{[^}]*bottom: 0/s);
  assert.match(css, /\.decision-inline \{[^}]*left: 0/s);
  assert.match(css, /\.decision-inline \{[^}]*width: 100%/s);
  assert.match(css, /\.decision-inline \{[^}]*height: 100dvh/s);
  assert.match(css, /\.decision-inline \{[^}]*z-index: 1200/s);
  assert.match(css, /\.monitor-grade-overlay \{[^}]*height: 100dvh/s);
  assert.match(css, /\.monitor-grade-overlay \{[^}]*align-items: center/s);
  assert.match(css, /\.monitor-grade-overlay \{[^}]*justify-content: center/s);
  assert.match(css, /\.monitor-grade-overlay \{[^}]*overflow: hidden/s);
  assert.match(css, /\.monitor-grade-overlay \{[^}]*z-index: 1200/s);
  assert.match(css, /\.monitor-grade-modal \{[^}]*width: min\(1020px, calc\(100vw - 32px\)\)/s);
  assert.match(css, /@media \(max-width: 1100px\) and \(min-width: 641px\) \{[\s\S]*\.monitor-grade-button \{ min-height: 112px/s);
  assert.match(css, /\.monitor-grade-info-panel \{[^}]*position: absolute/s);
  assert.match(css, /\.monitor-grade-info-panel \{[^}]*top: calc\(100% \+ 8px\)/s);
  assert.match(css, /\.monitor-grade-info-panel \{[^}]*display: none/s);
  assert.match(css, /\.monitor-grade-info-panel\.is-open \{[^}]*display: grid/s);
  assert.match(ui, /monitor-grade-overlay image-preview-overlay/);
  assert.match(ui, /style="position:fixed;top:0;right:0;bottom:0;left:0;z-index:1300/);
  assert.match(ui, /monitor-grade-modal image-preview-modal/);
  assert.match(ui, /style="display:block;width:920px/);
  assert.match(ui, /data-monitor-grade-info-panel/);
  assert.match(workflow, /querySelectorAll\('\[data-monitor-grade-info-panel\]'\)/);
  assert.doesNotMatch(workflow, /STATE\.monitorGradeInfoOpen = STATE\.monitorGradeInfoOpen === normalized \? null : normalized;\s*render\(\);/);
  assert.match(css, /\.monitor-grade-button\.grade-A \{[^}]*--grade-text: #fff/s);
  assert.match(css, /\.monitor-grade-button\.grade-B \{[^}]*--grade-text: #fff/s);
  assert.match(css, /\.monitor-grade-button\.grade-C \{[^}]*--grade-text: #fff/s);
  assert.match(css, /\.monitor-grade-button\.grade-D \{[^}]*--grade-text: #fff/s);
  assert.match(css, /\.monitor-manual-port-picker \{/);
  assert.match(css, /\.monitor-manual-port-picker \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/s);
  assert.match(css, /\.monitor-manual-port-row \{[^}]*grid-template-columns: minmax\(0, 1fr\)/s);
  assert.match(css, /\.monitor-manual-port-buttons \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/s);
  assert.match(css, /\.monitor-manual-port-count-button\.active \{[^}]*background: var\(--remarkt-red\)/s);
  assert.match(css, /\.modal \{[^}]*max-height: calc\(100dvh - 40px\)/s);
  assert.match(css, /touch-action: manipulation/);
});

test('gradingbeelden gebruiken snelle tablet-assets', () => {
  const app = loadAppSandbox();
  const paths = vm.runInContext(`
    Object.values(VISUAL_ASSETS).flatMap(group => Object.values(group))
      .concat(Object.values(CHOICE_DECISIONS).flatMap(decisions =>
        Object.values(decisions).flatMap(decision => decision.options.map(option => option.image).filter(Boolean))
      ))
  `, app);

  assert.ok(paths.length > 0);
  assert.ok(paths.every(assetPath => assetPath.startsWith('assets/dell-grading-fast/')));
  assert.ok(paths.every(assetPath => assetPath.endsWith('.jpg')));
  assert.ok(paths.every(assetPath => !assetPath.includes('wide-ai')));
  assert.ok(paths.some(assetPath => assetPath.endsWith('touchpad-cracked-ai.jpg')));
  assert.ok(paths.some(assetPath => assetPath.endsWith('scharnier-loshangend-ai.jpg')));
  paths.forEach(assetPath => {
    assert.ok(fs.existsSync(path.join(__dirname, '..', assetPath)), `${assetPath} ontbreekt`);
  });

  vm.runInContext(`
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    startTestGrading('beginner');
    render();
  `, app);

  assert.match(app.__appElement.innerHTML, /assets\/dell-grading-fast\//);
  assert.match(app.__appElement.innerHTML, /data-image-preview="true"/);
  assert.match(app.__appElement.innerHTML, /visual-zoom-action/);
  assert.match(app.__appElement.innerHTML, /<circle cx="10\.5" cy="10\.5" r="5\.5"/);
  assert.match(app.__appElement.innerHTML, /fetchpriority="high"/);
  assert.doesNotMatch(app.__appElement.innerHTML, /loading="lazy"/);
});

test('keuze-afbeelding kan vergroot worden zonder keuze te maken', async () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    startTestGrading('beginner');
    render();
    openImagePreviewFromElement({
      dataset: {
        previewSrc: 'assets/dell-grading-fast/bovenkap-a.jpg',
        previewLabel: 'Lid Cover grade A'
      }
    });
  `, app);

  assert.match(app.__appElement.innerHTML, /image-preview-overlay/);
  assert.match(app.__appElement.innerHTML, /data-image-preview-overlay="true"/);
  assert.match(app.__appElement.innerHTML, /image-preview-close/);
  assert.match(app.__appElement.innerHTML, /image-preview-body/);
  assert.match(app.__appElement.innerHTML, /style="position:fixed;top:0;right:0;bottom:0;left:0/);
  assert.match(app.__appElement.innerHTML, /height:70vh;max-height:calc\(100vh - 96px\)/);
  assert.match(app.__appElement.innerHTML, /Lid Cover grade A/);
  assert.equal(vm.runInContext('Boolean(STATE.currentGrading.keuzes.bovenkap)', app), false);

  await app.handleAction('close_image_preview', {});
  assert.equal(vm.runInContext('STATE.imagePreview', app), null);
});

test('detailkeuze-menu heeft loep zonder score-uitleg in tekst', () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    STATE.currentLaptop = getLaptopBySticker('8460024');
    startGrading('beginner');
    STATE.currentGrading.huidigeIndex = getGradingOnderdelen().findIndex(component => component.id === 'randen');
    applyComponentChoice('randen', 'C', false);
  `, app);

  assert.match(app.__appElement.innerHTML, /decision-zoom-action/);
  assert.match(app.__appElement.innerHTML, /data-image-preview="true"/);
  assert.match(app.__appElement.innerHTML, /randen-open-verbogen-herstelbaar-v3-ai\.jpg/);
  assert.doesNotMatch(app.__appElement.innerHTML, /telt als/i);
  assert.doesNotMatch(app.__appElement.innerHTML, /blijft C/i);
});

test('alleen het vergrootglas opent afbeelding, de foto zelf blijft keuze', () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    startTestGrading('beginner');
    render();
  `, app);

  const html = app.__appElement.innerHTML;
  assert.match(html, /<div class="visual-thumb component-bovenkap grade-A">/);
  assert.match(html, /<button class="visual-zoom-action" data-image-preview="true"/);
  assert.doesNotMatch(html, /visual-thumb[^>]+data-image-preview="true"/);
  assert.match(html, /<\/button>\s*<button class="visual-zoom-action" data-image-preview="true"/);
});

test('vergrootglas gebruikt pointer/touch handler voor tablet', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '..', 'assets', 'app-workflow.js'), 'utf8');

  assert.match(workflow, /addEventListener\('pointerdown', handleDelegatedPointerDown, true\)/);
  assert.match(workflow, /addEventListener\('touchstart', handleDelegatedPointerDown, true\)/);
  assert.match(workflow, /function handleDelegatedPointerDown\(e\)/);
  assert.match(workflow, /openImagePreviewFromElement\(imagePreviewTarget\)/);
  assert.match(workflow, /data-image-preview-overlay/);
  assert.match(workflow, /e\.key === 'Escape' && STATE\.imagePreview/);
});

test('header heeft licht/donker knop zonder systeemoptie', async () => {
  const app = loadAppSandbox();
  const css = fs.readFileSync(path.join(__dirname, '..', 'assets', 'remarkt-grading.css'), 'utf8');

  vm.runInContext(`
    document.documentElement = { dataset: {} };
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    STATE.homeTab = 'support';
    STATE.currentScreen = 'home';
    render();
  `, app);

  assert.match(app.__appElement.innerHTML, /theme-toggle/);
  assert.match(app.__appElement.innerHTML, /data-theme-value="dark"/);
  assert.doesNotMatch(app.__appElement.innerHTML, /data-theme-value="system"/);
  assert.doesNotMatch(app.__appElement.innerHTML, /Weergave/);
  assert.match(css, /High-contrast dark mode/);
  assert.match(css, /html\[data-theme="dark"\] \.ops-command/);
  assert.match(css, /html\[data-theme="dark"\] \.workflow-actions \.action-card\.primary-work/);
  assert.match(css, /html\[data-theme="dark"\] \.form-input/);

  await app.handleAction('toggle_theme', { dataset: { themeValue: 'dark' } });
  assert.equal(vm.runInContext('STATE.theme', app), 'dark');
  assert.equal(vm.runInContext('document.documentElement.dataset.theme', app), 'dark');

  await app.handleAction('toggle_theme', { dataset: { themeValue: 'light' } });
  assert.equal(vm.runInContext('STATE.theme', app), 'light');
  assert.equal(vm.runInContext('document.documentElement.dataset.theme', app), 'light');
});

test('volledige expert-workflow slaat grading op en markeert laptop klaar', () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    STATE.currentLaptop = getLaptopBySticker('8460024');
    startGrading('expert');
    getGradingOnderdelen().forEach(component => {
      STATE.currentGrading.keuzes[component.id] = 'A';
    });
    finishGrading();
    saveGrading();
  `, app);

  assert.equal(vm.runInContext('STATE.history.length', app), 1);
  assert.equal(vm.runInContext('STATE.history[0].sticker', app), '8460024');
  assert.equal(vm.runInContext('STATE.history[0].grade', app), 'A');
  assert.equal(vm.runInContext('STATE.history[0].leverancier_class', app), 'Class A');
  assert.equal(vm.runInContext("GRADED_STICKERS.has('8460024')", app), true);
  assert.equal(vm.runInContext('STATE.currentScreen', app), 'scan');
});

test('expertmodus kiest direct een grade en print automatisch', async () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    const calls = [];
    printRowsWithDymo = async function(rows, type) {
      calls.push({ type, rows: rows.slice() });
      return { printerName: 'DYMO LabelWriter 450' };
    };
    window.__printCalls = calls;
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    STATE.currentLaptop = getLaptopBySticker('8460024');
    startGrading('expert');
  `, app);

  vm.runInContext(`render();`, app);
  assert.match(app.__appElement.innerHTML, /data-expert-final-grade="A"/);
  assert.match(app.__appElement.innerHTML, /data-expert-final-grade="D"/);
  assert.match(app.__appElement.innerHTML, /data-monitor-grade-info="A"/);
  assert.match(app.__appElement.innerHTML, /data-monitor-grade-info-panel="D"/);
  assert.doesNotMatch(app.__appElement.innerHTML, /For experienced graders/);
  assert.doesNotMatch(app.__appElement.innerHTML, /Print label/);

  await app.confirmExpertFinalGrade('B');

  assert.equal(vm.runInContext('STATE.history.length', app), 1);
  assert.equal(vm.runInContext('STATE.history[0].grade', app), 'B');
  assert.equal(vm.runInContext('STATE.currentScreen', app), 'scan');
  assert.equal(vm.runInContext('window.__printCalls.length', app), 1);
  assert.equal(vm.runInContext('window.__printCalls[0].type', app), 'specs');
});

test('expertmodus info-knop opent uitleg zonder grade te bevestigen', async () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    let printCount = 0;
    printRowsWithDymo = async function() {
      printCount += 1;
      return { printerName: 'DYMO LabelWriter 450' };
    };
    window.__getPrintCount = () => printCount;
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    STATE.currentLaptop = getLaptopBySticker('8460024');
    startGrading('expert');
    render();
  `, app);

  await vm.runInContext(`(async () => {
    const fakeExpertButton = {
      disabled: false,
      dataset: { expertFinalGrade: 'B' },
      onclick: null
    };
    document.querySelectorAll = selector => selector === '[data-expert-final-grade]' ? [fakeExpertButton] : [];
    bindRenderedControlHandlers();
    fakeExpertButton.onclick({
      preventDefault() {},
      stopPropagation() {},
      target: {
        closest(selector) {
          if (selector === '[data-monitor-grade-info]') return { dataset: { monitorGradeInfo: 'B' } };
          if (selector === '[data-monitor-grade-info-panel]') return null;
          if (selector === '[data-expert-final-grade]') return fakeExpertButton;
          return null;
        }
      }
    });
    await Promise.resolve();
  })()`, app);

  assert.equal(vm.runInContext('STATE.monitorGradeInfoOpen', app), 'B');
  assert.equal(vm.runInContext('STATE.history.length', app), 0);
  assert.equal(vm.runInContext('window.__getPrintCount()', app), 0);
});

test('terug vanuit expertmodus gaat naar apparaat graden scan', async () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    STATE.currentLaptop = getLaptopBySticker('7771198');
    startGrading('expert');
  `, app);

  await app.handleAction('back_scan', { dataset: {} });

  assert.equal(vm.runInContext('STATE.currentScreen', app), 'scan');
  assert.equal(vm.runInContext('STATE.currentGrading', app), null);
  assert.equal(vm.runInContext('STATE.supplierNotice', app), null);
});

test('bevestigen print automatisch specs en reparatie-label voor X-resultaat', async () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    const openedPrintWindows = [];
    window.open = function(url, name) {
      const printWindow = {
        name,
        closed: false,
        document: {
          html: '',
          write(value) { this.html += value; },
          close() {}
        },
        close() { this.closed = true; },
        focus() {},
        print() {}
      };
      openedPrintWindows.push(printWindow);
      return printWindow;
    };
    window.__openedPrintWindows = openedPrintWindows;
    printRowsWithDymo = async function(rows, type) {
      return { printerName: 'DYMO LabelWriter 450', type };
    };
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    STATE.currentLaptop = getLaptopBySticker('7771198');
    startGrading('expert');
    getGradingOnderdelen().forEach(component => {
      STATE.currentGrading.keuzes[component.id] = 'A';
    });
    STATE.currentGrading.triggers.pixel_lcd = true;
    finishGrading();
  `, app);

  await app.handleAction('confirm_save', {});

  assert.equal(vm.runInContext('STATE.history.length', app), 1);
  assert.equal(vm.runInContext('STATE.history[0].grade', app), 'A');
  assert.equal(vm.runInContext('STATE.history[0].result.repairOriginalGrade', app), 'D');
  assert.equal(vm.runInContext('STATE.history[0].result.repairLabelType', app), 'direct');
  assert.equal(vm.runInContext('STATE.currentScreen', app), 'scan');
  assert.equal(vm.runInContext("STATE.auditLogs.filter(log => log.action === 'print_label' && log.details.type === 'specs').length", app), 1);
  assert.equal(vm.runInContext("STATE.auditLogs.filter(log => log.action === 'print_label' && log.details.type === 'problems').length", app), 1);
  assert.equal(vm.runInContext('window.__openedPrintWindows.length', app), 0);
});

test('automatisch akkoord print niet via browserfallback bij DYMO-fout', async () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    const openedPrintWindows = [];
    window.open = function(url, name) {
      if (openedPrintWindows.length > 0) return null;
      const printWindow = {
        name,
        closed: false,
        document: {
          html: '',
          write(value) { this.html += value; },
          close() {}
        },
        close() { this.closed = true; },
        focus() {},
        print() {}
      };
      openedPrintWindows.push(printWindow);
      return printWindow;
    };
    window.__openedPrintWindows = openedPrintWindows;
    printRowsWithDymo = async function() {
      throw new Error('DYMO Connect Web Service is not responding.');
    };
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    STATE.currentLaptop = getLaptopBySticker('7771198');
    startGrading('expert');
    getGradingOnderdelen().forEach(component => {
      STATE.currentGrading.keuzes[component.id] = 'A';
    });
    STATE.currentGrading.triggers.pixel_lcd = true;
    finishGrading();
  `, app);

  await app.handleAction('confirm_save', {});

  assert.equal(vm.runInContext('STATE.history.length', app), 0);
  assert.equal(vm.runInContext('STATE.currentScreen', app), 'result');
  assert.equal(vm.runInContext('window.__openedPrintWindows.length', app), 0);
  assert.match(vm.runInContext('STATE.appMessage && STATE.appMessage.text', app), /Automatic DYMO printing failed/);
  assert.match(vm.runInContext('STATE.appMessage && STATE.appMessage.text', app), /not saved/);
});

test('Akkoord grade gebruikt in Edge direct DYMO zonder Chrome/Edge printvenster', async () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    navigator = {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
      platform: 'Win32',
      maxTouchPoints: 0
    };
    const openedPrintWindows = [];
    const printCalls = [];
    window.open = function(url, name) {
      openedPrintWindows.push({ url, name });
      return {
        closed: false,
        document: { write() {}, close() {} },
        close() { this.closed = true; },
        focus() {},
        print() {},
      };
    };
    printRowsWithDymo = async function(rows, type, grade) {
      printCalls.push({ rows: rows.slice(), type, grade });
      return { printerName: 'DYMO LabelWriter 450' };
    };
    window.__openedPrintWindows = openedPrintWindows;
    window.__printCalls = printCalls;
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    STATE.currentLaptop = getLaptopBySticker('8460024');
    startGrading('expert');
    getGradingOnderdelen().forEach(component => {
      STATE.currentGrading.keuzes[component.id] = 'A';
    });
    finishGrading();
  `, app);

  await app.handleAction('confirm_save', {});

  assert.equal(vm.runInContext('getBrowserPrintProfile().id', app), 'dymo-label-54x25');
  assert.equal(vm.runInContext('window.__openedPrintWindows.length', app), 0);
  assert.equal(vm.runInContext('window.__printCalls.length', app), 1);
  assert.equal(vm.runInContext('window.__printCalls[0].type', app), 'specs');
  assert.equal(vm.runInContext('STATE.history.length', app), 1);
});

test('laatste guided Confirm print automatisch en slaat direct op', async () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    const calls = [];
    printRowsWithDymo = async function(rows, type) {
      calls.push({ type, rows: rows.slice() });
      return { printerName: 'DYMO LabelWriter 450' };
    };
    window.__printCalls = calls;
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    STATE.currentLaptop = getLaptopBySticker('8460024');
    startGrading('beginner');
    getGradingOnderdelen().forEach(component => {
      STATE.currentGrading.keuzes[component.id] = 'A';
    });
    STATE.currentGrading.huidigeIndex = getGradingOnderdelen().length - 1;
  `, app);

  await app.handleAction('next_q', {});

  assert.equal(vm.runInContext('STATE.history.length', app), 1);
  assert.equal(vm.runInContext('STATE.history[0].sticker', app), '8460024');
  assert.equal(vm.runInContext('STATE.currentScreen', app), 'scan');
  assert.equal(vm.runInContext('window.__printCalls.length', app), 1);
  assert.equal(vm.runInContext('window.__printCalls[0].type', app), 'specs');
});

test('laatste guided foto-keuze wacht met printen tot Akkoord grade', async () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    const calls = [];
    printRowsWithDymo = async function(rows, type, grade) {
      calls.push({ type, grade, rows: rows.slice() });
      return { printerName: 'DYMO LabelWriter 450' };
    };
    window.__printCalls = calls;
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    STATE.currentLaptop = getLaptopBySticker('8460024');
    startGrading('beginner');
    getGradingOnderdelen().forEach(component => {
      STATE.currentGrading.keuzes[component.id] = 'A';
    });
    STATE.currentGrading.huidigeIndex = getGradingOnderdelen().length - 1;
  `, app);

  await vm.runInContext(`
    applyComponentChoice(
      getGradingOnderdelen()[getGradingOnderdelen().length - 1].id,
      'A',
      true
    );
  `, app);

  assert.equal(vm.runInContext('STATE.history.length', app), 0);
  assert.equal(vm.runInContext('STATE.currentScreen', app), 'result');
  assert.equal(vm.runInContext('window.__printCalls.length', app), 0);

  await app.handleAction('confirm_save', {});

  assert.equal(vm.runInContext('STATE.history.length', app), 1);
  assert.equal(vm.runInContext('STATE.history[0].sticker', app), '8460024');
  assert.equal(vm.runInContext('STATE.currentScreen', app), 'scan');
  assert.equal(vm.runInContext('window.__printCalls.length', app), 1);
  assert.equal(vm.runInContext('window.__printCalls[0].type', app), 'specs');
  assert.equal(vm.runInContext('window.__printCalls[0].grade', app), '');
});

test('expert score Confirm print automatisch en slaat direct op', async () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    const calls = [];
    printRowsWithDymo = async function(rows, type) {
      calls.push({ type, rows: rows.slice() });
      return { printerName: 'DYMO LabelWriter 450' };
    };
    window.__printCalls = calls;
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    STATE.currentLaptop = getLaptopBySticker('8460024');
    startGrading('expert');
    getGradingOnderdelen().forEach(component => {
      STATE.currentGrading.keuzes[component.id] = 'A';
    });
  `, app);

  await app.handleAction('confirm_expert', {});

  assert.equal(vm.runInContext('STATE.history.length', app), 1);
  assert.equal(vm.runInContext('STATE.history[0].sticker', app), '8460024');
  assert.equal(vm.runInContext('STATE.currentScreen', app), 'scan');
  assert.equal(vm.runInContext('window.__printCalls.length', app), 1);
  assert.equal(vm.runInContext('window.__printCalls[0].type', app), 'specs');
});

test('grading-test afronden muteert geen voorraad of historie', () => {
  const app = loadAppSandbox();

  vm.runInContext(`
    STATE.currentUser = USERS.find(user => user.id === 'tim');
    startTestGrading('expert');
    getGradingOnderdelen().forEach(component => {
      STATE.currentGrading.keuzes[component.id] = 'A';
    });
    finishGrading();
  `, app);

  assert.equal(vm.runInContext('STATE.currentScreen', app), 'result');
  assert.equal(vm.runInContext('STATE.history.length', app), 0);
  assert.equal(vm.runInContext('GRADED_STICKERS.size', app), 0);

  return app.handleAction('finish_test', {}).then(() => {
    assert.equal(vm.runInContext('STATE.currentScreen', app), 'home');
    assert.equal(vm.runInContext('STATE.history.length', app), 0);
    assert.equal(vm.runInContext('GRADED_STICKERS.size', app), 0);
  });
});
