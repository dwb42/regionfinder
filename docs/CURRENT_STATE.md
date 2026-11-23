# Current State

Stand: 2026-11-23 nach Transitous-Anbindung, Google-Routes-KFZ-Auskunft, unabhängigen Detailabfragen und Veröffentlichung der MIT-Lizenz.

## Produktstand

Regionfinder besitzt einen produktiven V2-Pfad mit Fastify, PostgreSQL/PostGIS/pgRouting, MOTIS-Metriken, Transitous-Bahnverbindungen, Google-Routes-KFZ-Fahrzeiten, MapLibre und MVT-Kacheln. Der Browser lädt keine vollständigen Fahrplan-JSONs und führt keine kanonischen Fahrzeitberechnungen mehr aus.

Regionfinder bleibt dauerhaft kostenlos und nichtkommerziell. Der Quellcode steht
unter [MIT](../LICENSE); Daten und externe Dienste behalten eigene Bedingungen.
MIT selbst schränkt eine kommerzielle Weiterverwendung des Codes nicht ein.

## Auslieferungsstand und offene Integration

- Repository: `main`, Google/Detailpanel-Änderungen in `7dfc0c9`, Transitous/MIT in `ee72566`.
- Am 23.11.2026 per SSH geprüft: Server-Checkout auf `ee72566`; der laufende API-Container setzt `REGIONFINDER_REALTIME_PROVIDER=transitous` und `REGIONFINDER_DRIVING_PROVIDER=google-routes`.
- Google-Key liegt ausschließlich serverseitig außerhalb von Git und Build-Kontexten. Speicherort, Einschränkungen und Deploy-Verfahren: [OPERATIONS.md](OPERATIONS.md).
- Hochbahn-Zugang wurde per E-Mail bei `api@hochbahn.de` beantragt und die angeforderten Bedingungen akzeptiert. Zugangsdaten stehen aus; eine Hochbahn-Anbindung ist nicht implementiert. Transitous ist davon unabhängig nutzbar.

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

## Zusatzdaten: weiterführende Schulen

Die Karte enthält einen snapshot-unabhängigen POI-Datenbestand `schools` mit offiziellen Schulstandorten aus den vier definierten Bundesländern. OSM ist kein Primärdatensatz für Schulen.

Aktueller importierter Stand:

- Gesamt: 1.466 darstellbare Standorte
- `HH`: 260
- `SH`: 411
- `MV`: 133
- `NI`: 662

Normalisierte Kategorien:

- `gymnasium`
- `comprehensive`
- `waldorf`
- `vocational`
- `upper_secondary`

Quellen:

- Hamburg: Transparenzportal/GeoHub `Schulstammdaten und Schülerzahlen der Hamburger Schulen`
- Schleswig-Holstein: OpenData-SH `Schulen`, TSV/CSV mit Schulart-/Bildungsgang-Bitmasken
- Mecklenburg-Vorpommern: Geoportal.MV WFS `Schulverzeichnis in M-V`
- Niedersachsen: LSN Schulstandorte-Shapefiles für allgemeinbildende und berufsbildende Schulen

Das Importskript `pipeline/schools.py` liest CSV/TSV, GeoJSON und ZIPs mit CSV/GeoJSON. Für GML/Shapefile-Quellen werden die Daten vorab per GDAL nach EPSG:4326-GeoJSON konvertiert. Schleswig-Holstein nutzt Bitmasken; der Import dekodiert daraus Gymnasium, Gemeinschaftsschule/Gesamtschule und berufsbildende Schule. Wenige relevante SH-Standorte ohne Koordinaten wurden über Adress-Geocoding ergänzt; diese Ergänzungen müssen bei Datenaktualisierungen erneut geprüft werden.

## Zusatzdaten: generische Places und Ferienhöfe

Zusätzlich zu Schulen gibt es einen snapshot-unabhängigen POI-Datenbestand `places` für manuell und per Batch gepflegte Orte. Schulen bleiben vorerst in `schools` und werden nicht migriert.

Normalisierte Place-Kategorien:

- `hof`
- `ferienhof`
- `gut`
- `museum`

Aktueller lokaler Ferienhof-Stand aus Quelle `ferienhoefe_web_research`:

- Gesamt: 486 aktive `ferienhof`-Orte
- `SH`: 226
- `MV`: 80
- `NI`: 180
- `HH`: 0

Die Ferienhof-Recherche ist ein kuratierter Web-/OSM-Batch. `pipeline/ferienhof_research.py` sammelt öffentliche Kandidaten aus Landreise, Landsichten, Bauernhofurlaub.de und optional lokalen OSM-PBF-Name/Tag-Treffern. Der Playwright-Harvester `scripts/research-landreise-ferienhoefe.mjs` ergänzt dynamisch gerenderte Landreise-Links. Ergebnisartefakte liegen unter `data/raw/places/ferienhoefe/` und `data/reports/places/` und sind nicht für Git gedacht.

Der Import läuft über `pipeline/places.py` und schreibt CSV/TSV/JSON/GeoJSON in `places`. Für Ferienhof-Batches wird `--replace-source --clip-to-admin-boundaries` verwendet, damit alte Treffer derselben Quelle soft-deleted, `state_code` aus `admin_boundaries` korrigiert und Treffer außerhalb `HH/SH/MV/NI` ausgeschlossen werden.

Interne manuelle Pflege ist über API und optionales UI vorbereitet. Schreibende API-Endpunkte sind deaktiviert, solange `REGIONFINDER_ENABLE_PLACE_ADMIN=1` nicht gesetzt ist. Das Frontend zeigt das Admin-Formular nur mit `VITE_REGIONFINDER_ENABLE_PLACE_ADMIN=1`.

## Zusatzdaten: Verwaltungsgebiete und Gemeindelisten

`pipeline/admin_boundaries.py` importiert aus BKG VG250 neben den Bundesländern auch Landkreise (`krs`) und Gemeinden (`gem`) für `HH`, `SH`, `MV` und `NI`. Bundesländer bleiben für räumliche Zuordnung in `admin_boundaries`; die klickbaren Hierarchieebenen liegen snapshot-unabhängig in `administrative_areas`.

`administrative_areas` enthält je aktivem Gebiet:

- Ebene `county` oder `municipality`
- amtlichen Schlüssel, Namen, Gebietstyp und Bundesland
- bei Gemeinden eine Referenz auf den Landkreis
- MultiPolygon-Geometrie und einen stabilen Labelpunkt
- Quelle, Quell-Layer und Importzeitpunkt

Die Gemeindelisten aus `municipality_lists` und `municipality_list_members` sind ebenfalls snapshot-unabhängig. Listennamen sind nach Trimmen und ohne Beachtung der Groß-/Kleinschreibung global eindeutig; Farben müssen `#RRGGBB` entsprechen. Eine Gemeinde kann mehreren Listen angehören, und das Löschen einer Liste entfernt ihre Mitgliedschaften per Cascade. Es gibt derzeit kein Benutzer- oder Mandantenmodell: Listen und Mitgliedschaften sind für alle Nutzer derselben Instanz gemeinsam.

## Produktionsmetriken

Aktive Metrikengine:

- `motis_one_to_all`
- MOTIS `v2.10.2`
- Metric Run `4d9f96b5-f905-42cd-a5e1-2283e9b7bd7d`
- Profil `regular_tue_thu`
- Metric Definition `2026-06-25.fastest-day-exact-stop`
- Repräsentativer Werktag 2026-09-15
- Samplefenster 00:00 bis GTFS 28:00
- Intervall 5 Minuten
- 336 Samples
- Maximaldauer 7.200 Sekunden / 120 Minuten
- 95.870 Ziel-StopPlaces
- 30.737 erreichbare Ziel-StopPlaces
- 65.133 nicht erreichbare Ziel-StopPlaces

R5/r5py wurde real gestartet, ist aber für den vollständigen Deutschland-PBF in der lokalen Umgebung nicht fertig gebaut worden. R5 ist optionaler Vergleichsweg und kein Aktivierungs-Gate, solange `motis_one_to_all` erfolgreich abgeschlossen ist.

Produktmetrik ist ausschließlich die schnellste planmäßige Gesamtreisezeit zum exakten Ziel-StopPlace. Der MOTIS-One-to-all-Request erlaubt Transit und initialen Fußweg zum Einstieg, aber keinen finalen Fußweg zu Nachbarhaltestellen (`postTransitModes` wird nicht gesetzt). Maximaldauer, Umstiege und Verkehrsmittel sind fachlich UI-Filter; der Batch begrenzt nur durch das 120-Minuten-Zeitfenster. Median, P90, Reachability-Quoten, Transferaggregate und `directConnectionRatio` werden nicht mehr als Produktmetriken berechnet oder über die API veröffentlicht.

## Entwicklungsumgebung

Typischer lokaler Produktionsmodus:

```bash
docker compose up -d postgis
DATABASE_URL=postgres://regionfinder:regionfinder@localhost:55432/regionfinder REGIONFINDER_API_PORT=4001 npm run dev:api
VITE_REGIONFINDER_API_BASE_URL=http://127.0.0.1:4001 npm run dev -- --host 127.0.0.1 --port 5176
```

Frontend: `http://localhost:5176/`.

Es können mehrere Vite-Server parallel laufen. Vor UI-Prüfungen den tatsächlichen Port und die gesetzten `VITE_`-Variablen kontrollieren.

## API-Modus UX

Aktuelle UI-Funktionen im API-Modus:

- Klick auf StopPlaces aus MapLibre-Vektor-Tiles lädt Detaildaten in das rechte Panel.
- Detailpanel zeigt Metriken, Bahnverbindungen, KFZ-Fahrzeit, bedienende Linien, Datenstand und StopPlace-Details.
- Datenstand und technische StopPlace-Details sind einklappbare Abschnitte, damit der Normalzustand mehr Raum fuer die Karte und die Verbindungsauskunft laesst.
- Die Überschrift für Verbindungsauskunft lautet `Bahn 🚂`; der frühere lokale Block `Konkrete Verbindung`/`Unser System` wird im API-Detailpanel nicht mehr gerendert.
- Die Startzeit für Bahnverbindungen sitzt im Detailpanel. `Frühere` und `Spätere` setzen die Startzeit relativ zu den aktuell geladenen Alternativen; die linke Sidebar enthält keine separate Abfahrtszeitsteuerung mehr.
- Stationsdetails, Metriken, Bahn und KFZ laden unabhängig; eine langsame Metrikabfrage blockiert keine Verbindungsauskunft. Auswahlwechsel brechen veraltete Requests ab; Fehler bleiben lokal im betroffenen Bereich.
- Bahn zeigt `Echtzeitdaten`, `Teilweise Echtzeitdaten` oder `Nur Fahrplandaten`. Ohne Echtzeit wird keine Pünktlichkeit behauptet. Zeiten werden in `Europe/Berlin` formatiert.
- KFZ zeigt Abfahrt jetzt und Abrufzeit; Änderungen der Bahn-Uhrzeit lösen keine KFZ-Abfrage aus. Es gibt kein kontinuierliches Live-Polling.
- Basiskarten-Umschalter:
  - OpenStreetMap-Straßenkarte über MapTiler (`openstreetmap`-Rasterstil, Schlüssel `VITE_MAPTILER_KEY`, 512px-Kacheln, mit integrierten Labels). Ohne gesetzten Schlüssel automatischer Fallback auf schlüsselloses Esri `World_Street_Map`.
  - Esri-Satellit (`World_Imagery`) plus Esri-Orts- und Grenzlabel-Overlay (`Reference/World_Boundaries_and_Places`), nur im Satellitenmodus sichtbar.
- Zoom-Control sitzt links oben in der Map-Card; die aktuelle Zoomstufe wird direkt darunter angezeigt.
- ÖPNV-Layer:
  - `Regional/Fern`
  - `S-Bahn/AKN`
  - `U-Bahn`
  - `Bus`
- Default: `Regional/Fern`, `S-Bahn/AKN`, `U-Bahn` aktiv; `Bus` aus.
- MVT-Kacheln werden serverseitig per `modes` gefiltert.
- Stop-MVTs enthalten zusätzlich Reisezeitmetrik, Stop-Priorität und kompakte Linienlabels für Hover/Styling; sie werden mit dem aktiven Routingprofil angefragt.
- Beim Umschalten der Modi entfernt der Client die MapLibre-Vector-Tile-Sources und legt sie neu an, damit keine alten ungefilterten Tiles aus dem Cache sichtbar bleiben.
- Route Patterns verwenden echte GTFS-Farben aus `routes.color`, falls vorhanden; sonst Modus-Fallbackfarben.
- Route-Pattern-Geometrien kommen über die View `route_pattern_display_geometries`. Hochkonfidente OSM-Rekonstruktionen ersetzen GTFS-Fallbacks.
- Niedrigkonfidente OSM-Rekonstruktionen und `stop_sequence_approximation` werden im Standardlayer ausgeblendet. Sie bleiben als Qualitätszustände in den Daten erhalten, werden aber nicht als präzise Strecke dargestellt, weil sie noch sichtbare Fehlkorridore erzeugen können.
- Reisezeitfenster filtern sichtbare StopPlaces anhand von `fastest_seconds`. Wenn einzelne Fenster deaktiviert sind, verschwinden StopPlaces außerhalb der aktiven Fenster aus der Karte.
- Der maximale Umstiegsfilter und `Unerreichbare anzeigen` sind im API-Modus entfernt; standardmäßig werden alle verfügbaren Ziele der aktiven Layer gezeigt.
- Die frühere Sidebar-Suche und Suchtrefferliste ist im API-Modus entfernt. Das Detailpanel wird über Klick auf einen StopPlace in der Karte geöffnet. Der API-Endpunkt `/api/v1/stops/search` bleibt als technische Schnittstelle bestehen, ist aber nicht mehr Teil der aktuellen Sidebar-UX.
- Wohnregionen sind geschätzte Kreise um alle aktuell sichtbaren verfügbaren Ziele. Der Radius nutzt den Schätzfaktor `0,75 km/min`; Optionen sind 5, 10, 15 und 20 Minuten.
- Reisezeitfenster und Stationskreise nutzen dieselbe Farbskala: 30 min grün, 45 min teal, 60 min ocker, 75 min orange, 90 min rot.
- Metrische Maßstabsleiste unten rechts in der Karte.
- `Schulen anzeigen` am unteren Ende der Sidebar:
  - `Gymnasium`
  - `andere weiterf. Schulen`
- Beide Schul-Checkboxen sind standardmäßig aktiv. Der Client lädt Schools-MVTs über `categories=...` neu, wenn eine Checkbox umgeschaltet wird.
- Schulmarker sind reine Karten-POIs ohne Detailpanel-Klick. Hover zeigt Name und offizielle Schulart. Gymnasien sind blau hervorgehoben; andere weiterführende Schulen bleiben neutral.
- `Orte anzeigen`: Generische Places werden über `Höfe`, `Ferienhöfe`, `Güter` und `Museen` gesteuert. Diese Layer sind standardmäßig deaktiviert und werden nur nach Auswahl geladen.
- Place-Marker sind anklickbare Karten-POIs aus dem Places-MVT. Sie werden nicht durch ÖPNV-Modi oder Reisezeitfenster gefiltert; Hover zeigt Name und Kategorie. Das rechte Detailpanel zeigt Kategorie, Adresse und – sofern vorhanden – getrennte Links zur Website des Ortes und zum recherchierten Quelleintrag.
- `Verwaltungsgebiete` bietet getrennte Checkboxen für `Landkreise` und `Gemeinden`. Die Auswahl wird auf der Karte hervorgehoben und öffnet rechts Typ, amtlichen Schlüssel und bei Gemeinden den übergeordneten Landkreis. Gemeindegeometrien werden erst ab Zoom 9, Gemeindelabels ab Zoom 10 geliefert.
- `Gemeindelisten` ist der letzte reguläre Sidebar-Block. Listen und Mitgliedschaften werden global in PostGIS gespeichert, während aktive Listen-Checkboxen im Browser verbleiben. Im Gemeinde-Detailpanel sind Mehrfachzuordnungen möglich; die farbigen Highlight-MVTs werden unabhängig vom Schalter `Gemeinden` ab Zoom 6 geladen.
- Das interne Place-Admin-Formular erscheint nur mit `VITE_REGIONFINDER_ENABLE_PLACE_ADMIN=1` und erlaubt Anlegen, Bearbeiten und Soft-Delete von Places.

## Bahnverbindungen, KFZ und Direktverbindungen

Die drei Auskünfte haben getrennte Datenquellen und Zeitbezüge:

| Auskunft | Datenquelle | Zeitbezug |
| --- | --- | --- |
| Schnellste Gesamtreisezeit und Direktverbindungszahl | lokales DELFI/PostGIS/MOTIS | Profil `regular_tue_thu`, Referenztag `2026-09-15` |
| Bahnverbindungen | öffentliche Transitous-API | heutiges Datum in `Europe/Berlin` plus gewählte Uhrzeit (initial `08:00`) |
| KFZ-Fahrzeit | Google Routes | Abfahrt jetzt, aktuelle Verkehrslage |

`GET /api/v1/stops/:publicId/realtime-itineraries?date=YYYY-MM-DD&time=HH:mm&profile=...`
liefert bis zu drei normalisierte Alternativen ab Hamburg Hbf. Standard ist
`REGIONFINDER_REALTIME_PROVIDER=transitous`, ohne API-Key. Die Factory in
`server/realtime/createRealtimeProvider.ts` wählt den Provider; `server/realtime/transitous/`
enthält Transport/Cache, validierte Schemas, Stationsauflösung und Journey-Mapping.
Exakte DELFI-Stations-IDs werden vor einer räumlich und nach Namen begrenzten
Geocoding-Suche geprüft. `bahn-web` und `db-transport-rest` bleiben ausdrücklich
wählbare Legacy-Provider; ihre externen Zugangsstörungen waren Anlass für den Wechsel.

Transitous liefert abhängig von Quelle und Fahrt Echtzeit oder nur Fahrplan.
Die UI zeigt diesen Unterschied pro Verbindung und Leg, erhält Ausfälle,
Gleisänderungen und Meldungen und zählt durchgehende Züge nicht als Umstieg.
Quellenlink zu Transitous und OSM-Attribution gehören zur Anzeige.
Ergebnisse werden 60 Sekunden gecacht; gleichzeitige identische Abfragen werden
zusammengeführt. Limits von 700 Planversuchen/24 Stunden und 30/Minute gelten
pro Prozess und gehen bei Neustart verloren. Keine automatisierten Batch-Abfragen;
Skalierung oder höheres Aufkommen erfordert vorherige Abstimmung mit Transitous.
Details und Fehlercodes: [Architektur](TARGET_ARCHITECTURE.md#bahnprovider) und
[Betrieb](OPERATIONS.md#bahnverbindungen-mit-transitous).

`GET /api/v1/stops/:publicId/driving-route` verwendet standardmäßig
`REGIONFINDER_DRIVING_PROVIDER=google-routes` mit `DRIVE`, `TRAFFIC_AWARE_OPTIMAL`
und `BEST_GUESS`. Start ist Hamburg Hbf, Ziel die Koordinate des ausgewählten
StopPlace. Google-Ergebnisse werden weder dauerhaft gespeichert noch gecacht;
nur laufende identische Anfragen werden zusammengeführt. Die UI zeigt Google Maps
als Quelle, „Abfahrt jetzt“ und den Abrufzeitpunkt. `osrm` ist ein expliziter
Alternativmodus ohne Live-Verkehr, kein automatischer Fehler-Fallback. Ein
identisches Ergebnis zur Google-Maps-Oberfläche wird nicht garantiert, insbesondere
bei anderen Start-/Zielpunkten oder Abrufzeiten.

Der Metrikendpunkt `/metrics?profile=...&date=YYYY-MM-DD` zählt mit
`directConnectionCount` planmäßige direkte Trips am angegebenen Tag. Externe
Verbindungsabfragen überschreiben weder diese Werte noch `fastestSeconds`.
Der serverseitige Alias für ältere PublicIds (z.B. `de:01060:37985:18000526` →
`de:01060:37985:1:8000526`) bleibt erhalten.

## Datenverträge der Verbindungsauskunft

Die Integration benötigt keine neue Datenbanktabelle oder Migration und keinen
neuen GTFS-Import. Änderungen betreffen die API-Typen in `src/api/contracts.ts`:

- `ApiItineraryLeg.realtime?` unterscheidet vorhandene Echtzeit von reinem Fahrplan; fehlende Verspätungen bedeuten unbekannt, nicht null Sekunden.
- `ApiItinerary.realtimeStatus?`: `realtime`, `partial` oder `scheduled`; `realtimeSource` und `realtimeFetchedAt` bleiben erhalten.
- `ApiItineraryResponse` erhält optionale `provider`, `sourceAttribution` und `sourceAttributionUrl`.
- `ApiDrivingRouteResponse` enthält optional `trafficAware` und `fetchedAt` neben Dauer, Distanz, Provider und Quellenangabe.

Die Felder bleiben für lokale/Legacy-Provider optional. Verbindliche Semantik und
Cache-Grenzen stehen in [TARGET_ARCHITECTURE.md](TARGET_ARCHITECTURE.md#datenvertraege-fuer-externe-verbindungen).

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
- Schools-Tiles akzeptieren `?categories=...&states=...` und nutzen den MVT-Layernamen `schools`.
- Places-Tiles akzeptieren `?categories=...&states=...` und nutzen den MVT-Layernamen `places`.
- Administrative-Area-Tiles akzeptieren `?levels=county,municipality&states=...` und enthalten getrennte Polygon- und Label-Layer.
- Gemeindelisten-Highlights werden ausschließlich für aktive Listen über `?listIds=...&revision=...` geladen. Der revisionsabhängige Source-Key sorgt dafür, dass Mitgliedschaftsänderungen nicht durch alte MapLibre-Tiles verdeckt werden.
- Schreibende Places-Endpunkte sind interne Pflegeoberfläche und werden serverseitig über `REGIONFINDER_ENABLE_PLACE_ADMIN=1` freigeschaltet.
- Fastify-CORS erlaubt neben `GET`/`POST` ausdrücklich `PUT`, `PATCH`, `DELETE` und `OPTIONS`, damit Mitgliedschafts- und Admin-Mutationen aus einem separat laufenden Vite-Frontend die Browser-Preflight-Prüfung bestehen.
- Stop-Metriken akzeptieren zusätzlich `?date=YYYY-MM-DD`, wenn eine tagesgenaue Direktverbindungszahl gebraucht wird.
- Der Metrik-Referenztag im API-Frontend bleibt `2026-09-15`; Bahn nutzt dagegen das heutige Berliner Datum. Diese beiden Zeitbezüge nicht zusammenlegen.
- Route-Tiles liefern `route_color`, normalisiert auf `#RRGGBB`, wenn eine echte GTFS-Farbe existiert.
- `npm run rail:reconstruct` filtert OSM-Schienen, lädt sie mit osm2pgsql in `staging_osm_rail_*`, baut `rail_edges`/`rail_vertices`, snappt StopPlaces und erzeugt `route_pattern_rail_matches`.
- Match-Nachläufe werden bevorzugt mit `--corridor`/`--routes` gefahren; große `RAIL`- oder Norddeutschland-Komplettläufe sind lokal weiterhin zu teuer.
- Der API-Modus darf nicht stillschweigend auf Fixture-Daten zurückfallen.
- Ohne `DATABASE_URL` bricht der API-Start ab, außer `REGIONFINDER_USE_FIXTURE_API=1` ist explizit gesetzt.
- Fixtures bleiben für Tests und lokale isolierte Entwicklung verfügbar.
- `PostgresRepository` delegiert an fokussierte Query-Module unter `server/db/queries/`; neue SQL-Blöcke sollen dort statt in der Adapterklasse liegen.
- `src/App.tsx` startet `src/ApiApp.tsx`. `src/ApiApp.tsx` ist API-Layout/Verdrahtung; Hooks, MapLibre-Canvas, Layerdefinitionen, Formatter und Detailpanel-Komponenten liegen in `src/apiApp/`.
- `MapLibreCanvas` wird lazy geladen, damit MapLibre nicht im API-Shell-Chunk landet.
- Der große MapLibre-Lazy-Chunk ist akzeptiert; Vite nutzt `chunkSizeWarningLimit: 1100`, damit der bewusst isolierte MapLibre-Chunk keine Warnung mehr erzeugt.
- Playwright ist als Dev-Dependency verfügbar; lokale Browser-Smoke-Tests benötigen einmalig `npx playwright install chromium`.

## Schools-Datenmodell und API

`db/migrations/009_schools.sql` legt die Tabelle `schools` an:

- `source_id`, `source_school_id`
- `name`
- `school_category`
- `school_type_label`
- `state_code`
- `address`, `website`
- `geometry(Point, 4326)`
- `raw_properties`
- `imported_at`

Wichtige Constraints und Indizes:

- `UNIQUE (source_id, source_school_id)`
- GiST auf `geometry`
- B-Tree auf `school_category` und `state_code`

Repository und SQL folgen dem bestehenden Pattern: `PostgresRepository` delegiert an `server/db/queries/tileQueries.ts`. Der Endpunkt lautet:

```text
GET /api/v1/tiles/schools/{z}/{x}/{y}.mvt?categories=gymnasium,comprehensive,waldorf,vocational,upper_secondary&states=HH,SH,MV,NI
```

MVT-Properties: `id`, `name`, `school_category`, `school_type_label`, `state_code`.

## Places-Datenmodell und API

`db/migrations/010_places.sql` legt die Tabelle `places` an:

- `source_id`, `source_place_id`
- `origin` mit `imported` oder `manual`
- `category` mit `hof`, `ferienhof`, `gut`, `museum`
- `name`
- `state_code`
- `address`, `website`
- `geometry(Point, 4326)`
- `raw_properties`
- `imported_at`, `created_at`, `updated_at`, `deleted_at`

Wichtige Constraints und Indizes:

- `UNIQUE (source_id, source_place_id)`
- GiST auf `geometry` für aktive Datensätze
- B-Tree auf `category`, `state_code` und `source_id/source_place_id`

Repository und SQL folgen dem bestehenden Query-Modul-Pattern: `PostgresRepository` delegiert Places-Listen, CRUD und Tiles an `server/db/queries/placeQueries.ts` und `server/db/queries/tileQueries.ts`.

```text
GET /api/v1/places?categories=ferienhof&states=SH,MV,NI
GET /api/v1/places/:id
POST /api/v1/places
PATCH /api/v1/places/:id
DELETE /api/v1/places/:id
GET /api/v1/tiles/places/{z}/{x}/{y}.mvt?categories=hof,ferienhof,gut,museum&states=HH,SH,MV,NI
```

MVT-Properties: `id`, `name`, `category`, `state_code`, `origin`.

## Verwaltungsgebiete und Gemeindelisten: Datenmodell und API

`db/migrations/011_administrative_areas.sql` definiert `administrative_areas` mit einer eindeutigen Kombination aus `level` und `official_key`, Landkreis-Gemeinde-Hierarchie, aktiver MultiPolygon-Geometrie, Labelpunkt sowie räumlichen und fachlichen Indizes. `pipeline/admin_boundaries.py` aktualisiert die Tabelle beim BKG-Import und markiert nicht mehr gelieferte Datensätze aus derselben Quelle inaktiv.

`db/migrations/012_municipality_lists.sql` definiert:

- `municipality_lists`: UUID, global eindeutiger Name, Farbe, Erstellungs- und Änderungszeitpunkt
- `municipality_list_members`: zusammengesetzter Primärschlüssel aus Liste und `administrative_areas`-Gemeinde

SQL für Listen und Mitgliedschaften liegt im fokussierten Modul `server/db/queries/municipalityListQueries.ts`; Geometrien bleiben im Tile-Query-Modul. Implementierte Endpunkte:

```text
GET    /api/v1/municipality-lists
POST   /api/v1/municipality-lists
PATCH  /api/v1/municipality-lists/:id
DELETE /api/v1/municipality-lists/:id
GET    /api/v1/municipality-lists/memberships/:officialKey
PUT    /api/v1/municipality-lists/:id/municipalities/:officialKey
DELETE /api/v1/municipality-lists/:id/municipalities/:officialKey
GET    /api/v1/tiles/administrative-areas/{z}/{x}/{y}.mvt?levels=county,municipality&states=HH,SH,MV,NI
GET    /api/v1/tiles/municipality-list-highlights/{z}/{x}/{y}.mvt?listIds=...&revision=...
```

Die Mitgliedschaftsmutationen sind idempotent. Unbekannte Listen oder Gemeinden liefern `404`, Namenskonflikte liefern `409 municipality_list_name_conflict`. Die aktiven Listen-IDs sind absichtlich kein Serverzustand; der Browser speichert sie unter `regionfinder.municipality-lists.active.v1` in `localStorage`.

## Verifikation

Für den Routing-Stand `ee72566` am 23.11.2026 erfolgreich: Build, 123 Vitest-Tests, Lint und gezielte TypeScript-Prüfung des neuen Providers. Die sechs Live-Testziele Tonndorf, Aumühle, Buxtehude, Lüneburg, Lübeck Hbf und Ohlstedt wurden auch aus einem separaten VPS-Container erfolgreich abgefragt. Das ist eine Stichprobe, keine Zusage vollständiger Echtzeitabdeckung.

Standardprüfung nach Codeänderungen:

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

Places-Smoke:

```bash
curl 'http://127.0.0.1:4001/api/v1/places?categories=ferienhof&states=SH,MV,NI&limit=3'
curl -o /tmp/places.mvt 'http://127.0.0.1:4001/api/v1/tiles/places/8/135/82.mvt?categories=ferienhof&states=HH,SH,MV,NI'
```
