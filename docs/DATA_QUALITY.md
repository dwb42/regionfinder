# Datenqualität

## Quality Gates

Der Import muss prüfen:

- fehlende oder ungültige Koordinaten,
- verwaiste Stop-Times,
- Trips ohne Route,
- Trips ohne aktive Service-Dates,
- ungültige Stop-Sequenzen,
- nicht monotone Zeiten,
- fehlende Shapes,
- Stops weit entfernt von Shapes,
- doppelte DHIDs,
- unaufgelöste Parent-Stationen,
- doppelte Patterns,
- ungültige Geometrien,
- Stops ohne Bundeslandzuordnung,
- Route Patterns ohne Trips,
- Shape-Distanzfehler.

## Berichte

Die Pipeline erzeugt maschinenlesbare Reports für Fixture- und Produktionsläufe. Der aktive DELFI-Snapshot speichert seinen Qualitätsstand zusätzlich im `quality_report` des Snapshots.

Relevante Produktionsberichte:

- `docs/PRODUCTION_DATA_INTEGRATION_REPORT.md`
- `data/source-manifest.json`
- `data/runtime-capabilities.json`
- generierte Reports unter `data/reports/` sind große Laufartefakte und in der Regel nicht zu committen.

## Geometriequalität

Erlaubte Werte:

- `official_gtfs`
- `regional_enrichment`
- `osm_reconstructed`
- `osm_reconstructed_low_confidence`
- `stop_sequence_approximation`
- `missing`

Stopfolgen-Approximationen dürfen nicht als offizielle Linienwege oder präzise Distanzbasis ausgegeben werden.

Aktuelle UI-Konvention:

- `official_gtfs` bleibt Fallback-Datenquelle, wird im Standard-Schienenlayer aber nicht als Ersatz fuer fehlende OSM-Rekonstruktionen sichtbar gemacht, damit keine GTFS-Diagonalen als reale Korridore erscheinen.
- `osm_reconstructed` darf als Anzeigegeometrie verwendet werden, wenn die Rekonstruktion mindestens 0,70 Konfidenz erreicht.
- `osm_reconstructed_low_confidence` bleibt Diagnosematerial und ist im Standardlayer ausgeblendet, bis der jeweilige Korridor visuell belastbar ist.
- `stop_sequence_approximation` ist im API-Modus standardmäßig ausgeschaltet.
- Die Legende muss approximierte oder niedrigkonfidente Geometrien als solche kennzeichnen, sobald diese Layer sichtbar sind.

## DB-Echtzeitqualität

DB-Echtzeitdaten sind ein Vergleichs- und Nutzerkomfortsignal, nicht die kanonische Produktionsmetrik. Sie dürfen die MOTIS-/PostGIS-Metriken nicht überschreiben.

Qualitätsgrenzen:

- Stop-ID-Mapping ist heuristisch, wenn keine direkte EVA-/DB-ID aus PublicId, DHID oder technischen Stop-IDs extrahiert werden kann.
- Nicht gemappte Ziele müssen kontrolliert als `404 db_stop_unmapped` erscheinen.
- Upstream-Ausfälle, Timeouts oder Blockaden müssen als `502 realtime_unavailable` erscheinen.
- Das Frontend muss diese Fehler lokal im DB-Echtzeitblock anzeigen und das Detailpanel weiter nutzbar lassen.
- Realtime-Legs dürfen optionale Planzeiten, Ist-Zeiten, Verspätungen, Ausfallstatus und Remarks enthalten; fehlende Plattformen oder Zeiten sind zulässig.

## Bekannte Einschränkungen

- Der MobilityData GTFS Validator lief auf dem DELFI-Produktionsfeed in der lokalen Umgebung in einen Java-Heap-OOM und ist deshalb kein bestandenes Gate für diesen Snapshot.
- ZHV-Vollintegration ist noch zugangsbeschränkt; die aktive Baseline nutzt DELFI-DHIDs und interne IDs für fehlende DHIDs.
- Der ausgeführte MOTIS-Produktionshorizont beträgt 240 Minuten statt des fachlichen 12-Stunden-Ziels.
- HVV-Legacy-Artefakte bleiben separat und werden nicht ungeprüft als zweite Fahrplanwahrheit mit DELFI gemischt.
- Der aktuelle Standard-Realtime-Pfad nutzt die bahn.de-Web-API mit `curl`-Fallback; das ist eine pragmatische serverseitige Integration und kein zertifiziertes DB-Marketplace-Produkt.
