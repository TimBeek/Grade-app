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
