# Betrieb

## Dienste

Produktiver lokaler Standard:

```bash
docker compose up -d postgis
DATABASE_URL=postgres://regionfinder:regionfinder@localhost:55432/regionfinder npm run db:migrate
npm run dev
```

`npm run dev` startet API und Frontend gemeinsam. Lokale Defaults sind PostGIS
`postgres://regionfinder:regionfinder@localhost:55432/regionfinder`, API-Port `4001`,
Frontend-Port `5176` und `VITE_REGIONFINDER_API_BASE_URL=http://127.0.0.1:4001`.

Der Datenbankcontainer basiert auf `pgrouting/pgrouting:16-3.5-4.0`, damit die Migrationen `pgrouting` und OSM-Schienenrekonstruktion nutzen können.

Fixture-/Testmodus:

```bash
REGIONFINDER_USE_FIXTURE_API=1 npm run dev
```

Fixture-Daten werden nur explizit mit `REGIONFINDER_USE_FIXTURE_API=1` verwendet. Ohne `DATABASE_URL` und ohne dieses Flag bricht der API-Start ab.

MOTIS ist als Compose-Profil vorbereitet:

```bash
docker compose --profile motis up motis
```

Der Container ist versioniert gepinnt und nicht öffentlich exponiert.

## Basiskarten-Konfiguration

Der bevorzugte Straßenmodus nutzt MapTilers `openstreetmap`-Rasterstil. Lokal wird der Key vor dem Vite-Start gesetzt; beim Container-Build wird er als Build-Argument übergeben:

```bash
VITE_MAPTILER_KEY=... npm run dev
docker build --build-arg VITE_MAPTILER_KEY=... -f Dockerfile.web .
```

Ohne konfigurierten `VITE_MAPTILER_KEY` fällt der Straßenmodus beim Build auf Esri `World_Street_Map` zurück. Satellit verwendet Esri `World_Imagery` plus `Reference/World_Boundaries_and_Places`. Weil Vite den Key in das Browser-Bundle einbettet, muss er bei MapTiler auf die vorgesehenen Origins beschränkt werden; er ist kein serverseitiges Geheimnis.

CARTOs anonyme Rastertiles dürfen nicht als Fallback verwendet werden: Sie können trotz HTTP `200` ein eingebranntes `API KEY REQUIRED` liefern. Auch direkte Produktionseinbindung von `tile.openstreetmap.org` ist wegen der Tile-Nutzungsrichtlinie kein zulässiger Fallback. Bei Basiskartenproblemen deshalb gerenderte Tiles visuell prüfen, nicht nur Statuscode und Dateigröße.

## Produktions-Deployment (Docker)

`Dockerfile.web` baut das Frontend mit zwei Build-Args:

- `VITE_REGIONFINDER_API_BASE_URL` (Pflicht für Produktionsbuilds; MapLibre lädt Kacheln aus einem Web Worker, wo relative URLs gegen die `blob:`-Worker-URL statt der Seiten-URL aufgelöst werden — absolute URL nötig).
- `VITE_MAPTILER_KEY` (optional; aktiviert die MapTiler-Straßenkarte, siehe oben. Ohne Wert greift der Esri-Fallback).

`Dockerfile.api` kopiert neben `server` und `src/api` auch `scripts/migrate-db.ts` und `db/migrations` in das Image, damit `npm run db:migrate` produktiv innerhalb eines Containers laufen kann (z.B. als `docker compose run --rm api npm run db:migrate` vor dem eigentlichen Start). Ein Deploy, der diesen Schritt ausläßt, hinterlässt den Code auf dem neuesten Stand, aber das Schema veraltet lautlos — Migrationen sollten bei jedem Deploy als eigener Schritt laufen, nicht nur bei Bedarf von Hand.

### Routing-Hotfix vom 2026-11-23

Der zunächst separat ausgelieferte Hotfix läuft aus
`/docker/regionfinder/releases/routing-fix-20261123/source` mit einem Compose-Override.
Seine Änderungen sind inzwischen in den regulären Quellcode übernommen und werden
beim nächsten Aufruf von `/docker/regionfinder/deploy.sh` regulär gebaut.
Die Produktions-`.env` setzt `REGIONFINDER_REALTIME_PROVIDER=bahn-web` und
`REGIONFINDER_REALTIME_TIMEOUT_MS=12000`, sodass die Konfiguration erhalten bleibt.
Vorherige Images und eine ausführbare Rollback-Anweisung liegen im selben Release-Verzeichnis.

## KFZ-Fahrzeiten mit Google Routes

Der Standardprovider `google-routes` fragt ausschließlich im API-Server
`https://routes.googleapis.com/directions/v2:computeRoutes` ab. Verwendet werden
`DRIVE`, `TRAFFIC_AWARE_OPTIMAL` und `BEST_GUESS`; ohne `departureTime` gilt die
aktuelle Zeit bei Google. Ursprung ist Hamburg Hbf (53.5527, 10.0064), Ziel der
exakte ausgewählte StopPlace. Die Uhrzeitsteuerung im Bahn-Block betrifft nur Bahn.
Die Google-Fahrzeit wird mit „Abfahrt jetzt“, Quellenangabe und Abrufzeit in
`Europe/Berlin` angezeigt. Sie ist keine automatische, kontinuierliche Aktualisierung.
Ein erneuter Stationsaufruf holt eine neue Fahrzeit.

Konfiguration (nur Server, niemals `VITE_`):

- `REGIONFINDER_DRIVING_PROVIDER`: Default `google-routes`; `osrm` ist ein expliziter
  alternativer Modus ohne Live-Verkehr. Keine automatische Umschaltung bei Google-Fehlern.
- `REGIONFINDER_GOOGLE_ROUTES_API_KEY`: Google-Schlüssel mit Freigabe für Routes API.
- `REGIONFINDER_GOOGLE_ROUTES_MAX_REQUESTS_PER_MINUTE`: Default 60 pro API-Prozess;
  lokales Limit gegen Anfrage-Spitzen, kein kontoweites Kostenlimit.
- `REGIONFINDER_DRIVING_ORIGIN_NAME`, `REGIONFINDER_DRIVING_ORIGIN_LAT`,
  `REGIONFINDER_DRIVING_ORIGIN_LON`: optionale Ursprungs-Overrides.

Der Produktionsschlüssel liegt in `/docker/regionfinder/secrets/google-routes.env`
(Dateimodus 0600, Verzeichnis 0700), außerhalb des Git-Repositories und aller
Docker-Build-Kontexte. `/docker/regionfinder/docker-compose.yml` lädt diese Datei
nur für `api` über `env_file` und setzt den Provider explizit auf `google-routes`.
Google-Projekt: `quixotic-sol-462215-v9`; Schlüssel eingeschränkt auf Routes API
und die IPv4-Adresse `76.13.153.215`. Bestehender Browser-/MapTiler-Key bleibt separat.
Backups der vorherigen Compose- und Umgebungskonfiguration liegen geschützt unter
`/docker/regionfinder/releases/google-routes-20261123/`.

Die Serverkonfiguration ist vorbereitet; der laufende Dienst wurde dafür noch
nicht neu gestartet. Regulärer Deploy nach Pull des neuen Commits:

```bash
ssh ubuntu@76.13.153.215 /docker/regionfinder/deploy.sh
curl -fsS https://regionfinder.b42.io/api/v1/stops/de%3A02000%3A8006197/driving-route
```

Erwartet: `provider: "google-routes"`, `trafficAware: true`, positive Fahrzeit und
Distanz, `Cache-Control: no-store`. Ein isolierter Smoke-Test mit dem neuen
Provider und dem Produktionsschlüssel war am 23.11.2026 vom VPS erfolgreich.
Er benötigt keinen Neustart der laufenden App.

Google-Aufrufe brechen nach 10 Sekunden ab; Fehlerantworten enthalten keine
Upstream-Bodies oder Schlüssel. Gleichzeitige Anfragen zum selben Ziel teilen
einen laufenden Request. Fertige Google-Routenergebnisse werden weder gecacht
noch in PostGIS gespeichert. HTTP-Antworten dürfen ebenfalls nicht gecacht werden.
Das API-Limit liefert `429/driving_route_rate_limited`, ein fehlender Schlüssel
`503/driving_route_unavailable`, Upstream-Fehler `502/driving_route_unavailable`
und fehlende Routen `404/driving_route_no_route`. Ein von Google gemeldeter Fallback
ohne Verkehrsinformationen wird nicht als Live-Ergebnis ausgegeben.

Der Field-Mask fordert nur Dauer, Distanz und Fallback-Status an, keine
Routenbeschreibung, Abbiegehinweise oder Geometrie. Das entspricht dem hier
verwendeten EEA-Anwendungsfall neben der bestehenden Karte; Google-Inhalte sind
im KFZ-Block mit eigener Quellenangabe abgegrenzt.
Siehe [Traffic-Präferenzen](https://developers.google.com/maps/documentation/routes/config_trade_offs),
[Attribution und Datenhaltung](https://developers.google.com/maps/documentation/routes/policies)
und [EEA-Servicebedingungen, Abschnitt 20](https://cloud.google.com/terms/maps-platform/eea/maps-service-terms).
Für einen Vergleich mit Google Maps müssen Start, exaktes Ziel und Abrufzeit
übereinstimmen; der Stadtteil Tonndorf ist ein anderes Ziel als der Bahnhof.

## DB-Echtzeit

Der API-Prozess lädt Echtzeitverbindungen serverseitig. Relevante Variablen:

- `REGIONFINDER_REALTIME_PROVIDER`: Default `bahn-web`; `db-transport-rest` erzwingt den Wrapper `v6.db.transport.rest`.
- `REGIONFINDER_ORIGIN_DB_STOP_ID`: Default `8002549` für Hamburg Hbf.
- `DB_TRANSPORT_REST_BASE_URL`: Default `https://v6.db.transport.rest`.

Der Standardpfad `bahn-web` nutzt einen kontrollierten `curl`-Fallback mit Cookie-Warmup. Deshalb muss `curl` im lokalen/API-Runtime-Umfeld verfügbar sein.

Stand 2026-11-23: `v6.db.transport.rest` ist aus der lokalen Umgebung und vom
Produktionsserver nicht per DNS auflösbar. Die direkte Bahn-Web-API liefert dort
HTTP 403 (`OPS_BLOCKED`); diese externe Sperre kann die Anwendung nicht beheben.
`REGIONFINDER_REALTIME_PROVIDER=db-transport-rest` deshalb nicht als Workaround setzen.
Der Client meldet eine Zugriffssperre als `realtime_blocked`, ohne sie erneut mit curl
zu versuchen; HTTP-Fehler im curl-Pfad dürfen nicht als leere Verbindungsliste gelten.
Im Detailpanel führt ein Link zur manuellen Bahnauskunft. Für eine Wiederherstellung
der eingebetteten Bahnverbindungen ist wieder ein zugänglicher Bahn-Dienst nötig.

Bahnabfragen verwenden das heutige Datum in `Europe/Berlin`, inklusive Sommer-/Winterzeit.
Die planmäßigen Direktverbindungsmetriken behalten den repräsentativen Fahrplantag
2026-09-15. Stationsdetails, Metriken, Bahn und KFZ laden unabhängig voneinander;
eine langsame Metrikabfrage darf die Routing-Ergebnisse nicht zurückhalten.
Detailanfragen im Browser laufen nach 30 Sekunden aus, Bahn nach 90 Sekunden (mehrstufige
Stationssuche/Fahrplanabfrage); veraltete Anfragen werden beim Auswahlwechsel abgebrochen.

Live-Prüfung:

```bash
curl 'http://127.0.0.1:4001/api/v1/stops/de%3A01060%3A37985%3A1%3A8000526/realtime-itineraries?date=2026-09-15&time=08%3A00&profile=regular_tue_thu'
```

Erwartung: `alternatives` enthält bis zu drei normalisierte Verbindungen ab Hamburg Hbf. Nicht gemappte DB-Ziele liefern `404` mit `error: "db_stop_unmapped"`; Upstream-Probleme liefern `502` mit `error: "realtime_unavailable"`.

Der Standardpfad kann bahn.de-Web-Location-IDs im Format `A=...` verwenden. Der Provider akzeptiert sowohl reine EVA-/DB-IDs als auch solche vollständigen Web-Location-Referenzen.

Tagesgenaue Direktverbindungen werden über den normalen Metrikendpunkt geprüft:

```bash
curl 'http://127.0.0.1:4001/api/v1/stops/de%3A01060%3A37985%3A1%3A8000526/metrics?profile=regular_tue_thu&date=2026-09-15'
```

`directConnectionCount` zählt direkte fahrplanmäßige Trips am angegebenen Datum zwischen Hamburg Hbf und dem Ziel-StopPlace.

## Health Checks

- `GET /health`: Prozess lebt.
- `GET /ready`: aktiver Snapshot verfügbar.

Produktiver Readiness-Check:

```bash
curl http://127.0.0.1:4001/ready
```

Der aktive Produktionssnapshot ist aktuell `delfi-bb69c7e2c8d5`.

## Backups

Postgres-Backup:

```bash
pg_dump "$DATABASE_URL" --format=custom --file=regionfinder.dump
```

Restore in eine neue Datenbank:

```bash
pg_restore --dbname "$DATABASE_URL" --clean --if-exists regionfinder.dump
```

## Snapshot-Rollback

Alte Snapshots bleiben archiviert. Reaktivierung:

```sql
SELECT activate_snapshot('old-public-snapshot-id');
```

Vorher prüfen, ob der Snapshot zu den erwarteten Routingprofilen und Artefakt-Hashes passt.

## Logs und Secrets

Secrets liegen nur in Environment-Variablen. `.env.example` enthält Beispielwerte. Logs dürfen keine Zugangsdaten enthalten. Generierte Rohdaten und große Routingartefakte gehören nicht ins Repository.

## Betriebshinweise Frontend/API

- `npm run dev` startet API und Frontend gemeinsam. `npm run dev:api` startet nur `tsx server/index.ts` ohne Watch-Restart; nach Servercodeänderungen API neu starten.
- Vite-HMR kann bei Änderungen an MapLibre-Quellen oder Hook-Dependency-Strukturen alte Browserzustände halten. In diesem Fall Browser hart neu laden oder den Vite-Prozess neu starten.
- Bei Kartenfilter-Problemen prüfen, ob Tile-Requests `?modes=...` enthalten.
- Bei Reisezeitfarben/Hover-Metriken prüfen, ob Stop-Tile-Requests zusätzlich `?profile=regular_tue_thu` oder das aktive Profil enthalten.
- Bei Direktverbindungszahlen prüfen, ob der Metrics-Request `?date=YYYY-MM-DD` enthält; ohne Datum bleibt `directConnectionCount` leer.
- Beim Schools-Layer prüfen, ob Tile-Requests `/api/v1/tiles/schools/...` mit passenden `?categories=...&states=HH,SH,MV,NI` laufen. `Gymnasium` fragt nur `categories=gymnasium` an; `andere weiterf. Schulen` fragt `comprehensive,waldorf,vocational,upper_secondary` an.
- Beim Places-Layer prüfen, ob Tile-Requests `/api/v1/tiles/places/...` mit passenden `?categories=...&states=HH,SH,MV,NI` laufen. `Höfe`, `Ferienhöfe`, `Güter` und `Museen` werden als getrennte Kategorien geladen und sind standardmäßig aus.
- Bei Verwaltungsgebieten prüfen, ob `/api/v1/tiles/administrative-areas/...` die aktiven `levels=county,municipality` und `states=HH,SH,MV,NI` erhält. Gemeindegeometrien erscheinen absichtlich erst ab Zoom 9.
- Bei Gemeindelisten-Highlights müssen die Requests `/api/v1/tiles/municipality-list-highlights/...` nur aktive `listIds` und einen aktuellen `revision`-Wert enthalten. Listen und Mitgliedschaften sind global; die aktiven Checkboxen stehen browserlokal in `localStorage`.
- Für interne manuelle Places-Pflege müssen API und Frontend explizit mit `REGIONFINDER_ENABLE_PLACE_ADMIN=1` und `VITE_REGIONFINDER_ENABLE_PLACE_ADMIN=1` laufen; ohne API-Flag liefern Schreibzugriffe auf `/api/v1/places` `403`.
- MapLibre-Sources werden im API-Modus bei Moduswechsel entfernt und neu angelegt, damit keine alten ungefilterten Tiles aus dem Cache sichtbar bleiben.
- Schools-MapLibre-Source wird bei Kategorienwechsel ebenfalls entfernt und neu angelegt, damit keine alten POI-Kategorien aus dem Cache sichtbar bleiben.
- Places-MapLibre-Source wird bei Kategorienwechsel ebenfalls entfernt und neu angelegt, damit keine alten POI-Kategorien aus dem Cache sichtbar bleiben.
- Ortsnamen im Straßenmodus sind im MapTiler-`openstreetmap`-Kachelbild enthalten (kein separater Label-Layer). Im Satellitenmodus kommen Orts-/Grenzlabels aus dem separaten Esri-`Reference/World_Boundaries_and_Places`-Overlay (Source `satellite-reference`); bei fehlenden Labels dort die Tile-Requests prüfen.
- Straßen-Basiskarte: bei blankem Kartenhintergrund zuerst prüfen, ob `VITE_MAPTILER_KEY` gesetzt und in MapTiler für die anfragende Origin freigegeben ist. Der Esri-`World_Street_Map`-Fallback wird nur gewählt, wenn beim Build kein Key gesetzt ist; ein vorhandener, aber ungültiger oder falsch beschränkter Key fällt nicht zur Laufzeit zurück.
- Niedrigkonfidente OSM-Schienenmatches sind Diagnosematerial. Wenn in der Karte wieder blaue Diagonalen oder falsche Korridore erscheinen, zuerst prüfen, ob `osm_reconstructed_low_confidence` oder `official_gtfs` versehentlich im Standardlayer sichtbar sind.
- Nach Änderungen an `server/app.ts`, `server/schemas.ts` oder Query-Modulen unter `server/db/queries/` den API-Prozess neu starten; sonst kennt der laufende Prozess neue Endpunkte oder SQL-Pfade noch nicht.
- Browserzugriffe auf Listenmitgliedschaften und Places-Administration verwenden `PUT`, `PATCH` beziehungsweise `DELETE`. Wenn sie nur im Browser mit `Failed to fetch` scheitern, zuerst den CORS-Preflight prüfen; die API muss `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE` und `OPTIONS` erlauben.
