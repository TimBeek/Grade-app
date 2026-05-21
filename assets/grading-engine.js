// =============================================================================
// REMARKT GRADING ENGINE
// Regels, onderdelen, impactprofielen en eindgradeberekening.
// Houd dit bestand UI-vrij zodat de gradinglogica zelfstandig testbaar blijft.
// =============================================================================
const ONDERDELEN = [
  {
    id: 'bovenkap',
    naam: 'Lid Cover',
    hint: 'Check the outside of the lid. This is highly visible when the laptop is open.',
    gewicht: 3,
    keuzes: [
      { letter: 'A', titel: 'No scratches over 0.5 cm', detail: 'No dents, paint damage or stickers' },
      { letter: 'B', titel: 'Light scratches up to 1 cm', detail: 'Light paint wear or small dents allowed' },
      { letter: 'C', titel: 'Scratches, dents or paint damage', detail: 'Small missing corner allowed' },
      { letter: 'D', titel: 'Repair / not sellable', detail: 'Structural break or sharp edges' }
    ],
    triggers: [
      { id: 'barst_boven', label: 'Crack or break', impact: 'max-c' },
      { id: 'hoek_boven', label: 'Missing corner', impact: 'max-c' },
      { id: 'verbuiging_boven', label: 'Bent, does not close', impact: 'defect' }
    ]
  },
  {
    id: 'onderkant',
    naam: 'Bottom Cover',
    hint: 'Turn the laptop over and check the bottom cover and rubber feet.',
    gewicht: 1,
    keuzes: [
      { letter: 'A', titel: 'Light marks up to 0.5 cm', detail: 'All rubber feet present' },
      { letter: 'B', titel: 'Visible scratches or small dent', detail: 'Light paint wear; rubber feet may be missing' },
      { letter: 'C', titel: 'Heavy scratches, dents or paint damage', detail: 'Small missing corner allowed' },
      { letter: 'D', titel: 'Repair / not sellable', detail: 'Damage is too heavy for normal use' }
    ],
    triggers: [
      { id: 'barst_onder', label: 'Crack or break', impact: 'max-c' },
      { id: 'hoek_onder', label: 'Missing corner', impact: 'max-c' }
    ]
  },
  {
    id: 'randen',
    naam: 'Edges & Corners',
    hint: 'Check all corners for dents, missing pieces and sharp edges.',
    gewicht: 1,
    keuzes: [
      { letter: 'A', titel: 'Light wear only', detail: 'No dents or paint damage' },
      { letter: 'B', titel: 'Scratches or light dents', detail: 'Paint wear on multiple spots' },
      { letter: 'C', titel: 'Missing corner or deep damage', detail: 'Deep scratches or strong dents' },
      { letter: 'D', titel: 'Repair / not sellable', detail: 'Corner missing or dangerous sharp edge' }
    ],
    triggers: [
      { id: 'hoek_randen', label: 'Corner fully missing', impact: 'max-c' },
      { id: 'scherp_randen', label: 'Dangerous sharp edge', impact: 'defect' }
    ]
  },
  {
    id: 'palmrest',
    naam: 'Palmrest',
    hint: 'Open the laptop and inspect the area around the keyboard.',
    gewicht: 3,
    keuzes: [
      { letter: 'A', titel: 'No scratches or coating issues', detail: 'No soft-touch coating damage' },
      { letter: 'B', titel: 'Light scratches or coating wear', detail: 'Small dent allowed' },
      { letter: 'C', titel: 'Heavy scratches or sticky coating', detail: 'Dents or small missing corner allowed' },
      { letter: 'D', titel: 'Repair / not sellable', detail: 'Large missing corner or safety risk' }
    ],
    triggers: [
      { id: 'barst_palm', label: 'Crack or break', impact: 'max-c' },
      { id: 'plakkerig_palm', label: 'Sticky coating', impact: 'max-c' }
    ]
  },
  {
    id: 'bezel',
    naam: 'Screen Bezel',
    hint: 'Inspect the bezel around the LCD and check for hairline cracks.',
    gewicht: 2,
    keuzes: [
      { letter: 'A', titel: 'No visible damage', detail: 'No cracks or visible repair' },
      { letter: 'B', titel: 'Light marks or small scratches', detail: 'No visible cracks' },
      { letter: 'C', titel: 'Cracks or heavy paint damage', detail: '' },
      { letter: 'D', titel: 'Repair / not sellable', detail: 'Bezel loose or crack over 3 cm' }
    ],
    triggers: [
      { id: 'haarscheur_bezel', label: 'Hairline crack', impact: 'max-b' },
      { id: 'haarscheur_gerepareerd', label: 'Repaired hairline crack', impact: 'info' },
      { id: 'barst_bezel', label: 'Large crack or break', impact: 'max-c' }
    ]
  },
  {
    id: 'lcd',
    naam: 'LCD & Glass',
    hint: 'Check the screen on and off from about 30 cm distance.',
    gewicht: 3,
    keuzes: [
      { letter: 'A', titel: 'No key marks or scratches', detail: '' },
      { letter: 'B', titel: 'Light key marks or small whitespot', detail: 'Barely visible when screen is on' },
      { letter: 'C', titel: 'Visible key marks, scratches or whitespot', detail: 'Visible, but still sellable' },
      { letter: 'D', titel: 'Repair / not sellable', detail: 'Pixel lines, cracked glass or faulty screen' }
    ],
    triggers: [
      { id: 'pixel_lcd', label: 'Pixel line or flicker', impact: 'defect' },
      { id: 'barst_lcd', label: 'Cracked glass', impact: 'max-c' },
      { id: 'keyinprint_lcd', label: 'Key marks visible when on', impact: 'max-c' },
      { id: 'whitespot_lcd', label: 'Clear whitespot when on', impact: 'max-c' },
      { id: 'backlight_lcd', label: 'Backlight bleeding', impact: 'info' }
    ]
  },
  {
    id: 'keyboard',
    naam: 'Keyboard',
    hint: 'Check all keys for wear, missing keys and function.',
    gewicht: 3,
    keuzes: [
      { letter: 'A', titel: 'No visible damage', detail: 'Minimal key wear' },
      { letter: 'B', titel: 'Visible key fading', detail: 'Light use marks' },
      { letter: 'C', titel: 'Heavy key wear', detail: 'Strong fading or coating wear' },
      { letter: 'D', titel: 'Repair / not sellable', detail: 'Keyboard missing or faulty' }
    ],
    triggers: [
      { id: 'toets_ontbreekt', label: 'Key missing', impact: 'max-c' },
      { id: 'toets_kapot', label: 'Key not working', impact: 'defect' }
    ]
  },
  {
    id: 'touchpad',
    naam: 'Touchpad',
    hint: 'Check touchpad condition and function.',
    gewicht: 3,
    keuzes: [
      { letter: 'A', titel: 'No damage, fully functional', detail: '' },
      { letter: 'B', titel: 'Light scratches', detail: 'May look used, but works fully' },
      { letter: 'C', titel: 'Deep scratches or coating loss', detail: 'Works, but visibly damaged' },
      { letter: 'D', titel: 'Repair / not sellable', detail: 'Missing or not functional' }
    ],
    triggers: [
      { id: 'barst_touchpad', label: 'Crack or break', impact: 'max-c' },
      { id: 'touchpad_kapot', label: 'Touchpad not working', impact: 'defect' }
    ]
  },
  {
    id: 'scharnieren',
    naam: 'Hinges',
    hint: 'Open and close the screen several times and feel the resistance.',
    gewicht: 2,
    keuzes: [
      { letter: 'A', titel: 'Functional, no visible damage', detail: '' },
      { letter: 'B', titel: 'Light wear', detail: 'No deep scratches' },
      { letter: 'C', titel: 'Loose or visibly worn', detail: 'No break, still connected' },
      { letter: 'D', titel: 'Heavy damage, check function', detail: 'Functional = C, not functional = repair' }
    ],
    triggers: [
      { id: 'scharnier_kapot', label: 'Not functional or safety risk', impact: 'defect' },
      { id: 'verbuiging_scharnier', label: 'Housing bent, hinge cannot close', impact: 'defect' }
    ]
  },
  {
    id: 'stickers',
    naam: 'Stickers & Glue',
    hint: 'Check all surfaces for stickers and glue residue.',
    gewicht: 1,
    keuzes: [
      { letter: 'A', titel: 'No stickers or glue residue', detail: '' },
      { letter: 'B', titel: 'Removable without damage', detail: '' },
      { letter: 'C', titel: 'Cannot remove without paint damage', detail: '' },
      { letter: 'D', titel: 'Repair / not sellable', detail: 'Removal makes device unsellable' }
    ],
    triggers: [
      { id: 'lakschade_sticker', label: 'Sticker removal causes paint damage', impact: 'max-c' }
    ]
  }
];

const STRAFPUNTEN = { A: 0, B: 1, C: 4, D: 999 };
const GRADING_RULES_VERSION = 'demo-2026-05-07-v1';

const GRADING_IMPACTS = {
  bovenkap: { A: 'a-plus', B: 'a', C: 'c', D: 'x' },
  onderkant: { A: 'a-plus', B: 'a-minus', C: 'c-plus', D: 'x' },
  randen: { A: 'a-plus', B: 'a-minus', C: 'c', D: 'x' },
  palmrest: { A: 'a-plus', B: 'a-minus', C: 'c', D: 'x' },
  bezel: { A: 'a-plus', B: 'a-minus', C: 'c', D: 'x' },
  lcd: { A: 'a-plus', B: 'b', C: 'c', D: 'x' },
  keyboard: { A: 'a-plus', B: 'a', C: 'b', D: 'x' },
  touchpad: { A: 'a-plus', B: 'a-minus', C: 'c-plus', D: 'x' },
  scharnieren: { A: 'a-plus', B: 'a-minus', C: 'c-plus', D: 'c' },
};

const IMPACT_PROFILES = {
  'a-plus': { label: 'A+', points: 0, minGrade: 'A' },
  a: { label: 'A', points: 1, minGrade: 'A' },
  'a-minus': { label: 'A-', points: 2, minGrade: 'A' },
  b: { label: 'B', points: 8, minGrade: 'B' },
  'c-plus': { label: 'C+', points: 18, minGrade: 'B' },
  'c-minus': { label: 'C-', points: 30, minGrade: 'C' },
  c: { label: 'C', points: 30, minGrade: 'C' },
  x: { label: 'X', points: 999, minGrade: 'D' },
};

const CHOICE_DECISIONS = {
  lcd: {
    B: {
      title: 'LCD B Detail',
      text: 'Choose the closest match: key marks, whitespot or both.',
      options: [
        { label: 'Key Marks B', detail: 'Light marks, not visible when screen is on', impact: 'b', image: 'assets/dell-grading-fast/lcd-keyinprint-b.jpg' },
        { label: 'Whitespot B', detail: 'Light spot, limited visibility', impact: 'b', image: 'assets/dell-grading-fast/lcd-whitespot-b.jpg' },
        { label: 'Mixed B', detail: 'Light key marks with small whitespot', impact: 'b', image: 'assets/dell-grading-fast/lcd-mixed-b.jpg' },
      ],
    },
    C: {
      title: 'LCD C Detail',
      text: 'Choose the closest match: clear key marks, whitespot or both.',
      options: [
        { label: 'Key Marks C', detail: 'More than 3 marks or visible when screen is on', impact: 'c', image: 'assets/dell-grading-fast/lcd-keyinprint-c.jpg' },
        { label: 'Whitespot C', detail: 'Clear but still sellable white spot', impact: 'c', image: 'assets/dell-grading-fast/lcd-whitespot-c-balanced.jpg' },
        { label: 'Mixed C', detail: 'Key marks and whitespot are clearly visible', impact: 'c', image: 'assets/dell-grading-fast/lcd-mixed-c.jpg' },
      ],
    },
  },
  onderkant: {
    C: {
      title: 'Bottom Cover C Detail',
      text: 'Choose the closest match: heavy wear without cracks, or real cracks/breaks.',
      options: [
        { label: 'Heavy wear', detail: 'No cracks or breaks; counts as B impact', impact: 'b', image: 'assets/dell-grading-fast/onderkant-gebruikssporen.jpg' },
        { label: 'Cracked / broken', detail: 'Crack, break or missing corner; counts as C', impact: 'c', image: 'assets/dell-grading-fast/onderkant-barsten-breuken.jpg' },
      ],
    },
  },
  keyboard: {
    D: {
      title: 'Keyboard X Detail',
      text: 'Choose the closest match: missing keys, or full keyboard missing/faulty.',
      options: [
        { label: 'Keys Missing', detail: 'One or more keys missing, but keyboard is not fully faulty', impact: 'c-minus', image: 'assets/dell-grading-fast/keyboard-many-missing-keys-ai.jpg' },
        { label: 'Keyboard Missing / Faulty', detail: 'Keyboard is missing or does not work', impact: 'x', image: 'assets/dell-grading-fast/keyboard-defect.jpg' },
      ],
    },
  },
  touchpad: {
    C: {
      title: 'Touchpad C Detail',
      text: 'Choose the closest match: heavy wear or cracks/breaks.',
      options: [
        { label: 'Heavy wear', detail: 'Visible use but no crack or break; counts as B impact', impact: 'b', image: 'assets/dell-grading-fast/touchpad-gebruikssporen.jpg' },
        { label: 'Touchpad Cracked', detail: 'Crack in the touchpad; counts as C', impact: 'c', image: 'assets/dell-grading-fast/touchpad-cracked-ai.jpg' },
      ],
    },
  },
  scharnieren: {
    D: {
      title: 'Hinge X Detail',
      text: 'Choose whether the hinge still works, or is loose/faulty.',
      options: [
        { label: 'Functional', detail: 'Hinge works; only cover/corner damage. Counts as C', impact: 'c', image: 'assets/dell-grading-fast/scharnier-functioneel.jpg' },
        { label: 'Not Functional', detail: 'Hinge is loose or disconnected. Counts as X', impact: 'x', image: 'assets/dell-grading-fast/scharnier-loshangend-ai.jpg' },
      ],
    },
  },
};

// =============================================================================
// SCORE ENGINE - de kern logica
// =============================================================================
function getGradingOnderdelen() {
  return ONDERDELEN.filter(ond => ond.id !== 'stickers');
}

function getChoiceProfile(componentId, letter, impactOverrides = {}) {
  const impact = impactOverrides[componentId] || (GRADING_IMPACTS[componentId] && GRADING_IMPACTS[componentId][letter]);
  return IMPACT_PROFILES[impact] || IMPACT_PROFILES['a-plus'];
}

function getChoiceDecision(componentId, letter) {
  return CHOICE_DECISIONS[componentId] && CHOICE_DECISIONS[componentId][letter];
}

function getBorderlineAReview(result) {
  if (!result || result.eindgrade !== 'A') return null;
  const minusRows = (result.detailRows || []).filter(row => row.impact === 'A' || row.impact === 'A-');
  const shouldReview = result.score >= 4 || minusRows.length >= 3;
  if (!shouldReview) return null;

  const summary = minusRows.map(row => `${row.naam}: ${row.impact}`).join(', ');
  return {
    type: 'grade-review',
    title: 'Borderline A Grade',
    text: `This device still falls within A, but has several light issues (${summary}). Confirm whether it is truly A-grade.`,
    options: [
      { label: 'Keep A', detail: 'Issues are light enough for A', finalGrade: 'A' },
      { label: 'Set to B', detail: 'Too many visible issues for A', finalGrade: 'B' },
    ],
  };
}

function calculateGrade(keuzes, triggers, impactOverrides = {}) {
  const result = {
    score: 0,
    eindgrade: null,
    plafond: null,
    plafondReden: null,
    redenen: [],
    detailRows: []
  };
  const onderdelen = getGradingOnderdelen();

  // Stap 1: Knock-out / defect check
  for (const ond of onderdelen) {
    const k = keuzes[ond.id];
    const profile = getChoiceProfile(ond.id, k, impactOverrides);
    if (profile.minGrade === 'D') {
      result.eindgrade = 'D';
      result.plafondReden = `${ond.naam} marked as ${profile.label}`;
      result.redenen.push({ type: 'bad', text: `${ond.naam} is ${profile.label} -> repair / not sellable` });
      buildDetailRows(result, keuzes, impactOverrides);
      return result;
    }
    // Detail-trigger defect
    for (const t of (ond.triggers || [])) {
      if (triggers[t.id] && t.impact === 'defect') {
        result.eindgrade = 'D';
        result.plafondReden = `${ond.naam}: ${t.label.toLowerCase()}`;
        result.redenen.push({ type: 'bad', text: `${ond.naam}: ${t.label.toLowerCase()} -> device not sellable` });
        buildDetailRows(result, keuzes, impactOverrides);
        return result;
      }
    }
  }

  // Stap 2: Onderdeelregels en detailregels (minimaal B/C)
  let ceiling = 'A';
  const ceilingReasons = [];
  for (const ond of onderdelen) {
    const k = keuzes[ond.id];
    if (k) {
      const profile = getChoiceProfile(ond.id, k, impactOverrides);
      if (rank(profile.minGrade) > rank(ceiling)) {
        ceiling = profile.minGrade;
      }
      if (rank(profile.minGrade) > rank('A')) {
        ceilingReasons.push(`${ond.naam}: option ${k === 'D' ? 'X' : k} counts as ${profile.label}`);
      }
    }
    for (const t of (ond.triggers || [])) {
      if (triggers[t.id]) {
        if (t.impact === 'max-c' && rank(ceiling) < rank('C')) {
          ceiling = 'C';
          ceilingReasons.push(`${ond.naam}: ${t.label.toLowerCase()}`);
        } else if (t.impact === 'max-b' && rank(ceiling) < rank('B')) {
          ceiling = 'B';
          ceilingReasons.push(`${ond.naam}: ${t.label.toLowerCase()}`);
        }
      }
    }
  }

  // Stap 3: Score berekenen
  let score = 0;
  for (const ond of onderdelen) {
    const k = keuzes[ond.id];
    if (k) {
      score += getChoiceProfile(ond.id, k, impactOverrides).points;
    }
  }
  result.score = score;

  // Stap 4: Voorlopige grade uit score
  let voorlopig;
  if (score <= 5) voorlopig = 'A';
  else if (score <= 25) voorlopig = 'B';
  else voorlopig = 'C';

  // Stap 5: Onderdeelregels toepassen
  let eind = voorlopig;
  if (rank(ceiling) > rank(voorlopig)) {
    eind = ceiling;
    result.redenen.push({ type: 'warn', text: `Part rule active: ${ceilingReasons.join('; ')}` });
    result.plafondReden = ceilingReasons.join('; ');
  }

  result.eindgrade = eind;
  
  // Voeg goede-redenen toe
  if (eind === 'A') {
    result.redenen.unshift({ type: 'good', text: 'No repair, C or B rule active' });
    result.redenen.push({ type: 'good', text: `Impact score ${score} falls in A range (0 to 5 points)` });
  } else if (eind === 'B' && !result.redenen.some(r => r.type === 'warn')) {
    result.redenen.unshift({ type: 'good', text: 'No repair or C rule active' });
    result.redenen.push({ type: 'good', text: `Impact score ${score} falls in B range (6 to 25 points)` });
  } else if (eind === 'C' && !ceilingReasons.length) {
    result.redenen.push({ type: 'good', text: `Impact score ${score} falls in C range (26 points or higher)` });
  }

  buildDetailRows(result, keuzes, impactOverrides);
  return result;
}

function rank(g) { return { A: 0, B: 1, C: 2, D: 3 }[g]; }

function buildDetailRows(result, keuzes, impactOverrides = {}) {
  result.detailRows = getGradingOnderdelen().map(ond => {
    const k = keuzes[ond.id];
    const profile = getChoiceProfile(ond.id, k, impactOverrides);
    const punten = k ? profile.points : 0;
    return { naam: ond.naam, gewicht: ond.gewicht, keuze: k || '-', impact: k ? profile.label : '-', punten };
  });
}

function buildProblemRows(keuzes, triggers, impactOverrides = {}) {
  const problems = [];
  for (const ond of getGradingOnderdelen()) {
    const keuze = keuzes[ond.id];
    if (keuze && getChoiceProfile(ond.id, keuze, impactOverrides).minGrade === 'D') problems.push(`${ond.naam}: repair / not sellable`);
    for (const t of (ond.triggers || [])) {
      if (triggers[t.id] && t.impact === 'defect') {
        problems.push(`${ond.naam}: ${t.label}`);
      }
    }
  }
  return problems;
}



