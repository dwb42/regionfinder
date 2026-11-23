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

Umstiege sind tatsächliche Fahrzeugwechsel. Fußwege zählen nicht selbst als
Umstieg; mehrere Legs desselben durchgehenden Fahrzeugs ebenfalls nicht.
Transitous liefert dafür `itinerary.transfers`; dieser Wert wird unverändert als
`transferCount` übernommen. `interlineWithPreviousLeg` erzeugt den Hinweis, im
Fahrzeug zu bleiben. `Anzahl Transit-Legs - 1` ist nur für Provider geeignet,
deren Legs tatsächlich jeweils getrennte Fahrzeuge repräsentieren.

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

## Zeitbezug und Anzeige externer Verbindungen

Die statische Produktmetrik, konkrete Bahnverbindungen und KFZ-Fahrzeiten sind
unterschiedliche Auskünfte und dürfen nicht zu einer gemeinsamen Live-Metrik
vermischt werden:

- Metrik und Direktverbindungszahl im aktuellen UI beziehen sich auf `2026-09-15`.
- Bahn nutzt bei jeder ausgelösten Anfrage das heutige Datum in `Europe/Berlin` plus gewählte Uhrzeit, initial `08:00`. Die Uhrzeitnavigation ist uhrzeitbasiert; ein eigener Tageswechsel/Datumspicker ist nicht implementiert.
- KFZ nutzt Abfahrt jetzt bei Google. Die Bahn-Uhrzeit ändert diesen Zeitpunkt nicht.

ISO-Zeitstempel behalten ihren Offset beziehungsweise UTC-Bezug. Darstellung in
`Europe/Berlin` berücksichtigt Sommer-/Winterzeit; einfaches Ausschneiden der
Uhrzeit aus einem UTC-String ist falsch.

`ApiItinerary.totalDurationSeconds` bleibt Ankunft minus Wunschzeit einschließlich
anfänglicher Wartezeit. Der Bahn-Block zeigt als „Dauer“ dagegen Ankunft minus
`actualFirstDepartureAt`, also die Dauer ab Beginn der konkreten Alternative.
Bei Transitous ist dieser Beginn `itinerary.startTime` und kann einen initialen
Fußweg umfassen. Beispiel Wunschzeit 08:00, Beginn 08:10, Ankunft 08:40:
API-Gesamtreisezeit 40 Minuten, angezeigte Verbindungsdauer 30 Minuten. Das ändert
nicht die Semantik von `fastestSeconds`.

Echtzeit gilt ereignisbezogen: Abfahrt und Ankunft können unterschiedlich gut
abgedeckt sein. Fehlende/unzuverlässige Echtzeit erzeugt keine Verspätungszahl;
„unbekannt“ darf nicht zu „pünktlich“ werden. Der Status einer Verbindung fasst
die Echtzeitabdeckung ihrer Transit-Legs zusammen, nicht ihre Pünktlichkeit.

KFZ-Dauer und Distanz gelten für die Koordinate der ausgewählten Station.
Ein Stadtteil als Google-Maps-Ziel ist ein anderer Endpunkt. Auch bei gleichen
Koordinaten sind identische Werte zur Google-Maps-Oberfläche nicht garantiert.
