# Live Runbook

Wanneer gevraagd wordt om de Grade app live te zetten, altijd eerst deze checks draaien.

1. Volledige testset:
   ```powershell
   node --test tests\grading-engine-smoke.test.js
   ```

2. Syntaxchecks:
   ```powershell
   node --check assets\app-state.js
   node --check assets\app-workflow.js
   node --check assets\ui-rendering.js
   node --check assets\label-printing.js
   node --check assets\analytics-history.js
   node --check tools\remarkt-static-server.mjs
   node --check api\_lib\state-core.mjs
   node --check api\_lib\state.mjs
   node --check api\demo-state.mjs
   node --check api\health.mjs
   node --check api\stats.mjs
   ```
   (kortweg: `npm run check`)

3a. Lokaal/tunnel (oude route), alleen als alles groen is:
   - lokale server starten/herstarten op `http://127.0.0.1:8080`
   - `/api/health` controleren
   - Cloudflare tunnel starten
   - publieke tunnel-URL controleren op app HTML en `/api/health`

3b. Vercel + KV (productie), zie `docs/VERCEL-DEPLOY.md`:
   - pushen naar GitHub → Vercel deployt automatisch
   - KV store gekoppeld + env vars aanwezig
   - éénmalig data migreren: `npm run migrate:kv`
   - controleer `/api/health` en `/api/stats` op de Vercel-URL
   - controleer de dashboard-strip “Live uit database”

Als een test of check faalt, de app niet live zetten voordat de oorzaak is opgelost of expliciet is afgestemd.
