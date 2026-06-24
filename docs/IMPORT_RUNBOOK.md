# Import-Runbook

## Infrastruktur starten

```bash
docker compose up -d postgis
cp .env.example .env
npm run db:migrate
```

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

Im produktiven Pfad wird `DATABASE_URL` gesetzt und `REGIONFINDER_USE_FIXTURE_API` weggelassen. Der API-Modus darf nicht stillschweigend auf Fixtures zurückfallen.

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
