# AGENTS

Projektbezogene Hinweise für zukünftige Coding-Sessions.

## Arbeitsstand

- Dieses Verzeichnis ist ein Git-Repository auf Branch `main` mit Remote `origin`.
- Es können mehrere Vite-Server parallel laufen. Vor UI-Tests den tatsächlich genutzten Port prüfen.
- Der aktuelle API-/Produktionsmodus läuft typischerweise auf:
  - API: `http://127.0.0.1:4001`
  - Frontend: `http://localhost:5176/`
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

## Architekturregeln

- API-Modus ist der aktuelle Hauptpfad; Legacy bleibt erhalten.
- Der API-Modus lädt Verkehrsdaten über Fastify/PostGIS/MVT, nicht über große JSON-Dateien.
- Keine vollständigen DELFI-/HVV-StopTimes direkt in React laden.
- StopPlaces und Route Patterns im API-Modus über Vector Tiles aus PostGIS laden.
- Tile-Endpunkte mit `?modes=...` filtern, wenn UI-Layer aktiv/deaktiv sind.
- Bei Moduswechseln MapLibre-Vector-Tile-Sources entfernen und neu anlegen; `setTiles()` allein kann alte ungefilterte Tiles sichtbar lassen.
- Route-MVTs sollen `route_color` liefern. Das Frontend nutzt echte GTFS-Farben bevorzugt und Fallbackfarben nach Modus.
- `stop_sequence_approximation` nicht als echte Strecke darstellen: gestrichelt, transparent und standardmäßig ausgeschaltet.
- Der API-Modus darf nicht stillschweigend auf Fixture-Daten zurückfallen.

## UX-Konventionen

API-Modus:

- Initiale Karte: Hamburg/Norddeutschland, produktiver DELFI-Snapshot im Datenstand-Badge.
- Default-Layer: `Regional/Fern`, `S-Bahn/AKN`, `U-Bahn`.
- `Bus` und `Fähre` sind standardmäßig deaktiviert.
- Klick auf StopPlace aus MVT oder Suchliste aktualisiert das rechte Detailpanel.
- Basiskarten-Umschalter: OpenStreetMap-Straßenkarte und Esri-Satellit mit Label-Overlay.
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
