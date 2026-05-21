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
    return {
      item,
      sticker: item.sticker || '',
      batchNummer: item.batchNummer || '-',
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
    const key = row.batchNummer || '-';
    const batch = byBatch.get(key) || {
      batchNummer: key,
      total: 0,
      improved: 0,
      same: 0,
      downgraded: 0,
      netDelta: 0,
      supplierCounts: { A: 0, B: 0, C: 0, D: 0 },
      remarktCounts: { A: 0, B: 0, C: 0, D: 0 },
      rows: [],
    };
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
                  <td><strong>${escapeHtml(batch.batchNummer)}</strong></td>
                  <td>${batch.total}</td>
                  <td>${batch.improved} <span>${batch.improvedPercent}%</span></td>
                  <td>${batch.same} <span>${batch.samePercent}%</span></td>
                  <td>${batch.downgraded} <span>${batch.downgradedPercent}%</span></td>
                  <td><strong>${formatSignedNumber(batch.netDelta)}</strong></td>
                  <td><div class="transition-list">${renderTransitionChips(batch.transitions)}</div></td>
                  <td><button class="btn btn-secondary btn-small" data-action="export_supplier_comparison" data-export-batch="${escapeHtml(batch.batchNummer)}">Export</button></td>
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
  return getSupplierComparisonRows(items)
    .filter(row => batchNummer === 'all' || row.batchNummer === batchNummer)
    .map(row => ({
      Batch: row.batchNummer,
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

function renderAnalytics() {
  const data = getDashboardData();
  const { isAdmin, items, counts, avg, openCount, completedCount, allLaptops, maxGradeCount, batchRows } = data;
  const total = items.length;
  const defectRate = safePercent(counts.D, total);
  const aRate = safePercent(counts.A, total);
  const byUser = new Map();
  const byBatch = new Map();
  const byComponent = new Map();
  const byProblem = new Map();

  items.forEach(item => {
    const userKey = item.user_naam || item.user_id || 'Unknown';
    const user = byUser.get(userKey) || { count: 0, sec: 0, defects: 0 };
    user.count++;
    user.sec += Number(item.duurSec || 0);
    if (item.grade === 'D') user.defects++;
    byUser.set(userKey, user);

    const batchKey = item.batchNummer || '-';
    const batch = byBatch.get(batchKey) || { count: 0, A: 0, B: 0, C: 0, D: 0 };
    batch.count++;
    if (batch[item.grade] !== undefined) batch[item.grade]++;
    byBatch.set(batchKey, batch);

    (item.result && item.result.detailRows ? item.result.detailRows : []).forEach(row => {
      if (!row || row.keuze === '-' || Number(row.punten || 0) <= 0) return;
      const component = byComponent.get(row.naam) || { count: 0, points: 0 };
      component.count++;
      component.points += Number(row.punten || 0);
      byComponent.set(row.naam, component);
    });

    (item.result && item.result.problems ? item.result.problems : []).forEach(problem => {
      byProblem.set(problem, (byProblem.get(problem) || 0) + 1);
    });
  });

  const userRows = Array.from(byUser.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 6)
    .map(([name, stats]) => ({
      title: name,
      sub: `${stats.count} grading${stats.count === 1 ? '' : 's'} · ${Math.round(stats.sec / stats.count)} sec. avg.`,
      value: `${safePercent(stats.defects, stats.count)}% X`,
    }));
  const batchAnalyticsRows = Array.from(byBatch.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 6)
    .map(([batch, stats]) => ({
      title: `Batch ${batch}`,
      sub: `${stats.count} grading${stats.count === 1 ? '' : 's'} · A ${stats.A}, B ${stats.B}, C ${stats.C}, X ${stats.D}`,
      value: `${safePercent(stats.A, stats.count)}% A`,
    }));
  const componentRows = Array.from(byComponent.entries())
    .sort((a, b) => b[1].points - a[1].points)
    .slice(0, 6)
    .map(([name, stats]) => ({
      title: name,
      sub: `${stats.count} score impact${stats.count === 1 ? '' : 's'}`,
      value: `${stats.points}p`,
    }));
  const problemRows = Array.from(byProblem.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([problem, count]) => ({
      title: problem,
      sub: 'repair label',
      value: `${count}x`,
    }));
  const recentRows = items.slice(-5).reverse().map(item => ({
    title: `${item.merk || '-'} ${item.model || ''}`.trim(),
    sub: `${item.sticker || '-'} · ${item.user_naam || '-'} · batch ${item.batchNummer || '-'}`,
    value: item.grade === 'D' ? 'X' : item.grade || '-',
  }));

  return `
    <div class="screen analytics-screen">
      <div class="analytics-hero">
        <div>
          <div class="ops-kicker" style="color: var(--remarkt-red);">Insights Dashboard</div>
          <h1>Grading Insights</h1>
          <p>Track quality, speed, batches and parts with the highest impact on final grade.</p>
        </div>
      </div>
      ${renderDashboardTabs('analytics')}

      <div class="ops-status-grid">
        <div class="ops-stat warning"><strong>${total}</strong><span>${isAdmin ? 'total gradings' : 'your gradings'}</span></div>
        <div class="ops-stat"><strong>${avg || '-'}</strong><span>avg. seconds per device</span></div>
        <div class="ops-stat"><strong>${defectRate}%</strong><span>X / repair rate</span></div>
        <div class="ops-stat"><strong>${openCount}</strong><span>open devices · ${completedCount}/${allLaptops.length} done</span></div>
      </div>

      <div class="analytics-grid">
        <div class="analytics-panel">
          <h3>Grade Mix</h3>
          <div class="grade-mini-bars">
            ${['A','B','C','D'].map(grade => `
              <div class="grade-mini-bar">
                <strong>${grade === 'D' ? 'X' : grade}</strong>
                <div class="grade-mini-track"><div class="grade-mini-fill ${grade}" style="width: ${(counts[grade] / maxGradeCount) * 100}%;"></div></div>
                <span>${counts[grade]} · ${safePercent(counts[grade], total)}%</span>
              </div>
            `).join('')}
          </div>
          <div class="simple-stat-row">
            <div class="simple-stat"><strong>${aRate}%</strong><span>A share</span></div>
            <div class="simple-stat"><strong>${counts.C + counts.D}</strong><span>C/X total</span></div>
            <div class="simple-stat"><strong>${total ? Math.round(items.reduce((sum, item) => sum + Number(item.score || 0), 0) / total) : '-'}</strong><span>avg. score</span></div>
          </div>
        </div>

        <div class="analytics-panel">
          <h3>Operators</h3>
          ${renderAnalyticsRows(userRows, 'No operator stats available yet.')}
        </div>

        <div class="analytics-panel">
          <h3>Batches</h3>
          ${renderAnalyticsRows(batchAnalyticsRows, 'No batch stats available yet.')}
        </div>

        <div class="analytics-panel">
          <h3>Part Impact</h3>
          ${renderAnalyticsRows(componentRows, 'No part impact available yet.')}
        </div>

        <div class="analytics-panel analytics-wide">
          <h3>Repair Signals</h3>
          ${renderAnalyticsRows(problemRows, 'No repair signals saved yet.')}
        </div>

        ${renderSupplierComparisonPanel(items)}

        <div class="analytics-panel analytics-wide">
          <h3>History</h3>
          ${renderAnalyticsRows(recentRows, 'No gradings saved yet.')}
          <div class="analytics-actions">
            <button class="btn btn-primary" data-action="history">Open Full History</button>
          </div>
        </div>
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

