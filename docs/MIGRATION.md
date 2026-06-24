# Migration

## Alter Pfad

Legacy:

- `src/App.tsx`
- Leaflet/React-Leaflet
- `src/data/hvv.ts`
- `src/data/reachabilityWorker.ts`
- `src/domain/gtfsReachability.ts`
- statische JSON-Artefakte in `public/data/hvv/`

Der alte Browser-Worker bleibt verfügbar, ist aber nicht mehr Zielarchitektur.

## Neuer Pfad

API-Modus:

- `src/ApiApp.tsx`
- `src/data/api.ts`
- `server/`
- `db/migrations/`
- `pipeline/`

Feature-Flag:

```bash
VITE_REGIONFINDER_DATA_MODE=api
VITE_REGIONFINDER_DATA_MODE=legacy
```

Aktueller Status:

- Der reale DELFI-Snapshot `delfi-bb69c7e2c8d5` ist aktiv.
- Produktionsmetriken kommen aus `motis_one_to_all`.
- R5/r5py bleibt optionaler Vergleichsweg und ist kein Aktivierungs-Gate.
- Das API-Frontend nutzt MapLibre, MVT-Kacheln und PostGIS/API statt großer JSON-Dateien.

## Frontend-Migration

Aus dem Legacy-Frontend wurden im API-Modus nachgezogen:

- Verkehrsmittel-Layer-Toggles.
- Reisezeitfenster.
- maximaler Umstiegsfilter.
- unerreichbare Ziele anzeigen/verbergen.
- Wohnregion-Radius.
- Basiskarten-Umschalter Straße/Satellit.
- Detailpanel bei Stationsklick.

Wichtiger Unterschied: Die API-Karte lädt StopPlaces und Route Patterns über MVT-Kacheln. Die Layer-Toggles filtern deshalb serverseitig über `?modes=...`; der Client muss die MapLibre-Sources bei Filterwechseln neu anlegen, um Tile-Cache-Reste zu vermeiden.

## Abschaltung des Workers

Der Worker darf erst entfernt werden, wenn:

- PostGIS-Snapshotimport produktiv läuft,
- Metriken für die Zielregionen vorliegen,
- Verbindungsauskunft lokal funktioniert,
- Frontendtests den API-Modus abdecken,
- Legacy-Tests migriert oder ersetzt sind.

## Datenmigration

Legacy-HVV-JSONs werden nicht in PostGIS migriert. Sie bleiben Integrationstest-/Vergleichsartefakte. Der neue kanonische Import erfolgt aus DELFI-GTFS plus ZHV/OSM/Admin-Grenzen.
