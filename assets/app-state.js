// =============================================================================
// REMARKT APP STATE & STORAGE
// State, demo-users, batches, indexes, gedeelde demo-opslag en basishulpen.
// =============================================================================

const STATE = {
  currentUser: null,
  currentScreen: 'login',
  homeTab: 'workflow',
  currentLaptop: null,
  currentMonitor: null,
  currentGrading: null,
  history: [],
  labelPrints: [],
  monitorLabelPrints: [],
  auditLogs: [],
  historySearch: '',
  historyPage: 1,
  historyPageSize: 50,
  historyOpenId: null,
  deletedBatchIds: [],
  deletedLaptopStickers: [],
  deletedMonitorBatchIds: [],
  deletedMonitorStickers: [],
  scanSearch: '',
  monitorScanSearch: '',
  monitorSelectedGrade: null,
  monitorGradeInfoOpen: null,
  manualError: '',
  monitorManualContext: null,
  appMessage: null,
  manualMode: false,
  importResult: null,
  importProgress: null,
  pendingDecision: null,
  imagePreview: null,
  theme: 'light',
};

const DEMO_AUTH_SALT = 'remarkt-demo:';
const MONITOR_PORT_DATABASE_URL = 'assets/monitor-port-database.json?v=20260520-monitor-db';
const DEMO_STORAGE_KEYS = {
  users: 'remarktDemoUsersV2',
  theme: 'remarktThemePreferenceV1',
  session: 'remarktSessionUserV1',
  sharedBackup: 'remarktDemoStateBackupV1',
};
const SHARED_DEMO_STATE_URL = '/api/demo-state';

const USERS = [
  { id: 'tim', naam: 'Tim', rol: 'Manager', initialen: 'T', voorkeur: 'expert', passwordHash: '0aaa2665d28098e82a8b771ab0d48e2afafc93939088a1b9a4be6ae3e393b029' },
  { id: 'thibault', naam: 'Thibault', rol: 'Grader', initialen: 'TH', voorkeur: 'beginner', passwordHash: '4ec075046bd8fcbe41c06c57c8761c4dcaa7b30dec043a9f10438008d048f36f' },
  { id: 'demo', naam: 'Demo medewerker', rol: 'Grader', initialen: 'D', voorkeur: 'beginner', passwordHash: '04091db322a8218b55a339936c9134f24ad880e67090badfee78c90489c9cd4c' },
  { id: 'admin', naam: 'Admin', rol: 'Manager', initialen: 'A', voorkeur: 'expert', passwordHash: '0aaa2665d28098e82a8b771ab0d48e2afafc93939088a1b9a4be6ae3e393b029' },
];
const DEFAULT_USERS = USERS.map(user => ({ ...user }));

loadUsers();
loadSessionUser();
loadThemePreference();

const BATCH = {
  id: 'batch_50375',
  nummer: '50375',
  leverancier: 'Terabyte',
  geimporteerd: '24 april 2026',
  laptops: [
    { sticker: '7268073', merk: 'Dell', model: 'Latitude 3310', processor: 'i3-8145U', ram: '8GB', ssd: '128GB', display: '13"', serial: 'JZYRT93', leverancier_class: 'Class C', meldingen: 'Behuizingsschade groot, krassen op scherm, missing AC-adapter' },
    { sticker: '7771198', merk: 'HP', model: 'EliteBook 860 G9', processor: 'i5-1245U', ram: '16GB', ssd: '256GB', display: '16"', serial: '5CG30429G0', leverancier_class: 'Class B', meldingen: 'Lichte krassen op scherm, missing AC-adapter' },
    { sticker: '8461712', merk: 'Dell', model: 'Latitude 7420', processor: 'i7-1165G7', ram: '16GB', ssd: '512GB', display: '14"', serial: '13YDKN3', leverancier_class: 'Class B', meldingen: 'Gebruikte behuizing, gebruikte touchpad' },
    { sticker: '7064694', merk: 'HP', model: 'ProBook 440 G8', processor: 'i5-1135G7', ram: '16GB', ssd: '256GB', display: '14"', serial: '5CD104K0TG', leverancier_class: 'Class B', meldingen: 'Lichte krassen op scherm' },
    { sticker: '7796582', merk: 'Lenovo', model: 'ThinkPad X13', processor: 'AMD Ryzen 5 PRO 4650U', ram: '16GB', ssd: '256GB', display: '13"', serial: 'PC1VXTYP', leverancier_class: 'Class B', meldingen: 'Lichte krassen op scherm, gebruikte behuizing' },
    { sticker: '7386699', merk: 'HP', model: 'ProBook 640 G4', processor: 'i5-8350U', ram: '16GB', ssd: '256GB', display: 'touch 14"', serial: '5CG8464X3C', leverancier_class: 'Class D', meldingen: 'Gebarsten/defect display, deuk hoek, krassen scherm, missing rubber feet' },
    { sticker: '7772027', merk: 'HP', model: 'EliteBook 860 G9', processor: 'i5-1245U', ram: '16GB', ssd: '256GB', display: '16"', serial: '5CG24809YS', leverancier_class: 'Class C', meldingen: 'Deuk op hoek, lichte krassen scherm' },
    { sticker: '8460024', merk: 'HP', model: 'EliteBook 645 G9', processor: 'AMD Ryzen 5 5625U', ram: '8GB', ssd: '256GB', display: '14"', serial: '5CD3258381', leverancier_class: 'Class A', meldingen: '' },
  ]
};

BATCH.laptops.forEach(l => {
  l.batchId = BATCH.id;
  l.batchNummer = BATCH.nummer;
});
const BATCHES = [{
  id: BATCH.id,
  nummer: BATCH.nummer,
  leverancier: BATCH.leverancier,
  geimporteerd: BATCH.geimporteerd,
  laptops: BATCH.laptops.slice()
}];
const MONITOR_BATCHES = [];
let LAPTOP_INDEX = new Map();
let MONITOR_INDEX = new Map();
let MONITOR_PORT_DATABASE_INDEX = new Map();
let monitorPortDatabaseLoadPromise = null;
let GRADED_STICKERS = new Set();
let LABEL_PRINTED_STICKERS = new Set();
let MONITOR_LABEL_PRINTED_STICKERS = new Set();
const MONITOR_PORT_DATABASE = [];

const VISUAL_ASSETS = {
  bovenkap: {
    A: 'assets/dell-grading-fast/bovenkap-a.jpg',
    B: 'assets/dell-grading-fast/bovenkap-b.jpg',
    C: 'assets/dell-grading-fast/bovenkap-c.jpg',
    D: 'assets/dell-grading-fast/bovenkap-d.jpg'
  },
  onderkant: {
    A: 'assets/dell-grading-fast/onderkant-a.jpg',
    B: 'assets/dell-grading-fast/onderkant-b.jpg',
    C: 'assets/dell-grading-fast/onderkant-c.jpg',
    D: 'assets/dell-grading-fast/onderkant-d.jpg'
  },
  randen: {
    A: 'assets/dell-grading-fast/randen-a.jpg',
    B: 'assets/dell-grading-fast/randen-b.jpg',
    C: 'assets/dell-grading-fast/randen-c.jpg',
    D: 'assets/dell-grading-fast/randen-d.jpg'
  },
  palmrest: {
    A: 'assets/dell-grading-fast/palmrest-a.jpg',
    B: 'assets/dell-grading-fast/palmrest-b.jpg',
    C: 'assets/dell-grading-fast/palmrest-c.jpg',
    D: 'assets/dell-grading-fast/palmrest-d.jpg'
  },
  bezel: {
    A: 'assets/dell-grading-fast/bezel-a.jpg',
    B: 'assets/dell-grading-fast/bezel-b.jpg',
    C: 'assets/dell-grading-fast/bezel-c.jpg',
    D: 'assets/dell-grading-fast/bezel-d.jpg'
  },
  lcd: {
    A: 'assets/dell-grading-fast/lcd-a-black.jpg',
    B: 'assets/dell-grading-fast/lcd-mixed-b.jpg',
    C: 'assets/dell-grading-fast/lcd-mixed-c.jpg',
    D: 'assets/dell-grading-fast/lcd-d.jpg'
  },
  keyboard: {
    A: 'assets/dell-grading-fast/keyboard-a.jpg',
    B: 'assets/dell-grading-fast/keyboard-b.jpg',
    C: 'assets/dell-grading-fast/keyboard-c.jpg',
    D: 'assets/dell-grading-fast/keyboard-many-missing-keys-ai.jpg'
  },
  touchpad: {
    A: 'assets/dell-grading-fast/touchpad-a.jpg',
    B: 'assets/dell-grading-fast/touchpad-b.jpg',
    C: 'assets/dell-grading-fast/touchpad-c.jpg',
    D: 'assets/dell-grading-fast/touchpad-d.jpg'
  },
  scharnieren: {
    A: 'assets/dell-grading-fast/scharnieren-a.jpg',
    B: 'assets/dell-grading-fast/scharnieren-b.jpg',
    C: 'assets/dell-grading-fast/scharnieren-c.jpg',
    D: 'assets/dell-grading-fast/scharnier-loshangend-ai.jpg'
  },
  stickers: {
    A: 'assets/dell-grading-fast/stickers-a.jpg',
    B: 'assets/dell-grading-fast/stickers-b.jpg',
    C: 'assets/dell-grading-fast/stickers-c.jpg',
    D: 'assets/dell-grading-fast/stickers-d.jpg'
  },
};

const SUPPLIER_ISSUE_MAP = [
  { component: 'lcd', terms: ['scherm', 'display', 'glas', 'pixel', 'white spot', 'whitespot', 'backlight'] },
  { component: 'bovenkap', terms: ['bovenkap', 'lid cover', 'deksel'] },
  { component: 'randen', terms: ['hoek', 'hoeken', 'rand', 'deuk hoek'] },
  { component: 'onderkant', terms: ['rubber', 'rubbers', 'voet', 'voetjes', 'onderkant', 'bottom'] },
  { component: 'palmrest', terms: ['palmrest', 'polssteun', 'behuizing'] },
  { component: 'touchpad', terms: ['touchpad'] },
  { component: 'keyboard', terms: ['keyboard', 'toets', 'toetsenbord'] },
  { component: 'scharnieren', terms: ['scharnier', 'scharnieren'] },
  { component: 'stickers', terms: ['sticker', 'stickers', 'lijm'] }
];

function splitSupplierIssues(laptop) {
  if (!laptop || !laptop.meldingen) return [];
  return laptop.meldingen
    .split(',')
    .map(x => x.trim())
    .filter(Boolean);
}

function getSupplierIssues(componentId, laptop = STATE.currentLaptop) {
  const issues = splitSupplierIssues(laptop);
  if (!issues.length) return [];
  const rule = SUPPLIER_ISSUE_MAP.find(r => r.component === componentId);
  if (!rule) return [];
  return issues.filter(issue => {
    const text = issue.toLowerCase();
    return rule.terms.some(term => text.includes(term));
  });
}

function isTouchscreenLaptop(laptop = STATE.currentLaptop) {
  const display = (laptop && laptop.display ? laptop.display : '').toLowerCase();
  return display.includes('touch');
}

function isLaptopGraded(sticker) {
  if (!GRADED_STICKERS.size && STATE.history.length) rebuildHistoryIndexes();
  const laptop = getLaptopBySticker(sticker);
  return GRADED_STICKERS.has(getCanonicalSticker(sticker))
    || (laptop && GRADED_STICKERS.has(String(laptop.sticker || '')));
}

function isLaptopLabelPrinted(sticker) {
  if (!LABEL_PRINTED_STICKERS.size && STATE.labelPrints.length) rebuildLabelPrintIndexes();
  const laptop = getLaptopBySticker(sticker);
  return LABEL_PRINTED_STICKERS.has(getCanonicalSticker(sticker))
    || (laptop && LABEL_PRINTED_STICKERS.has(String(laptop.sticker || '')));
}

function isKnownSticker(sticker) {
  const value = getCanonicalSticker(sticker);
  if (!value) return false;
  return Boolean(getLaptopBySticker(value)) || isLaptopGraded(value);
}

function isKnownMonitorSticker(sticker) {
  const value = getCanonicalMonitorSticker(sticker);
  if (!value) return false;
  return Boolean(getMonitorBySticker(value)) || isMonitorLabelPrinted(value);
}

function openLaptopCount(batch) {
  return batch.laptops.filter(l => !isLaptopGraded(l.sticker) && !isLaptopLabelPrinted(l.sticker)).length;
}

function stickerOpenLaptopCount(batch) {
  return batch.laptops.filter(l => !isLaptopGraded(l.sticker) && !isLaptopLabelPrinted(l.sticker)).length;
}

function isAdminUser() {
  return normalizeUserRole(STATE.currentUser && STATE.currentUser.rol) === 'Manager';
}

function normalizeUserRole(role) {
  if (role === 'Manager') return 'Manager';
  if (role === 'Stickeraar') return 'Stickeraar';
  if (role === 'Labeler') return 'Stickeraar';
  return 'Grader';
}

function displayUserRole(role) {
  const normalized = normalizeUserRole(role);
  if (normalized === 'Stickeraar') return 'Labeler';
  return normalized;
}

function displayUserPreference(value) {
  if (value === 'label') return 'Labels only';
  if (value === 'beginner') return 'Guided';
  return 'Expert';
}

function getAllowedUserPreferences(role) {
  const normalized = normalizeUserRole(role);
  if (normalized === 'Stickeraar') return [{ value: 'label', label: 'Labels only' }];
  if (normalized === 'Grader') return [{ value: 'beginner', label: 'Guided' }];
  return [
    { value: 'expert', label: 'Expert' },
    { value: 'beginner', label: 'Guided' },
  ];
}

function normalizeUserPreference(value, role) {
  const allowed = getAllowedUserPreferences(role).map(option => option.value);
  return allowed.includes(value) ? value : allowed[0];
}

function isStickerUser(user = STATE.currentUser) {
  return normalizeUserRole(user && user.rol) === 'Stickeraar';
}

function canGradeUser(user = STATE.currentUser) {
  return ['Manager', 'Grader'].includes(normalizeUserRole(user && user.rol));
}

function canUseExpertMode(user = STATE.currentUser) {
  return normalizeUserRole(user && user.rol) === 'Manager';
}

function canUseSupportUser(user = STATE.currentUser) {
  return !isStickerUser(user);
}

function getOpenLaptops() {
  return getAllLaptops().filter(laptop => !isLaptopGraded(laptop.sticker) && !isLaptopLabelPrinted(laptop.sticker));
}

function getStickerOpenLaptops() {
  return getAllLaptops().filter(laptop => !isLaptopGraded(laptop.sticker) && !isLaptopLabelPrinted(laptop.sticker));
}

function laptopMatchesScanQuery(laptop, query) {
  if (!query) return true;
  const sticker = String(laptop.sticker || '');
  const haystack = [
    sticker, normalizeStickerCode(sticker), laptop.merk, laptop.model, laptop.serial, laptop.processor,
    laptop.ram, laptop.ssd, laptop.display, laptop.battery, laptop.leverancier_class,
    laptop.batchNummer, laptop.herkomst,
  ].join(' ').toLowerCase();
  return haystack.includes(String(query || '').toLowerCase()) || haystack.includes(normalizeStickerCode(query).toLowerCase());
}

function setAppMessage(text, type = 'info') {
  STATE.appMessage = text ? { text, type } : null;
}

function loadUsers() {
  try {
    const saved = JSON.parse(localStorage.getItem(DEMO_STORAGE_KEYS.users) || 'null');
    if (!Array.isArray(saved) || !saved.length) return;

    const normalized = saved
      .map(normalizeStoredUser)
      .filter(Boolean);

    if (normalized.length) {
      const defaultById = new Map(DEFAULT_USERS.map(user => [user.id, user]));
      normalized.forEach(user => defaultById.set(user.id, user));
      USERS.splice(0, USERS.length, ...Array.from(defaultById.values()));
    }
  } catch (err) {
    console.warn('Users could not be loaded', err);
  }
}

function saveUsers() {
  localStorage.setItem(DEMO_STORAGE_KEYS.users, JSON.stringify(USERS.map(serializeUser)));
}

function getUserById(id) {
  return USERS.find(user => user.id === id) || null;
}

function loadSessionUser() {
  try {
    const savedUserId = localStorage.getItem(DEMO_STORAGE_KEYS.session);
    const user = savedUserId ? getUserById(savedUserId) : null;
    if (!user) {
      if (savedUserId) localStorage.removeItem(DEMO_STORAGE_KEYS.session);
      return;
    }

    STATE.currentUser = user;
    STATE.currentScreen = 'home';
    STATE.homeTab = 'workflow';
  } catch (err) {
    console.warn('Session could not be loaded', err);
  }
}

function saveSessionUser(user) {
  try {
    if (user && user.id) {
      localStorage.setItem(DEMO_STORAGE_KEYS.session, user.id);
    }
  } catch {
    // Local storage may be unavailable in restricted browser contexts.
  }
}

function clearSessionUser() {
  try {
    localStorage.removeItem(DEMO_STORAGE_KEYS.session);
  } catch {
    // Local storage may be unavailable in restricted browser contexts.
  }
}

function normalizeThemePreference(value) {
  return value === 'dark' ? 'dark' : 'light';
}

function loadThemePreference() {
  try {
    STATE.theme = normalizeThemePreference(localStorage.getItem(DEMO_STORAGE_KEYS.theme));
  } catch {
    STATE.theme = 'light';
  }
  applyThemePreference();
}

function setThemePreference(value) {
  STATE.theme = normalizeThemePreference(value);
  try {
    localStorage.setItem(DEMO_STORAGE_KEYS.theme, STATE.theme);
  } catch {
    // Local storage may be unavailable in restricted browser contexts.
  }
  applyThemePreference();
}

function applyThemePreference() {
  if (typeof document === 'undefined' || !document.documentElement) return;
  document.documentElement.dataset.theme = normalizeThemePreference(STATE.theme);
}

function normalizeStoredUser(user) {
  if (!user || !user.id || !user.naam || !user.passwordHash) return null;
  return {
    id: normalizeText(user.id).toLowerCase().replace(/[^a-z0-9_-]/g, ''),
    naam: sanitizeExternalText(user.naam, 80),
    rol: normalizeUserRole(user.rol),
    initialen: sanitizeExternalText(user.initialen || initialsFromName(user.naam), 4),
    voorkeur: normalizeUserPreference(user.voorkeur, user.rol),
    passwordHash: String(user.passwordHash),
  };
}

function serializeUser(user) {
  return {
    id: user.id,
    naam: user.naam,
    rol: user.rol,
    initialen: user.initialen,
    voorkeur: user.voorkeur,
    passwordHash: user.passwordHash,
  };
}

async function hashDemoPassword(password) {
  const subtle = window.crypto && window.crypto.subtle;
  if (!subtle) return sha256Hex(DEMO_AUTH_SALT + String(password || ''));
  const bytes = new TextEncoder().encode(DEMO_AUTH_SALT + String(password || ''));
  const digest = await subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

function sha256Hex(message) {
  const bytes = typeof TextEncoder !== 'undefined'
    ? Array.from(new TextEncoder().encode(message))
    : utf8Bytes(message);
  const words = [];
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while ((bytes.length % 64) !== 56) bytes.push(0);
  for (let i = 7; i >= 0; i--) bytes.push((bitLength / Math.pow(2, i * 8)) & 255);
  for (let i = 0; i < bytes.length; i += 4) {
    words.push((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]);
  }

  const k = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
  ];
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  for (let i = 0; i < words.length; i += 16) {
    const w = words.slice(i, i + 16);
    for (let j = 16; j < 64; j++) {
      const s0 = rightRotate(w[j - 15], 7) ^ rightRotate(w[j - 15], 18) ^ (w[j - 15] >>> 3);
      const s1 = rightRotate(w[j - 2], 17) ^ rightRotate(w[j - 2], 19) ^ (w[j - 2] >>> 10);
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let j = 0; j < 64; j++) {
      const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + k[j] + w[j]) | 0;
      const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) | 0;
      h = g; g = f; f = e; e = (d + temp1) | 0;
      d = c; c = b; b = a; a = (temp1 + temp2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  return [h0,h1,h2,h3,h4,h5,h6,h7]
    .map(value => (value >>> 0).toString(16).padStart(8, '0'))
    .join('');
}

function rightRotate(value, bits) {
  return (value >>> bits) | (value << (32 - bits));
}

function utf8Bytes(value) {
  return unescape(encodeURIComponent(value)).split('').map(char => char.charCodeAt(0));
}

function initialsFromName(name) {
  return normalizeText(name).split(' ').filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join('') || 'U';
}

function getAllLaptops() {
  return BATCHES.flatMap(batch => batch.laptops);
}

function rebuildLaptopIndex() {
  LAPTOP_INDEX = new Map();
  getAllLaptops().forEach(laptop => {
    if (!laptop || !laptop.sticker) return;
    const sticker = String(laptop.sticker);
    const normalized = normalizeStickerCode(sticker);
    LAPTOP_INDEX.set(sticker, laptop);
    if (normalized && !LAPTOP_INDEX.has(normalized)) LAPTOP_INDEX.set(normalized, laptop);
  });
}

function getLaptopBySticker(sticker) {
  if (!LAPTOP_INDEX.size) rebuildLaptopIndex();
  const raw = String(sticker || '').trim();
  return LAPTOP_INDEX.get(raw) || LAPTOP_INDEX.get(normalizeStickerCode(raw)) || null;
}

function getAllMonitors() {
  return MONITOR_BATCHES.flatMap(batch => batch.monitors);
}

function rebuildMonitorIndex() {
  MONITOR_INDEX = new Map();
  getAllMonitors().forEach(monitor => {
    if (!monitor || !monitor.sticker) return;
    const sticker = String(monitor.sticker);
    const normalized = normalizeStickerCode(sticker);
    MONITOR_INDEX.set(sticker, monitor);
    if (normalized && !MONITOR_INDEX.has(normalized)) MONITOR_INDEX.set(normalized, monitor);
  });
}

function getMonitorBySticker(sticker) {
  if (!MONITOR_INDEX.size) rebuildMonitorIndex();
  const raw = String(sticker || '').trim();
  return MONITOR_INDEX.get(raw) || MONITOR_INDEX.get(normalizeStickerCode(raw)) || null;
}

function getCanonicalMonitorSticker(value) {
  const monitor = getMonitorBySticker(value);
  if (monitor && monitor.sticker) return String(monitor.sticker);
  return normalizeStickerCode(value);
}

function normalizeMonitorGrade(value) {
  const text = String(value || '').trim().toUpperCase();
  if (
    text === 'X'
    || text === 'D'
    || /\b(?:CLASS\s*)?[DX](?:\s*[- ]?\s*GRADE)?\b/.test(text)
    || /\bGRADE\s*[DX]\b/.test(text)
    || text.includes('DEFECT')
    || text.includes('REPAIR')
    || text.includes('REPARATIE')
  ) return 'D';
  const gradeMatch = text.match(/\b(?:CLASS\s*)?([ABC])(?:\s*[- ]?\s*GRADE)?\b/) || text.match(/\bGRADE\s*([ABC])\b/);
  if (gradeMatch) return gradeMatch[1];
  if (['A', 'B', 'C'].includes(text)) return text;
  return 'A';
}

function displayMonitorGrade(value) {
  const grade = normalizeMonitorGrade(value);
  return grade === 'D' ? 'X' : grade;
}

function isMonitorLabelPrinted(sticker) {
  if (!MONITOR_LABEL_PRINTED_STICKERS.size && STATE.monitorLabelPrints.length) rebuildMonitorLabelPrintIndexes();
  return MONITOR_LABEL_PRINTED_STICKERS.has(getCanonicalMonitorSticker(sticker));
}

function getOpenMonitors() {
  return getAllMonitors().filter(monitor => !isMonitorLabelPrinted(monitor.sticker));
}

function monitorMatchesScanQuery(monitor, query) {
  if (!query) return true;
  const sticker = String(monitor.sticker || '');
  const identityText = (monitor.identityOptions || [])
    .map(option => `${option.source || ''} ${option.deviceName || ''} ${option.model || ''} ${option.videoInputs || ''}`)
    .join(' ');
  const haystack = [
    sticker, normalizeStickerCode(sticker), monitor.deviceName, monitor.merk, monitor.model, monitor.serial,
    monitor.display, monitor.resolution, monitor.videoInputs, monitor.leverancier_class, monitor.batchNummer,
    monitor.herkomst, monitor.monitorDatabaseModel, identityText,
  ].join(' ').toLowerCase();
  return haystack.includes(String(query || '').toLowerCase()) || haystack.includes(normalizeStickerCode(query).toLowerCase());
}

function normalizeMonitorLookupKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(monitors?|displays?|screens?|scherm|beeldscherm|lcd|led|tft|inch|inches|wide\s*screen|widescreen|curved|professional|ultrasharp|elitedisplay|prodisplay|thinkvision)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '');
}

function getMonitorLookupTokens(value) {
  const matches = String(value || '').toUpperCase().match(/[A-Z0-9][A-Z0-9-]{2,}/g) || [];
  return Array.from(new Set(matches
    .map(token => token.replace(/[^A-Z0-9]/g, ''))
    .filter(token => token.length >= 4 && /\d/.test(token))));
}

function normalizeMonitorBrandKey(value) {
  const text = sanitizeExternalText(value, 80);
  if (!text) return '';
  const first = (text.match(/[A-Za-z0-9-]+/) || [''])[0];
  if (!first || /\d/.test(first)) return '';
  let key = normalizeMonitorLookupKey(first);
  if (['unknown', 'onbekend', 'nvt', 'na', 'notavailable'].includes(key)) return '';
  if (key === 'hewlett' || key === 'hewlettpackard' || key === 'hpinc') key = 'hp';
  if (key === 'philipsbrilliance' || key === 'philips') key = 'philips';
  return key;
}

function getMonitorBrandKey(monitor) {
  if (!monitor) return '';
  return normalizeMonitorBrandKey(monitor.merk) || normalizeMonitorBrandKey(monitor.deviceName);
}

function getMonitorDatabaseBrandName(entry) {
  const text = sanitizeExternalText(entry && entry.model, 180);
  const first = (text.match(/[A-Za-z0-9-]+/) || [''])[0];
  if (!first || /\d/.test(first)) return '';
  if (/^hewlett/i.test(first)) return 'HP';
  return first.toUpperCase() === 'HP' ? 'HP' : first;
}

function splitMonitorModelParts(fullName = '', preferredBrand = '') {
  const clean = sanitizeExternalText(fullName, 180);
  const brand = sanitizeExternalText(preferredBrand, 80) || getMonitorDatabaseBrandName({ model: clean });
  if (!clean) return { brand, series: '', modelNumber: '' };
  let rest = clean;
  if (brand) {
    const pattern = new RegExp(`^${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+`, 'i');
    rest = rest.replace(pattern, '').trim();
  }
  const tokens = rest.split(/\s+/).filter(Boolean);
  const modelStart = tokens.findIndex(token => /\d/.test(token));
  if (modelStart <= 0) return { brand, series: '', modelNumber: rest };
  return {
    brand,
    series: tokens.slice(0, modelStart).join(' '),
    modelNumber: tokens.slice(modelStart).join(' '),
  };
}

function buildMonitorManualModelName(brand = '', series = '', modelNumber = '') {
  const cleanBrand = sanitizeExternalText(brand, 80);
  const cleanSeries = sanitizeExternalText(series, 80);
  let cleanModel = sanitizeExternalText(modelNumber, 160);
  if (cleanBrand) {
    cleanModel = cleanModel.replace(new RegExp(`^${cleanBrand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+`, 'i'), '').trim();
  }
  if (cleanSeries) {
    cleanModel = cleanModel.replace(new RegExp(`^${cleanSeries.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+`, 'i'), '').trim();
  }
  return [cleanSeries, cleanModel].filter(Boolean).join(' ').trim();
}

function buildMonitorDeviceName(brand = '', series = '', modelNumber = '') {
  return [sanitizeExternalText(brand, 80), buildMonitorManualModelName(brand, series, modelNumber)]
    .filter(Boolean)
    .join(' ')
    .trim();
}

function getMonitorManualBrandSuggestions(query = '', limit = 12) {
  const needle = normalizeMonitorLookupKey(query);
  const brands = [];
  const seen = new Set();
  MONITOR_PORT_DATABASE.forEach(entry => {
    const brand = getMonitorDatabaseBrandName(entry);
    const key = normalizeMonitorBrandKey(brand);
    if (!brand || !key || seen.has(key)) return;
    if (needle && !key.includes(needle)) return;
    seen.add(key);
    brands.push(brand);
  });
  return brands
    .sort((a, b) => a.localeCompare(b, 'nl', { sensitivity: 'base' }))
    .slice(0, limit);
}

function getMonitorManualSeriesSuggestions(brand = '', query = '', limit = 40) {
  const brandKey = normalizeMonitorBrandKey(brand);
  const needle = normalizeMonitorLookupKey(query);
  const series = [];
  const seen = new Set();
  MONITOR_PORT_DATABASE.forEach(entry => {
    if (brandKey && !monitorPortDatabaseBrandAllowed(entry, brandKey)) return;
    const parts = splitMonitorModelParts(entry.model, getMonitorDatabaseBrandName(entry));
    const key = normalizeMonitorLookupKey(parts.series);
    if (!parts.series || !key || seen.has(key)) return;
    if (needle && !key.includes(needle)) return;
    seen.add(key);
    series.push(parts.series);
  });
  return series
    .sort((a, b) => a.localeCompare(b, 'nl', { sensitivity: 'base' }))
    .slice(0, limit);
}

function getMonitorManualModelSuggestions(brand = '', series = '', query = '', limit = 60) {
  const brandKey = normalizeMonitorBrandKey(brand);
  const seriesKey = normalizeMonitorLookupKey(series);
  const needle = normalizeMonitorLookupKey(query);
  const tokenNeedle = String(query || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const models = [];
  const seen = new Set();
  MONITOR_PORT_DATABASE.forEach(entry => {
    if (brandKey && !monitorPortDatabaseBrandAllowed(entry, brandKey)) return;
    const parts = splitMonitorModelParts(entry.model, getMonitorDatabaseBrandName(entry));
    if (seriesKey && normalizeMonitorLookupKey(parts.series) !== seriesKey) return;
    const label = parts.modelNumber || parts.series || entry.model;
    const modelKey = normalizeMonitorLookupKey(label);
    const tokenMatch = tokenNeedle && entry.lookupTokens.some(token => token.includes(tokenNeedle));
    if (needle && !modelKey.includes(needle) && !tokenMatch) return;
    if (seen.has(label)) return;
    seen.add(label);
    models.push(label);
  });
  return models
    .sort((a, b) => a.localeCompare(b, 'nl', { sensitivity: 'base' }))
    .slice(0, limit);
}

function findMonitorManualDatabaseMatch(brand = '', series = '', modelNumber = '') {
  const cleanModel = buildMonitorDeviceName(brand, series, modelNumber) || sanitizeExternalText(modelNumber, 180);
  if (!cleanModel || !MONITOR_PORT_DATABASE.length) return null;
  const brandKey = normalizeMonitorBrandKey(brand);
  const lookupKey = normalizeMonitorLookupKey(cleanModel);
  const candidates = MONITOR_PORT_DATABASE.filter(entry => {
    if (brandKey && !monitorPortDatabaseBrandAllowed(entry, brandKey)) return false;
    return entry.lookupKey === lookupKey || entry.model.toLowerCase() === cleanModel.toLowerCase();
  });
  if (candidates.length === 1) return candidates[0];
  return selectBestMonitorPortDatabaseEntry(candidates, [lookupKey], getMonitorLookupTokens(cleanModel), brandKey);
}

function normalizeMonitorVideoInputs(value) {
  const source = sanitizeExternalText(value, 220);
  if (!source) return '';
  const found = [];
  const add = value => {
    if (value && !found.includes(value)) found.push(value);
  };
  source
    .replace(/\buusb\b/gi, 'usb')
    .replace(/\busb\s*\/\s*c\b/gi, 'USB-C')
    .replace(/\bscherm\s*poort\b|\bschermport\b|\bschermpoort\b|\bdisplay\s*poort\b|\bdisplaypoort\b/gi, 'DisplayPort')
    .split(/[\/,;|]+/)
    .map(part => part.trim())
    .filter(Boolean)
    .forEach(part => {
      if (/\bmini\s*(?:display\s*port|displayport|dp)\b/i.test(part)) add('Mini DisplayPort');
      else if (/\b(?:2x|2\s*x|dual)\s*(?:display\s*port|displayport|dp)\b/i.test(part)) add('2x DisplayPort');
      else if (/\b(?:display\s*port|displayport|dp)\b/i.test(part)) add('DisplayPort');
      else if (/\b(?:2x|2\s*x|dual)\s*hdmi\b/i.test(part)) add('2x HDMI');
      else if (/\bhdmi\b/i.test(part)) add('HDMI');
      else if (/\busb[\s-]*c\b|\btype[\s-]*c\b/i.test(part)) add('USB-C');
      else if (/\bthunderbolt\b/i.test(part)) add('Thunderbolt');
      else if (/\b(?:2x|2\s*x|dual)\s*dvi\b/i.test(part)) add('2x DVI');
      else if (/\bdvi\b/i.test(part)) add('DVI');
      else if (/\b(?:2x|2\s*x|dual)\s*(?:vga|d-sub)\b/i.test(part)) add('2x VGA');
      else if (/\bvga\b|\bd-sub\b/i.test(part)) add('VGA');
    });
  return found.join(' / ');
}

function normalizeMonitorPortDatabaseEntry(entry) {
  if (!entry) return null;
  const model = sanitizeExternalText(entry.model, 180);
  const videoInputs = normalizeMonitorVideoInputs(entry.videoInputs);
  if (!model || !videoInputs) return null;
  return {
    model,
    displaySize: sanitizeExternalText(entry.displaySize, 40),
    resolution: sanitizeExternalText(entry.resolution, 80),
    videoInputs,
    year: sanitizeExternalText(entry.year, 20),
    touchscreen: sanitizeExternalText(entry.touchscreen, 40),
    color: sanitizeExternalText(entry.color, 40),
    imageQuality: sanitizeExternalText(entry.imageQuality, 80),
    energyEfficiency: sanitizeExternalText(entry.energyEfficiency, 40),
    brandKey: normalizeMonitorBrandKey(model),
    lookupKey: normalizeMonitorLookupKey(model),
    lookupTokens: getMonitorLookupTokens(model),
  };
}

function addMonitorPortDatabaseIndexValue(key, entry) {
  if (!key || !entry) return;
  const current = MONITOR_PORT_DATABASE_INDEX.get(key);
  if (current) current.push(entry);
  else MONITOR_PORT_DATABASE_INDEX.set(key, [entry]);
}

function rebuildMonitorPortDatabaseIndex() {
  MONITOR_PORT_DATABASE_INDEX = new Map();
  MONITOR_PORT_DATABASE.forEach(entry => {
    addMonitorPortDatabaseIndexValue(`key:${entry.lookupKey}`, entry);
    entry.lookupTokens.forEach(token => addMonitorPortDatabaseIndexValue(`token:${token}`, entry));
  });
}

async function loadMonitorPortDatabase() {
  if (MONITOR_PORT_DATABASE.length) return true;
  if (monitorPortDatabaseLoadPromise) return monitorPortDatabaseLoadPromise;
  if (typeof fetch !== 'function') return false;

  monitorPortDatabaseLoadPromise = fetch(MONITOR_PORT_DATABASE_URL, { cache: 'no-store' })
    .then(response => {
      if (!response.ok) throw new Error(`Monitor database returned ${response.status}`);
      return response.json();
    })
    .then(data => {
      const entries = (Array.isArray(data.entries) ? data.entries : [])
        .map(normalizeMonitorPortDatabaseEntry)
        .filter(Boolean);
      MONITOR_PORT_DATABASE.splice(0, MONITOR_PORT_DATABASE.length, ...entries);
      rebuildMonitorPortDatabaseIndex();
      return true;
    })
    .catch(error => {
      console.warn('Monitor database kon niet worden geladen', error);
      monitorPortDatabaseLoadPromise = null;
      return false;
    });

  return monitorPortDatabaseLoadPromise;
}

function scoreMonitorPortDatabaseEntry(entry, candidateKeys, candidateTokens) {
  let score = 0;
  candidateKeys.forEach(key => {
    if (!key || !entry.lookupKey) return;
    if (key === entry.lookupKey) score = Math.max(score, 1000 + entry.lookupKey.length);
    else if (key.length >= 6 && entry.lookupKey.includes(key)) score = Math.max(score, 700 + key.length);
    else if (entry.lookupKey.length >= 6 && key.includes(entry.lookupKey)) score = Math.max(score, 650 + entry.lookupKey.length);
  });
  candidateTokens.forEach(token => {
    if (entry.lookupTokens.includes(token)) score = Math.max(score, 500 + token.length);
  });
  return score;
}

function monitorPortDatabaseBrandAllowed(entry, monitorBrandKey) {
  if (!entry) return false;
  if (!monitorBrandKey) return false;
  if (!entry.brandKey) return true;
  return entry.brandKey === monitorBrandKey;
}

function selectBestMonitorPortDatabaseEntry(candidates, candidateKeys, candidateTokens, monitorBrandKey = '') {
  const unique = [];
  const seen = new Set();
  candidates.forEach(entry => {
    if (!entry || seen.has(entry.model)) return;
    if (!monitorPortDatabaseBrandAllowed(entry, monitorBrandKey)) return;
    seen.add(entry.model);
    unique.push(entry);
  });
  return unique
    .map(entry => ({ entry, score: scoreMonitorPortDatabaseEntry(entry, candidateKeys, candidateTokens) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || b.entry.lookupKey.length - a.entry.lookupKey.length)[0]?.entry || null;
}

function findMonitorPortDatabaseMatch(monitor) {
  if (!monitor || !MONITOR_PORT_DATABASE.length) return null;
  const monitorBrandKey = getMonitorBrandKey(monitor);
  const candidateValues = Array.from(new Set([
    monitor.model,
    `${monitor.merk || ''} ${monitor.model || ''}`.trim(),
    monitor.deviceName,
  ].map(value => sanitizeExternalText(value, 180)).filter(Boolean)));
  if (!candidateValues.length) return null;

  const candidateKeys = Array.from(new Set(candidateValues.map(normalizeMonitorLookupKey).filter(Boolean)));
  const candidateTokens = getMonitorLookupTokens(candidateValues.join(' '));
  const directCandidates = [];

  candidateKeys.forEach(key => {
    directCandidates.push(...(MONITOR_PORT_DATABASE_INDEX.get(`key:${key}`) || []));
  });
  candidateTokens.forEach(token => {
    directCandidates.push(...(MONITOR_PORT_DATABASE_INDEX.get(`token:${token}`) || []));
  });

  const directMatch = selectBestMonitorPortDatabaseEntry(directCandidates, candidateKeys, candidateTokens, monitorBrandKey);
  if (directMatch) return directMatch;

  const fallbackCandidates = MONITOR_PORT_DATABASE.filter(entry => candidateKeys.some(key => (
    key.length >= 6 && entry.lookupKey.includes(key)
  ) || (
    entry.lookupKey.length >= 6 && key.includes(entry.lookupKey)
  )));
  return selectBestMonitorPortDatabaseEntry(fallbackCandidates, candidateKeys, candidateTokens, monitorBrandKey);
}

function enrichMonitorWithPortDatabase(monitor) {
  if (!monitor) return monitor;
  const match = findMonitorPortDatabaseMatch(monitor);
  if (!match) return monitor;
  return {
    ...monitor,
    display: monitor.display || (match.displaySize ? `${match.displaySize}"` : ''),
    resolution: monitor.resolution || match.resolution,
    videoInputs: normalizeMonitorVideoInputs(monitor.videoInputs) || match.videoInputs,
    monitorDatabaseModel: match.model,
  };
}

function normalizeMonitorIdentityOption(option) {
  if (!option || !option.deviceName) return null;
  const deviceName = sanitizeExternalText(option.deviceName, 180);
  if (!deviceName) return null;
  return {
    source: sanitizeExternalText(option.source || 'Device name', 80),
    deviceName,
    merk: sanitizeExternalText(option.merk, 80),
    model: sanitizeExternalText(option.model, 160),
    display: sanitizeExternalText(option.display, 80),
    resolution: sanitizeExternalText(option.resolution, 80),
    videoInputs: normalizeMonitorVideoInputs(option.videoInputs),
    monitorDatabaseModel: sanitizeExternalText(option.monitorDatabaseModel, 180),
  };
}

function normalizeMonitorIdentityOptions(options) {
  const seen = new Set();
  return (Array.isArray(options) ? options : [])
    .map(normalizeMonitorIdentityOption)
    .filter(option => {
      if (!option) return false;
      const key = normalizeMonitorLookupKey(option.deviceName);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function monitorIdentityLooksDifferent(firstName, secondName) {
  const firstKey = normalizeMonitorLookupKey(firstName);
  const secondKey = normalizeMonitorLookupKey(secondName);
  if (!firstKey || !secondKey) return false;
  if (firstKey === secondKey) return false;
  if ((firstKey.length >= 6 && secondKey.includes(firstKey)) || (secondKey.length >= 6 && firstKey.includes(secondKey))) return false;

  const firstTokens = getMonitorLookupTokens(firstName);
  const secondTokens = getMonitorLookupTokens(secondName);
  if (firstTokens.length && secondTokens.length) {
    return !firstTokens.some(token => secondTokens.includes(token));
  }
  return true;
}

function monitorNeedsIdentityChoice(monitor) {
  return Boolean(monitor
    && Array.isArray(monitor.identityOptions)
    && monitor.identityOptions.length > 1
    && !monitor.identityChoice);
}

function applyMonitorIdentityChoice(monitor, optionIndex) {
  if (!monitor || !Array.isArray(monitor.identityOptions)) return false;
  const normalizedOption = normalizeMonitorIdentityOption(monitor.identityOptions[Number(optionIndex)]);
  const option = enrichMonitorWithPortDatabase(normalizedOption) || normalizedOption;
  if (!option) return false;
  monitor.deviceName = option.deviceName;
  monitor.merk = option.merk || monitor.merk;
  monitor.model = option.model || monitor.model;
  monitor.display = option.display || monitor.display;
  monitor.resolution = option.resolution || monitor.resolution;
  monitor.videoInputs = option.videoInputs || monitor.videoInputs;
  monitor.monitorDatabaseModel = option.monitorDatabaseModel || monitor.monitorDatabaseModel;
  monitor.identityChoice = {
    source: option.source,
    deviceName: option.deviceName,
    chosenAt: new Date().toISOString(),
  };
  return true;
}

function rebuildHistoryIndexes() {
  GRADED_STICKERS = new Set();
  STATE.history.forEach(item => {
    const sticker = String(item.sticker || '');
    if (sticker) {
      GRADED_STICKERS.add(sticker);
      GRADED_STICKERS.add(normalizeStickerCode(sticker));
    }
  });
  STATE.history.forEach(item => ensureHistorySearchIndex(item));
}

function rebuildLabelPrintIndexes() {
  STATE.labelPrints = Array.isArray(STATE.labelPrints) ? STATE.labelPrints.map(normalizeLabelPrint).filter(Boolean) : [];
  LABEL_PRINTED_STICKERS = new Set();
  STATE.labelPrints.forEach(item => {
    const sticker = String(item.sticker || '');
    if (sticker) {
      LABEL_PRINTED_STICKERS.add(sticker);
      LABEL_PRINTED_STICKERS.add(normalizeStickerCode(sticker));
    }
  });
}

function rebuildMonitorLabelPrintIndexes() {
  STATE.monitorLabelPrints = Array.isArray(STATE.monitorLabelPrints) ? STATE.monitorLabelPrints.map(normalizeMonitorLabelPrint).filter(Boolean) : [];
  MONITOR_LABEL_PRINTED_STICKERS = new Set();
  STATE.monitorLabelPrints.forEach(item => {
    const sticker = String(item.sticker || '');
    if (sticker) {
      MONITOR_LABEL_PRINTED_STICKERS.add(sticker);
      MONITOR_LABEL_PRINTED_STICKERS.add(normalizeStickerCode(sticker));
    }
  });
}

function normalizeDeletedBatchIds(list) {
  return Array.from(new Set((Array.isArray(list) ? list : [])
    .map(value => sanitizeExternalText(value, 100))
    .filter(Boolean)));
}

function normalizeDeletedLaptopStickers(list) {
  return Array.from(new Set((Array.isArray(list) ? list : [])
    .map(value => getCanonicalSticker(value))
    .filter(Boolean)));
}

function normalizeDeletedMonitorBatchIds(list) {
  return normalizeDeletedBatchIds(list);
}

function normalizeDeletedMonitorStickers(list) {
  return Array.from(new Set((Array.isArray(list) ? list : [])
    .map(value => getCanonicalMonitorSticker(value))
    .filter(Boolean)));
}

function markBatchDeleted(batchId) {
  const normalized = sanitizeExternalText(batchId, 100);
  if (normalized && !STATE.deletedBatchIds.includes(normalized)) STATE.deletedBatchIds.push(normalized);
}

function markLaptopDeleted(sticker) {
  const normalized = getCanonicalSticker(sticker);
  if (normalized && !STATE.deletedLaptopStickers.includes(normalized)) STATE.deletedLaptopStickers.push(normalized);
}

function markMonitorBatchDeleted(batchId) {
  const normalized = sanitizeExternalText(batchId, 100);
  if (normalized && !STATE.deletedMonitorBatchIds.includes(normalized)) STATE.deletedMonitorBatchIds.push(normalized);
}

function markMonitorDeleted(sticker) {
  const normalized = getCanonicalMonitorSticker(sticker);
  if (normalized && !STATE.deletedMonitorStickers.includes(normalized)) STATE.deletedMonitorStickers.push(normalized);
}

function clearBatchDeletion(batchId) {
  const normalized = sanitizeExternalText(batchId, 100);
  STATE.deletedBatchIds = STATE.deletedBatchIds.filter(id => id !== normalized);
}

function clearLaptopDeletion(sticker) {
  const normalized = getCanonicalSticker(sticker);
  STATE.deletedLaptopStickers = STATE.deletedLaptopStickers.filter(value => value !== normalized);
}

function clearMonitorBatchDeletion(batchId) {
  const normalized = sanitizeExternalText(batchId, 100);
  STATE.deletedMonitorBatchIds = STATE.deletedMonitorBatchIds.filter(id => id !== normalized);
}

function clearMonitorDeletion(sticker) {
  const normalized = getCanonicalMonitorSticker(sticker);
  STATE.deletedMonitorStickers = STATE.deletedMonitorStickers.filter(value => value !== normalized);
}

function applyDeletionMarkersToBatches(batches) {
  const deletedBatches = new Set(normalizeDeletedBatchIds(STATE.deletedBatchIds));
  const deletedLaptops = new Set(normalizeDeletedLaptopStickers(STATE.deletedLaptopStickers));
  return (batches || [])
    .filter(batch => batch && !deletedBatches.has(batch.id))
    .map(batch => ({
      ...batch,
      laptops: (batch.laptops || []).filter(laptop => !deletedLaptops.has(getCanonicalSticker(laptop.sticker))),
    }))
    .filter(batch => batch.laptops.length);
}

function applyDeletionMarkersToMonitorBatches(batches) {
  const deletedBatches = new Set(normalizeDeletedMonitorBatchIds(STATE.deletedMonitorBatchIds));
  const deletedMonitors = new Set(normalizeDeletedMonitorStickers(STATE.deletedMonitorStickers));
  return (batches || [])
    .filter(batch => batch && !deletedBatches.has(batch.id))
    .map(batch => ({
      ...batch,
      monitors: (batch.monitors || []).filter(monitor => !deletedMonitors.has(getCanonicalMonitorSticker(monitor.sticker))),
    }))
    .filter(batch => batch.monitors.length);
}

function normalizeLabelPrint(item) {
  if (!item || !item.sticker) return null;
  return {
    sticker: sanitizeExternalText(item.sticker, 64).replace(/[^\w.-]/g, ''),
    merk: sanitizeExternalText(item.merk, 80),
    model: sanitizeExternalText(item.model, 160),
    batchId: sanitizeExternalText(item.batchId, 100),
    batchNummer: sanitizeExternalText(item.batchNummer, 100),
    user_id: sanitizeExternalText(item.user_id, 80),
    user_naam: sanitizeExternalText(item.user_naam, 80),
    printedAt: sanitizeExternalText(item.printedAt || new Date().toISOString(), 40),
  };
}

function normalizeMonitorLabelPrint(item) {
  if (!item || !item.sticker) return null;
  return {
    sticker: sanitizeExternalText(item.sticker, 64).replace(/[^\w.-]/g, ''),
    deviceName: sanitizeExternalText(item.deviceName, 180),
    merk: sanitizeExternalText(item.merk, 80),
    model: sanitizeExternalText(item.model, 160),
    serie: sanitizeExternalText(item.serie, 80),
    modelNumber: sanitizeExternalText(item.modelNumber, 160),
    serial: sanitizeExternalText(item.serial, 80),
    grade: normalizeMonitorGrade(item.grade),
    videoInputs: normalizeMonitorVideoInputs(item.videoInputs),
    batchId: sanitizeExternalText(item.batchId, 100),
    batchNummer: sanitizeExternalText(item.batchNummer, 100),
    user_id: sanitizeExternalText(item.user_id, 80),
    user_naam: sanitizeExternalText(item.user_naam, 80),
    printedAt: sanitizeExternalText(item.printedAt || new Date().toISOString(), 40),
  };
}

function getOrCreateManualMonitorBatch() {
  let batch = MONITOR_BATCHES.find(item => item && item.id === 'monitor_manual');
  if (!batch) {
    batch = {
      id: 'monitor_manual',
      nummer: 'Manual',
      leverancier: 'Handmatige monitorinvoer',
      geimporteerd: new Date().toLocaleDateString('nl-NL'),
      monitors: [],
    };
    MONITOR_BATCHES.push(batch);
  }
  return batch;
}

function upsertManualMonitor(details, sourceMonitor = null) {
  const sticker = sanitizeExternalText(details && details.sticker, 64).replace(/[^\w.-]/g, '') || `monitor_manual_${Date.now()}`;
  const existing = getMonitorBySticker(sticker);
  const target = existing || {};
  const batch = existing
    ? MONITOR_BATCHES.find(item => (item.monitors || []).includes(existing))
    : getOrCreateManualMonitorBatch();

  const merk = sanitizeExternalText(details.merk, 80);
  const model = sanitizeExternalText(details.model, 160);
  const serie = sanitizeExternalText(details.serie, 80);
  const modelNumber = sanitizeExternalText(details.modelNumber, 160) || model;
  const monitor = {
    ...target,
    sticker,
    deviceName: sanitizeExternalText(details.deviceName || buildMonitorDeviceName(merk, serie, modelNumber) || `${merk} ${model}`.trim(), 180),
    merk,
    model,
    serie,
    modelNumber,
    serial: sanitizeExternalText(details.serial, 80),
    display: sanitizeExternalText(details.display, 80),
    resolution: sanitizeExternalText(details.resolution, 80),
    videoInputs: normalizeMonitorVideoInputs(details.videoInputs),
    leverancier_class: sourceMonitor ? sanitizeExternalText(sourceMonitor.leverancier_class, 40) : '',
    meldingen: sourceMonitor ? sanitizeExternalText(sourceMonitor.meldingen, 1000) : '',
    herkomst: sanitizeExternalText(details.herkomst || (sourceMonitor && sourceMonitor.herkomst) || 'handmatige monitorinvoer', 180),
    batchId: sanitizeExternalText((batch && batch.id) || 'monitor_manual', 100),
    batchNummer: sanitizeExternalText((batch && batch.nummer) || 'Manual', 100),
    monitorDatabaseModel: '',
    identityOptions: [],
    identityChoice: null,
  };

  const enriched = enrichMonitorWithPortDatabase(monitor);
  Object.keys(target).forEach(key => delete target[key]);
  Object.assign(target, enriched);
  if (!existing) batch.monitors.push(target);
  rebuildMonitorIndex();
  return target;
}

function recordStickerLabelPrint(laptop) {
  if (!laptop || !laptop.sticker) return false;
  const sticker = String(laptop.sticker || '');
  if (LABEL_PRINTED_STICKERS.has(sticker)) return false;
  const item = normalizeLabelPrint({
    sticker,
    merk: laptop.merk,
    model: laptop.model,
    batchId: laptop.batchId,
    batchNummer: laptop.batchNummer,
    user_id: STATE.currentUser ? STATE.currentUser.id : '',
    user_naam: STATE.currentUser ? STATE.currentUser.naam : '',
    printedAt: new Date().toISOString(),
  });
  if (!item) return false;
  STATE.labelPrints.push(item);
  LABEL_PRINTED_STICKERS.add(sticker);
  logAudit('sticker_label_printed', 'laptop', sticker, { batchNummer: laptop.batchNummer || '' });
  return true;
}

function recordMonitorLabelPrint(monitor, grade) {
  if (!monitor || !monitor.sticker) return false;
  const sticker = String(monitor.sticker || '');
  if (MONITOR_LABEL_PRINTED_STICKERS.has(sticker) || MONITOR_LABEL_PRINTED_STICKERS.has(normalizeStickerCode(sticker))) return false;
  const item = normalizeMonitorLabelPrint({
    sticker,
    deviceName: monitor.deviceName,
    merk: monitor.merk,
    model: monitor.model,
    serie: monitor.serie,
    modelNumber: monitor.modelNumber,
    serial: monitor.serial,
    grade,
    videoInputs: monitor.videoInputs,
    batchId: monitor.batchId,
    batchNummer: monitor.batchNummer,
    user_id: STATE.currentUser ? STATE.currentUser.id : '',
    user_naam: STATE.currentUser ? STATE.currentUser.naam : '',
    printedAt: new Date().toISOString(),
  });
  if (!item) return false;
  STATE.monitorLabelPrints.push(item);
  MONITOR_LABEL_PRINTED_STICKERS.add(sticker);
  MONITOR_LABEL_PRINTED_STICKERS.add(normalizeStickerCode(sticker));
  logAudit('monitor_label_printed', 'monitor', sticker, { batchNummer: monitor.batchNummer || '', grade: item.grade });
  return true;
}

function normalizeStickerCode(value) {
  const compact = String(value || '').trim().replace(/\s+/g, '');
  if (!compact) return '';
  if (/^0+\d+$/.test(compact)) return compact.replace(/^0+/, '') || '0';
  return compact;
}

function getCanonicalSticker(value) {
  const laptop = getLaptopBySticker(value);
  if (laptop && laptop.sticker) return String(laptop.sticker);
  return normalizeStickerCode(value);
}

function syncBatchAggregate() {
  BATCH.laptops = getAllLaptops();
  BATCH.nummer = BATCHES.map(batch => batch.nummer).join(' + ');
  BATCH.leverancier = BATCHES.length === 1 ? BATCHES[0].leverancier : `${BATCHES.length} active batches`;
  BATCH.geimporteerd = new Date().toLocaleDateString('nl-NL');
  rebuildLaptopIndex();
  rebuildMonitorIndex();
}

function logAudit(action, entityType, entityId, details = {}) {
  STATE.auditLogs.push({
    action,
    entityType,
    entityId: String(entityId || ''),
    userId: STATE.currentUser ? STATE.currentUser.id : null,
    userName: STATE.currentUser ? STATE.currentUser.naam : null,
    details,
    createdAt: new Date().toISOString(),
  });
}

function canUseSharedDemoState() {
  return typeof fetch === 'function' && window.location && /^https?:$/.test(window.location.protocol);
}

function normalizeSharedLaptop(laptop) {
  if (!laptop || !laptop.sticker) return null;
  return {
    sticker: sanitizeExternalText(laptop.sticker, 64).replace(/[^\w.-]/g, ''),
    merk: sanitizeExternalText(laptop.merk, 80),
    model: sanitizeExternalText(laptop.model, 160),
    processor: sanitizeExternalText(laptop.processor, 120),
    ram: sanitizeExternalText(laptop.ram, 40),
    ssd: sanitizeExternalText(laptop.ssd, 80),
    display: sanitizeExternalText(laptop.display, 80),
    serial: sanitizeExternalText(laptop.serial, 80),
    leverancier_class: sanitizeExternalText(laptop.leverancier_class, 40),
    meldingen: sanitizeExternalText(laptop.meldingen, 1000),
    battery: sanitizeExternalText(laptop.battery, 60),
    gpu: sanitizeExternalText(laptop.gpu, 180),
    labelGpu: sanitizeExternalText(laptop.labelGpu, 180),
    pallet: sanitizeExternalText(laptop.pallet, 80),
    keyboard: sanitizeExternalText(laptop.keyboard, 80),
    herkomst: sanitizeExternalText(laptop.herkomst, 180),
    batchId: sanitizeExternalText(laptop.batchId, 100),
    batchNummer: sanitizeExternalText(laptop.batchNummer, 100),
  };
}

function normalizeSharedBatch(batch) {
  if (!batch || !Array.isArray(batch.laptops)) return null;
  const id = sanitizeExternalText(batch.id || `batch_${batch.nummer || Date.now()}`, 100);
  const nummer = sanitizeExternalText(batch.nummer || id.replace(/^batch_/, ''), 100);
  const laptops = batch.laptops
    .map(laptop => normalizeSharedLaptop({ ...laptop, batchId: id, batchNummer: nummer }))
    .filter(laptop => laptop && laptop.sticker);
  if (!laptops.length) return null;
  return {
    id,
    nummer,
    leverancier: sanitizeExternalText(batch.leverancier || 'Supplier import', 120),
    geimporteerd: sanitizeExternalText(batch.geimporteerd || new Date().toLocaleDateString('nl-NL'), 40),
    laptops,
  };
}

function normalizeSharedMonitor(monitor) {
  if (!monitor || !monitor.sticker) return null;
  const merk = sanitizeExternalText(monitor.merk, 80);
  const model = sanitizeExternalText(monitor.model, 160);
  const serie = sanitizeExternalText(monitor.serie, 80);
  const modelNumber = sanitizeExternalText(monitor.modelNumber, 160);
  const deviceName = sanitizeExternalText(monitor.deviceName || `${merk} ${model}`.trim(), 180);
  const identityOptions = normalizeMonitorIdentityOptions(monitor.identityOptions);
  const identityChoice = monitor.identityChoice ? {
    source: sanitizeExternalText(monitor.identityChoice.source, 80),
    deviceName: sanitizeExternalText(monitor.identityChoice.deviceName, 180),
    chosenAt: sanitizeExternalText(monitor.identityChoice.chosenAt, 80),
  } : null;
  return enrichMonitorWithPortDatabase({
    sticker: sanitizeExternalText(monitor.sticker, 64).replace(/[^\w.-]/g, ''),
    deviceName,
    merk,
    model,
    serie,
    modelNumber,
    serial: sanitizeExternalText(monitor.serial, 80),
    display: sanitizeExternalText(monitor.display, 80),
    resolution: sanitizeExternalText(monitor.resolution, 80),
    videoInputs: normalizeMonitorVideoInputs(monitor.videoInputs),
    leverancier_class: sanitizeExternalText(monitor.leverancier_class, 40),
    meldingen: sanitizeExternalText(monitor.meldingen, 1000),
    herkomst: sanitizeExternalText(monitor.herkomst, 180),
    batchId: sanitizeExternalText(monitor.batchId, 100),
    batchNummer: sanitizeExternalText(monitor.batchNummer, 100),
    monitorDatabaseModel: sanitizeExternalText(monitor.monitorDatabaseModel, 180),
    identityOptions,
    identityChoice,
  });
}

function normalizeSharedMonitorBatch(batch) {
  if (!batch || !Array.isArray(batch.monitors)) return null;
  const id = sanitizeExternalText(batch.id || `monitor_batch_${batch.nummer || Date.now()}`, 100);
  const nummer = sanitizeExternalText(batch.nummer || id.replace(/^monitor_batch_/, ''), 100);
  const monitors = batch.monitors
    .map(monitor => normalizeSharedMonitor({ ...monitor, batchId: id, batchNummer: nummer }))
    .filter(monitor => monitor && monitor.sticker);
  if (!monitors.length) return null;
  return {
    id,
    nummer,
    leverancier: sanitizeExternalText(batch.leverancier || 'Monitor supplier import', 120),
    geimporteerd: sanitizeExternalText(batch.geimporteerd || new Date().toLocaleDateString('nl-NL'), 40),
    monitors,
  };
}

function getSharedDemoSnapshot() {
  return {
    version: 1,
    users: USERS.map(serializeUser),
    batches: applyDeletionMarkersToBatches(BATCHES).map(normalizeSharedBatch).filter(Boolean),
    monitorBatches: applyDeletionMarkersToMonitorBatches(MONITOR_BATCHES).map(normalizeSharedMonitorBatch).filter(Boolean),
    history: STATE.history.map(({ _searchIndex, ...item }) => item),
    labelPrints: STATE.labelPrints.map(normalizeLabelPrint).filter(Boolean),
    monitorLabelPrints: STATE.monitorLabelPrints.map(normalizeMonitorLabelPrint).filter(Boolean),
    auditLogs: STATE.auditLogs.slice(-200),
    deletedBatchIds: normalizeDeletedBatchIds(STATE.deletedBatchIds),
    deletedLaptopStickers: normalizeDeletedLaptopStickers(STATE.deletedLaptopStickers),
    deletedMonitorBatchIds: normalizeDeletedMonitorBatchIds(STATE.deletedMonitorBatchIds),
    deletedMonitorStickers: normalizeDeletedMonitorStickers(STATE.deletedMonitorStickers),
    updatedAt: new Date().toISOString(),
  };
}

function saveLocalDemoStateBackup(snapshot = getSharedDemoSnapshot()) {
  try {
    localStorage.setItem(DEMO_STORAGE_KEYS.sharedBackup, JSON.stringify(snapshot));
  } catch {
    // Local storage may be unavailable in restricted browser contexts.
  }
}

function readLocalDemoStateBackup() {
  try {
    return JSON.parse(localStorage.getItem(DEMO_STORAGE_KEYS.sharedBackup) || 'null');
  } catch (error) {
    console.warn('Lokale demo-backup kon niet worden gelezen', error);
    return null;
  }
}

function getSharedDemoStateTimestamp(state) {
  const timestamp = Date.parse(state && state.updatedAt ? state.updatedAt : '');
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getSharedDemoStateContentWeight(state) {
  if (!state || typeof state !== 'object') return 0;
  const count = value => Array.isArray(value) ? value.length : 0;
  const batchItems = batches => (Array.isArray(batches) ? batches.reduce((sum, batch) => (
    sum + count(batch && (batch.laptops || batch.monitors))
  ), 0) : 0);
  return batchItems(state.batches)
    + batchItems(state.monitorBatches)
    + count(state.history)
    + count(state.labelPrints)
    + count(state.monitorLabelPrints)
    + count(state.auditLogs)
    + count(state.deletedBatchIds)
    + count(state.deletedLaptopStickers)
    + count(state.deletedMonitorBatchIds)
    + count(state.deletedMonitorStickers);
}

function mergeUniqueList(first, second, keyFn) {
  const merged = [];
  const seen = new Set();
  [first, second].forEach(list => {
    (Array.isArray(list) ? list : []).forEach(item => {
      const key = keyFn(item);
      if (!key || seen.has(key)) return;
      seen.add(key);
      merged.push(item);
    });
  });
  return merged;
}

function getBatchIdsFromStateBatches(batches) {
  return (Array.isArray(batches) ? batches : [])
    .map(batch => sanitizeExternalText(batch && (batch.id || batch.nummer), 100))
    .filter(Boolean);
}

function getLaptopStickersFromStateBatches(batches) {
  return (Array.isArray(batches) ? batches : [])
    .flatMap(batch => Array.isArray(batch && batch.laptops) ? batch.laptops : [])
    .map(laptop => getCanonicalSticker(laptop && laptop.sticker))
    .filter(Boolean);
}

function getMonitorStickersFromStateBatches(batches) {
  return (Array.isArray(batches) ? batches : [])
    .flatMap(batch => Array.isArray(batch && batch.monitors) ? batch.monitors : [])
    .map(monitor => getCanonicalMonitorSticker(monitor && monitor.sticker))
    .filter(Boolean);
}

function removeExistingValues(values, valuesToRemove) {
  const remove = new Set(valuesToRemove);
  return (Array.isArray(values) ? values : []).filter(value => !remove.has(value));
}

function mergeMonitorBatchesForLoad(primary, secondary) {
  const batchMap = new Map();
  (Array.isArray(primary) ? primary : []).forEach(batch => {
    if (!batch || !batch.id) return;
    batchMap.set(batch.id, { ...batch, monitors: Array.isArray(batch.monitors) ? batch.monitors.slice() : [] });
  });
  (Array.isArray(secondary) ? secondary : []).forEach(batch => {
    if (!batch || !batch.id) return;
    const current = batchMap.get(batch.id);
    if (!current) {
      batchMap.set(batch.id, { ...batch, monitors: Array.isArray(batch.monitors) ? batch.monitors.slice() : [] });
      return;
    }
    current.monitors = mergeUniqueList(current.monitors, batch.monitors, monitor => (
      monitor && monitor.sticker ? getCanonicalMonitorSticker(monitor.sticker) : ''
    ));
  });
  return Array.from(batchMap.values());
}

function mergeSharedDemoStateForLoad(primary, secondary) {
  if (!primary || typeof primary !== 'object') return secondary;
  if (!secondary || typeof secondary !== 'object') return primary;
  const mergedBatches = primary.batches || [];
  const mergedMonitorBatches = mergeMonitorBatchesForLoad(primary.monitorBatches, secondary.monitorBatches);
  const batchIds = getBatchIdsFromStateBatches(mergedBatches);
  const laptopStickers = getLaptopStickersFromStateBatches(mergedBatches);
  const monitorBatchIds = getBatchIdsFromStateBatches(mergedMonitorBatches);
  const monitorStickers = getMonitorStickersFromStateBatches(mergedMonitorBatches);
  return {
    ...primary,
    monitorBatches: mergedMonitorBatches,
    monitorLabelPrints: mergeUniqueList(primary.monitorLabelPrints, secondary.monitorLabelPrints, item => (
      item && item.sticker ? `${getCanonicalMonitorSticker(item.sticker)}:${item.printedAt || ''}` : ''
    )),
    deletedBatchIds: removeExistingValues(mergeUniqueList(primary.deletedBatchIds, secondary.deletedBatchIds, value => sanitizeExternalText(value, 100)), batchIds),
    deletedLaptopStickers: removeExistingValues(mergeUniqueList(primary.deletedLaptopStickers, secondary.deletedLaptopStickers, value => getCanonicalSticker(value)), laptopStickers),
    deletedMonitorBatchIds: removeExistingValues(mergeUniqueList(primary.deletedMonitorBatchIds, secondary.deletedMonitorBatchIds, value => sanitizeExternalText(value, 100)), monitorBatchIds),
    deletedMonitorStickers: removeExistingValues(mergeUniqueList(primary.deletedMonitorStickers, secondary.deletedMonitorStickers, value => getCanonicalMonitorSticker(value)), monitorStickers),
  };
}

function chooseSharedDemoState(remoteState, localState) {
  if (!remoteState || typeof remoteState !== 'object') return localState;
  if (!localState || typeof localState !== 'object') return remoteState;

  const remoteTime = getSharedDemoStateTimestamp(remoteState);
  const localTime = getSharedDemoStateTimestamp(localState);
  let primary;
  let secondary;
  if (localTime > remoteTime) {
    primary = localState;
    secondary = remoteState;
  } else if (remoteTime > localTime) {
    primary = remoteState;
    secondary = localState;
  } else if (getSharedDemoStateContentWeight(localState) > getSharedDemoStateContentWeight(remoteState)) {
    primary = localState;
    secondary = remoteState;
  } else {
    primary = remoteState;
    secondary = localState;
  }

  return mergeSharedDemoStateForLoad(primary, secondary);
}

function applySharedDemoState(state) {
  if (!state || typeof state !== 'object') return false;

  STATE.deletedBatchIds = normalizeDeletedBatchIds(state.deletedBatchIds);
  STATE.deletedLaptopStickers = normalizeDeletedLaptopStickers(state.deletedLaptopStickers);
  STATE.deletedMonitorBatchIds = normalizeDeletedMonitorBatchIds(state.deletedMonitorBatchIds);
  STATE.deletedMonitorStickers = normalizeDeletedMonitorStickers(state.deletedMonitorStickers);

  if (Array.isArray(state.users)) {
    const normalizedUsers = state.users.map(normalizeStoredUser).filter(Boolean);
    if (normalizedUsers.length) {
      USERS.splice(0, USERS.length, ...normalizedUsers);
      saveUsers();
      if (STATE.currentUser && STATE.currentUser.id) {
        const refreshedUser = getUserById(STATE.currentUser.id);
        if (refreshedUser) {
          STATE.currentUser = refreshedUser;
          saveSessionUser(refreshedUser);
        } else {
          clearSessionUser();
          STATE.currentUser = null;
          STATE.currentScreen = 'login';
        }
      }
    }
  }
  if (Array.isArray(state.batches) && (state.batches.length || state.updatedAt || STATE.deletedBatchIds.length || STATE.deletedLaptopStickers.length)) {
    const batches = applyDeletionMarkersToBatches(state.batches.map(normalizeSharedBatch).filter(Boolean));
    BATCHES.splice(0, BATCHES.length, ...batches);
    syncBatchAggregate();
  }
  if (Array.isArray(state.monitorBatches) && (state.monitorBatches.length || state.updatedAt || STATE.deletedMonitorBatchIds.length || STATE.deletedMonitorStickers.length)) {
    const batches = applyDeletionMarkersToMonitorBatches(state.monitorBatches.map(normalizeSharedMonitorBatch).filter(Boolean));
    MONITOR_BATCHES.splice(0, MONITOR_BATCHES.length, ...batches);
    rebuildMonitorIndex();
  }
  if (Array.isArray(state.history)) {
    STATE.history = state.history;
    rebuildHistoryIndexes();
  }
  if (Array.isArray(state.labelPrints)) {
    STATE.labelPrints = state.labelPrints;
    rebuildLabelPrintIndexes();
  } else {
    STATE.labelPrints = [];
    rebuildLabelPrintIndexes();
  }
  if (Array.isArray(state.monitorLabelPrints)) {
    STATE.monitorLabelPrints = state.monitorLabelPrints;
    rebuildMonitorLabelPrintIndexes();
  } else {
    STATE.monitorLabelPrints = [];
    rebuildMonitorLabelPrintIndexes();
  }
  if (Array.isArray(state.auditLogs)) {
    STATE.auditLogs = state.auditLogs;
  }
  return true;
}

function loadLocalDemoStateBackup() {
  return applySharedDemoState(readLocalDemoStateBackup());
}

async function loadSharedDemoState() {
  if (!canUseSharedDemoState()) return loadLocalDemoStateBackup();
  const localState = readLocalDemoStateBackup();
  try {
    const response = await fetch(SHARED_DEMO_STATE_URL, { cache: 'no-store' });
    if (!response.ok) return loadLocalDemoStateBackup();
    const remoteState = await response.json();
    const state = chooseSharedDemoState(remoteState, localState);
    const applied = applySharedDemoState(state);
    if (applied) saveLocalDemoStateBackup(state);
    return applied;
  } catch (error) {
    console.warn('Gedeelde demo-opslag kon niet worden geladen', error);
    return loadLocalDemoStateBackup();
  }
}

async function saveSharedDemoState() {
  const snapshot = getSharedDemoSnapshot();
  saveLocalDemoStateBackup(snapshot);
  if (!canUseSharedDemoState()) return false;
  try {
    const response = await fetch(SHARED_DEMO_STATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(snapshot),
    });
    return response.ok;
  } catch (error) {
    console.warn('Gedeelde demo-opslag kon niet worden opgeslagen', error);
    return false;
  }
}

function removeLaptopFromBatches(sticker) {
  let removed = false;
  BATCHES.forEach(batch => {
    const before = batch.laptops.length;
    batch.laptops = batch.laptops.filter(l => l.sticker !== sticker);
    if (batch.laptops.length !== before) removed = true;
  });
  for (let i = BATCHES.length - 1; i >= 0; i--) {
    if (BATCHES[i].laptops.length === 0 && BATCHES.length > 1) BATCHES.splice(i, 1);
  }
  if (removed) markLaptopDeleted(sticker);
  syncBatchAggregate();
  return removed;
}

function removeBatch(batchId) {
  const index = BATCHES.findIndex(batch => batch.id === batchId);
  if (index < 0) return false;
  BATCHES.splice(index, 1);
  markBatchDeleted(batchId);
  syncBatchAggregate();
  return true;
}

function removeMonitorFromBatches(sticker) {
  let removed = false;
  MONITOR_BATCHES.forEach(batch => {
    const before = batch.monitors.length;
    batch.monitors = batch.monitors.filter(monitor => monitor.sticker !== sticker);
    if (batch.monitors.length !== before) removed = true;
  });
  for (let i = MONITOR_BATCHES.length - 1; i >= 0; i--) {
    if (MONITOR_BATCHES[i].monitors.length === 0) MONITOR_BATCHES.splice(i, 1);
  }
  if (removed) markMonitorDeleted(sticker);
  rebuildMonitorIndex();
  return removed;
}

function removeMonitorBatch(batchId) {
  const index = MONITOR_BATCHES.findIndex(batch => batch.id === batchId);
  if (index < 0) return false;
  MONITOR_BATCHES.splice(index, 1);
  markMonitorBatchDeleted(batchId);
  rebuildMonitorIndex();
  return true;
}

function normalizeText(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text || text === '-' || text.toLowerCase() === 'not selected' || text.toLowerCase() === 'n/a') return '';
  return text;
}

function sanitizeExternalText(value, maxLength = 240) {
  return normalizeText(value)
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .slice(0, maxLength);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}



