# Inloggen en wachtwoordbeheer

## Voor managers

- **Gebruikersbeheer → Nieuwe gebruiker:** vul naam, login-ID, rechten en een
  tijdelijk wachtwoord (8–256 tekens) tweemaal in. Deel dit wachtwoord veilig
  met de betreffende medewerker. De medewerker kiest bij de eerste aanmelding
  verplicht een ander, persoonlijk wachtwoord.
- **Gebruikersbeheer → Bewerken → Wachtwoord resetten:** vul beide tijdelijke
  wachtwoordvelden in en bevestig de reset. Oude sessies en het oude wachtwoord
  zijn daarna ongeldig. De medewerker meldt zich opnieuw aan.
- **Wijzigingen opslaan** past alleen rechten aan; het verandert geen wachtwoord.
  Bestaande wachtwoorden worden niet getoond. Gebruik de persoonlijke
  wachtwoordpagina voor je eigen account.
- Een account of reset wordt pas als succesvol gemeld na bevestiging door de
  server. Bij een netwerkfout wordt niet lokaal een fictieve reset opgeslagen.
  Bij een verloren antwoord kan de serverwijziging al zijn uitgevoerd: vernieuw
  accounts en controleer het account voordat je opnieuw reset.

## Meldingen voor medewerkers

- Verkeerd account of wachtwoord: controleer het geselecteerde account. Na een
  reset is het oude wachtwoord niet meer bruikbaar.
- Te veel mislukte pogingen: de melding toont de resterende wachttijd afgerond
  op minuten. Vraag zo nodig een manager om een reset.
- Verlopen sessie: meld opnieuw aan; lokaal nog niet gesynchroniseerd werk blijft
  bewaard. Wis geen browsergegevens om een inlogprobleem op te lossen.
- Accountservice onbereikbaar: het wachtwoord is niet gecontroleerd; dit is geen
  bewijs van een verkeerd wachtwoord. Probeer de verbinding opnieuw.
- Wachtwoord correct, werkgegevens nog niet geladen: de app blijft in de veilige
  wachtstand. Pas na succesvol laden worden de werkfuncties geopend.
- Nieuwe medewerkers niet zichtbaar? Gebruik **Accounts vernieuwen** of herlaad
  de pagina. Er wordt geen volledig batcharchief opgehaald voor deze actie.

Gele infrastructuur-, tijdelijke-database- en back-upmeldingen zijn alleen voor
managers. Medewerkers zien wel een compacte, concrete melding bij fouten die hun
werk daadwerkelijk blokkeren.

## Technische grenzen (v2 inlogbeleid)

- Login-verzoeken: 600 per minuut per netwerkadres, niet langer 20 succesvolle
  logins/wachtwoordwijzigingen samen per kwartier.
- Mislukte logins: 20 per account/credential-revisie/netwerk per 15 minuten en
  50 per account/revisie over alle netwerken; 100 per netwerk per 15 minuten.
  Geldige logins verhogen deze fouttellers niet.
  Een reset creëert een nieuwe credential-revisie zodat de oude accountblokkade
  het nieuwe tijdelijke wachtwoord niet blokkeert. De netwerkbrede bescherming
  tegen misbruik blijft bestaan.
- Eigen wachtwoord wijzigen: 30 verzoeken per account per minuut. Manager-account-
  en wachtwoordbeheer: 60 per manager per minuut, los van de loginlimieten.
- Accountlijst vernieuwen: 600 per netwerk per minuut; alleen compacte profielen.
- Limieten zijn gedeelde, gehashte en workspace-gebonden SQL-counters. HTTP 429
  retourneert `RATE_LIMITED` en de echte resterende `Retry-After` van het venster.
  Er is geen providerwissel, betaalde upgrade of nieuwe tabel nodig.
- Tijdelijke wachtwoorden worden op de server gesalt/gehasht. Browsercache,
  auditregels, serverresponsen en succesmeldingen bevatten geen plaintext.
- Regressie: `npm test`, inclusief `tests/login-flow.test.mjs` met de echte
  session-handler/Neon-transportlaag tegen geïsoleerde PGlite, zonder productie-
  accounts of wachtwoorden te wijzigen.

Ontwerpbronnen: [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
voor mislukte-aanmeldingslimieten en sessievernieuwing;
[Vercel request headers](https://vercel.com/docs/headers/request-headers)
voor het door Vercel ingestelde client-IP. Dit is geen volledige security-audit.
