// =============================================================================
// REMARKT GRADING APP - BOOTSTRAP
// =============================================================================
async function initApp() {
  await loadMonitorPortDatabase();
  await loadSharedDemoState();
  await primeSharedStateStamp();
  rebuildLaptopIndex();
  rebuildMonitorIndex();
  rebuildHistoryIndexes();
  rebuildLabelPrintIndexes();
  rebuildMonitorLabelPrintIndexes();
  render();
}

// Voorkom dat een automatische (achtergrond) herlaad het scherm opnieuw
// opbouwt terwijl iemand een formulier invult. De ingevulde waarden (merk,
// model, poortcorrecties op "Monitor handmatig invoeren") staan alleen in de
// DOM en nog niet in STATE, dus een render() zou ze wissen. STATE wordt wel
// bijgewerkt; de view herbouwt vanzelf zodra de gebruiker verdergaat.
function liveRenderWouldDisruptInput() {
  if (typeof STATE !== 'undefined' && STATE && STATE.currentScreen === 'monitor_manual') return true;
  if (typeof document === 'undefined') return false;
  const el = document.activeElement;
  if (!el || el === document.body) return false;
  const tag = (el.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (el.isContentEditable) return true;
  return false;
}

function installSharedStateRefresh() {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;

  let refreshInFlight = false;
  const refresh = async () => {
    if (refreshInFlight) return;
    refreshInFlight = true;
    try {
      // Goedkope check: herlaad alleen volledig als de serverdata wijzigde.
      const applied = await syncSharedStateIfChanged();
      if (applied && !liveRenderWouldDisruptInput()) render();
    } finally {
      refreshInFlight = false;
    }
  };

  window.addEventListener('focus', refresh);
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) refresh();
    });
  }
}

function installLiveUserSync() {
  if (typeof window === 'undefined' || typeof setInterval !== 'function') return;

  const SYNC_INTERVAL_MS = 45000; // instelbaar: lager = sneller live, hoger = zuiniger

  let syncInFlight = false;
  const sync = async () => {
    // Pauzeer wanneer het tabblad niet zichtbaar is: geen database-verkeer op
    // de achtergrond. Dit bespaart de meeste commando's.
    if (typeof document !== 'undefined' && document.hidden) return;
    if (syncInFlight) return;
    syncInFlight = true;
    try {
      // Lichte meta-check; alleen een volledige herlaad als er iets veranderde.
      const changed = await syncSharedStateIfChanged();
      if (changed && !liveRenderWouldDisruptInput()) render();
    } finally {
      syncInFlight = false;
    }
  };

  setInterval(sync, SYNC_INTERVAL_MS);
}

initApp();
installSharedStateRefresh();
installLiveUserSync();
