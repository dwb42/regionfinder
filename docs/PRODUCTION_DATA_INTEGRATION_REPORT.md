# Production Data Integration Report

Stand: 2026-06-25

## Ergebnis

Die Produktionsintegration wurde mit echten Daten ausgeführt. Der reale DELFI-Snapshot `delfi-bb69c7e2c8d5` ist aktiv.

Die Aktivierung basiert auf der zertifizierten Produktions-Metrikengine `motis_one_to_all`. R5/r5py bleibt optionale Vergleichsengine und ist kein Aktivierungs-Gate mehr.

Aktiver Metriklauf:

- Metric Run: `4d9f96b5-f905-42cd-a5e1-2283e9b7bd7d`
- Engine: `motis_one_to_all`
- Engine-Version: `motis-v2.10.2`
- Profil: `regular_tue_thu`
- Metric Definition: `2026-06-25.fastest-day-exact-stop`
- Repräsentativer Werktag: 2026-09-15
- Sample-Basis: 00:00 bis GTFS 28:00, alle 5 Minuten
- Samples: 336
- Maximaldauer: 120 Minuten
- Ziel-StopPlaces: 95.870
- Erreichbare Ziel-StopPlaces: 30.737
- Nicht erreichbare Ziel-StopPlaces: 65.133
- Verarbeitete MOTIS-Ergebniszuordnungen: 3.761.902
- Rohsample-Artefakt: `data/processed/metrics/delfi-bb69c7e2c8d5/regular_tue_thu/motis-one-to-all-samples.jsonl.gz`
- Rohsample-SHA-256: `5a90086e9d08d59fdd4f650e053889585483f47a218abcb2fc39a37529708884`

Semantik: Die Produktmetrik ist `fastestSeconds`, die schnellste planmäßige Gesamtreisezeit vom Hamburg-Hbf-Origin zum exakten Ziel-StopPlace über alle Samples des repräsentativen Werktags. MOTIS darf einen initialen Fußweg zum Einstieg nutzen, aber keinen finalen Fußweg von einer Nachbarhaltestelle zum Ziel. Median, P90, Reachability-Quoten, Transferaggregate und `directConnectionRatio` werden im aktuellen Produktvertrag nicht mehr berechnet oder veröffentlicht; die alten `od_metrics`-Spalten bleiben nur aus Schema-Kompatibilität bestehen.

## Quellen

| Quelle | Status | Datei | Größe | SHA-256 | Zeitraum / Stand |
| --- | --- | --- | ---: | --- | --- |
| DELFI deutschlandweite Sollfahrplandaten GTFS | heruntergeladen, ZIP validiert, importiert | `data/raw/delfi/gtfs-deutschland-gesamt.zip` | 435,515,166 B | `bb69c7e2c8d50e6f923e397f5d39a17c4e514cb6e4e258473cff65798b5b902e` | 2026-06-06 bis 2026-12-12 |
| BKG VG250 Ebenen GeoPackage | heruntergeladen, importiert | `data/raw/bkg/vg250_01-01.utm32s.gpkg.ebenen.zip` | 72,326,773 B | `0a3c106a7537e1b47e97077d923c660e22510f73031463a420e7718c6f129e42` | aktueller BKG-Download |
| Geofabrik Germany OSM PBF | heruntergeladen, lokal validiert | `data/raw/osm/germany-latest.osm.pbf` | 4,786,474,751 B | `d957290fe75a9f599ff3abd2a883328c58e0c67a1db332f15a11647e86d0e74d` | Geofabrik `germany-latest` |

Hinweis: Die Geofabrik-MD5-Datei passte beim Lauf nicht zum aufgelösten Mirror-Artefakt. Der eigene SHA-256 wurde gespeichert; `data/source-manifest.json` markiert OSM deshalb als `warning`.

## DELFI-Import

Snapshot: `delfi-bb69c7e2c8d5`

Status in PostGIS: `active`.

Importierte Tabellen:

| Tabelle | Datensätze |
| --- | ---: |
| agencies | 1,157 |
| stop_places | 533,066 |
| stops | 545,533 |
| routes | 29,196 |
| trips | 2,267,786 |
| stop_times | 45,880,781 |
| service_dates | 1,891,342 |
| route_patterns | 303,549 |
| route_pattern_stops | 5,088,350 |

Route-Pattern-Geometrie:

| Qualität | Anzahl |
| --- | ---: |
| `official_gtfs` | 303,542 |
| `stop_sequence_approximation` | 7 |

Route-Modes nach korrigiertem erweiterten GTFS-Type-Mapping:

| Mode | Routes |
| --- | ---: |
| BUS | 26,228 |
| TRAM | 753 |
| RB | 441 |
| TAXI | 406 |
| OTHER | 323 |
| RAIL | 314 |
| RE | 271 |
| S | 236 |
| U | 121 |
| FERRY | 78 |
| ICE | 25 |

Der offizielle MobilityData GTFS Validator wurde mit `ghcr.io/mobilitydata/gtfs-validator:8.0.1` ausgeführt. Der Lauf erzeugte Berichte unter `data/reports/gtfs-validator/delfi/`, ist aber wegen Java-Heap-OOM nicht als erfolgreiches Qualitätsgate verwendbar:

- `java.lang.OutOfMemoryError: Java heap space`
- Validator summary: `8.0.1-SNAPSHOT`
- Validierungsdauer: 82,33 s bis Fehlerbericht
- System-Errors: 2 Notice-Gruppen

## Verwaltungsgrenzen

BKG VG250 wurde über GDAL Docker importiert. Importierte Länder:

- `DE-HH`
- `DE-SH`
- `DE-MV`
- `DE-NI`
- `DE-HB`

StopPlace-Zuordnung aus Punkt-in-Polygon:

| State | StopPlaces |
| --- | ---: |
| DE-HB | 1,943 |
| DE-HH | 5,021 |
| DE-MV | 16,089 |
| DE-NI | 53,776 |
| DE-SH | 20,984 |
| ohne Zuordnung | 435,253 |

Die große Zahl ohne Zuordnung ist erwartbar, weil der DELFI-Feed deutschlandweit importiert wurde und nur die Ziel-/Routingländer in `admin_boundaries` geladen wurden.

## OSM

Verwendet wurde der vollständige Deutschland-PBF, kein Nord-Fallback.

- Datei: `data/raw/osm/germany-latest.osm.pbf`
- Größe: 4,786,474,751 B
- SHA-256: `d957290fe75a9f599ff3abd2a883328c58e0c67a1db332f15a11647e86d0e74d`
- Ziel: gemeinsamer Routingstand für R5 und MOTIS

## R5/r5py

Ausgeführt:

```bash
GTFS_PATH=data/raw/delfi/gtfs-deutschland-gesamt.zip OSM_PBF_PATH=data/raw/osm/germany-latest.osm.pbf npm run routing:build:r5
```

Ergebnisse:

- erster Versuch mit Java 17: fehlgeschlagen, R5-JAR benötigt Java class file version 65 / Java 21.
- zweiter Versuch mit `eclipse-temurin:21.0.7_6-jdk-jammy`: gestartet.
- r5py-Version: angefordert `1.0.4`.
- Laufzeit bis kontrolliertem Abbruch: 5,450.98 s.
- Rückgabecode: 137 nach `docker stop`.
- Maximal beobachteter Speicher: ca. 6 GiB von 7.75 GiB Docker-Limit.
- Beobachteter kumulierter Block-I/O: > 1 TB.
- Kein `TransportNetwork`-Smoke-Report wurde erzeugt.

Status: nicht gebaut. R5/r5py ist dadurch fuer diesen Snapshot keine verfuegbare Vergleichsengine. Die Snapshot-Aktivierung wird nicht mehr durch R5 blockiert, weil `motis_one_to_all` als zertifizierte Produktions-Metrikengine erfolgreich abgeschlossen wurde.

## MOTIS

Ausgeführt:

```bash
GTFS_PATH=data/raw/delfi/gtfs-deutschland-gesamt.zip OSM_PBF_PATH=data/raw/osm/germany-latest.osm.pbf npm run routing:build:motis
```

Ergebnisse:

- MOTIS Release: `v2.10.2`
- Asset: `motis-macos-arm64.tar.bz2`
- Plattform: `macos-arm64`
- Importdauer: 806.53 s
- Status: `built`
- Graph: `data/routing/motis/graph`
- Graphgröße: 21 GB, davon `data/`: 16 GB

Server-Smoke:

```bash
/Users/dw/Projects/regionfinder/data/routing/motis/bin/motis server -d data --log-level info
```

Server lief lokal auf `http://localhost:8080`.
Der selbst gestartete Server wurde nach den Smoke-Queries kontrolliert beendet; Port `8080` war danach frei.

Reale Query:

- Origin per MOTIS-Geocode: `gtfs_de:02000:10950_G` (`Hauptbahnhof/ZOB`)
- Ziel per MOTIS-Geocode: `gtfs_de:01060:37960` (`Kaltenkirchen`)
- Request: `GET /api/v5/plan`
- Wunschzeit: `2026-06-24T08:00:00+02:00`
- Ergebnis: 3 Itineraries, gespeichert in `data/reports/motis-plan-kaltenkirchen.json`

Beispielalternative:

- Start: `2026-06-24T06:01:00Z`
- Ankunft: `2026-06-24T07:20:00Z`
- Dauer: 4,740 s
- Legs: WALK Hamburg Hbf -> Hauptbahnhof Süd, U1 -> Norderstedt Mitte, WALK, A2 -> Quickborner Straße, WALK, A2 -> Kaltenkirchen.

## Datenbank

PostGIS läuft über Docker Compose auf Port `55432`.

DB-Größe nach Import: 17 GB.

Migrationen ausgeführt:

- `001_core_schema.sql`
- `002_snapshot_activation.sql`
- `003_admin_boundaries.sql`
- `004_rail_network.sql`
- `005_tile_hover_indexes.sql`

## API und Frontend

Produktions-API verifiziert auf Port `4001` mit:

```bash
DATABASE_URL=postgres://regionfinder:regionfinder@localhost:55432/regionfinder REGIONFINDER_API_PORT=4001 npm run dev:api
```

Gepruefte Endpunkte:

- `GET /ready`: `{"status":"ready","snapshotId":"delfi-bb69c7e2c8d5"}`
- `GET /api/v1/snapshots/current`: DELFI-Snapshot, DELFI-Hash und OSM-Hash korrekt.
- `GET /api/v1/stops/search`: reale Ziele in Hamburg, Schleswig-Holstein und Niedersachsen gefunden; Mecklenburg-Vorpommern ist ueber DB-Zaehlung abgedeckt.
- `GET /api/v1/stops/de:01002:49079/metrics?profile=regular_tue_thu&date=2026-09-15`: reale Kiel-Hbf-Metriken aus `motis_one_to_all` plus tagesgenaue Direktverbindungszahl.
- `GET /api/v1/stops/de:01002:49079/itineraries?date=2026-09-15&time=08:00&profile=regular_tue_thu`: reale MOTIS-Verbindung Hamburg Hbf -> Kiel Hbf.
- `GET /api/v1/stops/de:01060:37985:1:8000526/realtime-itineraries?date=2026-09-15&time=08:00&profile=regular_tue_thu`: DB-Echtzeitvergleich Hamburg Hbf -> Altengörs mit normalisierten Alternativen, sofern das externe Backend den Zielort auflösen kann.
- `GET /api/v1/route-patterns/723cebcb-90e7-4336-878f-bdb4bfc2f635`: reales Route Pattern mit offizieller GTFS-Shape.
- `GET /api/v1/tiles/stops/8/135/83.mvt`: reale MVT-Kachel, 416.615 Bytes.
- `GET /api/v1/tiles/stops/{z}/{x}/{y}.mvt?modes=...`: serverseitig nach Verkehrsmitteln gefilterte StopPlace-Kacheln.
- `GET /api/v1/tiles/routes/{z}/{x}/{y}.mvt?modes=...`: serverseitig nach Verkehrsmitteln gefilterte Route-Pattern-Kacheln.
- `GET /api/v1/tiles/rail-network/{z}/{x}/{y}.mvt`: OSM-Schienenkanten aus `rail_edges`.

MapLibre-/API-Modus wurde mit Vite verifiziert:

```bash
VITE_REGIONFINDER_DATA_MODE=api VITE_REGIONFINDER_API_BASE_URL=http://127.0.0.1:4001 npm run dev -- --host 127.0.0.1 --port 5176
```

Der ausgelieferte Vite-Code enthaelt `VITE_REGIONFINDER_DATA_MODE="api"` und `VITE_REGIONFINDER_API_BASE_URL="http://127.0.0.1:4001"`.

Nachgezogene UI-/Kartenfunktionen:

- Basiskarten-Umschalter zwischen CARTO/OSM-Straßenkarte und Esri-Satellit; beide Modi verwenden ein CARTO-Ortslabel-Overlay.
- StopPlaces aus MVT-Kacheln sind anklickbar und laden das API-Detailpanel.
- Verkehrsmittel-Checkboxen filtern die MVT-Kacheln.
- Die frühere Sidebar-Suche und Suchtrefferliste ist im API-UI entfernt. StopPlace-Details werden über Klick auf MVT-StopPlaces in der Karte geöffnet.
- Stop-MVT-Kacheln liefern Reisezeitmetrik, Stop-Priorität und kompakte Linienlabels für Styling/Hover und akzeptieren `profile`.
- MapLibre-Vector-Tile-Sources werden bei Moduswechsel entfernt und neu angelegt; `setTiles()` allein reicht nicht, weil alte ungefilterte Tiles sonst sichtbar bleiben können.
- Route Patterns verwenden echte GTFS-Farben aus `routes.color`, falls vorhanden; die Route-MVTs liefern dafür `route_color`.
- Fehlt eine echte Farbe, nutzt das Frontend Modus-Fallbackfarben.
- Route Pattern-Anzeigegeometrien kommen über `route_pattern_display_geometries`, sodass hochkonfidente OSM-Rekonstruktionen sichtbar werden können.
- `osm_reconstructed_low_confidence` und `stop_sequence_approximation` bleiben im Standardlayer ausgeblendet; niedrigkonfidente OSM-Rekonstruktionen sind Diagnosematerial fuer gezielte Korridorarbeit.
- Das Detailpanel zeigt `DB Echtzeit` als Verbindungsabschnitt und rendert bis zu drei Live-Alternativen mit Plattformen, Verspätungen, Ausfallstatus und Remarks.
- Reisezeitfenster und Stop-Kreise nutzen dieselbe 30/45/60/75/90-Farbskala.
- Reisezeitfenster filtern sichtbare MVT-StopPlaces anhand von `fastest_seconds`.
- Wohnregionen sind geschätzte Kreise um alle aktuell sichtbaren verfügbaren Ziele, mit Legacy-Faktor `0,75 km/min` und 5/10/15/20-Minuten-Schaltflächen.
- Playwright ist als Dev-Dependency verfügbar und wurde für einen lokalen UI-Smoke-Test gegen API `4001` und Frontend `5176` genutzt.

Beispiel-Busziel nach dem aktuellen Profil:

- StopPlace: `de:01053:85184::851841`, `Niendorf/Stecknitz, Zum Herrenhaus`, Modi `BUS`
- Metrik: schnellste Zeit 4.080 s / 68 min
- Gegenrichtung/zweite Plattform `de:01053:85184::851846`: schnellste Zeit 4.140 s / 69 min

## Produktionsverifikation

Produktionsmetriken:

```bash
DATABASE_URL=postgres://regionfinder:regionfinder@localhost:55432/regionfinder \
npm run metrics:compute:production
```

Ergebnis:

```text
status: completed
engine: motis_one_to_all
metric_run_id: 4d9f96b5-f905-42cd-a5e1-2283e9b7bd7d
sample_count: 336
target_stop_places: 95870
reachable_stop_places: 30737
unreachable_stop_places: 65133
```

Ausgeführt:

```bash
DATABASE_URL=postgres://regionfinder:regionfinder@localhost:55432/regionfinder npm run verify:production
```

Ergebnis:

```text
{"status": "ok", "snapshot": "delfi-bb69c7e2c8d5", "metric_engine": "motis_one_to_all"}
```

## Tests

Ausgeführt:

```bash
npm run build
npm run test
npm run lint
```

Ergebnis:

- Build erfolgreich.
- Tests erfolgreich: 9 Testdateien, 41 Tests.
- Lint erfolgreich.

## Regionale Feeds

Die regionale Enrichment-Recherche ist dokumentiert in `docs/REGIONAL_FEED_COMPARISON.md`.

Ergebnis:

- HVV, VBN/Connect, VVW und Mobilithek wurden als offizielle Ausgangspunkte untersucht.
- Es wurde keine regionale GTFS-Datei ungeprueft als zweite Fahrplanwahrheit importiert.
- VVW/Mecklenburg-Vorpommern ist fuer den regionalen Feedzugang registrierungs- beziehungsweise freigabepflichtig.
- Spaetere regionale Nutzung bleibt auf deterministisches Enrichment begrenzt, solange keine Trip-Deduplizierung implementiert und getestet ist.

## Noch offen

- R5-TransportNetwork fuer den vollstaendigen Deutschland-PBF wurde nicht fertig gebaut.
- Reale R5-Batchmetriken wurden nicht berechnet; R5 bleibt optionale Vergleichsengine.
- Der aktuelle Produktlauf begrenzt die Maximaldauer fachlich auf 120 Minuten. Längere Erreichbarkeitsfragen sind bewusst außerhalb der aktuellen Produktmetrik.
- ZHV-Vollintegration wurde nicht ausgefuehrt; keine Zugangsdaten oder lokale ZHV-Exportdatei lagen vor.

## Nächste technische Schritte

1. R5 mit höherem Docker-RAM-Limit oder auf einer Linux-Maschine mit mehr Speicher erneut ausführen.
2. Nicht erreichbare StopPlaces des 120-Minuten-Produktlaufs nach Ursache clustern: außerhalb Zeitfenster, fehlender Service am Referenztag, MOTIS-Graph-/Transferluecke oder Stop-Mapping.
3. R5 und MOTIS anhand identischer Samples cross-validieren.
4. ZHV-Export nach Bereitstellung echter Zugangsdaten importieren.
