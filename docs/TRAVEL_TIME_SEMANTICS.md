# Fahrzeitsemantik

## Gewünschter Abfahrtszeitpunkt

Der Nutzer ist zum Zeitpunkt `t` am Hamburg-Hbf-Origin abfahrbereit. Jede Berechnung beginnt bei diesem Zeitpunkt, nicht bei der ersten Fahrzeugabfahrt.

## Gesamtreisezeit

Für Ziel `s`, Fahrplandatum `d` und Wunschzeit `t`:

```text
T(s, d, t) = früheste planmäßige Ankunft am Ziel - gewünschter Abfahrtszeitpunkt t
```

Enthalten sind Zugang, anfängliche Wartezeit, Fahrzeugzeit, Umstiegswege, Umstiegswartezeiten und Mindestumstiegszeiten.

Die Produktionsmetrik bezieht sich auf den exakten Ziel-StopPlace. MOTIS darf einen initialen Fußweg zum Einstieg berücksichtigen, aber keinen finalen Fußweg von einer Nachbarhaltestelle zum Ziel. Damit sprechen interne Metrik und Karten-StopPlace vom gleichen Zielort.

Regressionstest:

- Wunschzeit: 08:00
- tatsächliche Abfahrt: 08:10
- Ankunft: 08:40
- korrekte Gesamtreisezeit: 40 Minuten
- alte falsche Rechnung: 30 Minuten

Der Test liegt in `src/domain/__tests__/travelTimeStatistics.test.ts`.

## Umstiege

Umstiege sind `Anzahl Transit-Legs - 1`. Fußwege zählen nicht als Umstieg.

## Produktmetrik

Alle Dauern werden intern in Sekunden gespeichert und berechnet.

- Schnellste Fahrzeit: `min(T)` über erreichbare Samples eines repräsentativen Werktags.
- Aktuelles Profil `regular_tue_thu`: 2026-09-15, 00:00 bis GTFS 28:00, alle 5 Minuten, Maximaldauer 120 Minuten.
- Veröffentlicht wird `fastestSeconds`; nicht erreichbare Ziele haben `fastestSeconds = null`.

Nicht mehr berechnete oder veröffentlichte Produktmetriken:

- Durchschnitt
- Median
- P90
- Reachability-Quote
- erreichbare/nicht erreichbare Sample-Zahlen
- minimale oder mediane Umstiege
- `directConnectionRatio`

Die Tabelle `od_metrics` enthält alte Spalten aus Schema-Kompatibilität weiter. Der aktuelle Metric Run setzt diese Robustheits- und Transferaggregate bewusst auf `NULL` beziehungsweise nicht-publishable.

## Direktverbindungen

Direktverbindungen werden nicht aus MOTIS-Samples abgeleitet. Die API zählt für `GET /api/v1/stops/:publicId/metrics?profile=...&date=YYYY-MM-DD` tagesgenau, wie viele fahrplanmäßige Trips am angegebenen Datum ohne Umstieg vom Origin-StopPlace zum Ziel-StopPlace fahren.
