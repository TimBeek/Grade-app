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
    return resolvePendingDecision(Number(button.dataset.decisionOption));
  });

  // "i"-knopje en statistieken-knop zitten NAAST/IN een data-action-kaart. Ze
  // krijgen hun eigen onclick (met stopPropagation) zodat een klik erop niet
  // doorslaat naar de navigatie-actie van de omliggende kaart.
  bindClick('[data-action-info]', button => {
    const key = button.dataset.actionInfo;
    STATE.homeInfoCard = STATE.homeInfoCard === key ? null : key;
    render();
  });

  bindClick('[data-batch-stats]', button => {
    const id = button.dataset.batchStats;
    STATE.expandedBatchStats = STATE.expandedBatchStats === id ? null : id;
    render();
  });

  bindClick('[data-action]', button => handleAction(button.dataset.action, button));

  bindClick('[data-history-toggle]', button => {
    const id = button.dataset.historyToggle;
    STATE.historyOpenId = STATE.historyOpenId === id ? null : id;
    render();
  });

  bindClick('[data-sticker]', button => selectLaptop(button.dataset.sticker));

  bindClick('[data-sticker-label]', button => {
    return scanAndPrintStickerLabel(button.dataset.stickerLabel, { source: 'list' });
  });

  bindClick('[data-reprint-laptop]', button => {
    return reprintCompletedLaptopLabels(button.dataset.reprintLaptop, { source: 'list' });
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
    if (!STATE.currentMonitor || STATE.monitorPrintInProgress) return;
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

  bindClick('[data-expert-final-grade]', button => {
    return confirmExpertFinalGrade(button.dataset.expertFinalGrade);
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
    const previewTarget = e.target.closest('[data-image-preview]');
    if (previewTarget) {
      e.preventDefault();
      e.stopPropagation();
      openImagePreviewFromElement(previewTarget);
      return;
    }
    await resolvePendingDecision(Number(decisionButton.dataset.decisionOption));
    return;
  }

  const actionButton = e.target.closest('[data-action]');
  if (actionButton) {
    await handleAction(actionButton.dataset.action, actionButton);
    return;
  }

  const monitorPortCountButton = e.target.closest('[data-monitor-video-port-count-button]');
  if (monitorPortCountButton) {
    setMonitorManualPortCount(monitorPortCountButton);
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
    await selectLaptop(stickerButton.dataset.sticker);
    return;
  }

  const stickerLabelButton = e.target.closest('[data-sticker-label]');
  if (stickerLabelButton) {
    await scanAndPrintStickerLabel(stickerLabelButton.dataset.stickerLabel, { source: 'list' });
    return;
  }

  const reprintLaptopButton = e.target.closest('[data-reprint-laptop]');
  if (reprintLaptopButton) {
    await reprintCompletedLaptopLabels(reprintLaptopButton.dataset.reprintLaptop, { source: 'list' });
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
    if (STATE.currentMonitor && !STATE.monitorPrintInProgress) {
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
    return;
  }

  const expertFinalButton = e.target.closest('[data-expert-final-grade]');
  if (expertFinalButton) {
    if (!canGradeUser()) return;
    await confirmExpertFinalGrade(expertFinalButton.dataset.expertFinalGrade);
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

function setMonitorManualPortCount(button) {
  if (!button) return;
  // De medewerker kiest zelf een poort: vanaf nu handmatig, niet meer 'auto'.
  // Een databasematch voor hetzelfde model overschrijft deze keuze dus niet.
  STATE.monitorManualPortsAutoFilled = false;
  const port = button.dataset.port || '';
  const count = Math.max(0, Math.min(2, Number(button.dataset.count || 0)));
  const group = button.closest('.monitor-manual-port-option');
  const input = group ? Array.from(group.querySelectorAll('[data-monitor-video-port-count-select]')).find(field => field.dataset && field.dataset.monitorVideoPort === port) : null;
  if (input) input.value = String(count);
  if (group) {
    group.querySelectorAll('[data-monitor-video-port-count-button]').forEach(item => {
      const active = item === button;
      item.classList.toggle('active', active);
      item.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }
}

async function handleDelegatedChange(e) {
  if (e.target.matches('[data-analytics-filter]')) {
    setAnalyticsFilter(e.target.dataset.analyticsFilter, e.target.value);
    render();
    return;
  }

  if (e.target.matches('[data-trigger]')) {
    STATE.currentGrading.triggers[e.target.dataset.trigger] = e.target.checked;
    return;
  }

  if (e.target.id === 'newUserRole') {
    syncModeSelectForRole(e.target.value, document.getElementById('newUserMode'));
    return;
  }

  if (e.target.id === 'mm_merk' || e.target.id === 'mm_series' || e.target.id === 'mm_model') {
    if (e.target.id === 'mm_series' && e.target.dataset) e.target.dataset.autoFilled = 'false';
    syncMonitorManualDatabaseAssist();
    return;
  }

  // Handmatig aangepaste resolutie/schermformaat horen voortaan bij de
  // medewerker: niet meer als 'auto' behandelen, zodat de auto-clear ze niet wist.
  if (e.target.id === 'mm_resolution' || e.target.id === 'mm_display') {
    if (e.target.dataset) e.target.dataset.autoFilled = 'false';
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
        await saveSharedDemoState(getImportRestoreOptions());
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
  if (e.target.id === 'analyticsSearch') {
    scheduleAnalyticsSearch(e.target.value);
    return;
  }

  if (e.target.id === 'mm_merk' || e.target.id === 'mm_series' || e.target.id === 'mm_model') {
    if (e.target.id === 'mm_series' && e.target.dataset) e.target.dataset.autoFilled = 'false';
    syncMonitorManualDatabaseAssist();
    return;
  }
  if (e.target.id === 'mm_resolution' || e.target.id === 'mm_display') {
    if (e.target.dataset) e.target.dataset.autoFilled = 'false';
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

function getImportRestoreOptions(result = STATE.importResult) {
  const batches = Array.isArray(result && result.batches) ? result.batches : [];
  const monitorBatches = Array.isArray(result && result.monitorBatches) ? result.monitorBatches : [];
  const laptops = Array.isArray(result && result.laptops) ? result.laptops : [];
  const monitors = Array.isArray(result && result.monitors) ? result.monitors : [];
  return {
    restoreDeletedBatchIds: batches.map(batch => batch && batch.id).filter(Boolean),
    restoreDeletedLaptopStickers: laptops.map(laptop => laptop && laptop.sticker).filter(Boolean),
    restoreDeletedMonitorBatchIds: monitorBatches.map(batch => batch && batch.id).filter(Boolean),
    restoreDeletedMonitorStickers: monitors.map(monitor => monitor && monitor.sticker).filter(Boolean),
  };
}

// Stabiele identiteit van een databasematch. Twee invoervarianten die naar
// hetzelfde databasemodel wijzen (bv. "Dell" vs "DELL") leveren dezelfde sleutel
// op, zodat we de automatische invulling niet bij elke toetsaanslag opnieuw
// toepassen (en handmatige correcties niet steeds overschrijven).
function monitorManualMatchKey(match) {
  if (!match || !match.model) return null;
  const key = typeof normalizeMonitorLookupKey === 'function'
    ? normalizeMonitorLookupKey(match.model)
    : String(match.model).toLowerCase().replace(/[^a-z0-9]/g, '');
  return key || null;
}

// Context-sleutel van het huidige model. Een databasematch krijgt "db:<model>",
// een onbekend model "raw:<modelnummer>". Zolang deze sleutel gelijk blijft,
// laten we de al ingevulde/gecorrigeerde gegevens met rust; verandert hij, dan
// is het een ander model en frissen we alles op (zodat niets blijft hangen).
function monitorManualAssistKey(match, model) {
  if (match) return 'db:' + (monitorManualMatchKey(match) || '');
  const raw = typeof normalizeMonitorLookupKey === 'function'
    ? normalizeMonitorLookupKey(model)
    : String(model || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return raw ? 'raw:' + raw : null;
}

// Sleutel die hoort bij een reeds opgeslagen monitor. Gebruikt om de
// correctie-flow te "seeden": zolang het model niet echt verandert, blijven de
// bestaande (echte) gegevens staan.
function monitorManualMatchKeyForMonitor(monitor) {
  if (!monitor) return null;
  const merk = monitor.merk || '';
  const series = monitor.serie || '';
  const model = monitor.modelNumber || monitor.model || '';
  const match = typeof findMonitorManualDatabaseMatch === 'function' ? findMonitorManualDatabaseMatch(merk, series, model) : null;
  return monitorManualAssistKey(match, model);
}

// Zet alle video-in poorten terug naar 0 (bij een modelwissel). Onbekend model
// = handmatig terrein, dus de poorten zijn daarna niet meer 'auto'.
function resetMonitorManualPorts() {
  applyMonitorManualVideoInputsToPicker('');
  STATE.monitorManualPortsAutoFilled = false;
}

function syncMonitorManualDatabaseAssist() {
  if (STATE.currentScreen !== 'monitor_manual') return;
  const merk = readFormValue('mm_merk');
  const series = readFormValue('mm_series');
  const model = readFormValue('mm_model');
  updateMonitorManualSeriesSuggestions(merk, series);
  updateMonitorManualModelSuggestions(merk, series, model);
  const match = typeof findMonitorManualDatabaseMatch === 'function' ? findMonitorManualDatabaseMatch(merk, series, model) : null;
  const key = monitorManualAssistKey(match, model);
  // Alleen ingrijpen wanneer de model-CONTEXT wijzigt. Zolang je binnen
  // hetzelfde (database- of onbekende) model blijft, laten we handmatige
  // correcties (poorten, resolutie) met rust.
  if (key !== STATE.monitorManualAutoKey) {
    STATE.monitorManualAutoKey = key;
    if (match) {
      applyMonitorManualDatabaseMatch(match);
    } else {
      // Ander/onbekend model: automatisch ingevulde specs wissen én de video-in
      // poorten terugzetten, zodat niets van het vorige model blijft hangen.
      clearAutoFilledMonitorManualFields();
      resetMonitorManualPorts();
    }
  }
  updateMonitorManualDevicePreview(readFormValue('mm_merk'), readFormValue('mm_series'), readFormValue('mm_model'));
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

function setAutoFilledFormValue(id, value) {
  const field = document.getElementById(id);
  if (!field || value === undefined || value === null) return;
  field.value = String(value);
  if (field.dataset) field.dataset.autoFilled = 'true';
}

function clearAutoFilledMonitorManualFields() {
  // Alleen de automatisch ingevulde tekstvelden wissen. De video-in poorten
  // worden apart via resetMonitorManualPorts() teruggezet bij een modelwissel.
  ['mm_series', 'mm_resolution', 'mm_display'].forEach(id => {
    const field = document.getElementById(id);
    if (field && field.dataset && field.dataset.autoFilled === 'true') {
      field.value = '';
      field.dataset.autoFilled = 'false';
    }
  });
  updateMonitorManualDevicePreview(readFormValue('mm_merk'), readFormValue('mm_series'), readFormValue('mm_model'));
}

function applyMonitorManualDatabaseMatch(match) {
  if (!match) return;
  if (typeof splitMonitorModelParts === 'function' && typeof getMonitorDatabaseBrandName === 'function') {
    const parts = splitMonitorModelParts(match.model, getMonitorDatabaseBrandName(match));
    const brandField = document.getElementById('mm_merk');
    const seriesField = document.getElementById('mm_series');
    const modelField = document.getElementById('mm_model');
    if (parts.brand && brandField && !readFormValue('mm_merk')) setAutoFilledFormValue('mm_merk', parts.brand);
    if (seriesField && (parts.series || seriesField.dataset.autoFilled === 'true')) {
      if (!readFormValue('mm_series') || seriesField.dataset.autoFilled === 'true') setAutoFilledFormValue('mm_series', parts.series || '');
    }
    if (parts.modelNumber && modelField && !readFormValue('mm_model')) setAutoFilledFormValue('mm_model', parts.modelNumber);
  }
  setAutoFilledFormValue('mm_resolution', match.resolution || '');
  // Schermformaat als kale inch zetten zodat het overeenkomt met de <option
  // value> (bv. "23.8" -> 23, "24 inch" -> 24). formatDisplay() maakt er bij
  // opslaan weer 24" van.
  const displayInch = match.displaySize ? (String(match.displaySize).match(/\d{2}/) || [''])[0] : '';
  setAutoFilledFormValue('mm_display', displayInch);
  applyMonitorManualVideoInputsToPicker(match.videoInputs || '');
  updateMonitorManualDevicePreview(readFormValue('mm_merk'), readFormValue('mm_series'), readFormValue('mm_model'));
}

function applyMonitorManualVideoInputsToPicker(videoInputs) {
  const countInputs = Array.from(document.querySelectorAll('[data-monitor-video-port-count-select]') || []);
  // Poorten zijn nu automatisch gevuld (ook bij leegmaken via de auto-clear).
  // Zo weet clearAutoFilledMonitorManualFields() dat het deze mag terugzetten,
  // terwijl handmatig gekozen poorten (zie setMonitorManualPortCount) blijven.
  STATE.monitorManualPortsAutoFilled = true;
  if (!countInputs.length) return;
  const selections = typeof getMonitorManualPortSelections === 'function' ? getMonitorManualPortSelections(videoInputs) : [];
  const selectionByPort = new Map(selections.map(selection => [selection.port, selection]));
  countInputs.forEach(input => {
    const port = input.dataset ? input.dataset.monitorVideoPort : '';
    const selection = selectionByPort.get(port);
    const count = Math.max(0, Math.min(2, Number(selection ? selection.count || 0 : 0)));
    input.value = String(count);
    // Keep the visible 0x/1x/2x buttons in sync with the auto-filled value,
    // mirroring setMonitorManualPortCount() so a database match also updates the UI.
    const group = input.closest('.monitor-manual-port-option');
    if (group) {
      group.querySelectorAll('[data-monitor-video-port-count-button]').forEach(button => {
        const active = Number(button.dataset.count || 0) === count;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    }
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
        Promise.resolve(selectLaptop(sticker)).catch(error => {
          reportAppError('Scan failed', error);
          setAppMessage('Scan failed. Try again.');
          render();
        });
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
  if (STATE.currentScreen === 'monitor_label_scan' && STATE.currentMonitor && !STATE.monitorPrintInProgress && !monitorNeedsIdentityChoice(STATE.currentMonitor) && ['a', 'b', 'c', 'd', 'x'].includes(key)) {
    e.preventDefault();
    const grade = key === 'x' ? 'D' : key.toUpperCase();
    Promise.resolve(scanAndPrintMonitorLabel(STATE.currentMonitor.sticker, grade, { source: 'keyboard' })).catch(error => {
      reportAppError('Monitor label print failed', error);
      setAppMessage('Monitor label print failed. Try again.');
      render();
    });
    return;
  }

  if (['a', 'b', 'c', 'd', 'x'].includes(key) && STATE.currentScreen === 'grading_expert') {
    if (!canGradeUser()) return;
    const letter = key === 'x' ? 'D' : key.toUpperCase();
    e.preventDefault();
    Promise.resolve(confirmExpertFinalGrade(letter)).catch(error => {
      reportAppError('Expert grade failed', error);
      setAppMessage('Expert grade failed. Try again.');
      render();
    });
    return;
  }

  if (['a', 'b', 'c', 'd', 'x'].includes(key) && STATE.currentScreen === 'grading_beginner') {
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
      Promise.resolve(finishGradingAndMaybeConfirm()).catch(error => {
        reportAppError('Confirm grade failed', error);
        setAppMessage('Confirm grade failed. Try again.');
        render();
      });
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

let analyticsSearchTimer = null;
function scheduleAnalyticsSearch(value) {
  clearTimeout(analyticsSearchTimer);
  setAnalyticsFilter('query', value);
  analyticsSearchTimer = setTimeout(() => {
    render();
    const input = document.getElementById('analyticsSearch');
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }, 160);
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
  STATE.currentGrading.repairIssues = STATE.currentGrading.repairIssues || {};
  STATE.currentGrading.repairActions = STATE.currentGrading.repairActions || {};
  delete STATE.currentGrading.impactOverrides[componentId];
  delete STATE.currentGrading.repairIssues[componentId];
  delete STATE.currentGrading.repairActions[componentId];
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

async function resolvePendingDecision(optionIndex) {
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
    if (await confirmFinishedGradingIfReady()) return;
    render();
    return;
  }

  STATE.currentGrading.keuzes[decision.componentId] = decision.letter;
  STATE.currentGrading.impactOverrides = STATE.currentGrading.impactOverrides || {};
  STATE.currentGrading.repairIssues = STATE.currentGrading.repairIssues || {};
  STATE.currentGrading.repairActions = STATE.currentGrading.repairActions || {};
  STATE.currentGrading.impactOverrides[decision.componentId] = option.impact;
  if (option.repairIssue) {
    STATE.currentGrading.repairIssues[decision.componentId] = option.repairIssue;
    const repairAction = typeof getRepairActionForOption === 'function' ? getRepairActionForOption(decision.componentId, option) : null;
    if (repairAction) STATE.currentGrading.repairActions[decision.componentId] = repairAction;
  } else {
    delete STATE.currentGrading.repairIssues[decision.componentId];
    delete STATE.currentGrading.repairActions[decision.componentId];
  }
  STATE.currentGrading.gradeReviewDone = false;
  STATE.currentGrading.finalGradeOverride = null;
  if (option.nextDecision) {
    STATE.pendingDecision = {
      componentId: decision.componentId,
      letter: decision.letter,
      autoAdvance: decision.autoAdvance,
      title: option.nextDecision.title,
      text: option.nextDecision.text,
      options: option.nextDecision.options,
    };
    render();
    return;
  }
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
      if (STATE.currentGrading.repairIssues) delete STATE.currentGrading.repairIssues[decision.componentId];
      if (STATE.currentGrading.repairActions) delete STATE.currentGrading.repairActions[decision.componentId];
    }
  }
  STATE.pendingDecision = null;
}

function advanceAfterChoice(autoAdvance) {
  if (!autoAdvance || !STATE.currentGrading) return;
  if (STATE.currentGrading.huidigeIndex < getGradingOnderdelen().length - 1) {
    STATE.currentGrading.huidigeIndex++;
    updateSupplierNoticeForCurrentStep();
  } else {
    finishGrading();
  }
}

const STICKER_ALLOWED_ACTIONS = new Set([
  'dismiss_message',
  'confirm_supplier_notice',
  'toggle_language',
  'toggle_theme',
  'toggle_contrast',
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
  'monitor_reprint_confirm',
  'monitor_reprint_cancel',
  'monitor_regrade',
  'scan',
  'back_scan',
  'login_password',
  'change_own_password',
  'print_supplier_specs_label',
  'reprint_completed_laptop',
  'set_touch_override',
]);

const PASSWORD_CHANGE_ALLOWED_ACTIONS = new Set([
  'dismiss_message',
  'toggle_language',
  'toggle_theme',
  'toggle_contrast',
  'logout',
  'change_own_password',
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

function guardPasswordChangeAction(action) {
  if (!STATE.currentUser || STATE.currentUser.mustChangePassword !== true || PASSWORD_CHANGE_ALLOWED_ACTIONS.has(action)) return false;
  STATE.currentScreen = 'password_change';
  STATE.currentLaptop = null;
  STATE.currentMonitor = null;
  STATE.currentGrading = null;
  STATE.pendingDecision = null;
  STATE.supplierNotice = null;
  STATE.imagePreview = null;
  setAppMessage('Choose your own password before you continue.');
  render();
  return true;
}

async function handleAction(action, el) {
  if (guardStickerAction(action)) return;
  if (guardPasswordChangeAction(action)) return;
  switch (action) {
    case 'dismiss_message':
      setAppMessage(null);
      break;
    case 'confirm_supplier_notice':
      confirmSupplierNotice();
      break;
    case 'toggle_theme':
      setThemePreference(el.dataset.themeValue);
      break;
    case 'toggle_contrast':
      if (typeof setContrastPreference === 'function') setContrastPreference(el && el.dataset ? el.dataset.contrastValue : 'normal');
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
      STATE.supplierNotice = null;
      STATE.imagePreview = null;
      break;
    case 'home':
      STATE.currentScreen = 'home';
      STATE.homeTab = 'workflow';
      STATE.currentLaptop = null;
      STATE.currentMonitor = null;
      STATE.currentGrading = null;
      STATE.pendingDecision = null;
      STATE.supplierNotice = null;
      STATE.imagePreview = null;
      break;
    case 'home_workflow':
      STATE.currentScreen = 'home';
      STATE.homeTab = 'workflow';
      STATE.currentLaptop = null;
      STATE.currentMonitor = null;
      STATE.currentGrading = null;
      STATE.pendingDecision = null;
      STATE.supplierNotice = null;
      break;
    case 'home_monitor_workflow':
      STATE.currentScreen = 'home';
      STATE.homeTab = 'monitor';
      STATE.currentLaptop = null;
      STATE.currentMonitor = null;
      STATE.currentGrading = null;
      STATE.pendingDecision = null;
      STATE.supplierNotice = null;
      break;
    case 'sticker_scan':
      STATE.currentScreen = 'sticker_scan';
      STATE.currentMonitor = null;
      STATE.manualError = '';
      STATE.scanSearch = '';
      STATE.supplierNotice = null;
      break;
    case 'monitor_label_scan':
      STATE.currentScreen = 'monitor_label_scan';
      STATE.homeTab = 'monitor';
      STATE.currentMonitor = null;
      STATE.monitorPrintInProgress = false;
      STATE.monitorManualContext = null;
      STATE.monitorSelectedGrade = null;
      STATE.manualError = '';
      STATE.monitorScanSearch = '';
      break;
    case 'monitor_manual':
      STATE.currentScreen = 'monitor_manual';
      STATE.homeTab = 'monitor';
      STATE.currentMonitor = null;
      STATE.monitorPrintInProgress = false;
      STATE.monitorManualContext = null;
      STATE.monitorSelectedGrade = null;
      STATE.manualError = '';
      // Verse invoer: geen automatisch ingevulde gegevens onthouden.
      STATE.monitorManualAutoKey = null;
      STATE.monitorManualPortsAutoFilled = false;
      break;
    case 'monitor_manual_from_current':
      if (!STATE.currentMonitor) {
        setAppMessage('Scan or select a monitor to correct first.');
        break;
      }
      STATE.currentScreen = 'monitor_manual';
      STATE.homeTab = 'monitor';
      STATE.monitorManualContext = { sticker: STATE.currentMonitor.sticker, mode: 'correction' };
      STATE.monitorPrintInProgress = false;
      STATE.monitorSelectedGrade = null;
      STATE.manualError = '';
      // Correctie: seed de match-sleutel op het huidige model en behandel de
      // reeds ingevulde poorten als handmatig (echte monitorgegevens), zodat
      // het eerste veld dat je aanpast niet meteen alles overschrijft of wist.
      STATE.monitorManualAutoKey = monitorManualMatchKeyForMonitor(STATE.currentMonitor);
      STATE.monitorManualPortsAutoFilled = false;
      break;
    case 'monitor_reprint_confirm': {
      const reprintSticker = STATE.monitorReprintPrompt && STATE.monitorReprintPrompt.sticker;
      await reprintMonitorLabel(reprintSticker);
      return;
    }
    case 'monitor_regrade': {
      // Opnieuw graden: ga terug naar het gradescherm en sta toe dat het
      // bestaande label overschreven wordt met een nieuwe grade.
      const regradeSticker = STATE.monitorReprintPrompt && STATE.monitorReprintPrompt.sticker;
      STATE.monitorReprintPrompt = null;
      const regradeMonitor = regradeSticker ? getMonitorBySticker(regradeSticker) : null;
      if (!regradeMonitor) {
        setAppMessage(`Monitor ${regradeSticker || ''} could not be found to grade again.`);
        break;
      }
      STATE.monitorRegradeSticker = regradeSticker;
      STATE.currentMonitor = regradeMonitor;
      STATE.currentScreen = 'monitor_label_scan';
      STATE.homeTab = 'monitor';
      STATE.monitorSelectedGrade = null;
      STATE.monitorPrintInProgress = false;
      setAppMessage('Choose a grade again — the existing label will be overwritten.', 'info');
      break;
    }
    case 'monitor_reprint_cancel':
      STATE.monitorReprintPrompt = null;
      STATE.monitorRegradeSticker = null;
      STATE.currentMonitor = null;
      STATE.monitorSelectedGrade = null;
      STATE.currentScreen = 'monitor_label_scan';
      STATE.homeTab = 'monitor';
      setAppMessage('Cancelled.');
      break;
    case 'monitor_scan_reset':
      STATE.currentMonitor = null;
      STATE.monitorPrintInProgress = false;
      STATE.monitorSelectedGrade = null;
      STATE.monitorScanSearch = '';
      STATE.monitorReprintPrompt = null;
      STATE.monitorRegradeSticker = null;
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
    case 'change_own_password':
      await changeOwnPassword();
      return;
    case 'create_user':
      await createUserFromForm();
      return;
    case 'update_user':
      await updateUserFromRow(el.dataset.userId);
      return;
    case 'reset_user_password':
      await resetUserPassword(el.dataset.userId);
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
    case 'analytics_filters_reset':
      resetAnalyticsFilters();
      break;
    case 'analytics_tab':
      if (typeof setAnalyticsTab === 'function') setAnalyticsTab(el && el.dataset ? el.dataset.analyticsTab : 'overview');
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
      const backFromScreen = STATE.currentScreen;
      const isManualLaptop = STATE.currentLaptop && STATE.currentLaptop.batchNummer === 'Manual';
      STATE.currentScreen = isStickerUser()
        ? 'sticker_scan'
        : backFromScreen === 'laptop_info' && isManualLaptop
          ? 'manual'
          : 'scan';
      STATE.currentGrading = null;
      STATE.pendingDecision = null;
      STATE.supplierNotice = null;
      break;
    case 'set_touch_override':
      await setCurrentLaptopTouchOverride(el && el.dataset ? el.dataset.touchOverride : '');
      return;
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
        setAppMessage('Expert Mode is only available for managers or expert-enabled graders. Use Guided Mode for grading.');
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
        setAppMessage('Expert Mode is only available for managers or expert-enabled graders. Use Guided Mode for grading.');
        break;
      }
      startTestGrading('expert');
      break;
    case 'prev_q':
      STATE.supplierNotice = null;
      STATE.currentGrading.huidigeIndex = Math.max(0, STATE.currentGrading.huidigeIndex - 1);
      updateSupplierNoticeForCurrentStep();
      break;
    case 'next_q':
      STATE.supplierNotice = null;
      if (STATE.currentGrading.huidigeIndex < getGradingOnderdelen().length - 1) {
        STATE.currentGrading.huidigeIndex++;
        updateSupplierNoticeForCurrentStep();
      } else {
        await finishGradingAndMaybeConfirm();
        return;
      }
      break;
    case 'confirm_expert':
      await finishGradingAndMaybeConfirm();
      return;
    case 'confirm_expert_repair':
      await completeExpertRepairGrade();
      return;
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
  const countSelects = Array.from(document.querySelectorAll('[data-monitor-video-port-count-select]') || []);
  if (countSelects.length) {
    const parts = countSelects
      .map(field => {
        const label = field.dataset ? field.dataset.monitorVideoPort : '';
        const count = Math.max(0, Math.min(2, Number(field.value || 0)));
        if (!count || !label) return '';
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

// Toon een invoerfout op het handmatige-monitorscherm zonder render(), zodat de
// reeds ingevulde velden en poortkeuzes behouden blijven. Valt terug op een
// volledige render alleen als het foutvak (nog) niet bestaat.
function showMonitorManualError(message) {
  STATE.manualError = message || '';
  const box = document.getElementById('mm_error');
  if (!box) {
    render();
    return;
  }
  box.textContent = STATE.manualError;
  if (STATE.manualError) {
    box.removeAttribute('hidden');
    if (typeof box.scrollIntoView === 'function') box.scrollIntoView({ block: 'nearest' });
  } else {
    box.setAttribute('hidden', '');
  }
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
    // Toon de fout zonder het formulier te herbouwen, anders raakt de
    // medewerker alle al ingevulde gegevens kwijt.
    showMonitorManualError('Brand and model number are required.');
    return false;
  }

  if (isMonitorLabelPrinted(sticker)) {
    showMonitorManualError(`A monitor label has already been printed for barcode ${sticker}. Use a new barcode or remove the existing result first.`);
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
    ? `Monitor details for barcode ${monitor.sticker} have been corrected. Now choose the final grade.`
    : `Manual monitor ${monitor.deviceName} has been added. Now choose the final grade.`,
    'success');
  await saveSharedDemoState();
  render();
  return true;
}

function getCurrentGradingComponent() {
  if (!STATE.currentGrading) return null;
  return getGradingOnderdelen()[STATE.currentGrading.huidigeIndex] || null;
}

function buildSupplierNoticeForComponent(component, laptop = STATE.currentLaptop) {
  if (!component || !laptop || !normalizeText(laptop.meldingen)) return null;
  const issues = getSupplierPopupIssues(component.id, laptop);
  if (!issues.length) return null;
  const notes = issues.join(', ');
  return {
    sticker: laptop.sticker,
    device: `${laptop.merk || ''} ${laptop.model || ''}`.trim() || laptop.sticker || 'Device',
    componentId: component.id,
    componentName: component.naam,
    issues,
    notes,
    noticeKey: `${component.id}:${notes}`,
  };
}

function buildSupplierNoticeForExpert(laptop = STATE.currentLaptop) {
  if (!laptop || !normalizeText(laptop.meldingen)) return null;
  const notes = [];
  getGradingOnderdelen().forEach(component => {
    getSupplierPopupIssues(component.id, laptop).forEach(issue => {
      notes.push(`${component.naam} = ${issue}`);
    });
  });
  const issues = Array.from(new Set(notes));
  if (!issues.length) return null;
  return {
    sticker: laptop.sticker,
    device: `${laptop.merk || ''} ${laptop.model || ''}`.trim() || laptop.sticker || 'Device',
    componentId: 'expert',
    componentName: '',
    issues,
    notes: issues.join(', '),
    noticeKey: `expert:${issues.join('|')}`,
  };
}

function updateSupplierNoticeForCurrentStep() {
  if (!STATE.currentGrading || STATE.pendingDecision || STATE.supplierNotice) return;
  const notice = STATE.currentScreen === 'grading_beginner'
    ? buildSupplierNoticeForComponent(getCurrentGradingComponent())
    : STATE.currentScreen === 'grading_expert'
      ? buildSupplierNoticeForExpert()
      : null;
  if (!notice) return;
  const seen = STATE.currentGrading.supplierNoticesSeen || {};
  if (seen[notice.noticeKey]) return;
  STATE.supplierNotice = notice;
}

function confirmSupplierNotice() {
  const notice = STATE.supplierNotice;
  if (notice && STATE.currentGrading && notice.noticeKey) {
    STATE.currentGrading.supplierNoticesSeen = STATE.currentGrading.supplierNoticesSeen || {};
    STATE.currentGrading.supplierNoticesSeen[notice.noticeKey] = true;
  }
  STATE.supplierNotice = null;
}

async function selectLaptop(sticker) {
  const cleanSticker = String(sticker || '').trim();
  const l = getLaptopBySticker(sticker);
  if (!l) {
    setAppMessage(`Barcode ${cleanSticker || '-'} not found. Search again or use Manual Entry for returns.`);
    render();
    return;
  }
  if (isLaptopGraded(l.sticker) || isLaptopLabelPrinted(l.sticker)) {
    await reprintCompletedLaptopLabels(l.sticker, { source: 'scan', confirmBeforePrint: true });
    return;
  }
  STATE.currentLaptop = l;
  STATE.currentScreen = 'laptop_info';
  STATE.scanSearch = '';
  STATE.supplierNotice = null;
  setAppMessage(null);
  render();
}

async function setCurrentLaptopTouchOverride(value) {
  if (!STATE.currentLaptop) {
    setAppMessage('Scan a laptop before you change the touch status.');
    render();
    return false;
  }
  const requested = normalizeTouchOverride(value);
  const listValue = isTouchscreenFromDisplay(STATE.currentLaptop) ? 'yes' : 'no';
  const override = setLaptopTouchOverride(STATE.currentLaptop, requested && requested !== listValue ? requested : '');
  const effectiveTouch = isTouchscreenLaptop(STATE.currentLaptop) ? 'yes' : 'no';
  logAudit('update_touch_override', 'laptop', STATE.currentLaptop.sticker, {
    touchOverride: override || 'list',
    effectiveTouch,
  });
  await saveSharedDemoState();
  setAppMessage(
    override
      ? `Touch status changed to ${effectiveTouch}. Labels and grading use this choice.`
      : `Touch status is back on the supplier list (${effectiveTouch}).`,
    'success'
  );
  render();
  return true;
}

function buildLaptopFromHistoryOrBatch(sticker, historyItem = null) {
  const batchLaptop = getLaptopBySticker(sticker);
  const source = historyItem || batchLaptop || {};
  const touchOverride = normalizeTouchOverride(source.touchOverride) || normalizeTouchOverride(batchLaptop && batchLaptop.touchOverride);
  return {
    ...(batchLaptop || {}),
    sticker: source.sticker || sticker,
    merk: source.merk || (batchLaptop && batchLaptop.merk) || '',
    model: source.model || (batchLaptop && batchLaptop.model) || '',
    serial: source.serial || (batchLaptop && batchLaptop.serial) || '',
    processor: source.processor || (batchLaptop && batchLaptop.processor) || '',
    ram: source.ram || (batchLaptop && batchLaptop.ram) || '',
    ssd: source.ssd || (batchLaptop && batchLaptop.ssd) || '',
    display: source.display || (batchLaptop && batchLaptop.display) || '',
    touchOverride,
    battery: source.battery || (batchLaptop && batchLaptop.battery) || '',
    gpu: source.gpu || (batchLaptop && batchLaptop.gpu) || '',
    labelGpu: source.labelGpu || (batchLaptop && batchLaptop.labelGpu) || '',
    leverancier_class: source.leverancier_class || (batchLaptop && batchLaptop.leverancier_class) || '',
    meldingen: source.leverancier_meldingen || source.meldingen || (batchLaptop && batchLaptop.meldingen) || '',
    batchId: source.batchId || (batchLaptop && batchLaptop.batchId) || '',
    batchNummer: source.batchNummer || (batchLaptop && batchLaptop.batchNummer) || '',
  };
}

function getHistoryResultForReprint(historyItem) {
  if (!historyItem) return { eindgrade: '', problems: [] };
  const result = historyItem.result ? { ...historyItem.result } : {};
  result.eindgrade = result.eindgrade || historyItem.grade || '';
  result.score = result.score ?? historyItem.score ?? 0;
  result.problems = Array.isArray(result.problems) ? result.problems : [];
  return result;
}

function confirmCompletedLaptopReprint(laptop) {
  if (typeof confirm !== 'function') return true;
  const sticker = laptop && laptop.sticker ? laptop.sticker : '-';
  const device = `${laptop && laptop.merk ? laptop.merk : ''} ${laptop && laptop.model ? laptop.model : ''}`.trim();
  return confirm(
    `This laptop has already been scanned and graded.\n\n` +
    `Barcode: ${sticker}${device ? `\nDevice: ${device}` : ''}\n\n` +
    `Are you sure you want to print the label again?`
  );
}

async function reprintCompletedLaptopLabels(sticker, options = {}) {
  const cleanSticker = String(sticker || '').trim();
  if (!cleanSticker) {
    setAppMessage('Scan or select a completed barcode first.');
    render();
    return false;
  }
  const historyItem = getLatestHistoryForSticker(cleanSticker);
  const labelPrint = getLatestLabelPrintForSticker(cleanSticker);
  if (!historyItem && !labelPrint && !getLaptopBySticker(cleanSticker)) {
    setAppMessage(`Barcode ${cleanSticker} not found for reprint.`);
    render();
    return false;
  }

  const laptop = buildLaptopFromHistoryOrBatch(cleanSticker, historyItem || labelPrint);
  const result = historyItem ? getHistoryResultForReprint(historyItem) : { eindgrade: '', problems: [] };
  if (options.confirmBeforePrint && !confirmCompletedLaptopReprint(laptop)) {
    STATE.currentLaptop = null;
    STATE.currentGrading = null;
    STATE.pendingDecision = null;
    STATE.supplierNotice = null;
    STATE.currentScreen = isStickerUser() ? 'sticker_scan' : 'scan';
    setAppMessage(`Reprint for ${laptop.sticker || cleanSticker} cancelled.`);
    render();
    return false;
  }
  const printTypes = ['specs'];
  if (needsProblemLabel(laptop, result)) printTypes.push('problems');
  const preparedWindows = {};
  const browserProfile = getBrowserPrintProfile();
  const allowBrowserFallback = shouldUseBrowserPrintFallback(browserProfile);
  if (allowBrowserFallback && typeof window !== 'undefined' && typeof window.open === 'function') {
    printTypes.forEach(type => {
      preparedWindows[type] = createPreparedPrintWindow(type, browserProfile);
    });
  }

  for (const type of printTypes) {
    const printed = await printLabelFor(laptop, result, type, {
      hideGrade: !historyItem && type === 'specs',
      preparedWindow: preparedWindows[type],
      suppressMessage: true,
    });
    if (!printed) {
      setAppMessage(`Reprint for barcode ${cleanSticker} failed. Try again.`);
      render();
      return false;
    }
  }

  logAudit('reprint_laptop_label', 'laptop', laptop.sticker || cleanSticker, {
    source: options.source || '',
    labels: printTypes,
    grade: result.eindgrade || '',
  });
  STATE.currentLaptop = null;
  STATE.currentGrading = null;
  STATE.pendingDecision = null;
  STATE.supplierNotice = null;
  STATE.currentScreen = isStickerUser() ? 'sticker_scan' : 'scan';
  setAppMessage(`${printTypes.length > 1 ? 'Specs and repair labels' : 'Specs label'} reprinted for ${laptop.sticker || cleanSticker}.`, 'success');
  render();
  return true;
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
    return reprintCompletedLaptopLabels(laptop.sticker, { source: 'label-scan', confirmBeforePrint: true });
  }

  if (isLaptopLabelPrinted(laptop.sticker)) {
    return reprintCompletedLaptopLabels(laptop.sticker, { source: 'label-scan', confirmBeforePrint: true });
  }

  const supplierResult = { eindgrade: '', problems: [] };
  const printTypes = ['specs'];
  if (needsProblemLabel(laptop, supplierResult)) printTypes.push('problems');
  const preparedWindows = {};
  const browserProfile = getBrowserPrintProfile();
  const allowBrowserFallback = shouldUseBrowserPrintFallback(browserProfile);
  if (allowBrowserFallback && typeof window !== 'undefined' && typeof window.open === 'function') {
    printTypes.forEach(type => {
      preparedWindows[type] = createPreparedPrintWindow(type, browserProfile);
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
    ? `Specs label with blank grade line and repair label printed for ${laptop.sticker}. Device is complete in the digital workflow.`
    : `Specs label with blank grade line printed for ${laptop.sticker}. Device is complete in the digital workflow.`,
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
  // Veiligheid: een verse scan mag nooit blijven hangen op een oude
  // "bezig met printen"-status of een half afgebroken opnieuw-graden.
  STATE.monitorPrintInProgress = false;
  STATE.monitorRegradeSticker = null;

  if (isMonitorLabelPrinted(monitor.sticker)) {
    // Niet doodlopen: toon een LOSSE waarschuwing-pop-up. currentMonitor MOET
    // hier null zijn, anders rendert het gradescherm (hogere z-index) eroverheen
    // en zie je de pop-up niet.
    STATE.currentMonitor = null;
    STATE.monitorReprintPrompt = { sticker: monitor.sticker };
    setAppMessage(null);
    render();
    return false;
  }

  STATE.monitorReprintPrompt = null;
  setAppMessage(null);
  render();
  return true;
}

function chooseMonitorIdentityForLabel(optionIndex) {
  if (!STATE.currentMonitor) {
    setAppMessage('Scan or select a monitor first.');
    render();
    return false;
  }
  if (!applyMonitorIdentityChoice(STATE.currentMonitor, optionIndex)) {
    setAppMessage('This monitor name could not be selected. Try again.');
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
  if (STATE.monitorPrintInProgress) {
    setAppMessage('The monitor label is already being processed. Please wait until printing and saving are finished.');
    render();
    return false;
  }
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

  // Bewust opnieuw graden? Dan de "al geprint"-blokkade overslaan en het
  // bestaande label overschrijven met de nieuwe grade.
  const isRegrade = Boolean(STATE.monitorRegradeSticker) && (
    STATE.monitorRegradeSticker === monitor.sticker ||
    normalizeStickerCode(STATE.monitorRegradeSticker) === normalizeStickerCode(monitor.sticker)
  );

  if (isMonitorLabelPrinted(monitor.sticker) && !isRegrade) {
    // Al geprint: toon de LOSSE waarschuwing-pop-up i.p.v. doodlopen.
    // currentMonitor null houden, anders dekt het gradescherm de pop-up af.
    STATE.currentMonitor = null;
    STATE.monitorReprintPrompt = { sticker: monitor.sticker };
    STATE.monitorSelectedGrade = null;
    render();
    return false;
  }

  if (monitorNeedsIdentityChoice(monitor)) {
    setAppMessage('First choose which monitor name belongs to this sticker. Then you can choose the grade.');
    STATE.currentMonitor = monitor;
    STATE.monitorSelectedGrade = null;
    render();
    return false;
  }

  // Onbekende poorten? Neem de handmatig aangeklikte poorten mee op het label
  // en leer ze voor volgende monitoren van hetzelfde model.
  if (!normalizeMonitorVideoInputs(monitor.videoInputs)) {
    const chosenPorts = readMonitorManualVideoInputs();
    if (chosenPorts) {
      monitor.videoInputs = chosenPorts;
      if (typeof learnMonitorPorts === 'function') learnMonitorPorts(monitor, chosenPorts);
    }
  }

  const browserProfile = getMonitorBrowserPrintProfile();
  const allowBrowserFallback = shouldUseBrowserPrintFallback(browserProfile);
  const preparedWindow = allowBrowserFallback && typeof window !== 'undefined' && typeof window.open === 'function'
    ? createPreparedPrintWindow('monitor', browserProfile)
    : null;
  STATE.monitorPrintInProgress = true;
  setAppMessage(`Monitor label ${displayMonitorGrade(normalizedGrade)} is being printed and saved...`, 'info');
  render();

  try {
    const printed = await printMonitorLabelFor(monitor, normalizedGrade, {
      preparedWindow,
      suppressMessage: true,
    });

    if (!printed) {
      setAppMessage(`The monitor label for barcode ${cleanSticker} could not be printed automatically. Try again or print via the browser window.`, 'warning');
      STATE.currentMonitor = monitor;
      return false;
    }

    // Opnieuw graden werkt het bestaande record bij; anders een nieuw record.
    if (isRegrade) {
      upsertMonitorLabelPrint(monitor, normalizedGrade);
      STATE.monitorRegradeSticker = null;
    } else {
      recordMonitorLabelPrint(monitor, normalizedGrade);
    }
    const savedLive = await saveSharedDemoState();
    // Kwam deze monitor uit "Monitor handmatig invoeren"? Dan hoort hij in de
    // handmatige batch. Breng de medewerker meteen terug naar een leeg
    // invoerscherm zodat hij de volgende kan invoeren zonder stappen terug.
    const cameFromManualEntry = Boolean(monitor && monitor.batchId === 'monitor_manual');
    STATE.currentMonitor = null;
    STATE.monitorSelectedGrade = null;
    if (canUseSharedDemoState() && savedLive === false) {
      setAppMessage(`The monitor label was printed for ${monitor.deviceName || monitor.model || monitor.sticker}, but live saving failed. Refresh or try again before you continue.`, 'warning');
    } else {
      setAppMessage(`Monitor label printed for ${monitor.deviceName || monitor.model || monitor.sticker} with grade ${displayMonitorGrade(normalizedGrade)}.`, 'success');
    }
    if (cameFromManualEntry) {
      STATE.currentScreen = 'monitor_manual';
      STATE.homeTab = 'monitor';
      STATE.monitorManualContext = null;
      STATE.manualError = '';
      STATE.monitorScanSearch = '';
      // Verse start voor de volgende monitor: geen onthouden autofill/poorten.
      STATE.monitorManualAutoKey = null;
      STATE.monitorManualPortsAutoFilled = false;
    }
    return true;
  } catch (error) {
    reportAppError('Monitor label print failed', error);
    if (typeof closePreparedPrintWindow === 'function') closePreparedPrintWindow(preparedWindow);
    setAppMessage('Monitor label printing was not completed. Try again; the monitor stays selected.', 'warning');
    STATE.currentMonitor = monitor;
    return false;
  } finally {
    STATE.monitorPrintInProgress = false;
    render();
  }
}

// Print een reeds geprint monitorlabel bewust opnieuw (na bevestiging in de
// pop-up). Gebruikt de eerder vastgelegde grade; verandert geen voorraad of
// telling, maar legt wel een audit-regel vast.
async function reprintMonitorLabel(sticker) {
  const cleanSticker = String(sticker || '').trim();
  STATE.monitorReprintPrompt = null;
  if (STATE.monitorPrintInProgress) {
    setAppMessage('The monitor label is already being processed. Please wait until printing is finished.');
    render();
    return false;
  }
  if (!cleanSticker) {
    setAppMessage('No barcode to reprint.');
    render();
    return false;
  }

  const record = typeof getLatestMonitorLabelPrintForSticker === 'function' ? getLatestMonitorLabelPrintForSticker(cleanSticker) : null;
  const liveMonitor = getMonitorBySticker(cleanSticker);
  if (!liveMonitor && !record) {
    setAppMessage(`Monitor ${cleanSticker} could not be found to reprint.`);
    render();
    return false;
  }
  const target = liveMonitor || {
    sticker: cleanSticker,
    deviceName: record.deviceName,
    merk: record.merk,
    model: record.model,
    serie: record.serie,
    modelNumber: record.modelNumber,
    serial: record.serial,
    videoInputs: record.videoInputs,
    batchId: record.batchId,
    batchNummer: record.batchNummer,
  };
  const grade = normalizeMonitorGrade((record && record.grade) || STATE.monitorSelectedGrade);

  STATE.currentScreen = 'monitor_label_scan';
  STATE.homeTab = 'monitor';
  STATE.currentMonitor = target;
  STATE.monitorSelectedGrade = grade;

  const browserProfile = getMonitorBrowserPrintProfile();
  const allowBrowserFallback = shouldUseBrowserPrintFallback(browserProfile);
  const preparedWindow = allowBrowserFallback && typeof window !== 'undefined' && typeof window.open === 'function'
    ? createPreparedPrintWindow('monitor', browserProfile)
    : null;
  STATE.monitorPrintInProgress = true;
  setAppMessage(`Monitor label ${displayMonitorGrade(grade)} is being reprinted...`, 'info');
  render();

  try {
    const printed = await printMonitorLabelFor(target, grade, { preparedWindow, suppressMessage: true });
    if (!printed) {
      setAppMessage(`Reprint for barcode ${cleanSticker} failed. Try again or print via the browser window.`, 'warning');
      return false;
    }
    logAudit('monitor_label_reprinted', 'monitor', cleanSticker, { grade, batchNummer: target.batchNummer || '' });
    STATE.currentMonitor = null;
    STATE.monitorSelectedGrade = null;
    setAppMessage(`Monitor label reprinted for ${target.deviceName || cleanSticker} with grade ${displayMonitorGrade(grade)}.`, 'success');
    return true;
  } catch (error) {
    reportAppError('Monitor reprint failed', error);
    if (typeof closePreparedPrintWindow === 'function') closePreparedPrintWindow(preparedWindow);
    setAppMessage('Reprint was not completed. Try again.', 'warning');
    return false;
  } finally {
    STATE.monitorPrintInProgress = false;
    render();
  }
}

async function loginWithPassword() {
  await refreshSharedUsers();
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
  STATE.currentScreen = user.mustChangePassword ? 'password_change' : 'home';
  STATE.homeTab = 'workflow';
  setAppMessage(null);
  render();
}

async function changeOwnPassword() {
  if (!STATE.currentUser) return;
  const passwordInput = document.getElementById('newOwnPassword');
  const confirmInput = document.getElementById('confirmOwnPassword');
  const password = passwordInput ? String(passwordInput.value || '') : '';
  const confirmation = confirmInput ? String(confirmInput.value || '') : '';
  if (password.length < 8) {
    setAppMessage('Use at least 8 characters for your new password.');
    render();
    return;
  }
  if (password !== confirmation) {
    setAppMessage('The two passwords are not the same.');
    render();
    return;
  }
  if (password === FIRST_LOGIN_PASSWORD) {
    setAppMessage('Choose your own password, not the start password again.');
    render();
    return;
  }

  const user = USERS.find(u => u.id === STATE.currentUser.id);
  if (!user) {
    setAppMessage('Account could not be updated. Log in again.');
    render();
    return;
  }
  const passwordHash = await hashDemoPassword(password);
  if (user.passwordHash === passwordHash && user.mustChangePassword !== true) {
    setAppMessage('Choose a new password that is different from your current password.');
    render();
    return;
  }

  user.passwordHash = passwordHash;
  user.mustChangePassword = false;
  user.passwordUpdatedAt = new Date().toISOString();
  STATE.currentUser = user;
  saveUsers();
  saveSessionUser(user);
  logAudit('change_own_password', 'user', user.id);
  await saveSharedDemoState({ includeUsers: true, userMutation: { action: 'update', id: user.id } });
  STATE.currentScreen = 'home';
  STATE.homeTab = 'workflow';
  setAppMessage('Your password has been saved.', 'success');
  render();
}

async function createUserFromForm() {
  if (!isAdminUser()) return;
  const naam = normalizeText(document.getElementById('newUserName').value);
  const id = normalizeText(document.getElementById('newUserId').value).toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const rol = normalizeUserRole(document.getElementById('newUserRole').value);
  const voorkeur = normalizeUserPreference(document.getElementById('newUserMode').value, rol);
  if (!naam || !id) {
    setAppMessage('Name and login ID are required.');
    render();
    return;
  }
  if (USERS.some(u => u.id === id)) {
    setAppMessage('This login ID already exists.');
    render();
    return;
  }
  const passwordHash = await hashDemoPassword(FIRST_LOGIN_PASSWORD);
  USERS.push({
    id,
    naam: sanitizeExternalText(naam, 80),
    rol,
    initialen: initialsFromName(naam),
    voorkeur,
    passwordHash,
    mustChangePassword: true,
    passwordUpdatedAt: '',
  });
  saveUsers();
  logAudit('create_user', 'user', id, { rol, voorkeur });
  await saveSharedDemoState({ includeUsers: true, userMutation: { action: 'create', id } });
  setAppMessage(`User ${naam} created. Start password: ${FIRST_LOGIN_PASSWORD}`, 'success');
  render();
}

async function updateUserFromRow(id) {
  if (!isAdminUser()) return;
  const user = USERS.find(u => u.id === id);
  if (!user) return;
  const roleInput = document.querySelector(`[data-account-role="${id}"]`);
  const modeInput = document.querySelector(`[data-account-mode="${id}"]`);
  user.rol = normalizeUserRole(roleInput ? roleInput.value : user.rol);
  user.voorkeur = normalizeUserPreference(modeInput ? modeInput.value : user.voorkeur, user.rol);
  if (STATE.currentUser && STATE.currentUser.id === id) {
    STATE.currentUser = user;
    saveSessionUser(user);
  }
  saveUsers();
  logAudit('update_user', 'user', id, { rol: user.rol, voorkeur: user.voorkeur });
  await saveSharedDemoState({ includeUsers: true, userMutation: { action: 'update', id } });
  setAppMessage(`User ${user.naam} updated.`, 'success');
  render();
}

async function resetUserPassword(id) {
  if (!isAdminUser()) return;
  const user = USERS.find(u => u.id === id);
  if (!user) return;
  if (!confirm(`Reset password for ${user.naam} to the start password?`)) return;
  user.passwordHash = await hashDemoPassword(FIRST_LOGIN_PASSWORD);
  user.mustChangePassword = true;
  user.passwordUpdatedAt = '';
  if (STATE.currentUser && STATE.currentUser.id === id) {
    STATE.currentUser = user;
    saveSessionUser(user);
    STATE.currentScreen = 'password_change';
  }
  saveUsers();
  logAudit('reset_user_password', 'user', id);
  await saveSharedDemoState({ includeUsers: true, userMutation: { action: 'update', id } });
  setAppMessage(`Password reset for ${user.naam}. Start password: ${FIRST_LOGIN_PASSWORD}`, 'success');
  render();
}

// Hoeveel vastgelegd werk hangt er nog aan deze gebruiker?
function countUserRecords(id) {
  const history = (STATE.history || []).filter(item => item.user_id === id).length;
  const labels = (STATE.labelPrints || []).filter(item => item.user_id === id).length;
  const monitors = (STATE.monitorLabelPrints || []).filter(item => item.user_id === id).length;
  return { history, labels, monitors, total: history + labels + monitors };
}

// Verwijdert al het werk van een gebruiker, zodat de medewerker ook uit Insights
// verdwijnt. Alleen na expliciete bevestiging: dit gooit echte gradings weg.
function removeUserRecords(id) {
  STATE.history = (STATE.history || []).filter(item => item.user_id !== id);
  STATE.labelPrints = (STATE.labelPrints || []).filter(item => item.user_id !== id);
  STATE.monitorLabelPrints = (STATE.monitorLabelPrints || []).filter(item => item.user_id !== id);
  if (typeof rebuildHistoryIndexes === 'function') rebuildHistoryIndexes();
  if (typeof rebuildLabelPrintIndexes === 'function') rebuildLabelPrintIndexes();
}

function deleteUser(id) {
  if (!isAdminUser()) return;
  if (STATE.currentUser && STATE.currentUser.id === id) return;
  const index = USERS.findIndex(u => u.id === id);
  if (index < 0) return;
  const user = USERS[index];
  if (!confirm(`Delete user ${user.naam}?`)) return;

  // Zonder de gradings mee te verwijderen blijft de medewerker in Insights staan,
  // dus vraag dat expliciet na (standaard = data behouden).
  const owned = countUserRecords(id);
  let purge = false;
  if (owned.total) {
    purge = confirm(
      `${user.naam} still has ${owned.total} records: ${owned.history} gradings, ${owned.labels} label prints, ${owned.monitors} monitor prints.\n\n`
      + `OK = also delete this data (the employee disappears from Insights too).\n`
      + `Cancel = keep the data and only remove the login.`
    );
  }

  logAudit('delete_user', 'user', id, { naam: user.naam, purgedData: purge, records: owned.total });
  USERS.splice(index, 1);
  if (purge) removeUserRecords(id);
  saveUsers();
  saveSharedDemoState({ includeUsers: true, userMutation: { action: 'delete', id } });
  setAppMessage(purge ? `User and ${owned.total} records deleted.` : 'User deleted.', 'success');
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
    repairIssues: {},
    repairActions: {},
    gradeReviewDone: false,
    finalGradeOverride: null,
    gestart: Date.now(),
    testOnly: Boolean(STATE.currentLaptop && STATE.currentLaptop.testOnly),
    result: null,
    supplierNoticesSeen: {},
  };
  STATE.currentScreen = modus === 'beginner' ? 'grading_beginner' : 'grading_expert';
  STATE.supplierNotice = null;
  updateSupplierNoticeForCurrentStep();
}

function buildExpertDirectResult(grade, repairText = '') {
  const normalized = grade === 'X' ? 'D' : String(grade || '').toUpperCase();
  const scores = { A: 0, B: 10, C: 30, D: 999 };
  const labels = { A: 'Premium', B: 'Good', C: 'Heavy Use', D: 'Repair / X' };
  const isRepair = normalized === 'D';
  const repairAction = isRepair && repairText ? createRepairAction('expert', repairText) : null;
  const repairPolicy = repairAction ? evaluateRepairPolicy([repairAction]) : null;
  return {
    score: scores[normalized] ?? 0,
    eindgrade: normalized,
    plafond: null,
    plafondReden: isRepair ? 'Expert marked device as repair / X' : null,
    redenen: [{
      type: isRepair ? 'bad' : normalized === 'A' ? 'good' : 'warn',
      text: isRepair
        ? `Expert repair reason: ${repairText}`
        : `Expert selected grade ${normalized} (${labels[normalized]})`,
    }],
    detailRows: [{
      naam: 'Expert grade',
      gewicht: 1,
      keuze: normalized,
      impact: labels[normalized],
      punten: scores[normalized] ?? 0,
    }],
    problems: isRepair ? [repairText] : [],
    forceProblemLabel: isRepair,
    ...(repairPolicy ? {
      repairActions: repairPolicy.actions,
      repairLabelType: repairPolicy.labelType,
      repairPolicy: {
        heavyCount: repairPolicy.heavyCount,
        lightCount: repairPolicy.lightCount,
        total: repairPolicy.total,
        remainsX: true,
        labelType: repairPolicy.labelType,
        reason: repairPolicy.reason,
      },
    } : {}),
    rulesVersion: GRADING_RULES_VERSION,
  };
}

async function confirmExpertFinalGrade(grade) {
  if (!STATE.currentGrading || STATE.currentGrading.modus !== 'expert') return false;
  const normalized = grade === 'X' ? 'D' : String(grade || '').toUpperCase();
  if (!['A', 'B', 'C', 'D'].includes(normalized)) return false;
  STATE.currentGrading.expertFinalGrade = normalized;
  STATE.currentGrading.gradeReviewDone = true;
  STATE.currentGrading.finalGradeOverride = normalized;
  setAppMessage(null);
  if (normalized === 'D') {
    render();
    return true;
  }
  STATE.currentGrading.result = buildExpertDirectResult(normalized);
  STATE.currentGrading.bevestigd = Date.now();
  await confirmSaveWithAutomaticLabels();
  return true;
}

async function completeExpertRepairGrade() {
  if (!STATE.currentGrading || STATE.currentGrading.modus !== 'expert') return false;
  const repairText = normalizeText(document.getElementById('expertRepairText') && document.getElementById('expertRepairText').value);
  if (!repairText) {
    setAppMessage('First enter the repair or damage for X.');
    render();
    return false;
  }
  STATE.currentGrading.expertRepairText = repairText;
  STATE.currentGrading.expertFinalGrade = 'D';
  STATE.currentGrading.finalGradeOverride = 'D';
  STATE.currentGrading.result = buildExpertDirectResult('D', repairText);
  STATE.currentGrading.bevestigd = Date.now();
  await confirmSaveWithAutomaticLabels();
  return true;
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
  const repairEntries = Object.entries(STATE.currentGrading.repairIssues || {}).filter(([, issue]) => Boolean(issue));
  const storedRepairActions = STATE.currentGrading.repairActions || {};
  const repairComponentNames = new Set(repairEntries.map(([componentId]) => {
    const component = getGradingOnderdelen().find(ond => ond.id === componentId);
    return component && component.naam;
  }).filter(Boolean));
  const genericRepairProblems = new Set(Array.from(repairComponentNames).map(name => `${name}: repair / not sellable`));
  const problemRows = buildProblemRows(
    STATE.currentGrading.keuzes,
    STATE.currentGrading.triggers,
    STATE.currentGrading.impactOverrides
  ).filter(problem => !genericRepairProblems.has(problem));
  const repairActions = repairEntries
    .map(([componentId, issue]) => storedRepairActions[componentId] || createRepairAction(componentId, issue))
    .filter(Boolean)
    .concat(typeof buildTriggerRepairActions === 'function' ? buildTriggerRepairActions(STATE.currentGrading.triggers) : []);
  STATE.currentGrading.result.problems = problemRows;
  if (repairEntries.length) {
    repairEntries.forEach(([, issue]) => {
      if (!STATE.currentGrading.result.problems.includes(issue)) STATE.currentGrading.result.problems.push(issue);
    });
  }
  const repairPolicy = typeof evaluateRepairPolicy === 'function' ? evaluateRepairPolicy(repairActions) : null;
  if (repairPolicy && repairPolicy.actions.length) {
    STATE.currentGrading.result.repairActions = repairPolicy.actions;
    STATE.currentGrading.result.repairPolicy = {
      heavyCount: repairPolicy.heavyCount,
      lightCount: repairPolicy.lightCount,
      total: repairPolicy.total,
      remainsX: repairPolicy.remainsX,
      labelType: repairPolicy.labelType,
      reason: repairPolicy.reason,
    };
    STATE.currentGrading.result.repairLabelType = repairPolicy.labelType;
    STATE.currentGrading.result.forceProblemLabel = true;
    repairPolicy.actions.forEach(action => {
      if (!STATE.currentGrading.result.problems.includes(action.issue)) STATE.currentGrading.result.problems.push(action.issue);
    });
    if (!repairPolicy.remainsX) {
      const originalResult = STATE.currentGrading.result;
      const afterRepairResult = calculateGradeAfterRepair(
        STATE.currentGrading.keuzes,
        STATE.currentGrading.triggers,
        STATE.currentGrading.impactOverrides,
        repairPolicy.actions
      );
      STATE.currentGrading.result = {
        ...afterRepairResult,
        problems: originalResult.problems,
        forceProblemLabel: true,
        repairActions: repairPolicy.actions,
        repairPolicy: originalResult.repairPolicy,
        repairLabelType: repairPolicy.labelType,
        repairOriginalGrade: originalResult.eindgrade,
        gradeAfterRepair: true,
        rulesVersion: GRADING_RULES_VERSION,
      };
      STATE.currentGrading.result.redenen.unshift({
        type: repairPolicy.labelType === 'production' ? 'warn' : 'bad',
        text: `${repairPolicy.reason}: specs label shows grade after repair.`,
      });
    } else {
      STATE.currentGrading.result.eindgrade = 'D';
      STATE.currentGrading.result.redenen.unshift({
        type: 'bad',
        text: `${repairPolicy.reason}: device stays X / not sellable.`,
      });
    }
  }
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

function isFinishedGradingReadyForAutomaticSave() {
  const g = STATE.currentGrading;
  const l = STATE.currentLaptop;
  return Boolean(
    g && l && g.result &&
    STATE.currentScreen === 'result' &&
    !STATE.pendingDecision &&
    !(g.testOnly || l.testOnly)
  );
}

async function confirmFinishedGradingIfReady() {
  if (!isFinishedGradingReadyForAutomaticSave()) return false;
  await confirmSaveWithAutomaticLabels();
  return true;
}

async function finishGradingAndMaybeConfirm() {
  finishGrading();
  if (await confirmFinishedGradingIfReady()) return true;
  render();
  return false;
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
    touchOverride: normalizeTouchOverride(l.touchOverride),
    battery: l.battery,
    gpu: l.gpu,
    user_id: STATE.currentUser.id,
    user_naam: STATE.currentUser.naam,
    modus: g.modus,
    rulesVersion: GRADING_RULES_VERSION,
    tijd: new Date().toLocaleTimeString('nl-NL', {hour: '2-digit', minute: '2-digit'}),
    savedAt: new Date().toISOString(),
    duurSec,
    keuzes: g.keuzes,
    triggers: g.triggers,
    impactOverrides: g.impactOverrides,
    repairIssues: g.repairIssues || {},
    repairActions: g.repairActions || {},
    finalGradeOverride: g.finalGradeOverride,
    expertFinalGrade: g.expertFinalGrade || '',
    expertRepairText: g.expertRepairText || '',
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
  STATE.supplierNotice = null;
  STATE.currentScreen = 'scan';
  STATE.homeTab = 'workflow';
  STATE.scanSearch = '';
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
  const printJobs = printTypes.map(type => createLaptopLabelPrintJob(l, g.result, type));

  const printResult = await printLabelJobsWithDymoFallback(
    printJobs,
    { allowBrowserFallback: false }
  );
  if (!printResult.ok) {
    setAppMessage(`Automatic DYMO printing failed. ${printResult.fallbackReason || 'Check DYMO Connect on this PC.'} The grading was not saved, so you can confirm again after DYMO works.`);
    render();
    return;
  }

  saveGrading();
  setAppMessage(printTypes.length > 1
    ? 'Specs and repair labels printed. Grading saved.'
    : 'Specs label printed. Grading saved.',
    'success');
  render();
}

