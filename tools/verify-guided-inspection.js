// Browser-eval test for tools/guided-inspection-preview.mjs only.
// Uses synthetic testOnly devices: no operational data, printing or saves.
(async () => {
  if (!['127.0.0.1', 'localhost'].includes(location.hostname)) throw new Error('Local preview only');
  const assertions = [];
  const check = (name, condition) => {
    assertions.push({ name, passed: Boolean(condition) });
    if (!condition) throw new Error(name);
  };
  const fresh = (entryUnchecked = false) => {
    STATE.currentUser = { id: 'qa-preview', naam: 'QA', rol: 'Manager', voorkeur: 'beginner' };
    STATE.language = 'nl';
    STATE.supplierNotice = null;
    startTestGrading('beginner');
    render();
    if (!STATE.currentGrading.testOnly) throw new Error('Must be a test device');
    if (!entryUnchecked) click('[data-action="inspection_cleaned"]');
  };
  const click = selector => {
    const button = document.querySelector(selector);
    if (!button || button.disabled) throw new Error(`Unavailable control: ${selector}`);
    button.click();
    return button;
  };
  fresh(true);
  check('Cleaning dialog opens at entry', getGuidedDialogType() === 'cleaning' && document.querySelector('[role="dialog"]'));
  check('Modal focuses heading and locks background', document.activeElement.id === 'inspection-dialog-title' && document.querySelector('.inspection-screen').inert);
  document.body.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true}));
  check('Escape cannot bypass cleaning', getGuidedDialogType() === 'cleaning');
  click('[data-action="inspection_cleaned"]');
  check('Closing modal restores background', !document.querySelector('.inspection-screen').inert && document.body.style.overflow !== 'hidden');
  fresh();
  const staleChoice = click('.inspection-choice[data-keuze="A"]');
  staleChoice.click();
  check('Old double-click cannot assess next part', STATE.currentGrading.huidigeIndex === 1 && !STATE.currentGrading.keuzes.onderkant);
  fresh();
  click('[data-action="inspection_checks"]');
  click('[data-action="inspection_clean"]');
  check('Dirty lid blocks condition selection', [...document.querySelectorAll('.inspection-choice')].every(button => button.disabled));
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
  check('Keyboard cannot bypass cleaning', !STATE.currentGrading.keuzes.bovenkap);
  click('[data-action="inspection_cleaned"]');
  check('Cleaning does not automatically award A', !STATE.currentGrading.keuzes.bovenkap);
  fresh();
  click('[data-action="inspection_doubt"]');
  check('Uncertainty retains work and continues', STATE.currentGrading.inspectionDoubts.bovenkap && STATE.currentGrading.huidigeIndex === 1);
  click('[data-inspection-step="0"]');
  click('.inspection-choice[data-keuze="A"]');
  check('Explicit observation resolves uncertainty', !STATE.currentGrading.inspectionDoubts.bovenkap);
  fresh();
  const stepResults = [];
  for (let index = 0; index < getGradingOnderdelen().length; index++) {
    const component = getGradingOnderdelen()[index];
    if (component.id === 'lcd') {
      check('LCD asks touch in popup', getGuidedDialogType() === 'touch');
      check('Touch popup shows supplier information', document.querySelector('.inspection-supplier-details'));
      click('[data-inspection-touch="no"]');
    }
    check(`Part ${component.id} has instruction and choices`, Boolean(document.querySelector('.inspection-look')) && document.querySelectorAll('.inspection-choice[data-keuze]').length === 4);
    check(`Part ${component.id} has no horizontal overflow`, document.documentElement.scrollWidth <= window.innerWidth);
    await Promise.all([...document.querySelectorAll('.inspection-photo img')].map(img => img.decode().catch(() => null)));
    check(`Part ${component.id} photos load`, [...document.querySelectorAll('.inspection-photo img')].every(img => img.naturalWidth > 0));
    check(`Part ${component.id} uses local hints, no damage bar`, document.querySelector('.inspection-photo-hint') && !document.querySelector('.inspection-findings'));
    const photo = document.querySelector('.inspection-photo').getBoundingClientRect();
    check(`Part ${component.id} photo is large`, photo.width > 285 && photo.height > 185);
    stepResults.push(component.id);
    click('.inspection-choice[data-keuze="A"]');
  }
  check('Nine checks reach A result without printing', STATE.currentScreen === 'result' && STATE.currentGrading.result.eindgrade === 'A' && STATE.currentGrading.testOnly);
  fresh();
  click('[data-inspection-step="5"]');
  click('[data-inspection-touch="no"]');
  click('.inspection-choice[data-keuze="B"]');
  const priorTitle = STATE.pendingDecision.title;
  const oldDetail = click('[data-decision-option="0"]');
  check('Nested detail stays unacknowledged', STATE.pendingDecision && STATE.pendingDecision.title !== priorTitle && !STATE.currentGrading.inspectionChecks.lcd);
  oldDetail.click();
  check('Old detail double-click does not answer nested question', STATE.pendingDecision && !STATE.currentGrading.inspectionChecks.lcd);
  fresh();
  click('[data-inspection-step="4"]');
  click('[data-inspection-finding="haarscheur_bezel"]');
  check('Hairline hint selects the existing photo detail', STATE.currentGrading.keuzes.bezel === 'B' && STATE.currentGrading.impactOverrides.bezel === 'b-minus');
  check('Hairline remains beside its photo', document.querySelector('[data-inspection-finding="haarscheur_bezel"]').getAttribute('aria-pressed') === 'true');
  fresh();
  click('[data-action="inspection_doubt"]');
  for (let i = 1; i < 9; i++) {
    if (getGuidedDialogType() === 'touch') click('[data-inspection-touch="uncertain"]');
    click('.inspection-choice[data-keuze="A"]');
  }
  check('Doubt ends in prominent manager dialog', getGuidedDialogType() === 'review' && document.querySelector('#inspection-dialog-title').textContent.includes('manager'));
  check('Doubt preserves other answers and blocks result', getGuidedUncertainParts().length === 2 && !STATE.currentGrading.result && STATE.currentGrading.inspectionChecks.scharnieren);
  click('[data-inspection-review-part="5"]');
  check('Recheck uncertain touch returns to its popup', getGuidedDialogType() === 'touch');
  click('[data-inspection-touch="no"]');
  check('Confirming uncertain touch requires new screen assessment', !STATE.currentGrading.inspectionChecks.lcd);
  fresh(); STATE.currentLaptop.display='14 touch'; visitGuidedComponent(5);
  check('Supplier touch is preselected on switch',document.querySelector('[role="switch"]').getAttribute('aria-checked')==='true');
  check('Preselection does not acknowledge physical check',!STATE.currentGrading.touchChecked);
  click('[data-inspection-touch-toggle]');
  check('Switch changes draft, not supplier information',getGuidedTouchSelection()==='no'&&STATE.currentLaptop.display==='14 touch'&&!STATE.currentGrading.touchChecked);
  check('Switch retains keyboard focus',document.activeElement.hasAttribute('data-inspection-touch-toggle'));
  click('[data-inspection-touch="no"]');
  check('Separate confirmation saves checked selection',STATE.currentGrading.touchChecked&&STATE.currentGrading.touchDecision==='no'&&isTouchscreenLaptop()===false);
  fresh(); STATE.currentLaptop.model='Surface Laptop 5'; STATE.currentLaptop.display='15 non-touch';visitGuidedComponent(5);
  check('Surface standard preselects touch',getGuidedTouchSelection()==='yes');
  check('Surface disagreement preserves original supplier data',getGuidedSupplierTouch()==='no'&&document.querySelector('#inspection-dialog').textContent.includes('Modelstandaard'));
  fresh(); STATE.currentLaptop.display='14 non-touch'; visitGuidedComponent(5);
  check('Supplier non-touch is preselected off',document.querySelector('[role="switch"]').getAttribute('aria-checked')==='false');
  fresh(); STATE.currentLaptop.meldingen='Used touchpad'; STATE.currentGrading.touchChecked=true;
  for(let i=0;i<9;i++) {
    visitGuidedComponent(i);
    const part=getGradingOnderdelen()[i].id;
    check(`Touchpad supplier info stays local: ${part}`,document.querySelectorAll('[data-inspection-supplier]').length===(part==='touchpad'?1:0));
  }
  fresh();
  return { passed: assertions.length, steps: stepResults, assertions };
})()
