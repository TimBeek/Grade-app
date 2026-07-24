// =============================================================================
// LABEL PRINTING
// Specslabels, probleemlabels en printvensters.
// =============================================================================
const DYMO_LABEL_CONFIG = {
  productCode: 'S0722520',
  dymoLabelNumber: '11352',
  labelName: 'Large Return Address Labels',
  labelSize: 'LW 25x54mm',
  paperName: '11352 Return Address Int',
  paperId: 'ReturnAddressInt',
  widthMm: 54,
  heightMm: 25,
  sdkPath: 'assets/dymo.connect.framework.js?v=20260519-dymo-labelwriter-450',
};

const BROWSER_PRINT_PROFILES = {
  dymoLabel: {
    id: 'dymo-label-54x25',
    label: 'DYMO fallback 54x25mm',
    widthMm: 54,
    heightMm: 25,
    windowWidth: 420,
    windowHeight: 260,
  },
  hpEngageReceipt: {
    id: 'hp-engage-80x297',
    label: 'HP Engage One Prime 80mm receipt',
    widthMm: 80,
    heightMm: 86,
    printableWidthMm: 48,
    leftOffsetMm: 22,
    windowWidth: 420,
    windowHeight: 360,
  },
};

let dymoFrameworkPromise = null;
let dymoInitPromise = null;

function labelValue(value, fallback = '-') {
  const clean = String(value || '').trim();
  return clean || fallback;
}

// Verwijdert een dubbel merk aan het begin van een labeltitel, bv.
// "HP HP EliteBook 840" -> "HP EliteBook 840". Voorkomt dat het merk twee keer
// achter elkaar op het label komt (import-/correctie-data die het merk al in
// het modelveld heeft staan).
function dedupeLabelBrand(text) {
  const clean = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  if (!clean) return clean;
  const words = clean.split(' ');
  while (words.length > 1 && words[0].toLowerCase() === words[1].toLowerCase()) {
    words.splice(1, 1);
  }
  return words.join(' ');
}

function formatBatteryForLabel(value) {
  const clean = String(value || '').trim();
  if (!clean) return '';
  if (/%$/.test(clean)) return clean;
  const normalized = clean.replace(',', '.');
  const number = Number(normalized);
  if (Number.isFinite(number)) {
    if (number > 0 && number <= 1) return `${Math.round(number * 100)}%`;
    if (number > 1 && number <= 100) return `${Math.round(number)}%`;
  }
  const decimalMatch = normalized.match(/\b0\.(\d{1,3})\b/);
  if (decimalMatch) return `${Math.round(Number(`0.${decimalMatch[1]}`) * 100)}%`;
  return clean;
}

function compactProblemText(text) {
  return String(text || '')
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/reparatie\s*\/\s*niet verkoopbaar/i, 'Repair')
    .replace(/repair\s*\/\s*not sellable/i, 'Repair')
    .replace('Keyboard', 'KB')
    .replace('toetsenbord', 'KB')
    .replace('LCD / glas', 'LCD')
    .replace('Bovenkap', 'Lid')
    .replace('Onderkant', 'Bottom')
    .replace('Scharnieren', 'Hinge')
    .replace('Touchpad', 'TP')
    .replace(' gemarkeerd als defect', ' defect')
    .replace('niet functioneel', 'defect')
    .trim();
}

function isRepairLabelIssue(issue) {
  const text = String(issue || '').toLowerCase();
  if (!text) return false;
  if (/\bsafety\s*marking(s)?\b|\bveiligheidsmarkering(en)?\b/i.test(text)) return false;
  return /(defect|faulty|cracked|broken|gebroken|gebarsten|barst|no power|does not power|geen beeld|dead battery|missing battery|battery missing|ontbreekt|pixel line|dead pixel|dead pixels|flicker|flikker|schermflikkering|toets werkt niet|key not working|keyboard .*faulty|keyboard missing|touchpad werkt niet|touchpad not working|scharnier kapot|scharnier werkt niet|hinge .*not functional|not functional|niet functioneel|los|scherpe rand|safety risk|veiligheidsrisico|herstel|herstellen|rechtmaken|niet herstelbaar|verbogen)/i.test(text);
}

function getRepairIssues(laptop, result) {
  result = result || {};
  if (Array.isArray(result.repairActions) && result.repairActions.length) {
    return Array.from(new Set(result.repairActions.map(action => action && action.issue).filter(Boolean))).map(compactProblemText);
  }
  const resultIssues = (result.problems || []).filter(Boolean);
  const repairResultIssues = result.forceProblemLabel ? resultIssues : resultIssues.filter(isRepairLabelIssue);
  const supplierIssues = splitSupplierIssues(laptop).filter(isRepairLabelIssue);
  return Array.from(new Set(repairResultIssues.concat(supplierIssues))).map(compactProblemText);
}

function getProblemLabelRows(laptop, result) {
  result = result || {};
  const repairIssues = getRepairIssues(laptop, result);
  const isRepair = needsProblemLabel(laptop, result);
  const problems = repairIssues.length ? repairIssues : [isRepair ? 'Controle reparatie' : 'Geen reparatieomschrijving'];
  const labelType = result.repairLabelType || (result.repairPolicy && result.repairPolicy.labelType) || '';

  if (labelType === 'production') {
    return [
      'PRODUCTIE',
      'Tijdens productie repareren',
      problems.slice(0, 2).join(' / '),
      ''
    ];
  }

  if (labelType === 'reject') {
    return [
      'NIET VERKOOPBAAR',
      compactProblemText(result.repairPolicy && result.repairPolicy.reason ? result.repairPolicy.reason : 'Te veel/zware reparatie'),
      problems.slice(0, 2).join(' / '),
      ''
    ];
  }

  return [
    'REPARATIE',
    problems[0] || '',
    problems.slice(1, 3).join(' / '),
    ''
  ];
}

function getSpecsLabelRows(laptop, result, options = {}) {
  const grade = result && result.eindgrade === 'D' ? 'X' : result && result.eindgrade;
  const touch = isTouchscreenLaptop(laptop) ? 'Ja' : 'Nee';
  const battery = formatBatteryForLabel(laptop.battery);
  const gpu = labelValue(laptop.labelGpu || getNoteworthyGpu(laptop.gpu), '');
  const row4Parts = [];
  if (battery) row4Parts.push(`Accu ${battery}`);
  if (gpu) row4Parts.push(gpu);

  return [
    dedupeLabelBrand(`${labelValue(laptop.merk, '')} ${labelValue(laptop.model, '')}`.trim()),
    `${labelValue(laptop.processor)} / ${labelValue(laptop.ram)} / ${labelValue(laptop.ssd)}`,
    options.hideGrade
      ? `Grade ...... / Touch ${touch}`
      // Staat de grade al groot in de badge? Dan hoeft hij niet nog eens klein
      // in de regel, en houden de specs meer ruimte over.
      : options.gradeInBadge ? `Touch ${touch}` : `Grade ${grade} / Touch ${touch}`,
    row4Parts.join(' / ')
  ];
}

function compactMonitorVideoInputs(value) {
  return labelValue(value, 'Video in onbekend')
    .replace(/\bmini\s*display\s*port\b/gi, 'Mini DP')
    .replace(/\bmini\s*displayport\b/gi, 'Mini DP')
    .replace(/\bdisplay\s*port\b/gi, 'DP')
    .replace(/\bdisplayport\b/gi, 'DP')
    .replace(/\bdisplaypoort\b/gi, 'DP')
    .replace(/\bscherm\s*poort\b/gi, 'DP')
    .replace(/\bschermport\b/gi, 'DP')
    .replace(/\bschermpoort\b/gi, 'DP')
    .replace(/\busb\s*\/\s*c\b/gi, 'USB-C')
    .replace(/\busb[\s-]*c\b/gi, 'USB-C')
    .replace(/\btype[\s-]*c\b/gi, 'USB-C')
    .replace(/\bd[\s-]*sub\b/gi, 'VGA')
    .replace(/\s*\/\s*/g, ' / ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getMonitorLabelRows(monitor, grade) {
  const displayParts = [];
  if (monitor.display) displayParts.push(monitor.display);
  if (monitor.resolution) displayParts.push(monitor.resolution);
  const videoInputs = compactMonitorVideoInputs(monitor.videoInputs);
  // The grade is rendered separately as a large badge, so it is intentionally
  // left out of the text rows here.
  const title = monitor.deviceName || `${labelValue(monitor.merk, '')} ${labelValue(monitor.model, '')}`.trim();
  return [
    labelValue(dedupeLabelBrand(title), 'Monitor'),
    displayParts.length ? displayParts.join(' / ') : 'Scherm',
    `Video in: ${videoInputs}`
  ];
}

function getLabelRows(laptop, result, type = 'specs', options = {}) {
  return type === 'problems' ? getProblemLabelRows(laptop, result || { eindgrade: '', problems: [] }) : getSpecsLabelRows(laptop, result, options);
}

function needsProblemLabel(laptop, result) {
  result = result || {};
  return Boolean(result.forceProblemLabel) || (Array.isArray(result.repairActions) && result.repairActions.length > 0) || getRepairIssues(laptop, result).length > 0;
}

function getDymoLabelConfig() {
  return { ...DYMO_LABEL_CONFIG };
}

function getBrowserPrintProfiles() {
  return {
    dymoLabel: { ...BROWSER_PRINT_PROFILES.dymoLabel },
    hpEngageReceipt: { ...BROWSER_PRINT_PROFILES.hpEngageReceipt },
  };
}

function isLikelyHpEngageDevice() {
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const text = `${nav.userAgent || ''} ${nav.platform || ''}`.toLowerCase();
  const touchPoints = Number(nav.maxTouchPoints || 0);
  return /hp.*engage|engage.*hp|android/.test(text) || (touchPoints > 0 && /linux arm|android/.test(text));
}

function getBrowserPrintProfile(options = {}) {
  if (options.browserPrintProfile === 'hp-engage' || options.browserPrintProfile === 'hpEngageReceipt') {
    return { ...BROWSER_PRINT_PROFILES.hpEngageReceipt };
  }
  if (options.browserPrintProfile === 'dymo-label' || options.browserPrintProfile === 'dymoLabel') {
    return { ...BROWSER_PRINT_PROFILES.dymoLabel };
  }
  return isLikelyHpEngageDevice()
    ? { ...BROWSER_PRINT_PROFILES.hpEngageReceipt }
    : { ...BROWSER_PRINT_PROFILES.dymoLabel };
}

function getMonitorBrowserPrintProfile(options = {}) {
  if (options.browserPrintProfile) return getBrowserPrintProfile(options);
  return { ...BROWSER_PRINT_PROFILES.dymoLabel };
}

function getHpEngagePageHeightMm(rows, type = 'specs') {
  const cleanRows = rows.map(row => String(row || '').trim()).filter(Boolean);
  const wrapPenalty = cleanRows.reduce((sum, row) => sum + Math.max(0, Math.ceil(row.length / 30) - 1), 0);
  const baseHeight = type === 'problems' ? 72 : 78;
  return Math.min(105, Math.max(baseHeight, baseHeight + (wrapPenalty * 6)));
}

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function getDymoFrameworkObject() {
  if (typeof window === 'undefined' || !window.dymo || !window.dymo.label) return null;
  return window.dymo.label.framework || null;
}

function loadDymoFramework() {
  const existingFramework = getDymoFrameworkObject();
  if (existingFramework) return Promise.resolve(existingFramework);
  if (dymoFrameworkPromise) return dymoFrameworkPromise;
  if (typeof document === 'undefined' || !document.createElement) {
    return Promise.reject(new Error('DYMO Connect Framework can only load in the browser.'));
  }

  dymoFrameworkPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timeoutId = setTimeout(() => reject(new Error('DYMO Connect Framework is not responding.')), 7000);

    script.src = DYMO_LABEL_CONFIG.sdkPath;
    script.async = true;
    script.dataset.dymoConnectFramework = 'true';
    script.onload = () => {
      clearTimeout(timeoutId);
      const framework = getDymoFrameworkObject();
      if (framework) resolve(framework);
      else reject(new Error('DYMO Connect Framework loaded but is not available.'));
    };
    script.onerror = () => {
      clearTimeout(timeoutId);
      reject(new Error('DYMO Connect Framework could not be loaded.'));
    };

    (document.head || document.documentElement).appendChild(script);
  }).catch(error => {
    dymoFrameworkPromise = null;
    throw error;
  });

  return dymoFrameworkPromise;
}

function initializeDymoFramework(framework) {
  if (!framework || typeof framework.init !== 'function') return Promise.resolve(framework);
  if (dymoInitPromise) return dymoInitPromise;

  dymoInitPromise = new Promise((resolve, reject) => {
    let settled = false;
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('DYMO Connect Web Service is not responding.'));
    }, 7000);

    try {
      framework.init(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        resolve(framework);
      });
    } catch (error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      reject(error);
    }
  }).catch(error => {
    dymoInitPromise = null;
    throw error;
  });

  return dymoInitPromise;
}

async function getReadyDymoFramework() {
  const framework = await loadDymoFramework();
  await initializeDymoFramework(framework);
  return framework;
}

function validateDymoEnvironment(framework) {
  if (!framework || typeof framework.checkEnvironment !== 'function') return;
  const environment = framework.checkEnvironment();
  if (!environment) return;
  if (environment.isBrowserSupported === false) {
    throw new Error('This browser is not supported by DYMO Connect.');
  }
  if (Object.prototype.hasOwnProperty.call(environment, 'isWebServicePresent') && environment.isWebServicePresent === false) {
    throw new Error('DYMO Connect Web Service is not running.');
  }
  if (Object.prototype.hasOwnProperty.call(environment, 'isFrameworkInstalled') && environment.isFrameworkInstalled === false) {
    throw new Error('DYMO Connect Framework is not active on this device.');
  }
}

function normalizeDymoPrinters(printers) {
  if (!printers) return [];
  if (Array.isArray(printers)) return printers;
  if (Array.isArray(printers.printers)) return printers.printers;
  return Object.values(printers).filter(printer => printer && typeof printer === 'object');
}

async function getDymoPrinters(framework) {
  if (framework && typeof framework.getPrintersAsync === 'function') {
    return normalizeDymoPrinters(await framework.getPrintersAsync());
  }
  if (framework && typeof framework.getPrinters === 'function') {
    return normalizeDymoPrinters(framework.getPrinters());
  }
  return [];
}

function getDymoPrinterText(printer) {
  return `${printer && printer.name ? printer.name : ''} ${printer && printer.modelName ? printer.modelName : ''}`.trim();
}

function findPreferredDymoPrinter(printers) {
  const usablePrinters = normalizeDymoPrinters(printers)
    .filter(printer => printer && printer.name)
    .filter(printer => printer.isConnected !== false);
  const labelWriters = usablePrinters.filter(printer => /dymo|labelwriter/i.test(getDymoPrinterText(printer)));
  return labelWriters.find(printer => /labelwriter\s*450/i.test(getDymoPrinterText(printer)))
    || labelWriters[0]
    || usablePrinters[0]
    || null;
}

function dymoTextObject(name, text, bounds, fontSize, bold = false, align = 'Left') {
  return `
    <ObjectInfo>
      <TextObject>
        <Name>${name}</Name>
        <ForeColor Alpha="255" Red="0" Green="0" Blue="0" />
        <BackColor Alpha="0" Red="255" Green="255" Blue="255" />
        <LinkedObjectName></LinkedObjectName>
        <Rotation>Rotation0</Rotation>
        <IsMirrored>False</IsMirrored>
        <IsVariable>True</IsVariable>
        <HorizontalAlignment>${align}</HorizontalAlignment>
        <VerticalAlignment>Middle</VerticalAlignment>
        <TextFitMode>ShrinkToFit</TextFitMode>
        <UseFullFontHeight>False</UseFullFontHeight>
        <Verticalized>False</Verticalized>
        <StyledText>
          <Element>
            <String>${escapeXml(text)}</String>
            <Attributes>
              <Font Family="Arial" Size="${fontSize}" Bold="${bold ? 'True' : 'False'}" Italic="False" Underline="False" Strikeout="False" />
              <ForeColor Alpha="255" Red="0" Green="0" Blue="0" />
            </Attributes>
          </Element>
        </StyledText>
      </TextObject>
      <Bounds X="${bounds.x}" Y="${bounds.y}" Width="${bounds.width}" Height="${bounds.height}" />
    </ObjectInfo>`;
}

// DYMO does not word-wrap inside a text box; it keeps one line and shrinks.
// So we split a long title into two balanced lines ourselves at the space
// closest to the middle, which keeps the font readable.
function wrapLabelTitleForDymo(title) {
  const text = String(title || '').trim();
  if (text.length <= 24 || !text.includes(' ')) return text;
  const mid = Math.floor(text.length / 2);
  let splitAt = -1;
  for (let offset = 0; offset < text.length; offset++) {
    const left = mid - offset;
    const right = mid + offset;
    if (left > 0 && text[left] === ' ') { splitAt = left; break; }
    if (right < text.length && text[right] === ' ') { splitAt = right; break; }
  }
  if (splitAt === -1) return text;
  return `${text.slice(0, splitAt).trim()}\n${text.slice(splitAt + 1).trim()}`;
}

// ---- Grade-visualisatie op het label ----------------------------------------
// De DYMO 450 is een thermische printer: alleen zwart-wit. De oude gele/blauwe/
// roze markers kunnen dus niet meer. Kleur vervangen we door de drie dingen die
// op afstand wél overeind blijven: massa (hoeveel zwart), positie en grootte.
//
// Daarom kwaliteitsbalken naast een grote letter — bewust dubbel gecodeerd:
//   veraf  -> je ziet hoeveel balken gevuld zijn (meer/hoger zwart = beter)
//   dichtbij -> je leest de letter
// De balken lopen op in hoogte, zoals signaalsterkte: A=4, B=3, C=2, X=1.
// Losse segmenten i.p.v. één massief blok, want grote zwarte vlakken slijten
// de thermische kop sneller en kunnen vegen.
const GRADE_BAR_COUNT = 4;
const GRADE_BAR_LEVELS = { A: 4, B: 3, C: 2, X: 1, D: 1 };

function normalizeSpecsGradeBadge(grade) {
  const value = String(grade || '').trim().toUpperCase();
  if (!value) return '';
  return value === 'D' ? 'X' : value;
}

function getGradeBarLevel(grade) {
  return GRADE_BAR_LEVELS[normalizeSpecsGradeBadge(grade)] || 0;
}

function dymoShapeObject(name, bounds, filled) {
  const fill = filled
    ? '<FillColor Alpha="255" Red="0" Green="0" Blue="0" />'
    : '<FillColor Alpha="0" Red="255" Green="255" Blue="255" />';
  return `
    <ObjectInfo>
      <ShapeObject>
        <Name>${name}</Name>
        <ForeColor Alpha="255" Red="0" Green="0" Blue="0" />
        <BackColor Alpha="0" Red="255" Green="255" Blue="255" />
        <LinkedObjectName></LinkedObjectName>
        <Rotation>Rotation0</Rotation>
        <IsMirrored>False</IsMirrored>
        <IsVariable>False</IsVariable>
        <ShapeType>Rectangle</ShapeType>
        ${fill}
        <LineColor Alpha="255" Red="0" Green="0" Blue="0" />
        <LineWidth>18</LineWidth>
      </ShapeObject>
      <Bounds X="${Math.round(bounds.x)}" Y="${Math.round(bounds.y)}" Width="${Math.round(bounds.width)}" Height="${Math.round(bounds.height)}" />
    </ObjectInfo>`;
}

// Oplopende balkjes binnen het opgegeven vlak; de eerste `level` zijn gevuld.
function buildGradeBarsDymo(level, area) {
  const gap = Math.round(area.width * 0.07);
  const barWidth = Math.round((area.width - gap * (GRADE_BAR_COUNT - 1)) / GRADE_BAR_COUNT);
  const bottom = area.y + area.height;
  let xml = '';
  for (let i = 0; i < GRADE_BAR_COUNT; i++) {
    const height = Math.round(area.height * (0.4 + 0.2 * i));
    xml += dymoShapeObject(`GRADE_BAR_${i + 1}`, {
      x: area.x + i * (barWidth + gap),
      y: bottom - height,
      width: barWidth,
      height,
    }, i < level);
  }
  return xml;
}

function buildDymoLabelXml(rows, type = 'specs', grade = '') {
  const isMonitorLabel = type === 'monitor';
  const isSpecsLabel = type === 'specs';
  const specsBadge = isSpecsLabel ? normalizeSpecsGradeBadge(grade) : '';
  const gradeBadge = isMonitorLabel ? displayMonitorGrade(grade) : specsBadge;
  const showGradeBadge = Boolean(gradeBadge);
  const cleanRows = rows.map(row => String(row || '').trim()).slice(0, isMonitorLabel ? 3 : 4);
  const longestRow = Math.max(...cleanRows.map(row => row.length), 1);
  const tight = longestRow > 46;
  const compact = longestRow > 34;
  // Reserve a tidy column on the right for the grade (caption + value) on
  // monitor labels, with the spec rows kept in a clean left column.
  const monitorRowWidth = showGradeBadge ? 1900 : 2770;
  // A long device name gets a taller first row so it wraps to two lines and
  // stays readable, instead of being shrunk down to fit a single line.
  const monitorTitleLong = isMonitorLabel && (cleanRows[0] || '').length > 24;
  const monitorSpecsLongest = Math.max((cleanRows[1] || '').length, (cleanRows[2] || '').length, 1);
  const monitorSpecSize = monitorSpecsLongest > 40 ? 8.2 : monitorSpecsLongest > 30 ? 8.9 : 9.6;
  const fontSizes = isMonitorLabel
    ? [monitorTitleLong ? 11 : 13, monitorSpecSize, monitorSpecSize]
    : (tight
      ? [9.5, 6.8, 6.8, 6.2]
      : compact
        ? [11.2, 7.8, 7.8, 6.8]
        : [13, 8.8, 8.8, 7.5]);
  const bounds = isMonitorLabel
    ? (monitorTitleLong
      ? [
        { x: 170, y: 80, width: monitorRowWidth, height: 560 },
        { x: 170, y: 670, width: monitorRowWidth, height: 300 },
        { x: 170, y: 985, width: monitorRowWidth, height: 300 },
      ]
      : [
        { x: 170, y: 90, width: monitorRowWidth, height: 410 },
        { x: 170, y: 520, width: monitorRowWidth, height: 345 },
        { x: 170, y: 885, width: monitorRowWidth, height: 345 },
      ])
    : (() => {
      // Met een gradekolom rechts krijgen de specs-regels een smallere kolom.
      const specsRowWidth = showGradeBadge ? 1880 : 2770;
      return [
        { x: 170, y: 50, width: specsRowWidth, height: 330 },
        { x: 170, y: 390, width: specsRowWidth, height: 285 },
        { x: 170, y: 680, width: specsRowWidth, height: 285 },
        { x: 170, y: 970, width: specsRowWidth, height: 310 },
      ];
    })();
  // DYMO does not wrap, so pre-split a long monitor title into two lines.
  const xmlRows = cleanRows.slice();
  if (monitorTitleLong) xmlRows[0] = wrapLabelTitleForDymo(xmlRows[0]);
  const objects = xmlRows
    .map((row, index) => dymoTextObject(`ROW_${index + 1}`, row, bounds[index], fontSizes[index], index === 0 || index === 2))
    .join('');
  const gradeObject = !showGradeBadge
    ? ''
    : isMonitorLabel
      ? dymoTextObject('GRADE_CAPTION', 'GRADE', { x: 2120, y: 150, width: 820, height: 210 }, 7.6, true, 'Center')
        + dymoTextObject('GRADE_BADGE', gradeBadge, { x: 2120, y: 360, width: 820, height: 790 }, 39, true, 'Center')
      // Laptop: grote letter bovenin, kwaliteitsbalken eronder.
      : dymoTextObject('GRADE_BADGE', gradeBadge, { x: 2080, y: 90, width: 880, height: 800 }, 36, true, 'Center')
        + buildGradeBarsDymo(getGradeBarLevel(gradeBadge), { x: 2170, y: 950, width: 700, height: 330 });

  return `<?xml version="1.0" encoding="utf-8"?>
<DieCutLabel Version="8.0" Units="twips">
  <PaperOrientation>Landscape</PaperOrientation>
  <Id>${DYMO_LABEL_CONFIG.paperId}</Id>
  <PaperName>${DYMO_LABEL_CONFIG.paperName}</PaperName>
  <DrawCommands>
    <RoundRectangle X="0" Y="0" Width="1440" Height="3060" Rx="180" Ry="180" />
  </DrawCommands>
  ${objects}${gradeObject}
</DieCutLabel>`;
}

// Max. wachttijd op de DYMO Connect-service. Als de service geïnstalleerd is
// maar niet reageert, zou een DYMO-await anders eeuwig blijven hangen ("Working..."
// blijft staan, geen label, niets opgeslagen). Na deze tijd valt de app terug op
// het browser-printvenster, dat altijd werkt.
const DYMO_PRINT_TIMEOUT_MS = 9000;

function withPrintTimeout(promise, ms = DYMO_PRINT_TIMEOUT_MS, label = 'DYMO print timed out') {
  if (typeof setTimeout !== 'function') return promise;
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== null) clearTimeout(timer);
  });
}

async function printRowsWithDymo(rows, type = 'specs', grade = '') {
  const framework = await getReadyDymoFramework();
  validateDymoEnvironment(framework);
  const printer = findPreferredDymoPrinter(await getDymoPrinters(framework));
  if (!printer) throw new Error('No DYMO LabelWriter printer found.');

  const labelXml = buildDymoLabelXml(rows, type, grade);
  const label = framework.openLabelXml(labelXml);
  if (label && typeof label.isValidLabel === 'function' && !label.isValidLabel()) {
    throw new Error(`DYMO rejected the ${DYMO_LABEL_CONFIG.labelSize} label template.`);
  }

  if (typeof framework.printLabelAsync === 'function') {
    await framework.printLabelAsync(printer.name, '', labelXml, '');
  } else if (label && typeof label.printAsync === 'function') {
    await label.printAsync(printer.name);
  } else if (label && typeof label.print === 'function') {
    label.print(printer.name);
  } else if (typeof framework.printLabel === 'function') {
    framework.printLabel(printer.name, '', labelXml, '');
  } else {
    throw new Error('DYMO print function is unavailable.');
  }

  return { printerName: printer.name };
}

function getBrowserLabelMarkup(rows, type = 'specs', profile = BROWSER_PRINT_PROFILES.dymoLabel, grade = '') {
  const longestRow = Math.max(...rows.map(row => String(row || '').length), 1);
  const isMonitorLabel = type === 'monitor';
  const isSpecsLabel = type === 'specs';
  const specsBadge = isSpecsLabel ? normalizeSpecsGradeBadge(grade) : '';
  const gradeBadge = isMonitorLabel ? displayMonitorGrade(grade) : specsBadge;
  const showGradeBadge = Boolean(gradeBadge);
  const scaleClass = `${isMonitorLabel ? 'monitor-label' : ''} ${isMonitorLabel && showGradeBadge ? 'monitor-has-grade' : ''} ${isSpecsLabel && showGradeBadge ? 'specs-has-grade' : ''} ${longestRow > 46 ? 'tight' : longestRow > 34 ? 'compact' : ''}`.trim();
  if (profile.id === BROWSER_PRINT_PROFILES.hpEngageReceipt.id) {
    const safeRows = rows.map(row => String(row || '').trim());
    const labelHtml = `
      <div class="receipt-brand">REMARKT.</div>
      <div class="receipt-type">${type === 'monitor' ? 'MONITOR LABEL' : type === 'problems' ? 'REPAIR LABEL' : 'SPECS LABEL'}</div>
      <div class="receipt-main">${escapeHtml(safeRows[0] || 'Device')}</div>
      ${showGradeBadge ? `<div class="receipt-grade">GRADE ${escapeHtml(gradeBadge)}</div>` : ''}
      ${safeRows.slice(1).map(row => row ? `<div class="receipt-row">${escapeHtml(row)}</div>` : '').join('')}
      <div class="receipt-footer">Printed via HP Engage · ${new Date().toLocaleString('nl-NL', { dateStyle: 'short', timeStyle: 'short' })}</div>
    `;
    return {
      title: `ReMarkt ${type === 'problems' ? 'repair label' : 'specs label'} HP Engage`,
      scaleClass: 'receipt-mode',
      labelHtml,
    };
  }

  const rowsHtml = rows
    .map((row, index) => row ? `<div class="label-row row-${index + 1}">${escapeHtml(row)}</div>` : '')
    .join('');
  const gradeBarsHtml = Array.from({ length: GRADE_BAR_COUNT }, (unused, index) =>
    `<span class="grade-bar${index < getGradeBarLevel(specsBadge) ? ' is-on' : ''}"></span>`).join('');
  const labelHtml = isMonitorLabel && showGradeBadge
    ? `<div class="monitor-label-text">${rowsHtml}</div><div class="monitor-grade-box"><span class="monitor-grade-caption">GRADE</span><span class="monitor-grade-value">${escapeHtml(gradeBadge)}</span></div>`
    : isSpecsLabel && showGradeBadge
      ? `<div class="specs-label-text">${rowsHtml}</div><div class="specs-grade-box"><span class="specs-grade-value">${escapeHtml(specsBadge)}</span><span class="grade-bars">${gradeBarsHtml}</span></div>`
      : rowsHtml;

  return {
    title: `ReMarkt ${type === 'monitor' ? 'monitor label' : type === 'problems' ? 'repair label' : 'specs label'}`,
    scaleClass,
    labelHtml,
  };
}

function createPreparedPrintWindow(type = 'specs', profile = BROWSER_PRINT_PROFILES.dymoLabel) {
  if (typeof window === 'undefined' || typeof window.open !== 'function') return null;
  const printWindow = window.open('', `remarktLabelPrint_${type}`, `width=${profile.windowWidth},height=${profile.windowHeight}`);
  if (!printWindow) return null;
  printWindow.document.write(`
    <!doctype html>
    <html lang="nl">
    <head>
      <meta charset="utf-8">
      <title>Preparing ReMarkt label</title>
      <style>
        body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: Arial, Helvetica, sans-serif; color: #222; background: #f3f3f3; }
        div { font-size: 14px; }
      </style>
    </head>
    <body><div>Preparing label...</div></body>
    </html>
  `);
  printWindow.document.close();
  return printWindow;
}

function closePreparedPrintWindow(printWindow) {
  try {
    if (printWindow && !printWindow.closed) printWindow.close();
  } catch {
    // Browser may block window control after the print path changes.
  }
}

function openBrowserPrintLabel(rows, type = 'specs', preparedWindow = null, profile = BROWSER_PRINT_PROFILES.dymoLabel, grade = '') {
  const { title, scaleClass, labelHtml } = getBrowserLabelMarkup(rows, type, profile, grade);
  const pageHeightMm = profile.id === BROWSER_PRINT_PROFILES.hpEngageReceipt.id
    ? getHpEngagePageHeightMm(rows, type)
    : profile.heightMm;
  const receiptPrintableWidthMm = profile.printableWidthMm || profile.widthMm;
  const receiptLeftOffsetMm = profile.leftOffsetMm || 0;
  const printWindow = preparedWindow || (typeof window !== 'undefined' && typeof window.open === 'function'
    ? window.open('', `remarktLabelPrint_${type}`, `width=${profile.windowWidth},height=${profile.windowHeight}`)
    : null);
  if (!printWindow) {
    setAppMessage('Pop-up blocked. Allow pop-ups for this page to print labels.');
    render();
    return false;
  }

  printWindow.document.write(`
    <!doctype html>
    <html lang="nl">
    <head>
      <meta charset="utf-8">
      <title>${escapeHtml(title)}</title>
      <style>
        @page { size: ${profile.widthMm}mm ${pageHeightMm}mm; margin: 0; }
        * { box-sizing: border-box; }
        html, body {
          width: ${profile.widthMm}mm;
          min-height: ${pageHeightMm}mm;
          margin: 0;
          padding: 0;
          background: #fff;
          color: #000;
          font-family: Arial, Helvetica, sans-serif;
          print-color-adjust: exact;
          -webkit-print-color-adjust: exact;
        }
        .label {
          width: ${DYMO_LABEL_CONFIG.widthMm}mm;
          height: ${DYMO_LABEL_CONFIG.heightMm}mm;
          padding: 1.1mm 1.4mm 1.1mm 3mm;
          display: grid;
          grid-template-rows: 6.4mm 5.4mm 5.4mm 5.5mm;
          align-content: center;
          overflow: hidden;
        }
        .label-row {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          line-height: 0.98;
          letter-spacing: 0;
        }
        .row-1 { font-size: 11pt; font-weight: 800; }
        .row-2 { font-size: 8.1pt; font-weight: 700; }
        .row-3 { font-size: 8.1pt; font-weight: 800; }
        .row-4 { font-size: 7pt; font-weight: 700; }
        .compact .row-1 { font-size: 9.5pt; }
        .compact .row-2, .compact .row-3 { font-size: 7.2pt; }
        .compact .row-4 { font-size: 6.4pt; }
        .tight { grid-template-rows: repeat(4, 5.55mm); }
        .tight .label-row { line-height: 1; }
        .tight .row-1 { font-size: 8.7pt; }
        .tight .row-2, .tight .row-3, .tight .row-4 { font-size: 6.3pt; }
        /* Laptoplabel met grade-badge: specs links, letter + kwaliteitsbalken
           rechts. Balken lopen op in hoogte; gevuld = beter (A=4 ... X=1). */
        .label.specs-has-grade {
          grid-template-rows: none;
          grid-template-columns: minmax(0, 1fr) 12.5mm;
          align-items: stretch;
          column-gap: 0;
          padding-right: 1mm;
        }
        .specs-label-text {
          min-width: 0;
          display: grid;
          grid-template-rows: 6.4mm 5.4mm 5.4mm 5.5mm;
          align-content: center;
        }
        .specs-grade-box {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 0.9mm;
          border-left: 0.3mm solid #000;
          padding-left: 1mm;
        }
        .specs-grade-value {
          font-size: 20pt;
          font-weight: 900;
          line-height: 0.85;
        }
        .grade-bars {
          display: flex;
          align-items: flex-end;
          gap: 0.5mm;
          height: 4mm;
        }
        .grade-bar {
          width: 1.6mm;
          border: 0.25mm solid #000;
          background: #fff;
        }
        .grade-bar.is-on { background: #000; }
        .grade-bar:nth-child(1) { height: 40%; }
        .grade-bar:nth-child(2) { height: 60%; }
        .grade-bar:nth-child(3) { height: 80%; }
        .grade-bar:nth-child(4) { height: 100%; }
        .monitor-label {
          grid-template-rows: 8mm 6.7mm 6.7mm;
        }
        .monitor-label .row-1 { font-size: 11pt; font-weight: 800; }
        .monitor-label .row-2,
        .monitor-label .row-3 { font-size: 8.4pt; font-weight: 800; }
        .monitor-label.compact .row-1 { font-size: 9.5pt; }
        .monitor-label.compact .row-2,
        .monitor-label.compact .row-3 { font-size: 7.4pt; }
        .monitor-label.tight { grid-template-rows: repeat(3, 7.05mm); }
        .monitor-label.tight .row-1 { font-size: 8.8pt; }
        .monitor-label.tight .row-2,
        .monitor-label.tight .row-3 { font-size: 6.7pt; }
        .monitor-label.monitor-has-grade {
          display: grid;
          grid-template-rows: none;
          grid-template-columns: minmax(0, 1fr) 13mm;
          align-items: stretch;
          column-gap: 0;
        }
        .monitor-label.monitor-has-grade .monitor-label-text {
          min-width: 0;
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 0.7mm;
          padding-right: 1.4mm;
        }
        /* Long device names wrap to two lines and stay readable instead of shrinking. */
        .monitor-label.monitor-has-grade .row-1 {
          white-space: normal;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          line-height: 1.04;
          font-size: 10.5pt;
        }
        .monitor-label.monitor-has-grade .row-2,
        .monitor-label.monitor-has-grade .row-3 {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .monitor-grade-box {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 0.3mm;
          border-left: 0.4mm solid #000;
          padding-left: 0.6mm;
        }
        .monitor-grade-caption {
          font-size: 5.4pt;
          font-weight: 800;
          letter-spacing: 0.12em;
          line-height: 1;
        }
        .monitor-grade-value {
          font-weight: 900;
          font-size: 26pt;
          line-height: 0.85;
          letter-spacing: -0.02em;
        }
        .receipt-mode {
          width: ${receiptPrintableWidthMm}mm;
          height: auto;
          min-height: ${pageHeightMm}mm;
          margin: 0 0 0 ${receiptLeftOffsetMm}mm;
          padding: 3.2mm 0 3mm;
          display: block;
          background: #fff;
        }
        .receipt-brand {
          font-size: 12.8pt;
          font-weight: 900;
          letter-spacing: 0;
          color: #000;
          margin-bottom: 1mm;
        }
        .receipt-type {
          display: inline-block;
          border: 1px solid #000;
          border-radius: 1mm;
          padding: 0.7mm 1.2mm;
          font-size: 6.8pt;
          font-weight: 800;
          margin-bottom: 2.8mm;
        }
        .receipt-main {
          font-size: 9.5pt;
          line-height: 1.1;
          font-weight: 900;
          margin-bottom: 2mm;
          word-break: break-word;
        }
        .receipt-grade {
          font-size: 22pt;
          font-weight: 900;
          line-height: 1;
          text-align: center;
          border: 2px solid #000;
          border-radius: 2mm;
          padding: 1.6mm 0;
          margin: 0 0 2mm;
        }
        .receipt-row {
          border-top: 1px solid #000;
          padding: 1.8mm 0;
          font-size: 7.6pt;
          line-height: 1.22;
          font-weight: 800;
          word-break: break-word;
        }
        .receipt-footer {
          border-top: 1px dashed #000;
          margin-top: 3.2mm;
          padding-top: 1.8mm;
          font-size: 6.2pt;
          line-height: 1.25;
        }
        @media screen {
          body { display: grid; place-items: center; width: 100vw; height: 100vh; background: #f3f3f3; }
          .label, .receipt-mode { background: #fff; border: 1px solid #ddd; box-shadow: 0 8px 24px rgba(0,0,0,0.12); }
        }
      </style>
    </head>
    <body>
      <div class="label ${scaleClass}">${labelHtml}</div>
      <script>
        (() => {
          let printed = false;
          const printLabel = () => {
            if (printed) return;
            printed = true;
            window.focus();
            setTimeout(() => window.print(), 50);
          };
          window.addEventListener('load', () => setTimeout(printLabel, 120), { once: true });
          setTimeout(printLabel, 500);
        })();
      <\/script>
    </body>
    </html>
  `);
  printWindow.document.close();
  return true;
}

function openBrowserPrintJobs(jobs, preparedWindow = null) {
  const normalizedJobs = (jobs || []).filter(job => job && Array.isArray(job.rows) && job.rows.length);
  if (!normalizedJobs.length) return false;
  if (normalizedJobs.length === 1) {
    const job = normalizedJobs[0];
    return openBrowserPrintLabel(job.rows, job.type, preparedWindow, job.browserProfile, job.grade || '');
  }

  const profile = normalizedJobs[0].browserProfile || BROWSER_PRINT_PROFILES.dymoLabel;
  const entries = normalizedJobs.map(job => {
    const jobProfile = job.browserProfile || profile;
    return {
      ...getBrowserLabelMarkup(job.rows, job.type, jobProfile, job.grade || ''),
      rows: job.rows,
      type: job.type,
      profile: jobProfile,
    };
  });
  const pageHeightMm = Math.max(...entries.map(entry => (
    entry.profile.id === BROWSER_PRINT_PROFILES.hpEngageReceipt.id
      ? getHpEngagePageHeightMm(entry.rows, entry.type)
      : entry.profile.heightMm
  )));
  const receiptPrintableWidthMm = profile.printableWidthMm || profile.widthMm;
  const receiptLeftOffsetMm = profile.leftOffsetMm || 0;
  const printWindow = preparedWindow || (typeof window !== 'undefined' && typeof window.open === 'function'
    ? window.open('', 'remarktLabelPrint_batch', `width=${profile.windowWidth},height=${profile.windowHeight}`)
    : null);
  if (!printWindow) {
    setAppMessage('Pop-up blocked. Allow pop-ups for this page to print labels.');
    render();
    return false;
  }

  printWindow.document.write(`
    <!doctype html>
    <html lang="nl">
    <head>
      <meta charset="utf-8">
      <title>ReMarkt labels</title>
      <style>
        @page { size: ${profile.widthMm}mm ${pageHeightMm}mm; margin: 0; }
        * { box-sizing: border-box; }
        html, body {
          width: ${profile.widthMm}mm;
          margin: 0;
          padding: 0;
          background: #fff;
          color: #000;
          font-family: Arial, Helvetica, sans-serif;
          print-color-adjust: exact;
          -webkit-print-color-adjust: exact;
        }
        .label-sheet {
          width: ${profile.widthMm}mm;
          min-height: ${pageHeightMm}mm;
          margin: 0;
          padding: 0;
          break-after: page;
          page-break-after: always;
        }
        .label-sheet:last-child {
          break-after: auto;
          page-break-after: auto;
        }
        .label {
          width: ${DYMO_LABEL_CONFIG.widthMm}mm;
          height: ${DYMO_LABEL_CONFIG.heightMm}mm;
          padding: 1.1mm 1.4mm 1.1mm 3mm;
          display: grid;
          grid-template-rows: 6.4mm 5.4mm 5.4mm 5.5mm;
          align-content: center;
          overflow: hidden;
        }
        .label-row {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          line-height: 0.98;
          letter-spacing: 0;
        }
        .row-1 { font-size: 11pt; font-weight: 800; }
        .row-2 { font-size: 8.1pt; font-weight: 700; }
        .row-3 { font-size: 8.1pt; font-weight: 800; }
        .row-4 { font-size: 7pt; font-weight: 700; }
        .compact .row-1 { font-size: 9.5pt; }
        .compact .row-2, .compact .row-3 { font-size: 7.2pt; }
        .compact .row-4 { font-size: 6.4pt; }
        .tight { grid-template-rows: repeat(4, 5.55mm); }
        .tight .label-row { line-height: 1; }
        .tight .row-1 { font-size: 8.7pt; }
        .tight .row-2, .tight .row-3, .tight .row-4 { font-size: 6.3pt; }
        /* Laptoplabel met grade-badge: specs links, letter + kwaliteitsbalken
           rechts. Balken lopen op in hoogte; gevuld = beter (A=4 ... X=1). */
        .label.specs-has-grade {
          grid-template-rows: none;
          grid-template-columns: minmax(0, 1fr) 12.5mm;
          align-items: stretch;
          column-gap: 0;
          padding-right: 1mm;
        }
        .specs-label-text {
          min-width: 0;
          display: grid;
          grid-template-rows: 6.4mm 5.4mm 5.4mm 5.5mm;
          align-content: center;
        }
        .specs-grade-box {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 0.9mm;
          border-left: 0.3mm solid #000;
          padding-left: 1mm;
        }
        .specs-grade-value {
          font-size: 20pt;
          font-weight: 900;
          line-height: 0.85;
        }
        .grade-bars {
          display: flex;
          align-items: flex-end;
          gap: 0.5mm;
          height: 4mm;
        }
        .grade-bar {
          width: 1.6mm;
          border: 0.25mm solid #000;
          background: #fff;
        }
        .grade-bar.is-on { background: #000; }
        .grade-bar:nth-child(1) { height: 40%; }
        .grade-bar:nth-child(2) { height: 60%; }
        .grade-bar:nth-child(3) { height: 80%; }
        .grade-bar:nth-child(4) { height: 100%; }
        .monitor-label {
          grid-template-rows: 8mm 6.7mm 6.7mm;
        }
        .monitor-label .row-1 { font-size: 11pt; font-weight: 800; }
        .monitor-label .row-2,
        .monitor-label .row-3 { font-size: 8.4pt; font-weight: 800; }
        .monitor-label.compact .row-1 { font-size: 9.5pt; }
        .monitor-label.compact .row-2,
        .monitor-label.compact .row-3 { font-size: 7.4pt; }
        .monitor-label.tight { grid-template-rows: repeat(3, 7.05mm); }
        .monitor-label.tight .row-1 { font-size: 8.8pt; }
        .monitor-label.tight .row-2,
        .monitor-label.tight .row-3 { font-size: 6.7pt; }
        .monitor-label.monitor-has-grade {
          display: grid;
          grid-template-rows: none;
          grid-template-columns: minmax(0, 1fr) 13mm;
          align-items: stretch;
          column-gap: 0;
        }
        .monitor-label.monitor-has-grade .monitor-label-text {
          min-width: 0;
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 0.7mm;
          padding-right: 1.4mm;
        }
        .monitor-label.monitor-has-grade .row-1 {
          white-space: normal;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          line-height: 1.04;
          font-size: 10.5pt;
        }
        .monitor-label.monitor-has-grade .row-2,
        .monitor-label.monitor-has-grade .row-3 {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .monitor-grade-box {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 0.3mm;
          border-left: 0.4mm solid #000;
          padding-left: 0.6mm;
        }
        .monitor-grade-caption {
          font-size: 5.4pt;
          font-weight: 800;
          letter-spacing: 0.12em;
          line-height: 1;
        }
        .monitor-grade-value {
          font-weight: 900;
          font-size: 26pt;
          line-height: 0.85;
          letter-spacing: -0.02em;
        }
        .receipt-mode {
          width: ${receiptPrintableWidthMm}mm;
          height: auto;
          min-height: ${pageHeightMm}mm;
          margin: 0 0 0 ${receiptLeftOffsetMm}mm;
          padding: 3.2mm 0 3mm;
          display: block;
          background: #fff;
        }
        .receipt-brand {
          font-size: 12.8pt;
          font-weight: 900;
          letter-spacing: 0;
          color: #000;
          margin-bottom: 1mm;
        }
        .receipt-type {
          display: inline-block;
          border: 1px solid #000;
          border-radius: 1mm;
          padding: 0.7mm 1.2mm;
          font-size: 6.8pt;
          font-weight: 800;
          margin-bottom: 2.8mm;
        }
        .receipt-main {
          font-size: 9.5pt;
          line-height: 1.1;
          font-weight: 900;
          margin-bottom: 2mm;
          word-break: break-word;
        }
        .receipt-grade {
          font-size: 22pt;
          font-weight: 900;
          line-height: 1;
          text-align: center;
          border: 2px solid #000;
          border-radius: 2mm;
          padding: 1.6mm 0;
          margin: 0 0 2mm;
        }
        .receipt-row {
          border-top: 1px solid #000;
          padding: 1.8mm 0;
          font-size: 7.6pt;
          line-height: 1.22;
          font-weight: 800;
          word-break: break-word;
        }
        .receipt-footer {
          border-top: 1px dashed #000;
          margin-top: 3.2mm;
          padding-top: 1.8mm;
          font-size: 6.2pt;
          line-height: 1.25;
        }
        @media screen {
          body { width: 100vw; min-height: 100vh; background: #f3f3f3; }
          .label-sheet { display: grid; place-items: center; margin: 12px auto; }
          .label, .receipt-mode { background: #fff; border: 1px solid #ddd; box-shadow: 0 8px 24px rgba(0,0,0,0.12); }
        }
      </style>
    </head>
    <body>
      ${entries.map(entry => `<section class="label-sheet"><div class="label ${entry.scaleClass}">${entry.labelHtml}</div></section>`).join('')}
      <script>
        (() => {
          let printed = false;
          const printLabel = () => {
            if (printed) return;
            printed = true;
            window.focus();
            setTimeout(() => window.print(), 80);
          };
          window.addEventListener('load', () => setTimeout(printLabel, 180), { once: true });
          setTimeout(printLabel, 700);
        })();
      <\/script>
    </body>
    </html>
  `);
  printWindow.document.close();
  return true;
}

function createLaptopLabelPrintJob(laptop, result, type = 'specs', options = {}) {
  const browserProfile = getBrowserPrintProfile(options);
  // Dit is het pad dat bij het opslaan van een grading wordt gebruikt, dus hier
  // gelden dezelfde regels als in printLabelFor: alleen een echt gegradeerd
  // specs-label krijgt de badge met kwaliteitsbalken.
  const specsGrade = type === 'specs' && !options.hideGrade
    ? normalizeSpecsGradeBadge(result && result.eindgrade)
    : '';
  return {
    rows: getLabelRows(laptop, result, type, { ...options, gradeInBadge: Boolean(specsGrade) }),
    type,
    browserProfile,
    grade: specsGrade,
    audit: {
      action: 'print_label',
      entityType: 'laptop',
      entityId: laptop && laptop.sticker,
      details: { type, hideGrade: Boolean(options.hideGrade), browserProfile: browserProfile.id },
    },
  };
}

function describeDymoPrintError(error) {
  const message = String(error && error.message || error || '').trim();
  if (/web service|not running|not responding/i.test(message)) {
    return 'The DYMO Connect Web Service is not running or not responding on this PC.';
  }
  if (/no dymo|no .*labelwriter|printer found/i.test(message)) {
    return 'No connected DYMO LabelWriter found on this PC.';
  }
  if (/browser|supported/i.test(message)) {
    return 'This browser is not properly supported by DYMO Connect.';
  }
  return message || 'DYMO direct printing is not available on this PC.';
}

async function printLabelJobsWithDymoFallback(jobs, options = {}) {
  const printJobs = (jobs || []).filter(Boolean);
  if (!printJobs.length) return { ok: true, fallbackUsed: false };

  printJobs.forEach(job => {
    if (job.audit) {
      logAudit(job.audit.action, job.audit.entityType, job.audit.entityId, job.audit.details);
    }
  });

  const preparedWindow = options.preparedWindow || createPreparedPrintWindow(
    printJobs.length > 1 ? 'labels' : printJobs[0].type,
    printJobs[0].browserProfile || BROWSER_PRINT_PROFILES.dymoLabel
  );
  let fallbackIndex = -1;
  let fallbackReason = '';

  for (let index = 0; index < printJobs.length; index++) {
    const job = printJobs[index];
    try {
      await printRowsWithDymo(job.rows, job.type, job.grade || '');
    } catch (error) {
      fallbackIndex = index;
      fallbackReason = describeDymoPrintError(error);
      reportAppWarning('DYMO direct print unavailable, using browser fallback.', error);
      break;
    }
  }

  if (fallbackIndex === -1) {
    closePreparedPrintWindow(preparedWindow);
    return { ok: true, fallbackUsed: false };
  }

  const fallbackJobs = printJobs.slice(fallbackIndex);
  if (openBrowserPrintJobs(fallbackJobs, preparedWindow)) {
    return { ok: true, fallbackUsed: true, fallbackReason, fallbackCount: fallbackJobs.length };
  }

  return { ok: false, fallbackUsed: true, fallbackReason, fallbackCount: fallbackJobs.length };
}

async function printLabelFor(laptop, result, type = 'specs', options = {}) {
  // Blanco labels (hideGrade) houden de handgeschreven gradelijn; alleen echt
  // gegradeerde specs-labels krijgen de badge met kwaliteitsbalken.
  const specsGrade = type === 'specs' && !options.hideGrade
    ? normalizeSpecsGradeBadge(result && result.eindgrade)
    : '';
  const rows = getLabelRows(laptop, result, type, { ...options, gradeInBadge: Boolean(specsGrade) });
  const browserProfile = getBrowserPrintProfile(options);
  logAudit('print_label', 'laptop', laptop && laptop.sticker, { type, hideGrade: Boolean(options.hideGrade), browserProfile: browserProfile.id });
  const fallbackWindow = options.preparedWindow || createPreparedPrintWindow(type, browserProfile);

  try {
    const printResult = await withPrintTimeout(printRowsWithDymo(rows, type, specsGrade));
    closePreparedPrintWindow(fallbackWindow);
    if (!options.suppressMessage) {
      setAppMessage(`${type === 'problems' ? 'Repair label' : 'Specs label'} sent to ${printResult.printerName} (${DYMO_LABEL_CONFIG.labelSize} / ${DYMO_LABEL_CONFIG.productCode}).`, 'success');
      render();
    }
    return true;
  } catch (error) {
    reportAppWarning('DYMO direct print unavailable, using browser fallback.', error);
  }

  if (openBrowserPrintLabel(rows, type, fallbackWindow, browserProfile, specsGrade)) {
    if (!options.suppressMessage) {
      setAppMessage(browserProfile.id === BROWSER_PRINT_PROFILES.hpEngageReceipt.id
        ? 'DYMO direct print is unavailable. An HP Engage print window opened automatically with 80x297 mm paper size.'
        : 'DYMO direct print is unavailable on this device. An exact 54x25 mm fallback print window opened.');
      render();
    }
    return true;
  }

  return false;
}

async function printMonitorLabelFor(monitor, grade, options = {}) {
  const normalizedGrade = normalizeMonitorGrade(grade);
  const rows = getMonitorLabelRows(monitor, normalizedGrade);
  const browserProfile = getMonitorBrowserPrintProfile(options);
  logAudit('print_monitor_label', 'monitor', monitor && monitor.sticker, { grade: normalizedGrade, browserProfile: browserProfile.id });
  const fallbackWindow = options.preparedWindow || createPreparedPrintWindow('monitor', browserProfile);

  try {
    const printResult = await withPrintTimeout(printRowsWithDymo(rows, 'monitor', normalizedGrade));
    closePreparedPrintWindow(fallbackWindow);
    if (!options.suppressMessage) {
      setAppMessage(`Monitor label sent to ${printResult.printerName} (${DYMO_LABEL_CONFIG.labelSize} / ${DYMO_LABEL_CONFIG.productCode}).`, 'success');
      render();
    }
    return true;
  } catch (error) {
    reportAppWarning('DYMO direct print unavailable, using browser fallback.', error);
  }

  if (openBrowserPrintLabel(rows, 'monitor', fallbackWindow, browserProfile, normalizedGrade)) {
    if (!options.suppressMessage) {
      setAppMessage(browserProfile.id === BROWSER_PRINT_PROFILES.hpEngageReceipt.id
        ? 'DYMO direct print is unavailable. An HP Engage print window opened automatically with 80x297 mm paper size.'
        : 'DYMO direct print is unavailable on this device. An exact 54x25 mm fallback print window opened.');
      render();
    }
    return true;
  }

  return false;
}

async function printCurrentLabel(type = 'specs') {
  if (!STATE.currentLaptop || !STATE.currentGrading || !STATE.currentGrading.result) {
    setAppMessage('There is no result to print yet.');
    render();
    return;
  }
  await printLabelFor(STATE.currentLaptop, STATE.currentGrading.result, type);
}

async function printSupplierLabel(type = 'specs') {
  if (!STATE.currentLaptop) {
    setAppMessage('No device selected.');
    render();
    return;
  }
  const supplierResult = { eindgrade: '', problems: [] };
  await printLabelFor(STATE.currentLaptop, supplierResult, type, { hideGrade: type === 'specs' });
}

