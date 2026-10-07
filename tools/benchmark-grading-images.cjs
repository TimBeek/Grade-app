// Offline benchmark only: no accounts, API calls, database or printer access.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {performance} = require('node:perf_hooks');
const {loadAppSandbox} = require('../tests/app-sandbox.cjs');
const app = loadAppSandbox();
const root = path.join(__dirname, '..');
vm.runInContext('STATE.currentGrading={inspectionObservationPaths:{}}', app);
const decisions = vm.runInContext(`Object.entries(CHOICE_DECISIONS).flatMap(([componentId, grades]) => {
  const visit = d => [{...d, componentId}, ...d.options.flatMap(o => o.nextDecision ? visit(o.nextDecision) : [])];
  return Object.values(grades).flatMap(visit);
})`, app);
let maxImageBytes = 0, maxImages = 0, maxMarkupBytes = 0;
const timings = [];
for (let round = 0; round < 100; round++) {
  for (const decision of decisions) {
    const start = performance.now();
    const html = app.renderGuidedDecision(decision);
    timings.push(performance.now() - start);
    maxMarkupBytes = Math.max(maxMarkupBytes, Buffer.byteLength(html));
    if (round === 0) {
      const sources = [...html.matchAll(/<img[^>]*src="([^"]+)"/g)].map(match => match[1]);
      maxImages = Math.max(maxImages, sources.length);
      maxImageBytes = Math.max(maxImageBytes, sources.reduce((bytes, src) => bytes + fs.statSync(path.join(root, src)).size, 0));
    }
  }
}
timings.sort((a,b) => a-b);
console.log(JSON.stringify({
  scope:'Offline HTML construction; not real-device network/LCP measurement',
  decisions:decisions.length, renders:timings.length,
  medianMs:Number(timings[Math.floor(timings.length/2)].toFixed(3)),
  p95Ms:Number(timings[Math.floor(timings.length*.95)].toFixed(3)),
  maxImages, maxImageBytes, maxMarkupBytes,
  mappingScriptBytes:fs.statSync(path.join(root,'assets/grading-example-images.js')).size,
}, null, 2));
