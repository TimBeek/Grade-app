// Guided inspection records observations separately from the grading rules.
const GUIDED_INSPECTION_VERSION = '20261003-observations-v2';
const GUIDED_INSPECTION = {
  bovenkap: { instruction: 'Inspect a clean lid. Remove dust and sticker residue, then tilt it in the light.', points: 'Actual scratches · cracks · corners · closing normally' },
  onderkant: { instruction: 'Turn the laptop over. Look along the edges, screw points and rubber feet.', points: 'Cracks · missing pieces · rubber feet' },
  randen: { instruction: 'Follow the entire edge of the laptop. Look closely at each corner.', points: 'Missing corners · open housing · sharp edges' },
  palmrest: { instruction: 'Look around the keyboard and touchpad. Check the corners and feel the coating.', points: 'Cracks · missing pieces · sticky coating' },
  bezel: { instruction: 'Follow the screen frame around all four corners. Look closely for thin cracks.', points: 'Hairline cracks · broken pieces · loose frame' },
  lcd: { instruction: 'Check the screen off and on, from about 30 cm. Use a plain light background when on.', points: 'Cracked glass · lines or flicker · white spots' },
  keyboard: { instruction: 'Look across every row of keys. Check missing keys and confirm their operation.', points: 'Missing keys · damaged keys · keys responding' },
  touchpad: { instruction: 'Look at the touchpad in the light. Check for cracks and test movement and clicks.', points: 'Cracks · missing pieces · movement and clicks' },
  scharnieren: { instruction: 'Open and close the screen. Look at both hinge attachments and feel for play.', points: 'Loose attachments · broken housing · opens and closes' },
};

// Photo-local observations, not a second grading vocabulary or a damage bar.
const GUIDED_PHOTO_FINDINGS = {
  barst_boven: { letter: 'C', label: 'Crack', icon: 'damage' },
  hoek_boven: { letter: 'C', label: 'Missing corner', icon: 'part_randen' },
  verbuiging_boven: { letter: 'D', label: 'Does not close', icon: 'part_scharnieren' },
  barst_onder: { letter: 'C', option: 1, label: 'Crack / break', icon: 'damage' },
  hoek_onder: { letter: 'C', option: 1, label: 'Missing corner', icon: 'part_randen' },
  hoek_randen: { letter: 'C', label: 'Missing corner', icon: 'part_randen' },
  scherp_randen: { letter: 'D', label: 'Sharp edge', icon: 'damage' },
  barst_palm: { letter: 'C', label: 'Crack', icon: 'damage' },
  plakkerig_palm: { letter: 'C', label: 'Sticky coating', icon: 'touch' },
  haarscheur_bezel: { letter: 'B', option: 1, label: 'Hairline crack', icon: 'damage' },
  haarscheur_gerepareerd: { letter: 'B', option: 1, label: 'Repair visible', icon: 'inspectParts' },
  barst_bezel: { letter: 'C', option: 1, label: 'Crack / break', icon: 'damage' },
  pixel_lcd: { letter: 'D', label: 'Line / flicker', icon: 'part_lcd' },
  barst_lcd: { letter: 'D', label: 'Cracked glass', icon: 'damage' },
  keyinprint_lcd: { letter: 'C', option: 0, label: 'Key marks', icon: 'part_keyboard' },
  whitespot_lcd: { letter: 'C', option: 1, label: 'White spot', icon: 'part_lcd' },
  backlight_lcd: { letter: 'B', label: 'Backlight bleeding', icon: 'part_lcd', informationOnly: true },
  toets_ontbreekt: { letter: 'D', label: 'Missing keys', icon: 'part_keyboard' },
  toets_kapot: { letter: 'D', label: 'Key not responding', icon: 'part_keyboard' },
  barst_touchpad: { letter: 'C', option: 1, label: 'Crack', icon: 'damage' },
  touchpad_kapot: { letter: 'D', label: 'Not responding', icon: 'touch' },
  scharnier_kapot: { letter: 'D', label: 'Not working normally', icon: 'part_scharnieren' },
  verbuiging_scharnier: { letter: 'D', label: 'Cannot close', icon: 'part_scharnieren' },
};

async function selectGuidedPhotoFinding(triggerId, componentId) {
  if (!isGuidedInspection() || getGuidedDialogType() || STATE.pendingDecision) return;
  const g = STATE.currentGrading;
  const component = getGradingOnderdelen()[g.huidigeIndex];
  if (component.id !== componentId || !(component.triggers || []).some(t => t.id === triggerId)) return;
  const finding = GUIDED_PHOTO_FINDINGS[triggerId];
  if (!finding) return;
  const removing = Boolean(g.triggers[triggerId]);
  toggleGuidedTrigger(triggerId);
  if (STATE.pendingDecision || removing || finding.informationOnly || finding.letter === 'D') return;
  // Exact photographic subchoices reuse the same existing rule and image path.
  applyComponentChoice(component.id, finding.letter, false);
  if (finding.option != null && STATE.pendingDecision) {
    await resolvePendingDecision(finding.option);
  } else if (STATE.pendingDecision) {
    // The finding itself is the observation (e.g. a cracked cover), not an
    // invented scratch/paint subchoice. The active trigger preserves its limit.
    STATE.pendingDecision = null;
    acknowledgeGuidedChoice(component.id, finding.label);
    render();
  }
}

// Observable criteria only: these captions never alter grading rules.
const GUIDED_CHOICE_POINTS = {
  "bovenkap": {
    "A": [
      "No dents or coating damage",
      "Clean surface; no stickers"
    ],
    "B": [
      "Light coating wear or small dents",
      "Scratches up to 1 cm"
    ],
    "C": [
      "Deep scratches or heavy coating wear",
      "Dents or a small missing corner"
    ],
    "D": [
      "Structural break or sharp edges",
      "Bent cover that does not close"
    ]
  },
  "onderkant": {
    "A": [
      "Light marks up to 0.5 cm",
      "All rubber feet present"
    ],
    "B": [
      "Visible scratches or a small dent",
      "Light coating wear; feet may be missing"
    ],
    "C": [
      "Heavy scratches, dents or coating damage",
      "Crack or small missing corner"
    ],
    "D": [
      "Severe damage to the bottom cover",
      "Damage prevents normal use"
    ]
  },
  "randen": {
    "A": [
      "Only light signs of use",
      "No dents or coating damage"
    ],
    "B": [
      "Scratches or light dents",
      "Coating wear in several places"
    ],
    "C": [
      "Deep scratches or strong dents",
      "Missing corner: check the damage"
    ],
    "D": [
      "Broken, open or badly bent housing",
      "Check for dangerous sharp edges"
    ]
  },
  "palmrest": {
    "A": [
      "No scratches or coating damage",
      "Soft-touch coating intact"
    ],
    "B": [
      "Light scratches or coating wear",
      "A small dent is allowed"
    ],
    "C": [
      "Heavy scratches or sticky coating",
      "Dents or a small missing corner"
    ],
    "D": [
      "Large missing corner or breakage",
      "Sharp edges or a safety risk"
    ]
  },
  "bezel": {
    "A": [
      "No visible damage or cracks",
      "No visible repairs"
    ],
    "B": [
      "Small scratches or discoloration",
      "Hairline crack: choose the detail"
    ],
    "C": [
      "Clear cracks or heavy coating damage",
      "Inspect the corners and frame"
    ],
    "D": [
      "Broken or loose screen frame",
      "Check the exact damage next"
    ]
  },
  "lcd": {
    "A": [
      "No key marks or scratches",
      "No white spots, lines or cracked glass"
    ],
    "B": [
      "Light key marks or a small white spot",
      "Barely visible with the screen on"
    ],
    "C": [
      "Visible key marks, scratches or spots",
      "Clearly visible with the screen on"
    ],
    "D": [
      "Cracked glass, pixel lines or flicker",
      "Check the exact screen fault next"
    ]
  },
  "keyboard": {
    "A": [
      "Only minimal key wear",
      "Check all keys are present and working"
    ],
    "B": [
      "Light use marks or fading",
      "Check every key responds"
    ],
    "C": [
      "Heavy fading or coating wear",
      "Check every key responds"
    ],
    "D": [
      "Missing or non-responsive keys",
      "Choose the exact keyboard fault next"
    ]
  },
  "touchpad": {
    "A": [
      "No visible damage",
      "Movement and clicks work normally"
    ],
    "B": [
      "Light scratches or signs of use",
      "Movement and clicks work normally"
    ],
    "C": [
      "Deep scratches, coating loss or a crack",
      "Check movement and clicks"
    ],
    "D": [
      "Touchpad missing or not responding",
      "Check movement and clicks"
    ]
  },
  "scharnieren": {
    "A": [
      "No visible hinge damage",
      "Screen opens and closes normally"
    ],
    "B": [
      "Light wear; no deep scratches",
      "Check both hinge attachments"
    ],
    "C": [
      "Play or clearly visible wear",
      "Still connected; no break"
    ],
    "D": [
      "Heavy hinge or mounting damage",
      "Check whether it opens and closes"
    ]
  }
};

function renderGuidedChoicePoints(componentId, letter) {
  const points = GUIDED_CHOICE_POINTS[componentId]?.[letter] || [];
  return `<span class="inspection-choice-points" role="list" id="inspection-points-${componentId}-${letter}">${points.map((text, index) => `<span class="inspection-choice-point" role="listitem">${uiIcon(index === 0 ? `part_${componentId}` : 'inspectParts')}<span>${escapeHtml(text)}</span></span>`).join('')}</span>`;
}

function guidedDecisionLabel(label) {
  const observations = { 'Key Marks C': 'Clear key marks', 'Whitespot C': 'Clear white spot', 'Mixed C': 'Key marks and white spot' };
  return observations[label] || guidedDecisionCopy(label);
}

function guidedDecisionDetail(detail) {
  if (detail === 'Clear but still sellable white spot') return 'Clearly visible white spot';
  return guidedDecisionCopy(detail);
}

// Supplier text is a prompt to inspect, never a score or a selected answer.
function getGuidedSupplierIssues(componentId, laptop = STATE.currentLaptop) {
  return [...new Set(splitSupplierIssues(laptop).filter(note => getGuidedSupplierComponents(note).includes(componentId)))];
}

function getGuidedSupplierComponents(note) {
  const text = String(note || '').toLowerCase();
  const frame = /bezel|screen[\s_-]*frame|schermrand|schermlijst/.test(text);
  const screen = !frame && /screen|scherm|display|lcd|glass|glas|pixel|white\s*spot|whitespot|backlight|pressure|key\s*(marks|imprint)|toetsafdruk/.test(text);
  const parts = [];
  if (/bovenkap|top[\s_-]*cover|\blid\b(?:[\s_-]*cover)?|deksel/.test(text)) parts.push('bovenkap');
  if (/onderkant|bottom|rubber|voetjes|rubber feet/.test(text)) parts.push('onderkant');
  if (/palmrest|polssteun/.test(text)) parts.push('palmrest');
  if (/touchpad/.test(text)) parts.push('touchpad');
  if (/scharnier|hinge/.test(text)) parts.push('scharnieren');
  if (frame) parts.push('bezel');
  if (screen) parts.push('lcd');
  if (/keyboard|toetsenbord|missing.*key|key.*missing|toets.*ontbreekt|key.*not working|toets.*kapot/.test(text) || (!screen && /\bkeys?\b|\btoets(en)?\b/.test(text))) parts.push('keyboard');
  // A corner/edge of an explicitly named cover, frame or hinge belongs there,
  // not also to the general chassis-edge step.
  if (!parts.length && /hoek|corner|\brand|randen|\bedges?\b|dent|deuk/.test(text)) parts.push('randen');
  // Unlocated housing notes are reviewed once, at the initial housing check.
  // Never duplicate them across all covers or invent a second defect location.
  if (!parts.length && /behuizing|housing|casing|\bcase\b/.test(text)) parts.push('bovenkap');
  return parts;
}

function getGuidedSupplierAdviceLetter(componentId, note) {
  const text = String(note || '').toLowerCase();
  if (/\b(no damage|no defects|no cracks|not cracked|geen schade|geen defect|geen scheur)\b/.test(text)) return null;
  if (componentId === 'bezel' && /hairline|haarscheur/.test(text)) return 'B';
  if (/not working|not functional|werkt niet|functioneert niet|defect|faulty|kapot|missing.*key|key.*missing|toets.*ontbreekt|broken|gebroken|cracked.*glass|gebarsten.*(glas|scherm)/.test(text)) return 'D';
  if (/major|heavy|large|deep|severe|groot|grote|diep|zwaar|hevig|sterk|crack|barst|scheur/.test(text)) return 'C';
  if (/minor|light|small|slight|licht|klein|minimaal|\bused\b|use marks|wear|gebruikssporen|slijtage|scratch|kras/.test(text)) return 'B';
  return null; // Unknown severity stays available in checkpoints; do not guess.
}

function isGuidedSupplierImportant(componentId, note) {
  if (/\b(no damage|no defects|no cracks|not cracked|geen schade|geen defect|geen scheur)\b/i.test(note)) return false;
  if (/major|heavy|large|deep|severe|groot|grote|diep|zwaar|hevig|sterk|hairline|haarscheur|crack|barst|scheur|broken|gebroken|faulty|defect|kapot|missing|ontbreekt|not working|not functional|werkt niet|sharp|dangerous/i.test(note)) return true;
  if (/minor|light|small|slight|licht|klein|minimaal/i.test(note)) return false;
  return isSupplierPopupIssue(note, componentId) || /major|heavy|large|deep|severe|groot|grote|diep|zwaar|hevig|sterk|hairline|haarscheur/i.test(note);
}

function getGuidedSupplierPhotoAdvice(componentId, letter, laptop = STATE.currentLaptop) {
  return getGuidedSupplierIssues(componentId, laptop).filter(note => getGuidedSupplierAdviceLetter(componentId, note) === letter);
}

function openGuidedSupplierAdvice(componentId, letter) {
  if (!isGuidedInspection() || getGuidedDialogType() || STATE.pendingDecision) return;
  const component = getGradingOnderdelen()[STATE.currentGrading.huidigeIndex];
  if (component.id !== componentId || !getGuidedSupplierPhotoAdvice(componentId, letter).length) return;
  STATE.currentGrading.inspectionSupplierChoice = letter;
  STATE.currentGrading.inspectionDialog = 'supplier';
  render();
}

function isGuidedInspection() {
  return Boolean(STATE.currentGrading && STATE.currentGrading.modus === 'beginner' && STATE.currentGrading.inspectionVersion);
}

function getGuidedDialogType() {
  if (!isGuidedInspection() || STATE.currentScreen !== 'grading_beginner' || STATE.imagePreview) return null;
  if (STATE.pendingDecision) return 'followup';
  const g = STATE.currentGrading;
  if (['cleaning', 'touch', 'damage', 'checks', 'review', 'supplier'].includes(g.inspectionDialog)) return g.inspectionDialog;
  const id = getGradingOnderdelen()[g.huidigeIndex].id;
  if (id === 'bovenkap' && g.coverCleaning !== 'cleaned') return 'cleaning';
  if (id === 'lcd' && !g.touchChecked && !g.touchUncertain) return 'touch';
  if (STATE.supplierNotice) return 'checks';
  return null;
}

function getGuidedUncertainParts() {
  if (!isGuidedInspection()) return [];
  const g = STATE.currentGrading;
  return getGradingOnderdelen().filter(c => g.inspectionDoubts[c.id] || (c.id === 'lcd' && g.touchUncertain));
}

function openGuidedDialog(type) {
  if (!isGuidedInspection() || STATE.pendingDecision || getGuidedDialogType()) return;
  const g = STATE.currentGrading;
  if (type === 'checks') {
    const id = getGradingOnderdelen()[g.huidigeIndex].id;
    type = id === 'bovenkap' ? 'cleaning' : id === 'lcd' ? 'touch' : 'checks';
  }
  if (!['damage', 'checks', 'cleaning', 'touch', 'review'].includes(type)) return;
  g.inspectionDialog = type;
  render();
}

function closeGuidedDialog() {
  if (!isGuidedInspection() || STATE.currentGrading.dialogBusy) return;
  const g = STATE.currentGrading;
  const type = getGuidedDialogType();
  if (type === 'followup') { cancelPendingDecision(); render(); return; }
  if (type === 'review' || (type === 'cleaning' && g.coverCleaning !== 'cleaned') || (type === 'touch' && !g.touchChecked)) return;
  if ((type === 'checks' || type === 'supplier') && STATE.supplierNotice) confirmSupplierNotice();
  g.inspectionDialog = null;
  render();
}

function returnToGuidedUncertainPart(index) {
  if (!isGuidedInspection()) return;
  const component = getGradingOnderdelen()[index];
  if (!component || !getGuidedUncertainParts().some(c => c.id === component.id)) return;
  const g = STATE.currentGrading;
  g.inspectionDialog = null;
  g.huidigeIndex = index;
  STATE.supplierNotice = null;
  updateSupplierNoticeForCurrentStep();
  if (component.id === 'lcd' && g.touchUncertain) g.inspectionDialog = 'touch';
  render();
}

function getGuidedSupplierTouch(laptop = STATE.currentLaptop) {
  const explicit = normalizeTouchOverride(laptop && (laptop.touchscreen ?? laptop.touch));
  if (explicit) return explicit;
  if (isTouchscreenFromDisplay(laptop)) return 'yes';
  if (/\b(non|no|geen|zonder)[\s_-]*touch/i.test(String(laptop && laptop.display || ''))) return 'no';
  return 'unknown';
}

function getGuidedTouchSelection() {
  const g = STATE.currentGrading || {};
  const draft = normalizeTouchOverride(g.touchSelection || g.touchDecision);
  if (draft) return draft;
  const override = normalizeTouchOverride(STATE.currentLaptop && STATE.currentLaptop.touchOverride);
  if (override) return override;
  if (isAlwaysTouchModel()) return 'yes';
  const supplier = getGuidedSupplierTouch();
  return supplier === 'unknown' ? (isTouchscreenLaptop() ? 'yes' : 'no') : supplier;
}

function toggleGuidedTouchSelection() {
  if (!isGuidedInspection() || getGuidedDialogType() !== 'touch' || STATE.currentGrading.dialogBusy) return;
  STATE.currentGrading.touchSelection = getGuidedTouchSelection() === 'yes' ? 'no' : 'yes';
  render();
  const control = typeof document.querySelector === 'function' && document.querySelector('[data-inspection-touch-toggle]');
  if (control) control.focus({preventScroll:true});
}

async function confirmGuidedTouch(value) {
  if (!isGuidedInspection() || STATE.currentGrading.dialogBusy || !['yes', 'no', 'uncertain'].includes(value)) return;
  const g = STATE.currentGrading;
  if (getGradingOnderdelen()[g.huidigeIndex].id !== 'lcd') return;
  if (value === 'uncertain') {
    g.touchUncertain = true;
    g.touchChecked = false;
    g.inspectionDialog = null;
    g.result = null;
    confirmSupplierNotice();
    render();
    return;
  }
  const changed = isTouchscreenLaptop() !== (value === 'yes');
  const wasUncertain = g.touchUncertain;
  g.dialogBusy = true;
  render();
  try {
    if (changed) {
      if (g.testOnly || STATE.currentLaptop.testOnly) {
        const defaultValue = isTouchscreenByDefault() ? 'yes' : 'no';
        setLaptopTouchOverride(STATE.currentLaptop, value === defaultValue ? '' : value);
      } else {
        await setCurrentLaptopTouchOverride(value);
      }
    }
    if (STATE.currentGrading !== g) return;
    g.touchChecked = true;
    g.touchUncertain = false;
    g.touchDecision = value;
    g.touchSelection = value;
    g.inspectionDialog = null;
    if (changed || wasUncertain) {
      delete g.keuzes.lcd;
      delete g.impactOverrides.lcd;
      g.inspectionChecks.lcd = false;
      g.result = null;
      g.gradeReviewDone = false;
      g.finalGradeOverride = null;
    }
    confirmSupplierNotice();
    setAppMessage(null);
  } catch (error) {
    reportAppError('Touch confirmation failed', error);
    setAppMessage('Touch could not be confirmed. Your other answers are kept. Try again.');
  } finally {
    g.dialogBusy = false;
    if (STATE.currentGrading === g) render();
  }
}

function handleGuidedDialogKeydown(event) {
  const type = getGuidedDialogType();
  if (!type) return false;
  if (event.key === 'Escape') { event.preventDefault(); closeGuidedDialog(); }
  if (event.key === 'Tab') {
    const dialog = document.getElementById('inspection-dialog');
    const buttons = dialog ? [...dialog.querySelectorAll('button:not(:disabled), [tabindex="0"]')] : [];
    const first = buttons[0], last = buttons[buttons.length - 1];
    if (!first) event.preventDefault();
    else if (event.shiftKey && (document.activeElement === first || !buttons.includes(document.activeElement))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !buttons.includes(document.activeElement))) {
      event.preventDefault(); first.focus();
    }
  }
  return true;
}

function focusGuidedDialog(app) {
  const dialog = document.getElementById('inspection-dialog');
  for (const child of app.children || []) child.inert = Boolean(dialog && !child.contains(dialog));
  if (dialog) {
    if (!('inspectionOverflow' in app.dataset)) app.dataset.inspectionOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const target = dialog.querySelector('[data-inspection-default-focus]') || dialog;
    if (typeof target.focus === 'function') target.focus({ preventScroll: true });
  } else if ('inspectionOverflow' in app.dataset) {
    document.body.style.overflow = app.dataset.inspectionOverflow;
    delete app.dataset.inspectionOverflow;
  }
}

function recordGuidedRepair(componentId, action) {
  if (!isGuidedInspection() || !action) return;
  const g = STATE.currentGrading;
  g.inspectionRepairs = g.inspectionRepairs || {};
  const actions = g.inspectionRepairs[componentId] || [];
  if (!actions.some(item => item.issue === action.issue)) actions.push(action);
  g.inspectionRepairs[componentId] = actions;
}

function removeGuidedRepair(index) {
  if (!isGuidedInspection() || STATE.pendingDecision) return;
  const g = STATE.currentGrading;
  const component = getGradingOnderdelen()[g.huidigeIndex];
  const actions = (g.inspectionRepairs || {})[component.id] || [];
  if (!Number.isInteger(index) || index < 0 || index >= actions.length) return;
  actions.splice(index, 1);
  delete g.repairIssues[component.id];
  delete g.repairActions[component.id];
  delete g.keuzes[component.id];
  delete g.impactOverrides[component.id];
  g.inspectionChecks[component.id] = false;
  g.result = null;
  render();
}

function setCoverCleaning(cleaned) {
  if (!isGuidedInspection() || STATE.pendingDecision) return;
  const g = STATE.currentGrading;
  if (getGradingOnderdelen()[g.huidigeIndex].id !== 'bovenkap') return;
  g.coverCleaning = cleaned ? 'cleaned' : 'needed';
  g.inspectionDialog = cleaned ? null : 'cleaning';
  delete g.keuzes.bovenkap;
  delete g.impactOverrides.bovenkap;
  g.inspectionChecks.bovenkap = false;
  g.result = null;
  // Cleaning confirms cleanliness only, not an unread supplier damage notice.
  render();
}

function getGuidedComponentStatus(componentId) {
  const g = STATE.currentGrading;
  if (!g) return 'open';
  if (componentId === 'lcd' && g.touchUncertain) return 'doubt';
  if (componentId === 'bovenkap' && g.coverCleaning !== 'cleaned') return g.inspectionDoubts[componentId] ? 'doubt' : 'open';
  if (componentId === 'lcd' && !g.touchChecked) return 'open';
  if (g.inspectionDoubts && g.inspectionDoubts[componentId]) return 'doubt';
  if (STATE.pendingDecision && STATE.pendingDecision.componentId === componentId) return 'open';
  return g.keuzes[componentId] && g.inspectionChecks && g.inspectionChecks[componentId] ? 'done' : 'open';
}

function getGuidedMissingChecks(grading) {
  if (!grading || !grading.inspectionVersion) return [];
  return getGradingOnderdelen().filter(component =>
    (component.id === 'bovenkap' && grading.coverCleaning !== 'cleaned') ||
    (component.id === 'lcd' && (!grading.touchChecked || grading.touchUncertain)) ||
    !grading.inspectionChecks || !grading.inspectionChecks[component.id] ||
    (grading.inspectionDoubts && grading.inspectionDoubts[component.id]) ||
    (STATE.pendingDecision && STATE.pendingDecision.componentId === component.id));
}

function acknowledgeGuidedChoice(componentId, observation) {
  if (!isGuidedInspection()) return;
  const g = STATE.currentGrading;
  g.inspectionChecks[componentId] = true;
  delete g.inspectionDoubts[componentId];
  g.inspectionObservations[componentId] = observation;
}

function markGuidedDoubt() {
  if (!isGuidedInspection() || STATE.pendingDecision) return;
  const g = STATE.currentGrading;
  const component = getGradingOnderdelen()[g.huidigeIndex];
  g.inspectionDialog = null;
  confirmSupplierNotice();
  g.inspectionDoubts[component.id] = true;
  g.inspectionChecks[component.id] = false;
  g.result = null;
  // Continue inspecting the remaining parts without releasing a final label.
  if (g.huidigeIndex < getGradingOnderdelen().length - 1) {
    g.huidigeIndex++;
    updateSupplierNoticeForCurrentStep();
  } else { g.inspectionDialog = 'review'; }
  render();
}

function visitGuidedComponent(index) {
  if (!isGuidedInspection() || STATE.pendingDecision || getGuidedDialogType()) return;
  const components = getGradingOnderdelen();
  if (!Number.isInteger(index) || index < 0 || index >= components.length) return;
  STATE.currentGrading.huidigeIndex = index;
  STATE.supplierNotice = null;
  updateSupplierNoticeForCurrentStep();
  render();
}

function toggleGuidedTrigger(triggerId) {
  if (!isGuidedInspection() || STATE.pendingDecision) return;
  const g = STATE.currentGrading;
  const component = getGradingOnderdelen()[g.huidigeIndex];
  const trigger = (component.triggers || []).find(item => item.id === triggerId);
  if (!trigger) return;
  // Functional failures and cracked LCD glass use the existing explicit repair
  // decisions, avoiding a second, weaker route for the same physical defect.
  const repairRoutes = {
    verbuiging_boven: ['D', 2], scherp_randen: ['D', 1],
    pixel_lcd: ['D', null], barst_lcd: ['D', 1],
    toets_ontbreekt: ['D', null], toets_kapot: ['D', null],
    touchpad_kapot: ['D', 0], scharnier_kapot: ['D', null], verbuiging_scharnier: ['D', null],
  };
  if (repairRoutes[triggerId]) {
    g.inspectionDialog = null;
    const [letter, optionIndex] = repairRoutes[triggerId];
    applyComponentChoice(component.id, letter, false);
    if (optionIndex != null) {
      const decision = STATE.pendingDecision;
      if (decision) {
        // Keep the exact repair selected visible; allow the worker to add other
        // observations before explicitly continuing to the next part.
        resolvePendingDecision(optionIndex);
      }
    }
    return;
  }
  g.triggers[triggerId] = !g.triggers[triggerId];
  g.inspectionChecks[component.id] = false;
  g.gradeReviewDone = false;
  g.finalGradeOverride = null;
  g.result = null;
  render();
}

function guidedDraftKey() {
  return STATE.currentUser && STATE.currentLaptop
    ? `remarktGuidedDraftV1:${STATE.currentUser.id}:${normalizeStickerCode(STATE.currentLaptop.sticker)}` : null;
}

function persistGuidedDraft() {
  if (!isGuidedInspection() || STATE.currentGrading.testOnly) return;
  const key = guidedDraftKey();
  if (!key) return;
  try {
    // Only this small, local draft is written: no network request or photos.
    const { result, ...grading } = STATE.currentGrading;
    localStorage.setItem(key, JSON.stringify({ rulesVersion: GRADING_RULES_VERSION, savedAt: Date.now(), grading, pendingDecision: STATE.pendingDecision }));
  } catch { /* Browser storage restrictions must not interrupt inspection. */ }
}

function restoreGuidedDraft() {
  const key = guidedDraftKey();
  if (!key || STATE.currentLaptop.testOnly) return false;
  try {
    const draft = JSON.parse(localStorage.getItem(key));
    if (!draft || draft.rulesVersion !== GRADING_RULES_VERSION ||
        draft.grading.inspectionVersion !== GUIDED_INSPECTION_VERSION ||
        normalizeStickerCode(draft.grading.laptop_sticker) !== normalizeStickerCode(STATE.currentLaptop.sticker)) return false;
    if (!draft.grading.keuzes || !draft.grading.triggers || !draft.grading.inspectionChecks || !draft.grading.inspectionDoubts || !draft.grading.inspectionObservations ||
        !Number.isInteger(draft.grading.huidigeIndex) || draft.grading.huidigeIndex < 0 || draft.grading.huidigeIndex >= getGradingOnderdelen().length) return false;
    const elapsed = Math.max(0, Number(draft.savedAt) - Number(draft.grading.gestart));
    STATE.currentGrading = { ...draft.grading, dialogBusy: false, gestart: Date.now() - (Number.isFinite(elapsed) ? elapsed : 0), result: null };
    STATE.pendingDecision = draft.pendingDecision || null;
    return true;
  } catch { return false; }
}

function clearGuidedDraft() {
  const key = guidedDraftKey();
  if (key) { try { localStorage.removeItem(key); } catch {} }
}

function getGuidedDamageCount(component) {
  const g = STATE.currentGrading;
  return (component.triggers || []).filter(t => g.triggers[t.id]).length + ((g.inspectionRepairs || {})[component.id] || []).length;
}

function renderGuidedSupplierDetails(component) {
  const issues = getGuidedSupplierIssues(component.id);
  return issues.length ? `<section class="inspection-supplier-details"><h3>Supplier notice</h3><ul data-i18n-skip>${issues.map(issue => `<li>${escapeHtml(issue)}</li>`).join('')}</ul></section>` : '';
}

function renderGuidedRecordedRepairs(component) {
  const repairs = ((STATE.currentGrading.inspectionRepairs || {})[component.id] || []);
  return repairs.length ? `<section class="inspection-recorded-repairs"><h3>Recorded observations</h3>${repairs.map((action, index) => `<div><span>${escapeHtml(translateCopy(guidedDecisionCopy(action.issue)))}</span><button type="button" class="inspection-trigger" data-inspection-remove-repair="${index}">Remove</button></div>`).join('')}</section>` : '';
}

function renderGuidedPopup(type, component) {
  if (!type) return '';
  const g = STATE.currentGrading;
  const busy = g.dialogBusy ? 'disabled' : '';
  let title, icon, body, footer;
  if (type === 'cleaning') {
    title = g.coverCleaning === 'needed' ? 'Clean the lid before assessing' : 'Is the lid clean?';
    icon = 'clean';
    body = `<p>Dust and removable sticker residue are not damage. Assess the actual scratches and coating after cleaning.</p>
      ${renderGuidedSupplierDetails(component)}
      <div class="inspection-dialog-options">
        <button type="button" class="inspection-dialog-option" data-action="inspection_cleaned">${uiIcon('complete')}<strong>${g.coverCleaning === 'needed' ? 'Cleaned — inspect again' : 'Yes, clean'}</strong></button>
        <button type="button" class="inspection-dialog-option" data-action="inspection_clean">${uiIcon('clean')}<strong>No, clean first</strong></button>
      </div>${g.coverCleaning === 'needed' ? '<p class="inspection-dialog-note" role="status">Remove the dust and residue, then inspect again. Clean does not necessarily mean undamaged.</p>' : ''}`;
    footer = '<button type="button" class="btn btn-secondary" data-action="inspection_doubt">I cannot assess this yet</button>';
  } else if (type === 'touch') {
    title = 'Does this laptop have a touchscreen?';
    icon = 'touch';
    const supplier = getGuidedSupplierTouch();
    const selection = getGuidedTouchSelection();
    body = `<p>Check the actual laptop. If touch should work but does not respond, choose I am unsure, not No.</p>
      <section class="inspection-supplier-details"><h3>Supplier list</h3><p><strong>${supplier === 'yes' ? 'Touch: yes' : supplier === 'no' ? 'Touch: no' : 'Touch not specified'}</strong></p>
      ${STATE.currentLaptop.display ? `<span>Screen description</span><p data-i18n-skip>${escapeHtml(STATE.currentLaptop.display)}</p>` : ''}
      ${isAlwaysTouchModel() ? '<p>Model standard: touchscreen</p>' : ''}</section>
      ${renderGuidedSupplierDetails(component)}
      <div class="inspection-touch-control"><span class="inspection-touch-icon">${uiIcon(selection === 'yes' ? 'touch' : 'monitor')}</span><div><strong>Touchscreen</strong><p id="inspection-touch-state" role="status">${selection === 'yes' ? 'Yes, touchscreen' : 'No touchscreen'}</p></div><button type="button" class="inspection-touch-switch" role="switch" aria-checked="${selection === 'yes'}" aria-label="Touchscreen" aria-describedby="inspection-touch-state" data-inspection-touch-toggle ${busy}><span></span></button></div>
      <p class="inspection-touch-help">Change the switch if your physical check shows something different.</p>`;
    footer = `<button type="button" class="btn btn-primary" data-inspection-touch="${selection}" ${busy}>Checked, continue</button><button type="button" class="btn btn-secondary" data-inspection-touch="uncertain" ${busy}>${uiIcon('question')}<span>I am unsure</span></button>`;
  } else if (type === 'review') {
    title = 'Ask a coordinator or manager to join you';
    icon = 'users';
    const uncertain = getGuidedUncertainParts();
    body = `<p>Do not print yet. Check the uncertain parts together before confirming the final grade.</p>
      <div class="inspection-review-list">${uncertain.map(c => `<button type="button" data-inspection-review-part="${getGradingOnderdelen().indexOf(c)}">${uiIcon('question')}<strong>${escapeHtml(c.naam)}</strong><span>${c.id === 'lcd' && g.touchUncertain ? 'Touch is uncertain' : 'Assessment is uncertain'}</span>${uiIcon('chevron')}</button>`).join('')}</div>
      <p class="inspection-dialog-note" role="status">Printing is blocked until every uncertain part has been reassessed. Your other answers are kept.</p>`;
    footer = uncertain.length ? `<button type="button" class="btn btn-primary" data-inspection-review-part="${getGradingOnderdelen().indexOf(uncertain[0])}">Reassess together</button>` : '<button type="button" class="btn btn-secondary" data-action="inspection_review_close">Back to inspection</button>';
  } else if (type === 'supplier') {
    title = 'Supplier observation';
    icon = 'info';
    const notes = getGuidedSupplierPhotoAdvice(component.id, g.inspectionSupplierChoice);
    const other = getGuidedSupplierIssues(component.id).filter(note => !notes.includes(note));
    body = `<p>The supplier reported this damage. Compare it with the actual laptop; this does not select a condition or determine the final grade.</p>
      <section class="inspection-supplier-details"><h3>Reported near this example</h3><ul data-i18n-skip>${notes.map(note => `<li>${escapeHtml(note)}</li>`).join('')}</ul></section>
      ${other.length ? `<section class="inspection-supplier-details"><h3>Other observations for this part</h3><ul data-i18n-skip>${other.map(note => `<li>${escapeHtml(note)}</li>`).join('')}</ul></section>` : ''}`;
    footer = '<button type="button" class="btn btn-primary" data-action="inspection_dialog_close">Back to the photos</button>';
  } else if (type === 'damage') {
    title = 'Add additional damage';
    icon = 'damage';
    body = `<p>Select everything you see. Afterwards, choose the condition using the photos.</p>
      <div class="inspection-damage-options">${(component.triggers || []).map(trigger => `<button type="button" class="inspection-trigger ${g.triggers[trigger.id] ? 'active' : ''}" data-inspection-trigger="${trigger.id}" aria-pressed="${Boolean(g.triggers[trigger.id])}">${uiIcon(g.triggers[trigger.id] ? 'complete' : 'plus')}<span>${escapeHtml(trigger.label)}</span></button>`).join('')}</div>
      ${((g.inspectionRepairs || {})[component.id] || []).length ? `<section class="inspection-recorded-repairs"><h3>Recorded repair issues</h3>${g.inspectionRepairs[component.id].map((action, index) => `<div><span>${escapeHtml(translateCopy(guidedDecisionCopy(action.issue)))}</span><button type="button" class="inspection-trigger" data-inspection-remove-repair="${index}">Remove</button></div>`).join('')}</section>` : ''}`;
    footer = '<button type="button" class="btn btn-primary" data-action="inspection_dialog_close">Done, view the photos</button>';
  } else {
    title = 'Inspection checkpoints';
    icon = 'inspectParts';
    body = `<p>${GUIDED_INSPECTION[component.id].instruction}</p><p class="inspection-dialog-note">${GUIDED_INSPECTION[component.id].points}</p>${renderGuidedSupplierDetails(component)}
      <p>Photos are examples. Inspect the actual laptop, including damage not shown in the photo. Use a ruler for size limits.</p>
      <details><summary>All supplier notes</summary><ul data-i18n-skip>${splitSupplierIssues(STATE.currentLaptop).map(note => `<li>${escapeHtml(note)}</li>`).join('')}</ul></details>`;
    footer = '<button type="button" class="btn btn-primary" data-action="inspection_dialog_close">Read, continue</button><button type="button" class="btn btn-secondary" data-action="inspection_restart">Restart inspection</button>';
  }
  const pauses = type === 'review' || (type === 'cleaning' && g.coverCleaning !== 'cleaned') || (type === 'touch' && !g.touchChecked);
  return `<div class="inspection-dialog-overlay"><section class="inspection-dialog" id="inspection-dialog" role="dialog" aria-modal="true" aria-labelledby="inspection-dialog-title" tabindex="-1">
    <header class="inspection-dialog-header"><span class="inspection-dialog-icon">${uiIcon(icon)}</span><h2 id="inspection-dialog-title" tabindex="-1" data-inspection-default-focus>${title}</h2><button type="button" class="inspection-dialog-dismiss" data-action="${pauses ? 'back_scan' : 'inspection_dialog_close'}" aria-label="${pauses ? 'Pause inspection' : 'Close'}" ${busy}>${uiIcon('close')}</button></header>
    <div class="inspection-dialog-body">${body}${type !== 'damage' ? renderGuidedRecordedRepairs(component) : ''}</div><footer class="inspection-dialog-footer">${footer}</footer></section></div>`;
}

function renderGuidedInspection() {
  const g = STATE.currentGrading;
  const components = getGradingOnderdelen();
  const component = components[g.huidigeIndex];
  const guide = GUIDED_INSPECTION[component.id];
  const pending = STATE.pendingDecision;
  const doubts = getGuidedUncertainParts();
  const dialogType = getGuidedDialogType();
  const blocked = Boolean(dialogType || pending);
  const images = VISUAL_ASSETS[component.id] || {};
  const captions = {
    bezel: { B: ['Marks or a small hairline crack', 'Choose the exact damage next'], C: ['Clear cracks or heavy coating damage', 'Choose the exact damage next'] },
    randen: { D: ['Broken, sharp or badly bent edge', 'Choose the exact damage next'] },
    lcd: { D: ['Cracked glass, lines or faulty screen', 'Choose the exact damage next'] },
    keyboard: { D: ['Missing keys or faulty keyboard', 'Choose the exact damage next'] },
  };
  return `
    <main class="screen inspection-screen" aria-labelledby="inspection-title">
      <header class="inspection-header">
        <h1 id="inspection-title" tabindex="-1">${component.naam}</h1>
        <span class="inspection-device" data-i18n-skip>${escapeHtml([STATE.currentLaptop.merk, STATE.currentLaptop.model].filter(Boolean).join(' '))} · ${escapeHtml(STATE.currentLaptop.sticker)}</span>
      </header>
      <div class="inspection-step-rail"><span class="inspection-count"><span>Step</span> ${g.huidigeIndex + 1} / ${components.length}</span><nav class="inspection-steps" aria-label="Inspection parts">
        ${components.map((item, index) => {
          const status = getGuidedComponentStatus(item.id);
          return `<button type="button" data-inspection-step="${index}" class="inspection-step ${status}" ${blocked ? 'disabled' : ''} ${index === g.huidigeIndex ? 'aria-current="step"' : ''} aria-label="${escapeHtml(item.naam)}: ${status === 'done' ? 'Checked' : status === 'doubt' ? 'Uncertain' : 'Not checked'}"><span class="inspection-step-icon" aria-hidden="true">${uiIcon(`part_${item.id}`)}<span class="inspection-step-marker">${status === 'done' ? uiIcon('complete') : status === 'doubt' ? uiIcon('question') : index + 1}</span></span><span>${item.naam}</span></button>`;
        }).join('')}
      </nav></div>
      <div class="inspection-guidance"><section class="inspection-look" aria-label="What to inspect"><span class="inspection-look-icon" aria-hidden="true">${uiIcon(`part_${component.id}`)}</span><p>${guide.instruction}</p></section>
      <div class="inspection-toolbar">
        <button type="button" class="btn btn-secondary ${getGuidedSupplierIssues(component.id).length ? 'has-supplier-note' : ''}" data-action="inspection_checks" ${blocked ? 'disabled' : ''} aria-label="Checkpoints" title="Checkpoints">${uiIcon(getGuidedSupplierIssues(component.id).length ? 'info' : 'inspectParts')}<span class="inspection-control-label">Checkpoints</span>${component.id === 'lcd' && g.touchChecked ? `<small>${isTouchscreenLaptop() ? 'Touch: yes' : 'Touch: no'}</small>` : ''}</button>
        ${doubts.length ? `<button type="button" class="btn btn-secondary inspection-review-status" data-action="inspection_review" ${blocked ? 'disabled' : ''}>${uiIcon('question')}<span>Uncertain parts</span><b>${doubts.length}</b></button>` : ''}
      </div></div>
      ${`
        <section class="inspection-choices ${g.keuzes[component.id] ? 'has-selection' : ''}" aria-label="Choose the observed condition">
          ${component.keuzes.map(choice => {
            const copy = captions[component.id] && captions[component.id][choice.letter];
            const title = copy ? copy[0] : choice.letter === 'D' ? 'Broken, missing or not working' : choice.titel;
            const photoFindings = (component.triggers || []).filter(t => GUIDED_PHOTO_FINDINGS[t.id] && GUIDED_PHOTO_FINDINGS[t.id].letter === choice.letter);
            const supplierAdvice = getGuidedSupplierPhotoAdvice(component.id, choice.letter);
            const importantAdvice = supplierAdvice.some(note => isGuidedSupplierImportant(component.id, note));
            return `<article class="inspection-example ${g.keuzes[component.id] === choice.letter ? 'selected' : ''}">
              <button type="button" class="inspection-choice" data-keuze="${choice.letter}" data-inspection-component="${component.id}" data-auto-advance="true" ${blocked ? 'disabled' : ''} aria-label="${displayGrade(choice.letter)} · ${escapeHtml(translateCopy(title))}" aria-describedby="inspection-points-${component.id}-${choice.letter}">
                ${images[choice.letter] ? `<span class="inspection-photo"><img src="${images[choice.letter]}" alt="${escapeHtml(title)}" width="640" height="426" decoding="async"></span>` : ''}
                <span class="inspection-choice-copy"><span class="inspection-choice-heading"><span class="inspection-choice-grade" data-grade="${displayGrade(choice.letter)}" aria-hidden="true" data-i18n-skip>${displayGrade(choice.letter)}</span><strong>${escapeHtml(title)}</strong></span>${renderGuidedChoicePoints(component.id, choice.letter)}</span>
              </button>
              <div class="inspection-photo-hints">${photoFindings.map(t => { const finding = GUIDED_PHOTO_FINDINGS[t.id]; return `<button type="button" class="inspection-photo-hint ${g.triggers[t.id] ? 'active' : ''}" data-inspection-finding="${t.id}" data-inspection-component="${component.id}" aria-pressed="${Boolean(g.triggers[t.id])}" ${blocked ? 'disabled' : ''}>${uiIcon(finding.icon)}<span>${finding.label}</span></button>`; }).join('')}</div>
              ${supplierAdvice.length ? `<button type="button" class="inspection-supplier-info ${importantAdvice ? 'important' : 'minor'}" data-inspection-supplier="${choice.letter}" data-inspection-component="${component.id}" aria-label="${importantAdvice ? 'Important supplier observation' : 'Minor supplier observation'}" title="${importantAdvice ? 'Important supplier observation' : 'Minor supplier observation'}" ${blocked ? 'disabled' : ''}>${uiIcon('info')}</button>` : ''}
              ${images[choice.letter] ? `<button type="button" class="inspection-zoom" data-image-preview="true" data-preview-src="${images[choice.letter]}" data-preview-label="${escapeHtml(title)}" aria-label="Zoom image">${uiIcon('inspectParts')}<span>Zoom</span></button>` : ''}
            </article>`;
          }).join('')}
        </section>
      `}
      <footer class="inspection-footer">
        <button type="button" class="btn btn-secondary" data-action="${pending ? 'cancel_decision' : 'prev_q'}" ${!pending && !g.huidigeIndex ? 'disabled' : ''}>Back</button>
        ${!pending ? `<button type="button" class="btn btn-secondary" data-action="inspection_doubt">I am unsure</button><button type="button" class="btn btn-primary" data-action="next_q" ${getGuidedComponentStatus(component.id) !== 'done' ? 'disabled' : ''}>${g.huidigeIndex === components.length - 1 ? 'Finish inspection' : 'Next'}</button>` : ''}
      </footer>
    </main>${pending ? STATE.imagePreview ? '' : renderGuidedDecision(pending) : renderGuidedPopup(dialogType, component)}`;
}

function renderGuidedDecision(decision) {
  const isReview = decision.type === 'grade-review';
  const g = STATE.currentGrading;
  const component = getGradingOnderdelen().find(c => c.id === decision.componentId);
  const path = ((g.inspectionObservationPaths || {})[decision.componentId] || []).map(label => translateCopy(guidedDecisionLabel(label)));
  return `<div class="inspection-dialog-overlay"><section class="inspection-dialog inspection-followup-dialog inspection-detail" id="inspection-dialog" role="dialog" aria-modal="true" aria-labelledby="inspection-dialog-title" tabindex="-1">
    <header class="inspection-dialog-header"><span class="inspection-dialog-icon">${uiIcon(component ? `part_${component.id}` : 'inspectParts')}</span><div><p class="inspection-followup-context"><span>Follow-up question</span>${component ? ` · ${escapeHtml(translateCopy(component.naam))} · <span>Step</span> ${getGradingOnderdelen().indexOf(component)+1} / 9` : ''}</p><h2 id="inspection-dialog-title" tabindex="-1" data-inspection-default-focus>${isReview ? 'Check the overall condition' : 'Which detail do you see?'}</h2></div><button type="button" class="inspection-dialog-dismiss" data-action="cancel_decision" aria-label="Back to main choices">${uiIcon('close')}</button></header>
    <div class="inspection-dialog-body">${path.length ? `<p class="inspection-followup-path">${escapeHtml(path.join(' · '))}</p>` : ''}
    <p>${isReview ? 'Look at the laptop as a whole. Are the marks minor or is the wear clearly visible?' : 'Choose the actual damage. Use the examples to compare.'}</p>
    <div class="inspection-detail-options options-${decision.options.length}">${decision.options.map((option, index) => `<article class="inspection-example"><button type="button" class="inspection-choice" data-decision-option="${index}" data-decision-title="${escapeHtml(decision.title)}">
      ${option.image ? `<span class="inspection-photo"><img src="${escapeHtml(option.image)}" alt="${escapeHtml(guidedDecisionLabel(option.label))}" width="640" height="426" decoding="async"></span>` : ''}
      <span class="inspection-choice-copy"><strong>${isReview ? option.finalGrade === 'A' ? 'Minor marks only' : 'Clearly visible wear' : escapeHtml(guidedDecisionLabel(option.label))}</strong>${!isReview ? `<span>${escapeHtml(guidedDecisionDetail(option.detail || ''))}</span>` : ''}</span></button>
      ${option.image ? `<button type="button" class="inspection-zoom" data-image-preview="true" data-preview-src="${escapeHtml(option.image)}" data-preview-label="${escapeHtml(guidedDecisionLabel(option.label))}" aria-label="Zoom image">${uiIcon('inspectParts')}<span>Zoom</span></button>` : ''}</article>`).join('')}</div></div><footer class="inspection-dialog-footer"><button type="button" class="btn btn-secondary" data-action="cancel_decision">Back to main choices</button></footer></section></div>`;
}

// Existing persisted repair descriptions remain unchanged; display copy is EN/NL.
const GUIDED_DECISION_COPY = {
  'Minimale gebruikssporen': 'Minimal use marks', 'Kleine krassen of lichte gebruikssporen': 'Small scratches or light signs of use',
  'Meerdere krassen': 'Several scratches', 'Meerdere kleinere of diepere gebruikssporen': 'Several small or deeper use marks',
  'Lichte lakschade': 'Light paint damage', 'Lichte lakschade aanwezig': 'Light paint damage is present',
  'Grote diepe krassen': 'Large, deep scratches', 'Duidelijke diepe krassen zonder zware lakschade': 'Clear deep scratches without heavy paint damage',
  'Hevige lakschade': 'Heavy paint damage', 'Veel of zware lakschade': 'Extensive or heavy paint damage',
  'Deuken + diepe krassen': 'Dents and deep scratches', 'Deuken gecombineerd met diepe krassen': 'Dents together with deep scratches',
  'Bovenkap gebroken': 'Broken lid cover', 'Barst, breuk of structurele schade': 'Crack, break or structural damage',
  'Scherpe rand': 'Sharp edge', 'Scherpe of gevaarlijke rand aanwezig': 'A sharp or dangerous edge is present',
  'Sluit niet goed': 'Does not close properly', 'Bovenkap is verbogen of sluit niet normaal': 'Lid cover is bent or does not close normally',
  'Open/verbogen herstelbaar': 'Open or bent, repairable', 'Ijzer of rand staat open, maar kan rechtgemaakt worden': 'Metal or edge is open, but can be straightened',
  'Open/te zwaar verbogen': 'Open or too badly bent', 'Zijkant staat open en is te zwaar verbogen om netjes te herstellen': 'Edge is open and too badly bent to restore neatly',
  'Zijkant gebroken': 'Broken edge', 'Hoek of zijkant is gebroken': 'Corner or edge is broken',
  'Niet herstelbaar verbogen': 'Bent beyond repair', 'Zijkant staat open of scheef en is niet netjes te herstellen': 'Edge is open or bent and cannot be restored neatly',
  'Verkleuring rand': 'Frame discoloration', 'Verkleuring van de schermrand': 'Screen frame is discolored',
  'Haarscheurtje bezelrand': 'Hairline crack in the frame', 'Klein haarscheurtje in de bezelrand': 'A small hairline crack in the screen frame',
  'Cracks / zwaar gebroken': 'Clear cracks or heavy breakage', 'Duidelijke barsten of zwaar gebroken bezelrand': 'Clear cracks or heavy breakage in the screen frame',
  'Schermrand gebroken': 'Broken screen frame', 'Bezel is zwaar gebroken of mist stukken': 'Screen frame is badly broken or has missing pieces',
  'Schermrand los': 'Loose screen frame', 'Bezel zit los of klikt niet meer vast': 'Screen frame is loose or no longer clips into place',
  'Scherpe of gevaarlijke rand rond het scherm': 'Sharp or dangerous edge around the screen',
  'Toetsafdrukken': 'Key marks', 'Alleen key imprint, geen whitespot': 'Key marks only, no white spot',
  'Lichte toetsafdruk, impact A-': 'Light key marks, up to 5 cm', 'Alleen A- als alle andere onderdelen A zijn; anders impact B': 'Key marks from 5 to 10 cm',
  'Duidelijk zichtbaar over groter vlak, impact B': 'Key marks over a larger area, more than 10 cm',
  'Lichte spot, beperkt zichtbaar': 'A light spot, barely visible', 'Combinatie': 'Both', 'Lichte toetsafdrukken met kleine whitespot': 'Light key marks and a small white spot',
  'Horizontale of verticale lijn in het beeld': 'Horizontal or vertical line in the picture', 'Scherm of glas is gebarsten': 'Screen or glass is cracked',
  'Dode pixels zichtbaar in het beeld': 'Dead pixels visible in the picture', 'Schermflikkering': 'Screen flicker', 'Beeld flikkert of valt weg': 'Picture flickers or cuts out',
  'Geen beeld': 'No picture', 'LCD geeft geen beeld': 'The screen shows no picture',
  'Onderkant gebroken': 'Broken bottom cover', 'Onderdeel ontbreekt': 'Missing part', 'Rubber, klep of behuizingsdeel ontbreekt ernstig': 'Significant missing rubber, panel or housing part',
  'Veiligheidsrisico': 'Safety issue', 'Scherpe rand of open behuizing': 'Sharp edge or open housing',
  'Toetsen ontbreken': 'Keys missing', 'Een of meerdere toetsen ontbreken': 'One or more keys are missing', 'Een toets ontbreekt': 'One key is missing', 'Meerdere toetsen ontbreken': 'Several keys missing',
  'Keyboard ontbreekt / defect': 'Keyboard missing or faulty', 'Keyboard mist volledig of werkt niet betrouwbaar': 'Keyboard is missing or does not work reliably',
  'Toets werkt niet': 'Key not working', 'Een of meerdere toetsen reageren niet': 'One or more keys do not respond', 'Keyboard defect': 'Faulty keyboard', 'Keyboard werkt niet betrouwbaar': 'Keyboard does not work reliably',
  'Keyboard ontbreekt': 'Keyboard missing', 'Keyboard mist volledig of is niet bruikbaar': 'Keyboard is missing or unusable',
  'Palmrest gebroken': 'Broken palmrest', 'Palmrest heeft een breuk of structurele schade': 'Palmrest has a break or structural damage',
  'Hoek ontbreekt': 'Missing corner', 'Grote hoek of stuk van de palmrest ontbreekt': 'A large corner or piece of the palmrest is missing', 'Scherpe rand of open behuizing rond de palmrest': 'Sharp edge or open housing around the palmrest',
  'Touchpad werkt niet': 'Touchpad not working', 'Touchpad reageert niet of niet betrouwbaar': 'Touchpad does not respond reliably',
  'Touchpad ontbreekt': 'Touchpad missing', 'Touchpad of knop ontbreekt': 'Touchpad or button is missing', 'Touchpad gebarsten': 'Cracked touchpad', 'Touchpad is gebarsten of gebroken': 'Touchpad is cracked or broken',
  'Functioneel': 'Working normally', 'Scharnier werkt nog; alleen kap- of hoekschade': 'Hinge still works; cover or corner damage only',
  'Niet functioneel': 'Not working normally', 'Scharnier zit los of werkt niet normaal': 'Hinge is loose or does not work normally',
  'Scharnier werkt niet': 'Hinge not working', 'Scharnier opent of sluit niet normaal': 'Hinge does not open or close normally',
  'Scharnier los': 'Loose hinge', 'Scharnier zit los of is deels losgekomen': 'Hinge is loose or partly detached',
  'Behuizing verbogen': 'Bent housing', 'Behuizing is verbogen bij het scharnier': 'Housing is bent near the hinge', 'Scharnier of behuizing vormt een veiligheidsrisico': 'Hinge or housing presents a safety issue',
};

function guidedDecisionCopy(text) { return GUIDED_DECISION_COPY[text] || text; }
