# Zielarchitektur

## Komponenten

```text
React/MapLibre Frontend
  -> Regionfinder API (Fastify, TypeScript)
     -> PostgreSQL/PostGIS
     -> ItineraryProvider (MOTIS bevorzugt, R5-Fallback vorbereitet)
     -> Vector Tiles via ST_AsMVT

Pipeline (Python)
  -> GTFS/DELFI/ZHV/OSM/Admin-Grenzen validieren
  -> Snapshots importieren und normalisieren
  -> zertifizierte Batchmetriken berechnen: MOTIS one-to-all primaer, R5/r5py optional
  -> Qualitätsberichte und Artefakt-Hashes speichern
```

## Datenfluss

1. Quelldateien werden lokal bereitgestellt: `DELFI_GTFS_PATH`, `ZHV_STOPS_PATH`, `OSM_PBF_PATH`, `ADMIN_BOUNDARIES_PATH`.
2. Die Pipeline validiert Hashes, Pflichtdateien, Kalender, Stop-Hierarchie, Shapes, Transfers und Pathways.
3. Der Import erzeugt einen unveränderlichen Snapshot in PostGIS.
4. Eine zertifizierte Metrikengine berechnet Metriken ueber konkrete Fahrplandaten und gewuenschte Abfahrtszeitpunkte.
   Fuer den Produktionssnapshot `delfi-bb69c7e2c8d5` ist `motis_one_to_all` die aktive Engine.
5. Ein Snapshot wird erst nach bestandenen Gates aktiv.
6. Das Frontend lädt im API-Modus nur API-Antworten und MVT-Kacheln.

## Snapshot-Lebenszyklus

Statuswerte stehen in `db/migrations/001_core_schema.sql`: `created`, `raw_validated`, `importing`, `imported`, `normalized`, `routing_ready`, `metrics_ready`, `active`, `failed`, `archived`.

`db/migrations/002_snapshot_activation.sql` aktiviert Snapshots transaktional. Es gibt über einen partiellen Unique-Index höchstens einen aktiven Snapshot.

## Routing-Engines

- Batchmetriken: `motis_one_to_all` und `r5py` sind zertifizierte Engines. Mindestens ein abgeschlossener Lauf einer zertifizierten Engine ist ein Aktivierungs-Gate. R5/r5py bleibt Vergleichs- und Performance-Engine, blockiert aber keinen Snapshot, wenn MOTIS den Produktionslauf abgeschlossen hat.
- Verbindungsauskunft: `ItineraryProvider`-Format ist über `src/api/contracts.ts` festgelegt. Die Produktions-API kann reale MOTIS-`/api/v5/plan`-Antworten aus dem lokalen Graph in das interne Antwortformat transformieren.
- Fixture-Provider: `server/db/fixtureRepository.ts` liefert lokale Testverbindungen ohne externe Fahrplanauskunft.

## API

Implementiert:

- `GET /health`
- `GET /ready`
- `GET /api/v1/snapshots/current`
- `GET /api/v1/stops/search`
- `GET /api/v1/stops/:publicId`
- `GET /api/v1/stops/:publicId/metrics`
- `GET /api/v1/stops/:publicId/itineraries`
- `GET /api/v1/route-patterns/:id`
- `GET /api/v1/tiles/stops/{z}/{x}/{y}.mvt`
- `GET /api/v1/tiles/routes/{z}/{x}/{y}.mvt`

Request-Validierung liegt in `server/schemas.ts`, gemeinsame Antworttypen in `src/api/contracts.ts`.

## Frontend

`VITE_REGIONFINDER_DATA_MODE=api` aktiviert `src/ApiApp.tsx` mit MapLibre und API-Zugriff. `legacy` hält den bisherigen Leaflet/HVV-JSON-Pfad verfügbar. Der Browser soll im API-Modus keine großen Fahrplandateien laden.

Aktueller API-Modus:

- StopPlaces und Route Patterns werden über MapLibre-Vector-Tile-Sources geladen.
- Beide Tile-Endpunkte akzeptieren `modes` als CSV-Queryparameter.
- Die Layer-Checkboxen (`Regional/Fern`, `S-Bahn/AKN`, `U-Bahn`, `Bus`, `Fähre`) filtern nicht nur Suchtreffer, sondern auch die MVT-Quellen.
- Der Client entfernt und erneuert die MapLibre-Quellen bei Moduswechseln, damit keine alten ungefilterten Tiles im MapLibre-Cache sichtbar bleiben.
- StopPlace-MVT-Features sind anklickbar und öffnen das Detailpanel.
- Basiskarten sind OpenStreetMap-Straßenkarte und Esri-Satellit mit Esri-Label-Overlay.
- Route Patterns verwenden echte GTFS-Route-Farben aus `routes.color`, wenn vorhanden; sonst Fallbackfarben nach Modus.
- Stopfolgen-Approximationen sind gestrichelt, transparent und standardmäßig ausgeschaltet.

## Tile-Datenvertrag

Stop-MVT `stops` enthält mindestens:

- `public_id`
- `name`
- `state_code`
- `modes`
- `geom`

Route-MVT `routes` enthält mindestens:

- `id`
- `short_name`
- `mode`
- `route_color`
- `geometry_quality`
- `geom`

`route_color` wird im Repository auf `#RRGGBB` normalisiert, wenn der GTFS-Wert sechsstellige Hexnotation enthält. Fehlt eine Farbe, entscheidet das Frontend anhand von `mode`.
