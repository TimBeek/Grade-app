// User-initiated work only. No extra requests, polling or persisted busy flags.
const pendingUiActions = new Map();
const pendingUiElements = new WeakMap();
const UI_BUSY_DELAY = 120;

function uiActionContext() {
  return [STATE.currentUser?.id || '', STATE.currentScreen, STATE.currentLaptop?.sticker || '',
    STATE.currentMonitor?.sticker || '', STATE.currentGrading?.huidigeIndex ?? ''];
}
function uiActionKey(element, context = uiActionContext()) {
  const data = Object.entries(element?.dataset || {}).filter(([name]) => !name.startsWith('ui')).sort(([a],[b]) => a.localeCompare(b));
  return JSON.stringify([context, element?.id || '', data]);
}
function uiActionLabel(element) {
  const action = element?.dataset?.action || '';
  if (action === 'login_password') return 'Signing in...';
  if (/print|confirm_save|confirm_expert/.test(action) || element?.dataset?.stickerLabel || element?.dataset?.monitorPrintGrade || element?.dataset?.expertFinalGrade || element?.dataset?.reprintLaptop) return 'Printing and saving...';
  if (/password|create_user|update_user|delete_user|remove_|verify_batch|reopen_batch|set_touch/.test(action)) return 'Saving...';
  if (element?.dataset?.sticker || element?.id === 'scanInput') return 'Checking device...';
  return 'Loading...';
}
function markUiActionButton(record, element) {
  if (!element?.classList || !element.setAttribute || !element.matches?.('button, [role="button"]')) return;
  if (!record.elements.has(element)) record.elements.set(element, {
    busy: element.getAttribute('aria-busy'), disabled: element.getAttribute('aria-disabled'),
  });
  pendingUiElements.set(element, record);
  element.classList.add('is-ui-busy');
  element.setAttribute('aria-busy', 'true');
  element.setAttribute('aria-disabled', 'true');
  // Keep the caption, focus and native disabled state intact. Clicks are
  // coalesced by action identity rather than by disabling unrelated controls.
}
function refreshUiActionFeedback() {
  const visible = [...pendingUiActions.values()].filter(record => record.visible);
  for (const record of visible) {
    markUiActionButton(record, record.element);
    document.querySelectorAll('button, [role="button"]').forEach(element => {
      if (uiActionKey(element) === record.key) markUiActionButton(record, element);
    });
  }
  let status = document.getElementById('ui-action-status');
  if (!visible.length) { status?.remove(); return; }
  if (!status && document.createElement && document.body?.appendChild) {
    status = document.createElement('div');
    status.id = 'ui-action-status';status.className = 'ui-action-status';
    status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    status.setAttribute('aria-atomic','true');
    document.body.appendChild(status);
  }
  if (status) {
    const label = translateCopy(visible[visible.length - 1].label);
    if (status.dataset.label !== label) {
      status.dataset.label = label;
      status.innerHTML = `<span class="ui-action-spinner" aria-hidden="true"></span><span>${escapeHtml(label)}</span>`;
    }
  }
}
function runUiAction(element, work, options = {}) {
  // A handler can change STATE.currentScreen before awaiting data, while its
  // old button is still displayed. Match that exact element before its context.
  if (element && pendingUiElements.has(element)) return pendingUiElements.get(element).promise || false;
  const key = options.key || uiActionKey(element);
  if (pendingUiActions.has(key)) return pendingUiActions.get(key).promise || false;
  if (element?.disabled) return false;
  const record = {key, element, label: options.label || uiActionLabel(element), elements:new Map(), visible:false};
  pendingUiActions.set(key, record);
  if (element) pendingUiElements.set(element,record);
  const finish = () => {
    clearTimeout(record.timer);
    pendingUiActions.delete(key);
    if (element) pendingUiElements.delete(element);
    for (const [button, original] of record.elements) {
      pendingUiElements.delete(button);
      button.classList.remove('is-ui-busy');
      for (const [name,value] of [['aria-busy',original.busy],['aria-disabled',original.disabled]]) {
        if (value === null) button.removeAttribute(name); else button.setAttribute(name,value);
      }
    }
    refreshUiActionFeedback();
  };
  try {
    // Invoke immediately: fullscreen, file picker and printing retain their
    // user gesture. Fast local actions never paint a flashing loader.
    const result = work();
    if (!result || typeof result.then !== 'function') { finish();return result; }
    record.timer = setTimeout(() => { record.visible=true;refreshUiActionFeedback(); }, UI_BUSY_DELAY);
    record.promise = Promise.resolve(result).finally(finish);
    return record.promise;
  } catch (error) { finish();throw error; }
}
