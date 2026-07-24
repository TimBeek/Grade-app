// =============================================================================
// ANALYTICS & HISTORY
// Analyse-dashboard, historiezoekfunctie en historie-rendering.
// =============================================================================
function safePercent(part, total) {
  return total ? Math.round((part / total) * 100) : 0;
}

// -----------------------------------------------------------------------------
// Reparatielabel-statistiek per batch (en reparatie-bakken).
// Een laptop kreeg een reparatielabel wanneer needsProblemLabel() waar was bij
// het graden. De labeltype ('production' vs 'reject'/'direct') deelt reparaties
// in bakken: productie-reparatie vs niet-verkoopbaar/afkeur.
// -----------------------------------------------------------------------------
function getHistoryRepairLabelType(item) {
  const result = item && item.result;
  const type = result ? (result.repairLabelType || (result.repairPolicy && result.repairPolicy.labelType) || '') : '';
  if (type === 'production') return 'production';
  if (type === 'reject' || type === 'direct') return 'reject';
  return '';
}

function historyItemHadRepairLabel(item) {
  if (!item) return false;
  if (item.result && typeof needsProblemLabel === 'function') {
    return needsProblemLabel({ meldingen: item.leverancier_meldingen || '' }, item.result);
  }
  // Terugval voor oudere records zonder opgeslagen result.
  const grade = normalizeSupplierGrade(item.grade);
  return grade === 'D';
}

// Reparatiestatistiek gegroepeerd per batch-id: { [batchId]: {graded, repair,
// production, reject, batchNummer, leverancier} }.
function getBatchRepairStats(historyItems = STATE.history) {
  const stats = {};
  (historyItems || []).forEach(item => {
    const key = item.batchId || item.batchNummer || '—';
    if (!stats[key]) stats[key] = { graded: 0, repair: 0, production: 0, reject: 0, batchNummer: item.batchNummer || '', leverancier: '' };
    stats[key].graded += 1;
    if (historyItemHadRepairLabel(item)) {
      stats[key].repair += 1;
      const type = getHistoryRepairLabelType(item);
      if (type === 'production') stats[key].production += 1;
      else stats[key].reject += 1;
    }
  });
  return stats;
}

function getBatchRepairStatsFor(batch, allStats) {
  const stats = allStats || getBatchRepairStats();
  return stats[batch && batch.id] || stats[batch && batch.nummer] || { graded: 0, repair: 0, production: 0, reject: 0 };
}

// Belangrijkste statistieken van één batch, voor het uitklap-paneel op de
// batch-rij (grade-mix, gem. tijd, rendement vs leverancier, reparatie).
function getBatchDashboardStats(batch) {
  const id = batch && batch.id;
  const nummer = batch && batch.nummer;
  const items = (STATE.history || []).filter(h => (id && h.batchId === id) || (!h.batchId && nummer && h.batchNummer === nummer));
  const counts = { A: 0, B: 0, C: 0, D: 0 };
  let timeSum = 0;
  let timed = 0;
  items.forEach(h => {
    const grade = normalizeSupplierGrade(h.grade);
    if (counts[grade] !== undefined) counts[grade] += 1;
    const sec = Number(h.duurSec || 0);
    if (sec > 0) { timeSum += sec; timed += 1; }
  });
  const supplierStats = getSupplierComparisonStats(items);
  const uplift = supplierStats.summary.total ? Math.round((supplierStats.summary.netDelta / supplierStats.summary.total) * 100) / 100 : null;
  return {
    graded: items.length,
    counts,
    avgSec: timed ? Math.round(timeSum / timed) : 0,
    uplift,
    improvedPercent: supplierStats.summary.improvedPercent,
    repair: getBatchRepairStatsFor(batch),
  };
}

function renderBatchStatsPanel(stats) {
  const total = stats.counts.A + stats.counts.B + stats.counts.C + stats.counts.D;
  return `
    <div class="batch-stats-panel">
      <div class="batch-stat"><span>Graded</span><strong>${formatNumber(stats.graded)}</strong></div>
      <div class="batch-stat"><span>Avg. time</span><strong>${formatSeconds(stats.avgSec)}</strong></div>
      <div class="batch-stat"><span>Uplift vs supplier</span><strong>${stats.uplift === null ? '—' : formatSignedNumber(stats.uplift)}</strong></div>
      <div class="batch-stat"><span>Above supplier</span><strong>${stats.uplift === null ? '—' : stats.improvedPercent + '%'}</strong></div>
      <div class="batch-stat batch-stat-wide">
        <span>Grade mix</span>
        ${total
          ? `<div class="batch-grade-mix">${['A', 'B', 'C', 'D'].map(g => stats.counts[g] ? `<span class="grade-seg" style="width:${(stats.counts[g] / total) * 100}%; background:${ANALYTICS_GRADE_COLORS[g]};" title="${displayGrade(g)}: ${stats.counts[g]}"></span>` : '').join('')}</div>
             <div class="batch-grade-legend">${['A', 'B', 'C', 'D'].map(g => `<span>${displayGrade(g)} ${stats.counts[g]}</span>`).join('')}</div>`
          : '<strong>—</strong>'}
      </div>
      <div class="batch-stat batch-stat-wide"><span>Repair labels</span><strong>${stats.repair.repair} · ${stats.repair.production} production · ${stats.repair.reject} not sellable</strong></div>
    </div>
  `;
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
  if (!rows.length) return '<div class="empty-analytics">No supplier grades available for comparison yet.</div>';
  return `
    <div class="analytics-table-wrap">
      <table class="analytics-table supplier-scorecard-table">
        <thead>
          <tr><th>Supplier</th><th>Devices</th><th>% above</th><th>% below</th><th>⌀ uplift/device</th><th>→ A</th></tr>
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
              ${batches.map((batch, index) => `
                <tr class="${batch.netDelta < 0 ? 'is-negative' : batch.netDelta > 0 ? 'is-positive' : ''}">
                  <td>
                    <strong><span class="repair-bin-cat" style="background: ${chartColor(index)};" aria-hidden="true"></span>${escapeHtml(batch.batchNummer)}</strong>
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
  batch: 'all',
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
  all: 'All statuses',
  graded: 'Graded',
  repair: 'Repair / X',
  open: 'Awaiting grading',
  label: 'Label only printed',
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
    statusLabel: 'Graded',
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
      statusLabel: grade === 'D' || problems.length ? 'Repair / X' : 'Graded',
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
      statusLabel: 'Label only printed',
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
      statusLabel: grade === 'D' ? 'Repair / X' : 'Graded',
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
        statusLabel: 'Awaiting grading',
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
        statusLabel: 'Awaiting grading',
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
    if (filters.batch !== 'all' && item.batch !== filters.batch) return false;
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
  const employeeOptions = [{ value: 'all', label: 'All employees' }]
    .concat(getUniqueAnalyticsOptions(allItems, 'employeeName').map(name => ({ value: name, label: name })));
  const brandOptions = [{ value: 'all', label: 'All brands' }]
    .concat(getUniqueAnalyticsOptions(allItems, 'brand').map(brand => ({ value: brand, label: brand })));
  const batchOptions = [{ value: 'all', label: 'All batches' }]
    .concat(getUniqueAnalyticsOptions(allItems, 'batch').map(batch => ({ value: batch, label: `Batch ${batch}` })));

  return `
    <div class="analytics-filter-bar">
      <div class="analytics-search-wrap">
        <span>Search</span>
        <input id="analyticsSearch" type="search" placeholder="Barcode, batch, brand, model, note..." value="${escapeHtml(filters.query || '')}">
      </div>
      ${renderAnalyticsSelect('dateRange', 'Period', filters.dateRange, [
        { value: 'all', label: 'All data' },
        { value: 'today', label: 'Today' },
        { value: 'week', label: 'Last 7 days' },
        { value: 'month', label: 'Last 30 days' },
      ])}
      ${renderAnalyticsSelect('productType', 'Product', filters.productType, [
        { value: 'all', label: 'All' },
        { value: 'laptop', label: 'Laptops' },
        { value: 'monitor', label: 'Monitors' },
      ])}
      ${renderAnalyticsSelect('employee', 'Employee', filters.employee, employeeOptions)}
      ${renderAnalyticsSelect('batch', 'Batch', filters.batch, batchOptions)}
      ${renderAnalyticsSelect('brand', 'Brand', filters.brand, brandOptions)}
      ${renderAnalyticsSelect('grade', 'Grade', filters.grade, [
        { value: 'all', label: 'All grades' },
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
  const hasSpark = Array.isArray(card.spark) && card.spark.length > 1 && card.spark.some(value => Number(value) > 0);
  const spark = hasSpark ? renderSparkline(card.spark, card.sparkColor || '#2563EB') : '';
  return `
    <div class="analytics-kpi-card ${card.tone || ''}${spark ? ' has-spark' : ''}">
      <span class="analytics-kpi-label">${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.value)}</strong>
      ${spark}
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

// =============================================================================
// GRAFIEK-PRIMITIEVEN
// Vloeiende lijnen met gradient-vlak, mini-sparklines in de KPI-tegels en
// legenda's als gekleurde pillen. Het categorische palet is gevalideerd op
// kleurenblindheid en contrast in zowel licht als donker.
// =============================================================================
const CHART_CATEGORICAL = ['#2563EB', '#EA580C', '#7C3AED', '#65A30D', '#DB2777', '#0891B2', '#B45309'];

function chartColor(index) {
  return CHART_CATEGORICAL[Math.abs(Number(index) || 0) % CHART_CATEGORICAL.length];
}

// Unieke id's binnen één render-pass (de DOM wordt elke render volledig vervangen).
let chartIdCounter = 0;
function nextChartId(prefix) {
  chartIdCounter += 1;
  return `${prefix}-${chartIdCounter}`;
}

// Catmull-Rom omgezet naar cubic bezier: vloeiende lijn zonder doorschieten.
function smoothPath(points) {
  if (!points.length) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

// Mini-trendlijntje in een KPI-tegel.
function renderSparkline(values, color = '#2563EB') {
  const vals = (values || []).map(value => Number(value) || 0);
  if (vals.length < 2) return '';
  const w = 120, h = 34, pad = 3;
  const max = Math.max(...vals), min = Math.min(...vals);
  const span = (max - min) || 1;
  const points = vals.map((value, index) => ({
    x: pad + (index / (vals.length - 1)) * (w - pad * 2),
    y: h - pad - ((value - min) / span) * (h - pad * 2),
  }));
  const id = nextChartId('spark');
  const line = smoothPath(points);
  const area = `${line} L ${points[points.length - 1].x.toFixed(2)} ${h} L ${points[0].x.toFixed(2)} ${h} Z`;
  return `
    <svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.42"></stop>
          <stop offset="100%" stop-color="${color}" stop-opacity="0"></stop>
        </linearGradient>
      </defs>
      <path d="${area}" fill="url(#${id})"></path>
      <path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>
  `;
}

function renderChartLegend(series) {
  if (!series || series.length < 2) return '';
  return `
    <div class="chart-legend">
      ${series.map(item => `
        <span class="chart-legend-item"><b style="background: ${item.color};"></b>${escapeHtml(item.label)}</span>
      `).join('')}
    </div>
  `;
}

// Vloeiende vlakgrafiek met meerdere reeksen, rustig raster en eindpunt-stippen.
function renderAreaChart(series, labels, opts = {}) {
  const list = (series || []).filter(item => item && item.values && item.values.length);
  if (!list.length) return `<div class="empty-analytics">${escapeHtml(opts.empty || 'No data yet.')}</div>`;
  const count = Math.max(...list.map(item => item.values.length));
  if (count < 2) return `<div class="empty-analytics">${escapeHtml(opts.empty || 'Not enough data yet.')}</div>`;

  const w = 640, h = 230;
  const padL = 34, padR = 12, padT = 12, padB = 26;
  const innerW = w - padL - padR, innerH = h - padT - padB;
  const rawMax = Math.max(1, ...list.map(item => Math.max(...item.values.map(v => Number(v) || 0))));
  // Rond het maximum af naar een leesbare stap.
  const step = Math.max(1, Math.ceil(rawMax / 4));
  const max = step * 4;
  const xAt = index => padL + (index / (count - 1)) * innerW;
  const yAt = value => padT + innerH - (Math.min(Number(value) || 0, max) / max) * innerH;

  const gridLines = Array.from({ length: 5 }, (_, i) => {
    const value = step * i;
    const y = yAt(value);
    return `
      <line class="chart-grid" x1="${padL}" y1="${y.toFixed(1)}" x2="${w - padR}" y2="${y.toFixed(1)}"></line>
      <text class="chart-axis" x="${padL - 8}" y="${(y + 3.5).toFixed(1)}" text-anchor="end">${formatNumber(value)}</text>
    `;
  }).join('');

  const xLabels = (labels || []).map((label, index) => {
    // Bij veel punten niet elk label tonen, anders loopt de as vol.
    const skip = count > 8 ? Math.ceil(count / 7) : 1;
    if (index % skip !== 0 && index !== count - 1) return '';
    return `<text class="chart-axis" x="${xAt(index).toFixed(1)}" y="${h - 8}" text-anchor="middle">${escapeHtml(label)}</text>`;
  }).join('');

  const bodies = list.map(item => {
    const points = item.values.map((value, index) => ({ x: xAt(index), y: yAt(value) }));
    const id = nextChartId('area');
    const line = smoothPath(points);
    const area = `${line} L ${points[points.length - 1].x.toFixed(2)} ${(padT + innerH).toFixed(2)} L ${points[0].x.toFixed(2)} ${(padT + innerH).toFixed(2)} Z`;
    const dots = points.map((point, index) => `<circle class="chart-dot" cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="${index === points.length - 1 ? 4 : 2.6}" fill="${item.color}"><title>${escapeHtml(item.label)} ${escapeHtml(String((labels || [])[index] || ''))}: ${formatNumber(item.values[index])}</title></circle>`).join('');
    return `
      <defs>
        <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${item.color}" stop-opacity="0.34"></stop>
          <stop offset="100%" stop-color="${item.color}" stop-opacity="0"></stop>
        </linearGradient>
      </defs>
      <path d="${area}" fill="url(#${id})"></path>
      <path d="${line}" fill="none" stroke="${item.color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></path>
      ${dots}
    `;
  }).join('');

  return `
    ${renderChartLegend(list)}
    <div class="area-chart-wrap">
      <svg class="area-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapeHtml(opts.ariaLabel || 'Trend chart')}">
        ${gridLines}
        ${bodies}
        ${xLabels}
      </svg>
    </div>
  `;
}

function renderTrendChart(buckets) {
  const okValues = buckets.map(bucket => Math.max(bucket.value - bucket.repair, 0));
  const repairValues = buckets.map(bucket => Number(bucket.repair) || 0);
  const totalOk = okValues.reduce((sum, value) => sum + value, 0);
  const totalRepair = repairValues.reduce((sum, value) => sum + value, 0);
  return renderAreaChart(
    [
      { key: 'ok', label: `Graded OK · ${formatNumber(totalOk)}`, color: '#2563EB', values: okValues },
      { key: 'repair', label: `Repair / X · ${formatNumber(totalRepair)}`, color: '#E12B35', values: repairValues },
    ],
    buckets.map(bucket => bucket.label),
    { ariaLabel: 'Graded per day, split into OK and repair/X', empty: 'No gradings in this period yet.' }
  );
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

// Vaste kleur per medewerker, afgeleid van de naam. Bewust op naam en niet op
// positie in de lijst, zodat iemands kleur niet verspringt als de ranglijst wijzigt.
const EMPLOYEE_COLORS = ['#2F6FB2', '#0F766E', '#7C3AED', '#B45309', '#0891B2', '#9D174D', '#4D7C0F', '#5E6368'];

function getEmployeeColor(name) {
  const key = String(name || '');
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return EMPLOYEE_COLORS[hash % EMPLOYEE_COLORS.length];
}

function renderEmployeeTable(rows) {
  if (!rows.length) return '<div class="empty-analytics">No employee data available yet.</div>';
  return `
    <div class="analytics-table-wrap">
      <table class="analytics-table">
        <thead>
          <tr><th>Employee</th><th>Output</th><th>Avg. time</th><th>X-rate</th></tr>
        </thead>
        <tbody>
          ${rows.map(row => `
            <tr>
              <td>
                <span class="employee-cell">
                  <b class="employee-dot" style="background: ${getEmployeeColor(row.name)};" aria-hidden="true"></b>
                  <span class="employee-meta"><strong>${escapeHtml(row.name)}</strong><span>${row.labels ? `${row.labels} label prints` : 'grading'}</span></span>
                </span>
              </td>
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
        meta: [batch.leverancier, batch.geimporteerd ? `added ${batch.geimporteerd}` : ''].filter(Boolean).join(' · '),
        value: safePercent(done, total),
        done,
        open,
        total,
        complete: total > 0 && open === 0,
        isNew: typeof isBatchNew === 'function' && isBatchNew(batch),
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
        meta: [batch.leverancier, batch.geimporteerd ? `added ${batch.geimporteerd}` : ''].filter(Boolean).join(' · '),
        value: safePercent(done, total),
        done,
        open,
        total,
        complete: total > 0 && open === 0,
        isNew: typeof isBatchNew === 'function' && isBatchNew(batch),
      });
    });
  }
  return rows.sort((a, b) => b.total - a.total);
}

function renderBatchProgress(rows) {
  if (!rows.length) return '<div class="empty-analytics">No active batches found.</div>';
  return `
    <div class="analytics-batch-list">
      ${rows.slice(0, 8).map(row => `
        <div class="analytics-batch-row">
          <div>
            <strong>${escapeHtml(row.label)}${row.complete ? '<span class="batch-badge done">Completed</span>' : ''}${row.isNew ? '<span class="batch-badge new">New</span>' : ''}</strong>
            <span>${escapeHtml(row.meta || 'Active batch')}</span>
          </div>
          <div class="analytics-batch-progress">
            <div><span style="width:${row.value}%;"></span></div>
            <small>${row.done}/${row.total} done · ${row.open} open</small>
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
    .map(([label, stats]) => ({ label, value: stats.points, meta: `${stats.count}x hit` }));
}

function buildHeatmapRows(items) {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
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
  if (!recent.length) return '<div class="empty-analytics">No recent activity found yet.</div>';
  return `
    <div class="analytics-activity-feed">
      ${recent.map(item => `
        <div class="analytics-activity-item">
          <span class="activity-dot ${item.grade || 'label'}"></span>
          <div>
            <strong>${escapeHtml([item.brand, item.model].filter(Boolean).join(' ') || item.sticker || 'Unknown device')}</strong>
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
    container.innerHTML = '<span class="analytics-server-stats-label">Local mode · database figures unavailable</span>';
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
      { label: 'Graded today', value: formatNumber(totals.gradedToday || 0) },
      { label: 'Last 7 days', value: formatNumber(totals.gradedLast7Days || 0) },
      { label: 'Graded total (DB)', value: formatNumber(totals.graded || 0) },
      { label: 'Laptops in stock', value: formatNumber(totals.laptopsInVoorraad || 0) },
      { label: 'Monitors in stock', value: formatNumber(totals.monitorsInVoorraad || 0) },
      { label: 'Users', value: formatNumber(totals.users || 0) },
      { label: 'Last update', value: escapeHtml(updatedLabel) },
    ];
    container.setAttribute('data-state', 'ready');
    container.innerHTML = `
      <span class="analytics-server-stats-label">Live from database</span>
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
    container.innerHTML = '<span class="analytics-server-stats-label">Database figures could not be loaded</span>';
    if (typeof reportAppWarning === 'function') reportAppWarning('Dashboard statistics could not be loaded', error);
  }
}

// =============================================================================
// REDESIGN: tabbed insights (sub-tabs) + new chart forms
// (diverging bar, favourability score, repair bins, route split, Pareto, stacked)
// =============================================================================
const ANALYTICS_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'batch', label: 'Batch quality' },
  { key: 'throughput', label: 'Throughput & staff' },
  { key: 'repair', label: 'Repair bins' },
];

function getAnalyticsTab() {
  return ANALYTICS_TABS.some(tab => tab.key === STATE.analyticsTab) ? STATE.analyticsTab : 'overview';
}

function setAnalyticsTab(tab) {
  STATE.analyticsTab = ANALYTICS_TABS.some(entry => entry.key === tab) ? tab : 'overview';
}

function renderAnalyticsSubTabs(activeTab) {
  return `
    <div class="analytics-subtabs" role="tablist" aria-label="Insights sections">
      ${ANALYTICS_TABS.map(tab => `
        <button class="analytics-subtab ${tab.key === activeTab ? 'active' : ''}" data-action="analytics_tab" data-analytics-tab="${tab.key}" type="button" role="tab" aria-selected="${tab.key === activeTab ? 'true' : 'false'}">${escapeHtml(tab.label)}</button>
      `).join('')}
    </div>
  `;
}

function analyticsClamp01(value) {
  return Math.max(0, Math.min(1, value));
}

// Signed 0-centred horizontal bar. Green to the right = better than supplier,
// red to the left = worse. Reserved for signed deltas (favourability).
function renderDivergingBar(rows, opts = {}) {
  const clean = (rows || []).filter(row => row && Number.isFinite(Number(row.value)));
  if (!clean.length) return `<div class="empty-analytics">${escapeHtml(opts.empty || 'No data yet.')}</div>`;
  const maxAbs = Math.max(...clean.map(row => Math.abs(Number(row.value))), Number(opts.minScale) || 0.5);
  const format = opts.format || formatSignedNumber;
  return `
    <div class="analytics-diverging">
      ${clean.map(row => {
        const value = Number(row.value);
        const pct = Math.min(100, (Math.abs(value) / maxAbs) * 100);
        const positive = value >= 0;
        return `
          <div class="diverging-row">
            <div class="diverging-label"><strong>${escapeHtml(row.label)}</strong>${row.meta ? `<span>${escapeHtml(row.meta)}</span>` : ''}</div>
            <div class="diverging-track">
              <div class="diverging-half neg">${!positive ? `<span class="diverging-fill neg" style="width:${pct}%;"></span>` : ''}</div>
              <div class="diverging-half pos">${positive ? `<span class="diverging-fill pos" style="width:${pct}%;"></span>` : ''}</div>
            </div>
            <div class="diverging-value ${positive ? 'pos' : 'neg'}">${escapeHtml(format(value))}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

// Per-batch grade uplift (net grade delta / device) as a diverging bar.
function buildBatchYieldRows(supplierItems) {
  return getSupplierComparisonStats(supplierItems).batches
    .filter(batch => batch.total > 0)
    .slice(0, 12)
    .map(batch => ({
      label: `Batch ${batch.batchNummer || '-'}`,
      value: Math.round((batch.netDelta / batch.total) * 100) / 100,
      meta: `${batch.batchSupplier || 'supplier ?'} · ${batch.total} devices`,
    }));
}

// 0-100 favourability index per supplier: weighted uplift + %above - %below.
function getSupplierFavorabilityRows(scorecardRows) {
  return (scorecardRows || []).map(row => {
    const score = Math.round(100 * analyticsClamp01(
      0.5 * ((row.avgUplift + 3) / 6) +
      0.3 * (row.improvedPercent / 100) +
      0.2 * (1 - row.downgradedPercent / 100)
    ));
    return { label: row.supplier, value: score, meta: `${row.total} devices · ⌀ ${formatSignedNumber(row.avgUplift)}/device` };
  }).sort((a, b) => b.value - a.value);
}

// 0-100 score leaderboard (green=buy, red=avoid).
function renderScoreBars(rows, opts = {}) {
  if (!rows.length) return `<div class="empty-analytics">${escapeHtml(opts.empty || 'No data yet.')}</div>`;
  return `
    <div class="analytics-score-bars">
      ${rows.map(row => {
        const value = Math.max(0, Math.min(100, Number(row.value) || 0));
        const tone = value >= 66 ? 'good' : value >= 45 ? 'mid' : 'bad';
        return `
          <div class="score-bar-row">
            <div class="score-bar-label"><strong>${escapeHtml(row.label)}</strong>${row.meta ? `<span>${escapeHtml(row.meta)}</span>` : ''}</div>
            <div class="score-bar-track"><span class="score-bar-fill ${tone}" style="width:${value}%;"></span></div>
            <div class="score-bar-value ${tone}">${value}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

// 100% stacked grade mix bar (fixed grade colours).
function render100StackedGradeBar(counts) {
  const total = counts.A + counts.B + counts.C + counts.D;
  if (!total) return '<div class="empty-analytics">No graded devices yet.</div>';
  return `
    <div class="grade-stacked">
      <div class="grade-stacked-bar">
        ${['A', 'B', 'C', 'D'].map(grade => counts[grade]
          ? `<span class="grade-seg" style="width:${(counts[grade] / total) * 100}%; background:${ANALYTICS_GRADE_COLORS[grade]};" title="${displayGrade(grade)}: ${counts[grade]}"></span>`
          : '').join('')}
      </div>
      <div class="grade-stacked-legend">
        ${['A', 'B', 'C', 'D'].map(grade => `<span><b class="grade-dot ${grade}"></b> ${displayGrade(grade)} · ${formatNumber(counts[grade])} (${safePercent(counts[grade], total)}%)</span>`).join('')}
      </div>
    </div>
  `;
}

// ---- Repair bins (physical sort board) ----
const REPAIR_BIN_LABELS = {
  lcd: 'Display / screen',
  scharnieren: 'Hinges',
  scharnier: 'Hinges',
  keyboard: 'Keyboard',
  toetsenbord: 'Keyboard',
  touchpad: 'Touchpad',
  bovenkap: 'Housing / cosmetic',
  zijkant: 'Housing / cosmetic',
  onderkant: 'Housing / cosmetic',
  palmrest: 'Housing / cosmetic',
};

function getRepairBin(action) {
  const id = String((action && action.componentId) || '').toLowerCase();
  if (REPAIR_BIN_LABELS[id]) return REPAIR_BIN_LABELS[id];
  const text = `${(action && action.issue) || ''} ${(action && action.triggerId) || ''}`.toLowerCase();
  if (/batter|accu|power|voeding/.test(text)) return 'Battery / power';
  if (/usb|poort|port|hdmi/.test(text)) return 'Ports';
  if (/key|toets/.test(text)) return 'Keyboard';
  if (/lcd|scherm|pixel|display|screen/.test(text)) return 'Display / screen';
  if (/touch/.test(text)) return 'Touchpad';
  if (/scharnier|hinge/.test(text)) return 'Hinges';
  return 'Other';
}

function getRepairItems(filteredItems) {
  return (filteredItems || []).filter(item =>
    item.source === 'history' && item.rawItem && typeof needsProblemLabel === 'function'
    && needsProblemLabel(item.rawItem, item.rawItem.result));
}

function buildRepairBinRows(repairItems) {
  const bins = new Map();
  const bump = (key, severity) => {
    const bin = bins.get(key) || { bin: key, total: 0, light: 0, heavy: 0, reject: 0 };
    bin.total += 1;
    if (severity === 'heavy') bin.heavy += 1;
    else if (severity === 'reject') bin.reject += 1;
    else bin.light += 1;
    bins.set(key, bin);
  };
  (repairItems || []).forEach(item => {
    const actions = (item.rawItem.result && item.rawItem.result.repairActions) || [];
    if (!actions.length) { bump('Other', 'reject'); return; }
    actions.forEach(action => bump(getRepairBin(action), action.repairSeverity));
  });
  return Array.from(bins.values()).sort((a, b) => b.total - a.total);
}

function getRepairRouteSplit(repairItems) {
  const split = { production: 0, direct: 0, reject: 0 };
  (repairItems || []).forEach(item => {
    const result = item.rawItem.result || {};
    const type = result.repairLabelType || (result.repairPolicy && result.repairPolicy.labelType) || 'reject';
    if (type === 'production') split.production += 1;
    else if (type === 'direct') split.direct += 1;
    else split.reject += 1;
  });
  return split;
}

function renderRepairRouteSplit(split) {
  const total = split.production + split.direct + split.reject;
  if (!total) return '<div class="empty-analytics">No repair labels in this selection.</div>';
  const seg = (value, cls) => value ? `<span class="route-seg ${cls}" style="width:${(value / total) * 100}%;" title="${value}"></span>` : '';
  return `
    <div class="repair-route">
      <div class="route-bar">${seg(split.production, 'production')}${seg(split.direct, 'direct')}${seg(split.reject, 'reject')}</div>
      <div class="route-legend">
        <span><b class="route-dot production"></b> Production repair · ${split.production}</span>
        <span><b class="route-dot direct"></b> Repair (direct) · ${split.direct}</span>
        <span><b class="route-dot reject"></b> Not sellable · ${split.reject}</span>
      </div>
    </div>
  `;
}

function renderRepairBins(binRows) {
  if (!binRows.length) return '<div class="empty-analytics">No repair items in this selection.</div>';
  const max = Math.max(...binRows.map(bin => bin.total), 1);
  // De segmentkleuren betekenen de zwaarte (licht/zwaar/afkeur), dus die krijgen
  // een legenda. Geen categoriekleur per bak erbij: twee kleursystemen in één
  // grafiek maakt het onleesbaar.
  return `
    <div class="chart-legend chart-legend--left">
      <span class="chart-legend-item"><b style="background: #1A7F37;"></b>Light</span>
      <span class="chart-legend-item"><b style="background: #C77700;"></b>Heavy</span>
      <span class="chart-legend-item"><b style="background: #C8102E;"></b>Reject</span>
    </div>
    <div class="repair-bins">
      ${binRows.map(bin => `
        <div class="repair-bin-row">
          <div class="repair-bin-head"><strong>${escapeHtml(bin.bin)}</strong><em>${formatNumber(bin.total)}</em></div>
          <div class="repair-bin-track-wrap">
            <div class="repair-bin-track" style="width:${Math.max(4, (bin.total / max) * 100)}%;">
              ${bin.light ? `<span class="bin-seg light" style="flex:${bin.light};" title="Light ${bin.light}"></span>` : ''}
              ${bin.heavy ? `<span class="bin-seg heavy" style="flex:${bin.heavy};" title="Heavy ${bin.heavy}"></span>` : ''}
              ${bin.reject ? `<span class="bin-seg reject" style="flex:${bin.reject};" title="Reject ${bin.reject}"></span>` : ''}
            </div>
          </div>
          <div class="repair-bin-meta">${bin.light} light · ${bin.heavy} heavy · ${bin.reject} reject</div>
        </div>
      `).join('')}
    </div>
  `;
}

// Reparatie per batch: welke batch levert de meeste reparaties op, met het
// reparatiepercentage en de verdeling over de bakken. Zo zie je direct welke
// leveranciersbatch structureel werk oplevert.
function buildRepairBatchRows(filteredItems) {
  const rows = new Map();
  (filteredItems || []).forEach(item => {
    if (item.source !== 'history' || !item.rawItem) return;
    const key = item.batch || '—';
    const row = rows.get(key) || { batch: key, graded: 0, repair: 0, production: 0, direct: 0, reject: 0 };
    row.graded += 1;
    const raw = item.rawItem;
    if (typeof needsProblemLabel === 'function' && needsProblemLabel(raw, raw.result)) {
      row.repair += 1;
      const result = raw.result || {};
      const type = result.repairLabelType || (result.repairPolicy && result.repairPolicy.labelType) || 'reject';
      if (type === 'production') row.production += 1;
      else if (type === 'direct') row.direct += 1;
      else row.reject += 1;
    }
    rows.set(key, row);
  });
  return Array.from(rows.values())
    .map(row => ({ ...row, rate: safePercent(row.repair, row.graded) }))
    .sort((a, b) => b.repair - a.repair || b.graded - a.graded);
}

function renderRepairBatchTable(rows) {
  if (!rows.length) return '<div class="empty-analytics">No repair data in this selection.</div>';
  // Balk op een vaste 0-100%-schaal: 25% vult een kwart. Schalen op de slechtste
  // batch gaf een volle balk bij 25%, wat het percentage tegensprak.
  return `
    <div class="analytics-table-wrap">
      <table class="comparison-table repair-batch-table">
        <thead>
          <tr><th>Batch</th><th>Graded</th><th>Repair</th><th>Repair rate</th><th>Production</th><th>Direct</th><th>Not sellable</th></tr>
        </thead>
        <tbody>
          ${rows.map(row => `
            <tr class="${row.rate >= 25 ? 'is-high-repair' : ''}">
              <td><strong>${escapeHtml(row.batch)}</strong></td>
              <td>${formatNumber(row.graded)}</td>
              <td><b>${formatNumber(row.repair)}</b></td>
              <td>
                <span class="repair-rate-cell">
                  <span class="repair-rate-track"><span class="repair-rate-fill ${row.rate >= 25 ? 'high' : row.rate >= 10 ? 'mid' : 'low'}" style="width:${Math.max(2, Math.min(100, row.rate))}%;"></span></span>
                  <b>${row.rate}%</b>
                </span>
              </td>
              <td>${formatNumber(row.production)}</td>
              <td>${formatNumber(row.direct)}</td>
              <td>${formatNumber(row.reject)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// Pareto: descending bars + running cumulative-% marker (attack the vital few).
function renderPareto(rows, emptyText) {
  if (!rows.length) return `<div class="empty-analytics">${escapeHtml(emptyText || 'No data yet.')}</div>`;
  const total = rows.reduce((sum, row) => sum + row.value, 0) || 1;
  // Balk en percentage tonen nu hetzelfde: het aandeel van deze oorzaak in alle
  // reparaties. Eén kleur, want dit is een rangorde van grootte en geen set
  // categorieen — verschillende kleuren zouden een betekenis suggereren die er
  // niet is. Het cumulatieve streepje is eruit: dat las als een losse lijn.
  return `
    <div class="analytics-pareto">
      ${rows.map(row => {
        const share = Math.round((row.value / total) * 100);
        return `
          <div class="pareto-row">
            <div class="pareto-label"><strong>${escapeHtml(row.label)}</strong></div>
            <div class="pareto-track"><span class="pareto-fill" style="width:${Math.max(2, share)}%;"></span></div>
            <div class="pareto-value">${formatNumber(row.value)}<em>${share}%</em></div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderAnalytics() {
  const isAdmin = isAdminUser();
  const filters = getAnalyticsFilters();
  const activeTab = getAnalyticsTab();
  const allItems = buildAnalyticsItems(isAdmin);
  const filteredItems = filterAnalyticsItems(allItems, filters);
  const completedItems = filteredItems.filter(item => item.status === 'graded' || item.status === 'repair');
  const activeWorkItems = filteredItems.filter(item => item.status !== 'label');
  const counts = getAnalyticsCounts(completedItems);
  const totalCompleted = completedItems.length;
  const openCount = countAnalyticsStatus(filteredItems, 'open');
  const avgTime = getAverageAnalyticsTime(completedItems);
  const todayCompleted = completedItems.filter(item => isWithinAnalyticsRange(item.date, 'today')).length;
  const weekCompleted = completedItems.filter(item => isWithinAnalyticsRange(item.date, 'week')).length;
  const completionRate = safePercent(activeWorkItems.filter(item => item.status !== 'open').length, activeWorkItems.length);
  const employeeRows = buildEmployeeRows(filteredItems);
  const batchProgressRows = buildBatchProgressRows(filters.productType);
  const trendBuckets = buildTrendBuckets(filteredItems, 7);
  const supplierComparisonItems = filteredItems.filter(item => item.rawItem).map(item => item.rawItem);
  const supplierStats = getSupplierComparisonStats(supplierComparisonItems);
  const supplierSummary = supplierStats.summary;
  const upliftAvg = supplierSummary.total ? Math.round((supplierSummary.netDelta / supplierSummary.total) * 100) / 100 : 0;
  const supplierScorecardRows = getSupplierScorecardRows(supplierComparisonItems);
  const favorabilityRows = getSupplierFavorabilityRows(supplierScorecardRows);
  const batchYieldRows = buildBatchYieldRows(supplierComparisonItems);
  const premiumBase = (counts.A || 0) + (counts.B || 0) + (counts.C || 0);
  const premiumYield = safePercent((counts.A || 0) + (counts.B || 0), premiumBase);
  const usableYield = safePercent((counts.A || 0) + (counts.B || 0) + (counts.C || 0), totalCompleted);
  const rejectRate = safePercent(counts.D || 0, totalCompleted);
  const concordance = safePercent(supplierSummary.same, supplierSummary.total);
  const repairItems = getRepairItems(filteredItems);
  const repairBinRows = buildRepairBinRows(repairItems);
  const repairBatchRows = buildRepairBatchRows(filteredItems);
  const routeSplit = getRepairRouteSplit(repairItems);
  const paretoRows = buildAnalyticsProblemRows(repairItems);
  const rangeLabel = filters.dateRange === 'today' ? 'today'
    : filters.dateRange === 'week' ? 'last 7 days'
      : filters.dateRange === 'month' ? 'last 30 days'
        : 'all data';

  const overviewTab = `
    <div class="analytics-server-stats" id="analytics-server-stats" data-state="loading">
      <span class="analytics-server-stats-label">Loading live figures from database…</span>
    </div>
    <section class="analytics-section analytics-section-first">
      <div class="analytics-section-head"><h2>Key figures</h2><span>Output, favourability and quality at a glance · ${rangeLabel}</span></div>
      <div class="analytics-kpi-grid analytics-kpi-grid--auto">
        ${renderKpiCard({ label: 'Graded total', value: formatNumber(totalCompleted), sub: `${todayCompleted} today · ${weekCompleted} this week`, tone: 'primary', spark: trendBuckets.map(bucket => bucket.value), sparkColor: '#2563EB' })}
        ${renderKpiCard({ label: 'Grade uplift Δ', value: supplierSummary.total ? formatSignedNumber(upliftAvg) : '-', sub: supplierSummary.total ? `${formatSignedNumber(supplierSummary.netDelta)} net · ${supplierSummary.improvedPercent}% above supplier` : 'no supplier grades', tone: 'primary' })}
        ${renderKpiCard({ label: 'A/B premium', value: `${premiumYield}%`, sub: `${formatNumber((counts.A || 0) + (counts.B || 0))} of ${formatNumber(premiumBase)} sellable` })}
        ${renderKpiCard({ label: 'Reject / X-rate', value: `${rejectRate}%`, sub: `${formatNumber(counts.D || 0)} not sellable`, tone: (counts.D || 0) ? 'danger' : '', spark: trendBuckets.map(bucket => bucket.repair), sparkColor: '#E12B35' })}
        ${renderKpiCard({ label: 'Avg. grading time', value: formatSeconds(avgTime), sub: `across ${formatNumber(totalCompleted)} gradings` })}
        ${renderKpiCard({ label: 'Awaiting grading', value: formatNumber(openCount), sub: `${completionRate}% batch completion`, tone: openCount ? 'warning' : '' })}
      </div>
    </section>
    <section class="analytics-section">
      <div class="analytics-section-head"><h2>Favourability</h2><span>Did each batch beat or miss the supplier grade · ${rangeLabel}</span></div>
      <div class="analytics-grid">
        ${renderAnalyticsPanel('Yield per batch', 'Net grade uplift per device — green beats the supplier grade, red misses it.', renderDivergingBar(batchYieldRows, { empty: 'No supplier grades to compare yet.' }), 'analytics-wide')}
        ${renderAnalyticsPanel('Grade mix', 'Where the value lands across A/B/C/X.', render100StackedGradeBar(counts))}
      </div>
    </section>
  `;

  const batchTab = `
    <section class="analytics-section analytics-section-first">
      <div class="analytics-section-head"><h2>Favourability KPIs</h2><span>Is this batch/supplier favourable for us · ${rangeLabel}</span></div>
      <div class="analytics-kpi-grid analytics-kpi-grid--auto">
        ${renderKpiCard({ label: 'Above supplier', value: supplierSummary.total ? `${supplierSummary.improvedPercent}%` : '-', sub: `${formatNumber(supplierSummary.improved || 0)} devices upgraded`, tone: 'primary' })}
        ${renderKpiCard({ label: 'Below supplier', value: supplierSummary.total ? `${supplierSummary.downgradedPercent}%` : '-', sub: `${formatNumber(supplierSummary.downgraded || 0)} devices downgraded`, tone: supplierSummary.downgradedPercent > 0 ? 'danger' : '' })}
        ${renderKpiCard({ label: 'Grade concordance', value: supplierSummary.total ? `${concordance}%` : '-', sub: 'matched the supplier grade' })}
        ${renderKpiCard({ label: 'Net grade delta', value: supplierSummary.total ? formatSignedNumber(supplierSummary.netDelta) : '-', sub: `⌀ ${formatSignedNumber(upliftAvg)}/device` })}
        ${renderKpiCard({ label: 'Usable yield (A/B/C)', value: `${usableYield}%`, sub: `${rejectRate}% rejected` })}
        ${renderKpiCard({ label: 'Upgraded to A', value: formatNumber(supplierSummary.toAFromLower || 0), sub: 'from a lower supplier grade' })}
      </div>
    </section>
    <section class="analytics-section">
      <div class="analytics-section-head"><h2>Supplier &amp; batch detail</h2><span>Where the margin sits: ReMarkt grade vs supplier grade</span></div>
      <div class="analytics-grid">
        ${renderAnalyticsPanel('Yield per batch', 'Net grade uplift per device per batch — green beats, red misses.', renderDivergingBar(batchYieldRows, { empty: 'No supplier grades to compare yet.' }), 'analytics-wide')}
        ${renderSupplierComparisonPanel(supplierComparisonItems)}
        ${renderAnalyticsPanel('Supplier favourability index', 'One 0–100 buy/avoid score per supplier (uplift + % above − % below).', renderScoreBars(favorabilityRows, { empty: 'No supplier grades yet.' }), 'analytics-wide')}
        ${renderAnalyticsPanel('Supplier scorecard', 'Per supplier: who under- or over-grades and the average uplift per device.', renderSupplierScorecard(supplierScorecardRows), 'analytics-wide')}
      </div>
    </section>
  `;

  const throughputTab = `
    <section class="analytics-section analytics-section-first">
      <div class="analytics-section-head"><h2>Throughput KPIs</h2><span>How fast and by whom · ${rangeLabel}</span></div>
      <div class="analytics-kpi-grid analytics-kpi-grid--auto analytics-kpi-grid--compact">
        ${renderKpiCard({ label: 'Output', value: formatNumber(totalCompleted), sub: `${todayCompleted} today · ${weekCompleted} this week`, tone: 'primary', spark: trendBuckets.map(bucket => bucket.value), sparkColor: '#2563EB' })}
        ${renderKpiCard({ label: 'Avg. grading time', value: formatSeconds(avgTime), sub: `across ${formatNumber(totalCompleted)} gradings` })}
        ${renderKpiCard({ label: 'Awaiting grading', value: formatNumber(openCount), sub: `${completionRate}% batch completion`, tone: openCount ? 'warning' : '' })}
      </div>
    </section>
    <section class="analytics-section">
      <div class="analytics-section-head"><h2>Production &amp; staff</h2><span>Output per day, per employee, and batch progress</span></div>
      <div class="analytics-grid">
        ${renderAnalyticsPanel('Output per day', 'Graded per day; the red part is repair/X. Last 7 days.', renderTrendChart(trendBuckets))}
        ${renderAnalyticsPanel('Employee performance', 'Output, average time and X-rate per employee.', renderEmployeeTable(employeeRows))}
        ${renderAnalyticsPanel('Batch completion (live)', 'Where stock is still open — respects the Product filter only.', renderBatchProgress(batchProgressRows), 'analytics-wide')}
      </div>
    </section>
  `;

  const repairTab = `
    <section class="analytics-section analytics-section-first">
      <div class="analytics-section-head"><h2>Repair KPIs</h2><span>Size of the repair queue and its bins · ${rangeLabel}</span></div>
      <div class="analytics-kpi-grid analytics-kpi-grid--auto analytics-kpi-grid--compact">
        ${renderKpiCard({ label: 'Repair labels', value: formatNumber(repairItems.length), sub: `${safePercent(repairItems.length, totalCompleted)}% of graded`, tone: repairItems.length ? 'danger' : '' })}
        ${renderKpiCard({ label: 'Production repair', value: formatNumber(routeSplit.production), sub: `${safePercent(routeSplit.production, repairItems.length)}% of repairs · back to stock` })}
        ${renderKpiCard({ label: 'Direct repair', value: formatNumber(routeSplit.direct), sub: `${safePercent(routeSplit.direct, repairItems.length)}% of repairs · fix before sale` })}
        ${renderKpiCard({ label: 'Not sellable', value: formatNumber(routeSplit.reject), sub: `${safePercent(routeSplit.reject, repairItems.length)}% of repairs · reject`, tone: routeSplit.reject ? 'danger' : '' })}
        ${renderKpiCard({ label: 'Batches with repair', value: formatNumber(repairBatchRows.filter(row => row.repair > 0).length), sub: `${formatNumber(repairBatchRows.length)} batch${repairBatchRows.length === 1 ? '' : 'es'} in view` })}
        ${renderKpiCard({ label: 'Worst batch', value: repairBatchRows.length ? `${repairBatchRows.slice().sort((a, b) => b.rate - a.rate)[0].rate}%` : '-', sub: repairBatchRows.length ? `Batch ${repairBatchRows.slice().sort((a, b) => b.rate - a.rate)[0].batch} repair rate` : 'no batches in view', tone: 'warning' })}
      </div>
    </section>
    <section class="analytics-section">
      <div class="analytics-section-head"><h2>Repair bins</h2><span>Sort each laptop to the right bin and clear stock fast</span></div>
      <div class="analytics-grid">
        ${renderAnalyticsPanel('Route split', 'Green = production repair (restock), amber = direct repair, red = not sellable.', renderRepairRouteSplit(routeSplit), 'analytics-wide')}
        ${renderAnalyticsPanel('Repair per batch', 'Which batch costs the most repair work — rate, route split and volume. Use the Batch filter to zoom in on one.', renderRepairBatchTable(repairBatchRows), 'analytics-wide')}
        ${renderAnalyticsPanel('Repair bins by type', 'One bin per station; light vs heavy vs reject within each bin.', renderRepairBins(repairBinRows))}
        ${renderAnalyticsPanel('Top repair causes', 'Biggest causes, each as a share of all repair labels.', renderPareto(paretoRows, 'No repair causes yet.'))}
      </div>
    </section>
  `;

  const tabBody = activeTab === 'batch' ? batchTab
    : activeTab === 'throughput' ? throughputTab
      : activeTab === 'repair' ? repairTab
        : overviewTab;

  return `
    <div class="screen analytics-screen analytics-pro-screen">
      ${renderDashboardTabs('analytics')}
      <div class="analytics-hero">
        <div>
          <div class="ops-kicker" style="color: var(--remarkt-red);">Management dashboard</div>
          <h1>Operations &amp; Value Analytics</h1>
          <p>Steer on batch favourability, output and repair flow — ${rangeLabel}.</p>
        </div>
        <div class="analytics-hero-actions">
          <button class="btn btn-secondary" data-action="history" type="button">Open Full History</button>
          <button class="btn btn-primary" data-action="export_supplier_comparison" data-export-batch="all" type="button">Export Report</button>
        </div>
      </div>
      ${renderAnalyticsFilters(filters, allItems)}
      ${renderAnalyticsSubTabs(activeTab)}
      ${tabBody}
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

