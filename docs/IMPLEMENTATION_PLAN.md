# Implementierungsplan Regionfinder Version 2

> Historisch: Dieser Plan beschreibt den ersten V2-Scaffolding-Schnitt vor der Produktionsdatenintegration. Aktueller Stand: `docs/CURRENT_STATE.md` und `docs/PRODUCTION_DATA_INTEGRATION_REPORT.md`.

Stand: 2026-06-24

## Ziel dieses Schnitts

Zum Zeitpunkt dieses historischen Plans hingen die vollständigen Produktionsdaten noch von externen Voll-Datensätzen ab. Inzwischen wurde ein realer DELFI-/BKG-/OSM-Produktionssnapshot importiert und aktiviert; Details stehen im Produktionsbericht.

## Baseline

- Historischer Baseline-Check: damals war der Git-/Arbeitsbaumstatus noch nicht abschließend geklärt. Aktueller Stand: Git-Repository auf Branch `main`.
- `npm run test`: erfolgreich, 3 Dateien, 11 Tests.
- `npm run build`: erfolgreich.
- `npm run lint`: erfolgreich.
- Historischer Ist-Zustand vor V2: React/Vite/TypeScript-SPA, Leaflet, statische HVV-JSONs und clientseitiger Worker. Aktuell existieren zusätzlich Fastify, PostGIS, Pipeline, MapLibre-API-Modus und Produktionssnapshot.

## Phasen

1. Kernsemantik
   - Sekundenbasierte GTFS-Zeitverarbeitung inklusive `25:15:00`.
   - Materialisierte Service-Dates aus `calendar.txt` und `calendar_dates.txt`.
   - Route-Pattern-Erkennung auf Basis von Route, Richtung, Haltefolge, Pickup/Drop-off und Shape.
   - Fahrzeitaggregation mit Durchschnitt, Median und P90 nach Nearest-Rank.
   - Regressionstest für gewünschte Abfahrt 08:00, tatsächliche Abfahrt 08:10, Ankunft 08:40.

2. Datenbank und Infrastruktur
   - Docker Compose für PostGIS und lokalen API-Betrieb.
   - SQL-Migrationen für Quellen, Snapshots, Stops, Patterns, Kalender, Transfers, Pathways, Metriken, Itineraries und Tiles.
   - Atomare Snapshot-Aktivierung per Transaktion.
   - `.env.example` und Betriebsskripte.

3. Pipeline
   - Python-Paket mit CLI für Validierung, synthetischen GTFS-Importpfad, DELFI-Dateipfadadapter, Qualitätsreport und Metrikaggregation.
   - Keine erfundenen DELFI-URLs.
   - HVV bleibt Integrationstestquelle, nicht kanonische Vollquelle.

4. API
   - Fastify-Server mit Health/Readiness.
   - `/api/v1/snapshots/current`, Stop-Suche, Stop-Details, Metriken, Itineraries, Route-Patterns, MVT-Endpunkte.
   - Zod-Validierung und gemeinsame TypeScript-Typen.
   - Historischer Plan: Postgres-Repository mit Fixture-Fallback für Tests.
   - Aktueller Stand: Fixture-Modus wird nur explizit mit `REGIONFINDER_USE_FIXTURE_API=1` aktiviert; ohne `DATABASE_URL` bricht der API-Start ab.

5. Frontend
   - Feature-Flag `VITE_REGIONFINDER_DATA_MODE=legacy|api`; aktueller Default ohne Flag ist `api`.
   - Legacy-Leaflet bleibt erhalten.
   - Neuer MapLibre-Modus lädt Metadaten, Stop-Suche, Detaildaten, Metriken und Tiles über API.
   - Basiskartenquelle ist konfigurierbar.

6. Dokumentation und Bericht
   - Zielarchitektur, Datenquellen, Fahrzeitsemantik, Import-Runbook, Migration, Datenqualität und Betrieb dokumentieren.
   - Abschlussbericht trennt implementierten Code, synthetisch getestete Funktionen, HVV-Integration und wegen fehlender Vollquellen nicht ausgeführte Schritte.

## Technische Abweichungen

- Historischer Stand: R5/r5py und MOTIS waren hier nur vorbereitet. Aktueller Stand: MOTIS `v2.10.2` wurde mit echtem DELFI/OSM-Graph gebaut und `motis_one_to_all` lieferte aktive Produktionsmetriken; R5 bleibt optional.
- MapLibre wird als API-Modus integriert. Die alte Leaflet-Karte bleibt per Feature-Flag erhalten, bis echte MVT-Daten in PostGIS vorliegen.
- Verwaltungsgrenzen werden im Datenmodell und Importpfad unterstützt; produktive Polygone müssen über konfigurierte Dateien bereitgestellt werden.
