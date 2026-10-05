# Storage en herstel — 5 oktober 2026

## Incident en bereikbaarheid

Productie gaf HTTP 402 vanuit Neon: account/project quota exceeded. De oude
Upstash-bron geeft HTTP 403: fixed plan limits reached. Een fout bij ophalen is
geen bewijs dat records verwijderd zijn. Beide bronnen zijn nu onbereikbaar.
Een codewijziging kan een providerblokkade niet opheffen.

Laatste eerder bevestigde gezonde telling op 3 oktober: 29 gebruikers,
20 laptopbatches, 8 monitorbatches, 7.821 beoordelingen, 21 laptoplabelregistraties,
3.288 monitorlabelregistraties. Dit is een vergelijkingspunt, geen bewijs dat
een herstelkopie alle daarna uitgevoerde werkzaamheden bevat.

De lokale data/remarkt-demo-state.json is van 26 juni: 13 gebruikers,
6 laptopbatches, 4 monitorbatches en 1.939 beoordelingen. Deze niet automatisch
als vervanging van de oktoberadministratie gebruiken. De bestaande data/ map
en alle oude bronnen blijven intact.

## Wat de nieuwe opslag doet

- Eenmalige automatische upgrade van de bestaande Postgres shared_state.
  Het oorspronkelijke document blijft onaangetast en krijgt een herstelpunt.
- Compressed shards: batches 8, monitorbatches 8, history 64, laptoplabels 32,
  monitorlabels 32, auditlogs 1. Alleen geraakte delen worden gelezen en geschreven.
- Metadata-revisie wordt binnen dezelfde transactie gecontroleerd/geclaimd.
  Conflicterende schrijvers proberen opnieuw na opnieuw samenvoegen. Dit voorkomt
  verlies van afzonderlijke nieuwe beoordelingen door gelijktijdige schrijvers.
  Bestaande inhoudelijke last-writer-wins regels voor hetzelfde record blijven.
- Bij herladen worden alleen delen sinds de lokaal bekende revisie opgehaald.
  Eerste bezoek zonder cache vraagt nog steeds een volledige gecomprimeerde kopie.
- Dashboard gebruikt kleine statistiekprojecties, maximaal 30 seconden gecacht
  zolang de revisie niet veranderd is; opslaan berekent niet telkens alle statistieken.
- Dagelijks herstelpunt vóór de eerste wijziging, server-side SQL kopie zonder
  volledige download. Zeven herstelpunten blijven bewaard. Expliciete vervanging
  maakt eerst een extra herstelpunt. Een ontbrekende database wordt nooit stil
  als lege productie-initialisatie aangemaakt.
- De upgrade vereist toegang tot Neon en eenmalig netwerkverkeer. Zolang de
  provider blokkeert, is deze migratie op productie NIET uitgevoerd/gecontroleerd.

Dit verlaagt dataverkeer; het garandeert geen onbeperkt gratis gebruik. Houd
werkelijke transfer, databasegrootte en compute in het providerportaal bij.
Een downgrade naar oudere code na migratie schrijft de oude, afzonderlijke rij:
rollback vereist daarom een gecontroleerde export van de actuele v2-state.
Geen gemengde oude/nieuwe deployments laten schrijven tijdens de omschakeling.

## Lokale herstelkopie veiligstellen

1. Gebruik de computer, Chrome-profiel en URL waarop medewerkers eerder werkten.
   Wis geen browsergegevens, siteopslag of profielen.
2. Open de nieuwste app. Bij databaseproblemen verschijnt een storingsmelding.
3. Als de melding een lokale kopie meldt, kies **Lokale herstelkopie downloaden**.
   Bewaar het JSON-bestand beveiligd; het bevat bedrijfsgegevens en wachtwoordhashes.
   Als alleen de aparte accountcache over is, verschijnt **Alleen opgeslagen
   accounts downloaden**. Dit bestand bevat GEEN batches of beoordelingen en
   wordt met `_recoveryScope: accounts-only` gemarkeerd. Geen volledige restore
   uitvoeren met zo'n gedeeltelijk bestand.
4. Verzamel zo nodig meerdere kopieën. Controleer updatedAt, aantallen en individuele
   record-ID's; de nieuwste datum alleen bewijst geen volledigheid.
5. Test herstel op een apart leeg doel vóór productie wordt omgeschakeld. Bewaar
   alle oorspronkelijke exports. Een oude kopie mag nieuwe gegevens niet wissen.

De nieuwe app bewaart grote kopieën in IndexedDB en ondersteunt bestaande
localStorage-kopieën. Schijffouten worden gemeld; geheugenopslag wordt niet als
duurzame backup voorgesteld. Browseropslag kan alsnog gewist of geëvict worden:
een los bewaard exportbestand blijft noodzakelijk. Een backup in dezelfde
geblokkeerde database helpt niet om die blokkade te omzeilen.

## Gratis herstelroutes

1. **Recente lokale kopie + afzonderlijk nieuw gratis Neon-project.** Neon vermeldt
   quota per project. Een nieuwe lege werkruimte moet expliciet aangemaakt,
   gecontroleerd en goedgekeurd worden; alleen een extra branch is geen nieuw
   quotabudget. Geen oude bron verwijderen. Eerst met de geoptimaliseerde opslag
   herstellen/testen, daarna de productieconnection-string omschakelen.
2. **Provider vragen om tijdelijk exporttoegang.** Neon/Vercel kan gevraagd worden
   om een eenmalige export/unblock. Toekenning is niet gegarandeerd. Wij kunnen
   de providerblokkade niet zelf opheffen.
3. **Bestaande interne pc/server met lokale database.** Geen cloud-transferquota,
   maar vereist een blijvend ingeschakelde machine, toegangsbeheer, netwerkbeheer
   en aparte backups. Niet automatisch ingericht; de productiecloud-API kan niet
   rechtstreeks een gewone browsercache als gedeelde database gebruiken.
4. **Wachten op het volgende quotavenster.** Neon zegt dat netwerk/compute aan het
   begin van de volgende maandelijkse billingperiode resetten. De exacte datum
   van deze Vercel-integratie moet in het portaal bevestigd worden.

Supabase Free heeft eveneens 5 GB egress en 500 MB database: wisselen van merk
zonder het opslagprobleem op te lossen is dus geen structurele oplossing.
De huidige Neon HTTP-driver is bovendien niet direct geschikt voor Supabase;
dit is geen reeds gebouwde failover.

Bronnen gecontroleerd 5 oktober 2026:

- https://github.com/neondatabase/website/blob/main/content/faqs/free-plan-limits-and-quotas.md
- https://supabase.com/pricing

## Verificatie

### Herstelonderzoek 5 oktober 2026

- Vercel CLI heeft toegang tot het correcte `re-markt/grade-app`-project.
- Beide oude bronnen weigeren reads wegens quota: Upstash via REST en Neon
  zowel via HTTP als via de gewone TLS/Postgres-verbinding. Dit is geen bewijs
  dat records verwijderd zijn. De oude bronnen zijn niet vervangen of gewist.
- De productie-origin van de gecontroleerde Chrome-profielen bevat alleen een
  accountcache. De gevonden localhost-batchkopie is van mei, niet van oktober.
  Chrome-opslag is alleen gekopieerd; oorspronkelijke profielen zijn behouden.
- Een afzonderlijk **Free** Neon-project `grade-app-recovery-20261005` is gekoppeld
  aan uitsluitend Development met prefix `RECOVERY_`. Het bevat de 29 accounts
  uit de accounts-only-export. Namen, rollen en wachtwoordhashes zijn na het
  schrijven teruggelezen en gecontroleerd. Operationele collecties zijn leeg.
- Productie is NIET omgeschakeld. Een tijdelijke start met accounts en opnieuw
  geïmporteerde leverancierslijsten vereist een expliciete keuze van de beheerder:
  deze herstelt geen oude beoordelingen, labelregistraties of batchstatussen.
- Er is een afzonderlijk onuitgerold brononderzoekproject
  `grade-app-source-recovery-20261005`, uitsluitend Development verbonden met de
  oude Neon-bron. Dit wijzigt de bestaande productieverbinding niet.
- Private exports, connection-strings en browserkopieën staan onder de genegeerde
  `data/` en `tmp/` directories; deze mogen nooit in Git of een deployment komen.

De beheerder heeft de tijdelijke accounts-only-werkruimte vervolgens expliciet
goedgekeurd. Omschakeling gebruikt `REMARKT_DATABASE_URL` (Production Secret)
en `REMARKT_WORKSPACE_ID=recovery-20261005` (Production Config). De oorspronkelijke
`DATABASE_URL` en Redis-variabelen blijven intact. Nieuwe deployments kiezen de
override; bestaande deployments worden hierdoor niet gewijzigd. Terugdraaien
vereist het verwijderen van de override en een nieuwe deployment, maar alleen
nadat nieuwe werkrecords zijn veiliggesteld en de bron weer toegankelijk is.

Bij een workspacewissel archiveert de nieuwe browsercode de oude lokale kopie
onder `workspace-archive:*` in IndexedDB vóór de actieve kopie wordt vervangen.
Revisienummers van verschillende databases worden niet als dezelfde delta gezien.
Oude tabbladen zonder het nieuwe workspace-ID krijgen HTTP 409 bij opslaan en
moeten worden herladen. Automatisch mengen van oude en nieuwe gegevens is verboden;
later herstel moet gecontroleerd op individuele records gebeuren.

`npm test` omvat de bestaande workflowtests, browsercache/outage-regressies en
echte PostgreSQL-querytests via PGlite. Tests behandelen migratiebehoud,
deelupdates, gelijktijdige nieuwe beoordelingen, accounts, delete/restoremarkers,
batchbevestigingen, statistiekpariteit en herstelpunten.

Een synthetische 7,2 MB administratie verbruikt in de deel-save test circa 2 KB
database-responseverkeer (meer dan 99% minder). Dit is geen gemeten garantie voor
alle echte batches. Grootte van gewijzigde delen en gebruikspatroon blijven relevant.

De localhost QA-server gebruikt uitsluitend verzonnen accounts/data en een
in-memory database. Geen echte labels worden geprint en er wordt geen
productieadministratie gewijzigd tijdens QA.
