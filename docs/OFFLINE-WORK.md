# Doorwerken bij database-uitval

## Wat er verandert

- Eerste keer laden haalt een gecomprimeerde werkvoorraad op via `?work=1`,
  in plaats van tientallen opeenvolgende pagina's. Historische inspectiebomen
  worden niet meegestuurd. Statistieken zijn geen voorwaarde voor inloggen.
- Na een geldige serverlogin kan bij quota-, netwerk- of database-uitval de
  lokale werkkopie worden gebruikt. Zonder kopie wordt alleen handmatige
  invoer aangeboden: voorbeeldbatches verschijnen nooit als productiegegevens.
- Een manager kan een volledige v3-werkkopie van dezelfde workspace lokaal
  herstellen. Accounts-only bestanden en kopieën met een openstaande mutatie
  zijn hiervoor niet bruikbaar. Herstel overschrijft geen servergegevens en
  wordt geweigerd als er op deze computer nog ongesynchroniseerd werk is.
- Beoordelingen, labelregistraties en nieuwe handmatige apparaten worden
  eerst duurzaam opgeslagen in IndexedDB, met localStorage als kleine fallback.
  De app geeft lokaal succes aan, nooit een onterechte live bevestiging.

## Inloggen zonder database

Na succesvol inloggen met een **persoonlijk** wachtwoord bewaart deze computer
een willekeurig gesalte PBKDF2-SHA256 verifier (210.000 iteraties), publieke
accountrechten, workspace en controletijd. Geen plaintext of serverhash.
Deze mogelijkheid verloopt na zeven dagen. Een tijdelijk wachtwoord krijgt
geen offline toegang; het moet eerst online worden veranderd.

Lokaal inloggen wordt alleen geprobeerd bij onbereikbaarheid van de server,
niet bij een onjuist online wachtwoord, ontbrekend account, 401 of login-429.
Een online 401 verwijdert de lokale verifier. Een ontvangen wijziging van
rechten, wachtwoorddatum of verplichte wachtwoordwijziging maakt deze ongeldig.
Tijdens volledige uitval zijn centrale intrekkingen op andere computers niet
direct bekend: dat is een expliciete beperking van offline werken.

## Opslag en synchronisatie

De eerste niet-bevestigde mutatie behoudt haar oorspronkelijke identiteit,
body en verwachte recordrevisies. Latere lokale wijzigingen blijven in de
duurzame snapshot naast deze verzegelde mutatie. Ook een pre-print opslagcheck
mag die outbox niet verwijderen. Na herstel wordt eerst dezelfde mutatie
herhaald; het serverontvangstbewijs voorkomt dubbele registraties. Daarna
worden de latere wijzigingen verzonden. Quota-uitval blijft lokaal succes;
een recordconflict is **geen** reden om nieuwere servergegevens te overschrijven.

Automatische hercontrole gebruikt de bestaande vijfminuteninterval en respecteert
Retry-After. Zonder geldige serversessie is opnieuw online inloggen nodig voor
synchronisatie; werk blijft ondertussen lokaal beschikbaar. Bij openstaand werk
van verschillende medewerkers op een gedeelde computer kan managerbevestiging
nodig zijn. Verkeerde rechten en conflicten blijven zichtbaar; er is geen
stilzwijgende rechtentoekenning of conflict-override.

## Werkinstructie managers

1. Laat elke werkplek eenmaal online de werklijsten laden en medewerkers met
   hun eigen wachtwoord inloggen om de lokale toegang klaar te zetten.
2. Verdeel tijdens uitval batches/apparaten over werkplekken. Live coördinatie
   tussen computers werkt dan niet; dezelfde laptop mag niet op twee plekken
   tegelijk worden verwerkt.
3. Download regelmatig de lokale herstelkopie en bewaar die buiten de computer.
   Wis geen browsergegevens, wissel niet van browserprofiel en gebruik geen
   privémodus voor dagelijkse productie.
4. Laat na herstel synchroniseren; bij verdwenen sessie opnieuw inloggen.
   Laat recordconflicten door een manager controleren, niet blind overschrijven.

## Grenzen

Dit maakt de app niet onafhankelijk van alle infrastructuur: de webapp en
afbeeldingen moeten nog bereikbaar of al in de browser geladen zijn, en DYMO
Connect moet werken. Een nieuwe computer zonder kopie of eerder gecontroleerde
credentials kan zonder server geen bestaande accounts/werklijsten reconstrueren.
Lokale opslag die vol of geblokkeerd is, stopt printen; werk dat nergens duurzaam
kan worden opgeslagen mag niet als veilig voltooid worden gemeld. Geen betaalde
dienst of nieuwe cloud-database is voor deze wijziging aangevraagd.
