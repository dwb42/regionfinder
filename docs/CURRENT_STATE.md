# Current State

Stand: 2026-06-25 nach Regionfinder V2 Produktionsintegration, API-/MapLibre-UX-Nachzug, DB-Echtzeitintegration und erstem OSM-Schienenkorridor-Matching.

## Produktstand

Regionfinder besitzt zwei Modi:

- `api`: produktiver V2-Pfad mit Fastify, PostgreSQL/PostGIS/pgRouting, MOTIS-Metriken, DB-Echtzeitvergleich, MapLibre und MVT-Kacheln.
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
- Detailpanel zeigt Metriken, DB-Echtzeitverbindungen, bedienende Linien, Datenstand und StopPlace-Details.
- Datenstand und technische StopPlace-Details sind einklappbare Abschnitte, damit der Normalzustand mehr Raum fuer die Karte und die Verbindungsauskunft laesst.
- Die Überschrift für Verbindungsauskunft lautet `DB Echtzeit`; der frühere lokale Block `Konkrete Verbindung`/`Unser System` wird im API-Detailpanel nicht mehr gerendert.
- Die Startzeit fuer `DB Echtzeit` sitzt im Detailpanel. `Frühere` und `Spätere` setzen die Startzeit relativ zu den aktuell geladenen Alternativen; die linke Sidebar enthält keine separate Abfahrtszeitsteuerung mehr.
- Basiskarten-Umschalter:
  - CARTO/OSM-Straßenkarte ohne Labels plus CARTO-Ortslabel-Overlay.
  - Esri-Satellit plus dasselbe CARTO-Ortslabel-Overlay.
- Zoom-Control sitzt links oben in der Map-Card; die aktuelle Zoomstufe wird direkt darunter angezeigt.
- ÖPNV-Layer:
  - `Regional/Fern`
  - `S-Bahn/AKN`
  - `U-Bahn`
  - `Bus`
  - `Fähre`
- Default: `Regional/Fern`, `S-Bahn/AKN`, `U-Bahn` aktiv; `Bus`, `Fähre` aus.
- MVT-Kacheln werden serverseitig per `modes` gefiltert.
- Stop-MVTs enthalten zusätzlich Reisezeitmetrik, Stop-Priorität und kompakte Linienlabels für Hover/Styling; sie werden mit dem aktiven Routingprofil angefragt.
- Beim Umschalten der Modi entfernt der Client die MapLibre-Vector-Tile-Sources und legt sie neu an, damit keine alten ungefilterten Tiles aus dem Cache sichtbar bleiben.
- Route Patterns verwenden echte GTFS-Farben aus `routes.color`, falls vorhanden; sonst Modus-Fallbackfarben.
- Route-Pattern-Geometrien kommen über die View `route_pattern_display_geometries`. Hochkonfidente OSM-Rekonstruktionen ersetzen GTFS-Fallbacks.
- Niedrigkonfidente OSM-Rekonstruktionen und `stop_sequence_approximation` werden im Standardlayer ausgeblendet. Sie bleiben als Qualitätszustände in den Daten erhalten, werden aber nicht als präzise Strecke dargestellt, weil sie noch sichtbare Fehlkorridore erzeugen können.
- Reisezeitfenster, maximaler Umstiegsfilter, unerreichbare Ziele und Wohnregion-Radius sind im API-Modus verfügbar.
- Reisezeitfenster und Stationskreise nutzen dieselbe Farbskala: 30 min grün, 45 min teal, 60 min ocker, 75 min orange, 90 min rot.

## DB-Echtzeitverbindungen und Direktverbindungen

Der Endpunkt `GET /api/v1/stops/:publicId/realtime-itineraries?date=YYYY-MM-DD&time=HH:mm&profile=...` liefert bis zu drei Live-Alternativen ab Hamburg Hbf zur ausgewählten Station. Die Abfrage verwendet die UI-Abfahrtszeit, nicht `now`.

Der Metrikendpunkt `GET /api/v1/stops/:publicId/metrics?profile=...&date=YYYY-MM-DD` liefert zusätzlich `directConnectionCount`: die fahrplanmäßige Anzahl direkter Trips ohne Umstieg am gewählten repräsentativen Datum. Das ersetzt im Detailpanel die frühere Hochrechnung aus `directConnectionRatio * reachableSampleCount`.

Technische Entscheidungen:

- Die Realtime-Abfrage läuft ausschließlich serverseitig; der React-Client ruft nur die Regionfinder-API auf.
- Der Provider sitzt in `server/realtime/dbTransportRestProvider.ts` und transformiert externe Antworten in `ApiItineraryResponse`.
- Standard-Backend ist aktuell `bahn-web`, weil `v6.db.transport.rest` in der Live-Prüfung instabil war und direkte Node-Requests an bahn.de geblockt werden können. Das Backend nutzt kontrolliert `curl` mit Cookie-Warmup als Fallback.
- `REGIONFINDER_REALTIME_PROVIDER=db-transport-rest` schaltet explizit auf den Wrapper `v6.db.transport.rest`; `DB_TRANSPORT_REST_BASE_URL` konfiguriert dessen Basis-URL.
- Ursprung ist per Default Hamburg Hbf über `REGIONFINDER_ORIGIN_DB_STOP_ID=8002549`.
- Stop-Mapping nutzt direkte 7-/8-stellige DB/EVA-Kandidaten aus PublicId/DHID/technischen Stops, danach `/locations/nearby`, danach `/locations`.
- Mapping wird 24 Stunden im Prozess gecacht; Journey-Antworten werden 60 Sekunden pro Ursprung, Ziel und Abfahrtsminute gecacht.
- Nicht auflösbare Ziele liefern `404 db_stop_unmapped`; Upstream-/Timeoutfehler liefern `502 realtime_unavailable`.
- Für alte DHID-ähnliche PublicIds wird serverseitig ein Alias unterstützt: `de:01060:37985:18000526` kann auf `de:01060:37985:1:8000526` aufgelöst werden.

Die API-Typen in `src/api/contracts.ts` enthalten optionale Live-Felder auf Legs: Planzeiten, Verspätungen, Ausfallstatus und Remarks. `ApiItinerary` enthält optional `refreshToken`, `realtimeSource` und `realtimeFetchedAt`; `ApiMetrics` enthält optional `directConnectionCount`.

## OSM-Schienenrekonstruktion

Die Schienenrekonstruktion ist produktiv nutzbar, aber bewusst konservativ in der Standardkarte.

Datenmodell und Pipeline:

- `db/migrations/004_rail_network.sql` aktiviert `pgrouting` und `hstore`.
- Tabellen: `rail_edges`, `rail_vertices`, `stop_rail_snaps`, `route_pattern_rail_matches`.
- `route_pattern_display_geometries` wählt hochkonfidente OSM-Rekonstruktionen als Anzeigegeometrie und fällt sonst auf `route_patterns.geometry` zurück.
- `route_pattern_rail_matches.geometry` erlaubt generische Liniengeometrie, weil rekonstruierte Routen häufig als `MULTILINESTRING` entstehen.
- `npm run rail:reconstruct` filtert die große Geofabrik-PBF zuerst mit osmium auf `railway=rail|light_rail|subway|tram`; der volle osm2pgsql-Import der ungefilterten Deutschland-PBF ist lokal zu langsam.
- `match-patterns` unterstützt `--bbox`, `--corridor`, `--modes` und `--routes`. Korridor- und Linienfilter sind der bevorzugte Weg fuer lokale Nachläufe.

Benannte Korridore: `hamburg-core`, `hamburg-altona-elmshorn`, `hamburg-luebeck`, `hamburg-lueneburg`, `hamburg-buchholz-bremen`, `hamburg-kiel`, `hamburg-buechen`.

Aktueller lokaler Matching-Stand nach den ersten Korridorläufen:

- `159` high-confidence `osm_reconstructed`
- `545` `osm_reconstructed_low_confidence`
- `192` Fallbacks

Bereits stückweise gerechnet:

- U-Bahn: `U1,U2,U3,U4`
- S-Bahn: `S1,S2,S3,S5,S7`
- AKN im DELFI-Snapshot als `RAIL`: `A1,A2,A3`
- Regional-Korridore: `RE8/RB81`, `RE3/RB31`, `RE7/RE70/RB71`, `RE4/RB41`, `RE1`, `RE6/RB61`

Wichtige Einschränkung: Viele S-/Regional-Patterns sind zwar OSM-geroutet, erreichen aber wegen Snap-, Umweg- oder Shape-Abweichungen nur Low-Confidence. Diese Daten sind Diagnosematerial und noch nicht Standardanzeige.

## Aktuelle technische Entscheidungen

- PostGIS ist Quelle für StopPlaces, Route Patterns, Metriken und MVTs.
- pgRouting ist über das Compose-Image `pgrouting/pgrouting:16-3.5-4.0` verfügbar und wird für OSM-Schienenrekonstruktion genutzt.
- Fastify validiert Requests mit Zod-Schemas.
- Gemeinsame API-Antworttypen liegen in `src/api/contracts.ts`.
- Stop- und Route-Tiles akzeptieren `?modes=...`; Stop-Tiles akzeptieren zusätzlich `?profile=...`.
- Stop-Metriken akzeptieren zusätzlich `?date=YYYY-MM-DD`, wenn eine tagesgenaue Direktverbindungszahl gebraucht wird.
- Route-Tiles liefern `route_color`, normalisiert auf `#RRGGBB`, wenn eine echte GTFS-Farbe existiert.
- `npm run rail:reconstruct` filtert OSM-Schienen, lädt sie mit osm2pgsql in `staging_osm_rail_*`, baut `rail_edges`/`rail_vertices`, snappt StopPlaces und erzeugt `route_pattern_rail_matches`.
- Match-Nachläufe werden bevorzugt mit `--corridor`/`--routes` gefahren; große `RAIL`- oder Norddeutschland-Komplettläufe sind lokal weiterhin zu teuer.
- Der API-Modus darf nicht stillschweigend auf Fixture-Daten zurückfallen.
- Fixtures bleiben für Tests und lokale isolierte Entwicklung verfügbar.
- Playwright ist als Dev-Dependency verfügbar; lokale Browser-Smoke-Tests benötigen einmalig `npx playwright install chromium`.

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
