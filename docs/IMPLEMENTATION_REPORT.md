# Implementation Report

> Historisch: Dieser Bericht beschreibt den ersten V2-Scaffolding-Schnitt mit Fixture-Fokus. Der aktuelle produktive DELFI-/PostGIS-/MOTIS-Stand steht in `docs/CURRENT_STATE.md` und `docs/PRODUCTION_DATA_INTEGRATION_REPORT.md`.

Stand: 2026-06-24

## Umgesetzte Komponenten

### Datenbank

- `docker-compose.yml` enthält PostGIS `postgis/postgis:16-3.4`.
- `db/migrations/001_core_schema.sql` legt Quellen, Snapshots, Agencies, StopPlaces, Stops, Stop-Links, Aliase, Routes, Route Patterns, Trips, Stop-Times, Service-Dates, Transfers, Pathways, Footpaths, Routingprofile, Metric Runs, OD-Metriken, Itineraries und Legs an.
- Geometrien verwenden SRID 4326, räumliche Indizes nutzen GiST.
- `db/migrations/002_snapshot_activation.sql` aktiviert Snapshots transaktional.

### Migrationen

- `npm run db:migrate` führt SQL-Migrationen über `scripts/migrate-db.ts` aus.
- Historischer Stand dieses Berichts: Die Migration wurde damals nicht gegen eine laufende PostGIS-Instanz ausgeführt. Aktuell läuft PostGIS per Docker Compose auf Port `55432`, und die Produktionsmigrationen wurden für den aktiven DELFI-Snapshot genutzt.

### Pipeline

- `pipeline/` enthält Python-Module für GTFS-Validierung, synthetischen Importbericht und Fixture-Metrikaggregation.
- Der DELFI-Adapter erwartet `DELFI_GTFS_PATH`; es wird keine Download-URL erfunden.
- `fixtures/gtfs/synthetic/` deckt Bahn, Bus, direkte Verbindung, Umsteigeverbindung, Kalenderausnahmen, Zeit größer 24:00, Transfers, Pathways, fehlende Shape und unterschiedliche Patterns ab.

### Routing

- `src/domain/travelTimeStatistics.ts` implementiert korrekte Gesamtreisezeit ab gewünschtem Abfahrtszeitpunkt, Durchschnitt, Median und P90 nach Nearest-Rank.
- `server/routing/itineraryProvider.ts` definiert die Provider-Abstraktion und Dominanzfilterung.
- MOTIS- und R5-Fallback-Provider sind vorbereitet, aber ohne lokale Graphen nicht produktiv ausführbar.

### API

- `server/` enthält Fastify-API mit Zod-Validierung und verständlichen Fehlerantworten.
- Implementierte Endpunkte: Snapshot, Stop-Suche, Stop-Details, Metriken, Itineraries, Route Pattern, Stop-Tiles und Route-Tiles.
- `server/db/postgresRepository.ts` enthält PostGIS-Abfragen inklusive `ST_AsMVT`.
- `server/db/fixtureRepository.ts` liefert eine lauffähige lokale Fixture-API für Tests und UI-Demo.

### Tiles

- PostGIS-MVT-Endpunkte sind implementiert.
- Im Fixture-Modus werden leere MVT-Payloads mit korrektem Content-Type, Cache-Control und ETag geliefert.

### Frontend

- `src/ApiApp.tsx` ist ein MapLibre-API-Modus.
- `src/App.tsx` schaltet per `VITE_REGIONFINDER_DATA_MODE=api|legacy`.
- Der API-Modus lädt keine HVV-Großdateien, sondern Snapshot, Suche, Details, Metriken, Itineraries und MVT-Tiles.

### Tests

- Neue Unit-Tests für GTFS-Zeit, Service-Dates, Route Patterns, Shape-Sortierung, Shape-Distanz, Gesamtreisezeit, Durchschnitt, Median, P90, Coverage und Veröffentlichungsschwellen.
- API-Tests für Snapshot, Stop-Suche, Metriken-404, Itineraries, Tiles und ungültige Parameter.
- Provider-Test für dominierte Verbindungsvorschläge.

## Geänderte Dateien

- `package.json`, `package-lock.json`: neue Abhängigkeiten und Skripte.
- `.env.example`: lokale Konfiguration ohne Secrets.
- `.gitignore`: große Routing-/Rohdatenartefakte ergänzt.
- `docker-compose.yml`: PostGIS und vorbereiteter MOTIS-Dienst.
- `db/migrations/*.sql`: neues relationales/PostGIS-Modell.
- `server/**`: API, Repositories, Routingprovider, Tests.
- `pipeline/**`: Python-Pipeline-Schnitt.
- `fixtures/gtfs/synthetic/**`: synthetischer GTFS-Testfeed.
- `config/*.yml`: Routingprofile, Datenquellen, Origin-Konfiguration.
- `src/api/contracts.ts`: gemeinsame API-Typen.
- `src/ApiApp.tsx`, `src/data/api.ts`, `src/App.css`, `src/App.tsx`: API-/MapLibre-Frontend.
- `src/domain/gtfsSchedule.ts`, `src/domain/travelTimeStatistics.ts`: neue fachliche Kernlogik.
- `docs/*.md`: Zielarchitektur, Datenquellen, Semantik, Runbook, Migration, Datenqualität, Betrieb und dieser Bericht.

## Datenquellenstatus

- Tatsächlich validiert: synthetischer GTFS-Feed unter `fixtures/gtfs/synthetic`.
- Tatsächlich über Legacy vorhanden: HVV-Artefakte unter `public/data/hvv/`.
- Nicht vorhanden: DELFI-Vollsnapshot, ZHV-Datei, OSM-PBF, produktive Verwaltungsgrenzen.
- Implementierte Adapter/Schnittstellen: `DELFI_GTFS_PATH`, `ZHV_STOPS_PATH`, `OSM_PBF_PATH`, `ADMIN_BOUNDARIES_PATH`.
- Datenmengen synthetisch: 8 Stops, 2 Routes, 5 Trips, 12 Stop-Times, 2 Kalenderdienste, 3 Calendar-Date-Ausnahmen/Einträge, 8 Shape-Punkte.

## Fahrzeitsemantik

Konkreter Testfall aus `travelTimeStatistics.test.ts`:

- gewünschte Abfahrt: 08:00
- tatsächliche Fahrzeugabfahrt: 08:10
- Ankunft: 08:40
- alte falsche Berechnung: 30 Minuten (`Ankunft - erste Fahrzeugabfahrt`)
- neue korrekte Berechnung: 40 Minuten (`Ankunft - gewünschte Abfahrt`)

Die API-Fixture gibt dieselbe Semantik in `/api/v1/stops/de:01056:9001/itineraries` zurück.

## Beispielmetriken

Quelle: Fixture-API, Snapshot `fixture-synthetic-2026-07`, Profil `regular_tue_thu`, Datumsmuster aus `config/routing-profiles.yml`.

| Ziel | Schnellste Zeit | Durchschnitt | Median | P90 | Quote |
| --- | ---: | ---: | ---: | ---: | ---: |
| Bergedorf Fixture | 25 min | 32 min | 30 min | 42 min | 100 % |
| Aumuehle Testbahnhof | 40 min | 45 min | 45 min | 50 min | 100 % |
| Busdorf Mitte | 58 min | 72 min | 70 min | 88 min | 95 % |

`Busdorf Mitte` ist ein Bus-Ziel mit Busanteil und `identity_quality = missing_dhid`.

## Geometrien

Synthetischer Feed:

- Route Patterns: mindestens 4 fachliche Varianten: RE1 direkt, RE1 Kurzläufer, RE1 Gegenrichtung, B7 Bus.
- Offizielle Shapes: RE1-Patterns mit `shape-re1-full`, `shape-re1-short`, `shape-re1-reverse`.
- Fehlende Shapes: B7-Busfahrten, als `stop_sequence_approximation` gekennzeichnet.
- Beispiel unterschiedlicher Patterns derselben Linie: `re1-direct-0810` und `re1-short-0830`.

Historischer Stand: Produktive Shape-Abdeckung für DELFI wurde in diesem ersten Schnitt nicht berechnet. Aktuell sind 303.542 Route Patterns als `official_gtfs` und 7 als `stop_sequence_approximation` dokumentiert.

## Tests

Ausgeführt:

```bash
npm run test
npm run build
npm run lint
npm run pipeline:validate
npm run pipeline:import:synthetic
npm run pipeline:compute
```

Erfolgreich:

- `npm run test`: 7 Testdateien, 27 Tests.
- `npm run build`: erfolgreich; Vite meldet einen Bundle-Warnhinweis wegen MapLibre-Größe.
- `npm run lint`: erfolgreich.
- `npm run pipeline:validate`: erfolgreich, meldet fehlendes `DELFI_GTFS_PATH` als Blocker und validiert Fixture.
- `npm run pipeline:import:synthetic`: erfolgreich, Bericht unter `dist/pipeline/synthetic-import-report.json`.
- `npm run pipeline:compute`: erfolgreich, Bericht unter `dist/pipeline/metric-report.json`.

Fehlgeschlagen und behoben:

- Pipeline-Skripte nutzten zunächst `python`; die Umgebung stellt nur `python3` bereit. Skripte wurden angepasst.
- Erste Build-Prüfung fand MapLibre-/Nullable-Typfehler. Diese wurden behoben.

Nicht ausgeführt:

- PostGIS-Migration gegen echten Container.
- R5/r5py-Graphbau.
- MOTIS-Graphbau.
- Vollimport DELFI/ZHV/OSM/Admin-Grenzen.
- Browser-E2E-Screenshots.

Gründe: externe Quelldateien und lokale Routingengine-Artefakte fehlen; kein laufender Docker-Stack in diesem Ausführungslauf.

## Performance

Gemessen:

- Unit/API-Tests: unter 1 Sekunde.
- Vite-Build: rund 2 Sekunden.
- Pipeline-Fixture-Validierung/Import/Compute: jeweils unter 1 Sekunde.

Nicht gemessen:

- produktive Importdauer,
- Datenbankgröße,
- R5-Graphbau,
- MOTIS-Graphbau,
- echte MVT-Kachelgrößen,
- API-Reaktionszeiten gegen PostGIS.

Bekannter Hinweis: MapLibre erhöht das initiale Bundle im API-Modus. Nächster technischer Schritt ist Lazy Loading des API-Modus.

## Noch offene Punkte

Technische Restarbeiten:

- Historisch offen, inzwischen umgesetzt: produktiver DELFI-Import nach PostGIS mit aktivem Snapshot `delfi-bb69c7e2c8d5`.
- Routingprofile in die Datenbank synchronisieren.
- Admin-Grenzen importieren und StopPlaces per Punkt-in-Polygon klassifizieren.
- R5/r5py-Batchjob mit echten Netzen ausführen.
- MOTIS-Provider gegen lokalen MOTIS-Endpunkt mappen.
- Frontend-E2E-Tests und visuelle MapLibre-Prüfung ergänzen.
- API-Modus per Code-Splitting laden.

Fehlende externe Daten:

- DELFI-GTFS-Snapshot.
- ZHV/DHID-Datei.
- OSM-PBF für Norddeutschland/Deutschland.
- Verwaltungsgrenzen.

Nicht implementierte optionale Funktionen:

- Regionale Fahrt-Merge-Deduplizierung.
- OSM-basierte Shape-Rekonstruktion.
- Produktive PMTiles.
- Echtzeit/GTFS-RT, bewusst nicht Teil dieser Zielversion.

Bekannte Datenqualitätsprobleme:

- Fixture enthält absichtlich fehlende DHID und fehlende Bus-Shape.
- Legacy-HVV-StopPlaces bleiben heuristisch und sind nicht kanonisch migriert.

## Git-Status

Aktueller Stand: Das Verzeichnis ist ein Git-Repository auf Branch `main` mit Remote `origin`.

Kurzfassung am Ende:

- Geändert: `.gitignore`, `README.md`, `docs/ARCHITECTURE.md`, `docs/CURRENT_STATE.md`, `eslint.config.js`, `package-lock.json`, `package.json`, `src/App.css`, `src/App.tsx`, `tsconfig.json`.
- Neu: `.env.example`, `config/`, `db/`, `docker-compose.yml`, neue `docs/`, `fixtures/`, `pipeline/`, `scripts/migrate-db.ts`, `server/`, `src/ApiApp.tsx`, `src/api/`, `src/data/api.ts`, neue Domain-Tests und Domain-Module, `tsconfig.server.json`.
- Bereits vorher untracked: `AUDIT_REPORT_FOR_NEXT_AGENT.txt`.
