// POST/GET /api/photo-log
// Testlog voor het foto-grading experiment: bewaart per laptop de AI-suggestie
// vs. de menselijke eindkeuze, zodat we de nauwkeurigheid kunnen meten en een
// trainingsset opbouwen.
//
// ISOLATIE: schrijft naar een EIGEN Redis-sleutel (pg:log) en raakt de
// productie-state (remarkt:state) niet aan. Hergebruikt alleen de Redis-client.

import { getRedis, isKvConfigured } from "./_lib/state.mjs";

const LOG_KEY = "pg:log";
const MAX_ENTRIES = 2000; // ringbuffer; oudste vallen eraf

function parseEntry(v) {
  if (v && typeof v === "object") return v; // Upstash heeft al geparsed
  if (typeof v === "string") {
    try { return JSON.parse(v); } catch { return null; }
  }
  return null;
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");

  if (!isKvConfigured()) {
    response.status(503).json({
      ok: false,
      error: "KV/Upstash niet geconfigureerd (KV_REST_API_URL / KV_REST_API_TOKEN ontbreken).",
    });
    return;
  }
  const redis = getRedis();

  // --- Overzicht ophalen ----------------------------------------------------
  if (request.method === "GET") {
    try {
      const raw = await redis.lrange(LOG_KEY, 0, 199); // laatste ~200
      const entries = raw.map(parseEntry).filter(Boolean);
      const total = entries.length;
      const akkoord = entries.filter((e) => e.ai_grade && e.ai_grade === e.mens_grade).length;
      response.status(200).json({
        ok: true,
        total,
        grade_akkoord: akkoord,
        grade_akkoord_pct: total ? Math.round((akkoord / total) * 100) : 0,
        entries: entries.slice(0, 50),
      });
    } catch (error) {
      response.status(500).json({ ok: false, error: String((error && error.message) || error) });
    }
    return;
  }

  // --- Entry opslaan --------------------------------------------------------
  if (request.method === "POST") {
    let body = request.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { body = null; }
    }
    if (!body || !Array.isArray(body.onderdelen)) {
      response.status(400).json({ ok: false, error: "Ongeldige payload (veld 'onderdelen' ontbreekt)." });
      return;
    }
    const entry = {
      ts: new Date().toISOString(),
      note: typeof body.note === "string" ? body.note.slice(0, 200) : "",
      ai_grade: body.ai_grade || null,
      mens_grade: body.mens_grade || null,
      onderdelen: body.onderdelen.slice(0, 20),
    };
    try {
      await redis.lpush(LOG_KEY, entry);
      await redis.ltrim(LOG_KEY, 0, MAX_ENTRIES - 1);
      response.status(200).json({ ok: true });
    } catch (error) {
      response.status(500).json({ ok: false, error: String((error && error.message) || error) });
    }
    return;
  }

  response.status(405).json({ ok: false, error: "Method not allowed. Gebruik GET of POST." });
}
