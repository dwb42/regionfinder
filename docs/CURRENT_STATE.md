# Current State

Stand: 2026-06-24 nach Regionfinder V2 Produktionsintegration und API-/MapLibre-UX-Nachzug.

## Produktstand

Regionfinder besitzt zwei Modi:

- `api`: produktiver V2-Pfad mit Fastify, PostgreSQL/PostGIS, MOTIS-Metriken, MapLibre und MVT-Kacheln.
- `legacy`: alter Leaflet/HVV-JSON-/Seed-Router-Pfad als Vergleich und Fallback.

Der API-Modus ist der aktuelle Hauptpfad. Der Browser lädt dort keine vollständigen Fahrplan-JSONs und führt keine kanonischen Fahrzeitberechnungen mehr aus.

## Aktiver Produktionssnapshot

- Snapshot-ID: `delfi-bb69c7e2c8d5`
- Quelle: DELFI deutschlandweite Sollfahrplandaten GTFS
- Status: aktiv
- GTFS-SHA-256: `bb69c7e2c8d50e6f923e397f5d39a17c4e514cb6e4e258473cff65798b5b902e`
- OSM-SHA-256: `d957290fe75a9f599ff3abd2a883328c58e0c67a1db332f15a11647e86d0e74d`
- BKG-SHA-256: `0a3c106a7537e1b47e97077d923c660e22510f73031463a420e7718c6f129e42`
- Gültigkeit: 2026-06-06 bis 2026-12-12

Importierte Haupttabellen:

- 533.066 StopPlaces
- 545.533 technische Stops
- 2.267.786 Trips
- 45.880.781 Stop-Times
- 303.549 Route Patterns

Importierte Grenzen:

- `DE-HH`
- `DE-SH`
- `DE-MV`
- `DE-NI`
- `DE-HB`

## Produktionsmetriken

Aktive Metrikengine:

- `motis_one_to_all`
- MOTIS `v2.10.2`
- Metric Run `c63c2468-e7c8-4260-9ac7-abc2f75d7e02`
- Profil `regular_tue_thu`
- Datum 2026-07-07
- Samplefenster 05:00 bis GTFS 25:00
- Intervall 5 Minuten
- 240 Samples
- 95.870 Ziel-StopPlaces

R5/r5py wurde real gestartet, ist aber für den vollständigen Deutschland-PBF in der lokalen Umgebung nicht fertig gebaut worden. R5 ist optionaler Vergleichsweg und kein Aktivierungs-Gate, solange `motis_one_to_all` erfolgreich abgeschlossen ist.

Bekannte Abweichung: Der ausgeführte MOTIS-Produktionshorizont beträgt 240 Minuten. Das fachliche Ziel bleibt 12 Stunden; der 12-Stunden-Lauf ist als Performance-Restarbeit dokumentiert.

## Entwicklungsumgebung

Typischer lokaler Produktionsmodus:

```bash
docker compose up -d postgis
DATABASE_URL=postgres://regionfinder:regionfinder@localhost:55432/regionfinder REGIONFINDER_API_PORT=4001 npm run dev:api
VITE_REGIONFINDER_DATA_MODE=api VITE_REGIONFINDER_API_BASE_URL=http://127.0.0.1:4001 npm run dev -- --host 127.0.0.1 --port 5176
```

Frontend: `http://localhost:5176/`.

Es können mehrere Vite-Server parallel laufen. Vor UI-Prüfungen den tatsächlichen Port und die gesetzten `VITE_`-Variablen kontrollieren.

## API-Modus UX

Aktuelle UI-Funktionen im API-Modus:

- StopPlace-Suche über API.
- Klick auf StopPlaces aus MapLibre-Vektor-Tiles lädt Detaildaten in das rechte Panel.
- Detailpanel zeigt Datenstand, StopPlace, Metriken, konkrete Verbindung und bedienende Linien.
- Basiskarten-Umschalter:
  - OpenStreetMap-Straßenkarte
  - Esri-Satellit mit Label-Overlay
- ÖPNV-Layer:
  - `Regional/Fern`
  - `S-Bahn/AKN`
  - `U-Bahn`
  - `Bus`
  - `Fähre`
- Default: `Regional/Fern`, `S-Bahn/AKN`, `U-Bahn` aktiv; `Bus`, `Fähre` aus.
- MVT-Kacheln werden serverseitig per `modes` gefiltert.
- Beim Umschalten der Modi entfernt der Client die MapLibre-Vector-Tile-Sources und legt sie neu an, damit keine alten ungefilterten Tiles aus dem Cache sichtbar bleiben.
- Route Patterns verwenden echte GTFS-Farben aus `routes.color`, falls vorhanden; sonst Modus-Fallbackfarben.
- `stop_sequence_approximation` ist gestrichelt, transparent und standardmäßig ausgeblendet.
- Reisezeitfenster, maximaler Umstiegsfilter, unerreichbare Ziele und Wohnregion-Radius sind im API-Modus verfügbar.

## Aktuelle technische Entscheidungen

- PostGIS ist Quelle für StopPlaces, Route Patterns, Metriken und MVTs.
- Fastify validiert Requests mit Zod-Schemas.
- Gemeinsame API-Antworttypen liegen in `src/api/contracts.ts`.
- Stop- und Route-Tiles akzeptieren `?modes=...`.
- Route-Tiles liefern `route_color`, normalisiert auf `#RRGGBB`, wenn eine echte GTFS-Farbe existiert.
- Der API-Modus darf nicht stillschweigend auf Fixture-Daten zurückfallen.
- Fixtures bleiben für Tests und lokale isolierte Entwicklung verfügbar.

## Legacy-Modus

Der Legacy-Pfad bleibt erhalten:

- `src/App.tsx`
- Leaflet/React-Leaflet
- statische HVV-Artefakte in `public/data/hvv/`
- Seed-Router und Browser-Worker

Legacy-UX-Konventionen bleiben gültig:

- HVV-Haltestellenklicks pannen/zoomen die Karte nicht.
- Details stehen rechts im Panel, nicht in Leaflet-Popups.
- `stop-times.json` darf nicht direkt im React-Frontend geladen werden.

## Verifikation

Nach den letzten Änderungen liefen erfolgreich:

```bash
npm run build
npm run test
npm run lint
```

Produktions-Readiness:

```bash
curl http://127.0.0.1:4001/ready
# {"status":"ready","snapshotId":"delfi-bb69c7e2c8d5"}
```
