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

## Schulen-POI-Qualität

Der Schools-Layer ist ein Karten-POI-Layer, keine Routingmetrik. Er darf keine DELFI-/MOTIS-Metriken überschreiben und ist unabhängig vom aktiven Fahrplansnapshot.

Qualitätsregeln:

- Primärquellen sind offizielle Schulstandortdaten der Länder `HH`, `SH`, `MV`, `NI`; OSM ist keine Primärquelle.
- Nur Standorte mit WGS84-Punktgeometrie werden importiert und in MVTs ausgegeben.
- Kategorien werden auf `gymnasium`, `comprehensive`, `waldorf`, `vocational`, `upper_secondary` normalisiert; die offizielle Quellbezeichnung bleibt in `school_type_label` erhalten.
- SH-Schularten/Bildungsgänge sind Bitmasken und müssen als solche dekodiert werden. Freie Trägerschaft allein ist keine Schulform; Waldorf wird nur über Name/Schulbezeichnung erkannt.
- Standorte ohne Koordinate müssen vor Import explizit ergänzt oder ausgeschlossen werden. Geocoding-Fallbacks sind in der Doku/Reports nachvollziehbar zu halten und bei Quellupdates erneut zu prüfen.
- `source_id + source_school_id` ist der Deduplizierungsschlüssel. Mehrere Standorte einer Schule bleiben getrennte POIs, wenn die Quelle getrennte Standort-IDs liefert.

## Places-POI-Qualität

Der Places-Layer ist ein Karten-POI-Layer, keine Routingmetrik. Er ist unabhängig vom aktiven Fahrplansnapshot und fachlich getrennt vom Schools-Layer.

Qualitätsregeln:

- Erlaubte Kategorien sind `hof`, `ferienhof`, `gut`, `museum`.
- Nur WGS84-Punktgeometrien werden importiert und in MVTs ausgegeben.
- `source_id + source_place_id` ist der Deduplizierungsschlüssel für Batchimporte; bestehende Treffer derselben Quelle werden mit `--replace-source` soft-deleted und dann per Upsert reaktiviert.
- Breite Web-/OSM-Recherchen sollen mit `--clip-to-admin-boundaries` importiert werden, damit `state_code` aus `admin_boundaries` korrigiert und Treffer außerhalb `HH/SH/MV/NI` soft-deleted werden.
- Ferienhof-Kandidaten müssen eine nachvollziehbare Quelle in `raw_properties`, `source_url`, `detail_url` oder Website-Feldern behalten. Generierte Reports unter `data/reports/places/` dienen als Audit-Spur.
- OSM-Treffer sind ODbL-pflichtige Daten; bei Verwendung oder Veröffentlichung muss die OSM-Attribution beachtet werden.
- Manuelle Änderungen setzen `origin = manual` und dürfen importierte Batchquellen nicht ohne bewusstes `source_id/source_place_id` überschreiben.

## Bekannte Einschränkungen

- Der MobilityData GTFS Validator lief auf dem DELFI-Produktionsfeed in der lokalen Umgebung in einen Java-Heap-OOM und ist deshalb kein bestandenes Gate für diesen Snapshot.
- ZHV-Vollintegration ist noch zugangsbeschränkt; die aktive Baseline nutzt DELFI-DHIDs und interne IDs für fehlende DHIDs.
- Der aktuelle MOTIS-Produktionslauf begrenzt die fachliche Maximaldauer bewusst auf 120 Minuten. StopPlaces außerhalb dieses Fensters bleiben ohne `fastestSeconds`.
- Regionale Fahrplandaten dürfen nicht ungeprüft als zweite Fahrplanwahrheit mit DELFI gemischt werden.
- Der aktuelle Standard-Realtime-Pfad nutzt die bahn.de-Web-API mit `curl`-Fallback; das ist eine pragmatische serverseitige Integration und kein zertifiziertes DB-Marketplace-Produkt.
