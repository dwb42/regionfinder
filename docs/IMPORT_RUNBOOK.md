# Import-Runbook

## Infrastruktur starten

```bash
docker compose up -d postgis
cp .env.example .env
DATABASE_URL=postgres://regionfinder:regionfinder@localhost:55432/regionfinder npm run db:migrate
```

Der lokale DB-Dienst nutzt das pgRouting-Image `pgrouting/pgrouting:16-3.5-4.0`. Das ist Voraussetzung für `db/migrations/004_rail_network.sql` und die OSM-Schienenrekonstruktion.

## Quellen bereitstellen

```bash
export DELFI_GTFS_PATH=/absolute/path/to/delfi-gtfs
export ZHV_STOPS_PATH=/absolute/path/to/zhv-stops.csv
export OSM_PBF_PATH=/absolute/path/to/norddeutschland.osm.pbf
export ADMIN_BOUNDARIES_PATH=/absolute/path/to/admin-boundaries.geojson
```

## Validieren

```bash
npm run pipeline:validate
```

Ohne `DELFI_GTFS_PATH` meldet die Pipeline den Vollimport als blockiert und validiert nur Fixtures.

## Synthetischen Feed prüfen

```bash
npm run pipeline:import:synthetic
npm run pipeline:compute
```

Die Berichte landen unter `dist/pipeline/` und sind generierte Artefakte.

## HVV-Integration

```bash
npm run import:hvv -- --download
```

HVV ist aktuell Legacy-/Integrationstestquelle. Der kanonische DELFI-Import ist erst mit bereitgestelltem Snapshot vollständig ausführbar.

## API starten

```bash
REGIONFINDER_USE_FIXTURE_API=1 npm run dev:api
npm run dev
```

Im produktiven Pfad wird `DATABASE_URL` gesetzt und `REGIONFINDER_USE_FIXTURE_API` weggelassen. Der API-Modus fällt nicht stillschweigend auf Fixtures zurück; ohne `DATABASE_URL` bricht der API-Start ab.

Produktiver API-/Frontend-Modus mit aktivem PostGIS-Snapshot:

```bash
DATABASE_URL=postgres://regionfinder:regionfinder@localhost:55432/regionfinder REGIONFINDER_API_PORT=4001 npm run dev:api
VITE_REGIONFINDER_DATA_MODE=api VITE_REGIONFINDER_API_BASE_URL=http://127.0.0.1:4001 npm run dev -- --host 127.0.0.1 --port 5176
```

Lokale Frontend-URL: `http://localhost:5176/`.

Hinweise:

- Es können mehrere Vite-Server parallel laufen; vor UI-Tests den tatsächlich genutzten Port prüfen.
- Nach Änderungen an `server/` den API-Prozess neu starten, wenn er mit `npm run dev:api` ohne Watch läuft.
- Nach Änderungen an MapLibre-Quellen oder Hook-Strukturen ist ein vollständiger Browser-Reload robuster als Vite-HMR.

## Produktionsmetriken

Primaere Engine fuer den aktuellen Produktionssnapshot ist MOTIS one-to-all. R5/r5py bleibt optional und ist kein Aktivierungs-Gate, solange ein abgeschlossener `motis_one_to_all`-Lauf existiert.

```bash
DATABASE_URL=postgres://regionfinder:regionfinder@localhost:55432/regionfinder \
REGIONFINDER_PRODUCTION_DATES=2026-07-07 \
REGIONFINDER_MOTIS_MAX_TRAVEL_MINUTES=240 \
npm run metrics:compute:production
```

Hinweis: `REGIONFINDER_MOTIS_MAX_TRAVEL_MINUTES=240` war in der lokalen 16-GB-/Docker-Umgebung der ausgefuehrte Produktionshorizont. Das fachliche Zielprofil bleibt bei 12 Stunden; der 12-Stunden-One-to-all-Lauf expandierte deutschlandweit auf mehr als 400.000 technische Orte pro Sample und ist als Performance-Restarbeit dokumentiert.

## OSM-Schienenrekonstruktion

Nach Datenbankmigration und bereitgestelltem OSM-PBF:

```bash
npm run rail:reconstruct
```

Standardwerte:

- `OSM_PBF_PATH=data/raw/osm/germany-latest.osm.pbf`
- `OSM_RAIL_PBF_PATH=data/processed/osm/germany-latest-railways.osm.pbf`, falls nicht explizit gesetzt
- `OSMIUM_IMAGE=iboates/osmium:latest`
- `OSM2PGSQL_IMAGE=iboates/osm2pgsql:latest`

Schritte:

1. OSM-PBF auf `railway=rail|light_rail|subway|tram` filtern.
2. Gefilterte PBF per osm2pgsql in `staging_osm_rail_*` laden.
3. `rail_edges` und `rail_vertices` aus aktiven Schienenlinien bauen.
4. StopPlaces mit Schienenmodus auf nahe Kanten snappen.
5. Route Patterns per pgRouting/Dijkstra zwischen gesnappten Stops rekonstruieren.
6. Ergebnisse in `route_pattern_rail_matches` speichern.

Optionen:

```bash
npm run rail:reconstruct -- --skip-osm-import
npm run rail:reconstruct -- --snapshot delfi-bb69c7e2c8d5 --modes RE,RB,S --bbox 9.0,53.0,11.0,54.2
npm run rail:reconstruct -- match-patterns --limit-patterns 100
npm run rail:reconstruct -- match-patterns --corridor=hamburg-luebeck --modes=RE,RB --routes=RE8,RB81
npm run rail:reconstruct -- match-patterns --bbox=8.3,52.9,11.6,54.4 --modes=S --routes=S1,S2,S3,S5,S7
```

Filter und Korridore:

- `--modes`: CSV der Verkehrsmittelmodi, z.B. `U`, `S`, `RE,RB` oder `RAIL`.
- `--routes`: CSV der Linienlabels aus `routes.short_name`/`long_name`/`source_route_id`, z.B. `U1,U2`, `A1,A2,A3`, `RE8,RB81`.
- `--bbox`: freie Bounding Box `minLon,minLat,maxLon,maxLat`.
- `--corridor`: benannte Bounding Box. Aktuell verfügbar: `hamburg-core`, `hamburg-altona-elmshorn`, `hamburg-luebeck`, `hamburg-lueneburg`, `hamburg-buchholz-bremen`, `hamburg-kiel`, `hamburg-buechen`.

Die bevorzugte lokale Arbeitsweise ist ein Korridor plus wenige Linienlabels. Große Komplettläufe ueber `RAIL` oder Norddeutschland sind lokal sehr langsam und schwer zu beurteilen.

Die Anzeige verwendet danach `route_pattern_display_geometries`: Konfidenz `>= 0.70` ersetzt die GTFS-/Fallback-Geometrie als `osm_reconstructed`, Konfidenz `>= 0.45` wird als `osm_reconstructed_low_confidence` markiert, darunter bleibt die ursprüngliche Route-Pattern-Geometrie aktiv. Der Standard-Frontendlayer zeigt nur hochkonfidente OSM-Rekonstruktionen an; niedrigkonfidente Rekonstruktionen bleiben Diagnosematerial, bis die Korridore visuell belastbar sind.

## Snapshot aktivieren

Nach Import, Qualitätsprüfung, Routinggraph und Metriken:

```sql
SELECT activate_snapshot('snapshot-public-id');
```

Fehlgeschlagene Importe dürfen keinen aktiven Snapshot überschreiben.

## API-/Kartenprüfung

Readiness:

```bash
curl http://127.0.0.1:4001/ready
```

Gefilterte Tile-Prüfung ohne Bus/Fähre:

```bash
curl -o /tmp/routes.mvt \
  'http://127.0.0.1:4001/api/v1/tiles/routes/8/135/82.mvt?modes=ICE%2CIC%2CEC%2CRE%2CRB%2CRAIL%2CS%2CAKN%2CU'
```

Die API-Modus-Karte muss bei deaktiviertem `Bus` und `Fähre` gefilterte MVT-URLs mit `?modes=...` anfragen. Der Client entfernt und erneuert die MapLibre-Quellen beim Umschalten, damit alte ungefilterte Tiles nicht im Cache sichtbar bleiben.

Stop-Tiles müssen zusätzlich das aktive Routingprofil enthalten, damit Reisezeitfarben und Hover-Metriken aus dem passenden Metric Run stammen:

```bash
curl -o /tmp/stops.mvt \
  'http://127.0.0.1:4001/api/v1/tiles/stops/8/135/83.mvt?modes=ICE%2CIC%2CEC%2CRE%2CRB%2CRAIL%2CS%2CAKN%2CU&profile=regular_tue_thu'
```

DB-Echtzeitprüfung:

```bash
curl 'http://127.0.0.1:4001/api/v1/stops/de%3A01060%3A37985%3A1%3A8000526/realtime-itineraries?date=2026-07-07&time=08%3A00&profile=regular_tue_thu'
```

Erwartung: normalisierte `ApiItineraryResponse` mit bis zu drei Alternativen ab Hamburg Hbf. Fehlercodes sind `db_stop_unmapped` für nicht gemappte Ziele und `realtime_unavailable` für Upstream-/Timeoutprobleme.

Tagesgenaue Direktverbindungen im Metrikblock prüfen:

```bash
curl 'http://127.0.0.1:4001/api/v1/stops/de%3A01060%3A37985%3A1%3A8000526/metrics?profile=regular_tue_thu&date=2026-07-07'
```

Erwartung: `directConnectionCount` enthält die Anzahl fahrplanmäßiger direkter Trips ohne Umstieg am angegebenen Datum.
