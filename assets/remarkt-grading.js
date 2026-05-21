// =============================================================================
// REMARKT GRADING APP - BOOTSTRAP
// =============================================================================
async function initApp() {
  await loadMonitorPortDatabase();
  await loadSharedDemoState();
  rebuildLaptopIndex();
  rebuildMonitorIndex();
  rebuildHistoryIndexes();
  rebuildLabelPrintIndexes();
  rebuildMonitorLabelPrintIndexes();
  render();
}

initApp();

