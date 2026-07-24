// =============================================================================
// UI RENDERING
// Schermen, dashboards, gradingweergave en component-rendering.
// =============================================================================
const preloadedVisualAssets = new Set();

function renderComponentNotice(ond) {
  const supplierIssues = getSupplierInlineIssues(ond.id);
  const touchscreenNote = ond.id === 'lcd' && isTouchscreenLaptop();
  const touchControl = ond.id === 'lcd' ? renderTouchOverrideControls(STATE.currentLaptop, 'question') : '';
  if (!supplierIssues.length && !touchscreenNote && !touchControl) return '';
  return `
    <div class="component-notice component-notice-inline">
      ${supplierIssues.length ? `<strong>Supplier notice</strong><ul>${supplierIssues.map(issue => `<li>${escapeHtml(ond.naam)} = ${escapeHtml(issue)}</li>`).join('')}</ul>` : ''}
      ${touchscreenNote ? `<strong>${supplierIssues.length ? 'Touchscreen' : 'Touchscreen'}</strong>This laptop has touch glass. Check scratches, pressure marks and touch response carefully.` : ''}
      ${touchControl}
    </div>
  `;
}

function renderExpertSupplierInlineNotice(laptop = STATE.currentLaptop) {
  if (!laptop || !normalizeText(laptop.meldingen)) return '';
  const rows = [];
  getGradingOnderdelen().forEach(ond => {
    getSupplierInlineIssues(ond.id, laptop).forEach(issue => {
      rows.push(`${ond.naam} = ${issue}`);
    });
  });
  const uniqueRows = Array.from(new Set(rows));
  if (!uniqueRows.length) return '';
  return `
    <div class="component-notice component-notice-inline expert-supplier-inline">
      <strong>Supplier notice</strong>
      <ul>${uniqueRows.map(row => `<li>${escapeHtml(row)}</li>`).join('')}</ul>
    </div>
  `;
}

function renderSupplierDReasonList(laptop) {
  const issues = splitSupplierIssues(laptop);
  if (!issues.length) {
    return '<div class="repair-alert-reasons">No specific reason found in the supplier list.</div>';
  }
  return `
    <div class="repair-alert-reasons">
      <span>Reason from supplier list</span>
      <ul>${issues.map(issue => `<li>${escapeHtml(issue)}</li>`).join('')}</ul>
    </div>
  `;
}

function renderTouchOverrideControls(laptop, context = 'info') {
  if (!laptop) return '';
  const override = normalizeTouchOverride(laptop.touchOverride);
  const effectiveTouch = isTouchscreenLaptop(laptop);
  const contextClass = context === 'question' ? ' touch-override-panel-compact' : '';
  return `
    <div class="touch-override-panel${contextClass}">
      <div class="touch-override-copy">
        <span class="touch-override-title">Touch status</span>
        <span class="touch-override-status">${effectiveTouch ? 'Touch: yes' : 'Touch: no'} · ${override ? 'manually adjusted' : 'from list'}</span>
      </div>
      <div class="touch-override-actions" role="group" aria-label="Correct touch status">
        <button class="touch-option ${effectiveTouch ? 'selected' : ''}" data-action="set_touch_override" data-touch-override="yes" type="button">Touch yes</button>
        <button class="touch-option ${!effectiveTouch ? 'selected' : ''}" data-action="set_touch_override" data-touch-override="no" type="button">Touch no</button>
      </div>
    </div>
  `;
}

// Text utilities live in assets/app-state.js.

// Import workflow lives in assets/import-workflow.js.

// =============================================================================
// RENDER FUNCTIES
// =============================================================================
function render() {
  applyThemePreference();
  if (typeof applyContrastPreference === 'function') applyContrastPreference();
  const perf = window.performance;
  if (perf && perf.mark) perf.mark('remarkt-render-start');
  const app = document.getElementById('app');
  let html = '';
  
  if (STATE.currentScreen === 'login') {
    html = renderLogin();
  } else {
    html = renderTopbar();
    html += renderAppMessage();
    if (STATE.pendingDecision) html += renderDecisionModal(STATE.pendingDecision);
    if (STATE.supplierNotice) html += renderSupplierNoticeModal(STATE.supplierNotice);
    if (STATE.monitorReprintPrompt) html += renderMonitorReprintModal(STATE.monitorReprintPrompt);
    if (STATE.imagePreview) html += renderImagePreviewModal(STATE.imagePreview);
    if (STATE.currentScreen === 'password_change') html += renderPasswordChange();
    else if (STATE.currentScreen === 'home') html += renderHome();
    else if (STATE.currentScreen === 'sticker_scan') html += renderStickerScan();
    else if (STATE.currentScreen === 'monitor_label_scan') html += renderMonitorLabelScan();
    else if (STATE.currentScreen === 'monitor_manual') html += renderMonitorManualEntry();
    else if (STATE.currentScreen === 'scan') html += renderScan();
    else if (STATE.currentScreen === 'manual') html += renderManualEntry();
    else if (STATE.currentScreen === 'test_start') html += renderTestStart();
    else if (STATE.currentScreen === 'import') html += renderImport();
    else if (STATE.currentScreen === 'accounts') html += renderAccounts();
    else if (STATE.currentScreen === 'laptop_info') html += renderLaptopInfo();
    else if (STATE.currentScreen === 'grading_beginner') html += renderGradingBeginner();
    else if (STATE.currentScreen === 'grading_expert') html += renderGradingExpert();
    else if (STATE.currentScreen === 'result') html += renderResult();
    else if (STATE.currentScreen === 'history') html += renderHistory();
    else if (STATE.currentScreen === 'analytics') html += renderAnalytics();
    else if (STATE.currentScreen === 'explain') html += renderExplain();
  }
  
  app.innerHTML = html;
  if (typeof translateRenderedApp === 'function') translateRenderedApp(app);
  attachListeners();
  scheduleScreenWarmup();
  if (STATE.currentScreen === 'analytics' && typeof refreshAnalyticsServerStats === 'function') {
    refreshAnalyticsServerStats();
  }
  if (perf && perf.mark && perf.measure) {
    perf.mark('remarkt-render-end');
    perf.measure('remarkt-render', 'remarkt-render-start', 'remarkt-render-end');
  }
}

function renderSupplierNoticeModal(notice) {
  const notes = Array.isArray(notice.issues) && notice.issues.length
    ? notice.issues
    : splitSupplierIssues({ meldingen: notice.notes || '' });
  const componentName = notice.componentName || '';
  return `
    <div class="supplier-notice-overlay" role="dialog" aria-modal="true" aria-label="Supplier notice">
      <div class="supplier-notice-modal">
        <div class="supplier-notice-kicker">Supplier notice</div>
        <h3>${componentName ? escapeHtml(componentName) + ': ' : ''}review this notice</h3>
        <p>${escapeHtml(notice.device || 'This device')} has a supplier notice${componentName ? ' for this part' : ''}. Confirm that you have read this before making the ReMarkt choice here.</p>
        <div class="supplier-notice-box">
          ${notes.length ? `<ul>${notes.map(note => `<li>${componentName ? `<strong>${escapeHtml(componentName)}</strong> = ` : ''}${escapeHtml(note)}</li>`).join('')}</ul>` : escapeHtml(notice.notes || '-')}
        </div>
        <div class="modal-actions">
          <button class="btn btn-primary" data-action="confirm_supplier_notice" type="button">Read, continue</button>
        </div>
      </div>
    </div>
  `;
}

function renderMonitorReprintModal(prompt) {
  const sticker = prompt && prompt.sticker ? prompt.sticker : '';
  const record = typeof getLatestMonitorLabelPrintForSticker === 'function' ? getLatestMonitorLabelPrintForSticker(sticker) : null;
  const monitor = typeof getMonitorBySticker === 'function' ? getMonitorBySticker(sticker) : null;
  const device = (monitor && monitor.deviceName)
    || (record && record.deviceName)
    || (record && `${record.merk || ''} ${record.model || ''}`.trim())
    || 'This monitor';
  const gradeRaw = record ? record.grade : (STATE.monitorSelectedGrade || '');
  const grade = gradeRaw ? displayMonitorGrade(normalizeMonitorGrade(gradeRaw)) : '';
  let printedAt = '';
  if (record && record.printedAt) {
    const date = new Date(record.printedAt);
    if (!Number.isNaN(date.getTime())) {
      printedAt = date.toLocaleString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
  }
  const who = record && record.user_naam ? record.user_naam : '';
  const details = [
    `<li><strong>Device:</strong> ${escapeHtml(device)}</li>`,
    `<li><strong>Barcode:</strong> ${escapeHtml(sticker)}</li>`,
    grade ? `<li><strong>Grade:</strong> ${escapeHtml(grade)}</li>` : '',
    printedAt ? `<li><strong>Printed on:</strong> ${escapeHtml(printedAt)}${who ? ` by ${escapeHtml(who)}` : ''}</li>` : '',
  ].filter(Boolean).join('');
  return `
    <div class="supplier-notice-overlay" role="dialog" aria-modal="true" aria-label="Monitor already scanned">
      <div class="supplier-notice-modal">
        <div class="supplier-notice-kicker">Note — already scanned</div>
        <h3>You already scanned this monitor</h3>
        <p>This monitor has already been graded and a label was printed. What do you want to do?</p>
        <div class="supplier-notice-box">
          <ul>${details}</ul>
        </div>
        <div class="modal-actions" style="display:flex; gap:10px; flex-wrap:wrap;">
          <button class="btn btn-primary" data-action="monitor_reprint_confirm" type="button">Print again${grade ? ` (grade ${escapeHtml(grade)})` : ''}</button>
          <button class="btn btn-secondary" data-action="monitor_regrade" type="button">Grade again</button>
          <button class="btn btn-secondary" data-action="monitor_reprint_cancel" type="button">Back</button>
        </div>
      </div>
    </div>
  `;
}

function renderImagePreviewModal(preview) {
  return `
    <div class="image-preview-overlay" data-image-preview-overlay="true" role="dialog" aria-modal="true" aria-label="${escapeHtml(preview.label || 'Image preview')}" style="position:fixed;top:0;right:0;bottom:0;left:0;z-index:1300;background:rgba(23,23,23,0.72);display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto;">
      <div class="image-preview-modal" style="width:920px;max-width:calc(100% - 32px);max-height:calc(100vh - 32px);background:#fff;border:1px solid #E9E9E9;border-radius:10px;box-shadow:0 24px 80px rgba(0,0,0,0.34);display:grid;grid-template-rows:auto minmax(0,1fr);overflow:hidden;">
        <div class="image-preview-head" style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 12px 10px 14px;border-bottom:1px solid #E9E9E9;background:#fff;">
          <strong>${escapeHtml(preview.label || 'Preview')}</strong>
          <button class="image-preview-close" data-action="close_image_preview" type="button" aria-label="Close image" style="min-height:40px;min-width:94px;padding:8px 11px;border:1px solid #E9E9E9;border-radius:8px;background:#fff;color:#171717;display:inline-flex;align-items:center;justify-content:center;gap:6px;font-weight:800;line-height:1;">× <span>Close</span></button>
        </div>
        <div class="image-preview-body" style="min-width:0;min-height:260px;width:100%;height:70vh;max-height:calc(100vh - 96px);overflow:hidden;background:#fff;display:flex;align-items:center;justify-content:center;">
          <img src="${escapeHtml(preview.src)}" alt="${escapeHtml(preview.label || 'Enlarged option image')}" loading="eager" decoding="async" style="width:100%;height:100%;min-width:0;min-height:0;max-width:100%;max-height:100%;object-fit:contain;object-position:center center;background:#fff;display:block;padding:10px;">
        </div>
      </div>
    </div>
  `;
}

function renderLogin() {
  return `
    <div class="screen">
      ${renderAppMessage()}
      <div class="login-card">
        <div class="login-language-row">${renderOptionalLanguageToggle()}</div>
        <h1>ReMarkt Grading</h1>
        <p>Select your account and enter your password.</p>
        <div class="login-fields">
          <label class="form-label" for="loginUser">Account</label>
          <select class="form-input" id="loginUser">
            ${USERS.map(u => `<option value="${escapeHtml(u.id)}">${escapeHtml(u.naam)} · ${escapeHtml(displayUserRole(u.rol))}</option>`).join('')}
          </select>
          <label class="form-label" for="loginPassword">Password</label>
          <input type="password" class="form-input" id="loginPassword" placeholder="Password" autocomplete="current-password">
          <button class="btn btn-primary" data-action="login_password">Sign in</button>
          <div class="field-help">Demo passwords are hashed in browser code; this is not production security.</div>
        </div>
      </div>
    </div>
  `;
}

function renderPasswordChange() {
  const userName = STATE.currentUser && STATE.currentUser.naam ? STATE.currentUser.naam : 'your account';
  return `
    <div class="screen" style="max-width: 560px;">
      <div class="login-card">
        <h1>New password</h1>
        <p>${escapeHtml(userName)}, choose your own password before you continue.</p>
        <div class="login-fields">
          <label class="form-label" for="newOwnPassword">New password</label>
          <input type="password" class="form-input" id="newOwnPassword" placeholder="At least 8 characters" autocomplete="new-password">
          <label class="form-label" for="confirmOwnPassword">Repeat password</label>
          <input type="password" class="form-input" id="confirmOwnPassword" placeholder="The same password again" autocomplete="new-password">
          <button class="btn btn-primary" data-action="change_own_password">Save password</button>
          <div class="field-help">After saving, this password is kept for the next live tunnels.</div>
        </div>
      </div>
    </div>
  `;
}

function scheduleScreenWarmup() {
  const run = () => {
    if (STATE.currentScreen === 'grading_beginner') preloadNextVisualAssets();
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 600 });
  else setTimeout(run, 80);
}

function preloadNextVisualAssets() {
  const grading = STATE.currentGrading;
  if (!grading) return;
  const onderdelen = getGradingOnderdelen();
  onderdelen
    .slice(grading.huidigeIndex + 1, grading.huidigeIndex + 3)
    .forEach(preloadVisualAssetsForComponent);
}

function preloadVisualAssetsForComponent(component) {
  const assets = component && VISUAL_ASSETS[component.id];
  if (!assets) return;
  Object.values(assets).forEach(preloadImageAsset);
}

function preloadImageAsset(src) {
  if (!src || preloadedVisualAssets.has(src)) return;
  preloadedVisualAssets.add(src);
  const img = new Image();
  img.decoding = 'async';
  if ('fetchPriority' in img) img.fetchPriority = 'low';
  img.src = src;
}

// Logisch "vorige scherm" per pagina, zodat elke pagina een consistente
// ← Terug-knop krijgt. Grading/resultaat/apparaat-info gaan via back_scan terug
// naar het scanscherm (dat wist ook de lopende grading). Onbekende/vaste
// schermen (home, login, wachtwoord wijzigen) geven null: geen terug-knop.
function getScreenBackAction(screen) {
  const map = {
    sticker_scan: 'home',
    scan: 'home',
    manual: 'home',
    monitor_label_scan: 'home',
    monitor_manual: 'monitor_label_scan',
    test_start: 'home',
    import: 'home',
    accounts: 'home',
    explain: 'home',
    analytics: 'home',
    history: 'analytics',
    laptop_info: 'back_scan',
    grading_beginner: 'back_scan',
    grading_expert: 'back_scan',
    result: 'back_scan',
  };
  return map[screen] || null;
}

function renderTopbar() {
  const u = STATE.currentUser;
  const backAction = getScreenBackAction(STATE.currentScreen);
  return `
    <div class="topbar">
      <div>
        <div class="topbar-title">ReMarkt</div>
        ${u ? `<div class="topbar-user">${escapeHtml(getScreenTitle())} · ${escapeHtml(u.naam)} · ${escapeHtml(displayUserRole(u.rol))}</div>` : ''}
      </div>
      <div class="topbar-actions">
        ${renderOptionalLanguageToggle()}
        ${renderThemeToggle()}
        ${renderContrastToggle()}
        ${backAction ? `<button class="btn-icon" data-action="${backAction}">← Back</button>` : ''}
        ${backAction && backAction !== 'home' ? '<button class="btn-icon" data-action="home">Home</button>' : ''}
        <button class="btn-icon" data-action="logout">Sign out</button>
      </div>
    </div>
  `;
}

function renderOptionalLanguageToggle() {
  return typeof renderLanguageToggle === 'function' ? renderLanguageToggle() : '';
}

// Contrast-icoon: open cirkel (normaal) vs half-gevulde cirkel (hoog contrast).
// De gevulde helft heeft een eigen fill zodat de .preference-option svg-regel
// (fill:none) hem niet wegneemt.
function uiContrastIcon(level) {
  const half = level === 'high' ? '<path d="M11 4a7 7 0 0 1 0 14z" fill="currentColor" stroke="none"/>' : '';
  return `<svg class="contrast-icon" viewBox="0 0 22 22" aria-hidden="true"><circle cx="11" cy="11" r="7"/>${half}</svg>`;
}

function renderContrastToggle() {
  const current = STATE.contrast === 'high' ? 'high' : 'normal';
  const isDutch = typeof getLanguagePreference === 'function' ? getLanguagePreference() === 'nl' : false;
  const options = [
    { value: 'normal', label: isDutch ? 'Normaal contrast' : 'Normal contrast' },
    { value: 'high', label: isDutch ? 'Hoog contrast' : 'High contrast' },
  ];
  return `
    <div class="preference-switch contrast-toggle" role="group" aria-label="Contrast" data-i18n-skip="true">
      ${options.map(option => `
        <button class="preference-option icon-option ${current === option.value ? 'active' : ''}" data-action="toggle_contrast" data-contrast-value="${option.value}" type="button" aria-pressed="${current === option.value ? 'true' : 'false'}" title="${option.label}" aria-label="${option.label}">
          ${uiContrastIcon(option.value)}
        </button>
      `).join('')}
    </div>
  `;
}

function renderThemeToggle() {
  const currentTheme = STATE.theme === 'dark' ? 'dark' : 'light';
  const isDutch = typeof getLanguagePreference === 'function' ? getLanguagePreference() === 'nl' : true;
  const labels = isDutch
    ? { group: 'Themakeuze', light: 'Licht', dark: 'Donker' }
    : { group: 'Theme switch', light: 'Light', dark: 'Dark' };
  const options = [
    { value: 'light', label: labels.light, icon: 'sun' },
    { value: 'dark', label: labels.dark, icon: 'moon' },
  ];
  return `
    <div class="preference-switch theme-toggle" role="group" aria-label="${labels.group}" data-i18n-skip="true">
      ${options.map(option => `
        <button class="preference-option icon-option ${currentTheme === option.value ? 'active' : ''}" data-action="toggle_theme" data-theme-value="${option.value}" type="button" aria-pressed="${currentTheme === option.value ? 'true' : 'false'}" title="${option.label}" aria-label="${option.label}">
          ${uiIcon(option.icon)}
        </button>
      `).join('')}
    </div>
  `;
}

function renderAppMessage() {
  if (!STATE.appMessage) return '';
  return `
    <div class="app-alert ${STATE.appMessage.type === 'success' ? 'success' : ''}">
      <span>${escapeHtml(STATE.appMessage.text)}</span>
      <button type="button" data-action="dismiss_message">Close</button>
    </div>
  `;
}

function renderDecisionModal(decision) {
  const hasImages = decision.options.some(option => option.image);
  const optionCountClass = hasImages ? `options-${decision.options.length}` : '';
  return `
    <div class="decision-inline" role="dialog" aria-modal="true" aria-label="${escapeHtml(decision.title)}">
      <div class="modal ${decision.type === 'grade-review' ? 'grade-review' : ''} ${hasImages ? 'image-decision' : ''} ${optionCountClass}">
        <h3>${escapeHtml(decision.title)}</h3>
        <p>${escapeHtml(decision.text)}</p>
        <div class="decision-options">
          ${decision.options.map((option, index) => `
            <button class="decision-option ${option.image ? 'has-image' : ''}" data-decision-option="${index}" type="button">
              ${option.image ? `
                <span class="decision-image-wrap">
                  <img src="${escapeHtml(option.image)}" alt="${escapeHtml(option.label)} example" loading="eager" decoding="async" fetchpriority="high" width="640" height="426">
                  <span class="decision-zoom-action" data-image-preview="true" data-preview-src="${escapeHtml(option.image)}" data-preview-label="${escapeHtml(option.label)}" role="button" aria-label="Zoom image" title="Zoom image" onpointerdown="openImagePreviewFromElement(this); return false;" ontouchstart="openImagePreviewFromElement(this); return false;" onclick="openImagePreviewFromElement(this); return false;">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="5.5"></circle><path d="M15 15l5 5"></path></svg>
                    <span>Zoom</span>
                  </span>
                </span>
              ` : ''}
              <span class="decision-option-copy">
                <strong>${escapeHtml(option.label)}</strong>
                ${option.detail ? `<span>${escapeHtml(option.detail)}</span>` : ''}
              </span>
            </button>
          `).join('')}
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" data-action="cancel_decision">Back</button>
        </div>
      </div>
    </div>
  `;
}

function getScreenTitle() {
  const titles = {
    home: 'ReMarkt Grading',
    sticker_scan: 'Label Scan',
    monitor_label_scan: 'Label Scan',
    monitor_manual: 'Monitor Manual Entry',
    scan: 'Device Scan',
    manual: 'Manual Entry',
    test_start: 'Test Grading',
    import: 'Batch Import',
    accounts: 'User Management',
    laptop_info: 'Device Review',
    grading_beginner: 'Grading',
    grading_expert: 'Expert Grading',
    result: 'Grading Result',
    history: 'History',
    analytics: 'Insights',
    explain: 'Grade Rules',
  };
  if (isStickerUser() && STATE.currentScreen === 'home') return 'Labeling';
  if (STATE.currentScreen === 'sticker_scan') return 'Label Scan';
  if (isStickerUser() && STATE.currentScreen === 'laptop_info') return 'Label Scan';
  return titles[STATE.currentScreen] || 'ReMarkt';
}

function uiIcon(name) {
  const icons = {
    scan: '<path d="M4 7V5a1 1 0 0 1 1-1h2"/><path d="M14 4h2a1 1 0 0 1 1 1v2"/><path d="M17 14v2a1 1 0 0 1-1 1h-2"/><path d="M7 17H5a1 1 0 0 1-1-1v-2"/><path d="M7 9h10"/><path d="M7 12h10"/>',
    gradeScan: '<rect x="4" y="5" width="14" height="10" rx="1.5"/><path d="M8 19h6"/><path d="M11 15v4"/><path d="M7.5 10.5l2.2 2.1 4.8-5.1"/>',
    labelPrint: '<path d="M7 8V4h8v4"/><rect x="5" y="8" width="12" height="7" rx="1.5"/><path d="M8 14h6v4H8z"/><path d="M8 11h.01"/><path d="M10 17h4"/>',
    inspectParts: '<path d="M4 5h14v12H4z"/><path d="M7 8h4"/><path d="M7 11h7"/><path d="M7 14h3"/><circle cx="15.5" cy="14.5" r="3"/><path d="M18 17l2 2"/>',
    confirmGrade: '<path d="M5 5h12v12H5z"/><path d="M8 11.5l2.2 2.2L15 8.8"/><path d="M8 18h6"/>',
    complete: '<circle cx="11" cy="11" r="7"/><path d="M7.8 11.2l2.1 2.1 4.4-4.8"/>',
    manualEntry: '<path d="M5 15l-.5 3 3-.5L16 9l-2.5-2.5L5 15z"/><path d="M12.5 7.5l2.5 2.5"/><path d="M5 20h13"/>',
    testGrade: '<path d="M7 4h8"/><path d="M9 4v5l-4 7a2 2 0 0 0 1.7 3h8.6A2 2 0 0 0 17 16l-4-7V4"/><path d="M8 14h6"/>',
    workflow: '<path d="M5 6h5v5H5z"/><path d="M13 13h5v5h-5z"/><path d="M10 8.5h3.5a2 2 0 0 1 2 2V13"/><path d="M13 15.5H9a2 2 0 0 1-2-2V11"/>',
    edit: '<path d="M5 15l-.5 3 3-.5L16 9l-2.5-2.5L5 15z"/><path d="M12.5 7.5l2.5 2.5"/>',
    history: '<path d="M6 4h9l3 3v11H6z"/><path d="M14 4v4h4"/><path d="M9 11h6"/><path d="M9 14h6"/>',
    import: '<path d="M6 4h8l4 4v10H6z"/><path d="M14 4v4h4"/><path d="M12 10v5"/><path d="M9.5 12.5L12 15l2.5-2.5"/>',
    users: '<path d="M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M5 18c.8-2.8 3.1-4.2 7-4.2s6.2 1.4 7 4.2"/>',
    accountKey: '<circle cx="8" cy="9" r="3"/><path d="M3.5 18c.7-2.4 2.2-3.6 4.5-3.6 1.4 0 2.5.4 3.3 1.2"/><path d="M14 15h5"/><path d="M17 12v6"/><path d="M19 15l1.5 1.5"/>',
    grade: '<path d="M5 17V5h12v12z"/><path d="M8 9h8"/><path d="M8 13h5"/><path d="M5 17l-2 3"/><path d="M17 17l2 3"/>',
    explain: '<path d="M5 5h11a2 2 0 0 1 2 2v11H7a2 2 0 0 1-2-2z"/><path d="M8 8h7"/><path d="M8 11h5"/><path d="M8 14h3"/>',
    analytics: '<path d="M4 18h15"/><path d="M6 15l3-4 3 2 5-7"/><path d="M6 15v3"/><path d="M12 13v5"/><path d="M17 6v12"/>',
    support: '<path d="M12 4v3"/><path d="M12 15v3"/><path d="M6.8 6.8l2.1 2.1"/><path d="M15.1 15.1l2.1 2.1"/><path d="M4 12h3"/><path d="M15 12h3"/><circle cx="12" cy="12" r="3"/>',
    settings: '<path d="M12 4v2"/><path d="M12 16v2"/><path d="M5.1 8l1.7 1"/><path d="M17.2 15l1.7 1"/><path d="M5.1 16l1.7-1"/><path d="M17.2 9l1.7-1"/><circle cx="12" cy="12" r="3"/>',
    uploadSheet: '<path d="M6 4h8l4 4v10H6z"/><path d="M14 4v4h4"/><path d="M12 16v-5"/><path d="M9.5 13.5L12 11l2.5 2.5"/>',
    sun: '<circle cx="11" cy="11" r="4"/><path d="M11 2v2"/><path d="M11 18v2"/><path d="M2 11h2"/><path d="M18 11h2"/><path d="M4.6 4.6 6 6"/><path d="M16 16l1.4 1.4"/><path d="M17.4 4.6 16 6"/><path d="M6 16l-1.4 1.4"/>',
    moon: '<path d="M17 14.5A7 7 0 0 1 8.5 6a6 6 0 1 0 8.5 8.5z"/>',
    monitor: '<rect x="4" y="5" width="14" height="10" rx="1.5"/><path d="M9 19h4"/><path d="M11 15v4"/>'
  };
  return `<svg viewBox="0 0 22 22" aria-hidden="true">${icons[name] || icons.scan}</svg>`;
}

function renderWorkflowRoute() {
  // Decoratieve route-illustraties verwijderd op verzoek — de actiekaarten en de
  // navigatiebalk doen dit werk nu duidelijker. Functie behouden voor bestaande
  // aanroepen.
  return '';
}

function renderWorkflowRouteLegacy(mode = 'grading', placement = '') {
  const isLabelFlow = mode === 'label';
  const isMonitorFlow = mode === 'monitor';
  const steps = isMonitorFlow
    ? [
        { title: 'Supplier batch', detail: 'Import or select the monitor delivery list' },
        { title: 'Scan monitor', detail: 'Scan the barcode on the monitor' },
        { title: 'Check ports', detail: 'Verify HDMI, DP, VGA, DVI or USB-C' },
        { title: 'Choose grade', detail: 'Pick A, B, C or X after the scan' },
        { title: 'Print label', detail: 'Print the monitor label automatically' },
        { title: 'Complete intake', detail: 'Move the monitor to the right cart' },
      ]
    : isLabelFlow
    ? [
        { title: 'Scan barcode', detail: 'Select the device from the active batch' },
        { title: 'Print specifications label', detail: 'Grade line stays empty for later completion' },
        { title: 'Complete registration', detail: 'Device is closed in the digital workflow' },
      ]
    : [
        { title: 'Scan barcode', detail: 'Select the device from the active batch' },
        { title: 'Check exterior', detail: 'Lid, underside, corners and stickers' },
        { title: 'Test key parts', detail: 'Screen, keyboard, touchpad and hinges' },
        { title: 'Determine grade', detail: 'Choose A, B, C or X using the grading rules' },
        { title: 'Print labels', detail: 'Print specifications and repair labels when required' },
        { title: 'Sort device', detail: 'Route to repair, sales stock or review' },
        { title: 'Ready for stock', detail: 'Registration is complete and traceable' },
      ];
  const image = isMonitorFlow ? 'assets/workflow-monitor-route-6-step-ai.png' : isLabelFlow ? 'assets/workflow-label-scan-banner.png' : 'assets/workflow-route-process-banner.png';
  const title = isMonitorFlow ? 'Label Scan route' : isLabelFlow ? 'Label-only route' : 'Complete grading route';
  const alt = isMonitorFlow ? 'Monitor label scan route illustration' : isLabelFlow ? 'Label scan route illustration' : 'Full grading route illustration';

  return `
    <section class="workflow-route-card workflow-route-illustrated ${isMonitorFlow ? 'monitor-route-card' : ''} ${placement === 'dashboard' ? 'dashboard-route' : ''}" aria-label="Workflow route">
      <div class="workflow-route-head">
        <span class="ops-section-title">Route</span>
        <strong>${title}</strong>
      </div>
      <div class="workflow-route-banner">
        <img src="${image}" alt="${alt}" loading="eager" decoding="async" fetchpriority="high">
      </div>
      <div class="workflow-route-labels route-steps-${steps.length}">
        ${steps.map((step, index) => `
          <div class="workflow-route-label">
            <span>${index + 1}</span>
            <div>
              <strong>${step.title}</strong>
              <span>${step.detail}</span>
            </div>
          </div>
        `).join('')}
      </div>
    </section>
  `;
}

function renderWorkflowIntroBanner() {
  // Intro-banner met illustratie verwijderd op verzoek (rommelig/niet mooi).
  return '';
}

function renderWorkflowIntroBannerLegacy(type) {
  const banners = {
    grade: {
      image: 'assets/workflow-grade-device-banner.png',
      title: 'Grade Device',
      text: 'Use this workflow for devices from an active batch. Scan the barcode, check each required part and save the final grade before printing labels.',
      steps: ['Scan barcode', 'Check parts', 'Save final grade', 'Print labels'],
    },
    label: {
      image: 'assets/workflow-label-scan-banner.png',
      title: 'Label Scan',
      text: 'Use Label Scan when only a specifications label is needed. The grade line stays empty and the device is completed digitally.',
      steps: ['Scan barcode', 'Print specifications label', 'Complete registration'],
    },
    monitor: {
      image: 'assets/workflow-monitor-label-scan-ai-v2.png',
      title: 'Label Scan',
      text: 'Use Label Scan for monitor batches. Scan or select the monitor first, then choose A, B, C or X and print a label with device name, grade and video inputs.',
      steps: ['Scan monitor', 'Choose grade', 'Print label', 'Complete registration'],
    },
    'monitor-manual': {
      image: 'assets/workflow-monitor-manual-entry-ai.png',
      title: 'Manual entry',
      text: 'Use this for loose monitors or when the scan is incorrect. Enter brand and model (required), check video in and optional specifications, then choose the correct grade for the label.',
      steps: ['Enter brand and model', 'Check video in', 'Choose grade', 'Print label'],
    },
    manual: {
      image: 'assets/workflow-manual-entry-banner.png',
      title: 'Manual Entry',
      text: 'Use Manual Entry for returns, loose stock or devices without a supplier batch. Add the specifications first, then continue with the normal grading check.',
      steps: ['Enter device details', 'Add specifications', 'Start grading'],
    },
    test: {
      image: 'assets/workflow-test-grading-banner.png',
      title: 'Test Grading',
      text: 'Use Test Grading to practise the process and verify grading rules. It does not change stock, history or labels.',
      steps: ['Practise the flow', 'Check grading rules', 'Preview the result'],
    },
  };
  const banner = banners[type];
  if (!banner) return '';
  return `
    <section class="workflow-intro-banner ${type}-intro">
      <div class="workflow-intro-copy">
        <span class="ops-section-title">${banner.title}</span>
        <p>${banner.text}</p>
        <div class="workflow-intro-steps">
          ${banner.steps.map((step, index) => `<span><strong>${index + 1}</strong>${step}</span>`).join('')}
        </div>
      </div>
      <img src="${banner.image}" alt="${banner.title} process illustration" loading="eager" decoding="async" fetchpriority="high">
    </section>
  `;
}

function getMonitorGradeOptions() {
  return [
    {
      grade: 'A',
      label: 'A-grade',
      title: 'Light signs of use',
      detail: 'Small scratches or light marks. The monitor is tidy and fully sound in terms of hardware.',
    },
    {
      grade: 'B',
      label: 'B-grade',
      title: 'Clear signs of use',
      detail: 'More signs of use than A-grade, such as deeper scratches and/or small dents.',
    },
    {
      grade: 'C',
      label: 'C-grade',
      title: 'Heavy signs of use',
      detail: 'Deeper scratches, larger dents or possible cracks in the housing. The monitor works 100% in terms of hardware.',
    },
    {
      grade: 'D',
      label: 'X-grade',
      title: 'Defective or repair',
      detail: 'Pixel line, dead pixels, cracked screen, screen flicker, cracks larger than a thumb, no power or faulty video ports.',
    },
  ];
}

function getMonitorDeviceErrorSignals(monitor) {
  if (!monitor) return [];
  const notes = normalizeText(monitor.meldingen);
  if (!notes) return [];
  const parts = notes
    .split(/[;,|]+/)
    .map(part => sanitizeExternalText(part, 180))
    .filter(isUsefulMonitorDeviceError);
  const signals = parts.length
    ? parts
    : (isUsefulMonitorDeviceError(notes) ? [sanitizeExternalText(notes, 220)] : []);
  return Array.from(new Set(signals)).slice(0, 5);
}

function isUsefulMonitorDeviceError(value) {
  const text = sanitizeExternalText(value, 220);
  if (!text) return false;
  const normalized = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!normalized) return false;
  const ignored = [
    /^functional unit$/,
    /^functionele unit$/,
    /^fully functional$/,
    /^unit functional$/,
    /^working$/,
    /^works$/,
    /^tested ok$/,
    /^test ok$/,
    /^passed$/,
    /^pass$/,
    /^not refurbished$/,
    /^niet refurbished$/,
    /^not cleaned$/,
    /^niet gereinigd$/,
    /^no error$/,
    /^no errors$/,
    /^geen error$/,
    /^geen errors$/,
    /^geen fouten$/,
    /^no defects?$/,
    /^geen defect(en)?$/,
  ];
  if (ignored.some(pattern => pattern.test(normalized))) return false;
  if (/^(functional unit|functionele unit) (not refurbished|niet refurbished)$/.test(normalized)) return false;

  const usefulTerms = /(scratch|scratches|kras|krassen|dent|dents|deuk|deuken|crack|cracked|barst|barsten|broken|breuk|gebroken|defect|faulty|kapot|pixel|pixels|dead|line|lijn|stre(e)?p|flicker|flikker|no power|geen power|power issue|burn|burn-in|inbrand|white spot|bright spot|dark spot|spot|vlek|pressure|drukplek|bleeding|backlight|scherm|screen|display|panel|bezel|frame|kap|casing|voet|stand|missing|ontbreekt|poort|port|hdmi|displayport|dp|dvi|vga|button|knop|cable|kabel)/i;
  return usefulTerms.test(text);
}

function getMonitorDeviceErrorNotice(monitor) {
  const signals = getMonitorDeviceErrorSignals(monitor);
  if (!signals.length) return null;
  return {
    title: 'Note: supplier notice',
    detail: 'Check these Device Errors before you choose the final ReMarkt grade.',
    signals,
  };
}

function stripMonitorBrandFromModel(model, brand) {
  const cleanModel = sanitizeExternalText(model, 180);
  const cleanBrand = sanitizeExternalText(brand, 80);
  if (!cleanModel || !cleanBrand) return cleanModel;
  const pattern = new RegExp(`^${cleanBrand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+`, 'i');
  return cleanModel.replace(pattern, '').trim() || cleanModel;
}

function renderMonitorIdentityChoiceModal(monitor) {
  if (!monitor) return '';
  const options = normalizeMonitorIdentityOptions(monitor.identityOptions);
  if (options.length < 2) return '';
  const currentName = monitor.deviceName || `${monitor.merk || ''} ${monitor.model || ''}`.trim() || 'Monitor';
  return `
    <div class="monitor-grade-overlay" role="dialog" aria-modal="true" aria-label="Choose the correct monitor name">
      <div class="monitor-grade-modal monitor-identity-modal">
        <div class="monitor-grade-modal-head">
          <div>
            <span class="ops-section-title">Monitor Check</span>
            <h3>Choose the correct monitor name</h3>
            <p>${escapeHtml(currentName)} · Barcode ${escapeHtml(monitor.sticker)}</p>
          </div>
          <button class="btn btn-secondary" data-action="monitor_scan_reset" type="button">Other monitor</button>
        </div>
        <div class="monitor-identity-warning">
          This barcode has two different monitor names in the supplier list. Choose which monitor is physically on the workbench before you choose the grade.
        </div>
        <div class="monitor-identity-options">
          ${options.map((option, index) => `
            <button class="monitor-identity-option" data-monitor-identity-choice="${index}" type="button">
              <span class="monitor-identity-source">${escapeHtml(option.source)}</span>
              <strong>${escapeHtml(option.deviceName)}</strong>
              <span class="monitor-identity-meta">Model ${escapeHtml(option.model || option.deviceName)} · Video in ${escapeHtml(option.videoInputs || 'unknown')}</span>
              ${option.monitorDatabaseModel ? `<small>Database match: ${escapeHtml(option.monitorDatabaseModel)}</small>` : ''}
            </button>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

function renderMonitorGradeChoiceModal(monitor) {
  if (!monitor) return '';
  const deviceName = monitor.deviceName || `${monitor.merk} ${monitor.model}`.trim() || 'Monitor';
  const brandName = monitor.merk || deviceName.split(' ')[0] || 'Unknown';
  const modelName = stripMonitorBrandFromModel(monitor.model || deviceName, brandName) || deviceName;
  const canChangeIdentity = Array.isArray(monitor.identityOptions) && monitor.identityOptions.length > 1;
  const supplierNotice = getMonitorDeviceErrorNotice(monitor);
  const knownPorts = typeof getMonitorEffectiveVideoInputs === 'function' ? getMonitorEffectiveVideoInputs(monitor) : (monitor.videoInputs || '');
  const portVisuals = renderMonitorPortVisuals(knownPorts);
  const isPrinting = STATE.monitorPrintInProgress === true;
  return `
    <div class="monitor-grade-overlay image-preview-overlay" role="dialog" aria-modal="true" aria-label="Choose monitor grade" style="position:fixed;top:0;right:0;bottom:0;left:0;z-index:1300;background:rgba(23,23,23,0.72);display:flex;align-items:center;justify-content:center;padding:16px;overflow:hidden;overscroll-behavior:contain;">
      <div class="monitor-grade-modal image-preview-modal" style="display:block;width:920px;max-width:calc(100% - 32px);max-height:calc(100vh - 32px);margin:0;border-radius:10px;box-shadow:0 24px 80px rgba(0,0,0,0.34);overflow:visible;">
        <div class="monitor-grade-modal-head">
          <div>
            <span class="ops-section-title">Monitor Grade</span>
            <h3>Choose the grade</h3>
            <p>Barcode ${escapeHtml(monitor.sticker)}</p>
          </div>
          <div class="monitor-grade-actions">
            ${canChangeIdentity ? `<button class="btn btn-secondary" data-action="monitor_identity_reset" type="button" ${isPrinting ? 'disabled aria-disabled="true"' : ''}>Choose different name</button>` : ''}
            <button class="btn btn-secondary" data-action="monitor_manual_from_current" type="button" ${isPrinting ? 'disabled aria-disabled="true"' : ''}>Correct details</button>
            <button class="btn btn-secondary" data-action="monitor_scan_reset" type="button" ${isPrinting ? 'disabled aria-disabled="true"' : ''}>Other monitor</button>
          </div>
        </div>
        <div class="monitor-grade-overview">
          <div class="monitor-grade-fact monitor-grade-fact-hero">
            <span>Brand</span>
            <strong>${escapeHtml(brandName)}</strong>
          </div>
          <div class="monitor-grade-fact">
            <span>Model</span>
            <strong>${escapeHtml(modelName)}</strong>
          </div>
          <div class="monitor-grade-fact important monitor-grade-video-banner${portVisuals ? '' : ' monitor-grade-video-banner-editable'}">
            <div class="monitor-grade-video-copy">
              <span>Video in</span>
              <strong>Ports</strong>
              <small>${portVisuals ? 'Check the type and number of connections.' : 'Unknown — click the correct connections below; they will appear on the label.'}</small>
            </div>
            ${portVisuals ? portVisuals : `
              <div class="monitor-grade-port-editor" data-monitor-grade-port-editor="true">
                ${renderMonitorManualPortPicker('')}
              </div>
            `}
          </div>
        </div>
        ${supplierNotice ? `
          <div class="monitor-supplier-notice">
            <span class="monitor-supplier-badge">Device Errors</span>
            <strong>${escapeHtml(supplierNotice.title)}</strong>
            <span>${escapeHtml(supplierNotice.detail)}</span>
            <ul>
              ${supplierNotice.signals.map(signal => `<li>${escapeHtml(signal)}</li>`).join('')}
            </ul>
          </div>
        ` : ''}
        <div class="monitor-grade-section-head">
          <strong>Choose final ReMarkt grade</strong>
          <span>${isPrinting ? 'The monitor label is being printed and saved live.' : 'After your choice the monitor label is printed immediately.'}</span>
        </div>
        <div class="monitor-grade-rule-grid">
          ${getMonitorGradeOptions().map(option => `
            <button class="monitor-grade-button grade-${option.grade}" data-monitor-print-grade="${option.grade}" type="button" aria-label="${escapeHtml(`${option.label}: ${option.detail}`)}" ${isPrinting ? 'disabled aria-disabled="true"' : ''}>
              <span class="monitor-grade-letter">${option.grade === 'D' ? 'X' : option.grade}</span>
              <span class="monitor-grade-copy"><strong>${escapeHtml(option.label)}</strong></span>
              <span class="monitor-grade-info" data-monitor-grade-info="${option.grade}" role="button" aria-expanded="${STATE.monitorGradeInfoOpen === option.grade ? 'true' : 'false'}" aria-label="${escapeHtml(`${option.title}: ${option.detail}`)}">i</span>
              <span class="monitor-grade-info-panel ${STATE.monitorGradeInfoOpen === option.grade ? 'is-open' : ''}" data-monitor-grade-info-panel="${option.grade}" aria-hidden="${STATE.monitorGradeInfoOpen === option.grade ? 'false' : 'true'}">
                <strong>${escapeHtml(option.title)}</strong>
                <span>${escapeHtml(option.detail)}</span>
              </span>
              <em>${isPrinting && STATE.monitorSelectedGrade === option.grade ? 'Working...' : 'Print label'}</em>
            </button>
          `).join('')}
        </div>
        <p class="monitor-grade-print-note">${isPrinting ? 'Please wait until the print dialog and live saving are finished.' : 'After you choose the grade, the app automatically prints the monitor label.'}</p>
      </div>
    </div>
  `;
}

function renderMonitorPortVisuals(videoInputs) {
  const text = normalizeText(videoInputs);
  if (!text) return '';
  const portMap = new Map();
  text
    .split(/\s*\/\s*|,|;|\|/)
    .map(part => sanitizeExternalText(part, 60))
    .forEach(part => {
      const port = getMonitorPortDescriptor(part);
      if (!port) return;
      const count = getMonitorPortCount(part);
      const existing = portMap.get(port.label);
      if (existing) existing.count += count;
      else portMap.set(port.label, { ...port, count });
  });
  const uniquePorts = Array.from(portMap.values());
  if (!uniquePorts.length) return '';
  return `<div class="monitor-port-visuals">${uniquePorts.slice(0, 6).map(port => `
    <span class="monitor-port-tile port-${escapeHtml(port.key)}">
      <img class="monitor-port-art" src="${escapeHtml(getMonitorPortImage(port.key))}" alt="" aria-hidden="true" loading="eager" decoding="async">
      <span class="monitor-port-chip"><strong class="monitor-port-count">${escapeHtml(`${port.count}x`)}</strong><span>${escapeHtml(port.label)}</span></span>
    </span>
  `).join('')}</div>`;
}

function getMonitorManualPortOptions() {
  return [
    { label: 'HDMI', value: 'HDMI' },
    { label: 'DP', value: 'DisplayPort' },
    { label: 'Mini DP', value: 'Mini DisplayPort' },
    { label: 'DVI', value: 'DVI' },
    { label: 'VGA', value: 'VGA' },
    { label: 'USB-C', value: 'USB-C' },
    { label: 'Thunderbolt', value: 'Thunderbolt' },
  ];
}

function getMonitorManualPortCounts(videoInputs) {
  const counts = {};
  getMonitorManualPortOptions().forEach(option => { counts[option.value] = 0; });
  const text = normalizeText(videoInputs);
  if (!text) return counts;
  text
    .split(/\s*\/\s*|,|;|\|/)
    .map(part => sanitizeExternalText(part, 60))
    .forEach(part => {
      const descriptor = getMonitorPortDescriptor(part);
      if (!descriptor) return;
      const option = getMonitorManualPortOptions().find(item => item.label === descriptor.label || item.key === descriptor.key);
      if (!option) return;
      counts[option.value] = Math.min(4, (counts[option.value] || 0) + getMonitorPortCount(part));
    });
  return counts;
}

function getMonitorManualPortSelections(videoInputs) {
  const counts = getMonitorManualPortCounts(videoInputs);
  return getMonitorManualPortOptions()
    .map(option => ({ port: option.value, label: option.label, count: Math.min(2, Number(counts[option.value] || 0)) }));
}

function renderMonitorManualPortPicker(videoInputs) {
  const selections = getMonitorManualPortSelections(videoInputs);
  return `
    <div class="monitor-manual-port-picker" aria-label="Choose video in ports">
      ${selections.map(selection => `
        <div class="monitor-manual-port-option">
          <span>${escapeHtml(selection.label)}</span>
          <div class="monitor-manual-port-row">
            <input type="hidden" data-monitor-video-port-count-select data-monitor-video-port="${escapeHtml(selection.port)}" value="${escapeHtml(String(selection.count))}">
            <div class="monitor-manual-port-buttons" role="group" aria-label="${escapeHtml(`${selection.label} count`)}">
              ${[0, 1, 2].map(count => `
                <button class="monitor-manual-port-count-button ${selection.count === count ? 'active' : ''}" type="button" data-monitor-video-port-count-button data-port="${escapeHtml(selection.port)}" data-count="${count}" aria-pressed="${selection.count === count ? 'true' : 'false'}">${count}x</button>
              `).join('')}
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderMonitorManualDatabaseLists(merkValue = '', serieValue = '', modelValue = '') {
  const brands = typeof getMonitorManualBrandSuggestions === 'function' ? getMonitorManualBrandSuggestions(merkValue, 80) : [];
  const series = typeof getMonitorManualSeriesSuggestions === 'function' ? getMonitorManualSeriesSuggestions(merkValue, serieValue, 60) : [];
  const models = typeof getMonitorManualModelSuggestions === 'function' ? getMonitorManualModelSuggestions(merkValue, serieValue, modelValue, 80) : [];
  return `
    <datalist id="monitorManualBrandSuggestions">
      ${brands.map(brand => `<option value="${escapeHtml(brand)}"></option>`).join('')}
    </datalist>
    <datalist id="monitorManualSeriesSuggestions">
      ${series.map(seriesName => `<option value="${escapeHtml(seriesName)}"></option>`).join('')}
    </datalist>
    <datalist id="monitorManualModelSuggestions">
      ${models.map(model => `<option value="${escapeHtml(model)}"></option>`).join('')}
    </datalist>
  `;
}

function renderMonitorDisplaySizeOptions(selectedDisplay) {
  const selected = String(selectedDisplay || '').match(/\d{2}/);
  const selectedValue = selected ? selected[0] : '';
  const options = ['<option value="">Choose screen size</option>'];
  for (let inch = 17; inch <= 55; inch += 1) {
    // Waarde is de kale inch (zonder "-teken): een letterlijke " in een
    // dubbel-quoted attribuut breekt het attribuut af, waardoor de waarde
    // "24 in plaats van 24" werd en autofill/opslag misging. formatDisplay()
    // maakt er bij opslaan weer 24" van.
    options.push(`<option value="${inch}" ${selectedValue === String(inch) ? 'selected' : ''}>${inch} inch</option>`);
  }
  return options.join('');
}

function getMonitorPortDescriptor(part) {
  if (/mini\s*display\s*port|mini\s*dp/i.test(part)) return { label: 'Mini DP', key: 'dp' };
  if (/display\s*port|displayport|display\s*poort|displaypoort|\bdp\b/i.test(part)) return { label: 'DP', key: 'dp' };
  if (/hdmi/i.test(part)) return { label: 'HDMI', key: 'hdmi' };
  if (/dvi/i.test(part)) return { label: 'DVI', key: 'dvi' };
  if (/vga|d-sub/i.test(part)) return { label: 'VGA', key: 'vga' };
  if (/usb[\s-]*c|type[\s-]*c/i.test(part)) return { label: 'USB-C', key: 'usb-c' };
  if (/thunderbolt/i.test(part)) return { label: 'TB', key: 'tb' };
  return null;
}

function getMonitorPortCount(part) {
  const before = part.match(/(?:^|\s)(\d{1,2})\s*[x×]\s*(?=mini|display|dp\b|hdmi|dvi|vga|d-sub|usb|type|thunderbolt)/i);
  const after = part.match(/(?:mini\s*display\s*port|mini\s*dp|display\s*port|displayport|display\s*poort|displaypoort|\bdp\b|hdmi|dvi|vga|d-sub|usb[\s-]*c|type[\s-]*c|thunderbolt).*?(?:\s|^)[x×]\s*(\d{1,2})(?:\s|$)/i);
  const value = Number((before && before[1]) || (after && after[1]) || 1);
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.min(value, 9);
}

function getMonitorPortImage(key) {
  const images = {
    hdmi: 'assets/monitor-port-hdmi-clean-ai.png?v=20260521-aiports',
    dp: 'assets/monitor-port-dp-clean-ai.png?v=20260521-aiports',
    dvi: 'assets/monitor-port-dvi-clean-ai.png?v=20260521-aiports',
    vga: 'assets/monitor-port-vga-clean-ai.png?v=20260521-aiports',
    'usb-c': 'assets/monitor-port-usb-c-clean-ai.png?v=20260521-aiports',
    tb: 'assets/monitor-port-tb-clean-ai.png?v=20260521-aiports',
  };
  return images[key] || images.hdmi;
}

function getDashboardData() {
  const isAdmin = isAdminUser();
  const items = isAdmin ? STATE.history : STATE.history.filter(h => h.user_id === STATE.currentUser.id);
  const counts = { A: 0, B: 0, C: 0, D: 0 };
  items.forEach(item => {
    if (counts[item.grade] !== undefined) counts[item.grade]++;
  });
  const totalSec = items.reduce((sum, item) => sum + Number(item.duurSec || 0), 0);
  const avg = items.length ? Math.round(totalSec / items.length) : 0;
  const allLaptops = getAllLaptops();
  const openCount = getOpenLaptops().length;
  const completedCount = Math.max(allLaptops.length - openCount, 0);
  const stickerOpenCount = getStickerOpenLaptops().length;
  const stickerCompletedCount = Math.max(allLaptops.length - stickerOpenCount, 0);
  const allMonitors = getAllMonitors();
  const monitorOpenCount = getOpenMonitors().length;
  const monitorCompletedCount = Math.max(allMonitors.length - monitorOpenCount, 0);
  const monitorItems = isAdmin ? STATE.monitorLabelPrints : STATE.monitorLabelPrints.filter(item => item.user_id === STATE.currentUser.id);
  const monitorCounts = { A: 0, B: 0, C: 0, D: 0 };
  monitorItems.forEach(item => {
    const grade = normalizeMonitorGrade(item.grade);
    if (monitorCounts[grade] !== undefined) monitorCounts[grade]++;
  });
  const latest = items[items.length - 1];
  const monitorLatest = monitorItems[monitorItems.length - 1];
  const maxGradeCount = Math.max(counts.A, counts.B, counts.C, counts.D, 1);
  const monitorMaxGradeCount = Math.max(monitorCounts.A, monitorCounts.B, monitorCounts.C, monitorCounts.D, 1);
  const batchRepairStats = typeof getBatchRepairStats === 'function' ? getBatchRepairStats() : {};
  const batchRows = BATCHES.map(batch => {
    const open = openLaptopCount(batch);
    const total = batch.laptops.length;
    const done = Math.max(total - open, 0);
    const progress = total ? Math.round((done / total) * 100) : 0;
    const rp = typeof getBatchRepairStatsFor === 'function' ? getBatchRepairStatsFor(batch, batchRepairStats) : { repair: 0, production: 0, reject: 0 };
    const expanded = STATE.expandedBatchStats === batch.id;
    const complete = typeof isBatchComplete === 'function' && isBatchComplete(batch);
    const fresh = typeof isBatchNew === 'function' && isBatchNew(batch);
    return `
      <div class="batch-card${complete ? ' is-complete' : ''}">
        <div class="batch-card-head">
          <div>
            <div class="batch-status-title">Batch ${escapeHtml(batch.nummer)}${complete ? '<span class="batch-badge done">Completed</span>' : ''}${fresh ? '<span class="batch-badge new">New</span>' : ''}</div>
            <div class="batch-status-meta">${escapeHtml(batch.leverancier)} · added ${escapeHtml(batch.geimporteerd || 'today')}</div>
          </div>
          <div class="batch-status-count"><strong>${open}</strong> open<span class="card-sub">${done}/${total} done</span></div>
        </div>
        <div class="batch-chips">
          <span class="batch-chip repair ${rp.repair ? 'has-repair' : ''}"><b>${rp.repair}</b> repair labels</span>
          ${rp.repair ? `<span class="batch-chip bin-prod"><b>${rp.production}</b> production</span><span class="batch-chip bin-reject"><b>${rp.reject}</b> not sellable</span>` : ''}
        </div>
        <div class="batch-progress-track"><div class="batch-progress-fill" style="width: ${progress}%;"></div></div>
        <div class="batch-card-actions">
          <button class="batch-mini-btn" data-batch-stats="${escapeHtml(batch.id)}" type="button" aria-expanded="${expanded ? 'true' : 'false'}">${expanded ? 'Hide statistics' : 'Statistics'}</button>
          ${isAdmin ? `<button class="batch-mini-btn danger" data-action="remove_batch" data-remove-batch="${escapeHtml(batch.id)}" type="button">Delete batch</button>` : ''}
        </div>
        ${expanded && typeof renderBatchStatsPanel === 'function' ? renderBatchStatsPanel(getBatchDashboardStats(batch)) : ''}
      </div>
    `;
  }).join('');
  const stickerBatchRows = BATCHES.map(batch => {
    const open = stickerOpenLaptopCount(batch);
    const total = batch.laptops.length;
    const done = Math.max(total - open, 0);
    const progress = total ? Math.round((done / total) * 100) : 0;
    return `
      <div class="batch-status-row">
        <div>
          <div class="batch-status-title">Batch ${escapeHtml(batch.nummer)}</div>
          <div class="batch-status-meta">${escapeHtml(batch.leverancier)} · ${escapeHtml(batch.geimporteerd || 'today')}</div>
          ${isAdmin ? `<button class="batch-remove" data-action="remove_batch" data-remove-batch="${escapeHtml(batch.id)}">Delete batch</button>` : ''}
        </div>
        <div class="batch-status-count">${open} to label<br><span class="card-sub">${done}/${total} done</span></div>
        <div class="batch-progress-track"><div class="batch-progress-fill" style="width: ${progress}%;"></div></div>
      </div>
    `;
  }).join('');
  const monitorBatchRows = MONITOR_BATCHES.map(batch => {
    const open = batch.monitors.filter(monitor => !isMonitorLabelPrinted(monitor.sticker)).length;
    const total = batch.monitors.length;
    const done = Math.max(total - open, 0);
    const progress = total ? Math.round((done / total) * 100) : 0;
    return `
      <div class="batch-status-row">
        <div>
          <div class="batch-status-title">Monitor batch ${escapeHtml(batch.nummer)}</div>
          <div class="batch-status-meta">${escapeHtml(batch.leverancier)} · ${escapeHtml(batch.geimporteerd || 'today')}</div>
          ${isAdmin ? `<button class="batch-remove" data-action="remove_monitor_batch" data-remove-monitor-batch="${escapeHtml(batch.id)}">Delete batch</button>` : ''}
        </div>
        <div class="batch-status-count">${open} to label<br><span class="card-sub">${done}/${total} done</span></div>
        <div class="batch-progress-track"><div class="batch-progress-fill" style="width: ${progress}%;"></div></div>
      </div>
    `;
  }).join('');
  return { isAdmin, items, counts, avg, allLaptops, openCount, completedCount, stickerOpenCount, stickerCompletedCount, allMonitors, monitorOpenCount, monitorCompletedCount, monitorItems, monitorCounts, monitorLatest, monitorMaxGradeCount, latest, maxGradeCount, batchRows, stickerBatchRows, monitorBatchRows };
}

// Compacte actiekaart: groot icoon + titel + korte omschrijving. Extra detail
// (stats/context) zit achter een "i" zodat de kaart overzichtelijk blijft.
function renderActionCard(opts) {
  const expanded = STATE.homeInfoCard === opts.key;
  return `
    <button class="action-card ${opts.extraClass || ''}" data-action="${opts.action}" type="button">
      <div class="action-icon">${uiIcon(opts.icon)}</div>
      <div class="action-text">
        <p class="action-title">${escapeHtml(opts.title)}</p>
        <p class="action-desc">${escapeHtml(opts.desc)}</p>
        ${opts.info ? `<p class="action-info-panel ${expanded ? 'is-open' : ''}">${escapeHtml(opts.info)}</p>` : ''}
      </div>
      ${opts.info ? `<span class="action-info-btn ${expanded ? 'is-open' : ''}" data-action-info="${escapeHtml(opts.key)}" role="button" tabindex="0" aria-label="More info" aria-expanded="${expanded ? 'true' : 'false'}" title="More info">i</span>` : ''}
    </button>
  `;
}

// Speelse, interactieve grade-mix voor het zijpaneel: staafjes groeien met een
// animatie, tonen aantal én percentage, de dominante grade licht op, en klikken
// opent Insights. Gedeeld door de laptop- en monitor-werkstroom.
function renderGradeMix(counts) {
  const grades = ['A', 'B', 'C', 'D'];
  const safe = g => Number(counts[g] || 0);
  const total = grades.reduce((sum, g) => sum + safe(g), 0);
  const maxCount = Math.max(safe('A'), safe('B'), safe('C'), safe('D'), 1);
  const topGrade = total ? grades.reduce((best, g) => (safe(g) > safe(best) ? g : best), 'A') : null;
  return `
    <div class="grade-mix" role="group" aria-label="Grade mix">
      <div class="grade-mix-total"><strong>${total}</strong> ${total === 1 ? 'device graded' : 'devices graded'}</div>
      <div class="grade-mix-bars">
        ${grades.map(g => {
          const c = safe(g);
          const pct = total ? Math.round((c / total) * 100) : 0;
          const barPct = Math.round((c / maxCount) * 100);
          const disp = g === 'D' ? 'X' : g;
          const isTop = total > 0 && g === topGrade && c > 0;
          return `
            <button class="grade-mix-row ${g}${isTop ? ' is-top' : ''}" data-action="analytics" type="button" title="Grade ${disp}: ${c} device${c === 1 ? '' : 's'} (${pct}%) — open Insights" aria-label="Grade ${disp}: ${c} of ${total}, ${pct} percent. Open Insights.">
              <span class="grade-mix-badge ${g}">${disp}</span>
              <span class="grade-mix-track"><span class="grade-mix-fill ${g}" style="--w: ${barPct}%;"></span></span>
              <span class="grade-mix-val"><b>${c}</b><small>${pct}%</small></span>
            </button>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function renderDashboardTabs(active) {
  if (isStickerUser()) {
    return `
      <div class="dashboard-tabs" role="tablist" aria-label="Dashboard navigation">
        <button class="dashboard-tab sticker-tab ${active === 'workflow' ? 'active' : ''}" data-action="home_workflow" type="button">${uiIcon('labelPrint')} Laptop Labels</button>
        <button class="dashboard-tab monitor-tab ${active === 'monitor' ? 'active' : ''}" data-action="home_monitor_workflow" type="button">${uiIcon('monitor')} Monitor Labels</button>
      </div>
    `;
  }
  return `
    <div class="dashboard-tabs" role="tablist" aria-label="Dashboard navigation">
      <button class="dashboard-tab workflow-tab ${active === 'workflow' ? 'active' : ''}" data-action="home_workflow" type="button">${uiIcon('workflow')} Laptop Workflow</button>
      <button class="dashboard-tab monitor-tab ${active === 'monitor' ? 'active' : ''}" data-action="home_monitor_workflow" type="button">${uiIcon('monitor')} Monitor Workflow</button>
      <button class="dashboard-tab support-tab ${active === 'support' ? 'active' : ''}" data-action="home_support" type="button">${uiIcon('settings')} Operations</button>
      <button class="dashboard-tab analytics-tab ${active === 'analytics' ? 'active' : ''}" data-action="analytics" type="button">${uiIcon('analytics')} Insights</button>
    </div>
  `;
}

function renderHome() {
  const data = getDashboardData();
  const activeTab = STATE.homeTab === 'support' ? 'support' : STATE.homeTab === 'monitor' ? 'monitor' : 'workflow';
  const isSupport = activeTab === 'support';
  const isMonitor = activeTab === 'monitor';
  return `
    <div class="screen home-screen">
      ${renderDashboardTabs(activeTab)}
      <div class="ops-command">
        <div>
          <div class="ops-kicker">ReMarkt Operations</div>
          <h1>${isSupport ? 'Operations' : isMonitor ? 'Label Scan' : isStickerUser() ? 'Laptop Labeling' : 'Laptop Workflow'}</h1>
          <p>${isStickerUser()
            ? isMonitor
              ? 'Scan a monitor, choose the grade after the monitor is selected and print the label.'
              : 'Scan a barcode and print the specs label instantly. The device is then complete in the digital workflow.'
            : isSupport
            ? 'Manage batches, users and grading rules away from the daily warehouse flow.'
            : isMonitor
            ? 'Label incoming monitors separately from laptop grading, with A, B, C or X after each scan.'
            : 'Start daily grading work, label devices and run safe grading tests from one clean workspace.'}</p>
        </div>
      </div>
      ${activeTab === 'support' ? renderSupportDashboard(data) : activeTab === 'monitor' ? renderMonitorWorkflowDashboard(data) : renderWorkflowDashboard(data)}
    </div>
  `;
}

function renderWorkflowDashboard(data) {
  const { isAdmin, items, counts, avg, allLaptops, openCount, completedCount, stickerOpenCount, stickerCompletedCount, allMonitors, monitorOpenCount, monitorCompletedCount, latest, maxGradeCount, batchRows, stickerBatchRows, monitorBatchRows } = data;
  if (isStickerUser()) {
    return `
      <div class="ops-status-grid">
        <div class="ops-stat warning"><strong>${stickerOpenCount}</strong><span>devices to label</span></div>
        <div class="ops-stat"><strong>${stickerCompletedCount}</strong><span>labels printed or graded</span></div>
        <div class="ops-stat"><strong>${BATCHES.length}</strong><span>active laptop batch${BATCHES.length === 1 ? '' : 'es'}</span></div>
      </div>
      <div class="ops-layout">
        <div>
          <div class="ops-section-head">
            <div class="ops-section-title">Label Scan</div>
            <div class="ops-section-sub">Scan barcode, print instantly, blank grade line on label</div>
          </div>
          <div class="workflow-actions">
            ${renderActionCard({ action: 'sticker_scan', key: 'stickerscan', extraClass: 'sticker-work primary-work', icon: 'labelPrint', title: 'Scan & Print', desc: 'Scan a barcode; the label prints automatically.', info: `${stickerOpenCount} devices waiting for a label-only print. Specs and repair labels print automatically when needed.` })}
          </div>
        </div>

        <div class="ops-side-panel">
          <div class="ops-side-row">
            <div class="side-label">Access</div>
            <div class="side-value">No grading, insights or operations access for this account.</div>
          </div>
        </div>
      </div>
      ${renderWorkflowRoute('label', 'dashboard')}

      <div class="ops-batch-board">
        <div class="ops-section-head">
          <div class="ops-section-title">Active Batches</div>
          <div class="ops-section-sub">${BATCHES.length} batch${BATCHES.length === 1 ? '' : 'es'} · ${stickerOpenCount} to label</div>
        </div>
        <div class="batch-status-list">
          ${stickerBatchRows || '<p class="card-sub">No active batches.</p>'}
        </div>
      </div>

    `;
  }
  return `
    <div class="ops-status-grid">
      <div class="ops-stat warning"><strong>${openCount}</strong><span>open devices</span></div>
      <div class="ops-stat"><strong>${completedCount}</strong><span>completed devices</span></div>
      <div class="ops-stat"><strong>${items.length}</strong><span>${isAdmin ? 'total gradings' : 'your gradings'}</span></div>
      <div class="ops-stat"><strong>${avg || '-'}</strong><span>avg. seconds per device</span></div>
    </div>
    <div class="ops-layout">
      <div>
        <div class="ops-section-head">
          <div class="ops-section-title">Workflow</div>
          <div class="ops-section-sub">Daily actions for warehouse grading</div>
        </div>
        <div class="workflow-actions">
          ${renderActionCard({ action: 'scan', key: 'grade', extraClass: 'grade-work primary-work', icon: 'gradeScan', title: 'Grade Device from list', desc: 'Scan a device from the batch and grade it.', info: `${BATCHES.length} active batch${BATCHES.length === 1 ? '' : 'es'} · ${openCount} open devices. Scan the barcode, review every part and save the final grade; labels print automatically.` })}
          ${renderActionCard({ action: 'sticker_scan', key: 'label', extraClass: 'sticker-work', icon: 'labelPrint', title: 'Label Scan', desc: 'Print a specs label with a blank grade line.', info: `${stickerOpenCount} label-only prints remaining. The device is then marked complete in the digital workflow.` })}
          ${renderActionCard({ action: 'manual', key: 'manual', extraClass: 'manual-work', icon: 'manualEntry', title: 'Manual Entry', desc: 'Enter brand, model and specs by hand.', info: 'For returns or loose stock without a batch.' })}
          ${renderActionCard({ action: 'grading_test', key: 'test', extraClass: 'test-work', icon: 'testGrade', title: 'Test Grading', desc: 'Practice grading without changing data.', info: 'Runs the full grading flow but never touches stock or history — safe rule checks.' })}
        </div>
      </div>

      <div class="ops-side-panel">
        <div class="ops-side-row">
          <div class="side-label">Latest Result</div>
          <div class="side-value">${latest ? `${escapeHtml(latest.grade === 'D' ? 'Repair' : latest.grade)} · ${escapeHtml(latest.merk)} ${escapeHtml(latest.model)}` : 'No grading saved yet'}</div>
        </div>
        <div class="ops-side-row">
          <div class="side-label">Grade Mix</div>
          ${renderGradeMix(counts)}
        </div>
      </div>
    </div>
    ${renderWorkflowRoute('grading', 'dashboard')}

    <div class="ops-batch-board">
      <div class="ops-section-head">
        <div class="ops-section-title">Active Batches</div>
        <div class="ops-section-sub">${BATCHES.length} batch${BATCHES.length === 1 ? '' : 'es'} · ${allLaptops.length} devices total</div>
      </div>
      <div class="batch-status-list">
        ${batchRows || '<p class="card-sub">No active batches.</p>'}
      </div>
    </div>
  `;
}

function renderMonitorWorkflowDashboard(data) {
  const { allMonitors, monitorOpenCount, monitorCompletedCount, monitorBatchRows, monitorCounts, monitorLatest, monitorMaxGradeCount } = data;
  const monitorLatestName = monitorLatest
    ? monitorLatest.deviceName || `${monitorLatest.merk || ''} ${monitorLatest.model || ''}`.trim() || monitorLatest.sticker
    : '';
  return `
    <div class="ops-status-grid">
      <div class="ops-stat warning"><strong>${monitorOpenCount}</strong><span>monitors to label</span></div>
      <div class="ops-stat"><strong>${monitorCompletedCount}</strong><span>monitor labels printed</span></div>
      <div class="ops-stat"><strong>${MONITOR_BATCHES.length}</strong><span>active monitor batch${MONITOR_BATCHES.length === 1 ? '' : 'es'}</span></div>
      <div class="ops-stat"><strong>${allMonitors.length || '-'}</strong><span>monitors total</span></div>
    </div>

    <div class="ops-layout">
      <div>
        <div class="ops-section-head">
          <div class="ops-section-title">Label Scan</div>
          <div class="ops-section-sub">Separated monitor intake with scan, grade choice and label print</div>
        </div>
        <div class="workflow-actions">
          ${renderActionCard({ action: 'monitor_label_scan', key: 'monlabel', extraClass: 'monitor-work primary-work', icon: 'monitor', title: 'Label Scan', desc: 'Scan the monitor, then choose A, B, C or X.', info: `${monitorOpenCount} monitors waiting for a label print. The app prints the monitor label right after the grade.` })}
          ${renderActionCard({ action: 'monitor_manual', key: 'monmanual', extraClass: 'manual-work', icon: 'manualEntry', title: 'Enter monitor manually', desc: 'Enter brand, model and specs by hand.', info: 'For loose monitors or corrections without a reliable scan.' })}
        </div>
      </div>

      <div class="ops-side-panel">
        <div class="ops-side-row">
          <div class="side-label">Latest Result</div>
          <div class="side-value">${monitorLatest ? `${escapeHtml(displayMonitorGrade(monitorLatest.grade))} · ${escapeHtml(monitorLatestName)}` : 'No monitor labels printed yet'}</div>
        </div>
        <div class="ops-side-row">
          <div class="side-label">Grade Mix</div>
          ${renderGradeMix(monitorCounts)}
        </div>
      </div>
    </div>
    ${renderWorkflowRoute('monitor', 'dashboard')}

    <div class="ops-batch-board">
      <div class="ops-section-head">
        <div class="ops-section-title">Monitor Batches</div>
        <div class="ops-section-sub">${MONITOR_BATCHES.length} batch${MONITOR_BATCHES.length === 1 ? '' : 'es'} · ${allMonitors.length} monitors total</div>
      </div>
      <div class="batch-status-list">
        ${monitorBatchRows || '<p class="card-sub">No active monitor batches.</p>'}
      </div>
    </div>
  `;
}

function renderSupportDashboard(data) {
  const { isAdmin } = data;
  return `
    <div class="support-dashboard">
      <div class="support-grid">
        <div class="dashboard-panel strong-panel">
          <div class="ops-section-head">
            <div class="ops-section-title">Support</div>
            <div class="ops-section-sub">Rules, examples and score checks</div>
          </div>
          <div class="panel-actions">
            ${renderActionCard({ action: 'explain', key: 'graderules', extraClass: 'support-work knowledge-card', icon: 'explain', title: 'Grade Rules', desc: 'See how grades and repairs are decided.', info: 'Review how damage, score impact and repair decisions are calculated. Includes the rules, examples and the full decision logic.' })}
          </div>
        </div>

        <div class="dashboard-panel">
          <div class="ops-section-head">
            <div class="ops-section-title">Management</div>
            <div class="ops-section-sub">${isAdmin ? 'Manager access' : 'Manager access only'}</div>
          </div>
          ${isAdmin ? `
            <div class="panel-actions">
              ${renderActionCard({ action: 'import', key: 'batchimport', extraClass: 'import-work', icon: 'uploadSheet', title: 'Batch Import', desc: 'Turn supplier lists into batches.', info: 'Upload supplier lists and turn them into active grading batches. Only eligible laptop rows are added.' })}
              ${renderActionCard({ action: 'accounts', key: 'usermgmt', extraClass: 'accounts-work', icon: 'accountKey', title: 'User Management', desc: 'Manage users and access.', info: 'Create users and control who can grade, label or manage the system. Users, passwords and access.' })}
            </div>
          ` : `
            <div class="access-note">Management tools are hidden because this account has no manager access.</div>
          `}
        </div>

      </div>
    </div>
  `;
}

// Analytics dashboard lives in assets/analytics-history.js.

function impactPointsText(points) {
  return points >= 999 ? 'Direct X' : `${points}p`;
}

function floorText(minGrade) {
  return minGrade === 'D' ? 'Direct repair' : `Min. grade ${minGrade}`;
}

function renderImpactPill(profile) {
  return `<span class="impact-pill floor-${profile.minGrade}">${profile.label}<small>${impactPointsText(profile.points)}</small></span>`;
}

function describeTriggerImpact(impact) {
  if (impact === 'defect') return 'Direct X';
  if (impact === 'max-c') return 'Min. C';
  if (impact === 'max-b') return 'Min. B';
  return 'Info';
}

function renderTriggerSummary(ond) {
  if (!ond.triggers || !ond.triggers.length) {
    return '<span class="table-note">No extra check</span>';
  }

  return `
    <div class="trigger-list">
      ${ond.triggers.map(t => `<span class="trigger-chip">${t.label}: ${describeTriggerImpact(t.impact)}</span>`).join('')}
    </div>
  `;
}

function renderDecisionSummaries() {
  const componentNames = Object.fromEntries(ONDERDELEN.map(ond => [ond.id, ond.naam]));
  const rows = Object.entries(CHOICE_DECISIONS).flatMap(([componentId, decisions]) => {
    return Object.entries(decisions).map(([letter, decision]) => ({
      title: `${componentNames[componentId] || componentId} - option ${letter === 'D' ? 'X/D' : letter}`,
      text: decision.text,
      options: decision.options,
    }));
  });

  return rows.map(row => `
    <div class="detail-decision">
      <strong>${row.title}</strong>
      <ul>
        ${row.options.map(option => {
          const profile = IMPACT_PROFILES[option.impact] || IMPACT_PROFILES['a-plus'];
          return `<li>${option.label}: ${profile.label}, ${impactPointsText(profile.points)}, ${floorText(profile.minGrade)}</li>`;
        }).join('')}
      </ul>
    </div>
  `).join('');
}

function impactMeaning(profile) {
  const meanings = {
    'A+': 'No meaningful impact. This part keeps the device cleanly in A.',
    A: 'Very light wear. Usually still keeps the device in A.',
    'A-': 'Small visible mark. Several A- marks can push the device down.',
    B: 'Clearer visible issue. The device should no longer finish as A.',
    'C+': 'Strong issue. Pushes the score hard towards B/C.',
    'C-': 'Heavy issue. Counts as C-level impact.',
    C: 'Clear damage or wear. Minimum C.',
    X: 'Repair or not sellable. Normal scoring no longer applies.',
  };
  return meanings[profile.label] || '';
}

function renderExplain() {
  const onderdeelCount = getGradingOnderdelen().length;
  return `
    <div class="screen explain-screen">
      <div class="explain-hero">
        <div>
          <div class="explain-eyebrow">Explained simply</div>
          <h1>How grading works</h1>
          <p>
            The app scores visible condition, functional risk and customer impact. Light wear counts softly.
            visible damage or repair risk counts heavier.
          </p>
        </div>
        <div class="explain-summary">
          <div class="explain-summary-item"><strong>${onderdeelCount} checks</strong><span>reviewed during grading</span></div>
          <div class="explain-summary-item"><strong>0-5 points</strong><span>usually remains A</span></div>
          <div class="explain-summary-item"><strong>critical damage</strong><span>can force B, C or X</span></div>
        </div>
      </div>

      <div class="explain-section">
        <h2>Quick logic</h2>
        <p>Use this as the baseline during daily grading.</p>
        <div class="easy-explain-grid">
          <div class="easy-card">
            <div class="easy-card-number">1</div>
            <strong>Pick what you see</strong>
            <p>For every part, choose A, B, C or X. The app adds the right score impact.</p>
          </div>
          <div class="easy-card">
            <div class="easy-card-number">2</div>
            <strong>Light wear stays light</strong>
            <p>Small scratches and normal wear add few points, so clean devices usually stay A or B.</p>
          </div>
          <div class="easy-card">
            <div class="easy-card-number">3</div>
            <strong>Critical damage counts heavy</strong>
            <p>Screen damage, cracks, broken keys, touchpad or hinge issues can force a lower grade.</p>
          </div>
        </div>
      </div>

      <div class="explain-section">
        <h2>Score Bands</h2>
        <p>Points determine the first grade. Critical checks can still force the grade lower.</p>
        <div class="grade-scale" aria-label="Score bands for grades">
          <div class="grade-segment A"><strong>A</strong><span>0-5 points<br>very clean</span></div>
          <div class="grade-segment B"><strong>B</strong><span>6-25 points<br>visible use</span></div>
          <div class="grade-segment C"><strong>C</strong><span>26+ points<br>clear wear</span></div>
          <div class="grade-segment D"><strong>X</strong><span>repair<br>not sellable</span></div>
        </div>
        <div class="simple-stat-row">
          <div class="simple-stat"><strong>1-2</strong><span>points for light cosmetic marks</span></div>
          <div class="simple-stat"><strong>8+</strong><span>points for visible customer-facing damage</span></div>
          <div class="simple-stat"><strong>30/X</strong><span>for heavy damage, repair or not sellable</span></div>
        </div>
      </div>

      <div class="explain-section">
        <h2>High-Impact Areas</h2>
        <p>The app is stricter on parts customers see, touch or may need repaired.</p>
        <div class="priority-grid">
          <div class="priority-card high">
            <strong>Screen, touchpad, keyboard</strong>
            <p>These parts are used constantly. Damage is visible and affects sellability fast.</p>
          </div>
          <div class="priority-card medium">
            <strong>Housing and palmrest</strong>
            <p>These shape first impression. Light marks are acceptable; cracks and dents weigh heavier.</p>
          </div>
          <div class="priority-card low">
            <strong>Bottom cover and minor marks</strong>
            <p>Normal wear counts, but has less impact than visible or functional damage.</p>
          </div>
        </div>
      </div>

      <div class="explain-section">
        <h2>Examples</h2>
        <div class="example-grid">
          <div class="example-card">
            <strong>Almost new</strong>
            <span>A few light marks on lid and palmrest usually remain A.</span>
          </div>
          <div class="example-card">
            <strong>Clean, with screen mark</strong>
            <span>A visible whitespot or key-inprint can move the device to B or C.</span>
          </div>
          <div class="example-card">
            <strong>Not sellable</strong>
            <span>A broken key, faulty touchpad or loose hinge becomes X/repair.</span>
          </div>
        </div>
      </div>

      <div class="explain-section">
        <h2>Future Tuning</h2>
        <p>When real-world grading shows the rules are too strict or too soft, these are the safest controls to tune.</p>
        <div class="priority-grid">
          <div class="priority-card high">
            <strong>Score bands</strong>
            <p>For example: when does B become C too fast, or does A stay A too easily?</p>
          </div>
          <div class="priority-card medium">
            <strong>Part weight</strong>
            <p>For example: make LCD or touchpad heavier, bottom cover slightly lighter.</p>
          </div>
          <div class="priority-card low">
            <strong>Decision prompts</strong>
            <p>When a choice is risky, the app can ask a short follow-up with examples or photos.</p>
          </div>
        </div>
        <div class="soft-note" style="margin-top: 14px;">
          Supplier notes are shown as warnings at the matching part. They do not automatically add points:
          the operator still confirms what is actually visible or defective.
        </div>
      </div>
    </div>
  `;
}

function renderStickerScan() {
  const allLaptops = getAllLaptops();
  const availableLaptops = getStickerOpenLaptops();
  const completedLaptops = getCompletedLaptops();
  const query = STATE.scanSearch || '';
  const filteredLaptops = availableLaptops.filter(l => laptopMatchesScanQuery(l, query));
  const filteredCompleted = completedLaptops.filter(l => laptopMatchesScanQuery(l, query)).slice(0, 30);
  const completedCount = Math.max(allLaptops.length - availableLaptops.length, 0);
  const isAdmin = isAdminUser();
  return `
    <div class="screen">
      ${renderWorkflowIntroBanner('label')}
      <div class="card">
        <h3>Label Scan</h3>
        <p class="card-sub" style="margin-bottom: 14px;">Scan the barcode. The specs label prints instantly with a blank grade line.</p>
        <input type="text" class="scan-input" id="scanInput" placeholder="Scan or type barcode..." autofocus inputmode="numeric">
        <div class="scan-tools">
          <input type="search" class="scan-search" id="scanSearch" placeholder="Search devices by barcode, brand, model or batch..." value="${escapeHtml(query)}">
        </div>
      </div>

      <div class="card">
        <h3>To Label</h3>
        <p class="card-sub" style="margin-bottom: 14px;">${filteredLaptops.length} shown of ${availableLaptops.length} waiting${completedCount ? ` · ${completedCount} printed or graded` : ''}</p>
        ${availableLaptops.length ? BATCHES.map(batch => {
          const batchLaptops = batch.laptops.filter(l => !isLaptopGraded(l.sticker) && !isLaptopLabelPrinted(l.sticker) && laptopMatchesScanQuery(l, query));
          if (!batchLaptops.length) return '';
          return `
            <div class="batch-group">
              <div class="batch-header-row">
                <div class="batch-group-title">Batch ${escapeHtml(batch.nummer)} · ${escapeHtml(batch.leverancier)} · ${batchLaptops.length} to label</div>
                ${isAdmin ? `<button class="batch-remove" data-action="remove_batch" data-remove-batch="${escapeHtml(batch.id)}">Delete batch</button>` : ''}
              </div>
              <div class="batch-list">
                ${batchLaptops.map(l => `
                  <div class="batch-row">
                    <button class="batch-select" data-sticker-label="${escapeHtml(l.sticker)}">
                      <div class="batch-info">
                        <div class="batch-num">${escapeHtml(l.merk)} ${escapeHtml(l.model)}</div>
                        <div class="batch-meta">Barcode ${escapeHtml(l.sticker)} · ${escapeHtml(l.ram || '-')} · ${escapeHtml(l.ssd || '-')} · ${escapeHtml(l.display || '-')}${l.battery ? ' · battery ' + escapeHtml(l.battery) : ''}</div>
                      </div>
                    </button>
                    <span class="badge badge-active">Blank grade</span>
                    ${isAdmin ? `<button class="batch-remove" data-action="remove_laptop" data-remove-sticker="${escapeHtml(l.sticker)}">Delete</button>` : ''}
                  </div>
                `).join('')}
              </div>
            </div>
          `;
        }).join('') || `<div class="scan-empty">No devices match this search.</div>` : `<p class="card-sub">All devices in these batches are labeled or already graded.</p>`}
      </div>

      <div class="card">
        <h3>Reprint</h3>
        <p class="card-sub" style="margin-bottom: 14px;">Search or scan a completed device to print the label again.</p>
        ${filteredCompleted.length ? `
          <div class="batch-list">
            ${filteredCompleted.map(l => {
              const historyItem = getLatestHistoryForSticker(l.sticker);
              return `
                <div class="batch-row">
                  <button class="batch-select" data-reprint-laptop="${escapeHtml(l.sticker)}">
                    <div class="batch-info">
                      <div class="batch-num">${escapeHtml(l.merk)} ${escapeHtml(l.model)}</div>
                      <div class="batch-meta">Barcode ${escapeHtml(l.sticker)} · ${historyItem ? `grade ${escapeHtml(displayGrade(normalizeSupplierGrade(historyItem.grade)))}` : 'blank grade'} · batch ${escapeHtml(l.batchNummer || '-')}</div>
                    </div>
                  </button>
                  <span class="badge badge-active">Reprint</span>
                </div>
              `;
            }).join('')}
          </div>
        ` : `<p class="card-sub">No completed devices found yet${query ? ' for this search' : ''}.</p>`}
      </div>
    </div>
  `;
}

function renderMonitorLabelScan() {
  const allMonitors = getAllMonitors();
  const availableMonitors = getOpenMonitors();
  const query = STATE.monitorScanSearch || '';
  const filteredMonitors = availableMonitors.filter(monitor => monitorMatchesScanQuery(monitor, query));
  const completedCount = Math.max(allMonitors.length - availableMonitors.length, 0);
  const selectedMonitor = STATE.currentMonitor;
  const isAdmin = isAdminUser();
  return `
    <div class="screen">
      ${renderWorkflowIntroBanner('monitor')}
      ${selectedMonitor ? (monitorNeedsIdentityChoice(selectedMonitor) ? renderMonitorIdentityChoiceModal(selectedMonitor) : renderMonitorGradeChoiceModal(selectedMonitor)) : ''}
      <div class="card">
        <h3>Label Scan</h3>
        <p class="card-sub" style="margin-bottom: 14px;">Scan the monitor first. Then choose A, B, C or X in the pop-up and the app prints the monitor label immediately.</p>
        <div class="nav-buttons" style="border-top: 0; padding: 0 0 12px;">
          <button class="btn btn-secondary" data-action="monitor_manual" type="button">Enter monitor manually</button>
        </div>
        <input type="text" class="scan-input" id="scanInput" placeholder="Scan or type monitor barcode..." autofocus inputmode="numeric">
        <div class="scan-tools">
          <input type="search" class="scan-search" id="monitorScanSearch" placeholder="Search monitors by barcode, device name, serial, video input or batch..." value="${escapeHtml(query)}">
        </div>
      </div>

      <div class="card">
        <h3>Monitors to Label</h3>
        <p class="card-sub" style="margin-bottom: 14px;">${filteredMonitors.length} shown of ${availableMonitors.length} waiting${completedCount ? ` · ${completedCount} printed` : ''}</p>
        ${availableMonitors.length ? MONITOR_BATCHES.map(batch => {
          const batchMonitors = batch.monitors.filter(monitor => !isMonitorLabelPrinted(monitor.sticker) && monitorMatchesScanQuery(monitor, query));
          if (!batchMonitors.length) return '';
          return `
            <div class="batch-group">
              <div class="batch-header-row">
                <div class="batch-group-title">Monitor batch ${escapeHtml(batch.nummer)} · ${escapeHtml(batch.leverancier)} · ${batchMonitors.length} to label</div>
                ${isAdmin ? `<button class="batch-remove" data-action="remove_monitor_batch" data-remove-monitor-batch="${escapeHtml(batch.id)}">Delete batch</button>` : ''}
              </div>
              <div class="batch-list">
                ${batchMonitors.map(monitor => `
                  <div class="batch-row monitor-row">
                    <button class="batch-select" data-monitor-select="${escapeHtml(monitor.sticker)}">
                      <div class="batch-info">
                        <div class="batch-num">${escapeHtml(monitor.deviceName || `${monitor.merk} ${monitor.model}`.trim() || 'Monitor')}</div>
                        <div class="batch-meta">Barcode ${escapeHtml(monitor.sticker)} · SN ${escapeHtml(monitor.serial || '-')} · ${escapeHtml(monitor.display || '-')} · ${escapeHtml(monitor.resolution || '-')} · Video in ${escapeHtml(monitor.videoInputs || 'unknown')}</div>
                      </div>
                    </button>
                    <span class="badge badge-active">Scan first</span>
                    ${isAdmin ? `<button class="batch-remove" data-action="remove_monitor" data-remove-monitor="${escapeHtml(monitor.sticker)}">Delete</button>` : ''}
                  </div>
                `).join('')}
              </div>
            </div>
          `;
        }).join('') || `<div class="scan-empty">No monitors match this search.</div>` : `<p class="card-sub">No active monitor batches yet. Upload a supplier list with monitor rows from Batch Import.</p>`}
      </div>
    </div>
  `;
}

function renderScan() {
  const allLaptops = getAllLaptops();
  const availableLaptops = getOpenLaptops();
  const completedLaptops = getCompletedLaptops();
  const query = STATE.scanSearch || '';
  const filteredLaptops = availableLaptops.filter(l => laptopMatchesScanQuery(l, query));
  const filteredCompleted = completedLaptops.filter(l => laptopMatchesScanQuery(l, query)).slice(0, 30);
  const gradedCount = allLaptops.length - availableLaptops.length;
  const isAdmin = isAdminUser();
  const labelOnly = isStickerUser();
  return `
    <div class="screen">
      ${renderWorkflowIntroBanner(labelOnly ? 'label' : 'grade')}
      <div class="card">
        <h3>Scan Device</h3>
        <p class="card-sub" style="margin-bottom: 14px;">${labelOnly ? 'Scan a device to print a specs label with a blank grade line. The device is marked complete.' : 'Scan or type the barcode. Graded or labeled devices are removed from this list.'}</p>
        <input type="text" class="scan-input" id="scanInput" placeholder="e.g. 7771198" autofocus inputmode="numeric">
        <div class="scan-tools">
          <input type="search" class="scan-search" id="scanSearch" placeholder="Search open devices by barcode, brand, model or batch..." value="${escapeHtml(query)}">
        </div>
      </div>
      
      <div class="card">
        <h3>Select from Active Batches</h3>
        <p class="card-sub" style="margin-bottom: 14px;">${filteredLaptops.length} shown of ${availableLaptops.length} available${gradedCount ? ` · ${gradedCount} already graded` : ''}</p>
        ${availableLaptops.length ? BATCHES.map(batch => {
          const batchLaptops = batch.laptops.filter(l => !isLaptopGraded(l.sticker) && !isLaptopLabelPrinted(l.sticker) && laptopMatchesScanQuery(l, query));
          if (!batchLaptops.length) return '';
          return `
            <div class="batch-group">
              <div class="batch-header-row">
                <div class="batch-group-title">Batch ${escapeHtml(batch.nummer)} · ${escapeHtml(batch.leverancier)} · ${batchLaptops.length} open</div>
                ${isAdmin ? `<button class="batch-remove" data-action="remove_batch" data-remove-batch="${escapeHtml(batch.id)}">Delete batch</button>` : ''}
              </div>
              <div class="batch-list">
                ${batchLaptops.map(l => `
                  <div class="batch-row">
                    <button class="batch-select" data-sticker="${escapeHtml(l.sticker)}">
                      <div class="batch-info">
                        <div class="batch-num">${escapeHtml(l.merk)} ${escapeHtml(l.model)}</div>
                        <div class="batch-meta">Barcode ${escapeHtml(l.sticker)} · ${escapeHtml(l.ram || '-')} · ${escapeHtml(l.ssd || '-')} · ${escapeHtml(l.display || '-')}${l.battery ? ' · battery ' + escapeHtml(l.battery) : ''}</div>
                      </div>
                    </button>
                    <span class="badge badge-active">${escapeHtml(l.leverancier_class || '-')}</span>
                    ${isAdmin ? `<button class="batch-remove" data-action="remove_laptop" data-remove-sticker="${escapeHtml(l.sticker)}">Delete</button>` : ''}
                  </div>
                `).join('')}
              </div>
            </div>
          `;
        }).join('') || `<div class="scan-empty">No open devices match this search.</div>` : `<p class="card-sub">All devices in these batches are graded or labeled in this session.</p>`}
      </div>

      <div class="card">
        <h3>Completed / Reprint</h3>
        <p class="card-sub" style="margin-bottom: 14px;">If a label was printed incorrectly, scan the same barcode again or choose reprint below.</p>
        ${filteredCompleted.length ? `
          <div class="batch-list">
            ${filteredCompleted.map(l => {
              const historyItem = getLatestHistoryForSticker(l.sticker);
              const grade = historyItem ? displayGrade(normalizeSupplierGrade(historyItem.grade)) : 'Blank';
              return `
                <div class="batch-row">
                  <button class="batch-select" data-reprint-laptop="${escapeHtml(l.sticker)}">
                    <div class="batch-info">
                      <div class="batch-num">${escapeHtml(l.merk)} ${escapeHtml(l.model)}</div>
                      <div class="batch-meta">Barcode ${escapeHtml(l.sticker)} · grade ${escapeHtml(grade)} · batch ${escapeHtml(l.batchNummer || '-')}</div>
                    </div>
                  </button>
                  <span class="badge badge-active">Reprint</span>
                </div>
              `;
            }).join('')}
          </div>
        ` : `<p class="card-sub">No completed devices found yet${query ? ' for this search' : ''}.</p>`}
      </div>
    </div>
  `;
}

function renderManualEntry() {
  return `
    <div class="screen">
      ${renderWorkflowIntroBanner('manual')}
      <div class="card">
        <h3>Manual Entry</h3>
        <p class="card-sub" style="margin-bottom: 16px;">For devices outside a supplier batch, such as returns or one-off stock.</p>
        ${STATE.manualError ? `<div class="form-error">${escapeHtml(STATE.manualError)}</div>` : ''}
        
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Brand *</label>
            <input type="text" class="form-input" id="m_merk" placeholder="e.g. Dell">
          </div>
          <div class="form-group">
            <label class="form-label">Model *</label>
            <input type="text" class="form-input" id="m_model" placeholder="e.g. Latitude 7420">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Serial number</label>
            <input type="text" class="form-input" id="m_serial" placeholder="Optional">
          </div>
          <div class="form-group">
            <label class="form-label">Barcode</label>
            <input type="text" class="form-input" id="m_sticker" placeholder="Optional">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Processor</label>
            <input type="text" class="form-input" id="m_processor" placeholder="e.g. i5-1135G7">
          </div>
          <div class="form-group">
            <label class="form-label">RAM</label>
            <input type="text" class="form-input" id="m_ram" placeholder="e.g. 16GB">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Storage</label>
            <input type="text" class="form-input" id="m_ssd" placeholder="e.g. 256GB">
          </div>
          <div class="form-group">
            <label class="form-label">Display</label>
            <input type="text" class="form-input" id="m_display" placeholder="e.g. 14&quot;">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Battery health</label>
            <input type="text" class="form-input" id="m_battery" placeholder="e.g. 87%">
          </div>
          <div class="form-group">
            <label class="form-label">Graphics</label>
            <input type="text" class="form-input" id="m_gpu" placeholder="e.g. RTX 3050 or Intel Iris Xe">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Source</label>
          <input type="text" class="form-input" id="m_herkomst" placeholder="e.g. customer return, own stock, other supplier">
        </div>
        
        <button class="btn btn-primary" data-action="manual_submit" style="width: 100%; margin-top: 8px;">
          Start Grading
        </button>
      </div>
    </div>
  `;
}

function renderMonitorManualEntry() {
  const monitor = STATE.currentMonitor || {};
  const isCorrection = Boolean(monitor.sticker && STATE.monitorManualContext && STATE.monitorManualContext.mode === 'correction');
  const stickerValue = monitor.sticker || '';
  const merkValue = monitor.merk || (monitor.deviceName ? monitor.deviceName.split(' ')[0] : '');
  const escapedMerk = typeof escapeImportRegex === 'function' ? escapeImportRegex(merkValue) : String(merkValue).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const fallbackModel = monitor.model || (monitor.deviceName && merkValue ? monitor.deviceName.replace(new RegExp(`^${escapedMerk}\\s+`, 'i'), '').trim() : '');
  const modelParts = typeof splitMonitorModelParts === 'function' ? splitMonitorModelParts(fallbackModel, merkValue) : { series: '', modelNumber: fallbackModel };
  const serieValue = monitor.serie || modelParts.series || '';
  const modelValue = monitor.modelNumber || modelParts.modelNumber || fallbackModel;
  return `
    <div class="screen">
      ${renderWorkflowIntroBanner('monitor-manual')}
      <div class="card">
        <h3>${isCorrection ? 'Correct monitor details' : 'Enter monitor manually'}</h3>
        <p class="card-sub" style="margin-bottom: 16px;">Use this for monitors without a reliable scan or for corrections to supplier data. Brand and model number are required; series helps produce a tidy label and a better database match.</p>
        ${isCorrection ? `<div class="soft-note" style="margin-bottom: 14px;">You are correcting the details for barcode ${escapeHtml(stickerValue)}. The barcode stays the same; brand, model and specifications are overwritten.</div>` : ''}
        <div class="form-error" id="mm_error"${STATE.manualError ? '' : ' hidden'}>${escapeHtml(STATE.manualError || '')}</div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Brand *</label>
            <input type="text" class="form-input" id="mm_merk" list="monitorManualBrandSuggestions" autocomplete="off" placeholder="e.g. Dell" value="${escapeHtml(merkValue)}">
          </div>
          <div class="form-group">
            <label class="form-label">Series</label>
            <input type="text" class="form-input" id="mm_series" list="monitorManualSeriesSuggestions" autocomplete="off" placeholder="e.g. EliteDisplay or UltraSharp" value="${escapeHtml(serieValue)}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Model number *</label>
            <input type="text" class="form-input" id="mm_model" list="monitorManualModelSuggestions" autocomplete="off" placeholder="e.g. E243i or P2422H" value="${escapeHtml(modelValue)}">
          </div>
          <div class="form-group">
            <label class="form-label">Label name</label>
            <input type="text" class="form-input" id="mm_device_preview" value="${escapeHtml(typeof buildMonitorDeviceName === 'function' ? buildMonitorDeviceName(merkValue, serieValue, modelValue) : `${merkValue} ${modelValue}`.trim())}" readonly>
          </div>
        </div>
        ${renderMonitorManualDatabaseLists(merkValue, serieValue, modelValue)}
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Barcode</label>
            <input type="text" class="form-input" id="mm_sticker" placeholder="optional" value="${escapeHtml(stickerValue)}" ${isCorrection ? 'readonly' : ''}>
          </div>
          <div class="form-group">
            <label class="form-label">Serial number</label>
            <input type="text" class="form-input" id="mm_serial" placeholder="optional" value="${escapeHtml(monitor.serial || '')}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Screen size</label>
            <select class="form-input" id="mm_display">
              ${renderMonitorDisplaySizeOptions(monitor.display || '')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Resolution</label>
            <input type="text" class="form-input" id="mm_resolution" placeholder="e.g. 1920x1080" value="${escapeHtml(monitor.resolution || '')}">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Video in</label>
          ${renderMonitorManualPortPicker(monitor.videoInputs || '')}
          <p class="field-help">Maximum of two connections. On a database match the app fills this in automatically; for unknown models you can add them manually.</p>
        </div>
        <div class="form-group">
          <label class="form-label">Origin</label>
          <input type="text" class="form-input" id="mm_herkomst" placeholder="e.g. return, loose stock or supplier" value="${escapeHtml(monitor.herkomst || '')}">
        </div>

        <div class="nav-buttons" style="margin-top: 8px;">
          <button class="btn btn-secondary" data-action="monitor_label_scan" type="button">Back to Label Scan</button>
          <button class="btn btn-primary" data-action="monitor_manual_submit" type="button">Continue to grade</button>
        </div>
      </div>
    </div>
  `;
}

function renderTestStart() {
  const canExpert = canUseExpertMode();
  return `
    <div class="screen">
      ${renderWorkflowIntroBanner('test')}
      <div class="card">
        <h3>Test Grading</h3>
        <p class="card-sub" style="margin-bottom: 16px;">Run the full grading logic without changing stock, history or labels.</p>
        <div class="nav-buttons" style="border-top: 0; padding-top: 0;">
          <button class="btn btn-secondary" data-action="start_test_beginner">Guided Mode</button>
          ${canExpert ? '<button class="btn btn-primary" data-action="start_test_expert">Expert Mode</button>' : ''}
        </div>
      </div>
    </div>
  `;
}

function renderImport() {
  const isAdmin = STATE.currentUser && STATE.currentUser.rol === 'Manager';
  const result = STATE.importResult;
  const progress = STATE.importProgress;
  if (!isAdmin) {
    return `
      <div class="screen">
        <div class="card">
          <h3>Access denied</h3>
          <p class="card-sub">Only managers can import supplier files.</p>
        </div>
      </div>
    `;
  }

  return `
    <div class="screen" style="max-width: 1100px;">
      <div class="card">
        <h3>Batch Import</h3>
        <p class="card-sub">Upload supplier Excel or CSV files. Laptop rows go to the laptop workflow; monitor rows go to Label Scan.</p>
      </div>

      <div class="import-drop">
        <strong>Select one or more supplier files</strong>
        <p class="card-sub">Mixed files are supported when product type, model or description identifies laptops and monitors. Processing runs locally in this browser.</p>
        <input type="file" id="batchImportInput" accept=".xlsx,.xls,.csv,.xml" multiple ${progress ? 'disabled' : ''}>
        <p class="card-sub" style="margin-top: 10px;">The Excel parser loads only when files are selected.</p>
      </div>

      ${progress ? `
        <div class="import-progress" aria-live="polite">
          <strong>${escapeHtml(progress.title || 'Importing')}</strong>
          <div class="import-progress-bar">
            <div class="import-progress-fill" style="width: ${Math.max(0, Math.min(100, progress.percent || 0))}%;"></div>
          </div>
          <p class="card-sub">${escapeHtml(progress.detail || '')}</p>
        </div>
      ` : ''}

      ${result ? `
        <div class="import-summary">
          <div class="metric">
            <div class="metric-label">Imported</div>
            <div class="metric-value">${result.imported}</div>
            <div class="metric-sub">devices added</div>
          </div>
          <div class="metric">
            <div class="metric-label">Laptops</div>
            <div class="metric-value">${result.importedLaptops || 0}</div>
            <div class="metric-sub">${BATCH.laptops.length} laptop devices total</div>
          </div>
          <div class="metric">
            <div class="metric-label">Monitors</div>
            <div class="metric-value">${result.importedMonitors || 0}</div>
            <div class="metric-sub">${getAllMonitors().length} monitor devices total</div>
          </div>
          <div class="metric">
            <div class="metric-label">Skipped</div>
            <div class="metric-value">${result.skipped}</div>
            <div class="metric-sub">unsupported product or duplicate</div>
          </div>
        </div>

        <div class="card">
          <h3>Latest Laptop Import</h3>
          <div class="import-list">
            ${result.laptops && result.laptops.length ? result.laptops.slice(0, 40).map(l => `
              <div class="import-row">
                <div>
                  <strong>${escapeHtml(l.merk)} ${escapeHtml(l.model)}</strong>
                  <span class="card-sub">Barcode ${escapeHtml(l.sticker)} · ${escapeHtml(l.processor || '-')} · ${escapeHtml(l.ram || '-')} · ${escapeHtml(l.ssd || '-')} · Battery ${escapeHtml(l.battery || '-')}</span>
                </div>
                <span class="badge badge-active">${escapeHtml(l.leverancier_class || '-')}</span>
              </div>
            `).join('') : '<p class="card-sub">No laptop rows found in this import.</p>'}
          </div>
        </div>

        <div class="card">
          <h3>Latest Monitor Import</h3>
          <div class="import-list">
            ${result.monitors && result.monitors.length ? result.monitors.slice(0, 40).map(monitor => `
              <div class="import-row">
                <div>
                  <strong>${escapeHtml(monitor.deviceName || `${monitor.merk} ${monitor.model}`.trim() || 'Monitor')}</strong>
                  <span class="card-sub">Barcode ${escapeHtml(monitor.sticker)} · SN ${escapeHtml(monitor.serial || '-')} · ${escapeHtml(monitor.display || '-')} · ${escapeHtml(monitor.resolution || '-')} · Video in ${escapeHtml(monitor.videoInputs || 'unknown')}</span>
                </div>
                <span class="badge badge-active">${escapeHtml(displayMonitorGrade(monitor.leverancier_class || 'A'))}</span>
              </div>
            `).join('') : '<p class="card-sub">No monitor rows found in this import.</p>'}
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

function renderAccounts() {
  if (!isAdminUser()) {
    return `
      <div class="screen">
        <div class="card">
          <h3>Access denied</h3>
          <p class="card-sub">Only managers can manage users.</p>
        </div>
      </div>
    `;
  }

  const modeOptionsForRole = (role, selected = '') => {
    const normalizedSelected = normalizeUserPreference(selected, role);
    return getAllowedUserPreferences(role)
      .map(option => `<option value="${escapeHtml(option.value)}" ${normalizedSelected === option.value ? 'selected' : ''}>${escapeHtml(option.label)}</option>`)
      .join('');
  };
  return `
    <div class="screen" style="max-width: 1100px;">
      <div class="card">
        <h3>User Management</h3>
        <p class="card-sub">New users receive the start password and must choose their own password immediately at first login.</p>
        <div class="instruction-strip">Start password: <strong>${escapeHtml(FIRST_LOGIN_PASSWORD)}</strong></div>
      </div>

      <div class="account-grid">
        <div class="card">
          <h3>New User</h3>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Name</label>
              <input class="form-input" id="newUserName" placeholder="Employee name">
            </div>
            <div class="form-group">
              <label class="form-label">Login ID</label>
              <input class="form-input" id="newUserId" placeholder="e.g. first name">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Role</label>
              <select class="form-input" id="newUserRole">
                <option value="Grader">Grader</option>
                <option value="Stickeraar">Labeler</option>
                <option value="Manager">Manager</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Default mode</label>
              <select class="form-input" id="newUserMode">
                ${modeOptionsForRole('Grader', 'beginner')}
              </select>
            </div>
          </div>
          <button class="btn btn-primary" data-action="create_user">Create User</button>
        </div>

        <div class="card">
          <h3>Existing Users</h3>
          <div class="account-list">
            ${USERS.map(u => `
              <div class="account-row">
                <div>
                  <strong>${escapeHtml(u.naam)}</strong>
                  <div class="card-sub">${escapeHtml(u.id)} · ${escapeHtml(displayUserRole(u.rol))} · ${escapeHtml(displayUserPreference(u.voorkeur))} · ${u.mustChangePassword ? 'must set password' : 'own password active'}</div>
                </div>
                <div class="form-row">
                  <select class="small-select" data-account-role="${escapeHtml(u.id)}">
                    <option value="Grader" ${normalizeUserRole(u.rol) === 'Grader' ? 'selected' : ''}>Grader</option>
                    <option value="Stickeraar" ${normalizeUserRole(u.rol) === 'Stickeraar' ? 'selected' : ''}>Labeler</option>
                    <option value="Manager" ${u.rol === 'Manager' ? 'selected' : ''}>Manager</option>
                  </select>
                  <select class="small-select" data-account-mode="${escapeHtml(u.id)}">
                    ${modeOptionsForRole(u.rol, u.voorkeur)}
                  </select>
                </div>
                <div class="account-actions">
                  <button class="btn btn-secondary" data-action="update_user" data-user-id="${escapeHtml(u.id)}">Save</button>
                  <button class="btn btn-secondary" data-action="reset_user_password" data-user-id="${escapeHtml(u.id)}">Reset password</button>
                  <button class="batch-remove" data-action="delete_user" data-user-id="${escapeHtml(u.id)}" ${u.id === STATE.currentUser.id ? 'disabled' : ''}>Delete</button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderLaptopInfo() {
  const l = STATE.currentLaptop;
  const supplierD = normalizeText(l.leverancier_class).toLowerCase() === 'class d';
  const labelOnly = isStickerUser();
  const canExpert = canUseExpertMode();
  return `
    <div class="screen">
      ${labelOnly ? `
        <div class="label-note">
          Label-only flow: print a specs label with a blank grade line. This device is marked complete in the digital workflow.
        </div>
      ` : ''}
      ${supplierD && !labelOnly ? `
        <div class="repair-alert">
          <strong>Supplier marked this device as Class D</strong>
          Send this device to repair before adding it to sellable stock.
          ${renderSupplierDReasonList(l)}
          <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px;">
            <button class="btn btn-secondary" data-action="print_supplier_specs_label">Print specs label</button>
            <button class="btn btn-secondary" data-action="print_supplier_problem_label">Print repair label</button>
          </div>
        </div>
      ` : ''}
      <div class="laptop-card">
        <div class="laptop-title">${escapeHtml(l.merk)} ${escapeHtml(l.model)}</div>
        <div class="laptop-sub">Barcode ${escapeHtml(l.sticker)}${l.serial ? ' · S/N ' + escapeHtml(l.serial) : ''}${l.herkomst ? ' · ' + escapeHtml(l.herkomst) : ''}</div>
        <div class="specs-grid">
          <div class="spec-item"><span class="spec-label">Processor</span><span class="spec-value">${escapeHtml(l.processor || '—')}</span></div>
          <div class="spec-item"><span class="spec-label">RAM</span><span class="spec-value">${escapeHtml(l.ram || '—')}</span></div>
          <div class="spec-item"><span class="spec-label">Storage</span><span class="spec-value">${escapeHtml(l.ssd || '—')}</span></div>
          <div class="spec-item"><span class="spec-label">Display</span><span class="spec-value">${escapeHtml(l.display || '—')}</span></div>
          <div class="spec-item"><span class="spec-label">Touch</span><span class="spec-value">${isTouchscreenLaptop(l) ? 'Yes' : 'No'}</span></div>
          <div class="spec-item"><span class="spec-label">Battery</span><span class="spec-value">${escapeHtml(l.battery || '—')}</span></div>
          <div class="spec-item"><span class="spec-label">Graphics</span><span class="spec-value">${escapeHtml(l.gpu || '—')}</span></div>
        </div>
      </div>
      
      ${l.meldingen ? `
        <div class="instruction-strip">
          ${labelOnly ? 'Supplier notes stay with the printed workflow. The final grade can be marked manually on the label.' : 'Supplier notes appear during grading at the matching part.'}
        </div>
      ` : ''}
      
      <div class="nav-buttons">
        <button class="btn btn-secondary" data-action="back_scan">← Back</button>
        ${labelOnly ? `
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-primary" data-action="print_supplier_specs_label">Print specs label</button>
          </div>
        ` : `
          <div style="display: flex; gap: 8px;">
            <button class="btn ${canExpert ? 'btn-secondary' : 'btn-primary'}" data-action="start_beginner">Guided Mode</button>
            ${canExpert ? `<button class="btn btn-primary" data-action="start_expert">${supplierD ? 'Review Anyway' : 'Expert Mode'}</button>` : ''}
          </div>
        `}
      </div>
    </div>
  `;
}

function renderGradingBeginner() {
  const g = STATE.currentGrading;
  const onderdelen = getGradingOnderdelen();
  const ond = onderdelen[g.huidigeIndex];
  const totaal = onderdelen.length;
  const progress = ((g.huidigeIndex) / totaal) * 100;
  const huidigeKeuze = g.keuzes[ond.id];
  const visualAssets = VISUAL_ASSETS[ond.id];
  
  return `
    <div class="screen ${visualAssets ? 'grading-visual-screen' : ''}">
      <div class="progress-text">Step ${g.huidigeIndex + 1} of ${totaal}</div>
      <div class="progress-bar"><div class="progress-fill" style="width: ${progress}%;"></div></div>
      
      <div class="question-title">${ond.naam}</div>
      <div class="question-hint">${ond.hint}</div>
      ${renderComponentNotice(ond)}
      <div class="instruction-strip">Choose the option closest to the device. Photos are examples; real condition may vary slightly.</div>
      
      <div class="choice-grid ${visualAssets ? 'visual-choice-grid' : ''}">
        ${ond.keuzes.map(k => visualAssets ? `
          <div class="visual-choice-shell ${huidigeKeuze === k.letter ? 'selected ' + k.letter : ''}">
            <button class="choice visual-choice ${huidigeKeuze === k.letter ? 'selected ' + k.letter : ''}" data-keuze="${k.letter}" data-auto-advance="true" type="button">
              <div class="visual-thumb component-${ond.id} grade-${k.letter}">
                <img src="${visualAssets[k.letter]}" alt="${ond.naam} grade ${k.letter} example" loading="eager" decoding="async" fetchpriority="high" width="640" height="426">
                <div class="visual-letter ${k.letter}">${k.letter === 'D' ? 'X' : k.letter}</div>
              </div>
              <div class="visual-copy">
                <div class="choice-main">${k.titel}</div>
                ${k.detail ? `<div class="choice-detail">${k.detail}</div>` : ''}
              </div>
            </button>
            <button class="visual-zoom-action" data-image-preview="true" data-preview-src="${escapeHtml(visualAssets[k.letter])}" data-preview-label="${escapeHtml(`${ond.naam} grade ${k.letter === 'D' ? 'X' : k.letter} example`)}" title="Zoom image" aria-label="Zoom image" type="button" onpointerdown="openImagePreviewFromElement(this); return false;" ontouchstart="openImagePreviewFromElement(this); return false;" onclick="openImagePreviewFromElement(this); return false;">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="5.5"></circle><path d="M15 15l5 5"></path></svg>
              <span>Zoom</span>
            </button>
          </div>
        ` : `
          <button class="choice ${huidigeKeuze === k.letter ? 'selected ' + k.letter : ''}" data-keuze="${k.letter}" type="button">
            <div class="choice-letter ${k.letter}">${k.letter === 'D' ? '×' : k.letter}</div>
            <div class="choice-text">
              <div class="choice-main">${k.titel}</div>
              ${k.detail ? `<div class="choice-detail">${k.detail}</div>` : ''}
            </div>
          </button>
        `).join('')}
      </div>
      
      ${ond.triggers && ond.triggers.length ? `
        <div class="detail-section">
          <div class="detail-title">Specific damage?</div>
          <div class="detail-hint">Select what you see. This may affect the final grade.</div>
          <div class="detail-checks">
            ${ond.triggers.map(t => `
              <label class="detail-check">
                <input type="checkbox" data-trigger="${t.id}" ${g.triggers[t.id] ? 'checked' : ''}>
                <span class="detail-check-label">${t.label}</span>
                <span class="detail-impact ${impactClass(t.impact)}">${impactLabel(t.impact)}</span>
              </label>
            `).join('')}
          </div>
        </div>
      ` : ''}
      
      <div class="nav-buttons">
        <button class="btn btn-secondary" data-action="prev_q" ${g.huidigeIndex === 0 ? 'disabled' : ''}>← Back</button>
        <button class="btn btn-primary" data-action="next_q" ${!huidigeKeuze ? 'disabled' : ''}>
          ${g.huidigeIndex === totaal - 1 ? 'Confirm' : 'Next'}
        </button>
      </div>
    </div>
  `;
}

function renderGradingExpert() {
  const g = STATE.currentGrading;
  const l = STATE.currentLaptop || {};
  const selectedGrade = g && g.expertFinalGrade;
  const gradeOptions = [
    { grade: 'A', label: 'A-grade', detail: 'Very tidy condition. Label prints immediately.' },
    { grade: 'B', label: 'B-grade', detail: 'Signs of use, fully functional. Label prints immediately.' },
    { grade: 'C', label: 'C-grade', detail: 'Clear signs of use, technically sound. Label prints immediately.' },
    { grade: 'D', label: 'X / Repair', detail: 'Repair, defective or not directly sellable. Description required.' },
  ];

  return `
    <div class="screen expert-direct-screen" style="max-width: 980px;">
      <div class="expert-direct-head">
        <div>
          <div class="ops-kicker">Expert mode</div>
          <h1>Choose the final grade</h1>
          <p>For experienced graders: choose A, B, C or X. For A/B/C the app prints the specs label immediately and then returns to Grade Device.</p>
        </div>
        <button class="btn btn-secondary" data-action="back_scan" type="button">Back</button>
      </div>

      <div class="laptop-card">
        <div class="laptop-title">${escapeHtml(l.merk)} ${escapeHtml(l.model)}</div>
        <div class="laptop-sub">Barcode ${escapeHtml(l.sticker)}${l.serial ? ' · S/N ' + escapeHtml(l.serial) : ''}${l.batchNummer ? ' · batch ' + escapeHtml(l.batchNummer) : ''}</div>
        <div class="specs-grid">
          <div class="spec-item"><span class="spec-label">Processor</span><span class="spec-value">${escapeHtml(l.processor || '—')}</span></div>
          <div class="spec-item"><span class="spec-label">RAM</span><span class="spec-value">${escapeHtml(l.ram || '—')}</span></div>
          <div class="spec-item"><span class="spec-label">Storage</span><span class="spec-value">${escapeHtml(l.ssd || '—')}</span></div>
          <div class="spec-item"><span class="spec-label">Display</span><span class="spec-value">${escapeHtml(l.display || '—')}</span></div>
          <div class="spec-item"><span class="spec-label">Battery</span><span class="spec-value">${escapeHtml(formatBatteryForLabel(l.battery) || '—')}</span></div>
          <div class="spec-item"><span class="spec-label">Supplier</span><span class="spec-value">${escapeHtml(l.leverancier_class || '—')}</span></div>
        </div>
      </div>
      ${renderExpertSupplierInlineNotice(l)}

      <div class="expert-direct-grade-grid">
        ${gradeOptions.map(option => `
          <button class="monitor-grade-button expert-grade-button grade-${option.grade}" data-expert-final-grade="${option.grade}" type="button">
            <span class="monitor-grade-letter">${option.grade === 'D' ? 'X' : option.grade}</span>
            <span class="monitor-grade-copy"><strong>${escapeHtml(option.label)}</strong><span>${escapeHtml(option.detail)}</span></span>
            <em>${option.grade === 'D' ? 'Enter description' : 'Print label'}</em>
          </button>
        `).join('')}
      </div>

      ${selectedGrade === 'D' ? `
        <div class="expert-repair-panel">
          <label class="form-label" for="expertRepairText">Repair / damage for repair label *</label>
          <textarea class="form-input expert-repair-text" id="expertRepairText" rows="3" placeholder="e.g. faulty keyboard, LCD pixel line, touchpad not working...">${escapeHtml(g.expertRepairText || '')}</textarea>
          <div class="nav-buttons" style="border-top:0; padding-top:12px;">
            <span class="card-sub">For X the app prints a specs label and a repair label with this description.</span>
            <button class="btn btn-primary" data-action="confirm_expert_repair" type="button">Confirm X & print labels</button>
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

function renderExpertScorePanel(g = STATE.currentGrading, onderdelen = getGradingOnderdelen()) {
  const ingevuld = onderdelen.filter(o => g.keuzes[o.id]).length;
  const huidige = calculateGrade(g.keuzes, g.triggers, g.impactOverrides);
  const score = huidige.score;
  let voorlopigeGrade = '';
  let voorlopigeText = '—';
  if (ingevuld === onderdelen.length) {
    voorlopigeGrade = huidige.eindgrade;
    voorlopigeText = huidige.eindgrade === 'D' ? 'Repair' : 'Grade ' + huidige.eindgrade;
  } else if (ingevuld > 0) {
    voorlopigeText = `${ingevuld}/${onderdelen.length} completed`;
  }

  return `
    <div class="score-panel" id="expertScorePanel">
      <div class="score-label">Impact Score</div>
      <div class="score-num">${score} ${score === 1 ? 'point' : 'points'}</div>
      
      <div class="score-label">Live Grade</div>
      ${voorlopigeGrade 
        ? `<div class="preview-grade ${voorlopigeGrade}">${voorlopigeGrade === 'D' ? 'Repair' : voorlopigeGrade}</div>`
        : `<div class="preview-grade empty">${voorlopigeText}</div>`}
      
      <div class="score-info">
        ${ingevuld}/${onderdelen.length} checks completed<br>
        A: 0-5 · B: 6-25 · C from 26
      </div>
      
      <button class="btn btn-primary" data-action="confirm_expert" 
              ${ingevuld < onderdelen.length ? 'disabled' : ''} 
              style="width: 100%;">
        Confirm
      </button>
    </div>
  `;
}

function renderResult() {
  const g = STATE.currentGrading;
  const r = g.result;
  const l = STATE.currentLaptop;
  const grade = r.eindgrade;
  const extraLabelButton = r.repairLabelType === 'production'
    ? 'Print Production'
    : r.repairLabelType === 'reject'
      ? 'Print Not sellable'
      : 'Print Repair';
  const testOnly = g.testOnly || (l && l.testOnly);
  const labels = {
    A: { naam: 'Premium', desc: `Impact score ${r.score} - near new` },
    B: { naam: 'Good', desc: `Impact score ${r.score} - visible use, fully functional` },
    C: { naam: 'Heavy Use', desc: `Impact score ${r.score} - clear wear` },
    D: { naam: 'Repair', desc: 'Repair, parts or not directly sellable' }
  };
  
  return `
      <div class="screen">
        <div style="margin-bottom: 16px;">
        <div style="font-size: 13px; color: #6B6B66;">${testOnly ? 'Test grading' : `${escapeHtml(l.merk)} ${escapeHtml(l.model)} · ${escapeHtml(l.sticker)}`}</div>
        <div style="font-size: 12px; color: #6B6B66;">Graded by ${escapeHtml(STATE.currentUser.naam)} · ${new Date().toLocaleString('nl-NL', {dateStyle: 'short', timeStyle: 'short'})}</div>
      </div>
      
      <div class="result-grade ${grade}">
        <div class="result-grade-label">${grade === 'D' ? 'Final Status' : 'Final Grade'}</div>
        <div class="result-grade-letter">${grade === 'D' ? '×' : grade}</div>
        <div class="result-grade-desc">${labels[grade].naam} — ${labels[grade].desc}</div>
      </div>
      
      <h3 style="margin-bottom: 10px; font-weight: 500;">Why ${grade === 'D' ? 'repair' : 'grade ' + grade}?</h3>
      <div class="reasons">
        ${r.redenen.map(reden => `
          <div class="reason">
            <div class="reason-dot ${reden.type}"></div>
            <div class="reason-text">${escapeHtml(reden.text)}</div>
          </div>
        `).join('')}
      </div>
      
      <h3 style="margin-bottom: 10px; font-weight: 500;">Grade Details</h3>
      <div class="detail-table">
        <div class="detail-row header">
          <span>Part</span>
          <span style="text-align: center;">Choice / impact</span>
          <span style="text-align: right;">Score</span>
        </div>
        ${r.detailRows.map(row => `
          <div class="detail-row">
            <span>${escapeHtml(row.naam)}</span>
            <span style="text-align: center;">${escapeHtml(row.keuze === 'D' ? 'X' : row.keuze)}${row.impact && row.impact !== '-' ? ' / ' + escapeHtml(row.impact) : ''}</span>
            <span style="text-align: right;">${row.punten}</span>
          </div>
        `).join('')}
        <div class="detail-row total">
          <span>Total</span>
          <span></span>
          <span style="text-align: right;">${r.score}</span>
        </div>
      </div>

      ${testOnly ? '' : `<div class="label-note">
        Label: ${getLabelRows(l, r).filter(Boolean).map(escapeHtml).join(' · ')}
      </div>`}
      ${r.gradeAfterRepair ? `<div class="label-note">
        Specs label shows the grade after repair. Extra label: ${getLabelRows(l, r, 'problems').filter(Boolean).map(escapeHtml).join(' · ')}
      </div>` : ''}
      
      <div class="nav-buttons">
        <button class="btn btn-secondary" data-action="adjust">← Adjust</button>
        <div style="display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end;">
          ${testOnly ? `
            <button class="btn btn-secondary" data-action="new_test">New Test</button>
            <button class="btn btn-primary" data-action="finish_test">Done</button>
          ` : `
            <button class="btn btn-secondary" data-action="print_specs_label">Print Specs</button>
            <button class="btn btn-secondary" data-action="print_problem_label">${extraLabelButton}</button>
            <button class="btn btn-primary" data-action="confirm_save">Confirm & Print</button>
          `}
        </div>
      </div>
    </div>
  `;
}

// History search and rendering live in assets/analytics-history.js.

function impactClass(impact) {
  return impact === 'defect' ? 'impact-defect' : impact === 'max-c' ? 'impact-bad' : impact === 'max-b' ? 'impact-warn' : 'impact-info';
}
function impactLabel(impact, short = false) {
  if (impact === 'defect') return short ? '-> X' : '-> X';
  if (impact === 'max-c') return short ? '-> max C' : '-> max C';
  if (impact === 'max-b') return short ? '-> max B' : '-> max B';
  return short ? '' : 'Info';
}
function impactPillClass(impact) {
  return impact === 'defect' ? 'defect' : impact === 'max-c' ? 'bad' : '';
}

