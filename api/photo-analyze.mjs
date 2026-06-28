// POST /api/photo-analyze
// Experimentele foto-grading: ontvangt foto's + de onderdelen-spec (uit de
// grading-engine, door de front-end meegestuurd) en laat Claude-vision per
// onderdeel een conditieletter (A-D) en zichtbare triggers bepalen.
//
// LET OP: dit endpoint staat volledig los van de productie-grading. Het wijzigt
// niets aan de bestaande app of opslag. De API-key (ANTHROPIC_API_KEY) wordt
// alleen hier server-side gebruikt en komt nooit in de browser.

import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-opus-4-8";
const MAX_IMAGES = 8;

// --- Systeemprompt: rol + regels voor de visuele beoordeling ---------------
const SYSTEM_PROMPT = `Je bent een ervaren keurmeester die refurbished laptops VISUEEL beoordeelt voor ReMarkt.

Je krijgt enkele foto's van één laptop en een lijst onderdelen. Per onderdeel kies je:
- de conditieletter A, B, C of D die het best past bij wat je ZIET (gebruik exact de meegegeven titel/detail per letter);
- welke specifieke "triggers" (zichtbare defecten) van toepassing zijn.

Strikte regels:
1. Beoordeel ALLEEN wat zichtbaar is op de foto's. Verzin niets.
2. FUNCTIONELE defecten (toets werkt niet, touchpad werkt niet, scharnier werkt niet, flikker)
   kun je op een foto meestal NIET vaststellen. Markeer die alleen als ze echt zichtbaar zijn,
   en zet anders een lage zekerheid.
3. Scherm-aan-defecten (keyinprint, whitespot, backlight bleeding) beoordeel je alleen op
   foto's waarop het scherm aan staat.
4. Twijfel je of zie je het onderdeel niet goed? Kies de meest waarschijnlijke letter maar geef
   een lage zekerheid (zekerheid < 0.5).
5. Wees streng maar eerlijk: een lichte kras is B, geen A.

Antwoord met UITSLUITEND een geldig JSON-object, zonder uitleg eromheen, in dit formaat:
{"assessments":[{"onderdeel_id":"...","letter":"A","triggers":["..."],"zekerheid":0.0,"onderbouwing":"korte uitleg"}]}
Geef voor ELK meegegeven onderdeel precies één assessment. "triggers" is een lijst van trigger-id's
(mag leeg zijn). "zekerheid" is een getal tussen 0 en 1.`;

function buildSpecText(spec) {
  const lines = spec.map((o) => {
    const keuzes = o.keuzes
      .map((k) => `    ${k.letter} = ${k.titel}${k.detail ? ` (${k.detail})` : ""}`)
      .join("\n");
    const triggers = (o.triggers || []).length
      ? o.triggers.map((t) => `    ${t.id} = ${t.label}`).join("\n")
      : "    (geen)";
    return `Onderdeel "${o.naam}" (id: ${o.id})\n  Hint: ${o.hint || "-"}\n  Letters:\n${keuzes}\n  Triggers:\n${triggers}`;
  });
  return lines.join("\n\n");
}

// Tolerant JSON uit de modeltekst halen (eerste { t/m laatste }).
function extractJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

// Valideer de modeloutput tegen de spec: alleen geldige letters/triggers.
function sanitize(raw, spec) {
  const byId = new Map(spec.map((o) => [o.id, o]));
  const out = [];
  const seen = new Set();
  for (const a of (raw && Array.isArray(raw.assessments) ? raw.assessments : [])) {
    const ond = byId.get(a && a.onderdeel_id);
    if (!ond || seen.has(ond.id)) continue;
    seen.add(ond.id);
    const validLetters = new Set(ond.keuzes.map((k) => k.letter));
    const letter = validLetters.has(a.letter) ? a.letter : null;
    const validTriggers = new Set((ond.triggers || []).map((t) => t.id));
    const triggers = Array.isArray(a.triggers)
      ? a.triggers.filter((t) => validTriggers.has(t))
      : [];
    let zekerheid = Number(a.zekerheid);
    if (!Number.isFinite(zekerheid)) zekerheid = 0;
    zekerheid = Math.max(0, Math.min(1, zekerheid));
    out.push({
      onderdeel_id: ond.id,
      letter,
      triggers,
      zekerheid,
      onderbouwing: typeof a.onderbouwing === "string" ? a.onderbouwing.slice(0, 400) : "",
    });
  }
  // Onderdelen die het model oversloeg: lege placeholder zodat de UI compleet is.
  for (const o of spec) {
    if (!seen.has(o.id)) {
      out.push({ onderdeel_id: o.id, letter: null, triggers: [], zekerheid: 0, onderbouwing: "Niet beoordeeld door AI." });
    }
  }
  return out;
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");

  if (request.method !== "POST") {
    response.status(405).json({ ok: false, error: "Method not allowed. Use POST." });
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    response.status(503).json({
      ok: false,
      error: "ANTHROPIC_API_KEY niet ingesteld. Zet deze in Vercel (Settings -> Environment Variables) of in .env.local.",
    });
    return;
  }

  let body = request.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  const images = body && Array.isArray(body.images) ? body.images : [];
  const spec = body && Array.isArray(body.spec) ? body.spec : [];

  if (!images.length) {
    response.status(400).json({ ok: false, error: "Geen foto's ontvangen (veld 'images')." });
    return;
  }
  if (!spec.length) {
    response.status(400).json({ ok: false, error: "Geen onderdelen-spec ontvangen (veld 'spec')." });
    return;
  }
  if (images.length > MAX_IMAGES) {
    response.status(400).json({ ok: false, error: `Te veel foto's (max ${MAX_IMAGES}).` });
    return;
  }

  // Bouw de user-content: instructie + spec, daarna elke foto met een label.
  const content = [
    {
      type: "text",
      text:
        `Beoordeel deze laptop visueel. Hieronder de onderdelen met hun letters en triggers.\n\n` +
        buildSpecText(spec) +
        `\n\nHierna volgen ${images.length} foto's. Geef je antwoord als JSON volgens het afgesproken formaat.`,
    },
  ];
  for (let i = 0; i < images.length; i++) {
    const img = images[i] || {};
    content.push({ type: "text", text: `Foto ${i + 1}${img.label ? ` — ${img.label}` : ""}:` });
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: img.media_type || "image/jpeg",
        data: String(img.data || ""),
      },
    });
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
    });

    const text = (message.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    const raw = extractJson(text);
    if (!raw) {
      response.status(502).json({ ok: false, error: "AI gaf geen geldige JSON terug.", rawText: text.slice(0, 1000) });
      return;
    }

    const assessments = sanitize(raw, spec);
    response.status(200).json({
      ok: true,
      model: message.model || MODEL,
      assessments,
      usage: message.usage || null,
    });
  } catch (error) {
    const status = error && error.status ? error.status : 500;
    response.status(status >= 400 && status < 600 ? status : 500).json({
      ok: false,
      error: String((error && error.message) || error),
    });
  }
}
