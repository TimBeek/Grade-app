// UI-only photographic examples. Do not change scoring or persisted reason labels.
// Each missing reason has its own newly generated asset; existing examples win.
const GRADING_REASON_EXAMPLES = [
  ["bovenkap", "Bovenkap gebroken", "bovenkap-gebroken"],
  ["bovenkap", "Scherpe rand", "bovenkap-scherpe-rand"],
  ["bovenkap", "Sluit niet goed", "bovenkap-sluit-niet", false, "v3"],
  ["randen", "Zijkant gebroken", "randen-gebroken"],
  ["randen", "Scherpe rand", "randen-scherpe-rand"],
  ["randen", "Niet herstelbaar verbogen", "randen-onherstelbaar", false, "v3"],
  ["bezel", "Schermrand gebroken", "bezel-gebroken"],
  ["bezel", "Schermrand los", "bezel-los", false, "v3"],
  ["bezel", "Scherpe rand", "bezel-scherpe-rand"],
  ["lcd", "Pixel line", "lcd-pixellijn"],
  ["lcd", "Cracked screen", "lcd-gebarsten"],
  ["lcd", "Dead pixels", "lcd-dode-pixels"],
  ["lcd", "Schermflikkering", "lcd-flikkering", true],
  ["lcd", "Geen beeld", "lcd-geen-beeld", true],
  ["onderkant", "Onderkant gebroken", "onderkant-gebroken"],
  ["onderkant", "Onderdeel ontbreekt", "onderkant-onderdeel-ontbreekt"],
  ["onderkant", "Veiligheidsrisico", "onderkant-veiligheidsrisico"],
  ["keyboard", "Missing key", "keyboard-een-toets-ontbreekt"],
  ["keyboard", "Meerdere toetsen ontbreken", "keyboard-meerdere-toetsen-ontbreken"],
  ["keyboard", "Toets werkt niet", "keyboard-toets-test", true],
  ["keyboard", "Keyboard defect", "keyboard-functionele-test", true],
  ["keyboard", "Keyboard ontbreekt", "keyboard-ontbreekt"],
  ["palmrest", "Palmrest gebroken", "palmrest-gebroken"],
  ["palmrest", "Hoek ontbreekt", "palmrest-hoek-ontbreekt"],
  ["palmrest", "Veiligheidsrisico", "palmrest-veiligheidsrisico"],
  ["touchpad", "Touchpad werkt niet", "touchpad-functionele-test", true],
  ["touchpad", "Touchpad ontbreekt", "touchpad-ontbreekt"],
  ["touchpad", "Touchpad gebarsten", "touchpad-gebarsten"],
  ["scharnieren", "Scharnier werkt niet", "scharnier-blokkeert", true],
  ["scharnieren", "Scharnier los", "scharnier-los"],
  ["scharnieren", "Behuizing verbogen", "scharnier-behuizing-verbogen"],
  ["scharnieren", "Veiligheidsrisico", "scharnier-veiligheidsrisico"],
];
const GRADING_REASON_EXAMPLE_LOOKUP = new Map(GRADING_REASON_EXAMPLES.map(([component, label, name, functionalTest, version = 'v1']) => [
  component + ':' + label,
  Object.freeze({ image: 'assets/dell-grading-fast/' + name + '-' + version + '-ai.jpg', functionalTest: !!functionalTest }),
]));

// Deliberate UI-only close-up replacements; keep grading data and source photos intact.
const GRADING_REASON_IMAGE_REVISIONS = new Map([
  [
    "assets/dell-grading-fast/bovenkap-gebroken-v1-ai.jpg",
    "assets/dell-grading-fast/bovenkap-gebroken-v3-ai.jpg"
  ],
  [
    "assets/dell-grading-fast/bovenkap-scherpe-rand-v1-ai.jpg",
    "assets/dell-grading-fast/bovenkap-scherpe-rand-v3-ai.jpg"
  ],
  [
    "assets/dell-grading-fast/randen-gebroken-v1-ai.jpg",
    "assets/dell-grading-fast/randen-gebroken-v2-ai.jpg"
  ],
  [
    "assets/dell-grading-fast/randen-scherpe-rand-v1-ai.jpg",
    "assets/dell-grading-fast/randen-scherpe-rand-v3-ai.jpg"
  ],
  [
    "assets/dell-grading-fast/bezel-verkleuring-rand-dell-ai.jpg",
    "assets/dell-grading-fast/bezel-verkleuring-detail-v2-ai.jpg"
  ],
  [
    "assets/dell-grading-fast/bezel-haarscheurtje-b-dell-ai.jpg",
    "assets/dell-grading-fast/bezel-haarscheur-detail-v2-ai.jpg"
  ],
  [
    "assets/dell-grading-fast/bezel-haarscheurtje-c-dell-ai.jpg",
    "assets/dell-grading-fast/bezel-haarscheur-detail-v2-ai.jpg"
  ],
  [
    "assets/dell-grading-fast/bezel-zwaar-gebroken-dell-ai.jpg",
    "assets/dell-grading-fast/bezel-zwaar-gebroken-detail-v2-ai.jpg"
  ],
  [
    "assets/dell-grading-fast/bezel-gebroken-v1-ai.jpg",
    "assets/dell-grading-fast/bezel-gebroken-v2-ai.jpg"
  ],
  [
    "assets/dell-grading-fast/bezel-scherpe-rand-v1-ai.jpg",
    "assets/dell-grading-fast/bezel-scherpe-rand-v3-ai.jpg"
  ],
  [
    "assets/dell-grading-fast/lcd-dode-pixels-v1-ai.jpg",
    "assets/dell-grading-fast/lcd-dode-pixels-v2-ai.jpg"
  ],
  [
    "assets/dell-grading-fast/onderkant-gebroken-v1-ai.jpg",
    "assets/dell-grading-fast/onderkant-gebroken-v2-ai.jpg"
  ],
  [
    "assets/dell-grading-fast/onderkant-veiligheidsrisico-v1-ai.jpg",
    "assets/dell-grading-fast/onderkant-veiligheidsrisico-v2-ai.jpg"
  ],
  [
    "assets/dell-grading-fast/keyboard-een-toets-ontbreekt-v1-ai.jpg",
    "assets/dell-grading-fast/keyboard-een-toets-ontbreekt-v2-ai.jpg"
  ],
  [
    "assets/dell-grading-fast/palmrest-gebroken-v1-ai.jpg",
    "assets/dell-grading-fast/palmrest-gebroken-v2-ai.jpg"
  ],
  [
    "assets/dell-grading-fast/palmrest-veiligheidsrisico-v1-ai.jpg",
    "assets/dell-grading-fast/palmrest-veiligheidsrisico-v3-ai.jpg"
  ],
  [
    "assets/dell-grading-fast/touchpad-gebarsten-v1-ai.jpg",
    "assets/dell-grading-fast/touchpad-gebarsten-v2-ai.jpg"
  ],
  [
    "assets/dell-grading-fast/scharnier-blokkeert-v1-ai.jpg",
    "assets/dell-grading-fast/scharnier-blokkeert-v2-ai.jpg"
  ],
  [
    "assets/dell-grading-fast/scharnier-los-v1-ai.jpg",
    "assets/dell-grading-fast/scharnier-los-v2-ai.jpg"
  ],
  [
    "assets/dell-grading-fast/scharnier-behuizing-verbogen-v1-ai.jpg",
    "assets/dell-grading-fast/scharnier-behuizing-verbogen-v2-ai.jpg"
  ],
  [
    "assets/dell-grading-fast/scharnier-veiligheidsrisico-v1-ai.jpg",
    "assets/dell-grading-fast/scharnier-veiligheidsrisico-v2-ai.jpg"
  ],
  ["assets/dell-grading-fast/randen-onherstelbaar-v3-ai.jpg", "assets/dell-grading-fast/randen-onherstelbaar-v4-ai.jpg"],
  ["assets/dell-grading-fast/bezel-los-v3-ai.jpg", "assets/dell-grading-fast/bezel-los-v4-ai.jpg"],
  ["assets/dell-grading-fast/bovenkap-sluit-niet-v3-ai.jpg", "assets/dell-grading-fast/bovenkap-sluit-niet-v4-ai.jpg"],
  ["assets/dell-grading-fast/randen-open-verbogen-herstelbaar-v3-ai.jpg", "assets/dell-grading-fast/randen-open-verbogen-herstelbaar-v4-ai.jpg"],
  ["assets/dell-grading-fast/randen-open-verbogen-niet-herstelbaar-dell-ai.jpg", "assets/dell-grading-fast/randen-open-verbogen-c-detail-v3-ai.jpg"]
]);

function withGradingExampleImages(decision) {
  if (!decision || decision.type === 'grade-review') return decision;
  return { ...decision, options: decision.options.map(option => {
    const example = GRADING_REASON_EXAMPLE_LOOKUP.get(decision.componentId + ':' + option.label);
    const image = option.image || (example && example.image);
    if (!image) return option;
    const revision = GRADING_REASON_IMAGE_REVISIONS.get(image);
    if (option.image && !revision) return option;
    return { ...option, image: revision || image, exampleFunctionalTest: !!(example && example.functionalTest) };
  }) };
}
