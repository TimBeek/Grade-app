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

function getInspectionRowPhotoHeights(cards) {
  // Align photos within each pair, using the largest REAL caption + controls
  // in that row. Do not add unrelated maxima or reserve buttons in empty cards.
  return cards.map((card, index) => {
    const row = cards.slice(index - index % 2, index - index % 2 + 2);
    return Math.max(0, Math.floor(Math.min(...row.map(item => item.height - item.copy - item.findings))));
  });
}

function fitInspectionViewport() {
  if (typeof document.querySelector !== 'function') return;
  const screen = document.querySelector('.inspection-screen');
  if (!screen) return;
  const viewport = window.visualViewport;
  const height = viewport ? viewport.height : window.innerHeight;
  const width = viewport ? viewport.width : window.innerWidth;
  const choices = screen.querySelector('.inspection-choices');
  if (!choices) return;
  const cards = Array.from(choices.querySelectorAll('.inspection-example'));
  const resetFit = () => {
    screen.classList.remove('inspection-fit');
    screen.style.removeProperty('--inspection-work-height');
    delete choices.dataset.columns;
    cards.forEach(card => card.style.removeProperty('--inspection-photo-height'));
  };
  resetFit();
  // Preserve readable reflow at extreme zoom/phone sizes rather than silently
  // clipping content. Workstation/tablet grading fits without page scrolling.
  const available = height - (screen.getBoundingClientRect().top + window.scrollY) - 4;
  if (width < 700 || height < 600 || available < 430 || cards.length !== 4) return;
  screen.style.setProperty('--inspection-work-height', `${Math.floor(available)}px`);
  screen.classList.add('inspection-fit');
  choices.dataset.columns = '2';
  const photoHeights = getInspectionRowPhotoHeights(cards.map(card => ({
    height: card.clientHeight,
    copy: card.querySelector('.inspection-choice-copy').getBoundingClientRect().height,
    findings: card.querySelector('.inspection-photo-hints').getBoundingClientRect().height,
  })));
  cards.forEach((card, index) => card.style.setProperty('--inspection-photo-height', `${photoHeights[index]}px`));
  // Never hide long text, damage controls or the footer to claim a false fit.
  if (photoHeights.some(height => height <= 0) || screen.scrollHeight > screen.clientHeight + 2 || cards.some(card => card.scrollHeight > card.clientHeight + 2)) {
    resetFit();
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
