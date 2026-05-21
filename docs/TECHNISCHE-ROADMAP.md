# Technische roadmap

Deze app is gestart als snelle standalone demo. De app is nu opgesplitst in duidelijke browsermodules: HTML-shell, CSS, state/opslag, grading-engine, importverwerking, analyse/historie, labelprinten, UI-rendering, workflow-events en bootstrap.

## Huidige structuur

- `remarkt-grading-app.html`
  Kleine HTML-shell met app-root en verwijzingen naar CSS/JS.

- `assets/remarkt-grading.css`
  Alle styling, layout, responsive regels en component-classes.

- `assets/remarkt-grading.js`
  Bootstrapbestand. Start de app, laadt gedeelde demo-state, bouwt indexen op en rendert de eerste view.

- `assets/app-state.js`
  App-state, demo-users, batches, indexes, gedeelde demo-opslag, auditlog en basishulpen.

- `assets/grading-engine.js`
  UI-vrije gradinglogica: onderdelen, scoreprofielen, keuze-beslissingen, triggers en eindgradeberekening.

- `assets/import-workflow.js`
  Excel/CSV parsing, leveranciersnormalisatie, batchopbouw en importvoortgang.

- `assets/analytics-history.js`
  Analyse-dashboard, historiezoekfunctie, paginering en historie-detailweergave.

- `assets/label-printing.js`
  Specslabels, probleemlabels en printvensters.

- `assets/ui-rendering.js`
  Schermen, dashboards, gradingweergave, accountbeheer-view en herbruikbare UI-renderhelpers.

- `assets/app-workflow.js`
  Eventdelegatie, navigatie-acties, accountmutaties, gradingflow, testflow en opslaan van gradings.

- `tools/remarkt-static-server.mjs`
  Lokale server voor statische bestanden, gedeelde demo-state, atomische state-opslag, beperkte backups en `/api/health`.

- `tests/grading-engine-smoke.test.js`
  Smoke-tests voor gradinglogica, dashboardindeling, importnormalisatie, labels, volledige expert-workflow, grading-test zonder voorraadmutatie en basisvalidatie.

## Volgende technische stap

De browsermodule-opsplitsing is afgerond voor deze fase. De volgende technische stap is het vervangen van de demo-state door echte backendrecords.

## Backend-stap

Voor commercieel gebruik moet `/api/demo-state` worden vervangen door echte endpoints:

- `GET /api/session`
- `POST /api/login`
- `GET /api/batches`
- `POST /api/imports`
- `GET /api/laptops/open`
- `POST /api/gradings`
- `GET /api/gradings`
- `GET /api/analytics`
- `GET/POST /api/users`

Belangrijk: gradingresultaten moeten als losse records worden opgeslagen. Niet meer als een volledig state-bestand waarin de laatste save alles overschrijft.

De huidige demo-server schrijft state al atomisch weg en bewaart korte backups, maar blijft bedoeld als demo-opslag. Voor productie moet dit alsnog naar een database met echte transacties.

## Productie-eisen

- Server-side rollen en wachtwoorden/SSO.
- Per actie auditlogging.
- Conflictpreventie bij meerdere gebruikers.
- Database-indexen op sticker, batch, medewerker, datum en grade.
- E2E-tests voor scan -> grading -> label -> historie. De smoke-test dekt nu al de volledige expert-workflow en grading-test zonder voorraadmutatie.
- Export naar CSV/Excel vanuit analyse.
