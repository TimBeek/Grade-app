# Codebase structuur

Deze app draait als standalone browserapp met losse scripts in een vaste laadvolgorde. De huidige structuur is bewust eenvoudig gehouden, omdat de app zonder bundler snel live gezet kan worden en omdat de tests dezelfde volgorde als productie gebruiken.

## Entrypoint

`remarkt-grading-app.html` is de enige HTML-shell. Dit bestand laadt de CSS, maakt de app-root aan en laadt daarna alle scripts in productievolgorde.

Belangrijk: wijzig de scriptvolgorde alleen als je ook de smoke-test bijwerkt. De modules delen nu bewust globale functies en state.

## Browsermodules

1. `assets/grading-engine.js`
   UI-vrije gradinglogica voor laptopkeuzes, impactprofielen, triggers, grensgevallen en eindgradeberekening.

2. `assets/app-state.js`
   Centrale state, demo-users, sessievoorkeuren, indexes, monitor-database matching, lokale backup, gedeelde demo-state en algemene teksthulpen.

3. `assets/i18n.js`
   Vertaalfunctie voor vaste UI-copy. Productdata, merknamen, modelnamen en poortnamen mogen hier niet vertaald worden.

4. `assets/import-workflow.js`
   Excel/CSV import, leveranciersnormalisatie, productclassificatie, batchopbouw en importvoortgang.

5. `assets/analytics-history.js`
   Dashboardstatistieken, supplier comparison, historie, zoeken, paginering en CSV-export.

6. `assets/label-printing.js`
   DYMO/browser-labels voor laptops en monitoren, inclusief fallback printvensters.

7. `assets/ui-rendering.js`
   Alle schermmarkup, dashboards, modals, workflowbanners, gradingviews en herbruikbare renderhelpers.

8. `assets/app-workflow.js`
   Eventdelegatie, navigatie, scanning, handmatige invoer, accountmutaties, gradingflow, opslaan en print-acties.

9. `assets/remarkt-grading.js`
   Bootstrap. Laadt gedeelde demo-state, bouwt indexes op, koppelt listeners en rendert de eerste view.

## Data en assets

- `assets/monitor-port-database.json` is de monitor-poortdatabase en wordt door `app-state.js` ingelezen.
- `data/remarkt-demo-state.json` is demo-opslag voor de lokale server. Dit is geen definitieve productiedatabase.
- `assets/dell-grading-fast/` bevat de actieve laptop-gradingbeelden.
- `assets/workflow-*.png` bevat actieve workflowbanners.
- `assets/monitor-port-*-clean-ai.png` bevat actieve monitorpoortbeelden zonder achtergrond.
- `assets/xlsx.full.min.js` en `assets/dymo.connect.framework.js` zijn vendorbestanden en worden dynamisch gebruikt.

## Modulegrenzen

- Renderfuncties bouwen markup en lezen state; businessregels horen in `grading-engine.js` of `app-state.js`.
- Mutaties van state horen in `app-workflow.js` of duidelijke statehelpers in `app-state.js`.
- Importnormalisatie hoort in `import-workflow.js`.
- Printlogica hoort in `label-printing.js`.
- Analytics en historie horen in `analytics-history.js`.

Houd deze grenzen aan om te voorkomen dat nieuwe workflowlogica verspreid raakt over renderbestanden.

## Veilige verwijderregels

Verwijder bestanden alleen als aan alle punten is voldaan:

- Geen directe referentie in `remarkt-grading-app.html`, `assets/`, `tests/`, `docs/` of `tools/`.
- Geen berekende padreferentie vanuit `VISUAL_ASSETS`, workflowbanners, monitorpoorthelpers of printtemplates.
- Smoke-tests blijven groen.
- Het bestand staat niet in een live data- of vendorpad.

Niet committen:

- `logs/`
- `screenshots/`
- `test-results/`
- `tmp/`
- `data/backups/`
- losse `.log` en `.tmp` bestanden

## Productierichting

Voor dagelijks commercieel gebruik blijft de belangrijkste technische stap een echte backend met database. De huidige demo-server schrijft state atomisch weg en bewaart backups, maar is geen vervanging voor transacties, server-side rollen en conflictcontrole bij meerdere medewerkers.
