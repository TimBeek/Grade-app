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

function installSharedStateRefresh() {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;

  let refreshInFlight = false;
  const refresh = async () => {
    if (refreshInFlight) return;
    refreshInFlight = true;
    try {
      // Goedkope check: herlaad alleen volledig als de serverdata wijzigde.
      const applied = await syncSharedStateIfChanged();
      if (applied) render();
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
      if (changed) render();
    } finally {
      syncInFlight = false;
    }
  };

  setInterval(sync, SYNC_INTERVAL_MS);
}

initApp();
installSharedStateRefresh();
installLiveUserSync();
