# Datenquellen

## DELFI

DELFI-Timetable ist die kanonische Fahrplanquelle. Der aktuelle Produktionssnapshot wurde aus dem offiziellen deutschlandweiten DELFI-GTFS importiert:

- Datei: `data/raw/delfi/gtfs-deutschland-gesamt.zip`
- Snapshot: `delfi-bb69c7e2c8d5`
- SHA-256: `bb69c7e2c8d50e6f923e397f5d39a17c4e514cb6e4e258473cff65798b5b902e`
- Gültigkeit: 2026-06-06 bis 2026-12-12

Für neue Läufe kann der Import weiterhin über einen lokalen GTFS-Snapshot erfolgen:

```bash
DELFI_GTFS_PATH=/absolute/path/to/delfi-gtfs
```

Der Pfad kann auf ein entpacktes GTFS-Verzeichnis oder später auf eine ZIP-Datei zeigen. Pflichtdateien sind `agency.txt`, `stops.txt`, `routes.txt`, `trips.txt`, `stop_times.txt` und `calendar.txt`.

## ZHV/DHID

ZHV wird für bevorzugte StopPlace-Identität vorbereitet:

```bash
ZHV_STOPS_PATH=/absolute/path/to/zhv-stops.csv
```

DHID ist im Datenmodell bevorzugt. Fehlt sie, wird `identity_quality = missing_dhid` gespeichert und die Quell-ID bleibt erhalten.

Aktueller Status: kein echter ZHV-Voll-Export lag lokal vor. Die aktive Produktionsbaseline nutzt DHIDs aus dem DELFI-GTFS, soweit vorhanden, und stabile interne IDs für fehlende DHIDs.

## Regionale Enrichment-Feeds

Regionale Feeds dürfen Geometrien, Betreiber, Farben, Plattformen und lokale Metadaten verbessern. Fahrten dürfen nur übernommen werden, wenn sie im DELFI-Snapshot fehlen und Deduplizierung getestet ist. Diese Merge-Funktion ist in diesem Schnitt noch nicht produktiv implementiert.

## OSM

OSM-PBF wird für Fußwege, Zugänge, Transfers, R5/MOTIS-Netze und die Schienenrekonstruktion von Route-Pattern-Anzeigegeometrien verwendet.

Aktueller Produktionsstand:

- Datei: `data/raw/osm/germany-latest.osm.pbf`
- Quelle: Geofabrik Deutschland
- SHA-256: `d957290fe75a9f599ff3abd2a883328c58e0c67a1db332f15a11647e86d0e74d`
- Umfang: vollständiger Deutschland-PBF, kein Nord-Fallback

Für neue Läufe:

```bash
OSM_PBF_PATH=/absolute/path/to/norddeutschland.osm.pbf
```

Das Netz darf nicht an Hamburg, Schleswig-Holstein, Mecklenburg-Vorpommern und Niedersachsen abgeschnitten werden. Bremen und angrenzende Korridore müssen im Routinggraph bleiben.

## OSM-Schienenrekonstruktion

`npm run rail:reconstruct` nutzt den OSM-PBF fuer einen separaten Schienenkorridor-Lauf:

- Osmium filtert `railway=rail`, `light_rail`, `subway` und `tram` in eine kleinere Rail-PBF.
- osm2pgsql lädt die Rail-PBF in `staging_osm_rail_*`.
- `rail_edges` und `rail_vertices` bilden den pgRouting-Graph.
- `stop_rail_snaps` speichert die naechsten Schienenkandidaten pro StopPlace.
- `route_pattern_rail_matches` speichert rekonstruierte Pattern-Geometrien inklusive Konfidenz, Snap-Distanzen, Detour-Faktor und Status.

Die UI verwendet nicht direkt `route_pattern_rail_matches`, sondern die View `route_pattern_display_geometries`. Dadurch bleiben niedrigqualitative Rekonstruktionen als solche markiert und offizielle GTFS-Geometrien bleiben Fallback.

## Verwaltungsgrenzen

Produktive Bundeslandzuordnung nutzt im aktuellen Stand BKG VG250:

- Datei: `data/raw/bkg/vg250_01-01.utm32s.gpkg.ebenen.zip`
- SHA-256: `0a3c106a7537e1b47e97077d923c660e22510f73031463a420e7718c6f129e42`
- Importierte Länder: `DE-HH`, `DE-SH`, `DE-MV`, `DE-NI`, `DE-HB`

Für neue Läufe:

```bash
ADMIN_BOUNDARIES_PATH=/absolute/path/to/admin-boundaries.geojson
```

Zielregionen: `DE-HH`, `DE-SH`, `DE-MV`, `DE-NI`. Bremen bleibt optional konfigurierbar.

## Weiterführende Schulen

Schulstandorte sind snapshot-unabhängige Zusatzdaten und werden nicht aus DELFI/GTFS abgeleitet. OSM ist für den Schools-Layer keine Primärquelle.

Zielbundesländer:

- Hamburg (`HH`)
- Schleswig-Holstein (`SH`)
- Mecklenburg-Vorpommern (`MV`)
- Niedersachsen (`NI`)

Normalisierte Produktkategorien:

- `gymnasium`
- `comprehensive`
- `waldorf`
- `vocational`
- `upper_secondary`

Offizielle Quellen:

- Hamburg: Transparenzportal/GeoHub `Schulstammdaten und Schülerzahlen der Hamburger Schulen`, Lizenz Datenlizenz Deutschland Namensnennung 2.0.
- Schleswig-Holstein: OpenData-SH `Schulen`, Lizenz Datenlizenz Deutschland Namensnennung 2.0. Die Datei ist TSV/CSV; `main_school_type` und `school_type` sind Bitmasken für Schularten/Bildungsgänge.
- Mecklenburg-Vorpommern: Geoportal.MV / Amtliches Schulverzeichnis, WFS-Layer nach Schularten.
- Niedersachsen: Landesamt für Statistik Niedersachsen, georeferenzierte Schulstandorte als Shapefile-Downloads für allgemeinbildende und berufsbildende Schulen.

Lokale Zielpfade für den Import:

- `data/raw/schools/hamburg.geojson|csv`
- `data/raw/schools/schleswig-holstein.geojson|csv`
- `data/raw/schools/mecklenburg-vorpommern.geojson|csv`
- `data/raw/schools/niedersachsen.geojson|csv`

GML- und Shapefile-Quellen werden vor dem Import per GDAL nach EPSG:4326-GeoJSON konvertiert. Das Importskript `pipeline/schools.py` schreibt Quelle, Pfad und Feldkonfiguration zusätzlich in `data_sources.configuration`.

Aktueller lokaler Importstand: 1.466 darstellbare Standorte. Einige relevante SH-Standorte hatten in der offiziellen CSV keine Koordinaten und wurden über Adress-Geocoding ergänzt; diese Ergänzungen sind bei Quellupdates erneut zu prüfen.

## Quellenmetadaten

`data_sources` und `data_snapshots` speichern Anbieter, Lizenz, Attribution, Hash, Gültigkeit, Status, Format und Qualitätsbericht.
