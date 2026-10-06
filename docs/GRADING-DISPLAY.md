# Gradingweergave

De knop met vier schermhoeken in de appbalk schakelt de hele app naar volledig
scherm. De stand blijft actief bij stapwisselingen, vervolgvragen, de beoordeling
en andere interne schermen. Dezelfde knop of Escape sluit fullscreen.
Na een echte paginaherlaad moet de gebruiker fullscreen opnieuw starten: browsers
vereisen hiervoor een gebruikersactie. Zie de
[Fullscreen API](https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen).

De begeleide inspectie meet de resterende viewport onder de appbalk en meldingen.
Foto's, beschrijvingen, schade-opties en navigatie delen die ruimte. De indeling
kiest tussen 2x2 en een rij van vier op basis van de ruimte voor de volledige
3:2-foto. Alle foto's behouden `object-fit: contain`; er wordt niet gecropt.
Er worden geen opslagverzoeken gedaan en fullscreen-wisselingen vervangen de
formulierinhoud niet.

Bij normale werkstations en tablets (viewport vanaf 700 px breed, 600 px hoog,
minstens 430 px resterende werkruimte) past de inspectie zonder paginascroll.
Op een telefoon, bij extreme browserzoom of veel open foutmeldingen blijft
toegankelijke reflow beschikbaar: inhoud wordt nooit verborgen om een kunstmatige
fit te claimen. Fullscreen helpt bij beperkte hoogte; blokkerende opslagproblemen
moeten opgelost worden voordat iemand operationele labels mag printen.

## Regressiecontrole

`npm test` test de fullscreen-acties, foutafhandeling, vertalingen en fotoregels.
De lokale browsercontrole gebruikt alleen synthetische Test Grading:

```powershell
node tools/record-qa-server.mjs
# Log lokaal in met het synthetische QA-account en start begeleide Test Grading.
Get-Content -Raw tests/browser/inspection-viewport.js |
  npx --yes agent-browser --session fullscreen-qa eval --stdin
```

De browsercheck bezoekt alle negen stappen, laadt alle 36 hoofdafbeeldingen,
controleert de volledige foto, afwezigheid van paginascroll, bereikbaarheid van
alle controles en behoud van fullscreen. Gecontroleerd op 1024x768, 1280x720,
1366x768, 1366x950, 1920x1080 en 820x1180, met aanvullende fullscreenchecks op
1024x768 en 1280x720. Ook een
vervolgvraag, Escape en behoud van handmatige invoer zijn afzonderlijk getest.
