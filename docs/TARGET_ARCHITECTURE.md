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
  -> offizielle Schulstandorte als snapshot-unabhängige POIs importieren
  -> Qualitätsberichte und Artefakt-Hashes speichern
```

## Datenfluss

1. Quelldateien werden lokal bereitgestellt: `DELFI_GTFS_PATH`, `ZHV_STOPS_PATH`, `OSM_PBF_PATH`, `ADMIN_BOUNDARIES_PATH`.
2. Die Pipeline validiert Hashes, Pflichtdateien, Kalender, Stop-Hierarchie, Shapes, Transfers und Pathways.
3. Der Import erzeugt einen unveränderlichen Snapshot in PostGIS.
4. Eine zertifizierte Metrikengine berechnet Metriken ueber konkrete Fahrplandaten und gewuenschte Abfahrtszeitpunkte.
   Fuer den Produktionssnapshot `delfi-bb69c7e2c8d5` ist `motis_one_to_all` die aktive Engine.
5. Ein Snapshot wird erst nach bestandenen Gates aktiv.
6. Snapshot-unabhängige Zusatzdaten wie Schulen werden in eigenen Tabellen importiert und über eigene MVT-Endpunkte bereitgestellt.
7. Das Frontend lädt im API-Modus nur API-Antworten und MVT-Kacheln.

## Snapshot-Lebenszyklus

Statuswerte stehen in `db/migrations/001_core_schema.sql`: `created`, `raw_validated`, `importing`, `imported`, `normalized`, `routing_ready`, `metrics_ready`, `active`, `failed`, `archived`.

`db/migrations/002_snapshot_activation.sql` aktiviert Snapshots transaktional. Es gibt über einen partiellen Unique-Index höchstens einen aktiven Snapshot.

## Routing-Engines

- Batchmetriken: `motis_one_to_all` berechnet aktuell die Produktmetrik `fastestSeconds` als schnellste planmäßige Gesamtreisezeit zum exakten Ziel-StopPlace. Der Batch nutzt ein repräsentatives Werktagsprofil, 120 Minuten Maximaldauer, Transit und initialen Fußweg zum Einstieg, aber keinen finalen Fußweg zu Nachbarhaltestellen. R5/r5py bleibt Vergleichs- und Performance-Engine, blockiert aber keinen Snapshot, wenn MOTIS den Produktionslauf abgeschlossen hat.
- Lokale Verbindungsauskunft: `ItineraryProvider`-Format ist über `src/api/contracts.ts` festgelegt. Die Produktions-API kann reale MOTIS-`/api/v5/plan`-Antworten aus dem lokalen Graph in das interne Antwortformat transformieren.
- DB-Echtzeitvergleich: `RealtimeItineraryProvider` liefert dasselbe `ApiItineraryResponse`-Format über `GET /api/v1/stops/:publicId/realtime-itineraries`. Die Abfrage läuft serverseitig; der Client erhält nur normalisierte Alternativen und Fehlercodes. Die UI steuert die Startzeit im Detailpanel und bietet `Frühere`/`Spätere`-Navigation.
- Fixture-Provider: `server/db/fixtureRepository.ts` liefert lokale Testverbindungen ohne externe Fahrplanauskunft. Fixture-Modus wird nur explizit mit `REGIONFINDER_USE_FIXTURE_API=1` aktiviert; ohne `DATABASE_URL` darf der API-Start nicht still auf Fixtures fallen.

## DB-Echtzeitprovider

Implementierung: `server/realtime/dbTransportRestProvider.ts` als Provider-Orchestrator. Clients, Stop-Mapping, Journey-Mapping und TTL-Cache liegen in separaten Modulen unter `server/realtime/`.

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
- `GET /api/v1/stops/:publicId/driving-route`
- `GET /api/v1/route-patterns/:id`
- `GET /api/v1/tiles/stops/{z}/{x}/{y}.mvt`
- `GET /api/v1/tiles/routes/{z}/{x}/{y}.mvt`
- `GET /api/v1/tiles/rail-network/{z}/{x}/{y}.mvt`
- `GET /api/v1/tiles/schools/{z}/{x}/{y}.mvt`

Request-Validierung liegt in `server/schemas.ts`, gemeinsame Antworttypen in `src/api/contracts.ts`.

## Frontend

Das Frontend nutzt ausschließlich den API-Pfad mit MapLibre und Regionfinder-API-Zugriff. `src/App.tsx` startet `src/ApiApp.tsx`; innerhalb des API-Pfads wird `MapLibreCanvas` separat lazy geladen. Der Browser soll keine großen Fahrplandateien laden.

Frontend-Code im API-Pfad ist nach Zuständigkeit aufgeteilt:

- `src/ApiApp.tsx`: Layout und Verdrahtung.
- `src/apiApp/hooks.ts`: API-Startup, Detailpanel-Daten und Map-Update-Status.
- `src/apiApp/MapLibreCanvas.tsx`: imperative MapLibre-Integration.
- `src/apiApp/mapLayers.ts`: MapLibre-Styles, Layer, MVT-URLs und Feature-Popup-Inhalte.
- `src/apiApp/formatters.ts` und `src/apiApp/ItineraryComponents.tsx`: Anzeigeformatierung und Detailpanel-Bausteine.

Aktueller API-Modus:

- StopPlaces und Route Patterns werden über MapLibre-Vector-Tile-Sources geladen.
- Stop- und Route-Tile-Endpunkte akzeptieren `modes` als CSV-Queryparameter. Stop-Tiles akzeptieren zusätzlich `profile`, damit Metrikfarben aus dem passenden Metric Run kommen.
- Die Layer-Checkboxen (`Regional/Fern`, `S-Bahn/AKN`, `U-Bahn`, `Bus`) filtern die MVT-Quellen.
- Der Client entfernt und erneuert die MapLibre-Quellen bei Moduswechseln, damit keine alten ungefilterten Tiles im MapLibre-Cache sichtbar bleiben.
- StopPlace-MVT-Features sind anklickbar und öffnen das Detailpanel.
- Die frühere Sidebar-Suche und Suchtrefferliste ist im API-UI entfernt; der Suchendpunkt bleibt nur technische API-Oberfläche.
- Basiskarten sind CARTO/OSM-Straßenkarte und Esri-Satellit. Beide nutzen ein gemeinsames CARTO-Ortslabel-Overlay, damit Ortsnamen in beiden Modi sichtbar sind.
- Das Detailpanel rendert DB-Echtzeitverbindungen unter der Überschrift `DB Echtzeit`; lokale `/itineraries` werden dort nicht als eigener Block angezeigt.
- Der Metrikblock zeigt `fastestSeconds` und eine tagesgenaue Direktverbindungszahl aus `directConnectionCount`, wenn `metrics` mit `date=YYYY-MM-DD` abgefragt wird.
- Datenstand und technische StopPlace-Details sind einklappbar.
- Route Patterns verwenden echte GTFS-Route-Farben aus `routes.color`, wenn vorhanden; sonst Fallbackfarben nach Modus.
- Hochkonfidente OSM-Rekonstruktionen werden im Standardlayer angezeigt. Niedrigkonfidente Rekonstruktionen und Stopfolgen-Approximationen bleiben im Standardlayer ausgeblendet, bis ihre Qualität visuell belastbar ist.
- Reisezeitfenster-Chips und Stop-Kreise verwenden dieselbe Farbskala: 30 min grün, 45 min teal, 60 min ocker, 75 min orange, 90 min rot.
- Reisezeitfenster filtern MVT-StopFeatures anhand von `fastest_seconds`. Umstiegsfilter und `Unerreichbare anzeigen` sind nicht Teil der aktuellen API-UI.
- Wohnregionen sind geschätzte Kreise um alle aktuell sichtbaren verfügbaren Ziele. Der Radius verwendet den Schätzfaktor `0,75 km/min`; UI-Optionen sind 5/10/15/20 Minuten.
- Zusatzlayer werden im Sidebar-Block `anzeigen` geführt. Der Schools-Layer ist in zwei Checkboxen getrennt: `Gymnasium` und `andere weiterf. Schulen`. Beide sind standardmäßig aktiv.
- Schul-POIs werden als eigener MVT-Layer geladen, nicht durch ÖPNV-Modi oder Reisezeitfenster gefiltert. Das Frontend filtert sie ausschließlich über `categories` und legt die MapLibre-Quelle bei Kategorienwechsel neu an.
- Gymnasien sind in der Karte farblich hervorgehoben; andere weiterführende Schulen sind neutral markiert. Hover zeigt Name und offizielle Schulart. Klick öffnet im ersten Schritt kein Detailpanel.
- Die Karte besitzt eine metrische Maßstabsleiste unten rechts.

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

`fastest_seconds` stammt aus dem neuesten abgeschlossenen Metric Run des angefragten Profils. Die API-Metrikantwort ist schlanker als die historische `od_metrics`-Tabelle und veröffentlicht keine Median-/P90-/Reachability- oder Transferaggregate mehr.

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

Route-Tiles verwenden `route_pattern_display_geometries` statt direkt `route_patterns.geometry`. Die View bevorzugt hochkonfidente OSM-Schienenrekonstruktionen, markiert niedrigkonfidente Rekonstruktionen als `osm_reconstructed_low_confidence` und fällt sonst auf die GTFS-Geometrie bzw. `stop_sequence_approximation` zurück. Der API-Client filtert im Standardlayer zusätzlich niedrigkonfidente Rekonstruktionen und Stopfolgen-Approximationen aus; diese Qualitätsstufen sind Diagnosematerial, keine präzise Standardstrecke.

Rail-Network-MVT `rail-network` enthält OSM-Schienenkanten aus `rail_edges` mit:

- `id`
- `osm_id`
- `railway`
- `service`
- `usage`
- `is_service`
- `geom`

Schools-MVT `schools` enthält POIs aus der snapshot-unabhängigen Tabelle `schools`:

- `id`
- `name`
- `school_category`
- `school_type_label`
- `state_code`
- `geom`

Queryparameter:

- `categories`: CSV aus `gymnasium`, `comprehensive`, `waldorf`, `vocational`, `upper_secondary`
- `states`: CSV aus `HH`, `SH`, `MV`, `NI`

Schools-Tiles werden unabhängig von Routingprofil, Reisezeitfenstern und Verkehrsmittel-Layern geladen.

## OSM-Schienenmatching

Die OSM-Rekonstruktion ist als Batch-Pipeline ausgelegt:

1. Rail-only-PBF mit osmium aus der Geofabrik-PBF erzeugen.
2. Gefilterte PBF mit osm2pgsql nach `staging_osm_rail_*` importieren.
3. `rail_edges` und `rail_vertices` aus aktiven OSM-Schienenlinien erzeugen.
4. StopPlaces auf Schienenkanten snappen.
5. Route-Pattern-Segmente mit pgRouting zwischen gesnappten Stops routen.
6. Ergebnis mit Confidence und Status in `route_pattern_rail_matches` speichern.

Lokale Match-Nachläufe sollen klein geschnitten werden. `pipeline/rail_network.py` unterstützt dafür:

- `--modes`: GTFS-/DELFI-Modusfilter.
- `--routes`: CSV von Linienlabels, z.B. `U1,S1,RE8,RB81`.
- `--bbox`: freie Bounding Box.
- `--corridor`: benannte Korridore wie `hamburg-luebeck` oder `hamburg-kiel`.

Große Komplettläufe ueber `RAIL` oder Norddeutschland sind lokal weiterhin zu teuer und liefern schwer auswertbare Qualitätsmischungen. Bevorzugtes Pattern ist: eine Linienfamilie in einem Korridor rechnen, visuell prüfen, dann den nächsten Korridor nachziehen.
