# Begeleid graden: waarnemen vóór beoordelen

Datum: 3 oktober 2026. Implementatie en lokale QA afgerond.
De actuele publicatiestatus is te controleren in GitHub en Vercel.

## Werking

De negen bestaande onderdelen blijven behouden. Per onderdeel staan de fysieke
controlepunten boven de voorbeeldfoto's. De medewerker kiest een waarneming,
niet een zichtbare gradeletter. De bestaande rekenregels bepalen het resultaat.
Een volledig schone laptop vraagt negen hoofdkeuzes plus een bevestiging van
schoonmaak en touch. Detailvragen verschijnen bij afwijkingen. Dit is geen
bewijs dat de fysieke beoordeling even lang duurt.

- Bovenkap: een verplichte popup vraagt eerst of deze schoon is. Stof en
  verwijderbare stickerresten zijn geen schade. Na de melding
  dat schoonmaak nodig is, worden fotokeuzes en sneltoetsen geblokkeerd. Na
  schoonmaak moet opnieuw worden beoordeeld; A wordt nooit automatisch toegekend.
- Touch: een popup bij LCD toont de informatie uit de leverancierslijst (of
  eerlijk "niet opgegeven") en vraagt om controle van het werkelijke apparaat.
  De schakelaar is vooraf ingevuld uit de lijst, Surface-modelherkenning of een
  eerder gecontroleerde correctie. De oorspronkelijke lijst blijft zichtbaar.
  Schakelen wijzigt alleen de keuze in het concept; 'Gecontroleerd, verder'
  bevestigt die pas. Bij ontbrekende informatie blijft de status expliciet onbekend
  en moet de medewerker de voorselectie fysiek controleren.
  Een defecte touchfunctie mag niet met "geen touch" worden weggeboekt.
- Twijfel: overige onderdelen kunnen verder worden bekeken. Aan het einde
  verschijnt een prominente coordinator-/managerpopup. Printen wordt geblokkeerd
  totdat een nieuwe waarneming de twijfel oplost. De app controleert niet of
  dat overleg daadwerkelijk heeft plaatsgevonden.
- Meerdere defecten: reparatiepunten blijven afzonderlijk zichtbaar en zijn
  bewust te verwijderen. Een andere slijtagekeuze wist ze niet stilzwijgend.
- Gebarsten LCD en functionele defecten gebruiken hun expliciete reparatieroute.
- Een reparatie mag onafhankelijke slijtage niet verwijderen uit de berekening.
  De regelversie is daarom aangepast; bestaande historie wordt niet herberekend.
- Concepten zijn klein, lokaal en per gebruiker/apparaat opgeslagen. Selecteer
  hetzelfde apparaat en start begeleid graden om verder te gaan. Dit is geen
  cloudbackup of gedeelde managerwachtrij. Een browser die lokale opslag weigert
  kan geen concept bewaren.

De bestaande grensgevalcontrole rond A en de commerciële schadegrenzen zijn niet
vervangen door nieuwe normen. Foto's blijven voorbeelden; echte beschadigingen
moeten fysiek worden gecontroleerd. De interface kan dat niet zelf vaststellen.

## Ontwerp en onderbouwing

Dit is een uitbreiding binnen de bestaande ReMarkt-stijl: rood accent,
neutrale oppervlakken, bestaande typografie, gecentreerde foto's op wit, bestaande
licht/donker- en contrastkeuze. De titel en apparaatnaam staan op een regel;
de stapteller staat naast de negen stappen. Brede, korte desktopschermen tonen
vier voorbeelden op een rij; hogere desktops gebruiken twee bij twee.
Op mobiel staan de foto's onder elkaar met normale verticale scroll.
Detailvragen openen als herkenbare popup boven de hoofdfoto's, met onderdeel,
stapnummer en de eerder gekozen details bij een geneste vraag. Teruggaan annuleert
de onvoltooide keuze; zo wordt deze niet als gecontroleerd opgeslagen.
Productnamen blijven onvertaald.

Schade-aanwijzingen staan bij de passende foto, niet in een aparte schadebalk.
De gekozen foto behoudt de echte belichting; andere foto's krijgen een lichte
grijze waas, die verdwijnt bij hover of toetsenbordfocus. Er wordt geen
contrastverhoging toegepast die echte krassen zou kunnen wegpoetsen.

Een oranje informatie-icoon toont lichte leverancierswaarnemingen bij een
passend voorbeeld; bijvoorbeeld lichte krassen of algemene gebruikssporen.
Ernstige meldingen krijgen een verplicht te lezen popup en een rood icoon.
Ook een kleine haarscheur blijft een belangrijke melding. Onbekende ernst
blijft bij Controlepunten. Algemene behuizingsmeldingen verschijnen bij de
eerste behuizingscontrole, niet nog eens op alle andere onderdelen. Meldingen
met een benoemde locatie verschijnen uitsluitend bij die locatie: schermrand
niet bij LCD, toetsafdruk op het scherm niet bij het toetsenbord, bovenkaphoek
niet ook bij de algemene randen. Originele meldingen zijn daarnaast in het
uitklapbare overzicht aanwezig. Advies selecteert niets en verandert geen score.

De resultaatpagina toont grade/status, reparatieroute, werkelijk geregistreerde
schade per onderdeel en de redenen in één gecentreerd rapport. Alle negen
onderdelen staan in dezelfde tabel. Geneste schermkeuzes bewaren zowel het type
schade als de omvang. De extra labelknoppen, preview en puntentabel staan samen
onder 'Labels en berekening'; aanpassen en bevestigen zijn de hoofdacties.
Bij directe reparatie verschijnt geen voorspelde
definitieve grade. Bij een expertbeoordeling zonder negen onderdeelkeuzes wordt
niet beweerd dat alle negen onderdelen afzonderlijk zijn gecontroleerd.

Korte instructies vlak bij de handeling sluiten aan bij
[W3C: duidelijke stapsgewijze instructies](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o4p07-step-instructions/).
Alleen noodzakelijke stappen verplicht maken sluit aan bij
[W3C: korte kritieke routes](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o5p02-short-paths/).
Het ontwerp behandelt gemiste punten als een procesprobleem, niet uitsluitend
als een trainingsprobleem; zie
[HSE: menselijke fouten](https://www.hse.gov.uk/humanfactors/topics/humanfail.htm).
Dit zijn ontwerpprincipes, geen bewijs van een specifiek foutreductiepercentage
voor laptopgrading en geen volledige WCAG-conformiteitsverklaring.

## Verificatie

- 167 automatische tests geslaagd, waaronder schoonmaak, twijfel, detailvragen,
  reparaties, concepten, bestaande monitorroutes, labels en opslag.
- 83 workflow-browserasserties per run: alle negen stappen, geladen foto's,
  dubbelklikbeveiliging, geneste vragen, focus, schoonmaak, touch, twijfel en de
  test-only A-route.
- Aanvullende layout-/resultaat-QA: 66 asserties op 1366x768 en 1440x1000;
  57 asserties op 390x844, inclusief leveranciersadvies, vervolgpopup,
  annuleren en detailfoto vergroten. Alle negen hoofdfotokeuzes en actieknoppen passen op
  de twee geteste desktopformaten. Mobiel scrollt; zoom en extra details mogen
  bewust meer ruimte vragen. Dit is geen garantie voor elke schermhoogte of zoom.
- Visueel gecontroleerd op desktop en mobiel, inclusief licht en donker.
- Backend syntaxcheck en Git whitespacecheck geslaagd.
- Browser-QA gebruikte uitsluitend synthetische testapparaten op een lokale
  server die alle API-verzoeken weigert. Geen operationele gegevens gewijzigd
  en geen echte labels geprint.

Herhaalbare lokale QA:

```powershell
node tools/guided-inspection-preview.mjs
# In een tweede terminal:
npx --yes agent-browser --session grading-qa open http://127.0.0.1:8092
Get-Content -Raw -Encoding utf8 tools/verify-guided-inspection.js | npx --yes agent-browser --session grading-qa eval --stdin
Get-Content -Raw -Encoding utf8 tools/verify-guided-layout.js | npx --yes agent-browser --session grading-qa eval --stdin
npx --yes agent-browser --session grading-qa close
```

## Praktijkacceptatie vóór brede uitrol

Laat meerdere medewerkers dezelfde gevarieerde laptops onafhankelijk beoordelen;
vergelijk met een vooraf vastgelegde managerbeoordeling. Neem schone, vuile,
beschadigde en grensgevallen op. Meet gemiste defecten, te strenge grades,
overeenstemming en mediane/p90 beoordelingstijd. Houd schoonmaaktijd apart.
Een kleine pilot is verkennend, geen bewijs dat elke medewerker foutloos gradeert.
Brede uitrol pas nadat kwaliteit én doorlooptijd in de praktijk voldoen.

## Eindcontrole van de uitbreiding

De ontwerp-eindcontrole is inline uitgevoerd; geen onafhankelijke reviewer was
beschikbaar. De bestaande globale stijl is behouden, niet opnieuw ontworpen.
Globale PRODUCT.md/DESIGN.md-documentatie ontbrak al en is niet ongevraagd
gereconstrueerd. De huidige broncode blijft daarvoor de visuele waarheid.

- Persistence: deze workflow, beperkingen en testwijze zijn hier vastgelegd.
- Fidelity: bestaande typografie, fotografisch materiaal, neutrale grond en
  ReMarkt-kleuren behouden; responsieve herindeling dient de bediening.
- Ceiling: functionele werkinterface; geen decoratieve effecten toegevoegd.
- Material fixes: geen open bevinding uit de gerichte visuele controle; een
  praktijkpilot blijft nodig voor tijd en beoordelingsbetrouwbaarheid.
- Keep: schoonmaak is geen automatische A, twijfel blokkeert een eindlabel,
  onafhankelijke schadepunten mogen niet verdwijnen.

Disposition: ship — de interface is lokaal geverifieerd en goedgekeurd voor
publicatie. Dit is geen bewijs van foutloze fysieke inspectie; een praktijkpilot
blijft nodig om kwaliteit en beoordelingstijd te toetsen.
