# AGENTS

Projektbezogene Hinweise für zukünftige Coding-Sessions.

## Arbeitsstand

- Dieses Verzeichnis ist ein Git-Repository auf Branch `main` mit Remote `origin`.
- Es können mehrere Vite-Server parallel laufen. Vor UI-Tests den tatsächlich genutzten Port prüfen.
- Der aktuelle API-/Produktionsmodus läuft typischerweise auf:
  - API: `http://127.0.0.1:4001`
  - Frontend: `http://localhost:5176/`
- Playwright ist als Dev-Dependency installiert; lokale UI-Smoke-Tests brauchen einmalig `npx playwright install chromium`.
- `public/data/hvv/` enthält große generierte Legacy-Artefakte. `stop-times.json` ist sehr groß und darf nicht unbedacht im Browser geladen werden.
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
npm run db:migrate
```

Der Compose-DB-Container nutzt `pgrouting/pgrouting:16-3.5-4.0`, nicht das reine PostGIS-Image. pgRouting wird für die OSM-Schienenrekonstruktion benötigt.

Produktiver API-Modus:

```bash
DATABASE_URL=postgres://regionfinder:regionfinder@localhost:55432/regionfinder REGIONFINDER_API_PORT=4001 npm run dev:api
VITE_REGIONFINDER_DATA_MODE=api VITE_REGIONFINDER_API_BASE_URL=http://127.0.0.1:4001 npm run dev -- --host 127.0.0.1 --port 5176
```

Wenn `server/` geändert wurde, den API-Prozess neu starten. Wenn MapLibre-Quellen oder Hook-Strukturen geändert wurden, den Browser hart neu laden statt sich allein auf HMR zu verlassen.

## Datenimport

Legacy-HVV-Artefakte:

```bash
npm run import:hvv -- --download
```

Der Import nutzt den im Script hinterlegten Transparenzportal-Link oder `HVV_GTFS_URL`.

Produktionsdaten:

- aktiver Snapshot: `delfi-bb69c7e2c8d5`
- kanonische Fahrplanquelle: DELFI-GTFS
- aktuelle Produktionsmetriken: `motis_one_to_all`
- R5/r5py: optionaler Vergleichsweg, kein Aktivierungs-Gate

Details stehen in `docs/PRODUCTION_DATA_INTEGRATION_REPORT.md`.

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

- API-Modus ist der aktuelle Hauptpfad; Legacy bleibt erhalten.
- Der API-Modus lädt Verkehrsdaten über Fastify/PostGIS/MVT, nicht über große JSON-Dateien.
- Keine vollständigen DELFI-/HVV-StopTimes direkt in React laden.
- StopPlaces und Route Patterns im API-Modus über Vector Tiles aus PostGIS laden.
- Tile-Endpunkte mit `?modes=...` filtern, wenn UI-Layer aktiv/deaktiv sind. Stop-Tiles zusätzlich mit `?profile=...` anfragen, damit Reisezeitfarben und Hover-Metriken zum Routingprofil passen.
- Bei Moduswechseln MapLibre-Vector-Tile-Sources entfernen und neu anlegen; `setTiles()` allein kann alte ungefilterte Tiles sichtbar lassen.
- Route-MVTs sollen `route_color` liefern. Das Frontend nutzt echte GTFS-Farben bevorzugt und Fallbackfarben nach Modus.
- Route-MVTs nutzen `route_pattern_display_geometries`. Hochkonfidente `osm_reconstructed`-Geometrien dürfen als Anzeigegeometrie verwendet werden; `osm_reconstructed_low_confidence` und `stop_sequence_approximation` nicht als präzise Strecke darstellen. Im aktuellen Standardlayer sind beide ausgeblendet, weil Low-Confidence noch Fehlkorridore erzeugen kann.
- Stop-Metriken können `?date=YYYY-MM-DD` erhalten; dann liefert die API `directConnectionCount` als tagesgenaue Anzahl direkter Trips ohne Umstieg.
- DB-Echtzeitverbindungen laufen ausschließlich serverseitig über `server/realtime/dbTransportRestProvider.ts`; keine direkten DB-/bahn.de-Requests aus React.
- Standard-Realtime-Backend ist `bahn-web`; `REGIONFINDER_REALTIME_PROVIDER=db-transport-rest` erzwingt den Wrapper `v6.db.transport.rest`. Ursprung bleibt Hamburg Hbf (`REGIONFINDER_ORIGIN_DB_STOP_ID=8002549`).
- Realtime-Fehlercodes im UI freundlich behandeln: `db_stop_unmapped` und `realtime_unavailable` dürfen das Detailpanel nicht zerstören.
- Der API-Modus darf nicht stillschweigend auf Fixture-Daten zurückfallen.

## UX-Konventionen

API-Modus:

- Initiale Karte: Hamburg/Norddeutschland, produktiver DELFI-Snapshot im Datenstand-Badge.
- Default-Layer: `Regional/Fern`, `S-Bahn/AKN`, `U-Bahn`.
- `Bus` und `Fähre` sind standardmäßig deaktiviert.
- Klick auf StopPlace aus MVT oder Suchliste aktualisiert das rechte Detailpanel.
- Basiskarten-Umschalter: CARTO/OSM-Straßenkarte und Esri-Satellit; beide mit CARTO-Ortslabel-Overlay.
- Detailpanel-Überschrift für Verbindungen ist `DB Echtzeit`, nicht `Konkrete Verbindung`; der alte lokale `Unser System`-Block ist im API-Detailpanel entfernt.
- Die DB-Echtzeit-Startzeit sitzt im Detailpanel mit `Frühere`-/`Spätere`-Buttons. Die Sidebar enthält keine separate Abfahrtszeitsteuerung mehr.
- Datenstand und technische StopPlace-Details sind einklappbar.
- DB-Echtzeit zeigt bis zu drei Alternativen mit Wunschzeit, erster Abfahrt, Ankunft, Dauer, Legs, Plattform, Verspätung, Ausfall und Remarks.
- Reisezeitfenster und Station-Kreise nutzen dieselbe Farbskala: 30 grün, 45 teal, 60 ocker, 75 orange, 90 rot.
- Zoom-Control sitzt links oben in der Map-Card; Zoomstufe sichtbar anzeigen.
- Suchliste, Marker und MVT-Kacheln müssen konsistent nach aktiven Modi gefiltert sein.

Legacy-Modus:

- Initiale Karte: aktueller Startbahnhof, default `Hamburg Hbf`.
- Klick auf Seed-Ziel: Seed-Detail mit Reisezeit und Verbindung.
- Klick auf HVV-Haltestelle:
  - Auswahl aktualisieren,
  - Marker hervorheben,
  - haltende Linien hervorheben,
  - Detailpanel mit Linien und Reisezeit/Schätzung anzeigen,
  - Kartenausschnitt nicht verändern.

## Nächster fachlicher Schwerpunkt

- Performance und Qualität der Produktions-MVTs verbessern: Clustering/Generalisierung, weniger Linienchaos bei niedrigen Zoomstufen.
- 12-Stunden-Produktionshorizont für MOTIS one-to-all oder alternative Batchstrategie.
- R5/r5py als Vergleichsengine wiederaufnehmen, wenn Ressourcen/Graphbau geklärt sind.
- Wohnregion-Funktion:
  1. Bahnlimit bestimmen.
  2. Erreichbare Bahnhöfe bestimmen.
  3. Auto-Anschlusslimit anwenden.
  4. Zunächst geschätzte Radien/Raster anzeigen.
  5. Später echte Auto-Isochronen via OSRM, Valhalla oder OpenRouteService.
