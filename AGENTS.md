# AGENTS

Projektbezogene Hinweise für zukünftige Coding-Sessions.

## Arbeitsstand

- Dieses Verzeichnis ist ein Git-Repository auf Branch `main` mit Remote `origin`.
- Es können mehrere Vite-Server parallel laufen. Vor UI-Tests den tatsächlich genutzten Port prüfen.
- Der aktuelle API-/Produktionsmodus läuft typischerweise auf:
  - API: `http://127.0.0.1:4001`
  - Frontend: `http://localhost:5176/`
- Playwright ist als Dev-Dependency installiert; lokale UI-Smoke-Tests brauchen einmalig `npx playwright install chromium`.
- Große Produktionsdaten, Routinggraphen und Reports liegen unter `data/` und sind überwiegend per `.gitignore` ausgeschlossen.

## Standardprüfung

Nach Codeänderungen ausführen:

```bash
npm run build
npm run test
npm run lint
```

## Entwicklungsumgebung

PostGIS:

```bash
docker compose up -d postgis
DATABASE_URL=postgres://regionfinder:regionfinder@localhost:55432/regionfinder npm run db:migrate
```

Der Compose-DB-Container nutzt `pgrouting/pgrouting:16-3.5-4.0`, nicht das reine PostGIS-Image. pgRouting wird für die OSM-Schienenrekonstruktion benötigt.

Produktiver API-Modus:

```bash
DATABASE_URL=postgres://regionfinder:regionfinder@localhost:55432/regionfinder REGIONFINDER_API_PORT=4001 npm run dev:api
VITE_REGIONFINDER_API_BASE_URL=http://127.0.0.1:4001 npm run dev -- --host 127.0.0.1 --port 5176
```

Ohne `DATABASE_URL` startet die API nicht automatisch mit Fixtures. Für isolierte Tests/Demos muss Fixture explizit gesetzt werden:

```bash
REGIONFINDER_USE_FIXTURE_API=1 npm run dev:api
```

Wenn `server/` geändert wurde, den API-Prozess neu starten. Wenn MapLibre-Quellen oder Hook-Strukturen geändert wurden, den Browser hart neu laden statt sich allein auf HMR zu verlassen.

## Datenimport

Produktionsdaten:

- aktiver Snapshot: `delfi-bb69c7e2c8d5`
- kanonische Fahrplanquelle: DELFI-GTFS
- aktuelle Produktionsmetriken: `motis_one_to_all`, Definition `2026-06-25.fastest-day-exact-stop`
- aktueller Metric Run: `4d9f96b5-f905-42cd-a5e1-2283e9b7bd7d`
- Profil `regular_tue_thu`: repräsentativer Werktag `2026-09-15`, 00:00 bis GTFS 28:00, 5-Minuten-Samples, Maximaldauer 120 Minuten
- R5/r5py: optionaler Vergleichsweg, kein Aktivierungs-Gate

Details stehen in `docs/PRODUCTION_DATA_INTEGRATION_REPORT.md`.

Weiterführende Schulen:

```bash
npm run schools:import
```

Das Script importiert offizielle Schulstandortdaten in die snapshot-unabhängige Tabelle `schools`. Erwartete lokale Quellen:

- `data/raw/schools/hamburg.geojson|csv`
- `data/raw/schools/schleswig-holstein.geojson|csv`
- `data/raw/schools/mecklenburg-vorpommern.geojson|csv`
- `data/raw/schools/niedersachsen.geojson|csv`

Aktueller importierter Stand: 1.466 darstellbare Standorte in `HH`, `SH`, `MV`, `NI`. Kategorien: `gymnasium`, `comprehensive`, `waldorf`, `vocational`, `upper_secondary`. SH-Quelle ist TSV mit Schulart-Bitmasken; der Importer dekodiert diese. Für GML/Shapefile-Quellen vorher per GDAL nach EPSG:4326-GeoJSON konvertieren. Wenige SH-Standorte ohne Koordinaten sind per Adress-Geocoding ergänzt; bei Datenaktualisierung diese Fallbacks prüfen.

Generische Places und Ferienhöfe:

```bash
npm run py:install
npm run places:research:ferienhoefe:landreise
npm run places:research:ferienhoefe -- --scan-osm --scan-osm-ways --osm-pbf data/processed/osm/north-germany-regionfinder.osm.pbf
DATABASE_URL=postgres://regionfinder:regionfinder@localhost:55432/regionfinder npm run places:import -- --source data/raw/places/ferienhoefe/ferienhoefe_candidates.csv --source-id ferienhoefe_web_research --replace-source --clip-to-admin-boundaries --report data/reports/places/ferienhoefe-import.json
```

`places` ist ein snapshot-unabhängiger POI-Bestand fuer `hof`, `ferienhof`, `gut`, `museum`; Schulen bleiben vorerst separat in `schools`. Aktueller Ferienhof-Stand aus `ferienhoefe_web_research`: 486 aktive Orte nach Admin-Grenzen-Clipping (`SH` 226, `MV` 80, `NI` 180, `HH` 0). Recherchequellen: Landreise, Landsichten, Bauernhofurlaub.de und lokale OSM-PBF-Name/Tag-Treffer. Artefakte liegen unter `data/raw/places/ferienhoefe/` und `data/reports/places/` und werden nicht committed. Für manuelle interne Pflege API mit `REGIONFINDER_ENABLE_PLACE_ADMIN=1` und Frontend mit `VITE_REGIONFINDER_ENABLE_PLACE_ADMIN=1` starten.

OSM-Schienenrekonstruktion:

```bash
npm run rail:reconstruct
```

Das Script filtert OSM-Schienen, lädt sie per Docker/osm2pgsql in `staging_osm_rail_*`, baut `rail_edges`/`rail_vertices`, snappt StopPlaces und schreibt `route_pattern_rail_matches`. Standard-PBF: `data/raw/osm/germany-latest.osm.pbf`; bei Bedarf `OSM_PBF_PATH`, `OSM_RAIL_PBF_PATH`, `OSM2PGSQL_DATABASE_URL`, `OSMIUM_IMAGE` oder `OSM2PGSQL_IMAGE` setzen.

Für Match-Nachläufe keine großen Deutschland-/Norddeutschland-Batches starten. Bevorzugt Korridor und Linienlabel kombinieren:

```bash
npm run rail:reconstruct -- match-patterns --corridor=hamburg-luebeck --modes=RE,RB --routes=RE8,RB81
npm run rail:reconstruct -- match-patterns --bbox=8.3,52.9,11.6,54.4 --modes=S --routes=S1,S2,S3,S5,S7
```

Benannte Korridore stehen in `pipeline/rail_network.py`. Aktuell sind viele S-/Regional-Patterns noch `osm_reconstructed_low_confidence`; diese nicht als Standardkarte freischalten, bevor der jeweilige Korridor visuell geprüft ist.

## Architekturregeln

- API-/PostGIS-/MapLibre-Modus ist der einzige Frontend-Pfad.
- Der API-Modus lädt Verkehrsdaten über Fastify/PostGIS/MVT, nicht über große JSON-Dateien.
- Keine vollständigen GTFS-StopTimes direkt in React laden.
- StopPlaces und Route Patterns im API-Modus über Vector Tiles aus PostGIS laden.
- Weiterführende Schulen sind snapshot-unabhängige POIs in `schools` und werden über `/api/v1/tiles/schools/{z}/{x}/{y}.mvt?categories=...&states=...` geladen.
- Generische Places sind snapshot-unabhängige POIs in `places` und werden über `/api/v1/tiles/places/{z}/{x}/{y}.mvt?categories=...&states=...` geladen. Schreibende Places-Endpunkte sind interne Pflege und erfordern `REGIONFINDER_ENABLE_PLACE_ADMIN=1`.
- Tile-Endpunkte mit `?modes=...` filtern, wenn UI-Layer aktiv/deaktiv sind. Stop-Tiles zusätzlich mit `?profile=...` anfragen, damit Reisezeitfarben und Hover-Metriken zum Routingprofil passen.
- Bei Moduswechseln MapLibre-Vector-Tile-Sources entfernen und neu anlegen; `setTiles()` allein kann alte ungefilterte Tiles sichtbar lassen.
- Route-MVTs sollen `route_color` liefern. Das Frontend nutzt echte GTFS-Farben bevorzugt und Fallbackfarben nach Modus.
- Route-MVTs nutzen `route_pattern_display_geometries`. Hochkonfidente `osm_reconstructed`-Geometrien dürfen als Anzeigegeometrie verwendet werden; `osm_reconstructed_low_confidence` und `stop_sequence_approximation` nicht als präzise Strecke darstellen. Im aktuellen Standardlayer sind beide ausgeblendet, weil Low-Confidence noch Fehlkorridore erzeugen kann.
- Stop-Metriken können `?date=YYYY-MM-DD` erhalten; dann liefert die API `directConnectionCount` als tagesgenaue Anzahl direkter Trips ohne Umstieg.
- `ApiMetrics` ist absichtlich schlank: `fastestSeconds` plus optional `directConnectionCount`. Median, P90, Reachability-Quoten, Transferaggregate und `directConnectionRatio` sind keine aktuellen Produktmetriken mehr.
- Produktionsmetriken gelten für den exakten Ziel-StopPlace. Der MOTIS-Batch nutzt initialen Fußweg zum Einstieg, aber keinen finalen Fußweg zu Nachbarhaltestellen.
- DB-Echtzeitverbindungen laufen ausschließlich serverseitig über `server/realtime/dbTransportRestProvider.ts`; keine direkten DB-/bahn.de-Requests aus React. Die Implementierung ist in `server/realtime/` in Provider-Orchestrierung, bahn.de-/db.transport-Clients, Stop-Mapping, Journey-Mapping und Cache aufgeteilt.
- Standard-Realtime-Backend ist `bahn-web`; `REGIONFINDER_REALTIME_PROVIDER=db-transport-rest` erzwingt den Wrapper `v6.db.transport.rest`. Ursprung bleibt Hamburg Hbf (`REGIONFINDER_ORIGIN_DB_STOP_ID=8002549`).
- Realtime-Fehlercodes im UI freundlich behandeln: `db_stop_unmapped` und `realtime_unavailable` dürfen das Detailpanel nicht zerstören.
- Der API-Modus darf nicht stillschweigend auf Fixture-Daten zurückfallen.
- `PostgresRepository` ist nur Adapter auf das Repository-Interface. SQL gehört in fokussierte Module unter `server/db/queries/`.
- API-Frontend-Code liegt unter `src/apiApp/`: Hooks, MapLibre-Canvas, Layerdefinitionen, Formatter und Detailpanel-Komponenten. `src/ApiApp.tsx` bleibt Layout/Verdrahtung.
- `MapLibreCanvas` wird lazy geladen. Große MapLibre-Abhängigkeiten nicht wieder statisch in den App-Shell importieren.
- Der große lazy MapLibre-Chunk ist bewusst isoliert; Vite nutzt `chunkSizeWarningLimit: 1100`.

## UX-Konventionen

API-Modus:

- Initiale Karte: Hamburg/Norddeutschland, produktiver DELFI-Snapshot im Datenstand-Badge.
- Default-Layer: `Regional/Fern`, `S-Bahn/AKN`, `U-Bahn`.
- `Bus` ist standardmäßig deaktiviert. `Fähre` ist im API-UI aktuell nicht als eigener Layer-Schalter verfügbar.
- Klick auf StopPlace aus MVT aktualisiert das rechte Detailpanel.
- Die frühere Sidebar-Suche/Suchtrefferliste ist im API-UI entfernt; Detailpanel-Öffnung erfolgt über die Karte.
- Basiskarten-Umschalter: CARTO/OSM-Straßenkarte und Esri-Satellit; beide mit CARTO-Ortslabel-Overlay.
- Detailpanel-Überschrift für Verbindungen ist `DB Echtzeit`, nicht `Konkrete Verbindung`; der alte lokale `Unser System`-Block ist im API-Detailpanel entfernt.
- Die DB-Echtzeit-Startzeit sitzt im Detailpanel mit `Frühere`-/`Spätere`-Buttons. Die Sidebar enthält keine separate Abfahrtszeitsteuerung mehr.
- Datenstand und technische StopPlace-Details sind einklappbar.
- DB-Echtzeit zeigt bis zu drei Alternativen mit Wunschzeit, erster Abfahrt, Ankunft, Dauer, Legs, Plattform, Verspätung, Ausfall und Remarks.
- Reisezeitfenster und Station-Kreise nutzen dieselbe Farbskala: 30 grün, 45 teal, 60 ocker, 75 orange, 90 rot.
- Reisezeitfenster filtern sichtbare MVT-StopPlaces anhand `fastest_seconds`.
- Umstiegsfilter und `Unerreichbare anzeigen` sind im API-UI entfernt; verfügbare Ziele werden standardmäßig gezeigt und nur über Layer/Reisezeitfenster eingeschränkt.
- Wohnregionen sind geschätzte Kreise um alle aktuell sichtbaren verfügbaren Ziele; Radius = Minuten * `0,75 km`, Optionen 5/10/15/20 Minuten.
- Zoom-Control sitzt links oben in der Map-Card; Zoomstufe sichtbar anzeigen.
- MVT-Kacheln und abgeleitete Overlays müssen konsistent nach aktiven Modi und Reisezeitfenstern gefiltert sein.
- Zusatzlayer sitzen unten in der Sidebar. Weiterführende Schulen stehen unter `Schulen anzeigen` und sind getrennt schaltbar als `Gymnasium` und `andere weiterf. Schulen`; beide sind standardmäßig aktiv. Generische Places stehen unter `Orte anzeigen`, sind getrennt schaltbar als `Höfe`, `Ferienhöfe`, `Güter`, `Museen` und standardmäßig aus.
- Schulmarker werden nicht durch Reisezeitfenster oder ÖPNV-Modi gefiltert. Gymnasien sind blau hervorgehoben, andere weiterführende Schulen neutral. Hover zeigt Name und Schulart; Klick öffnet aktuell kein Detailpanel.
- Place-Marker werden nicht durch Reisezeitfenster oder ÖPNV-Modi gefiltert. Hover zeigt Name und Kategorie; Klick öffnet aktuell kein Detailpanel. Das interne Place-Admin-Formular erscheint nur mit `VITE_REGIONFINDER_ENABLE_PLACE_ADMIN=1`.
- Die Karte zeigt unten rechts eine metrische Maßstabsleiste.

## Nächster fachlicher Schwerpunkt

- Performance und Qualität der Produktions-MVTs verbessern: Clustering/Generalisierung, weniger Linienchaos bei niedrigen Zoomstufen.
- Qualität/Abdeckung der 120-Minuten-Produktionsmetrik verbessern und nicht erreichbare StopPlaces nach Ursache clustern.
- R5/r5py als Vergleichsengine wiederaufnehmen, wenn Ressourcen/Graphbau geklärt sind.
- Wohnregion-Funktion: aktuelle Version zeigt geschätzte Radien; spätere Version soll echte Auto-Isochronen via OSRM, Valhalla oder OpenRouteService nutzen.
