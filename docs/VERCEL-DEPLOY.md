# Vercel deployment + database (Vercel KV / Upstash Redis)

De ReMarkt Grading App draait op Vercel als **statische app + serverless API**,
met **Vercel KV (Upstash Redis)** als gedeelde database. Dit vervangt de oude
lokale bestand-server (`tools/remarkt-static-server.mjs`) voor productie. De
lokale server blijft beschikbaar voor offline development.

## Architectuur

```
Browser (assets/*.js)
   │  GET/POST /api/demo-state   (gzip envelope {gzip:"…base64…"})
   │  GET      /api/stats        (dashboard KPIs uit DB)
   │  GET      /api/health
   ▼
Vercel serverless functions (api/*.mjs)
   │  merge + normaliseer  (api/_lib/state-core.mjs)
   │  gzip + chunked opslag (api/_lib/state.mjs)
   ▼
Vercel KV / Upstash Redis   →  key "remarkt:state:*"
```

- De volledige state (~6,5 MB JSON) comprimeert tot **±0,4 MB**. Die past in één
  KV-waarde en ruim binnen Vercel's ~4,5 MB body-limiet. Groeit de data, dan
  splitst `state.mjs` automatisch in chunks (`remarkt:state:0`, `:1`, …).
- De merge-logica is identiek aan de oude server, dus gedrag verandert niet.

## Eenmalige setup

### 1. Repo naar GitHub
Commit en push deze repo naar GitHub (of GitLab/Bitbucket).

### 2. Project importeren in Vercel
1. Vercel dashboard → **Add New… → Project** → kies de repo.
2. Framework preset: **Other** (geen build step nodig).
3. Build command: leeg laten. Output directory: leeg laten (root wordt statisch
   geserveerd). Install command: `npm install` (standaard).
4. Deploy.

### 3. Database koppelen (Vercel KV / Upstash)
1. In het project: **Storage → Create Database → KV (Upstash Redis)** (of via
   **Marketplace → Upstash**).
2. Koppel de store aan dit project. Vercel zet dan automatisch de env vars
   (`KV_REST_API_URL`, `KV_REST_API_TOKEN`, en/of `UPSTASH_REDIS_REST_URL/TOKEN`).
3. **Redeploy** zodat de functions de nieuwe env vars krijgen.

### 4. Bestaande data migreren
Importeer de huidige `data/remarkt-demo-state.json` éénmalig in KV:

```bash
npm install
cp .env.example .env.local      # vul KV_REST_API_URL + KV_REST_API_TOKEN in
npm run migrate:kv              # merge in bestaande KV-data (veilig her-uitvoerbaar)
# of: node scripts/migrate-to-kv.mjs --fresh   (overschrijft met alleen file-data)
```

De credentials haal je uit Vercel (**Storage → je KV store → .env tab**) of de
Upstash console.

### 5. Verifiëren
- `https://<app>.vercel.app/` → de app laadt.
- `https://<app>.vercel.app/api/health` → `{ ok: true, counts: { history: …, … } }`.
- `https://<app>.vercel.app/api/stats` → KPIs.
- Open het dashboard (Analytics). Bovenin verschijnt de strip **“Live uit
  database”** met de servercijfers.

## Lokaal ontwikkelen

```bash
npm run dev        # start tools/remarkt-static-server.mjs op http://127.0.0.1:8080
```

De lokale server gebruikt nog steeds `data/remarkt-demo-state.json` en spreekt
exact hetzelfde API-contract (gzip envelope + `/api/stats`), zodat de front-end
identiek werkt online en offline.

> Optioneel: met `vercel dev` kun je de echte serverless functions + KV lokaal
> draaien (vereist de Vercel CLI en gekoppelde env vars).

## Belangrijke aandachtspunten

- **Secrets**: `.env` / `.env.local` staan in `.gitignore`. Commit nooit KV-tokens.
- **Concurrency**: net als de oude server doet de API read-merge-write. Bij zeer
  intensief gelijktijdig schrijven door meerdere medewerkers kan een schrijf­actie
  een andere overschrijven. De merge dedupliceert op key, dus verlies is beperkt
  tot gelijktijdige wijzigingen aan exact dezelfde rij. Voor zwaardere garanties
  is een echte transactionele DB de volgende stap.
- **Groei**: bij ~10x meer history splitst de opslag automatisch in meerdere
  chunks; geen actie nodig.
