// =============================================================================
// APP EVENTS & GRADING WORKFLOW
// Eventdelegatie, navigatie-acties, accounts, gradingflow en opslaan.
// =============================================================================
let expertScoreFrame = null;

// =============================================================================
// EVENT LISTENERS
// =============================================================================
function attachListeners() {
  const app = document.getElementById('app');
  if (app && app.dataset.delegatedListeners !== 'true') {
    app.addEventListener('click', handleDelegatedClick);
    app.addEventListener('pointerdown', handleDelegatedPointerDown, true);
    app.addEventListener('touchstart', handleDelegatedPointerDown, true);
    app.addEventListener('change', handleDelegatedChange);
    app.addEventListener('input', handleDelegatedInput);
    app.addEventListener('keydown', handleDelegatedKeydown);
    app.dataset.delegatedListeners = 'true';
  }

  const monitorIdentityButton = STATE.currentScreen === 'monitor_label_scan' && STATE.currentMonitor && monitorNeedsIdentityChoice(STATE.currentMonitor)
    ? document.querySelectorAll('[data-monitor-identity-choice]')[0]
    : null;
  const scanInput = document.getElementById('scanInput');
  if (monitorIdentityButton) {
    monitorIdentityButton.focus();
  } else if (scanInput) {
    scanInput.focus();
  }
  bindRenderedControlHandlers();
}

function bindClick(selector, handler) {
  document.querySelectorAll(selector).forEach(element => {
    element.onclick = event => {
      if (element.disabled) return;
      event.preventDefault();
      event.stopPropagation();
      Promise.resolve(handler(element, event)).catch(error => {
        reportAppError('Action failed', error);
        setAppMessage('Action failed. Try again.');
        render();
      });
    };
  });
}

function bindRenderedControlHandlers() {
  bindClick('[data-decision-option]', button => {
    resolvePendingDecision(Number(button.dataset.decisionOption));
  });

  bindClick('[data-action]', button => handleAction(button.dataset.action, button));

  bindClick('[data-history-toggle]', button => {
    const id = button.dataset.historyToggle;
    STATE.historyOpenId = STATE.historyOpenId === id ? null : id;
    render();
  });

  bindClick('[data-sticker]', button => {
    selectLaptop(button.dataset.sticker);
  });

  bindClick('[data-sticker-label]', button => {
    return scanAndPrintStickerLabel(button.dataset.stickerLabel, { source: 'list' });
  });

  bindClick('[data-monitor-select]', button => {
    selectMonitorForLabel(button.dataset.monitorSelect);
  });

  bindClick('[data-monitor-identity-choice]', button => {
    chooseMonitorIdentityForLabel(button.dataset.monitorIdentityChoice);
  });

  bindClick('[data-monitor-print-grade]', (button, event) => {
    if (event.target.closest('[data-monitor-grade-info]')) {
      toggleMonitorGradeInfo(event.target.closest('[data-monitor-grade-info]').dataset.monitorGradeInfo);
      return;
    }
    if (event.target.closest('[data-monitor-grade-info-panel]')) return;
    if (!STATE.currentMonitor) return;
    STATE.monitorGradeInfoOpen = null;
    return scanAndPrintMonitorLabel(STATE.currentMonitor.sticker, button.dataset.monitorPrintGrade, { source: 'grade' });
  });

  bindClick('[data-image-preview]', button => {
    openImagePreviewFromElement(button);
  });

  bindClick('[data-keuze]', (button, event) => {
    if (!canGradeUser()) return;
    const previewTarget = event.target.closest('[data-image-preview]');
    if (previewTarget) {
      openImagePreviewFromElement(previewTarget);
      return;
    }
    if (!STATE.currentGrading || STATE.pendingDecision) return;
    const onderdelen = getGradingOnderdelen();
    const ond = onderdelen[STATE.currentGrading.huidigeIndex];
    if (!ond) return;
    applyComponentChoice(ond.id, button.dataset.keuze, button.dataset.autoAdvance === 'true');
  });

  bindClick('[data-expert-keuze]', button => {
    if (!canGradeUser()) return;
    if (STATE.pendingDecision) return;
    applyComponentChoice(button.dataset.ond, button.dataset.letter, false);
  });

  bindClick('[data-expert-trigger]', button => {
    if (!canGradeUser()) return;
    if (!STATE.currentGrading || STATE.pendingDecision) return;
    const tid = button.dataset.tid;
    STATE.currentGrading.triggers[tid] = !STATE.currentGrading.triggers[tid];
    updateExpertTriggerUI(tid, STATE.currentGrading.triggers[tid]);
    queueExpertScoreUpdate();
  });
}

function handleDelegatedPointerDown(e) {
  const imagePreviewTarget = e.target.closest('[data-image-preview]');
  if (!imagePreviewTarget) return;
  e.preventDefault();
  e.stopPropagation();
  openImagePreviewFromElement(imagePreviewTarget);
}

async function handleDelegatedClick(e) {
  const previewOverlay = e.target.closest('[data-image-preview-overlay]');
  if (previewOverlay && e.target === previewOverlay) {
    STATE.imagePreview = null;
    render();
    return;
  }

  const decisionButton = e.target.closest('[data-decision-option]');
  if (decisionButton) {
    resolvePendingDecision(Number(decisionButton.dataset.decisionOption));
    return;
  }

  const actionButton = e.target.closest('[data-action]');
  if (actionButton) {
    await handleAction(actionButton.dataset.action, actionButton);
    return;
  }

  const historyButton = e.target.closest('[data-history-toggle]');
  if (historyButton) {
    const id = historyButton.dataset.historyToggle;
    STATE.historyOpenId = STATE.historyOpenId === id ? null : id;
    render();
    return;
  }

  const imagePreviewTarget = e.target.closest('[data-image-preview]');
  if (imagePreviewTarget) {
    openImagePreviewFromElement(imagePreviewTarget);
    return;
  }

  const stickerButton = e.target.closest('[data-sticker]');
  if (stickerButton) {
    selectLaptop(stickerButton.dataset.sticker);
    return;
  }

  const stickerLabelButton = e.target.closest('[data-sticker-label]');
  if (stickerLabelButton) {
    await scanAndPrintStickerLabel(stickerLabelButton.dataset.stickerLabel, { source: 'list' });
    return;
  }

  const monitorSelectButton = e.target.closest('[data-monitor-select]');
  if (monitorSelectButton) {
    selectMonitorForLabel(monitorSelectButton.dataset.monitorSelect);
    return;
  }

  const monitorIdentityButton = e.target.closest('[data-monitor-identity-choice]');
  if (monitorIdentityButton) {
    chooseMonitorIdentityForLabel(monitorIdentityButton.dataset.monitorIdentityChoice);
    return;
  }

  const monitorGradeInfoButton = e.target.closest('[data-monitor-grade-info]');
  if (monitorGradeInfoButton) {
    e.preventDefault();
    e.stopPropagation();
    toggleMonitorGradeInfo(monitorGradeInfoButton.dataset.monitorGradeInfo);
    return;
  }

  const monitorPrintGradeButton = e.target.closest('[data-monitor-print-grade]');
  if (monitorPrintGradeButton) {
    if (STATE.currentMonitor) {
      STATE.monitorGradeInfoOpen = null;
      await scanAndPrintMonitorLabel(STATE.currentMonitor.sticker, monitorPrintGradeButton.dataset.monitorPrintGrade, { source: 'grade' });
    }
    return;
  }

  const keuzeButton = e.target.closest('[data-keuze]');
  if (keuzeButton) {
    if (!canGradeUser()) return;
    const onderdelen = getGradingOnderdelen();
    const ond = onderdelen[STATE.currentGrading.huidigeIndex];
    const keuze = keuzeButton.dataset.keuze;
    applyComponentChoice(ond.id, keuze, keuzeButton.dataset.autoAdvance === 'true');
    return;
  }

  const expertChoiceButton = e.target.closest('[data-expert-keuze]');
  if (expertChoiceButton) {
    if (!canGradeUser()) return;
    const ond = expertChoiceButton.dataset.ond;
    const letter = expertChoiceButton.dataset.letter;
    applyComponentChoice(ond, letter, false);
    return;
  }

  const expertTriggerButton = e.target.closest('[data-expert-trigger]');
  if (expertTriggerButton) {
    if (!canGradeUser()) return;
    const tid = expertTriggerButton.dataset.tid;
    STATE.currentGrading.triggers[tid] = !STATE.currentGrading.triggers[tid];
    updateExpertTriggerUI(tid, STATE.currentGrading.triggers[tid]);
    queueExpertScoreUpdate();
  }
}

function toggleMonitorGradeInfo(grade) {
  const normalized = normalizeMonitorGrade(grade);
  STATE.monitorGradeInfoOpen = STATE.monitorGradeInfoOpen === normalized ? null : normalized;
  const modal = typeof document.querySelector === 'function' ? document.querySelector('.monitor-grade-modal') : null;
  if (!modal) {
    render();
    return;
  }
  modal.querySelectorAll('[data-monitor-grade-info]').forEach(infoButton => {
    const isOpen = infoButton.dataset.monitorGradeInfo === STATE.monitorGradeInfoOpen;
    infoButton.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  });
  modal.querySelectorAll('[data-monitor-grade-info-panel]').forEach(panel => {
    const isOpen = panel.dataset.monitorGradeInfoPanel === STATE.monitorGradeInfoOpen;
    panel.classList.toggle('is-open', isOpen);
    panel.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
  });
}

async function handleDelegatedChange(e) {
  if (e.target.matches('[data-trigger]')) {
    STATE.currentGrading.triggers[e.target.dataset.trigger] = e.target.checked;
    return;
  }

  if (e.target.id === 'newUserRole') {
    syncModeSelectForRole(e.target.value, document.getElementById('newUserMode'));
    return;
  }

  if (e.target.id === 'mm_merk' || e.target.id === 'mm_series' || e.target.id === 'mm_model') {
    syncMonitorManualDatabaseAssist();
    return;
  }

  if (e.target.matches('[data-account-role]')) {
    const row = e.target.closest('.account-row');
    syncModeSelectForRole(e.target.value, row && row.querySelector('[data-account-mode]'));
    return;
  }

  if (e.target.id === 'batchImportInput') {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
      try {
        await importSupplierFiles(files);
        logAudit('import_supplier_files', 'batch', STATE.importResult && STATE.importResult.batches ? STATE.importResult.batches.map(batch => batch.id).join(',') : '', {
          files: files.map(file => sanitizeExternalText(file.name, 180)),
          imported: STATE.importResult ? STATE.importResult.imported : 0,
          importedLaptops: STATE.importResult ? STATE.importResult.importedLaptops || 0 : 0,
          importedMonitors: STATE.importResult ? STATE.importResult.importedMonitors || 0 : 0,
        });
        await saveSharedDemoState();
        setAppMessage(`${STATE.importResult ? STATE.importResult.importedLaptops || 0 : 0} laptops and ${STATE.importResult ? STATE.importResult.importedMonitors || 0 : 0} monitors imported and ready.`, 'success');
        render();
      } catch (err) {
      STATE.importProgress = null;
      setAppMessage('Import failed: ' + err.message);
      render();
    }
  }
}

function syncModeSelectForRole(role, modeSelect) {
  if (!modeSelect) return;
  const current = normalizeUserPreference(modeSelect.value, role);
  modeSelect.innerHTML = getAllowedUserPreferences(role)
    .map(option => `<option value="${escapeHtml(option.value)}" ${current === option.value ? 'selected' : ''}>${escapeHtml(option.label)}</option>`)
    .join('');
}

function handleDelegatedInput(e) {
  if (e.target.id === 'mm_merk' || e.target.id === 'mm_series' || e.target.id === 'mm_model') {
    syncMonitorManualDatabaseAssist();
    return;
  }
  if (e.target.id === 'historySearch') {
    scheduleHistorySearch(e.target.value);
    return;
  }
  if (e.target.id === 'scanSearch') {
    scheduleScanSearch(e.target.value);
    return;
  }
  if (e.target.id === 'monitorScanSearch') {
    scheduleMonitorScanSearch(e.target.value);
  }
}

function syncMonitorManualDatabaseAssist() {
  if (STATE.currentScreen !== 'monitor_manual') return;
  const merk = readFormValue('mm_merk');
  const series = readFormValue('mm_series');
  const model = readFormValue('mm_model');
  updateMonitorManualSeriesSuggestions(merk, series);
  updateMonitorManualModelSuggestions(merk, series, model);
  updateMonitorManualDevicePreview(merk, series, model);
  const match = typeof findMonitorManualDatabaseMatch === 'function' ? findMonitorManualDatabaseMatch(merk, series, model) : null;
  if (!match) return;
  applyMonitorManualDatabaseMatch(match);
}

function updateMonitorManualSeriesSuggestions(merk, series) {
  const list = document.getElementById('monitorManualSeriesSuggestions');
  if (!list || typeof getMonitorManualSeriesSuggestions !== 'function') return;
  const suggestions = getMonitorManualSeriesSuggestions(merk, series, 60);
  list.innerHTML = suggestions.map(value => `<option value="${escapeHtml(value)}"></option>`).join('');
}

function updateMonitorManualModelSuggestions(merk, series, model) {
  const list = document.getElementById('monitorManualModelSuggestions');
  if (!list || typeof getMonitorManualModelSuggestions !== 'function') return;
  const suggestions = getMonitorManualModelSuggestions(merk, series, model, 80);
  list.innerHTML = suggestions.map(value => `<option value="${escapeHtml(value)}"></option>`).join('');
}

function updateMonitorManualDevicePreview(merk, series, model) {
  const field = document.getElementById('mm_device_preview');
  if (!field) return;
  field.value = typeof buildMonitorDeviceName === 'function'
    ? buildMonitorDeviceName(merk, series, model)
    : [merk, series, model].filter(Boolean).join(' ');
}

function setFormValueIfAvailable(id, value) {
  const field = document.getElementById(id);
  if (!field || value === undefined || value === null) return;
  field.value = String(value);
}

function applyMonitorManualDatabaseMatch(match) {
  if (!match) return;
  setFormValueIfAvailable('mm_resolution', match.resolution || '');
  setFormValueIfAvailable('mm_display', match.displaySize ? `${match.displaySize}"` : '');
  applyMonitorManualVideoInputsToPicker(match.videoInputs || '');
}

function applyMonitorManualVideoInputsToPicker(videoInputs) {
  const selects = Array.from(document.querySelectorAll('[data-monitor-video-port-select]') || []);
  const countSelects = Array.from(document.querySelectorAll('[data-monitor-video-port-count-select]') || []);
  if (!selects.length) return;
  const selections = typeof getMonitorManualPortSelections === 'function' ? getMonitorManualPortSelections(videoInputs) : [];
  selects.forEach((select, index) => {
    const selection = selections[index] || { port: '', count: 1 };
    select.value = selection.port || '';
    if (countSelects[index]) countSelects[index].value = String(selection.count || 1);
  });
}

function handleDelegatedKeydown(e) {
  if (e.key === 'Escape' && STATE.imagePreview) {
    e.preventDefault();
    STATE.imagePreview = null;
    render();
    return;
  }

  if (e.key === 'Enter') {
    if (e.target.id === 'scanInput') {
      e.preventDefault();
      const sticker = e.target.value.trim();
      e.target.value = '';
      if (STATE.currentScreen === 'monitor_label_scan') {
        selectMonitorForLabel(sticker);
      } else if (STATE.currentScreen === 'sticker_scan') {
        Promise.resolve(scanAndPrintStickerLabel(sticker, { source: 'scan' })).catch(error => {
          reportAppError('Label print failed', error);
          setAppMessage('Label print failed. Try again.');
          render();
        });
      } else {
        selectLaptop(sticker);
      }
      return;
    }
    if (e.target.id === 'loginPassword') {
      handleAction('login_password', e.target);
      return;
    }
  }

  const tag = e.target && e.target.tagName ? e.target.tagName.toLowerCase() : '';
  const isTypingField = ['input', 'textarea', 'select'].includes(tag);
  if (isTypingField || STATE.pendingDecision) return;

  const key = String(e.key || '').toLowerCase();
  if (STATE.currentScreen === 'monitor_label_scan' && STATE.currentMonitor && !monitorNeedsIdentityChoice(STATE.currentMonitor) && ['a', 'b', 'c', 'd', 'x'].includes(key)) {
    e.preventDefault();
    const grade = key === 'x' ? 'D' : key.toUpperCase();
    Promise.resolve(scanAndPrintMonitorLabel(STATE.currentMonitor.sticker, grade, { source: 'keyboard' })).catch(error => {
      reportAppError('Monitor label print failed', error);
      setAppMessage('Monitor label print failed. Try again.');
      render();
    });
    return;
  }

  if (['a', 'b', 'c', 'd', 'x'].includes(key) && (STATE.currentScreen === 'grading_beginner' || STATE.currentScreen === 'grading_expert')) {
    if (!canGradeUser()) return;
    const letter = key === 'x' ? 'D' : key.toUpperCase();
    e.preventDefault();
    applyGradingShortcut(letter);
    return;
  }

  if (key === 'enter' && STATE.currentScreen === 'grading_expert' && STATE.currentGrading) {
    const missing = getMissingGradingOnderdelen(STATE.currentGrading);
    if (!missing.length) {
      e.preventDefault();
      finishGrading();
      render();
    }
  }
}

function applyGradingShortcut(letter) {
  if (!STATE.currentGrading) return;
  const onderdelen = getGradingOnderdelen();
  if (STATE.currentScreen === 'grading_beginner') {
    const ond = onderdelen[STATE.currentGrading.huidigeIndex];
    if (ond) applyComponentChoice(ond.id, letter, true);
    return;
  }

  const target = onderdelen.find(ond => !STATE.currentGrading.keuzes[ond.id]) || onderdelen[onderdelen.length - 1];
  if (target) applyComponentChoice(target.id, letter, false);
}

function openImagePreviewFromElement(element) {
  if (!element) return;
  const src = element.dataset.previewSrc || (element.querySelector && element.querySelector('img') ? element.querySelector('img').src : '');
  if (!src) return;
  STATE.imagePreview = {
    src,
    label: element.dataset.previewLabel || 'Choice image',
  };
  render();
}

let scanSearchTimer = null;
function scheduleScanSearch(value) {
  clearTimeout(scanSearchTimer);
  scanSearchTimer = setTimeout(() => {
    STATE.scanSearch = value;
    render();
    const input = document.getElementById('scanSearch');
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }, 120);
}

let monitorScanSearchTimer = null;
function scheduleMonitorScanSearch(value) {
  clearTimeout(monitorScanSearchTimer);
  monitorScanSearchTimer = setTimeout(() => {
    STATE.monitorScanSearch = value;
    render();
    const input = document.getElementById('monitorScanSearch');
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }, 120);
}

let historySearchTimer = null;
function scheduleHistorySearch(value) {
  clearTimeout(historySearchTimer);
  historySearchTimer = setTimeout(() => {
    STATE.historySearch = value;
    STATE.historyPage = 1;
    STATE.historyOpenId = null;
    render();
    const input = document.getElementById('historySearch');
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }, 180);
}

function updateExpertChoiceUI(componentId, letter) {
  document.querySelectorAll(`[data-expert-keuze][data-ond="${componentId}"]`).forEach(button => {
    button.classList.toggle('active', button.dataset.letter === letter);
  });
}

function updateExpertTriggerUI(triggerId, active) {
  const button = document.querySelector(`[data-expert-trigger][data-tid="${triggerId}"]`);
  if (button) button.classList.toggle('active', active);
}

function queueExpertScoreUpdate() {
  if (expertScoreFrame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(expertScoreFrame);
  const schedule = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : callback => setTimeout(callback, 0);
  expertScoreFrame = schedule(() => {
    expertScoreFrame = null;
    const panel = document.getElementById('expertScorePanel');
    if (panel && STATE.currentGrading) {
      panel.outerHTML = renderExpertScorePanel();
    }
  });
}

function applyComponentChoice(componentId, letter, autoAdvance = false) {
  if (!STATE.currentGrading) return;
  STATE.currentGrading.keuzes[componentId] = letter;
  STATE.currentGrading.impactOverrides = STATE.currentGrading.impactOverrides || {};
  delete STATE.currentGrading.impactOverrides[componentId];
  STATE.currentGrading.gradeReviewDone = false;
  STATE.currentGrading.finalGradeOverride = null;

  const decision = getChoiceDecision(componentId, letter);
  if (decision) {
    STATE.pendingDecision = {
      componentId,
      letter,
      autoAdvance,
      title: decision.title,
      text: decision.text,
      options: decision.options,
    };
    render();
    return;
  }

  advanceAfterChoice(autoAdvance);
  if (STATE.currentScreen === 'grading_expert') {
    updateExpertChoiceUI(componentId, letter);
    queueExpertScoreUpdate();
    return;
  }
  render();
}

function resolvePendingDecision(optionIndex) {
  const decision = STATE.pendingDecision;
  if (!decision || !STATE.currentGrading) return;
  const option = decision.options[optionIndex];
  if (!option) return;

  if (decision.type === 'grade-review') {
    STATE.currentGrading.gradeReviewDone = true;
    STATE.currentGrading.finalGradeOverride = option.finalGrade;
    if (STATE.currentGrading.result && option.finalGrade === 'B') {
      STATE.currentGrading.result.eindgrade = 'B';
      STATE.currentGrading.result.redenen.push({ type: 'warn', text: 'Grader review: too many light issues for A -> final grade B' });
    } else if (STATE.currentGrading.result) {
      STATE.currentGrading.result.redenen.push({ type: 'good', text: 'Grader review: light issues remain acceptable for A' });
    }
    STATE.currentGrading.bevestigd = Date.now();
    STATE.pendingDecision = null;
    STATE.currentScreen = 'result';
    render();
    return;
  }

  STATE.currentGrading.keuzes[decision.componentId] = decision.letter;
  STATE.currentGrading.impactOverrides = STATE.currentGrading.impactOverrides || {};
  STATE.currentGrading.impactOverrides[decision.componentId] = option.impact;
  STATE.currentGrading.gradeReviewDone = false;
  STATE.currentGrading.finalGradeOverride = null;
  STATE.pendingDecision = null;
  advanceAfterChoice(decision.autoAdvance);
  render();
}

function cancelPendingDecision() {
  const decision = STATE.pendingDecision;
  if (decision && STATE.currentGrading) {
    if (decision.type !== 'grade-review') {
      delete STATE.currentGrading.keuzes[decision.componentId];
      if (STATE.currentGrading.impactOverrides) delete STATE.currentGrading.impactOverrides[decision.componentId];
    }
  }
  STATE.pendingDecision = null;
}

function advanceAfterChoice(autoAdvance) {
  if (!autoAdvance || !STATE.currentGrading) return;
  if (STATE.currentGrading.huidigeIndex < getGradingOnderdelen().length - 1) {
    STATE.currentGrading.huidigeIndex++;
  } else {
    finishGrading();
  }
}

const STICKER_ALLOWED_ACTIONS = new Set([
  'dismiss_message',
  'toggle_language',
  'toggle_theme',
  'close_image_preview',
  'logout',
  'home',
  'home_workflow',
  'home_monitor_workflow',
  'sticker_scan',
  'monitor_label_scan',
  'monitor_manual',
  'monitor_manual_from_current',
  'monitor_manual_submit',
  'monitor_scan_reset',
  'monitor_identity_reset',
  'scan',
  'back_scan',
  'login_password',
  'print_supplier_specs_label',
]);

function guardStickerAction(action) {
  if (!isStickerUser() || STICKER_ALLOWED_ACTIONS.has(action)) return false;
  STATE.currentGrading = null;
  STATE.pendingDecision = null;
  if (!['sticker_scan', 'monitor_label_scan', 'scan', 'laptop_info'].includes(STATE.currentScreen)) {
    STATE.currentScreen = 'home';
    STATE.homeTab = 'workflow';
  }
  setAppMessage('This account is Labeler-only: scan and print specs labels without grading.');
  render();
  return true;
}

async function handleAction(action, el) {
  if (guardStickerAction(action)) return;
  switch (action) {
    case 'dismiss_message':
      setAppMessage(null);
      break;
    case 'toggle_theme':
      setThemePreference(el.dataset.themeValue);
      break;
    case 'toggle_language':
      if (typeof setLanguagePreference === 'function') {
        setLanguagePreference(el.dataset.languageValue || getNextLanguagePreference());
      }
      break;
    case 'close_image_preview':
      STATE.imagePreview = null;
      break;
    case 'logout':
      clearSessionUser();
      STATE.currentUser = null;
      STATE.currentScreen = 'login';
      STATE.homeTab = 'workflow';
      STATE.currentLaptop = null;
      STATE.currentMonitor = null;
      STATE.currentGrading = null;
      STATE.pendingDecision = null;
      STATE.imagePreview = null;
      break;
    case 'home':
      STATE.currentScreen = 'home';
      STATE.homeTab = 'workflow';
      STATE.currentLaptop = null;
      STATE.currentMonitor = null;
      STATE.currentGrading = null;
      STATE.pendingDecision = null;
      STATE.imagePreview = null;
      break;
    case 'home_workflow':
      STATE.currentScreen = 'home';
      STATE.homeTab = 'workflow';
      STATE.currentLaptop = null;
      STATE.currentMonitor = null;
      STATE.currentGrading = null;
      STATE.pendingDecision = null;
      break;
    case 'home_monitor_workflow':
      STATE.currentScreen = 'home';
      STATE.homeTab = 'monitor';
      STATE.currentLaptop = null;
      STATE.currentMonitor = null;
      STATE.currentGrading = null;
      STATE.pendingDecision = null;
      break;
    case 'sticker_scan':
      STATE.currentScreen = 'sticker_scan';
      STATE.currentMonitor = null;
      STATE.manualError = '';
      STATE.scanSearch = '';
      break;
    case 'monitor_label_scan':
      STATE.currentScreen = 'monitor_label_scan';
      STATE.homeTab = 'monitor';
      STATE.currentMonitor = null;
      STATE.monitorManualContext = null;
      STATE.monitorSelectedGrade = null;
      STATE.manualError = '';
      STATE.monitorScanSearch = '';
      break;
    case 'monitor_manual':
      STATE.currentScreen = 'monitor_manual';
      STATE.homeTab = 'monitor';
      STATE.currentMonitor = null;
      STATE.monitorManualContext = null;
      STATE.monitorSelectedGrade = null;
      STATE.manualError = '';
      break;
    case 'monitor_manual_from_current':
      if (!STATE.currentMonitor) {
        setAppMessage('Scan of selecteer eerst een monitor die je wilt corrigeren.');
        break;
      }
      STATE.currentScreen = 'monitor_manual';
      STATE.homeTab = 'monitor';
      STATE.monitorManualContext = { sticker: STATE.currentMonitor.sticker, mode: 'correction' };
      STATE.monitorSelectedGrade = null;
      STATE.manualError = '';
      break;
    case 'monitor_scan_reset':
      STATE.currentMonitor = null;
      STATE.monitorSelectedGrade = null;
      STATE.monitorScanSearch = '';
      break;
    case 'monitor_identity_reset':
      if (STATE.currentMonitor) {
        STATE.currentMonitor.identityChoice = null;
        STATE.monitorSelectedGrade = null;
      }
      break;
    case 'home_support':
      if (!canUseSupportUser()) {
        STATE.homeTab = 'workflow';
        setAppMessage('This account only has access to Labeling.');
        break;
      }
      STATE.currentScreen = 'home';
      STATE.homeTab = 'support';
      STATE.currentLaptop = null;
      STATE.currentMonitor = null;
      STATE.currentGrading = null;
      STATE.pendingDecision = null;
      break;
    case 'scan':
      STATE.currentScreen = isStickerUser() ? 'sticker_scan' : 'scan';
      STATE.currentMonitor = null;
      STATE.manualError = '';
      STATE.scanSearch = '';
      break;
    case 'manual':
      if (!canGradeUser()) {
        setAppMessage('Only graders and managers can use Manual Entry.');
        break;
      }
      STATE.currentScreen = 'manual';
      STATE.manualError = '';
      break;
    case 'grading_test':
      if (!canGradeUser()) {
        setAppMessage('Only graders and managers can run Test Grading.');
        break;
      }
      STATE.currentScreen = 'test_start';
      break;
    case 'import':
      STATE.currentScreen = 'import';
      break;
    case 'accounts':
      STATE.currentScreen = 'accounts';
      break;
    case 'login_password':
      await loginWithPassword();
      return;
    case 'create_user':
      await createUserFromForm();
      return;
    case 'update_user':
      await updateUserFromRow(el.dataset.userId);
      return;
    case 'delete_user':
      deleteUser(el.dataset.userId);
      return;
    case 'cancel_decision':
      cancelPendingDecision();
      break;
    case 'history':
      if (!canUseSupportUser()) {
        setAppMessage('This account has no access to History or Insights.');
        break;
      }
      STATE.currentScreen = 'history';
      STATE.historyPage = 1;
      STATE.historyOpenId = null;
      break;
    case 'history_prev':
      STATE.historyPage = Math.max(1, (STATE.historyPage || 1) - 1);
      STATE.historyOpenId = null;
      break;
    case 'history_next':
      STATE.historyPage = (STATE.historyPage || 1) + 1;
      STATE.historyOpenId = null;
      break;
    case 'explain':
      if (!canUseSupportUser()) {
        setAppMessage('This account only has access to Labeling.');
        break;
      }
      STATE.currentScreen = 'explain';
      break;
    case 'analytics':
      if (!canUseSupportUser()) {
        setAppMessage('This account has no access to Insights.');
        break;
      }
      STATE.currentScreen = 'analytics';
      break;
    case 'export_supplier_comparison':
      await exportSupplierComparison(el.dataset.exportBatch || 'all');
      return;
    case 'remove_laptop':
      if (!isAdminUser()) return;
      if (confirm(`Delete device ${el.dataset.removeSticker} from the active list?`)) {
        if (removeLaptopFromBatches(el.dataset.removeSticker)) {
          logAudit('remove_laptop', 'laptop', el.dataset.removeSticker);
          saveSharedDemoState();
          setAppMessage(`Device ${el.dataset.removeSticker} deleted from the active list.`, 'success');
        }
      }
      break;
    case 'remove_batch':
      if (!isAdminUser()) return;
      if (confirm('Delete this full batch from the active list?')) {
        if (removeBatch(el.dataset.removeBatch)) {
          logAudit('remove_batch', 'batch', el.dataset.removeBatch);
          saveSharedDemoState();
          setAppMessage('Batch deleted from the active list.', 'success');
        }
      }
      break;
    case 'remove_monitor':
      if (!isAdminUser()) return;
      if (confirm(`Delete monitor ${el.dataset.removeMonitor} from the active monitor list?`)) {
        if (removeMonitorFromBatches(el.dataset.removeMonitor)) {
          logAudit('remove_monitor', 'monitor', el.dataset.removeMonitor);
          saveSharedDemoState();
          setAppMessage(`Monitor ${el.dataset.removeMonitor} deleted from the active list.`, 'success');
        }
      }
      break;
    case 'remove_monitor_batch':
      if (!isAdminUser()) return;
      if (confirm('Delete this full monitor batch from the active list?')) {
        if (removeMonitorBatch(el.dataset.removeMonitorBatch)) {
          logAudit('remove_monitor_batch', 'monitor_batch', el.dataset.removeMonitorBatch);
          saveSharedDemoState();
          setAppMessage('Monitor batch deleted from the active list.', 'success');
        }
      }
      break;
    case 'manual_submit':
      const merk = document.getElementById('m_merk').value.trim();
      const model = document.getElementById('m_model').value.trim();
      const manualSticker = document.getElementById('m_sticker').value.trim();
      if (!merk || !model) {
        STATE.manualError = 'Brand and model are required.';
        render();
        return;
      }
      if (manualSticker && isKnownSticker(manualSticker)) {
        STATE.manualError = `Barcode ${manualSticker} already exists in active batches or history. Use a unique barcode or leave it empty for a test/return entry.`;
        render();
        return;
      }
      STATE.currentLaptop = {
        sticker: manualSticker || 'manual_' + Date.now(),
        merk, model,
        serial: document.getElementById('m_serial').value.trim(),
        processor: document.getElementById('m_processor').value.trim(),
        ram: document.getElementById('m_ram').value.trim(),
        ssd: document.getElementById('m_ssd').value.trim(),
        display: document.getElementById('m_display').value.trim(),
        battery: document.getElementById('m_battery').value.trim(),
        gpu: document.getElementById('m_gpu').value.trim(),
        herkomst: document.getElementById('m_herkomst').value.trim() || 'manual',
        batchNummer: 'Manual',
        leverancier_class: '',
        meldingen: '',
      };
      STATE.manualError = '';
      setAppMessage(null);
      STATE.currentScreen = 'laptop_info';
      break;
    case 'monitor_manual_submit':
      await submitMonitorManualEntry();
      return;
    case 'back_scan':
      STATE.currentScreen = isStickerUser() ? 'sticker_scan' : STATE.currentLaptop && STATE.currentLaptop.herkomst ? 'manual' : 'scan';
      break;
    case 'start_beginner':
      if (!canGradeUser()) {
        setAppMessage('This account cannot grade. Print specs labels only.');
        break;
      }
      startGrading('beginner');
      break;
    case 'start_expert':
      if (!canGradeUser()) {
        setAppMessage('This account cannot grade. Print specs labels only.');
        break;
      }
      if (!canUseExpertMode()) {
        setAppMessage('Expert Mode is only available for manager accounts. Use Guided Mode for grading.');
        break;
      }
      startGrading('expert');
      break;
    case 'start_test_beginner':
      if (!canGradeUser()) {
        setAppMessage('Only graders and managers can run Test Grading.');
        break;
      }
      startTestGrading('beginner');
      break;
    case 'start_test_expert':
      if (!canGradeUser()) {
        setAppMessage('Only graders and managers can run Test Grading.');
        break;
      }
      if (!canUseExpertMode()) {
        setAppMessage('Expert Mode is only available for manager accounts. Use Guided Mode for grading.');
        break;
      }
      startTestGrading('expert');
      break;
    case 'prev_q':
      STATE.currentGrading.huidigeIndex--;
      break;
    case 'next_q':
      if (STATE.currentGrading.huidigeIndex < getGradingOnderdelen().length - 1) {
        STATE.currentGrading.huidigeIndex++;
      } else {
        finishGrading();
      }
      break;
    case 'confirm_expert':
      finishGrading();
      break;
    case 'print_specs_label':
      await printCurrentLabel('specs');
      return;
    case 'print_problem_label':
      await printCurrentLabel('problems');
      return;
    case 'print_supplier_specs_label':
      await printSupplierLabel('specs');
      return;
    case 'print_supplier_problem_label':
      await printSupplierLabel('problems');
      return;
    case 'adjust':
      STATE.currentScreen = STATE.currentGrading.modus === 'beginner' ? 'grading_beginner' : 'grading_expert';
      if (STATE.currentGrading.modus === 'beginner') {
      STATE.currentGrading.huidigeIndex = 0;
      }
      break;
    case 'confirm_save':
      await confirmSaveWithAutomaticLabels();
      return;
    case 'finish_test':
      STATE.currentLaptop = null;
      STATE.currentGrading = null;
      STATE.pendingDecision = null;
      STATE.currentScreen = 'home';
      STATE.homeTab = 'workflow';
      break;
    case 'new_test':
      startTestGrading(STATE.currentGrading ? STATE.currentGrading.modus : 'expert');
      break;
  }
  render();
}

function readFormValue(id) {
  const field = document.getElementById(id);
  return field && typeof field.value === 'string' ? field.value.trim() : '';
}

function readMonitorManualVideoInputs() {
  const selects = Array.from(document.querySelectorAll('[data-monitor-video-port-select]') || []);
  if (selects.length) {
    const countSelects = Array.from(document.querySelectorAll('[data-monitor-video-port-count-select]') || []);
    const parts = selects
      .map((field, index) => {
        const label = field.value || '';
        const count = Math.max(1, Math.min(2, Number(countSelects[index] && countSelects[index].value || 1)));
        if (!label) return '';
        return count > 1 ? `${count}x ${label}` : label;
      })
      .filter(Boolean);
    return parts.join(' / ');
  }
  const fields = Array.from(document.querySelectorAll('[data-monitor-video-port-count]:checked') || []);
  const parts = fields
    .map(field => {
      const count = Math.max(0, Math.min(9, Number(field.value || 0)));
      const label = field.dataset ? field.dataset.monitorVideoPortCount : '';
      if (!count || !label) return '';
      return count > 1 ? `${count}x ${label}` : label;
    })
    .filter(Boolean);
  return parts.length ? parts.join(' / ') : readFormValue('mm_video_inputs');
}

async function submitMonitorManualEntry() {
  const sourceMonitor = STATE.currentMonitor && STATE.currentMonitor.sticker ? STATE.currentMonitor : null;
  const merk = readFormValue('mm_merk');
  const serie = readFormValue('mm_series');
  const modelNumber = readFormValue('mm_model');
  const model = typeof buildMonitorManualModelName === 'function' ? buildMonitorManualModelName(merk, serie, modelNumber) : [serie, modelNumber].filter(Boolean).join(' ');
  const deviceName = typeof buildMonitorDeviceName === 'function' ? buildMonitorDeviceName(merk, serie, modelNumber) : `${merk} ${model}`.trim();
  const enteredSticker = readFormValue('mm_sticker');
  const sticker = enteredSticker || (sourceMonitor && sourceMonitor.sticker) || `monitor_manual_${Date.now()}`;

  if (!merk || !modelNumber) {
    STATE.manualError = 'Merk en modelnummer zijn verplicht.';
    render();
    return false;
  }

  if (isMonitorLabelPrinted(sticker)) {
    STATE.manualError = `Voor barcode ${sticker} is al een monitorlabel geprint. Gebruik een nieuwe barcode of verwijder eerst het bestaande resultaat.`;
    render();
    return false;
  }

  const displayRaw = readFormValue('mm_display');
  const monitor = upsertManualMonitor({
    sticker,
    merk,
    model,
    serie,
    modelNumber,
    deviceName,
    serial: readFormValue('mm_serial'),
    display: typeof formatDisplay === 'function' ? formatDisplay(displayRaw) : displayRaw,
    resolution: readFormValue('mm_resolution'),
    videoInputs: readMonitorManualVideoInputs(),
    herkomst: readFormValue('mm_herkomst') || (sourceMonitor ? sourceMonitor.herkomst : 'handmatige monitorinvoer'),
  }, sourceMonitor);

  STATE.currentMonitor = monitor;
  STATE.currentScreen = 'monitor_label_scan';
  STATE.homeTab = 'monitor';
  STATE.monitorSelectedGrade = null;
  STATE.monitorScanSearch = '';
  STATE.manualError = '';
  STATE.monitorManualContext = null;
  setAppMessage(sourceMonitor
    ? `Monitorgegevens voor barcode ${monitor.sticker} zijn gecorrigeerd. Kies nu de definitieve grade.`
    : `Handmatige monitor ${monitor.deviceName} is toegevoegd. Kies nu de definitieve grade.`,
    'success');
  await saveSharedDemoState();
  render();
  return true;
}

function selectLaptop(sticker) {
  const cleanSticker = String(sticker || '').trim();
  const l = getLaptopBySticker(sticker);
  if (!l) {
    setAppMessage(`Barcode ${cleanSticker || '-'} not found. Search again or use Manual Entry for returns.`);
    render();
    return;
  }
  if (isLaptopGraded(l.sticker)) {
    setAppMessage(`Barcode ${cleanSticker || l.sticker} is already graded in this session.`);
    render();
    return;
  }
  if (isLaptopLabelPrinted(l.sticker)) {
    setAppMessage(`Barcode ${cleanSticker || l.sticker} already has a specs label and is complete in the digital workflow.`);
    render();
    return;
  }
  STATE.currentLaptop = l;
  STATE.currentScreen = 'laptop_info';
  STATE.scanSearch = '';
  setAppMessage(null);
  render();
}

async function scanAndPrintStickerLabel(sticker, options = {}) {
  const cleanSticker = String(sticker || '').trim();
  if (!cleanSticker) {
    setAppMessage('Scan or enter a barcode first.');
    render();
    return false;
  }

  const laptop = getLaptopBySticker(cleanSticker);
  if (!laptop) {
    setAppMessage(`Barcode ${cleanSticker} not found in active batches.`);
    render();
    return false;
  }

  STATE.currentScreen = 'sticker_scan';
  STATE.currentLaptop = laptop;
  STATE.currentGrading = null;
  STATE.pendingDecision = null;
  STATE.scanSearch = '';

  if (isLaptopGraded(laptop.sticker)) {
    setAppMessage(`Barcode ${cleanSticker} is already graded and no longer in Labeling.`);
    STATE.currentLaptop = null;
    render();
    return false;
  }

  if (isLaptopLabelPrinted(laptop.sticker)) {
    setAppMessage(`Specs label with blank grade line was already printed for barcode ${cleanSticker}.`);
    STATE.currentLaptop = null;
    render();
    return false;
  }

  const supplierResult = { eindgrade: '', problems: [] };
  const printTypes = ['specs'];
  if (needsProblemLabel(laptop, supplierResult)) printTypes.push('problems');
  const preparedWindows = {};
  if (typeof window !== 'undefined' && typeof window.open === 'function') {
    printTypes.forEach(type => {
      preparedWindows[type] = createPreparedPrintWindow(type);
    });
  }

  for (const type of printTypes) {
    const printed = await printLabelFor(laptop, supplierResult, type, {
      hideGrade: type === 'specs',
      preparedWindow: preparedWindows[type],
      suppressMessage: true,
    });

    if (!printed) {
      setAppMessage(`Label for barcode ${cleanSticker} could not be printed automatically.`);
      render();
      return false;
    }
  }

  recordStickerLabelPrint(laptop);
  await saveSharedDemoState();
  STATE.currentLaptop = null;
  setAppMessage(printTypes.length > 1
    ? `Specs label with blank grade line and repair label printed for ${laptop.sticker}. Device completed.`
    : `Specs label with blank grade line printed for ${laptop.sticker}. Device completed.`,
    'success');
  render();
  return true;
}

function selectMonitorForLabel(sticker) {
  const cleanSticker = String(sticker || '').trim();
  if (!cleanSticker) {
    setAppMessage('Scan or enter a monitor barcode first.');
    render();
    return false;
  }

  const monitor = getMonitorBySticker(cleanSticker);
  if (!monitor) {
    setAppMessage(`Monitor barcode ${cleanSticker} not found in active monitor batches.`);
    render();
    return false;
  }

  STATE.currentScreen = 'monitor_label_scan';
  STATE.homeTab = 'monitor';
  STATE.currentMonitor = monitor;
  STATE.monitorSelectedGrade = null;
  STATE.monitorScanSearch = '';

  if (isMonitorLabelPrinted(monitor.sticker)) {
    setAppMessage(`Monitor label was already printed for barcode ${cleanSticker}.`);
    STATE.currentMonitor = null;
    render();
    return false;
  }

  setAppMessage(null);
  render();
  return true;
}

function chooseMonitorIdentityForLabel(optionIndex) {
  if (!STATE.currentMonitor) {
    setAppMessage('Scan or selecteer eerst een monitor.');
    render();
    return false;
  }
  if (!applyMonitorIdentityChoice(STATE.currentMonitor, optionIndex)) {
    setAppMessage('Deze monitornaam kon niet worden gekozen. Probeer opnieuw.');
    render();
    return false;
  }
  STATE.monitorSelectedGrade = null;
  setAppMessage(null);
  render();
  return true;
}

async function scanAndPrintMonitorLabel(sticker, grade = STATE.monitorSelectedGrade, options = {}) {
  const cleanSticker = String(sticker || '').trim();
  const normalizedGrade = normalizeMonitorGrade(grade);
  if (!cleanSticker) {
    setAppMessage('Scan or enter a monitor barcode first.');
    render();
    return false;
  }

  const monitor = getMonitorBySticker(cleanSticker);
  if (!monitor) {
    setAppMessage(`Monitor barcode ${cleanSticker} not found in active monitor batches.`);
    render();
    return false;
  }

  STATE.currentScreen = 'monitor_label_scan';
  STATE.homeTab = 'monitor';
  STATE.currentMonitor = monitor;
  STATE.monitorSelectedGrade = normalizedGrade;
  STATE.monitorScanSearch = '';

  if (isMonitorLabelPrinted(monitor.sticker)) {
    setAppMessage(`Monitor label was already printed for barcode ${cleanSticker}.`);
    STATE.currentMonitor = null;
    STATE.monitorSelectedGrade = null;
    render();
    return false;
  }

  if (monitorNeedsIdentityChoice(monitor)) {
    setAppMessage('Kies eerst welke monitornaam hoort bij deze sticker. Daarna kun je de grade kiezen.');
    STATE.currentMonitor = monitor;
    STATE.monitorSelectedGrade = null;
    render();
    return false;
  }

  const preparedWindow = typeof window !== 'undefined' && typeof window.open === 'function'
    ? createPreparedPrintWindow('monitor')
    : null;
  const printed = await printMonitorLabelFor(monitor, normalizedGrade, {
    preparedWindow,
    suppressMessage: true,
  });

  if (!printed) {
    setAppMessage(`Monitor label for barcode ${cleanSticker} could not be printed automatically.`);
    STATE.currentMonitor = monitor;
    render();
    return false;
  }

  recordMonitorLabelPrint(monitor, normalizedGrade);
  await saveSharedDemoState();
  STATE.currentMonitor = null;
  STATE.monitorSelectedGrade = null;
  setAppMessage(`Monitor label printed for ${monitor.deviceName || monitor.model || monitor.sticker} with grade ${displayMonitorGrade(normalizedGrade)}.`, 'success');
  render();
  return true;
}

async function loginWithPassword() {
  const id = document.getElementById('loginUser').value;
  const password = document.getElementById('loginPassword').value;
  const user = USERS.find(u => u.id === id);
  const passwordHash = await hashDemoPassword(password);
  if (!user || user.passwordHash !== passwordHash) {
    setAppMessage('Incorrect login or password.');
    render();
    return;
  }
  STATE.currentUser = user;
  saveSessionUser(user);
  STATE.currentScreen = 'home';
  STATE.homeTab = 'workflow';
  setAppMessage(null);
  render();
}

async function createUserFromForm() {
  if (!isAdminUser()) return;
  const naam = normalizeText(document.getElementById('newUserName').value);
  const id = normalizeText(document.getElementById('newUserId').value).toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const rol = normalizeUserRole(document.getElementById('newUserRole').value);
  const voorkeur = normalizeUserPreference(document.getElementById('newUserMode').value, rol);
  const wachtwoord = document.getElementById('newUserPassword').value;
  if (!naam || !id || !wachtwoord) {
    setAppMessage('Name, login ID and password are required.');
    render();
    return;
  }
  if (USERS.some(u => u.id === id)) {
    setAppMessage('This login ID already exists.');
    render();
    return;
  }
  const passwordHash = await hashDemoPassword(wachtwoord);
  USERS.push({ id, naam: sanitizeExternalText(naam, 80), rol, initialen: initialsFromName(naam), voorkeur, passwordHash });
  saveUsers();
  logAudit('create_user', 'user', id, { rol, voorkeur });
  await saveSharedDemoState();
  setAppMessage(`User ${naam} created.`, 'success');
  render();
}

async function updateUserFromRow(id) {
  if (!isAdminUser()) return;
  const user = USERS.find(u => u.id === id);
  if (!user) return;
  const roleInput = document.querySelector(`[data-account-role="${id}"]`);
  const modeInput = document.querySelector(`[data-account-mode="${id}"]`);
  const passwordInput = document.querySelector(`[data-account-password="${id}"]`);
  user.rol = normalizeUserRole(roleInput ? roleInput.value : user.rol);
  user.voorkeur = normalizeUserPreference(modeInput ? modeInput.value : user.voorkeur, user.rol);
  if (passwordInput && passwordInput.value) user.passwordHash = await hashDemoPassword(passwordInput.value);
  if (STATE.currentUser && STATE.currentUser.id === id) {
    STATE.currentUser = user;
    saveSessionUser(user);
  }
  saveUsers();
  logAudit('update_user', 'user', id, { rol: user.rol, voorkeur: user.voorkeur, passwordChanged: Boolean(passwordInput && passwordInput.value) });
  await saveSharedDemoState();
  setAppMessage(`User ${user.naam} updated.`, 'success');
  render();
}

function deleteUser(id) {
  if (!isAdminUser()) return;
  if (STATE.currentUser && STATE.currentUser.id === id) return;
  const index = USERS.findIndex(u => u.id === id);
  if (index < 0) return;
  if (!confirm(`Delete user ${USERS[index].naam}?`)) return;
  logAudit('delete_user', 'user', id, { naam: USERS[index].naam });
  USERS.splice(index, 1);
  saveUsers();
  saveSharedDemoState();
  setAppMessage('User deleted.', 'success');
  render();
}

function startTestGrading(modus) {
  if (!canGradeUser()) {
    setAppMessage('This account cannot start Test Grading.');
    render();
    return;
  }
  STATE.currentLaptop = {
    sticker: `test_${Date.now()}`,
    merk: 'Grading',
    model: 'Test',
    serial: '',
    processor: '',
    ram: '',
    ssd: '',
    display: '',
    battery: '',
    gpu: '',
    herkomst: 'grading-test',
    batchNummer: 'Grading-test',
    leverancier_class: '',
    meldingen: '',
    testOnly: true,
  };
  startGrading(modus);
}

function startGrading(modus) {
  if (!canGradeUser()) {
    setAppMessage('This account cannot grade. Print specs labels only.');
    render();
    return;
  }
  STATE.currentGrading = {
    laptop_sticker: STATE.currentLaptop.sticker,
    modus,
    huidigeIndex: 0,
    keuzes: {},
    triggers: {},
    impactOverrides: {},
    gradeReviewDone: false,
    finalGradeOverride: null,
    gestart: Date.now(),
    testOnly: Boolean(STATE.currentLaptop && STATE.currentLaptop.testOnly),
    result: null,
  };
  STATE.currentScreen = modus === 'beginner' ? 'grading_beginner' : 'grading_expert';
}

function finishGrading() {
  STATE.pendingDecision = null;
  const missing = getMissingGradingOnderdelen(STATE.currentGrading);
  if (missing.length) {
    setAppMessage(`Complete all checks first: ${missing.map(ond => ond.naam).join(', ')}`);
    render();
    return;
  }
  STATE.currentGrading.result = calculateGrade(STATE.currentGrading.keuzes, STATE.currentGrading.triggers, STATE.currentGrading.impactOverrides);
  STATE.currentGrading.result.rulesVersion = GRADING_RULES_VERSION;
  STATE.currentGrading.result.problems = buildProblemRows(STATE.currentGrading.keuzes, STATE.currentGrading.triggers, STATE.currentGrading.impactOverrides);
  const borderlineReview = !STATE.currentGrading.gradeReviewDone ? getBorderlineAReview(STATE.currentGrading.result) : null;
  if (borderlineReview) {
    STATE.pendingDecision = borderlineReview;
    return;
  }
  if (STATE.currentGrading.finalGradeOverride) {
    STATE.currentGrading.result.eindgrade = STATE.currentGrading.finalGradeOverride;
  }
  STATE.currentGrading.bevestigd = Date.now();
  STATE.currentScreen = 'result';
}

function getMissingGradingOnderdelen(grading) {
  if (!grading) return getGradingOnderdelen();
  return getGradingOnderdelen().filter(ond => !grading.keuzes[ond.id]);
}

// HTML escaping lives in assets/app-state.js.

function saveGrading() {
  const g = STATE.currentGrading;
  const l = STATE.currentLaptop;
  const duurSec = Math.round((g.bevestigd - g.gestart) / 1000);
  
  const historyItem = {
    id: `grading_${Date.now()}_${String(l.sticker || '').replace(/[^\w.-]/g, '')}`,
    sticker: l.sticker,
    merk: l.merk,
    model: l.model,
    serial: l.serial,
    batchId: l.batchId,
    batchNummer: l.batchNummer,
    herkomst: l.herkomst,
    leverancier_class: l.leverancier_class,
    leverancier_meldingen: l.meldingen,
    grade: g.result.eindgrade,
    score: g.result.score,
    processor: l.processor,
    ram: l.ram,
    ssd: l.ssd,
    display: l.display,
    battery: l.battery,
    gpu: l.gpu,
    user_id: STATE.currentUser.id,
    user_naam: STATE.currentUser.naam,
    modus: g.modus,
    rulesVersion: GRADING_RULES_VERSION,
    tijd: new Date().toLocaleTimeString('nl-NL', {hour: '2-digit', minute: '2-digit'}),
    duurSec,
    keuzes: g.keuzes,
    triggers: g.triggers,
    impactOverrides: g.impactOverrides,
    finalGradeOverride: g.finalGradeOverride,
    result: g.result,
  };
  STATE.history.push(historyItem);
  GRADED_STICKERS.add(String(l.sticker || ''));
  ensureHistorySearchIndex(historyItem);
  logAudit('save_grading', 'laptop', l.sticker, { grade: g.result.eindgrade, score: g.result.score, rulesVersion: GRADING_RULES_VERSION });
  saveSharedDemoState();
  
  STATE.currentLaptop = null;
  STATE.currentGrading = null;
  STATE.pendingDecision = null;
  STATE.currentScreen = 'home';
  STATE.homeTab = 'workflow';
}

async function confirmSaveWithAutomaticLabels() {
  const g = STATE.currentGrading;
  const l = STATE.currentLaptop;
  if (!g || !l || !g.result) {
    setAppMessage('There is no result to confirm yet.');
    render();
    return;
  }

  const printTypes = ['specs'];
  if (needsProblemLabel(l, g.result)) printTypes.push('problems');
  const preparedWindows = {};
  printTypes.forEach(type => {
    preparedWindows[type] = createPreparedPrintWindow(type);
  });

  for (const type of printTypes) {
    const printed = await printLabelFor(l, g.result, type, {
      preparedWindow: preparedWindows[type],
      suppressMessage: true,
    });
    if (!printed) {
      setAppMessage('Automatic label printing failed. The grading was not saved, so you can confirm again.');
      render();
      return;
    }
  }

  saveGrading();
  setAppMessage(printTypes.length > 1
    ? 'Specs and repair labels printed. Grading saved.'
    : 'Specs label printed. Grading saved.',
    'success');
  render();
}

