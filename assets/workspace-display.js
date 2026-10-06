// Display-only controls: no saves, refreshes or replacement of form contents.
let workspaceDisplayInstalled = false;

function appIsFullscreen() {
  return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
}

function renderFullscreenToggle() {
  const active = appIsFullscreen();
  const label = active ? 'Exit fullscreen' : 'Fullscreen';
  return `<button class="btn-icon fullscreen-toggle" data-action="toggle_fullscreen" type="button" aria-pressed="${active}" aria-label="${escapeHtml(translateCopy(label))}" title="${escapeHtml(translateCopy(label))}">${uiIcon(active ? 'fullscreen_exit' : 'fullscreen')}</button>`;
}

function updateFullscreenControls() {
  if (typeof document.querySelectorAll !== 'function') return;
  document.querySelectorAll('[data-action="toggle_fullscreen"]').forEach(button => {
    const active = appIsFullscreen(), label = translateCopy(active ? 'Exit fullscreen' : 'Fullscreen');
    button.setAttribute('aria-pressed', String(active));
    button.setAttribute('aria-label', label);
    button.title = label;
    button.innerHTML = uiIcon(active ? 'fullscreen_exit' : 'fullscreen');
  });
}

async function toggleAppFullscreen() {
  try {
    if (appIsFullscreen()) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (!exit) throw new Error('Fullscreen unavailable');
      await exit.call(document);
    } else {
      // The root survives app.innerHTML updates between all nine steps/screens.
      const root = document.documentElement;
      const enter = root && (root.requestFullscreen || root.webkitRequestFullscreen);
      if (!enter) throw new Error('Fullscreen unavailable');
      await enter.call(root);
    }
    updateFullscreenControls();
    fitInspectionViewport();
  } catch {
    // Do not render() here: it would erase unsaved manual-entry form fields.
    if (typeof window.alert === 'function') window.alert(translateCopy('Fullscreen could not start. Use F11 in Chrome or Edge. Your input is unchanged.'));
  }
}

function chooseInspectionColumns(scores) {
  // Prefer the familiar 2x2 arrangement unless one row gives materially larger
  // complete photos. Scores measure the visible 3:2 image, not white letterbox.
  return scores[4] > scores[2] * 1.08 ? 4 : 2;
}

function fitInspectionViewport() {
  if (typeof document.querySelector !== 'function') return;
  const screen = document.querySelector('.inspection-screen');
  if (!screen) return;
  const viewport = window.visualViewport;
  const height = viewport ? viewport.height : window.innerHeight;
  const width = viewport ? viewport.width : window.innerWidth;
  screen.classList.remove('inspection-fit');
  screen.style.removeProperty('--inspection-work-height');
  const choices = screen.querySelector('.inspection-choices');
  if (!choices) return;
  delete choices.dataset.columns;
  screen.style.removeProperty('--inspection-copy-height');
  screen.style.removeProperty('--inspection-findings-height');
  // Preserve readable reflow at extreme zoom/phone sizes rather than silently
  // clipping content. Workstation/tablet grading fits without page scrolling.
  const available = height - (screen.getBoundingClientRect().top + window.scrollY) - 4;
  if (width < 700 || height < 600 || available < 430) return;
  screen.style.setProperty('--inspection-work-height', `${Math.floor(available)}px`);
  screen.classList.add('inspection-fit');
  const scores = {};
  for (const columns of [2, 4]) {
    choices.dataset.columns = String(columns);
    screen.style.removeProperty('--inspection-copy-height');
    screen.style.removeProperty('--inspection-findings-height');
    const copyHeight = Math.max(...Array.from(choices.querySelectorAll('.inspection-choice-copy')).map(e => e.getBoundingClientRect().height));
    const findingsHeight = Math.max(...Array.from(choices.querySelectorAll('.inspection-photo-hints')).map(e => e.getBoundingClientRect().height));
    screen.style.setProperty('--inspection-copy-height', `${Math.ceil(copyHeight)}px`);
    screen.style.setProperty('--inspection-findings-height', `${Math.ceil(findingsHeight)}px`);
    scores[columns] = Math.min(...Array.from(choices.querySelectorAll('.inspection-photo')).map(photo => {
      const box = photo.getBoundingClientRect();
      return Math.min(box.height, box.width / 1.5);
    }));
  }
  choices.dataset.columns = String(chooseInspectionColumns(scores));
  // Recompute row alignment for the winning layout (the last candidate was 4).
  screen.style.removeProperty('--inspection-copy-height');
  screen.style.removeProperty('--inspection-findings-height');
  screen.style.setProperty('--inspection-copy-height', `${Math.ceil(Math.max(...Array.from(choices.querySelectorAll('.inspection-choice-copy')).map(e => e.getBoundingClientRect().height)))}px`);
  screen.style.setProperty('--inspection-findings-height', `${Math.ceil(Math.max(...Array.from(choices.querySelectorAll('.inspection-photo-hints')).map(e => e.getBoundingClientRect().height)))}px`);
  // Never hide long text, damage controls or the footer to claim a false fit.
  if (screen.scrollHeight > screen.clientHeight + 2 || Array.from(choices.querySelectorAll('.inspection-example')).some(card => card.scrollHeight > card.clientHeight + 2)) {
    screen.classList.remove('inspection-fit');
    screen.style.removeProperty('--inspection-work-height');
    delete choices.dataset.columns;
  } else if (window.scrollY) {
    window.scrollTo(0, 0);
  }
}

function installWorkspaceDisplay() {
  if (workspaceDisplayInstalled || typeof window.addEventListener !== 'function') return;
  workspaceDisplayInstalled = true;
  const update = () => { updateFullscreenControls(); fitInspectionViewport(); };
  window.addEventListener('resize', update);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', update);
  if (typeof document.addEventListener === 'function') {
    document.addEventListener('fullscreenchange', update);
    document.addEventListener('webkitfullscreenchange', update);
  }
}
