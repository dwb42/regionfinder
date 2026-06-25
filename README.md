# Regionfinder

Regionfinder ist inzwischen eine zweigleisige Anwendung:

- **API-/Produktionsmodus**: React 19, Vite, TypeScript, MapLibre, Fastify, PostgreSQL/PostGIS/pgRouting, MOTIS-Metriken, DB-Echtzeitvergleich und Mapbox Vector Tiles.
- **Legacy-Modus**: die ursprüngliche Leaflet/HVV-JSON-Anwendung bleibt als Vergleichs- und Fallbackpfad erhalten.

Der produktive Pfad nutzt den aktiven DELFI-Snapshot `delfi-bb69c7e2c8d5` aus PostGIS. Der alte Browser-Worker ist nicht mehr die kanonische Routing- oder Metriklogik.

## Setup

```bash
npm install
docker compose up -d postgis
npm run db:migrate
```

Produktiver API-/Frontend-Modus mit lokalem PostGIS:

```bash
DATABASE_URL=postgres://regionfinder:regionfinder@localhost:55432/regionfinder \
REGIONFINDER_API_PORT=4001 \
npm run dev:api

VITE_REGIONFINDER_DATA_MODE=api \
VITE_REGIONFINDER_API_BASE_URL=http://127.0.0.1:4001 \
npm run dev -- --host 127.0.0.1 --port 5176
```

Frontend-URL in der lokalen Entwicklungsumgebung: `http://localhost:5176/`.

Fixture-API für Tests:

```bash
REGIONFINDER_USE_FIXTURE_API=1 npm run dev:api
VITE_REGIONFINDER_DATA_MODE=api npm run dev
```

Legacy-Modus:

```bash
VITE_REGIONFINDER_DATA_MODE=legacy npm run dev
```

## Befehle

```bash
npm run dev                         # Vite-Frontend
npm run dev:api                     # Fastify-API
npm run build                       # TypeScript- und Produktionsbuild
npm run test                        # Vitest
npm run lint                        # ESLint
npm run check                       # Build, Tests und Lint
npx playwright install chromium     # Browser-Binary fuer lokale Playwright-Smoke-Tests
npm run db:migrate                  # PostGIS-Migrationen
npm run import:hvv                  # Legacy-HVV-JSON-Artefakte
npm run pipeline:import:synthetic   # synthetischen GTFS-Fixture-Snapshot importieren
npm run rail:reconstruct            # OSM-Schienen importieren und Route-Patterns rekonstruieren
npm run pipeline:compute            # Fixture-Metriken berechnen
npm run metrics:compute:production  # Produktionsmetriken mit MOTIS one-to-all
npm run verify:production           # Produktionssnapshot verifizieren
```

OSM-Schienenrekonstruktion nutzt standardmäßig `data/raw/osm/germany-latest.osm.pbf` und lädt die PBF per Docker/osm2pgsql in `staging_osm_rail_*`. Auf Docker Desktop wird ein lokales `DATABASE_URL` für den Import automatisch auf `host.docker.internal` umgesetzt; bei abweichenden Netzwerken `OSM2PGSQL_DATABASE_URL` setzen.

## Aktueller Produktionsstand

Aktiver Snapshot:

- Snapshot-ID: `delfi-bb69c7e2c8d5`
- Quelle: DELFI deutschlandweite Sollfahrplandaten GTFS
- GTFS-Gültigkeit: 2026-06-06 bis 2026-12-12
- GTFS-SHA-256: `bb69c7e2c8d50e6f923e397f5d39a17c4e514cb6e4e258473cff65798b5b902e`
- OSM-SHA-256: `d957290fe75a9f599ff3abd2a883328c58e0c67a1db332f15a11647e86d0e74d`
- BKG-Grenzen-SHA-256: `0a3c106a7537e1b47e97077d923c660e22510f73031463a420e7718c6f129e42`
- Status: aktiv in PostGIS

Importumfang:

- 533.066 StopPlaces
- 545.533 technische Stops
- 2.267.786 Trips
- 45.880.781 Stop-Times
- 303.549 Route Patterns
- Bundeslandgrenzen: `DE-HH`, `DE-SH`, `DE-MV`, `DE-NI`, `DE-HB`

Aktive Produktionsmetriken:

- Engine: `motis_one_to_all`
- MOTIS-Version: `v2.10.2`
- Metric Run: `c63c2468-e7c8-4260-9ac7-abc2f75d7e02`
- Profil: `regular_tue_thu`
- Sample-Basis: 2026-07-07, 05:00 bis GTFS 25:00, alle 5 Minuten
- Ziel-StopPlaces: 95.870

Hinweis: Der lokale Produktionslauf nutzt einen MOTIS-Reisehorizont von 240 Minuten. Das fachliche Zielprofil bleibt 12 Stunden; der vollständige 12-Stunden-Lauf ist als Performance-Restarbeit dokumentiert.

## API

Implementierte Endpunkte:

- `GET /health`
- `GET /ready`
- `GET /api/v1/snapshots/current`
- `GET /api/v1/stops/search?q=...&states=...&modes=...`
- `GET /api/v1/stops/:publicId`
- `GET /api/v1/stops/:publicId/metrics?profile=...`
- `GET /api/v1/stops/:publicId/itineraries?date=YYYY-MM-DD&time=HH:mm&profile=...`
- `GET /api/v1/stops/:publicId/realtime-itineraries?date=YYYY-MM-DD&time=HH:mm&profile=...`
- `GET /api/v1/route-patterns/:id`
- `GET /api/v1/tiles/stops/{z}/{x}/{y}.mvt?modes=...`
- `GET /api/v1/tiles/routes/{z}/{x}/{y}.mvt?modes=...`
- `GET /api/v1/tiles/rail-network/{z}/{x}/{y}.mvt`

Die Tile-Endpunkte filtern serverseitig nach Verkehrsmitteln. Stop-Tiles akzeptieren zusätzlich `profile`, damit Reisezeitfarben und Hover-Metriken aus dem passenden Metric Run kommen. Der Client entfernt und erneuert die MapLibre-Vector-Tile-Sources beim Umschalten der Layer, damit keine alten ungefilterten Tiles aus dem MapLibre-Cache sichtbar bleiben.

Der Realtime-Endpunkt wird serverseitig geladen. Standard ist aktuell das bahn.de-Web-Backend mit kontrolliertem `curl`-Fallback, weil Node-`fetch` dort geblockt werden kann. `REGIONFINDER_REALTIME_PROVIDER=db-transport-rest` schaltet explizit auf den Wrapper `v6.db.transport.rest`. Ursprung ist per Default Hamburg Hbf (`REGIONFINDER_ORIGIN_DB_STOP_ID=8002549`).

## Frontend

`src/ApiApp.tsx` ist der produktive API-Modus.

Wichtige UX-Entscheidungen:

- MapLibre statt Leaflet im API-Modus.
- Basiskarten-Umschalter:
  - CARTO/OSM-Straßenkarte ohne Labels plus CARTO-Ortslabel-Overlay
  - Esri World Imagery Satellit plus dasselbe CARTO-Ortslabel-Overlay
- StopPlaces und Route Patterns werden als MVTs geladen, nicht als vollständige JSON-Dateien.
- Stationen aus Vektor-Tiles sind anklickbar und öffnen rechts StopPlace-Details, Metriken, DB-Echtzeitverbindungen und Linien.
- Das Detailpanel zeigt unter `DB Echtzeit` bis zu drei Live-Alternativen ab der UI-Abfahrtszeit; lokale `/itineraries` werden dort nicht mehr als eigener Vergleichsblock gerendert.
- Verkehrsmittel-Layer:
  - `Regional/Fern`
  - `S-Bahn/AKN`
  - `U-Bahn`
  - `Bus`
  - `Fähre`
- Default: Schienenlayer sichtbar, Bus/Fähre aus.
- Route Patterns werden farbig dargestellt:
  - bevorzugt echte GTFS-Route-Farbe aus PostGIS/MVT (`route_color`)
  - Fallbackfarbe nach Modus
- Stopfolgen-Approximationen sind gestrichelt, transparenter und standardmäßig ausgeblendet.
- Reisezeitfenster, Umstiegsfilter, unerreichbare Ziele und Wohnregion-Radius sind im API-Modus wieder verfügbar.
- Reisezeitfenster und Stationskreise verwenden dieselbe 5-stufige Farbskala: 30 min grün, 45 min teal, 60 min ocker, 75 min orange, 90 min rot.

## Legacy-HVV-Pfad

Der Legacy-Modus nutzt weiterhin:

- `src/App.tsx`
- Leaflet/React-Leaflet
- `src/data/hvv.ts`
- statische Artefakte unter `public/data/hvv/`
- den alten Browser-Worker/Seed-Router

`public/data/hvv/stop-times.json` ist groß und darf nicht direkt im React-Frontend geladen werden.

HVV-Artefakte regenerieren:

```bash
npm run import:hvv -- --download
```

## Daten und Artefakte

Große Rohdaten, Routinggraphen, Reports und generierte Metriken liegen unter `data/` und sind über `.gitignore` geschützt. Versionierbar sind nur kleine Manifeste wie `data/source-manifest.json` und `data/runtime-capabilities.json`, falls sie bewusst als Laufdokumentation benötigt werden.

## Dokumentation

- `docs/CURRENT_STATE.md`: aktueller technischer Stand
- `docs/TARGET_ARCHITECTURE.md`: Zielarchitektur und aktive V2-Architektur
- `docs/PRODUCTION_DATA_INTEGRATION_REPORT.md`: Produktionsdaten, Hashes, Metriklauf
- `docs/TRAVEL_TIME_SEMANTICS.md`: Fahrzeitdefinitionen
- `docs/IMPORT_RUNBOOK.md`: Import-, API- und Metrikbefehle
- `docs/MIGRATION.md`: Legacy zu API-Modus
- `AGENTS.md`: Hinweise für zukünftige Coding-Sessions
