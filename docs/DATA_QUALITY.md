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
- `stop_sequence_approximation`
- `missing`

Stopfolgen-Approximationen dürfen nicht als offizielle Linienwege oder präzise Distanzbasis ausgegeben werden.

Aktuelle UI-Konvention:

- `official_gtfs` wird als echte Route-Pattern-Geometrie angezeigt.
- `stop_sequence_approximation` ist gestrichelt, transparenter und im API-Modus standardmäßig ausgeschaltet.
- Die Legende muss approximierte Geometrien als solche kennzeichnen.

## Bekannte Einschränkungen

- Der MobilityData GTFS Validator lief auf dem DELFI-Produktionsfeed in der lokalen Umgebung in einen Java-Heap-OOM und ist deshalb kein bestandenes Gate für diesen Snapshot.
- ZHV-Vollintegration ist noch zugangsbeschränkt; die aktive Baseline nutzt DELFI-DHIDs und interne IDs für fehlende DHIDs.
- Der ausgeführte MOTIS-Produktionshorizont beträgt 240 Minuten statt des fachlichen 12-Stunden-Ziels.
- HVV-Legacy-Artefakte bleiben separat und werden nicht ungeprüft als zweite Fahrplanwahrheit mit DELFI gemischt.
