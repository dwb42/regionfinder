# Fahrzeitsemantik

## Gewünschter Abfahrtszeitpunkt

Der Nutzer ist zum Zeitpunkt `t` am Hamburg-Hbf-Origin abfahrbereit. Jede Berechnung beginnt bei diesem Zeitpunkt, nicht bei der ersten Fahrzeugabfahrt.

## Gesamtreisezeit

Für Ziel `s`, Fahrplandatum `d` und Wunschzeit `t`:

```text
T(s, d, t) = früheste planmäßige Ankunft am Ziel - gewünschter Abfahrtszeitpunkt t
```

Enthalten sind Zugang, anfängliche Wartezeit, Fahrzeugzeit, Umstiegswege, Umstiegswartezeiten und Mindestumstiegszeiten.

Regressionstest:

- Wunschzeit: 08:00
- tatsächliche Abfahrt: 08:10
- Ankunft: 08:40
- korrekte Gesamtreisezeit: 40 Minuten
- alte falsche Rechnung: 30 Minuten

Der Test liegt in `src/domain/__tests__/travelTimeStatistics.test.ts`.

## Umstiege

Umstiege sind `Anzahl Transit-Legs - 1`. Fußwege zählen nicht als Umstieg.

## Statistik

Alle Dauern werden intern in Sekunden gespeichert und berechnet.

- Schnellste Fahrzeit: `min(T)` über erreichbare Samples.
- Durchschnittliche Gesamtreisezeit: arithmetisches Mittel erreichbarer `T`.
- Typische Fahrzeit, Median: mittlerer Wert; bei gerader Anzahl Mittelwert der beiden mittleren Werte.
- P90: Nearest-Rank. Rang `ceil(0,90 * n)`.

Die Methode ist als `nearest-rank-p90` in Code, Tests und API-Metadaten benannt.

## Nicht erreichbare Samples

Gespeichert werden Gesamtzahl, erreichbare Samples, nicht erreichbare Samples und Quote. Median wird erst ab 50 Prozent Quote veröffentlicht, P90 erst ab 90 Prozent. Durchschnitt und schnellster Wert müssen immer zusammen mit der Erreichbarkeitsquote angezeigt werden.

P90 ist keine Zuverlässigkeits- oder Verspätungskennzahl.
