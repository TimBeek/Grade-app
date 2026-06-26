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
const GRADING_RULES_VERSION = 'demo-2026-06-25-repair-grade-after-fix-v1';

const GRADING_IMPACTS = {
  bovenkap: { A: 'a-plus', B: 'a', C: 'c', D: 'x' },
  onderkant: { A: 'a-plus', B: 'a-minus', C: 'c-plus', D: 'x' },
  randen: { A: 'a-plus', B: 'a-minus', C: 'c', D: 'x' },
  palmrest: { A: 'a-plus', B: 'a-minus', C: 'c', D: 'x' },
  bezel: { A: 'a-plus', B: 'a-minus', C: 'c', D: 'x' },
  lcd: { A: 'a-plus', B: 'b', C: 'c', D: 'x' },
  keyboard: { A: 'a-plus', B: 'a', C: 'b', D: 'x' },
  touchpad: { A: 'a-plus', B: 'a-minus', C: 'c-plus', D: 'x' },
  scharnieren: { A: 'a-plus', B: 'a-minus', C: 'c-plus', D: 'x' },
};

const IMPACT_PROFILES = {
  'a-plus': { label: 'A+', points: 0, minGrade: 'A' },
  a: { label: 'A', points: 1, minGrade: 'A' },
  'a-minus': { label: 'A-', points: 2, minGrade: 'A' },
  b: { label: 'B', points: 8, minGrade: 'B' },
  'b-minus': { label: 'B-', points: 22, minGrade: 'B' },
  'c-plus': { label: 'C+', points: 18, minGrade: 'B' },
  'c-minus': { label: 'C-', points: 30, minGrade: 'C' },
  c: { label: 'C', points: 30, minGrade: 'C' },
  x: { label: 'X', points: 999, minGrade: 'D' },
};

const REPAIR_LABEL_TYPES = {
  production: 'production',
  direct: 'direct',
  reject: 'reject',
};

const REPAIR_SEVERITIES = {
  light: 'light',
  heavy: 'heavy',
  reject: 'reject',
};

const CHOICE_DECISIONS = {
  bovenkap: {
    B: {
      title: 'Bovenkap B Detail',
      text: 'Kies de situatie die het beste past bij de bovenkap.',
      options: [
        { label: 'Minimale gebruikssporen', detail: 'Kleine krassen of lichte gebruikssporen', impact: 'a-minus', image: 'assets/dell-grading-fast/bovenkap-minimale-krassen-dell-ai.jpg' },
        { label: 'Meerdere krassen', detail: 'Meerdere kleinere of diepere gebruikssporen', impact: 'b', image: 'assets/dell-grading-fast/bovenkap-meerdere-krassen-dell-ai.jpg' },
        { label: 'Lichte lakschade', detail: 'Lichte lakschade aanwezig', impact: 'b', image: 'assets/dell-grading-fast/bovenkap-lichte-lakschade-dell-ai.jpg' },
      ],
    },
    C: {
      title: 'Bovenkap C Detail',
      text: 'Kies de situatie die het beste past bij de bovenkap.',
      options: [
        { label: 'Grote diepe krassen', detail: 'Duidelijke diepe krassen zonder zware lakschade', impact: 'b-minus', image: 'assets/dell-grading-fast/bovenkap-grote-diepe-krassen-dell-ai.jpg' },
        { label: 'Hevige lakschade', detail: 'Veel of zware lakschade', impact: 'c', image: 'assets/dell-grading-fast/bovenkap-hevige-lakschade-dell-ai.jpg' },
        { label: 'Deuken + diepe krassen', detail: 'Deuken gecombineerd met diepe krassen', impact: 'c', image: 'assets/dell-grading-fast/bovenkap-deuken-diepe-krassen-dell-ai.jpg' },
      ],
    },
    D: {
      title: 'Bovenkap X Reden',
      text: 'Kies waarom de bovenkap als X wordt beoordeeld.',
      options: [
        { label: 'Bovenkap gebroken', detail: 'Barst, breuk of structurele schade', impact: 'x', repairIssue: 'Bovenkap gebroken', repairRoute: 'direct', repairSeverity: 'heavy' },
        { label: 'Scherpe rand', detail: 'Scherpe of gevaarlijke rand aanwezig', impact: 'x', repairIssue: 'Bovenkap scherpe rand', repairRoute: 'reject', repairSeverity: 'reject' },
        { label: 'Sluit niet goed', detail: 'Bovenkap is verbogen of sluit niet normaal', impact: 'x', repairIssue: 'Bovenkap sluit niet goed', repairRoute: 'production', repairSeverity: 'light' },
      ],
    },
  },
  randen: {
    C: {
      title: 'Zijkant C Detail',
      text: 'Kies de situatie die het beste past bij de zijkant.',
      options: [
        { label: 'Open/verbogen herstelbaar', detail: 'Ijzer of rand staat open, maar kan rechtgemaakt worden', impact: 'a', repairIssue: 'Zijkant open/verbogen rechtmaken', repairRoute: 'production', repairSeverity: 'light', afterRepairImpact: 'a-plus', image: 'assets/dell-grading-fast/randen-open-verbogen-herstelbaar-v3-ai.jpg' },
        { label: 'Open/te zwaar verbogen', detail: 'Zijkant staat open en is te zwaar verbogen om netjes te herstellen', impact: 'c', image: 'assets/dell-grading-fast/randen-open-verbogen-niet-herstelbaar-dell-ai.jpg' },
      ],
    },
    D: {
      title: 'Zijkant X Reden',
      text: 'Kies waarom de zijkant of hoek als X wordt beoordeeld.',
      options: [
        { label: 'Zijkant gebroken', detail: 'Hoek of zijkant is gebroken', impact: 'x', repairIssue: 'Zijkant gebroken', repairRoute: 'direct', repairSeverity: 'heavy' },
        { label: 'Scherpe rand', detail: 'Scherpe of gevaarlijke rand aanwezig', impact: 'x', repairIssue: 'Zijkant scherpe rand', repairRoute: 'reject', repairSeverity: 'reject' },
        { label: 'Niet herstelbaar verbogen', detail: 'Zijkant staat open of scheef en is niet netjes te herstellen', impact: 'x', repairIssue: 'Zijkant niet herstelbaar verbogen', repairRoute: 'reject', repairSeverity: 'reject' },
      ],
    },
  },
  bezel: {
    B: {
      title: 'Schermrand B Detail',
      text: 'Kies de situatie die het beste past bij de schermrand.',
      options: [
        { label: 'Verkleuring rand', detail: 'Verkleuring van de schermrand', impact: 'a-minus', image: 'assets/dell-grading-fast/bezel-verkleuring-rand-dell-ai.jpg' },
        { label: 'Haarscheurtje bezelrand', detail: 'Klein haarscheurtje in de bezelrand', impact: 'b-minus', image: 'assets/dell-grading-fast/bezel-haarscheurtje-b-dell-ai.jpg' },
      ],
    },
    C: {
      title: 'Schermrand C Detail',
      text: 'Kies de situatie die het beste past bij de schermrand.',
      options: [
        { label: 'Haarscheurtje bezelrand', detail: 'Klein haarscheurtje in de bezelrand', impact: 'b-minus', image: 'assets/dell-grading-fast/bezel-haarscheurtje-c-dell-ai.jpg' },
        { label: 'Cracks / zwaar gebroken', detail: 'Duidelijke barsten of zwaar gebroken bezelrand', impact: 'c', image: 'assets/dell-grading-fast/bezel-zwaar-gebroken-dell-ai.jpg' },
      ],
    },
    D: {
      title: 'Schermrand X Reden',
      text: 'Kies waarom de schermrand als X wordt beoordeeld.',
      options: [
        { label: 'Schermrand gebroken', detail: 'Bezel is zwaar gebroken of mist stukken', impact: 'x', repairIssue: 'Schermrand gebroken', repairRoute: 'direct', repairSeverity: 'heavy' },
        { label: 'Schermrand los', detail: 'Bezel zit los of klikt niet meer vast', impact: 'x', repairIssue: 'Schermrand los', repairRoute: 'direct', repairSeverity: 'heavy' },
        { label: 'Scherpe rand', detail: 'Scherpe of gevaarlijke rand rond het scherm', impact: 'x', repairIssue: 'Schermrand scherpe rand', repairRoute: 'reject', repairSeverity: 'reject' },
      ],
    },
  },
  lcd: {
    B: {
      title: 'LCD B Detail',
      text: 'Kies de situatie die het beste past: toetsafdrukken, whitespot of combinatie.',
      options: [
        {
          label: 'Toetsafdrukken',
          detail: 'Alleen key imprint, geen whitespot',
          impact: 'a-minus',
          image: 'assets/dell-grading-fast/lcd-keyinprint-b.jpg',
          nextDecision: {
            title: 'LCD toetsafdruk grootte',
            text: 'Kies hoe groot de toetsafdruk zichtbaar is.',
            options: [
              { label: '0-5 cm', detail: 'Lichte toetsafdruk, impact A-', impact: 'a-minus', image: 'assets/dell-grading-fast/lcd-keyinprint-0-5cm.jpg' },
              { label: '5-10 cm', detail: 'Alleen A- als alle andere onderdelen A zijn; anders impact B', impact: 'a-minus-if-all-other-a', image: 'assets/dell-grading-fast/lcd-keyinprint-5-10cm.jpg' },
              { label: '10+ cm', detail: 'Duidelijk zichtbaar over groter vlak, impact B', impact: 'b', image: 'assets/dell-grading-fast/lcd-keyinprint-10-plus-cm.jpg' },
            ],
          },
        },
        { label: 'Whitespot', detail: 'Lichte spot, beperkt zichtbaar', impact: 'b', image: 'assets/dell-grading-fast/lcd-whitespot-b.jpg' },
        { label: 'Combinatie', detail: 'Lichte toetsafdrukken met kleine whitespot', impact: 'b', image: 'assets/dell-grading-fast/lcd-mixed-b.jpg' },
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
    D: {
      title: 'LCD X Reden',
      text: 'Kies waarom het LCD als X wordt beoordeeld.',
      options: [
        { label: 'Pixel line', detail: 'Horizontale of verticale lijn in het beeld', impact: 'x', repairIssue: 'LCD pixel line', repairRoute: 'direct', repairSeverity: 'heavy' },
        { label: 'Cracked screen', detail: 'Scherm of glas is gebarsten', impact: 'x', repairIssue: 'LCD cracked screen', repairRoute: 'direct', repairSeverity: 'heavy' },
        { label: 'Dead pixels', detail: 'Dode pixels zichtbaar in het beeld', impact: 'x', repairIssue: 'LCD dead pixels', repairRoute: 'direct', repairSeverity: 'heavy' },
        { label: 'Schermflikkering', detail: 'Beeld flikkert of valt weg', impact: 'x', repairIssue: 'LCD schermflikkering', repairRoute: 'direct', repairSeverity: 'heavy' },
        { label: 'Geen beeld', detail: 'LCD geeft geen beeld', impact: 'x', repairIssue: 'LCD geen beeld', repairRoute: 'direct', repairSeverity: 'heavy' },
      ],
    },
  },
  onderkant: {
    C: {
      title: 'Bottom Cover C Detail',
      text: 'Choose the closest match: heavy wear, cracks or breaks.',
      options: [
        { label: 'Heavy wear', detail: 'No cracks or breaks', impact: 'b', image: 'assets/dell-grading-fast/onderkant-gebruikssporen.jpg' },
        { label: 'Cracked / broken', detail: 'Crack, break or missing corner', impact: 'c', image: 'assets/dell-grading-fast/onderkant-barsten-breuken.jpg' },
      ],
    },
    D: {
      title: 'Onderkant X Reden',
      text: 'Kies waarom de onderkant als X wordt beoordeeld.',
      options: [
        { label: 'Onderkant gebroken', detail: 'Barst, breuk of structurele schade', impact: 'x', repairIssue: 'Onderkant gebroken', repairRoute: 'direct', repairSeverity: 'heavy' },
        { label: 'Onderdeel ontbreekt', detail: 'Rubber, klep of behuizingsdeel ontbreekt ernstig', impact: 'x', repairIssue: 'Onderkant onderdeel ontbreekt', repairRoute: 'direct', repairSeverity: 'heavy' },
        { label: 'Veiligheidsrisico', detail: 'Scherpe rand of open behuizing', impact: 'x', repairIssue: 'Onderkant veiligheidsrisico', repairRoute: 'reject', repairSeverity: 'reject' },
      ],
    },
  },
  keyboard: {
    D: {
      title: 'Keyboard X Detail',
      text: 'Kies eerst welke situatie het beste past bij het keyboard.',
      options: [
        {
          label: 'Toetsen ontbreken',
          detail: 'Een of meerdere toetsen ontbreken',
          impact: 'x',
          image: 'assets/dell-grading-fast/keyboard-many-missing-keys-ai.jpg',
          nextDecision: {
            title: 'Toetsenbord X Reden',
            text: 'Kies de exacte reden voor het reparatielabel.',
            options: [
              { label: 'Missing key', detail: 'Een toets ontbreekt', impact: 'x', repairIssue: 'Missing key', repairRoute: 'production', repairSeverity: 'light' },
              { label: 'Meerdere toetsen ontbreken', detail: 'Meerdere toetsen ontbreken', impact: 'x', repairIssue: 'Meerdere toetsen ontbreken', repairRoute: 'production', repairSeverity: 'light' },
            ],
          },
        },
        {
          label: 'Keyboard ontbreekt / defect',
          detail: 'Keyboard mist volledig of werkt niet betrouwbaar',
          impact: 'x',
          image: 'assets/dell-grading-fast/keyboard-defect.jpg',
          nextDecision: {
            title: 'Toetsenbord X Reden',
            text: 'Kies de exacte reden voor het reparatielabel.',
            options: [
              { label: 'Toets werkt niet', detail: 'Een of meerdere toetsen reageren niet', impact: 'x', repairIssue: 'Toets werkt niet', repairRoute: 'production', repairSeverity: 'light' },
              { label: 'Keyboard defect', detail: 'Keyboard werkt niet betrouwbaar', impact: 'x', repairIssue: 'Keyboard defect', repairRoute: 'direct', repairSeverity: 'heavy' },
              { label: 'Keyboard ontbreekt', detail: 'Keyboard mist volledig of is niet bruikbaar', impact: 'x', repairIssue: 'Keyboard ontbreekt', repairRoute: 'direct', repairSeverity: 'heavy' },
            ],
          },
        },
      ],
    },
  },
  palmrest: {
    D: {
      title: 'Palmrest X Reden',
      text: 'Kies waarom de palmrest als X wordt beoordeeld.',
      options: [
        { label: 'Palmrest gebroken', detail: 'Palmrest heeft een breuk of structurele schade', impact: 'x', repairIssue: 'Palmrest gebroken', repairRoute: 'direct', repairSeverity: 'heavy' },
        { label: 'Hoek ontbreekt', detail: 'Grote hoek of stuk van de palmrest ontbreekt', impact: 'x', repairIssue: 'Palmrest hoek ontbreekt', repairRoute: 'direct', repairSeverity: 'heavy' },
        { label: 'Veiligheidsrisico', detail: 'Scherpe rand of open behuizing rond de palmrest', impact: 'x', repairIssue: 'Palmrest veiligheidsrisico', repairRoute: 'reject', repairSeverity: 'reject' },
      ],
    },
  },
  touchpad: {
    C: {
      title: 'Touchpad C Detail',
      text: 'Choose the closest match: heavy wear or cracks/breaks.',
      options: [
        { label: 'Heavy wear', detail: 'Visible use but no crack or break', impact: 'b', image: 'assets/dell-grading-fast/touchpad-gebruikssporen.jpg' },
        { label: 'Touchpad Cracked', detail: 'Crack in the touchpad', impact: 'c', image: 'assets/dell-grading-fast/touchpad-cracked-ai.jpg' },
      ],
    },
    D: {
      title: 'Touchpad X Reden',
      text: 'Kies waarom de touchpad als X wordt beoordeeld.',
      options: [
        { label: 'Touchpad werkt niet', detail: 'Touchpad reageert niet of niet betrouwbaar', impact: 'x', repairIssue: 'Touchpad werkt niet', repairRoute: 'production', repairSeverity: 'light' },
        { label: 'Touchpad ontbreekt', detail: 'Touchpad of knop ontbreekt', impact: 'x', repairIssue: 'Touchpad ontbreekt', repairRoute: 'production', repairSeverity: 'light' },
        { label: 'Touchpad gebarsten', detail: 'Touchpad is gebarsten of gebroken', impact: 'x', repairIssue: 'Touchpad gebarsten', repairRoute: 'production', repairSeverity: 'light' },
      ],
    },
  },
  scharnieren: {
    D: {
      title: 'Scharnier X Detail',
      text: 'Kies eerst of het scharnier nog werkt of echt defect is.',
      options: [
        { label: 'Functioneel', detail: 'Scharnier werkt nog; alleen kap- of hoekschade', impact: 'c', image: 'assets/dell-grading-fast/scharnier-functioneel.jpg' },
        {
          label: 'Niet functioneel',
          detail: 'Scharnier zit los of werkt niet normaal',
          impact: 'x',
          image: 'assets/dell-grading-fast/scharnier-loshangend-ai.jpg',
          nextDecision: {
            title: 'Scharnier X Reden',
            text: 'Kies de exacte reden voor het reparatielabel.',
            options: [
              { label: 'Scharnier werkt niet', detail: 'Scharnier opent of sluit niet normaal', impact: 'x', repairIssue: 'Scharnier werkt niet', repairRoute: 'direct', repairSeverity: 'heavy' },
              { label: 'Scharnier los', detail: 'Scharnier zit los of is deels losgekomen', impact: 'x', repairIssue: 'Scharnier los', repairRoute: 'direct', repairSeverity: 'heavy' },
              { label: 'Behuizing verbogen', detail: 'Behuizing is verbogen bij het scharnier', impact: 'x', repairIssue: 'Scharnier behuizing verbogen', repairRoute: 'direct', repairSeverity: 'heavy' },
              { label: 'Veiligheidsrisico', detail: 'Scharnier of behuizing vormt een veiligheidsrisico', impact: 'x', repairIssue: 'Scharnier veiligheidsrisico', repairRoute: 'reject', repairSeverity: 'reject' },
            ],
          },
        },
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

function areOtherComponentChoicesAllA(keuzes, componentId) {
  if (!keuzes) return false;
  return getGradingOnderdelen()
    .filter(ond => ond.id !== componentId)
    .every(ond => keuzes[ond.id] === 'A');
}

function resolveConditionalImpact(impact, componentId, keuzes) {
  if (impact === 'a-minus-if-all-other-a') {
    return areOtherComponentChoicesAllA(keuzes, componentId) ? 'a-minus' : 'b';
  }
  return impact;
}

function getChoiceProfile(componentId, letter, impactOverrides = {}, keuzes = null) {
  const rawImpact = impactOverrides[componentId] || (GRADING_IMPACTS[componentId] && GRADING_IMPACTS[componentId][letter]);
  const impact = resolveConditionalImpact(rawImpact, componentId, keuzes);
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

function normalizeRepairLabelType(value) {
  return Object.values(REPAIR_LABEL_TYPES).includes(value) ? value : REPAIR_LABEL_TYPES.direct;
}

function normalizeRepairSeverity(value, route = REPAIR_LABEL_TYPES.direct) {
  if (Object.values(REPAIR_SEVERITIES).includes(value)) return value;
  if (route === REPAIR_LABEL_TYPES.production) return REPAIR_SEVERITIES.light;
  if (route === REPAIR_LABEL_TYPES.reject) return REPAIR_SEVERITIES.reject;
  return REPAIR_SEVERITIES.heavy;
}

function inferRepairMetadata(issue, componentId = '') {
  const text = String(issue || '').toLowerCase();
  const component = String(componentId || '').toLowerCase();

  if (/niet herstelbaar|veiligheidsrisico|scherpe rand|sharp|safety/.test(text)) {
    return { repairRoute: REPAIR_LABEL_TYPES.reject, repairSeverity: REPAIR_SEVERITIES.reject };
  }

  if (/missing key|toets.*ontbreekt|meerdere toetsen|toets werkt niet|touchpad|usb|accu|battery|batterij|rechtmaken|uitdeuken|open\/verbogen|sluit niet goed/.test(text)) {
    return { repairRoute: REPAIR_LABEL_TYPES.production, repairSeverity: REPAIR_SEVERITIES.light };
  }

  if (/lcd|pixel|screen|scherm|beeld|flikker|flicker|cracked glass|geen beeld|scharnier|hinge|keyboard defect|keyboard ontbreekt/.test(text)
    || ['lcd', 'scharnieren'].includes(component)) {
    return { repairRoute: REPAIR_LABEL_TYPES.direct, repairSeverity: REPAIR_SEVERITIES.heavy };
  }

  if (/gebroken|broken|barst|breuk|cracked|ontbreekt|defect|faulty|werkt niet/.test(text)) {
    return { repairRoute: REPAIR_LABEL_TYPES.direct, repairSeverity: REPAIR_SEVERITIES.heavy };
  }

  return { repairRoute: REPAIR_LABEL_TYPES.direct, repairSeverity: REPAIR_SEVERITIES.heavy };
}

function createRepairAction(componentId, issue, options = {}) {
  if (!issue) return null;
  const inferred = inferRepairMetadata(issue, componentId);
  const route = normalizeRepairLabelType(options.repairRoute || inferred.repairRoute);
  const severity = normalizeRepairSeverity(options.repairSeverity || inferred.repairSeverity, route);
  return {
    componentId: componentId || '',
    triggerId: options.triggerId || '',
    issue: String(issue || '').trim(),
    repairRoute: route,
    repairSeverity: severity,
    afterRepairImpact: options.afterRepairImpact || 'a-plus',
  };
}

function getRepairActionForOption(componentId, option) {
  if (!option || !option.repairIssue) return null;
  return createRepairAction(componentId, option.repairIssue, option);
}

function dedupeRepairActions(actions) {
  const seen = new Set();
  return (actions || []).filter(action => {
    if (!action || !action.issue) return false;
    const key = `${action.componentId || ''}:${action.triggerId || ''}:${action.issue}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildTriggerRepairActions(triggers = {}) {
  const actions = [];
  for (const ond of getGradingOnderdelen()) {
    for (const trigger of (ond.triggers || [])) {
      if (triggers[trigger.id] && trigger.impact === 'defect') {
        actions.push(createRepairAction(ond.id, `${ond.naam}: ${trigger.label}`, {
          triggerId: trigger.id,
          repairRoute: ['keyboard', 'touchpad'].includes(ond.id) ? REPAIR_LABEL_TYPES.production : REPAIR_LABEL_TYPES.direct,
          repairSeverity: ['keyboard', 'touchpad'].includes(ond.id) ? REPAIR_SEVERITIES.light : REPAIR_SEVERITIES.heavy,
        }));
      }
    }
  }
  return dedupeRepairActions(actions);
}

function evaluateRepairPolicy(actions = []) {
  const repairActions = dedupeRepairActions(actions);
  const heavyCount = repairActions.filter(action => action.repairSeverity === REPAIR_SEVERITIES.heavy).length;
  const lightCount = repairActions.filter(action => action.repairSeverity === REPAIR_SEVERITIES.light).length;
  const hasReject = repairActions.some(action => action.repairSeverity === REPAIR_SEVERITIES.reject || action.repairRoute === REPAIR_LABEL_TYPES.reject);
  const total = repairActions.length;
  const remainsX = hasReject || heavyCount >= 2 || total > 2;
  const labelType = remainsX
    ? REPAIR_LABEL_TYPES.reject
    : heavyCount > 0
      ? REPAIR_LABEL_TYPES.direct
      : REPAIR_LABEL_TYPES.production;
  const reason = hasReject
    ? 'Niet herstelbaar of veiligheidsrisico'
    : heavyCount >= 2
      ? 'Te veel zware reparaties'
      : total > 2
        ? 'Te veel reparatiepunten'
        : labelType === REPAIR_LABEL_TYPES.production
          ? 'Tijdens productie repareren'
          : 'Direct repareren';

  return {
    actions: repairActions,
    heavyCount,
    lightCount,
    total,
    remainsX,
    labelType,
    reason,
  };
}

function buildPostRepairGradeInputs(keuzes = {}, triggers = {}, impactOverrides = {}, actions = []) {
  const fixedKeuzes = { ...keuzes };
  const fixedTriggers = { ...triggers };
  const fixedImpactOverrides = { ...impactOverrides };

  dedupeRepairActions(actions).forEach(action => {
    if (action.triggerId) delete fixedTriggers[action.triggerId];
    if (!action.componentId) return;
    const componentId = action.componentId;
    const choice = fixedKeuzes[componentId];
    const profile = choice ? getChoiceProfile(componentId, choice, fixedImpactOverrides, fixedKeuzes) : null;
    if (choice === 'D' || (profile && profile.minGrade === 'D')) {
      fixedKeuzes[componentId] = 'A';
      fixedImpactOverrides[componentId] = action.afterRepairImpact || 'a-plus';
    } else if (action.afterRepairImpact && choice) {
      fixedImpactOverrides[componentId] = action.afterRepairImpact;
    }
  });

  return {
    keuzes: fixedKeuzes,
    triggers: fixedTriggers,
    impactOverrides: fixedImpactOverrides,
  };
}

function calculateGradeAfterRepair(keuzes, triggers, impactOverrides, actions) {
  const fixed = buildPostRepairGradeInputs(keuzes, triggers, impactOverrides, actions);
  return calculateGrade(fixed.keuzes, fixed.triggers, fixed.impactOverrides);
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
    const profile = getChoiceProfile(ond.id, k, impactOverrides, keuzes);
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
      const profile = getChoiceProfile(ond.id, k, impactOverrides, keuzes);
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
      score += getChoiceProfile(ond.id, k, impactOverrides, keuzes).points;
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
    const profile = getChoiceProfile(ond.id, k, impactOverrides, keuzes);
    const punten = k ? profile.points : 0;
    return { naam: ond.naam, gewicht: ond.gewicht, keuze: k || '-', impact: k ? profile.label : '-', punten };
  });
}

function buildProblemRows(keuzes, triggers, impactOverrides = {}) {
  const problems = [];
  for (const ond of getGradingOnderdelen()) {
    const keuze = keuzes[ond.id];
    if (keuze && getChoiceProfile(ond.id, keuze, impactOverrides, keuzes).minGrade === 'D') problems.push(`${ond.naam}: repair / not sellable`);
    for (const t of (ond.triggers || [])) {
      if (triggers[t.id] && t.impact === 'defect') {
        problems.push(`${ond.naam}: ${t.label}`);
      }
    }
  }
  return problems;
}



