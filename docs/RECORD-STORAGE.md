# ReMarkt opslag en herstel — versie 3

## Incident en audit

De ~23,5 MB administratie werd vroeger als één document gelezen en herschreven.
De v2-opslag beperkte dit tot gecomprimeerde shards, maar een shard met historie
groeit nog steeds mee met het archief. Een betaalde database of andere provider
lost dit patroon niet op. Oude Redis en de eerste Neon blijven brondata;
deze migratie schrijft uitsluitend naar de expliciet aangewezen werkdatabase.

| Onderdeel | Oude route / risico | Nieuwe route |
|---|---|---|
| Opslaan | `kvMergeState` → v2 hele relevante shard | één transactie met uitsluitend gewijzigde entiteiten |
| Start | alle histories + inspectiebomen | paged actieve voorraad, laatste 50 compacte registraties per type |
| Historie | volledige browserlijst | sleutel-paginering, zoek-/medewerkerfilter, detail apart |
| Herprint | afhankelijk van alle historische registraties | gerichte trace voor één barcode, maximaal 50 per registratietype |
| Dashboard | decompressie/statistiekrecords naar server | SQL-aggregaties; korte browsercache, invalidatie na save |
| Uitgebreide Inzichten | volledige beoordelingen | compacte projecties uitsluitend na openen; inspectiebomen blijven op server |
| Achtergrond | herhaalde volledige reloads | revisie + delta, verborgen tabbladen gepauzeerd, verzoeken ontdubbeld |
| Back-up | afhankelijk van dezelfde provider | externe AES-256-GCM checkpoint + immutable incrementen |

## Datamodel en garanties

`remarkt_records` bevat één gebruiker, batchkop, laptop, monitor, beoordeling,
label, audit of verwijdermarker per `(workspace_id, collection, id)`. Kinderen
verwijzen naar `batch_id`; product-ID is een JSON-tuple van batch en barcode.
De volledige beoordeling blijft behouden in `payload`; `summary` bevat feitelijke
uitkomsten, zonder grote inspectiebomen. Detail ophalen is geen mutatie.

Een revisie per record voorkomt stil overschrijven. De SQL-functie behandelt
mutaties atomair en bewaart een ontvangstbewijs per idempotency-ID. Een identieke
herhaling geeft hetzelfde antwoord; afwijkende inhoud onder dezelfde ID faalt.
Maximaal drie pogingen zijn toegestaan bij deadlock/serialization-conflict;
quota, autorisatie en recordconflicten veroorzaken geen automatische retry-loop.
Een lege database, corrupte data, quota, timeout en verbindings-/queryfouten zijn
verschillende foutstatussen. Fouten worden nooit als lege administratie opgeslagen.

De server controleert sessie, huidig account, wachtwoordwijziging en bevoegdheden
bij elke beveiligde route. Wachtwoordhashes worden niet naar de browser gestuurd.
Een verouderde sessie wordt na verwijdering/wachtwoordreset geweigerd.

## Zeven onderdelen en grenzen

1. Veiligheid: serverauth, revisies, idempotency, transacties, strikte foutstatussen.
2. Opslag: individuele records; v2-bron blijft intact.
3. Laden: historie paged; detail/trace gericht; voorraad paged maar lokaal compleet
   voor direct scannen. Zeer grote actieve voorraad is dus nog niet volledig lazy.
4. Statistiek: kerncijfers via SQL. Uitgebreide analyses gebruiken compacte
   projecties; niet iedere grafiek is al een eigen SQL-endpoint.
5. Sync: deltas, request-deduplicatie, beperkte retries, pending wijzigingen
   duurzaam in IndexedDB vóór verzenden, ongewijzigde saves zonder databasewrite.
6. Back-up: externe versleutelde keten, integriteitscontrole en geteste restore
   naar een geïsoleerde testdatabase; geen automatische productie-restore.
7. Oude historie: read-only export zodra beschikbaar, conflictrapport en
   huidige records winnen. Een accounts-only JSON bevat geen batches/historie.

## Veilige uitrol

1. Tests en localhost-browserworkflow uitvoeren.
2. Production-artifact bouwen met `--skip-domain` en `REMARKT_STORAGE_FORMAT=3`.
   Vóór schema/migratie mag het artifact niet op de productiealias staan.
3. Privé back-upconfiguratie buiten Git maken. Config bevat DPAPI-versleutelde
   URL en sleutel; dezelfde Windows-gebruiker is nodig om deze te openen.
4. `run-record-maintenance.ps1 -Mode Plan` is alleen lezen.
5. `-Mode Migrate` installeert een database-writegate voor actieve v2-opslag,
   wacht op bestaande schrijftansacties, bevriest oude writers, schrijft eerst
   een versleutelde bronkopie en migreert additief naar een inactieve workspace.
   De oude provider-databases worden hierbij niet benaderd of aangepast.
6. Aantallen én SHA-256 van ieder gereconstrueerd record vergelijken.
   Bij fout blijft de bron intact; uitsluitend een onvoltooide bevroren migratie
   kan met `-Mode Resume` doorgaan. Geen blind overschrijven bestaande v3-data.
7. Maak eerste externe back-up, controleer de keten, controleer de staged routes
   en promote pas daarna. Laat oude tabbladen vernieuwen en opnieuw inloggen.
8. Productie-environment op v3 zetten voor toekomstige Git-deploys.

De gate verhindert dat oude deployment-URLs de v2-bron blijven wijzigen.
`unfreeze-record-cutover.mjs --confirm-unfreeze` weigert rollback als na de
geverifieerde migratie nieuwe v3-werkzaamheden zijn opgeslagen. Dan eerst export
en gecontroleerde reconciliatie: alleen de oude code terugzetten is onvoldoende.

## Back-up en restore

`configure-record-backup.ps1` genereert de privé 32-byte AES-sleutel. Kies een
absolute map buiten de repository. `register-record-backup-task.ps1 -Register`
maakt een uurtaak onder de huidige Windows-gebruiker. De PC moet aan staan en
die gebruiker aangemeld zijn; dit is geen 24/7-cloudback-up. Een niet-actuele
back-upstatus moet door een manager onderzocht worden.

Geen verandering = uitsluitend kleine revisielezing. Verandering = alleen records
na de vorige revisie. Immutable bestanden blijven behouden; checkpoint is alleen
de cursor. Verwijder geen incrementen uit een actieve keten. De `.lock` voorkomt
overlap; een lock na crash alleen verwijderen nadat is gecontroleerd dat geen
back-up meer draait. Bewaar de sleutel ook in een bedrijfswachtwoordkluis; verlies
van dit Windows-profiel zonder sleutel maakt versleutelde bestanden onleesbaar.
De lokale map is onafhankelijk van Neon, niet van de PC of zijn schijf.

`verify-recovery-chain.mjs <map>` valideert authenticatie, volgorde, workspace,
revisies en herstelbaarheid. Tests reconstrueren de keten en schrijven deze in
een geïsoleerde PostgreSQL-testdatabase. Productieherstel gebeurt nooit automatisch.
Historische full-export vergelijken: `plan-recovery-merge.mjs <current> <old>`.
Nieuwe werkgegevens en bewuste verwijderingen mogen niet verdwijnen door restore.

## Monitoring en metingen

Vercel logs bevatten gestructureerde endpoint/status/duur/response-bytes en
record-query read/write-byte-estimaten, gewijzigde records en retries. Dit zijn
applicatiepayloadmetingen, niet de providerfactuur (protocoloverhead ontbreekt).
Geen persoonsgegevens, tokens, hashes of SQL-parameters in telemetry.

De synthetische test met 1.000 en 10.000 historie-records (~2 KB detail per record)
meet voor één nieuwe beoordeling 135/136 B resultaat en 2.590/2.593 B querywaarden.
Daarmee groeit een normale save niet met de historie. Login-, permissie- en
rate-limitqueries komen daar in de echte HTTP-route nog bij. Deze cijfers zijn
geen garantie dat een gratis abonnement onder iedere belasting voldoende is.
Controleer werkelijke Neon/Vercel quota en foutpercentages tijdens dagelijks gebruik.

## Extra UI-verzoek

‘Tijdelijke werkdatabase’ heeft een sluitknop. De keuze wordt per workspace in
deze browser onthouden. Echte opslag-/quota-/lokale back-upfouten blijven zichtbaar.
