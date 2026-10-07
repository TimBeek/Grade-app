const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const {loadAppSandbox} = require('./app-sandbox.cjs');
const root = path.join(__dirname, '..');

function decisions(app) {
  return vm.runInContext(`Object.entries(CHOICE_DECISIONS).flatMap(([componentId, grades]) => {
    const visit = decision => [{...decision, componentId}, ...decision.options.flatMap(o => o.nextDecision ? visit(o.nextDecision) : [])];
    return Object.values(grades).flatMap(visit);
  })`, app);
}

test('all 61 detailed choices resolve a real photo without changing grading rules', () => {
  const app = loadAppSandbox();
  const before = vm.runInContext('JSON.stringify(CHOICE_DECISIONS)', app);
  let count = 0;
  for (const decision of decisions(app)) {
    const illustrated = app.withGradingExampleImages(decision);
    illustrated.options.forEach((option, i) => {
      count++;
      assert.ok(option.image, `${decision.componentId}: ${option.label}`);
      assert.ok(fs.existsSync(path.join(root, option.image)), option.image);
      assert.equal(option.impact, decision.options[i].impact);
      assert.equal(option.repairIssue, decision.options[i].repairIssue);
      assert.equal(option.nextDecision, decision.options[i].nextDecision);
      if (decision.options[i].image) {
        const revisions = vm.runInContext('GRADING_REASON_IMAGE_REVISIONS', app);
        assert.equal(option.image, revisions.get(decision.options[i].image) || decision.options[i].image);
      }
    });
  }
  assert.equal(count, 61);
  assert.equal(vm.runInContext('JSON.stringify(CHOICE_DECISIONS)', app), before);
});

test('32 newly generated examples are distinct, lightweight 1200 x 800 JPEGs', () => {
  const app = loadAppSandbox();
  const rows = vm.runInContext('GRADING_REASON_EXAMPLES', app);
  assert.equal(rows.length, 32);
  const hashes = new Set();
  const crypto = require('node:crypto');
  let total = 0;
  for (const [component, label] of rows) {
    const {options:[option]} = app.withGradingExampleImages({componentId:component, options:[{label}]});
    const bytes = fs.readFileSync(path.join(root, option.image));
    total += bytes.length;
    assert.ok(bytes.length < 250000, `${option.image}: ${bytes.length}`);
    assert.equal(bytes.readUInt16BE(0), 0xffd8);
    // JPEG SOF0/1/2: height and width follow precision byte.
    let offset=2, dimensions;
    while (offset < bytes.length) {
      assert.equal(bytes[offset], 0xff);
      const marker=bytes[offset+1];
      if ([0xc0,0xc1,0xc2].includes(marker)) { dimensions=[bytes.readUInt16BE(offset+7),bytes.readUInt16BE(offset+5)]; break; }
      offset+=2+bytes.readUInt16BE(offset+2);
    }
    assert.deepEqual(dimensions, [1200,800], option.image);
    hashes.add(crypto.createHash('sha256').update(bytes).digest('hex'));
  }
  assert.equal(hashes.size, 32, 'Never reuse another defect photo for a missing example');
  assert.ok(total < 5_000_000, `New photos total ${total} bytes`);
});

test('guided and classic follow-ups render each photo and its correct zoom source', () => {
  const app = loadAppSandbox();
  vm.runInContext('STATE.currentGrading={inspectionObservationPaths:{}}', app);
  for (const decision of decisions(app)) {
    const options = app.withGradingExampleImages(decision).options;
    for (const render of [app.renderGuidedDecision,app.renderDecisionModal]) {
      const html = render(decision);
      for (const option of options) {
        assert.ok(html.includes(`src="${option.image}"`), `${decision.title}: ${option.label}`);
        assert.ok(html.includes(`data-preview-src="${option.image}"`));
      }
      assert.equal((html.match(/data-decision-option=/g)||[]).length, decision.options.length);
    }
  }
});

test('functional examples have an honest test reminder, not a visual diagnosis', () => {
  const app = loadAppSandbox();
  vm.runInContext('STATE.currentGrading={inspectionObservationPaths:{}}', app);
  const options=app.withGradingExampleImages({componentId:'touchpad',options:[{label:'Touchpad werkt niet'}]}).options;
  assert.equal(options[0].exampleFunctionalTest,true);
  assert.match(app.renderGuidedDecision({componentId:'touchpad',options,title:'Test'}), /test the function on the real laptop/);
  vm.runInContext("STATE.language='nl'", app);
  assert.equal(app.translateCopy('Example only: test the function on the real laptop.'), 'Dit is een voorbeeld: test de werking op de echte laptop.');
  const review={type:'grade-review',options:[{label:'Geen beeld'}]};
  assert.equal(app.withGradingExampleImages(review),review);
});

test('the prompt ledger follows the selected image revisions in the app', () => {
  const app = loadAppSandbox();
  const ledger = JSON.parse(fs.readFileSync(path.join(root, 'docs/grading-example-images.json'), 'utf8'));
  assert.equal(ledger.assets.length, 32);
  for (const entry of ledger.assets) {
    const decision = app.withGradingExampleImages({componentId:entry.component,options:[{label:entry.choice}]});
    const revisions = vm.runInContext('GRADING_REASON_IMAGE_REVISIONS', app);
    assert.equal(decision.options[0].image, revisions.get(entry.image) || entry.image, entry.choice);
    assert.ok(entry.prompt && fs.existsSync(path.join(root, entry.reference)));
    if (entry.previousImage) assert.ok(fs.existsSync(path.join(root, entry.previousImage)));
  }
});

test('all follow-up choices have a reviewed image and close-up revisions stay UI-only', () => {
  const app = loadAppSandbox();
  const ledger = JSON.parse(fs.readFileSync(path.join(root, 'docs/grading-detail-image-review.json'), 'utf8'));
  const revisions = vm.runInContext('GRADING_REASON_IMAGE_REVISIONS', app);
  assert.equal(ledger.review.length, 61);
  assert.equal(ledger.assets.length, 20);
  const latest = JSON.parse(fs.readFileSync(path.join(root, 'docs/grading-x-image-revisions.json'), 'utf8'));
  const superseded = new Map(latest.assets.map(entry => [entry.previousImage, entry.image]));
  assert.equal(revisions.size, 26);
  for (const entry of ledger.assets) {
    assert.ok(entry.prompt.includes('close-up') && fs.existsSync(path.join(root, entry.reference)));
    assert.ok(fs.existsSync(path.join(root, entry.image)), entry.image);
    assert.ok(fs.statSync(path.join(root, entry.image)).size < 250000);
    for (const source of entry.previousImages) {
      assert.equal(revisions.get(source), superseded.get(entry.image) || entry.image);
      assert.ok(fs.existsSync(path.join(root, source)), 'Retain original photo: ' + source);
    }
  }
  for (const row of ledger.review) {
    assert.equal(superseded.get(row.selectedImage) || row.selectedImage, revisions.get(row.image) || row.image);
  }
  const unrelated = {componentId:'bezel',options:[{label:'Unrelated',image:'unchanged.jpg',impact:'b-minus'}]};
  assert.equal(app.withGradingExampleImages(unrelated).options[0], unrelated.options[0]);
  const review = {type:'grade-review',options:[{image:ledger.assets[0].previousImages[0]}]};
  assert.equal(app.withGradingExampleImages(review), review);
});

test('ten severity corrections use new photos but preserve B-after-repair, C and X rules', () => {
  const app = loadAppSandbox();
  const ledger = JSON.parse(fs.readFileSync(path.join(root, 'docs/grading-x-image-revisions.json'), 'utf8'));
  assert.equal(ledger.assets.length, 10);
  assert.equal(ledger.assets.filter(entry => entry.expectedImpact === 'x').length, 8);
  for (const entry of ledger.assets) {
    const decision = decisions(app).find(row => row.componentId === entry.component && row.options.some(option => option.label === entry.choice));
    assert.ok(decision, entry.choice);
    const original = decision.options.find(option => option.label === entry.choice);
    const selected = app.withGradingExampleImages(decision).options.find(option => option.label === entry.choice);
    assert.equal(selected.image, entry.image);
    assert.equal(selected.impact, entry.expectedImpact);
    assert.equal(selected.repairRoute, original.repairRoute);
    assert.equal(selected.afterRepairImpact, original.afterRepairImpact);
    assert.ok(fs.existsSync(path.join(root, entry.previousImage)), 'Retain previous version');
    assert.ok(fs.statSync(path.join(root, entry.image)).size < 250000);
    assert.ok(entry.prompt && fs.existsSync(path.join(root, entry.reference)));
  }
});

test('photo loading stays bounded to the active question with compact markup and cacheable files', () => {
  const app = loadAppSandbox();
  vm.runInContext('STATE.currentGrading={inspectionObservationPaths:{}}', app);
  for (const decision of decisions(app)) {
    for (const render of [app.renderGuidedDecision, app.renderDecisionModal]) {
      const html = render(decision);
      const sources = [...html.matchAll(/<img[^>]*src="([^"]+)"/g)].map(match => match[1]);
      assert.equal(sources.length, decision.options.length, 'Load only the active question, not nested questions');
      assert.ok(sources.length <= 5, 'Do not render the whole photo collection');
      const bytes = sources.reduce((total, src) => total + fs.statSync(path.join(root, src)).size, 0);
      assert.ok(bytes < 650000, `${decision.title}: ${bytes} bytes in active photos`);
      assert.ok(Buffer.byteLength(html) < 9000, 'Keep each question DOM compact');
      assert.equal((html.match(/decoding="async"/g) || []).length, sources.length);
      assert.ok(!html.includes('data:image/'), 'Never embed large image payloads in screen markup');
    }
  }
  const mapping = fs.readFileSync(path.join(root, 'assets/grading-example-images.js'), 'utf8');
  assert.ok(Buffer.byteLength(mapping) < 8000);
  assert.doesNotMatch(mapping, /new Image\(|fetch\(|setInterval\(/, 'Mapping must not fetch/preload an archive or call the database');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  const header = config.headers.find(rule => rule.source.includes('/assets/') && rule.source.includes('jpg'));
  assert.ok(header.headers.some(h => h.key === 'Cache-Control' && /public, max-age=\d+/.test(h.value)));
});

test('warmup fetches only the next main comparison photos once, never all follow-up photos', () => {
  const app = loadAppSandbox();
  const requested = [];
  app.Image = class {
    set src(value) { requested.push(value); }
  };
  vm.runInContext('STATE.currentGrading={huidigeIndex:0,inspectionObservationPaths:{}}', app);
  app.preloadNextVisualAssets();
  assert.ok(requested.length > 0 && requested.length <= 8);
  const followup = JSON.parse(fs.readFileSync(path.join(root, 'docs/grading-detail-image-review.json'), 'utf8')).assets.map(row => row.image);
  assert.ok(requested.every(src => !followup.includes(src)));
  const count = requested.length;
  app.preloadNextVisualAssets();
  assert.equal(requested.length, count, 'Do not fetch warmup photos again after repaint');
});
