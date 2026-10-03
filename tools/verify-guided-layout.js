// Read-only local browser QA. Run through agent-browser eval --stdin.
// Synthetic testOnly devices only; no DB, operational data or printer access.
(async () => {
  if (!['localhost', '127.0.0.1'].includes(location.hostname)) throw Error('Local preview only');
  const checks = [];
  const check = (name, ok) => {checks.push({name,passed:!!ok}); if (!ok) throw Error(name);};
  const fresh = () => {
    STATE.currentUser = {id:'layout-qa',naam:'QA',rol:'Manager',voorkeur:'beginner'};
    STATE.language='nl'; STATE.supplierNotice=null;
    startTestGrading('beginner'); setCoverCleaning(true);
    STATE.currentGrading.touchChecked=true;
    check('Synthetic device', STATE.currentGrading.testOnly);
  };
  const desktop = innerWidth >= 1100 && innerHeight >= 768;
  for (let i=0;i<9;i++) {
    fresh(); visitGuidedComponent(i); window.scrollTo(0,0);
    const part=getGradingOnderdelen()[i].id;
    const footer=document.querySelector('.inspection-footer').getBoundingClientRect();
    const cards=[...document.querySelectorAll('.inspection-example')].map(e=>e.getBoundingClientRect());
    check(`${part}: no horizontal overflow`, document.documentElement.scrollWidth<=innerWidth);
    check(`${part}: counter belongs to step rail`, !!document.querySelector('.inspection-step-rail .inspection-count'));
    if (desktop) check(`${part}: all photos and actions fit`,cards.every(r=>r.top>=0&&r.bottom<=footer.top+1)&&footer.bottom<=innerHeight+1);
  }
  fresh(); STATE.currentLaptop.meldingen='Behuizingschade groot'; render();
  const info=document.querySelector('[data-inspection-supplier="C"]');
  check('Supplier red info at matching example',!!info);
  info.click();
  check('Info popup shows original text',document.querySelector('#inspection-dialog').textContent.includes('Behuizingschade groot'));
  check('Supplier advice never selects an answer',!STATE.currentGrading.keuzes.bovenkap);
  document.querySelector('[data-action="inspection_dialog_close"]').click();
  check('Info popup can close',!getGuidedDialogType());
  await selectGuidedPhotoFinding('barst_boven','bovenkap');
  check('One selected photo',document.querySelectorAll('.inspection-example.selected').length===1);
  const other=document.querySelector('.inspection-example:not(.selected) .inspection-photo');
  check('Other photographs have gray overlay',getComputedStyle(other,'::after').content!=='none');
  check('Selected photograph keeps true lighting',getComputedStyle(document.querySelector('.inspection-example.selected img')).filter==='none');
  fresh();
  for (const c of getGradingOnderdelen()) applyComponentChoice(c.id,'A',true);
  check('A assessment reaches redesigned result',document.querySelector('.result-screen')&&STATE.currentGrading.result.eindgrade==='A');
  check('Result has explanation and recorded condition',document.querySelector('.result-explanation')&&document.querySelector('.result-condition'));
  check('All clear parts remain visible in one table',document.querySelectorAll('.result-condition-table .result-observation').length===9);
  check('Result has no horizontal overflow',document.documentElement.scrollWidth<=innerWidth);
  await handleAction('adjust',{});
  check('Adjust keeps all answers',STATE.currentScreen==='grading_beginner'&&Object.keys(STATE.currentGrading.keuzes).length===9);
  visitGuidedComponent(4); await selectGuidedPhotoFinding('haarscheur_bezel','bezel'); finishGrading(); render();
  check('B result explains actual hairline damage',STATE.currentGrading.result.eindgrade==='B'&&document.querySelector('.result-condition-table').textContent.includes('Haarscheur'));
  fresh(); STATE.currentLaptop.meldingen='Used case'; updateSupplierNoticeForCurrentStep(); render();
  check('Minor supplier note does not interrupt',!getGuidedDialogType());
  const minor=document.querySelector('[data-inspection-supplier="B"].minor');
  check('Minor advice has orange icon and meaningful label',minor&&minor.getAttribute('aria-label').includes('Lichte'));
  minor.click();
  check('Minor info shows actual supplier text',document.querySelector('#inspection-dialog').textContent.includes('Used case'));
  closeGuidedDialog();
  check('Minor advice has not selected a condition',!STATE.currentGrading.keuzes.bovenkap);
  fresh(); STATE.currentLaptop.meldingen='Behuizingschade groot'; updateSupplierNoticeForCurrentStep(); render();
  check('Major supplier note opens mandatory popup',getGuidedDialogType()==='checks'&&document.querySelector('#inspection-dialog').textContent.includes('Behuizingschade groot'));
  check('Major supplier note retains red info icon',!!document.querySelector('[data-inspection-supplier="C"].important'));
  closeGuidedDialog(); applyComponentChoice('bovenkap','B',false);
  check('Follow-up is a separate accessible dialog',getGuidedDialogType()==='followup'&&document.querySelector('.inspection-followup-dialog[aria-modal="true"]'));
  check('Follow-up shows part and step',document.querySelector('.inspection-followup-context').textContent.includes('Bovenkap')&&document.querySelector('.inspection-followup-context').textContent.includes('1 / 9'));
  check('Follow-up locks background, not its own buttons',document.querySelector('.inspection-screen').inert&&!document.querySelector('.inspection-followup-dialog').inert);
  check('Follow-up is not horizontally clipped',document.documentElement.scrollWidth<=innerWidth);
  const zoom=document.querySelector('.inspection-followup-dialog .inspection-zoom');
  openImagePreviewFromElement(zoom);
  check('Zoom from detail remains separate from answering',STATE.imagePreview&&STATE.pendingDecision&&!STATE.currentGrading.inspectionChecks.bovenkap);
  STATE.imagePreview=null;render();
  check('Closing zoom restores follow-up dialog',getGuidedDialogType()==='followup'&&!!document.querySelector('.inspection-followup-dialog'));
  closeGuidedDialog();
  check('Cancel returns to same part with no incomplete answer',!STATE.pendingDecision&&!STATE.currentGrading.keuzes.bovenkap&&STATE.currentGrading.huidigeIndex===0);
  return {passed:checks.length, viewport:[innerWidth,innerHeight],checks};
})()
