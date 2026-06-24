# Betrieb

## Dienste

Produktiver lokaler Standard:

```bash
docker compose up -d postgis
npm run db:migrate
DATABASE_URL=postgres://regionfinder:regionfinder@localhost:55432/regionfinder REGIONFINDER_API_PORT=4001 npm run dev:api
VITE_REGIONFINDER_DATA_MODE=api VITE_REGIONFINDER_API_BASE_URL=http://127.0.0.1:4001 npm run dev -- --host 127.0.0.1 --port 5176
```

Fixture-/Testmodus:

```bash
REGIONFINDER_USE_FIXTURE_API=1 npm run dev:api
VITE_REGIONFINDER_DATA_MODE=api npm run dev
```

MOTIS ist als Compose-Profil vorbereitet:

```bash
docker compose --profile motis up motis
```

Der Container ist versioniert gepinnt und nicht öffentlich exponiert.

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

- `npm run dev:api` startet `tsx server/index.ts` ohne Watch-Restart; nach Servercodeänderungen API neu starten.
- Vite-HMR kann bei Änderungen an MapLibre-Quellen oder Hook-Dependency-Strukturen alte Browserzustände halten. In diesem Fall Browser hart neu laden oder den Vite-Prozess neu starten.
- Bei Kartenfilter-Problemen prüfen, ob Tile-Requests `?modes=...` enthalten.
- MapLibre-Sources werden im API-Modus bei Moduswechsel entfernt und neu angelegt, damit keine alten ungefilterten Tiles aus dem Cache sichtbar bleiben.
