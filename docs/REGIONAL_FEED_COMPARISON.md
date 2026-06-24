# Regional Feed Comparison

Stand: 2026-06-24

Diese Analyse wurde nach der DELFI-Kernintegration erstellt. DELFI bleibt die kanonische Fahrplanquelle. Regionale Feeds wurden in diesem Lauf nicht als zweite Fahrplanwahrheit importiert, weil dadurch ohne deterministische Deduplizierung Trip-Dubletten entstehen koennen.

## Ergebnis

| Region | Offizielle Quelle | Zugriff | Status im Lauf | Nutzbare Rolle |
| --- | --- | --- | --- | --- |
| HVV | https://www.hvv.de/de/fahrplaene/abruf-fahrplaninfos/datenabruf | Verweis auf Open-Data-/Transparenzportal | Quelle identifiziert, kein Merge ausgefuehrt | Enrichment fuer lokale Metadaten, Farben, Plattformen und Geometrien nach DHID-/Stop-Match |
| Niedersachsen/Bremen, VBN/Connect | https://www.vbn.de/service/entwicklerinfos/opendata-und-openservice | oeffentliche Entwicklerinfos, Connect-GTFS fuer Sollfahrplandaten | Quelle identifiziert, kein Merge ausgefuehrt | Enrichment nach deterministischem Match; keine ungepruefte Trip-Uebernahme |
| Mecklenburg-Vorpommern, VVW | https://www.verkehrsverbund-warnow.de/service/open-data.html | Portal mit Registrierung/Freigabe fuer GTFS-Sollfahrplandaten | Zugang als registrierungsgebunden bewertet, kein Download mit Zugangsdaten | Potenzielles Enrichment nach Freigabe |
| Mobilithek | https://mobilithek.info/ | Such- und Metadatenportal | Als zusaetzlicher Suchraum beruecksichtigt | Metadaten- und Lizenzpruefung fuer regionale Quellen |

## Vergleichskriterien

### HVV

- Aktualitaet: nicht in die Produktionsdatenbank uebernommen; vor Nutzung muss der konkrete Feed-Zeitstand aus dem Transparenzportal ermittelt werden.
- Stops/DHIDs: nur nach realer Dateiinspektion belastbar messbar.
- Trips: duerfen nicht pauschal neben DELFI importiert werden.
- Shapes: sinnvoll als moegliche regionale Verbesserung, falls Route, Richtung, DHID-/Stopfolge und Gueltigkeitszeitraum deterministisch passen.
- Betreiber/Plattformen: sinnvoll als Enrichment-Kandidat.
- Lizenz: vor produktiver Nutzung aus dem konkreten Transparenzportal-Datensatz zu speichern.

### VBN / Connect

- Aktualitaet: laut offizieller Entwicklerseite werden Sollfahrplandaten im GTFS-Format ueber Connect bereitgestellt.
- Abdeckung: relevant fuer Bremen/Niedersachsen; Bremen bleibt Routingkorridor, aber nicht Standard-Zielbundesland.
- Trips: keine ungepruefte Uebernahme in den DELFI-Fahrplan.
- Enrichment: Stop-, Betreiber- und Shape-Verbesserung ist moeglich, wenn DHID-/Stopfolge und Zeitraum eindeutig matchen.
- Lizenz: vor produktiver Nutzung aus dem konkreten Feed zu speichern.

### Verkehrsverbund Warnow / Mecklenburg-Vorpommern

- Zugriff: die offizielle Seite beschreibt GTFS-Sollfahrplandaten ueber ein Portal mit Registrierung beziehungsweise Freigabe.
- Status: kein vorhandener Zugang wurde gefunden oder verwendet.
- Blocker: nur die regionale Enrichment-Quelle ist zugangsbeschraenkt; die DELFI-Baseline fuer Mecklenburg-Vorpommern wurde dadurch nicht blockiert.
- Enrichment: nach Freigabe pruefen, ob Plattformen, lokale Linienmetadaten oder Shapes deterministisch auf DELFI abbildbar sind.

## Nicht ausgefuehrte Schritte

- Keine regionale GTFS-Datei wurde in den kanonischen Fahrplan importiert.
- Keine regionalen Trips wurden mit DELFI zusammengefuehrt.
- Keine Deduplizierungsregeln fuer regionale Fahrten wurden produktiv aktiviert.

## Voraussetzung fuer spaetere Nutzung

1. Konkrete regionale Datei herunterladen und mit SHA-256, Lizenz, Zeitstand und Anbieter speichern.
2. Feed mit dem MobilityData GTFS Validator pruefen.
3. DHID-/StopPlace-Matchquote bestimmen.
4. Route-Pattern- und Shape-Match deterministisch gegen DELFI testen.
5. Enrichment nur fuer eindeutig gematchte Objekte schreiben.
6. Fahrten nur dann uebernehmen, wenn ein DELFI-Fehlen nachgewiesen ist und ein Test gegen Doppelfahrten besteht.
