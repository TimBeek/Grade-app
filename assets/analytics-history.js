// =============================================================================
// ANALYTICS & HISTORY
// Analyse-dashboard, historiezoekfunctie en historie-rendering.
// =============================================================================
function safePercent(part, total) {
  return total ? Math.round((part / total) * 100) : 0;
}

const SUPPLIER_COMPARISON_GRADE_VALUE = { A: 4, B: 3, C: 2, D: 1 };

function normalizeSupplierGrade(value) {
  const text = String(value || '').trim().toUpperCase();
  if (!text) return '';
  const match = text.match(/(?:CLASS|GRADE)?\s*([ABCX]|D)\b/);
  if (!match) return '';
  return match[1] === 'X' ? 'D' : match[1];
}

function displayGrade(grade) {
  return grade === 'D' ? 'X' : grade || '-';
}

function gradeValue(grade) {
  return SUPPLIER_COMPARISON_GRADE_VALUE[normalizeSupplierGrade(grade)] || 0;
}

function formatSignedNumber(value) {
  const number = Number(value || 0);
  return number > 0 ? `+${number}` : String(number);
}

function findSupplierClassForHistoryItem(item) {
  if (!item) return '';
  if (item.leverancier_class) return item.leverancier_class;
  if (item.supplierGradeRaw) return item.supplierGradeRaw;
  const laptop = getLaptopBySticker(item.sticker);
  return laptop && laptop.leverancier_class ? laptop.leverancier_class : '';
}

function getSupplierComparisonBatchMeta(item) {
  if (!item) return null;
  const batchId = sanitizeExternalText(item.batchId, 100);
  const batchNummer = sanitizeExternalText(item.batchNummer, 100);
  return BATCHES.find(batch => batch && batchId && batch.id === batchId)
    || BATCHES.find(batch => batch && batchNummer && batch.nummer === batchNummer)
    || null;
}

function getSupplierComparisonBatchKey(item) {
  if (!item) return '-';
  return sanitizeExternalText(item.batchId, 100)
    || sanitizeExternalText(item.batchNummer, 100)
    || '-';
}

function getComparisonStatus(delta) {
  if (delta > 0) return { key: 'improved', label: 'Improved' };
  if (delta < 0) return { key: 'downgraded', label: 'Lower' };
  return { key: 'same', label: 'Matched' };
}

function getSupplierComparisonRows(items) {
  return (items || []).map(item => {
    const supplierRaw = findSupplierClassForHistoryItem(item);
    const supplierGrade = normalizeSupplierGrade(supplierRaw);
    const remarktGrade = normalizeSupplierGrade(item.grade);
    if (!supplierGrade || !remarktGrade) return null;
    const delta = gradeValue(remarktGrade) - gradeValue(supplierGrade);
    const status = getComparisonStatus(delta);
    const batchMeta = getSupplierComparisonBatchMeta(item);
    const batchNummer = item.batchNummer || (batchMeta && batchMeta.nummer) || '-';
    return {
      item,
      sticker: item.sticker || '',
      batchId: item.batchId || (batchMeta && batchMeta.id) || '',
      batchKey: getSupplierComparisonBatchKey(item),
      batchNummer,
      batchSupplier: (batchMeta && batchMeta.leverancier) || item.leverancier || '',
      batchImportedAt: (batchMeta && batchMeta.geimporteerd) || item.geimporteerd || '',
      merk: item.merk || '',
      model: item.model || '',
      supplierRaw,
      supplierGrade,
      remarktGrade,
      delta,
      statusKey: status.key,
      statusLabel: status.label,
      score: Number(item.score || 0),
      user: item.user_naam || item.user_id || '',
      problems: item.result && item.result.problems ? item.result.problems.join(' / ') : '',
      supplierNotes: item.leverancier_meldingen || item.meldingen || '',
    };
  }).filter(Boolean);
}

function summarizeGradeTransitions(rows) {
  const transitions = new Map();
  rows.forEach(row => {
    const key = `${displayGrade(row.supplierGrade)} -> ${displayGrade(row.remarktGrade)}`;
    transitions.set(key, (transitions.get(key) || 0) + 1);
  });
  return Array.from(transitions.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 4)
    .map(([label, count]) => ({ label, count }));
}

function getSupplierComparisonStats(items) {
  const rows = getSupplierComparisonRows(items);
  const byBatch = new Map();
  rows.forEach(row => {
    const key = row.batchKey || row.batchNummer || '-';
    const batch = byBatch.get(key) || {
      batchKey: key,
      batchNummer: key,
      batchSupplier: '',
      batchImportedAt: '',
      total: 0,
      improved: 0,
      same: 0,
      downgraded: 0,
      netDelta: 0,
      supplierCounts: { A: 0, B: 0, C: 0, D: 0 },
      remarktCounts: { A: 0, B: 0, C: 0, D: 0 },
      rows: [],
    };
    batch.batchNummer = row.batchNummer || batch.batchNummer;
    batch.batchSupplier = batch.batchSupplier || row.batchSupplier || '';
    batch.batchImportedAt = batch.batchImportedAt || row.batchImportedAt || '';
    batch.total++;
    batch[row.statusKey]++;
    batch.netDelta += row.delta;
    batch.supplierCounts[row.supplierGrade]++;
    batch.remarktCounts[row.remarktGrade]++;
    batch.rows.push(row);
    byBatch.set(key, batch);
  });

  const batches = Array.from(byBatch.values()).map(batch => ({
    ...batch,
    improvedPercent: safePercent(batch.improved, batch.total),
    downgradedPercent: safePercent(batch.downgraded, batch.total),
    samePercent: safePercent(batch.same, batch.total),
    toAFromLower: batch.rows.filter(row => row.remarktGrade === 'A' && row.supplierGrade !== 'A').length,
    transitions: summarizeGradeTransitions(batch.rows),
  })).sort((a, b) => b.total - a.total || b.netDelta - a.netDelta);

  const summary = batches.reduce((acc, batch) => {
    acc.total += batch.total;
    acc.improved += batch.improved;
    acc.same += batch.same;
    acc.downgraded += batch.downgraded;
    acc.netDelta += batch.netDelta;
    acc.toAFromLower += batch.toAFromLower;
    return acc;
  }, { total: 0, improved: 0, same: 0, downgraded: 0, netDelta: 0, toAFromLower: 0 });
  summary.improvedPercent = safePercent(summary.improved, summary.total);
  summary.downgradedPercent = safePercent(summary.downgraded, summary.total);

  return { rows, batches, summary };
}

function renderTransitionChips(transitions) {
  if (!transitions.length) return '<span class="transition-chip muted">No comparison</span>';
  return transitions.map(transition => `
    <span class="transition-chip">${escapeHtml(transition.label)} <strong>${transition.count}x</strong></span>
  `).join('');
}

// Per-supplier roll-up of the grade comparison. The headline management view:
// which suppliers under-grade (we capture margin) vs over-grade (we overpay),
// and the average grade-uplift per device — the real "rendement" signal.
function getSupplierScorecardRows(items) {
  const rows = getSupplierComparisonRows(items);
  const map = new Map();
  rows.forEach(row => {
    const key = (row.batchSupplier || '').trim() || 'Onbekend';
    const supplier = map.get(key) || {
      supplier: key, total: 0, improved: 0, same: 0, downgraded: 0, netDelta: 0, toA: 0,
    };
    supplier.total += 1;
    if (supplier[row.statusKey] !== undefined) supplier[row.statusKey] += 1;
    supplier.netDelta += row.delta;
    if (row.remarktGrade === 'A' && row.supplierGrade !== 'A') supplier.toA += 1;
    map.set(key, supplier);
  });
  return Array.from(map.values())
    .map(supplier => ({
      ...supplier,
      improvedPercent: safePercent(supplier.improved, supplier.total),
      downgradedPercent: safePercent(supplier.downgraded, supplier.total),
      avgUplift: supplier.total ? Math.round((supplier.netDelta / supplier.total) * 100) / 100 : 0,
    }))
    .sort((a, b) => b.avgUplift - a.avgUplift || b.total - a.total);
}

function renderSupplierScorecard(rows) {
  if (!rows.length) return '<div class="empty-analytics">Nog geen leveranciersgrades beschikbaar voor vergelijking.</div>';
  return `
    <div class="analytics-table-wrap">
      <table class="analytics-table supplier-scorecard-table">
        <thead>
          <tr><th>Leverancier</th><th>Apparaten</th><th>% boven</th><th>% onder</th><th>⌀ uplift/apparaat</th><th>→ A</th></tr>
        </thead>
        <tbody>
          ${rows.map(row => {
            const tone = row.avgUplift > 0.05 ? 'positive' : row.avgUplift < -0.05 ? 'negative' : '';
            return `
            <tr>
              <td><strong>${escapeHtml(row.supplier)}</strong></td>
              <td>${formatNumber(row.total)}</td>
              <td class="scorecard-pos">${row.improvedPercent}%</td>
              <td class="scorecard-neg">${row.downgradedPercent}%</td>
              <td class="scorecard-uplift ${tone}">${formatSignedNumber(row.avgUplift)}</td>
              <td>${formatNumber(row.toA)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderSupplierComparisonPanel(items) {
  const comparison = getSupplierComparisonStats(items);
  const { summary, batches } = comparison;
  return `
    <div class="analytics-panel analytics-wide supplier-compare-panel">
      <div class="analytics-panel-title-row">
        <div>
          <h3>Supplier vs ReMarkt</h3>
          <p>Batch-level comparison between supplier grade and final ReMarkt grade.</p>
        </div>
        <button class="btn btn-secondary" data-action="export_supplier_comparison" data-export-batch="all">Export Report</button>
      </div>

      <div class="comparison-kpis">
        <div class="comparison-kpi positive"><strong>${summary.improvedPercent}%</strong><span>above supplier</span></div>
        <div class="comparison-kpi"><strong>${summary.same}</strong><span>matched</span></div>
        <div class="comparison-kpi negative"><strong>${summary.downgradedPercent}%</strong><span>below supplier</span></div>
        <div class="comparison-kpi"><strong>${formatSignedNumber(summary.netDelta)}</strong><span>net grade delta</span></div>
        <div class="comparison-kpi positive"><strong>${summary.toAFromLower}</strong><span>B/C/X to A</span></div>
      </div>

      ${batches.length ? `
        <div class="comparison-table-wrap">
          <table class="comparison-table">
            <thead>
              <tr>
                <th>Batch</th>
                <th>Compared</th>
                <th>Improved</th>
                <th>Matched</th>
                <th>Lower</th>
                <th>Net</th>
                <th>Movement</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${batches.map(batch => `
                <tr class="${batch.netDelta < 0 ? 'is-negative' : batch.netDelta > 0 ? 'is-positive' : ''}">
                  <td>
                    <strong>${escapeHtml(batch.batchNummer)}</strong>
                    ${batch.batchSupplier || batch.batchImportedAt ? `<span class="comparison-batch-meta">${escapeHtml([batch.batchSupplier, batch.batchImportedAt].filter(Boolean).join(' · '))}</span>` : ''}
                  </td>
                  <td>${batch.total}</td>
                  <td>${batch.improved} <span>${batch.improvedPercent}%</span></td>
                  <td>${batch.same} <span>${batch.samePercent}%</span></td>
                  <td>${batch.downgraded} <span>${batch.downgradedPercent}%</span></td>
                  <td><strong>${formatSignedNumber(batch.netDelta)}</strong></td>
                  <td><div class="transition-list">${renderTransitionChips(batch.transitions)}</div></td>
                  <td><button class="btn btn-secondary btn-small" data-action="export_supplier_comparison" data-export-batch="${escapeHtml(batch.batchKey)}">Export</button></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : `
        <div class="empty-analytics">No comparable supplier grades yet. Import a supplier batch and save gradings to populate this view.</div>
      `}
    </div>
  `;
}

function getSupplierComparisonExportRows(batchNummer = 'all') {
  const isAdmin = isAdminUser();
  const items = isAdmin ? STATE.history : STATE.history.filter(h => h.user_id === STATE.currentUser.id);
  const comparisonRows = getSupplierComparisonRows(items)
    .filter(row => batchNummer === 'all' || row.batchKey === batchNummer || row.batchNummer === batchNummer);
  const exportedStickers = new Set(comparisonRows.map(row => normalizeStickerCode(row.sticker || '')));
  const rows = comparisonRows
    .map(row => ({
      Batch: row.batchNummer,
      'Batch ID': row.batchKey,
      Supplier: row.batchSupplier,
      Barcode: row.sticker,
      Brand: row.merk,
      Model: row.model,
      'Supplier grade': displayGrade(row.supplierGrade),
      'ReMarkt grade': displayGrade(row.remarktGrade),
      Delta: formatSignedNumber(row.delta),
      Status: row.statusLabel,
      'ReMarkt score': row.score,
      'Graded by': row.user,
      'Supplier notes': row.supplierNotes,
      'ReMarkt findings': row.problems,
    }));

  BATCHES.forEach(batch => {
    if (!batch || (batchNummer !== 'all' && batch.id !== batchNummer && batch.nummer !== batchNummer)) return;
    (batch.laptops || []).forEach(laptop => {
      const stickerKey = normalizeStickerCode(laptop && laptop.sticker);
      if (!laptop || !stickerKey || exportedStickers.has(stickerKey)) return;
      if (getLatestHistoryForSticker(laptop.sticker)) return;
      const supplierGrade = normalizeSupplierGrade(laptop.leverancier_class);
      if (!supplierGrade) return;
      exportedStickers.add(stickerKey);
      const labelOnly = isLaptopLabelPrinted(laptop.sticker);
      rows.push({
        Batch: laptop.batchNummer || batch.nummer || '-',
        'Batch ID': laptop.batchId || batch.id || '',
        Supplier: batch.leverancier || '',
        Barcode: laptop.sticker || '',
        Brand: laptop.merk || '',
        Model: laptop.model || '',
        'Supplier grade': displayGrade(supplierGrade),
        'ReMarkt grade': '-',
        Delta: '',
        Status: labelOnly ? 'Label printed, not graded' : 'Not scanned',
        'ReMarkt score': '',
        'Graded by': '',
        'Supplier notes': laptop.meldingen || '',
        'ReMarkt findings': '',
      });
    });
  });

  return rows;
}

function downloadBlob(filename, mimeType, content) {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof Blob === 'undefined') return false;
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

function toCsvValue(value) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadComparisonCsv(rows, batchNummer) {
  if (!rows.length) return false;
  const headers = Object.keys(rows[0]);
  const csv = '\ufeff' + [
    headers.map(toCsvValue).join(';'),
    ...rows.map(row => headers.map(header => toCsvValue(row[header])).join(';')),
  ].join('\r\n');
  const suffix = batchNummer === 'all' ? 'all-batches' : String(batchNummer).replace(/[^\w.-]+/g, '-');
  return downloadBlob(`remarkt-supplier-comparison-${suffix}.csv`, 'text/csv;charset=utf-8', csv);
}

async function exportSupplierComparison(batchNummer = 'all') {
  const rows = getSupplierComparisonExportRows(batchNummer);
  if (!rows.length) {
    setAppMessage('No supplier comparison available to export.');
    render();
    return;
  }

  const suffix = batchNummer === 'all' ? 'all-batches' : String(batchNummer).replace(/[^\w.-]+/g, '-');
  try {
    await ensureXlsxLoaded();
    if (window.XLSX) {
      const workbook = XLSX.utils.book_new();
      const sheet = XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(workbook, sheet, 'Supplier comparison');
      const output = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
      downloadBlob(`remarkt-supplier-comparison-${suffix}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', output);
    } else {
      downloadComparisonCsv(rows, batchNummer);
    }
  } catch (error) {
    reportAppWarning('Excel export unavailable, using CSV.', error);
    downloadComparisonCsv(rows, batchNummer);
  }

  logAudit('export_supplier_comparison', 'batch', batchNummer, { rows: rows.length });
  setAppMessage(`${rows.length} comparison row${rows.length === 1 ? '' : 's'} exported for supplier feedback.`, 'success');
  render();
}

function renderAnalyticsRows(entries, emptyText) {
  if (!entries.length) return `<div class="empty-analytics">${emptyText}</div>`;
  return `<div class="analytics-list">${entries.map(entry => `
    <div class="analytics-row">
      <div>
        <strong>${escapeHtml(entry.title)}</strong>
        <span>${escapeHtml(entry.sub)}</span>
      </div>
      <div class="analytics-value">${escapeHtml(entry.value)}</div>
    </div>
  `).join('')}</div>`;
}

const ANALYTICS_FILTER_DEFAULTS = {
  employee: 'all',
  productType: 'all',
  brand: 'all',
  grade: 'all',
  dateRange: 'all',
  status: 'all',
  query: '',
};

const ANALYTICS_GRADE_COLORS = {
  A: '#F6C400',
  B: '#1473E6',
  C: '#EF3E86',
  D: '#E12B35',
};

const ANALYTICS_STATUS_LABELS = {
  all: 'Alle statussen',
  graded: 'Gegraded',
  repair: 'Reparatie / X',
  open: 'Wacht op grading',
  label: 'Alleen label geprint',
};

function getAnalyticsFilters() {
  if (!STATE.analyticsFilters || typeof STATE.analyticsFilters !== 'object') {
    STATE.analyticsFilters = { ...ANALYTICS_FILTER_DEFAULTS };
  }
  STATE.analyticsFilters = { ...ANALYTICS_FILTER_DEFAULTS, ...STATE.analyticsFilters };
  return STATE.analyticsFilters;
}

function setAnalyticsFilter(key, value) {
  if (!Object.prototype.hasOwnProperty.call(ANALYTICS_FILTER_DEFAULTS, key)) return;
  const filters = getAnalyticsFilters();
  filters[key] = sanitizeExternalText(value, key === 'query' ? 160 : 80) || ANALYTICS_FILTER_DEFAULTS[key];
}

function resetAnalyticsFilters() {
  STATE.analyticsFilters = { ...ANALYTICS_FILTER_DEFAULTS };
}

function analyticsText(value) {
  return sanitizeExternalText(value, 180);
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('nl-NL');
}

function formatSeconds(value) {
  const seconds = Math.round(Number(value || 0));
  if (!seconds) return '-';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${String(remainder).padStart(2, '0')}s`;
}

function getAnalyticsDate(value, fallbackTime) {
  const direct = Date.parse(value || '');
  if (Number.isFinite(direct)) return new Date(direct);
  const today = new Date();
  const time = String(fallbackTime || '').match(/^(\d{1,2}):(\d{2})/);
  if (time) {
    today.setHours(Number(time[1]), Number(time[2]), 0, 0);
    return today;
  }
  return today;
}

// Real timestamp for a grading history item. Newer items have savedAt; older
// items only carry a time string, but the millisecond timestamp is embedded in
// the id (grading_<ms>_<sticker>), so we recover the true date from there.
function getHistoryTimestampMs(item) {
  if (!item) return null;
  const direct = Date.parse(item.savedAt || item.createdAt || item.completedAt || item.printedAt || '');
  if (Number.isFinite(direct)) return direct;
  const match = String(item.id || '').match(/(\d{13})/);
  if (match) {
    const ms = Number(match[1]);
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

function getHistoryAnalyticsDate(item) {
  const ms = getHistoryTimestampMs(item);
  if (ms) return new Date(ms);
  return getAnalyticsDate(null, item && item.tijd);
}

function isSameLocalDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function isWithinAnalyticsRange(date, range) {
  if (range === 'all') return true;
  const now = new Date();
  if (range === 'today') return isSameLocalDay(date, now);
  const maxAgeDays = range === 'week' ? 7 : range === 'month' ? 30 : 0;
  if (!maxAgeDays) return true;
  const start = new Date(now);
  start.setDate(start.getDate() - (maxAgeDays - 1));
  start.setHours(0, 0, 0, 0);
  return date >= start && date <= now;
}

function getAnalyticsDateLabel(date) {
  return date.toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit' });
}

function parseBatteryPercent(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const match = raw.match(/(\d+(?:[.,]\d+)?)/);
  if (!match) return null;
  let number = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(number)) return null;
  if (number > 0 && number <= 1) number *= 100;
  if (number < 0 || number > 100) return null;
  return Math.round(number);
}

function getHistoryProblems(item) {
  const problems = item && item.result && Array.isArray(item.result.problems) ? item.result.problems : [];
  return problems.map(problem => analyticsText(problem)).filter(Boolean);
}

function getHistoryDetailRows(item) {
  return item && item.result && Array.isArray(item.result.detailRows) ? item.result.detailRows : [];
}

function getAnalyticsSearchText(item) {
  return [
    item.productType, item.status, item.sticker, item.brand, item.model, item.serial, item.batch,
    item.employeeName, item.grade, item.supplierGrade, item.supplierNotes, item.videoInputs,
    ...(item.problems || []),
  ].join(' ').toLowerCase();
}

function createAnalyticsItem(source, overrides) {
  const item = {
    source,
    productType: 'laptop',
    status: 'graded',
    statusLabel: 'Gegraded',
    sticker: '',
    brand: '',
    model: '',
    serial: '',
    batch: '',
    supplier: '',
    supplierGrade: '',
    supplierNotes: '',
    grade: '',
    employeeId: '',
    employeeName: '',
    durationSec: 0,
    score: 0,
    batteryPercent: null,
    videoInputs: '',
    problems: [],
    detailRows: [],
    rawItem: null,
    date: new Date(),
  };
  Object.assign(item, overrides);
  item.searchText = getAnalyticsSearchText(item);
  return item;
}

function buildAnalyticsItems(isAdmin) {
  const currentUserId = STATE.currentUser ? STATE.currentUser.id : '';
  const visibleToUser = item => isAdmin || !item.user_id || item.user_id === currentUserId;
  const historyStickerKeys = new Set();
  const items = [];

  (STATE.history || []).filter(visibleToUser).forEach(historyItem => {
    const stickerKey = normalizeStickerCode(historyItem.sticker || '');
    if (stickerKey) historyStickerKeys.add(stickerKey);
    const problems = getHistoryProblems(historyItem);
    const grade = normalizeSupplierGrade(historyItem.grade);
    items.push(createAnalyticsItem('history', {
      productType: 'laptop',
      status: grade === 'D' || problems.length ? 'repair' : 'graded',
      statusLabel: grade === 'D' || problems.length ? 'Reparatie / X' : 'Gegraded',
      sticker: analyticsText(historyItem.sticker),
      brand: analyticsText(historyItem.merk),
      model: analyticsText(historyItem.model),
      serial: analyticsText(historyItem.serial),
      batch: analyticsText(historyItem.batchNummer),
      supplierGrade: displayGrade(normalizeSupplierGrade(findSupplierClassForHistoryItem(historyItem))),
      supplierNotes: analyticsText(historyItem.leverancier_meldingen || historyItem.meldingen),
      grade,
      employeeId: analyticsText(historyItem.user_id),
      employeeName: analyticsText(historyItem.user_naam || historyItem.user_id || 'Onbekend'),
      durationSec: Number(historyItem.duurSec || 0),
      score: Number(historyItem.score || 0),
      batteryPercent: parseBatteryPercent(historyItem.battery),
      problems,
      detailRows: getHistoryDetailRows(historyItem),
      rawItem: historyItem,
      date: getHistoryAnalyticsDate(historyItem),
    }));
  });

  (STATE.labelPrints || []).filter(visibleToUser).forEach(print => {
    const stickerKey = normalizeStickerCode(print.sticker || '');
    if (stickerKey && historyStickerKeys.has(stickerKey)) return;
    items.push(createAnalyticsItem('label', {
      productType: 'laptop',
      status: 'label',
      statusLabel: 'Alleen label geprint',
      sticker: analyticsText(print.sticker),
      brand: analyticsText(print.merk),
      model: analyticsText(print.model),
      batch: analyticsText(print.batchNummer),
      employeeId: analyticsText(print.user_id),
      employeeName: analyticsText(print.user_naam || print.user_id || 'Onbekend'),
      date: getAnalyticsDate(print.printedAt),
    }));
  });

  (STATE.monitorLabelPrints || []).filter(visibleToUser).forEach(print => {
    const grade = normalizeMonitorGrade(print.grade);
    items.push(createAnalyticsItem('monitor-label', {
      productType: 'monitor',
      status: grade === 'D' ? 'repair' : 'graded',
      statusLabel: grade === 'D' ? 'Reparatie / X' : 'Gegraded',
      sticker: analyticsText(print.sticker),
      brand: analyticsText(print.merk),
      model: analyticsText(print.model || print.deviceName),
      serial: analyticsText(print.serial),
      batch: analyticsText(print.batchNummer),
      grade,
      videoInputs: analyticsText(print.videoInputs),
      employeeId: analyticsText(print.user_id),
      employeeName: analyticsText(print.user_naam || print.user_id || 'Onbekend'),
      date: getAnalyticsDate(print.printedAt),
    }));
  });

  BATCHES.forEach(batch => {
    (batch.laptops || []).forEach(laptop => {
      if (isLaptopGraded(laptop.sticker) || isLaptopLabelPrinted(laptop.sticker)) return;
      items.push(createAnalyticsItem('open-batch', {
        productType: 'laptop',
        status: 'open',
        statusLabel: 'Wacht op grading',
        sticker: analyticsText(laptop.sticker),
        brand: analyticsText(laptop.merk),
        model: analyticsText(laptop.model),
        serial: analyticsText(laptop.serial),
        batch: analyticsText(laptop.batchNummer || batch.nummer),
        supplier: analyticsText(batch.leverancier),
        supplierGrade: displayGrade(normalizeSupplierGrade(laptop.leverancier_class)),
        supplierNotes: analyticsText(laptop.meldingen),
        batteryPercent: parseBatteryPercent(laptop.battery),
        date: getAnalyticsDate(batch.createdAt || batch.geimporteerd),
      }));
    });
  });

  MONITOR_BATCHES.forEach(batch => {
    (batch.monitors || []).forEach(monitor => {
      if (isMonitorLabelPrinted(monitor.sticker)) return;
      items.push(createAnalyticsItem('open-monitor-batch', {
        productType: 'monitor',
        status: 'open',
        statusLabel: 'Wacht op grading',
        sticker: analyticsText(monitor.sticker),
        brand: analyticsText(monitor.merk),
        model: analyticsText(monitor.model || monitor.deviceName),
        serial: analyticsText(monitor.serial),
        batch: analyticsText(monitor.batchNummer || batch.nummer),
        supplier: analyticsText(batch.leverancier),
        supplierGrade: displayGrade(normalizeMonitorGrade(monitor.leverancier_class)),
        supplierNotes: analyticsText(monitor.deviceErrors || monitor.meldingen),
        videoInputs: analyticsText(monitor.videoInputs),
        date: getAnalyticsDate(batch.createdAt || batch.geimporteerd),
      }));
    });
  });

  return items;
}

function filterAnalyticsItems(items, filters) {
  const query = String(filters.query || '').trim().toLowerCase();
  return items.filter(item => {
    if (filters.productType !== 'all' && item.productType !== filters.productType) return false;
    if (filters.employee !== 'all' && item.employeeId !== filters.employee && item.employeeName !== filters.employee) return false;
    if (filters.brand !== 'all' && item.brand !== filters.brand) return false;
    if (filters.grade !== 'all' && displayGrade(item.grade) !== filters.grade) return false;
    if (filters.status !== 'all' && item.status !== filters.status) return false;
    if (!isWithinAnalyticsRange(item.date, filters.dateRange)) return false;
    if (query && !item.searchText.includes(query)) return false;
    return true;
  });
}

function getUniqueAnalyticsOptions(items, field) {
  return Array.from(new Set(items.map(item => item[field]).filter(Boolean)))
    .sort((a, b) => String(a).localeCompare(String(b), 'nl-NL', { sensitivity: 'base' }));
}

function renderAnalyticsSelect(name, label, selected, options) {
  return `
    <label class="analytics-filter">
      <span>${escapeHtml(label)}</span>
      <select data-analytics-filter="${escapeHtml(name)}">
        ${options.map(option => `
          <option value="${escapeHtml(option.value)}" ${String(selected) === String(option.value) ? 'selected' : ''}>${escapeHtml(option.label)}</option>
        `).join('')}
      </select>
    </label>
  `;
}

function renderAnalyticsFilters(filters, allItems) {
  const employeeOptions = [{ value: 'all', label: 'Alle medewerkers' }]
    .concat(getUniqueAnalyticsOptions(allItems, 'employeeName').map(name => ({ value: name, label: name })));
  const brandOptions = [{ value: 'all', label: 'Alle merken' }]
    .concat(getUniqueAnalyticsOptions(allItems, 'brand').map(brand => ({ value: brand, label: brand })));

  return `
    <div class="analytics-filter-bar">
      <div class="analytics-search-wrap">
        <span>Zoeken</span>
        <input id="analyticsSearch" type="search" placeholder="Barcode, batch, merk, model, melding..." value="${escapeHtml(filters.query || '')}">
      </div>
      ${renderAnalyticsSelect('dateRange', 'Periode', filters.dateRange, [
        { value: 'all', label: 'Alle data' },
        { value: 'today', label: 'Vandaag' },
        { value: 'week', label: 'Laatste 7 dagen' },
        { value: 'month', label: 'Laatste 30 dagen' },
      ])}
      ${renderAnalyticsSelect('productType', 'Product', filters.productType, [
        { value: 'all', label: 'Alles' },
        { value: 'laptop', label: 'Laptops' },
        { value: 'monitor', label: 'Monitoren' },
      ])}
      ${renderAnalyticsSelect('employee', 'Medewerker', filters.employee, employeeOptions)}
      ${renderAnalyticsSelect('brand', 'Merk', filters.brand, brandOptions)}
      ${renderAnalyticsSelect('grade', 'Grade', filters.grade, [
        { value: 'all', label: 'Alle grades' },
        { value: 'A', label: 'A' },
        { value: 'B', label: 'B' },
        { value: 'C', label: 'C' },
        { value: 'X', label: 'X' },
      ])}
      ${renderAnalyticsSelect('status', 'Status', filters.status, Object.keys(ANALYTICS_STATUS_LABELS).map(key => ({
        value: key,
        label: ANALYTICS_STATUS_LABELS[key],
      })))}
      <button class="btn btn-secondary analytics-reset" data-action="analytics_filters_reset" type="button">Reset</button>
    </div>
  `;
}

function getAnalyticsCounts(items) {
  const counts = { A: 0, B: 0, C: 0, D: 0 };
  items.forEach(item => {
    const grade = normalizeSupplierGrade(item.grade);
    if (counts[grade] !== undefined) counts[grade]++;
  });
  return counts;
}

function countAnalyticsStatus(items, status) {
  return items.filter(item => item.status === status).length;
}

function getAverageAnalyticsTime(items) {
  const timed = items.filter(item => item.durationSec > 0);
  if (!timed.length) return 0;
  return Math.round(timed.reduce((sum, item) => sum + item.durationSec, 0) / timed.length);
}

function getAverageBattery(items) {
  const values = items.map(item => item.batteryPercent).filter(value => Number.isFinite(value));
  if (!values.length) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function hasMissingAccessorySignal(item) {
  return /(missing|ontbreekt|geen|adapter|charger|lader|rubber|feet|voeding|accessor)/i.test(`${item.supplierNotes || ''} ${(item.problems || []).join(' ')}`);
}

function buildCountRows(items, keyFn, labelFn = value => value, limit = 8) {
  const rows = new Map();
  items.forEach(item => {
    const key = keyFn(item);
    if (!key) return;
    rows.set(key, (rows.get(key) || 0) + 1);
  });
  return Array.from(rows.entries())
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'nl-NL'))
    .slice(0, limit)
    .map(([key, count]) => ({ label: labelFn(key), value: count }));
}

function renderKpiCard(card) {
  return `
    <div class="analytics-kpi-card ${card.tone || ''}">
      <span class="analytics-kpi-label">${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.value)}</strong>
      <small>${escapeHtml(card.sub || '')}</small>
    </div>
  `;
}

function renderAnalyticsPanel(title, subtitle, body, extraClass = '') {
  return `
    <section class="analytics-panel ${extraClass}">
      <div class="analytics-panel-title-row">
        <div>
          <h3>${escapeHtml(title)}</h3>
          ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}
        </div>
      </div>
      ${body}
    </section>
  `;
}

function renderGradeDonut(counts) {
  const total = counts.A + counts.B + counts.C + counts.D;
  let start = 0;
  const segments = ['A', 'B', 'C', 'D'].map(grade => {
    const percent = total ? (counts[grade] / total) * 100 : 0;
    const segment = `${ANALYTICS_GRADE_COLORS[grade]} ${start}% ${start + percent}%`;
    start += percent;
    return segment;
  }).join(', ');
  const background = total ? `conic-gradient(${segments})` : '#E5E5E0';
  return `
    <div class="analytics-grade-summary">
      <div class="analytics-donut" style="background:${background};">
        <div><strong>${formatNumber(total)}</strong><span>graded</span></div>
      </div>
      <div class="analytics-grade-legend">
        ${['A','B','C','D'].map(grade => `
          <div class="analytics-grade-line">
            <span class="grade-dot ${grade}"></span>
            <strong>${displayGrade(grade)}</strong>
            <span>${formatNumber(counts[grade])}</span>
            <em>${safePercent(counts[grade], total)}%</em>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderBarList(rows, emptyText, valueSuffix = '') {
  if (!rows.length) return `<div class="empty-analytics">${escapeHtml(emptyText)}</div>`;
  const max = Math.max(...rows.map(row => row.value), 1);
  return `
    <div class="analytics-bar-list">
      ${rows.map(row => `
        <div class="analytics-bar-row">
          <div class="analytics-bar-label"><strong>${escapeHtml(row.label)}</strong>${row.meta ? `<span>${escapeHtml(row.meta)}</span>` : ''}</div>
          <div class="analytics-bar-track"><div style="width:${Math.max(3, (row.value / max) * 100)}%;"></div></div>
          <div class="analytics-bar-value">${escapeHtml(formatNumber(row.value))}${escapeHtml(valueSuffix)}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function buildTrendBuckets(items, days = 7) {
  const buckets = [];
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  for (let offset = days - 1; offset >= 0; offset--) {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);
    buckets.push({ date, label: getAnalyticsDateLabel(date), value: 0, repair: 0 });
  }
  items.filter(item => item.status === 'graded' || item.status === 'repair').forEach(item => {
    const bucket = buckets.find(entry => isSameLocalDay(entry.date, item.date));
    if (!bucket) return;
    bucket.value++;
    if (item.status === 'repair') bucket.repair++;
  });
  return buckets;
}

function renderTrendChart(buckets) {
  const max = Math.max(...buckets.map(bucket => bucket.value), 1);
  return `
    <div class="analytics-trend">
      ${buckets.map(bucket => `
        <div class="analytics-trend-day">
          <div class="analytics-trend-stack" title="${escapeHtml(bucket.label)}: ${bucket.value}">
            <span class="repair" style="height:${(bucket.repair / max) * 100}%;"></span>
            <strong style="height:${Math.max(4, ((bucket.value - bucket.repair) / max) * 100)}%;"></strong>
          </div>
          <small>${escapeHtml(bucket.label)}</small>
        </div>
      `).join('')}
    </div>
  `;
}

function buildEmployeeRows(items) {
  const users = new Map();
  items.filter(item => item.employeeName && (item.status === 'graded' || item.status === 'repair' || item.status === 'label')).forEach(item => {
    const row = users.get(item.employeeName) || { name: item.employeeName, count: 0, repair: 0, sec: 0, timed: 0, labels: 0 };
    row.count++;
    if (item.status === 'repair') row.repair++;
    if (item.status === 'label') row.labels++;
    if (item.durationSec > 0) {
      row.sec += item.durationSec;
      row.timed++;
    }
    users.set(item.employeeName, row);
  });
  return Array.from(users.values())
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'nl-NL'))
    .slice(0, 7);
}

function renderEmployeeTable(rows) {
  if (!rows.length) return '<div class="empty-analytics">Nog geen medewerkerdata beschikbaar.</div>';
  return `
    <div class="analytics-table-wrap">
      <table class="analytics-table">
        <thead>
          <tr><th>Medewerker</th><th>Output</th><th>Gem. tijd</th><th>X-rate</th></tr>
        </thead>
        <tbody>
          ${rows.map(row => `
            <tr>
              <td><strong>${escapeHtml(row.name)}</strong><span>${row.labels ? `${row.labels} labelprints` : 'grading'}</span></td>
              <td>${formatNumber(row.count)}</td>
              <td>${formatSeconds(row.timed ? row.sec / row.timed : 0)}</td>
              <td>${safePercent(row.repair, row.count)}%</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function buildBatchProgressRows(productFilter) {
  const rows = [];
  if (productFilter === 'all' || productFilter === 'laptop') {
    BATCHES.forEach(batch => {
      const total = (batch.laptops || []).length;
      const open = openLaptopCount(batch);
      const done = Math.max(total - open, 0);
      rows.push({
        label: `Laptop batch ${batch.nummer || '-'}`,
        meta: [batch.leverancier, batch.geimporteerd].filter(Boolean).join(' · '),
        value: safePercent(done, total),
        done,
        open,
        total,
      });
    });
  }
  if (productFilter === 'all' || productFilter === 'monitor') {
    MONITOR_BATCHES.forEach(batch => {
      const total = (batch.monitors || []).length;
      const open = (batch.monitors || []).filter(monitor => !isMonitorLabelPrinted(monitor.sticker)).length;
      const done = Math.max(total - open, 0);
      rows.push({
        label: `Monitor batch ${batch.nummer || '-'}`,
        meta: [batch.leverancier, batch.geimporteerd].filter(Boolean).join(' · '),
        value: safePercent(done, total),
        done,
        open,
        total,
      });
    });
  }
  return rows.sort((a, b) => b.total - a.total);
}

function renderBatchProgress(rows) {
  if (!rows.length) return '<div class="empty-analytics">Geen actieve batches gevonden.</div>';
  return `
    <div class="analytics-batch-list">
      ${rows.slice(0, 8).map(row => `
        <div class="analytics-batch-row">
          <div>
            <strong>${escapeHtml(row.label)}</strong>
            <span>${escapeHtml(row.meta || 'Actieve batch')}</span>
          </div>
          <div class="analytics-batch-progress">
            <div><span style="width:${row.value}%;"></span></div>
            <small>${row.done}/${row.total} klaar · ${row.open} open</small>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function buildAnalyticsProblemRows(items) {
  const rows = new Map();
  items.forEach(item => {
    (item.problems || []).forEach(problem => rows.set(problem, (rows.get(problem) || 0) + 1));
    if (!item.problems.length && item.status === 'repair') rows.set('X / reparatie', (rows.get('X / reparatie') || 0) + 1);
  });
  return Array.from(rows.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'nl-NL'))
    .slice(0, 8)
    .map(([label, value]) => ({ label, value }));
}

function buildComponentRows(items) {
  const components = new Map();
  items.forEach(item => {
    if (item.source !== 'history') return;
    (item.detailRows || []).forEach(row => {
      if (!row || row.keuze === '-' || Number(row.punten || 0) <= 0) return;
      const current = components.get(row.naam) || { count: 0, points: 0 };
      current.count++;
      current.points += Number(row.punten || 0);
      components.set(row.naam, current);
    });
  });
  return Array.from(components.entries())
    .sort((a, b) => b[1].points - a[1].points)
    .slice(0, 8)
    .map(([label, stats]) => ({ label, value: stats.points, meta: `${stats.count}x geraakt` }));
}

function buildHeatmapRows(items) {
  const days = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'];
  const periods = [
    { key: 'morning', label: '08-12', from: 8, to: 12 },
    { key: 'midday', label: '12-15', from: 12, to: 15 },
    { key: 'afternoon', label: '15-18', from: 15, to: 18 },
    { key: 'evening', label: '18+', from: 18, to: 24 },
  ];
  const matrix = days.map(day => ({ day, values: periods.map(period => ({ ...period, value: 0 })) }));
  items.filter(item => item.status === 'graded' || item.status === 'repair' || item.status === 'label').forEach(item => {
    const jsDay = item.date.getDay();
    const dayIndex = jsDay === 0 ? 6 : jsDay - 1;
    const hour = item.date.getHours();
    const periodIndex = periods.findIndex(period => hour >= period.from && hour < period.to);
    if (matrix[dayIndex] && periodIndex >= 0) matrix[dayIndex].values[periodIndex].value++;
  });
  return matrix;
}

function renderHeatmap(matrix) {
  const max = Math.max(...matrix.flatMap(row => row.values.map(cell => cell.value)), 1);
  return `
    <div class="analytics-heatmap">
      <div></div>
      ${matrix[0].values.map(cell => `<span>${escapeHtml(cell.label)}</span>`).join('')}
      ${matrix.map(row => `
        <strong>${escapeHtml(row.day)}</strong>
        ${row.values.map(cell => `
          <div class="analytics-heat-cell" style="--heat:${cell.value / max};" title="${escapeHtml(row.day)} ${escapeHtml(cell.label)}: ${cell.value}">
            ${cell.value ? formatNumber(cell.value) : ''}
          </div>
        `).join('')}
      `).join('')}
    </div>
  `;
}

function renderRecentActivity(items) {
  const recent = items.filter(item => item.status !== 'open')
    .sort((a, b) => b.date - a.date)
    .slice(0, 8);
  if (!recent.length) return '<div class="empty-analytics">Nog geen recente activiteit gevonden.</div>';
  return `
    <div class="analytics-activity-feed">
      ${recent.map(item => `
        <div class="analytics-activity-item">
          <span class="activity-dot ${item.grade || 'label'}"></span>
          <div>
            <strong>${escapeHtml([item.brand, item.model].filter(Boolean).join(' ') || item.sticker || 'Onbekend apparaat')}</strong>
            <small>${escapeHtml(item.employeeName || '-')} · ${escapeHtml(item.statusLabel)} · batch ${escapeHtml(item.batch || '-')}</small>
          </div>
          <em>${escapeHtml(displayGrade(item.grade) || (item.status === 'label' ? 'Label' : '-'))}</em>
        </div>
      `).join('')}
    </div>
  `;
}

// Fetches the authoritative, database-computed KPIs from /api/stats and fills
// the strip in the analytics hero. Falls back silently when offline or when
// running from file:// (no shared backend).
async function refreshAnalyticsServerStats() {
  const container = document.getElementById('analytics-server-stats');
  if (!container) return;
  if (typeof canUseSharedDemoState === 'function' && !canUseSharedDemoState()) {
    container.setAttribute('data-state', 'offline');
    container.innerHTML = '<span class="analytics-server-stats-label">Lokale modus · database-cijfers niet beschikbaar</span>';
    return;
  }
  try {
    const response = await fetch('/api/stats', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const stats = await response.json();
    const totals = (stats && stats.totals) || {};
    const updated = stats && stats.updatedAt ? new Date(stats.updatedAt) : null;
    const updatedLabel = updated && !Number.isNaN(updated.getTime())
      ? updated.toLocaleString('nl-NL', { dateStyle: 'short', timeStyle: 'short' })
      : '-';
    const cells = [
      { label: 'Vandaag gegraded', value: formatNumber(totals.gradedToday || 0) },
      { label: 'Laatste 7 dagen', value: formatNumber(totals.gradedLast7Days || 0) },
      { label: 'Gegraded totaal (DB)', value: formatNumber(totals.graded || 0) },
      { label: 'Laptops voorraad', value: formatNumber(totals.laptopsInVoorraad || 0) },
      { label: 'Monitoren voorraad', value: formatNumber(totals.monitorsInVoorraad || 0) },
      { label: 'Gebruikers', value: formatNumber(totals.users || 0) },
      { label: 'Laatste update', value: escapeHtml(updatedLabel) },
    ];
    container.setAttribute('data-state', 'ready');
    container.innerHTML = `
      <span class="analytics-server-stats-label">Live uit database</span>
      <div class="analytics-server-stats-cells">
        ${cells.map(cell => `
          <div class="analytics-server-stat">
            <span class="analytics-server-stat-value">${cell.value}</span>
            <span class="analytics-server-stat-label">${cell.label}</span>
          </div>
        `).join('')}
      </div>
    `;
  } catch (error) {
    container.setAttribute('data-state', 'error');
    container.innerHTML = '<span class="analytics-server-stats-label">Database-cijfers konden niet worden geladen</span>';
    if (typeof reportAppWarning === 'function') reportAppWarning('Dashboard-statistieken konden niet worden geladen', error);
  }
}

function renderAnalytics() {
  const isAdmin = isAdminUser();
  const filters = getAnalyticsFilters();
  const allItems = buildAnalyticsItems(isAdmin);
  const filteredItems = filterAnalyticsItems(allItems, filters);
  const completedItems = filteredItems.filter(item => item.status === 'graded' || item.status === 'repair');
  const activeWorkItems = filteredItems.filter(item => item.status !== 'label');
  const counts = getAnalyticsCounts(completedItems);
  const totalCompleted = completedItems.length;
  const openCount = countAnalyticsStatus(filteredItems, 'open');
  const repairCount = countAnalyticsStatus(filteredItems, 'repair');
  const labelOnlyCount = countAnalyticsStatus(filteredItems, 'label');
  const avgTime = getAverageAnalyticsTime(completedItems);
  const avgBattery = getAverageBattery(filteredItems);
  const todayCompleted = completedItems.filter(item => isWithinAnalyticsRange(item.date, 'today')).length;
  const weekCompleted = completedItems.filter(item => isWithinAnalyticsRange(item.date, 'week')).length;
  const missingAccessories = filteredItems.filter(hasMissingAccessorySignal).length;
  const completionRate = safePercent(activeWorkItems.filter(item => item.status !== 'open').length, activeWorkItems.length);
  const componentRows = buildComponentRows(completedItems);
  const employeeRows = buildEmployeeRows(filteredItems);
  const batchRows = buildBatchProgressRows(filters.productType);
  const trendBuckets = buildTrendBuckets(filteredItems, 7);
  const supplierComparisonItems = filteredItems
    .filter(item => item.rawItem)
    .map(item => item.rawItem);
  const supplierSummary = getSupplierComparisonStats(supplierComparisonItems).summary;
  const upliftAvg = supplierSummary.total
    ? Math.round((supplierSummary.netDelta / supplierSummary.total) * 100) / 100
    : 0;
  const supplierScorecardRows = getSupplierScorecardRows(supplierComparisonItems);
  const premiumYield = safePercent((counts.A || 0) + (counts.B || 0), totalCompleted);
  const rangeLabel = filters.dateRange === 'today' ? 'vandaag'
    : filters.dateRange === 'week' ? 'laatste 7 dagen'
      : filters.dateRange === 'month' ? 'laatste 30 dagen'
        : 'alle data';

  return `
    <div class="screen analytics-screen analytics-pro-screen">
      <div class="analytics-hero">
        <div>
          <div class="ops-kicker" style="color: var(--remarkt-red);">Insights Dashboard</div>
          <h1>Operations Analytics</h1>
          <p>Realtime sturing op leveranciersrendement, grading-output, batchvoortgang, kwaliteit en medewerkerprestaties.</p>
        </div>
        <div class="analytics-hero-actions">
          <button class="btn btn-secondary" data-action="history" type="button">Open Full History</button>
          <button class="btn btn-primary" data-action="export_supplier_comparison" data-export-batch="all" type="button">Export Report</button>
        </div>
      </div>
      ${renderDashboardTabs('analytics')}
      <div class="analytics-server-stats" id="analytics-server-stats" data-state="loading">
        <span class="analytics-server-stats-label">Live cijfers uit database laden…</span>
      </div>
      ${renderAnalyticsFilters(filters, allItems)}

      <div class="analytics-kpi-grid">
        ${renderKpiCard({ label: 'Gegraded totaal', value: formatNumber(totalCompleted), sub: `${todayCompleted} vandaag · ${weekCompleted} deze week`, tone: 'primary' })}
        ${renderKpiCard({ label: 'Wacht op grading', value: formatNumber(openCount), sub: `${completionRate}% batch completion`, tone: openCount ? 'warning' : '' })}
        ${renderKpiCard({ label: 'Reparatie / X-rate', value: `${safePercent(repairCount, totalCompleted)}%`, sub: `${formatNumber(repairCount)} apparaten naar repair`, tone: repairCount ? 'danger' : '' })}
        ${renderKpiCard({ label: 'Gemiddelde gradingtijd', value: formatSeconds(avgTime), sub: `op basis van ${formatNumber(totalCompleted)} gradings` })}
        ${renderKpiCard({ label: 'Premium yield (A/B)', value: `${premiumYield}%`, sub: `${formatNumber((counts.A || 0) + (counts.B || 0))} van ${formatNumber(totalCompleted)} verkoopbaar als A/B` })}
        ${renderKpiCard({ label: 'Gem. accu gezondheid', value: avgBattery === null ? '-' : `${avgBattery}%`, sub: `${rangeLabel}` })}
        ${renderKpiCard({ label: 'Accessoire signalen', value: formatNumber(missingAccessories), sub: 'missing adapter, rubber feet, lader' })}
        ${renderKpiCard({
          label: 'Rendement vs leverancier',
          value: supplierSummary.total ? `${supplierSummary.improvedPercent}% ↑` : '-',
          sub: supplierSummary.total
            ? `${formatSignedNumber(supplierSummary.netDelta)} netto delta · ${formatNumber(supplierSummary.toAFromLower)} naar A · ⌀ ${formatSignedNumber(upliftAvg)}/apparaat`
            : 'geen leveranciersgrades beschikbaar',
          tone: 'primary',
        })}
      </div>

      <div class="analytics-grid">
        ${renderSupplierComparisonPanel(supplierComparisonItems)}
        ${renderAnalyticsPanel('Leverancier scorecard', 'Rendement per leverancier: wie onder- of overschat en hoeveel grade-uplift je gemiddeld per apparaat haalt. Sorteer-indicatie voor inkoop.', renderSupplierScorecard(supplierScorecardRows), 'analytics-wide')}
        ${renderAnalyticsPanel('Grade distribution', 'Verdeling per ReMarkt grade binnen de actieve filters.', renderGradeDonut(counts))}
        ${renderAnalyticsPanel('Throughput trend', 'Output per dag binnen de actieve filters.', renderTrendChart(trendBuckets))}
        ${renderAnalyticsPanel('Employee performance', 'Output, snelheid en X-rate per medewerker.', renderEmployeeTable(employeeRows))}
        ${renderAnalyticsPanel('Batch completion', 'Welke batches afgerond zijn en waar nog voorraad openstaat.', renderBatchProgress(batchRows), 'analytics-wide')}
        ${renderAnalyticsPanel('Part impact', 'Onderdelen die het meeste score-impact veroorzaken — input voor leverancierskwaliteit.', renderBarList(componentRows, 'Nog geen onderdeelimpact beschikbaar.', 'p'))}
        ${renderAnalyticsPanel('Recent activity', 'Laatste gradings en labelprints binnen de filters.', renderRecentActivity(filteredItems), 'analytics-wide')}
      </div>
    </div>
  `;
}

function historyMatchesSearch(item, query) {
  if (!query) return true;
  return ensureHistorySearchIndex(item).includes(query.toLowerCase());
}

function ensureHistorySearchIndex(item) {
  if (!item) return '';
  if (!item._searchIndex) {
    item._searchIndex = [
      item.sticker, item.merk, item.model, item.serial, item.processor, item.ram, item.ssd,
      item.display, item.battery, item.gpu, item.grade, item.user_naam, item.modus,
      item.batchNummer, item.leverancier_class, item.leverancier_meldingen,
      item.result && item.result.problems ? item.result.problems.join(' ') : ''
    ].join(' ').toLowerCase();
  }
  return item._searchIndex;
}

function getHistoryItemId(item, index = 0) {
  if (item.id) return String(item.id);
  return [item.sticker, item.tijd, item.user_id, index].map(value => String(value || '')).join('|');
}

function getFilteredHistoryItems(allItems, query) {
  const normalizedQuery = (query || '').toLowerCase();
  const items = [];
  for (let i = allItems.length - 1; i >= 0; i--) {
    const item = allItems[i];
    if (!normalizedQuery || ensureHistorySearchIndex(item).includes(normalizedQuery)) {
      items.push({ item, originalIndex: i });
    }
  }
  return items;
}

function renderHistoryDetail(h) {
  const result = h.result || {};
  const reasons = result.redenen || [];
  const detailRows = result.detailRows || [];
  const supplierGrade = displayGrade(normalizeSupplierGrade(findSupplierClassForHistoryItem(h)));
  const remarktGrade = displayGrade(normalizeSupplierGrade(h.grade));
  const supplierNotes = h.leverancier_meldingen || h.meldingen || '';
  return `
    <div class="history-detail">
      <div class="history-detail-grid">
        <div><strong>Graded by:</strong> ${escapeHtml(h.user_naam)}</div>
        <div><strong>Mode:</strong> ${escapeHtml(displayUserPreference(h.modus))}</div>
        <div><strong>Batch:</strong> ${escapeHtml(h.batchNummer || '-')}</div>
        <div><strong>Serial Number:</strong> ${escapeHtml(h.serial || '-')}</div>
        <div><strong>Supplier vs ReMarkt:</strong> ${escapeHtml(supplierGrade)} -> ${escapeHtml(remarktGrade)}</div>
        <div><strong>Duration:</strong> ${h.duurSec}s</div>
        <div><strong>CPU/RAM/SSD:</strong> ${escapeHtml(h.processor || '-')} / ${escapeHtml(h.ram || '-')} / ${escapeHtml(h.ssd || '-')}</div>
        <div><strong>Touch/Battery:</strong> ${h.display && h.display.toLowerCase().includes('touch') ? 'Yes' : 'No'} / ${escapeHtml(h.battery || '-')}</div>
      </div>
      ${supplierNotes ? `<div class="history-note"><strong>Supplier notes:</strong> ${escapeHtml(supplierNotes)}</div>` : ''}
      ${reasons.length ? `
        <div class="reasons" style="margin-bottom: 10px;">
          ${reasons.map(reden => `
            <div class="reason">
              <div class="reason-dot ${reden.type}"></div>
              <div class="reason-text">${escapeHtml(reden.text)}</div>
            </div>
          `).join('')}
        </div>
      ` : ''}
      ${detailRows.length ? `
        <div class="history-mini-table">
          <div class="history-mini-row" style="font-weight: 700; color: #6B6B66;"><span>Part</span><span>Impact</span><span>Score</span></div>
          ${detailRows.map(row => `
            <div class="history-mini-row">
              <span>${escapeHtml(row.naam)}</span>
              <span>${escapeHtml(row.keuze === 'D' ? 'X' : row.keuze)}${row.impact && row.impact !== '-' ? ' / ' + escapeHtml(row.impact) : ''}</span>
              <span>${row.punten}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

function renderHistory() {
  const isAdmin = isAdminUser();
  const allItems = isAdmin ? STATE.history : STATE.history.filter(h => h.user_id === STATE.currentUser.id);
  const query = STATE.historySearch || '';
  const items = getFilteredHistoryItems(allItems, query);
  const pageSize = STATE.historyPageSize || 50;
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(Math.max(STATE.historyPage || 1, 1), totalPages);
  if (currentPage !== STATE.historyPage) STATE.historyPage = currentPage;
  const pageStart = (currentPage - 1) * pageSize;
  const pageItems = items.slice(pageStart, pageStart + pageSize);

  if (allItems.length === 0) {
    return `
      <div class="screen">
        ${renderDashboardTabs('analytics')}
        <div class="card">
          <h3>No gradings yet</h3>
          <p class="card-sub">Go to Workflow and grade the first device.</p>
        </div>
      </div>
    `;
  }

  const counts = { A: 0, B: 0, C: 0, D: 0 };
  let totalSec = 0;
  allItems.forEach(i => { counts[i.grade]++; totalSec += i.duurSec; });
  const gem = Math.round(totalSec / allItems.length);
  const maxCount = Math.max(counts.A, counts.B, counts.C, counts.D, 1);

  return `
    <div class="screen" style="max-width: 1100px;">
      ${renderDashboardTabs('analytics')}
      <div class="metrics">
        <div class="metric">
          <div class="metric-label">Total Graded</div>
          <div class="metric-value">${allItems.length}</div>
          <div class="metric-sub">${isAdmin ? 'all operators' : 'your session'}</div>
        </div>
        <div class="metric">
          <div class="metric-label">Grade Mix</div>
          <div class="metric-value" style="font-size: 14px; line-height: 1.6;">
            <span style="color: #854F0B;">${counts.A}A</span> · 
            <span style="color: #0C447C;">${counts.B}B</span> · 
            <span style="color: #72243E;">${counts.C}C</span> · 
            <span style="color: #791F1F;">${counts.D}X</span>
          </div>
        </div>
        <div class="metric">
          <div class="metric-label">Average Time</div>
          <div class="metric-value">${gem}s</div>
          <div class="metric-sub">per device</div>
        </div>
        <div class="metric">
          <div class="metric-label">Latest Result</div>
          <div class="metric-value">${allItems[allItems.length - 1].grade === 'D' ? 'Repair' : allItems[allItems.length - 1].grade}</div>
          <div class="metric-sub">${escapeHtml(allItems[allItems.length - 1].user_naam)}</div>
        </div>
      </div>

      <div class="grade-bars">
        <h3 style="margin-bottom: 10px; font-weight: 500;">Grade Mix</h3>
        ${['A','B','C','D'].map(g => `
          <div class="grade-bar">
            <strong>${g === 'D' ? 'X' : g}</strong>
            <div class="grade-track"><div class="grade-fill ${g}" style="width: ${(counts[g] / maxCount) * 100}%;"></div></div>
            <span>${counts[g]}</span>
          </div>
        `).join('')}
      </div>

      <h3 style="margin-bottom: 10px; font-weight: 500;">Search History</h3>
      <input class="history-search" id="historySearch" type="search" placeholder="Search barcode, serial number, supplier grade, ReMarkt grade, operator or batch..." value="${escapeHtml(query)}">
      <div class="history-pager">
        <span>${items.length} result${items.length === 1 ? '' : 's'} · page ${currentPage} of ${totalPages} · max ${pageSize}</span>
        <div class="history-pager-actions">
          <button class="btn btn-secondary" data-action="history_prev" ${currentPage <= 1 ? 'disabled' : ''}>← Previous</button>
          <button class="btn btn-secondary" data-action="history_next" ${currentPage >= totalPages ? 'disabled' : ''}>Next →</button>
        </div>
      </div>
      <div class="history-list">
        ${pageItems.length ? pageItems.map(({ item: h, originalIndex }) => {
          const itemId = getHistoryItemId(h, originalIndex);
          const isOpen = STATE.historyOpenId === itemId;
          const supplierGrade = displayGrade(normalizeSupplierGrade(findSupplierClassForHistoryItem(h)));
          const remarktGrade = displayGrade(normalizeSupplierGrade(h.grade));
          return `
          <div class="history-card">
            <div class="history-row" style="border: 0; box-shadow: none; padding: 0;">
              <div>
                <div style="font-weight: 700;">${escapeHtml(h.merk)} ${escapeHtml(h.model)}</div>
                <div style="font-size: 11px; color: #6B6B66;">Barcode ${escapeHtml(h.sticker)} · SN ${escapeHtml(h.serial || '-')} · Supplier ${escapeHtml(supplierGrade)} -> ReMarkt ${escapeHtml(remarktGrade)} · ${escapeHtml(h.user_naam)} · batch ${escapeHtml(h.batchNummer || '-')}</div>
              </div>
              <div class="history-grade ${h.grade}">${h.grade === 'D' ? 'X' : h.grade}</div>
              <div class="history-time">${h.tijd}</div>
            </div>
            <div class="history-card-actions">
              <button class="btn btn-secondary" data-history-toggle="${escapeHtml(itemId)}">${isOpen ? 'Close Details' : 'Details'}</button>
            </div>
            ${isOpen ? renderHistoryDetail(h) : ''}
          </div>
        `; }).join('') : `<div class="card"><p class="card-sub">No results for this search.</p></div>`}
      </div>
    </div>
  `;
}

