# Architecture

Hinweis: Diese Datei beschreibt den Legacy-MVP und bleibt als Referenz erhalten. Der aktive Produktpfad ist inzwischen der API-/PostGIS-/MapLibre-Modus aus `docs/TARGET_ARCHITECTURE.md`, `server/`, `db/`, `pipeline/` und `src/ApiApp.tsx`.

## Aktiver API-/MapLibre-Pfad

Der aktuelle V2-Pfad besteht aus:

- `server/`: Fastify-API für Snapshots, StopPlaces, Metriken, lokale Itineraries, DB-Echtzeit-Itineraries, Route Patterns und MVT-Kacheln.
- `server/db/queries/`: fokussierte PostGIS-Query-Module; `PostgresRepository` ist nur noch Adapter auf das Repository-Interface.
- `server/realtime/`: DB-/bahn.de-Clients, Stop-Mapping, Journey-Mapping und Cache für DB-Echtzeit.
- `db/migrations/`: PostGIS-Schema, Admin-Grenzen, Snapshot-Aktivierung.
- `pipeline/`: Produktionsquellen, DELFI-Import, MOTIS/R5-Orchestrierung, Metrikberechnung und OSM-Schienenrekonstruktion.
- `src/ApiApp.tsx`: API-Frontend-Layout.
- `src/apiApp/`: API-Frontend-Hooks, MapLibre-Canvas, Layerdefinitionen, Formatter und Detailpanel-Komponenten.
- `src/data/api.ts`: API-Client.
- `src/api/contracts.ts`: gemeinsame Antworttypen.

Die Karte lädt im API-Modus StopPlaces und Route Patterns ausschließlich als Vector Tiles. Die MapLibre-Canvas wird im Frontend lazy geladen:

- `GET /api/v1/tiles/stops/{z}/{x}/{y}.mvt?modes=...`
- `GET /api/v1/tiles/routes/{z}/{x}/{y}.mvt?modes=...`
- `GET /api/v1/tiles/rail-network/{z}/{x}/{y}.mvt`

Die Modusfilter werden serverseitig in PostGIS angewendet. Stop-Tiles akzeptieren zusätzlich `profile` und liefern Reisezeit-/Linien-Metadaten für Styling und Hover. Der Client entfernt und erneuert die MapLibre-Vector-Tile-Sources beim Umschalten der Modi, weil `setTiles()` allein bereits geladene ungefilterte Tiles nicht zuverlässig aus dem Cache entfernt.

Route-Pattern-Tiles liefern `route_color`, falls eine echte GTFS-Farbe existiert. MapLibre nutzt diese Farbe bevorzugt und fällt sonst auf Modusfarben zurück. Die angezeigte Geometrie kommt aus `route_pattern_display_geometries`, sodass hochkonfidente OSM-Schienenrekonstruktionen GTFS-Fallbacks ersetzen können. `stop_sequence_approximation` und niedrigkonfidente Rekonstruktionen bleiben im Standardlayer ausgeblendet; niedrigkonfidente Matches sind derzeit Diagnosematerial fuer weitere Korridorarbeit.

Basiskarten im API-Modus:

- CARTO/OSM-Straßenkarte ohne Labels plus CARTO-Ortslabel-Overlay.
- Esri World Imagery als Satellit plus dasselbe CARTO-Ortslabel-Overlay.

StopPlaces aus MVTs sind anklickbar; der Klick lädt Details, tagesgenaue Metriken und DB-Echtzeitverbindungen. Das API-UI hat keine Sidebar-Suchtrefferliste mehr; der technische Suchendpunkt bleibt für externe oder spätere Nutzung erhalten. Der Realtime-Endpunkt `GET /api/v1/stops/:publicId/realtime-itineraries` wird serverseitig über `server/realtime/dbTransportRestProvider.ts` bedient und normalisiert externe DB-/bahn.de-Antworten in `ApiItineraryResponse`.

Produktive Stop-Metriken werden mit `motis_one_to_all` als schnellste planmäßige Reisezeit zum exakten StopPlace berechnet. Der aktuelle Metric Contract veröffentlicht `fastestSeconds` und optional `directConnectionCount`; historische Median-/P90-/Reachability- und Transferfelder sind keine API-Produktmetriken mehr.

## Überblick

Die App ist ein Vite/React/TypeScript-Projekt mit Leaflet-Karte. Sie trennt drei Ebenen:

1. **Seed-Daten und Seed-Router**
   - klein, schnell, testbar
   - Grundlage für exakte MVP-Reisezeiten

2. **HVV-GTFS-Import**
   - vollständigerer ÖPNV-Datenbestand für Hamburg/Umland
   - Grundlage für Kartenlayer, Haltestellensuche und spätere Fahrplanlogik

3. **UI- und Kartenlogik**
   - Layersteuerung, Markerauswahl, Ergebnislisten, Detailpanel
   - aktuell auch HVV-Reisezeit-Näherung für Nicht-Seed-Haltestellen

## Wichtige Dateien

- `src/legacy/LegacyApp.tsx`: Legacy-UI, Leaflet-Layer, Auswahlzustand, HVV-Reisezeit-Näherung.
- `src/App.tsx`: kleiner Modus-Switch, lädt API- und Legacy-Pfad lazy.
- `src/App.css`: Layout und Detailpanel-/Layer-Styling.
- `src/domain/types.ts`: zentrale Domain-Typen für Stations, Routes, GTFS-Import und HVV-Artefakte.
- `src/domain/reachability.ts`: Seed-Router und Seed-Datenvalidierung.
- `src/domain/reachability.test.ts`: Tests für Seed-Daten und Routing.
- `src/data/stations.ts`: Seed-Stationsdaten.
- `src/data/railway.ts`: Seed-Linien und Service-Patterns.
- `src/data/hvv.ts`: Hook zum Laden von HVV-Frontend-Artefakten.
- `scripts/import-hvv-gtfs.mjs`: Node-Importer für HVV GTFS Static.
- `public/data/hvv/*.json`: lokal erzeugte, nicht versionierte HVV-Artefakte.

## Domain-Modell

`src/domain/types.ts` enthält:

- `Station`
  - Seed- und HVV-kompatible Felder.
  - Zusätzliche GTFS-Felder: `sourceStopId`, `parentStationId`, `platformCode`, `locationType`, `wheelchairBoarding`.

- `TransitMode`
  - `RE`, `RB`, `S`, `ICE`, `TRAM`, `U`, `RAIL`, `BUS`, `FERRY`, `AKN`.

- `RouteService`
  - Seed-Routing-Service.
  - Zusätzlich GTFS-nahe Felder: `agencyId`, `routeShortName`, `routeLongName`, `routeType`, `routeColor`, `routeTextColor`.

- `RailwayLine`
  - Seed- und HVV-Linienanzeige.
  - Kann `geometry`, `mode`, `source`, `routeType` usw. tragen.

- `HvvStation`, `HvvRoute`, `HvvManifest`
  - Frontend-Artefakte des GTFS-Imports.

## HVV-Import-Pipeline

Kommando:

```bash
npm run import:hvv
```

Optionen:

- `--input path/to/hvv.zip`
- `--download`
- `--url https://...`
- `--output public/data/hvv`

Der Importer:

- liest ZIP per systemweitem `unzip`,
- parst GTFS-CSV mit eigenem CSV-Parser,
- validiert Pflichtdateien,
- klassifiziert Linien in Layer,
- nutzt Shapes bevorzugt als Liniengeometrie,
- nutzt Stop-Polyline als Fallback,
- filtert auf Hamburg/Umland-Bounds,
- schreibt JSON-Artefakte.

Output:

- `manifest.json`
- `stations.json`
- `routes.json`
- `trips-index.json`
- `stop-times.json`
- `calendar.json`
- `calendar-dates.json`

Frontend lädt aktuell nur:

- `manifest.json`
- `stations.json`
- `routes.json`

## Layer-Klassifizierung

GTFS `route_type` wird mit Liniennamen kombiniert:

- `1` oder `U*` -> U-Bahn
- `2` plus `S*` -> S-Bahn
- `2` plus `A*` -> AKN/S-Bahn-Layer
- `2` plus `RE*`/`RB*`/`IC*`/`ICE*` -> Regional/Fern
- `3`, `X*`, `M*`, numerische Linien -> Bus
- `4` -> Fähre

Diese zusätzliche Namenserkennung ist nötig, weil HVV-Linien wie `X81` sonst visuell falsch als Schiene erscheinen können.

## Routing

### Seed-Router

Der Seed-Router arbeitet als zeitabhängige Suche auf vereinfachten Service-Patterns:

- nächstmögliche Abfahrt pro Service und Station,
- Fahrt entlang nachfolgender Stops,
- beste Ankunftszeit pro Station,
- Umstiegszählung über wechselnde `routeId`.

### HVV-Reisezeit-Näherung

Für HVV-Haltestellen, die nicht im Seed-Router enthalten sind:

1. Bestimme alle HVV-Routen der Haltestelle.
2. Suche entlang dieser Routen mögliche HVV-Ankerpunkte.
3. Matche Ankerpunkte auf nahe Seed-Stationen.
4. Nutze Seed-Reisezeit bis zum Anker.
5. Schätze zusätzliche HVV-Fahrzeit aus Distanz, Modus und Stop-Anzahl.
6. Zeige Ergebnis als `ca.`.

Das ist bewusst keine fahrplanexakte Berechnung. Der spätere GTFS-Router soll diese Schätzung ersetzen.

## Kartenverhalten

- `MapContainer` startet am Startbahnhof.
- `StartStationFocus` setzt die Karte beim Laden und Startbahnhofwechsel explizit auf den Startbahnhof.
- HVV-Haltestellenklicks verändern den Kartenausschnitt nicht.
- Ausgewählte HVV-Routen werden als dickere Polylines über die Basislinien gelegt.
- HVV-Haltestellen nutzen kein Leaflet-Popup mehr.

## Performance-Entscheidungen

- `stop-times.json` nicht im Browser laden und nicht in Produktionsbuilds kopieren.
- Bus/Fähre default aus, um die Karte lesbar zu halten.
- Linien werden als repräsentative Route pro GTFS-Route angezeigt, nicht als jede Fahrt.
- Shapes werden aus `routes.json` direkt geladen; das ist deutlich kleiner als vollständige Stop-Times.

## Teststrategie

Aktuell abgedeckt:

- Seed-Datenvalidierung.
- Korridorstationen sind durch Seed-Services abgedeckt.
- Beispiel-Erreichbarkeit ab Hamburg Hbf.
- Reverse-Service-Routing.
- Hittfeld ist als `RB41`-Ziel im Seed-Router abgedeckt.

Empfohlene nächste Tests:

- Importer-Unit-Tests für Klassifizierung (`X*`/numerisch -> Bus).
- HVV-Schätzlogik isolieren und testen.
- Wohnregion-Flächenberechnung testen, sobald sie aus `App.tsx` ausgelagert ist.
