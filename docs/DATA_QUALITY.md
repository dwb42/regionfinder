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

## Qualität externer Verbindungsauskünfte

Transitous-Bahnverbindungen und Google-KFZ-Fahrzeiten sind nutzerseitige
Verbindungsauskünfte, keine kanonischen Produktionsmetriken. Sie dürfen die
DELFI-/MOTIS-/PostGIS-Metriken nicht überschreiben.

### Bahn

- Stationsidentität zuerst anhand verifizierter DELFI-ID und Koordinate prüfen. Geocoding ist nur ein begrenzter Fallback mit Namens-/Entfernungsprüfung; eine nahe Fernbusstation gleichen Namens darf nicht eine vorhandene exakte Bahn-ID verdrängen.
- Nicht gemappte Ziele: `404/realtime_stop_unmapped`. Ungültige Payloads, Upstream-Ausfälle und Timeouts: `502/realtime_unavailable`. Limits: `429/realtime_rate_limited`. Diese Zustände sind von einer gültigen leeren Verbindungsliste zu unterscheiden.
- Echtzeitabdeckung variiert nach Datenquelle und Fahrt. `realtimeStatus` unterscheidet volle, teilweise und fehlende Abdeckung der Transit-Legs; keine Aussage über Pünktlichkeit ableiten.
- Verspätungen pro Abfahrt/Ankunft nur bei belastbarer Echtzeit ausweisen. `NO_RT_DATA`, `INCONSISTENT_RT` oder unbekannte Zeitgründe dürfen nicht als null Sekunden Verspätung interpretiert werden.
- Ausfälle, Gleisänderungen und vollständige Meldungen erhalten. Mehrere Legs eines durchgehenden Fahrzeugs sind kein Umstieg; `transfers` des Providers verwenden.
- Fehlende Distanzen bleiben `null`. Transitous-Routengeometrien werden derzeit nicht dargestellt; Kartenlinien bleiben unabhängig aus PostGIS/MVT.
- Quellenlink und OSM-Attribution sichtbar halten. Cached Antworten behalten den ursprünglichen Abrufzeitpunkt; Ergebnis-TTL 60 Sekunden.
- Fehler werden im Bahn-Block angezeigt. Stationsdetails, Metriken und KFZ bleiben unabhängig nutzbar; alte Antworten dürfen nach Auswahlwechsel nicht neuere Ergebnisse überschreiben.

Legacy-Provider behalten eigene Codes wie `db_stop_unmapped` und
`realtime_blocked`. Bekannte Zugriffssperren nicht mit leeren Ergebnissen kaschieren.

### KFZ

- Google Routes nutzt `TRAFFIC_AWARE_OPTIMAL` und `BEST_GUESS`, Abfahrt jetzt. Ein Upstream-Fallback ohne Verkehrsdaten wird als Fehler behandelt.
- Abfahrtszeitpunkt, exakte Start-/Zielkoordinate und Abrufzeit müssen für Vergleiche übereinstimmen. Identische Ergebnisse zur Google-Maps-Oberfläche werden dennoch nicht zugesagt.
- Ergebnisse weder dauerhaft speichern noch cachen; nur gleichzeitige identische Requests zusammenführen. `Cache-Control: no-store` und Google-Quellenangabe beibehalten.
- Fehlender Key, Quota, keine Route und Upstream-Fehler bleiben unterscheidbar; Codes stehen in [OPERATIONS.md](OPERATIONS.md#kfz-fahrzeiten-mit-google-routes). Niemals Provider-Bodies oder Credentials in Nutzerfehlern offenlegen.
- Keine automatische Umschaltung auf OSRM. Wer `osrm` ausdrücklich aktiviert, erhält eine als solche bezeichnete Schätzung ohne Live-Verkehr.

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
- Transitous ist ein externer öffentlicher Dienst mit begrenzter Echtzeitabdeckung und ohne Verfügbarkeitszusage durch Regionfinder. Die lokalen Abfragelimits sind Prozessspeicher, keine instanzübergreifende dauerhafte Quota.
