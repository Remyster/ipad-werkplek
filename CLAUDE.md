# iPad Werkplek — vaste regels

- **Gegevens van Remy nooit wissen of inkorten bij een update.** Dat geldt in het bijzonder voor de
  moeilijke-woordenlijst (`remy-ipad-woorden` + tabel `werkplek_woorden`): geen limiet, geen "wis alles",
  geen opschoning. Bij elke wijziging aan opslag (localStorage-sleutels, service worker, migraties) de
  bestaande gegevens meenemen, nooit vervangen.
- Nieuwe tabellen in Supabase project B krijgen `eigenaar_only` voor `authenticated` (zie de *-MIGRATIE.sql-bestanden).
