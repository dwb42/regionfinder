# Zielarchitektur

## Komponenten

```text
React/MapLibre Frontend
  -> Regionfinder API (Fastify, TypeScript)
     -> PostgreSQL/PostGIS
     -> pgRouting fuer OSM-Schienenrekonstruktion
     -> ItineraryProvider (MOTIS bevorzugt, R5-Fallback vorbereitet)
     -> RealtimeItineraryProvider (DB-Echtzeitvergleich serverseitig)
     -> Vector Tiles via ST_AsMVT

Pipeline (Python)
  -> GTFS/DELFI/ZHV/OSM/Admin-Grenzen validieren
  -> Snapshots importieren und normalisieren
  -> zertifizierte Batchmetriken berechnen: MOTIS one-to-all primaer, R5/r5py optional
  -> OSM-Schienen importieren und Route-Pattern-Anzeigegeometrien rekonstruieren
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
- Lokale Verbindungsauskunft: `ItineraryProvider`-Format ist über `src/api/contracts.ts` festgelegt. Die Produktions-API kann reale MOTIS-`/api/v5/plan`-Antworten aus dem lokalen Graph in das interne Antwortformat transformieren.
- DB-Echtzeitvergleich: `RealtimeItineraryProvider` liefert dasselbe `ApiItineraryResponse`-Format über `GET /api/v1/stops/:publicId/realtime-itineraries`. Die Abfrage läuft serverseitig; der Client erhält nur normalisierte Alternativen und Fehlercodes.
- Fixture-Provider: `server/db/fixtureRepository.ts` liefert lokale Testverbindungen ohne externe Fahrplanauskunft.

## DB-Echtzeitprovider

Implementierung: `server/realtime/dbTransportRestProvider.ts`.

Konfiguration:

- `REGIONFINDER_ORIGIN_DB_STOP_ID`, Default `8002549` Hamburg Hbf.
- `REGIONFINDER_REALTIME_PROVIDER`, Default `bahn-web`; Wert `db-transport-rest` erzwingt den Wrapper `v6.db.transport.rest`.
- `DB_TRANSPORT_REST_BASE_URL`, Default `https://v6.db.transport.rest`.

Mapping-Regeln:

- direkte 7-stellige EVA-/DB-IDs aus PublicId, DHID und technischen Stop-IDs bevorzugen,
- 8-stellige technische IDs mit fuehrender `1` auf 7-stellige EVA-ID kuerzen,
- danach Wrapper-`/locations/nearby` mit Koordinaten und Namensscore,
- danach Wrapper-`/locations` per Stationsname,
- unaufloesbare Ziele als `404 db_stop_unmapped`.

Cache-Regeln:

- Stop-ID-Mapping: 24 Stunden im API-Prozess.
- Journey-Antworten: 60 Sekunden pro Ursprung, Ziel und Abfahrtsminute.
- Upstream-/Timeoutfehler werden als `502 realtime_unavailable` abgebildet.

Der aktuelle Standardpfad `bahn-web` nutzt die bahn.de-Web-API mit Cookie-Warmup und kontrolliertem `curl`-Fallback, weil Node-`fetch` dort in der lokalen Verifikation blockiert werden kann. Der Wrapperpfad bleibt fuer Tests und explizite Konfiguration erhalten.

## API

Implementiert:

- `GET /health`
- `GET /ready`
- `GET /api/v1/snapshots/current`
- `GET /api/v1/stops/search`
- `GET /api/v1/stops/:publicId`
- `GET /api/v1/stops/:publicId/metrics`
- `GET /api/v1/stops/:publicId/itineraries`
- `GET /api/v1/stops/:publicId/realtime-itineraries`
- `GET /api/v1/route-patterns/:id`
- `GET /api/v1/tiles/stops/{z}/{x}/{y}.mvt`
- `GET /api/v1/tiles/routes/{z}/{x}/{y}.mvt`
- `GET /api/v1/tiles/rail-network/{z}/{x}/{y}.mvt`

Request-Validierung liegt in `server/schemas.ts`, gemeinsame Antworttypen in `src/api/contracts.ts`.

## Frontend

`VITE_REGIONFINDER_DATA_MODE=api` aktiviert `src/ApiApp.tsx` mit MapLibre und API-Zugriff. `legacy` hält den bisherigen Leaflet/HVV-JSON-Pfad verfügbar. Der Browser soll im API-Modus keine großen Fahrplandateien laden.

Aktueller API-Modus:

- StopPlaces und Route Patterns werden über MapLibre-Vector-Tile-Sources geladen.
- Stop- und Route-Tile-Endpunkte akzeptieren `modes` als CSV-Queryparameter. Stop-Tiles akzeptieren zusätzlich `profile`, damit Metrikfarben aus dem passenden Metric Run kommen.
- Die Layer-Checkboxen (`Regional/Fern`, `S-Bahn/AKN`, `U-Bahn`, `Bus`, `Fähre`) filtern nicht nur Suchtreffer, sondern auch die MVT-Quellen.
- Der Client entfernt und erneuert die MapLibre-Quellen bei Moduswechseln, damit keine alten ungefilterten Tiles im MapLibre-Cache sichtbar bleiben.
- StopPlace-MVT-Features sind anklickbar und öffnen das Detailpanel.
- Basiskarten sind CARTO/OSM-Straßenkarte und Esri-Satellit. Beide nutzen ein gemeinsames CARTO-Ortslabel-Overlay, damit Ortsnamen in beiden Modi sichtbar sind.
- Das Detailpanel rendert DB-Echtzeitverbindungen unter der Überschrift `DB Echtzeit`; lokale `/itineraries` werden dort nicht als eigener Block angezeigt.
- Route Patterns verwenden echte GTFS-Route-Farben aus `routes.color`, wenn vorhanden; sonst Fallbackfarben nach Modus.
- Stopfolgen-Approximationen sind gestrichelt, transparent und standardmäßig ausgeschaltet.
- Reisezeitfenster-Chips und Stop-Kreise verwenden dieselbe Farbskala: 30 min grün, 45 min teal, 60 min ocker, 75 min orange, 90 min rot.

## Tile-Datenvertrag

Stop-MVT `stops` enthält mindestens:

- `public_id`
- `name`
- `state_code`
- `modes`
- `fastest_seconds`
- `route_labels`
- `route_count`
- `is_bus_only`
- `stop_priority`
- `geom`

Route-MVT `routes` enthält mindestens:

- `id`
- `short_name`
- `mode`
- `route_color`
- `geometry_quality`
- `geometry_source`
- `match_confidence`
- `match_status`
- `geom`

`route_color` wird im Repository auf `#RRGGBB` normalisiert, wenn der GTFS-Wert sechsstellige Hexnotation enthält. Fehlt eine Farbe, entscheidet das Frontend anhand von `mode`.

Route-Tiles verwenden `route_pattern_display_geometries` statt direkt `route_patterns.geometry`. Die View bevorzugt hochkonfidente OSM-Schienenrekonstruktionen, markiert niedrigkonfidente Rekonstruktionen als `osm_reconstructed_low_confidence` und fällt sonst auf die GTFS-Geometrie bzw. `stop_sequence_approximation` zurück.

Rail-Network-MVT `rail-network` enthält OSM-Schienenkanten aus `rail_edges` mit:

- `id`
- `osm_id`
- `railway`
- `service`
- `usage`
- `is_service`
- `geom`
