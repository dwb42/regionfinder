# Current State

Stand dieser Dokumentation: nach Integration von HVV-GTFS-Layern, HVV-Haltestellendetails und geschätzten HVV-Reisezeiten.

## Produktstand

Regionfinder Bahn ist ein React/Vite/Leaflet-MVP für Bahn- und ÖPNV-Erreichbarkeit im Raum Hamburg.

Die App kann aktuell:

- Seed-Bahnhöfe ab einem Startbahnhof nach Reisezeit berechnen.
- HVV-GTFS-Haltestellen und Linien anzeigen.
- Schienenlayer standardmäßig anzeigen und Bus/Fähre optional zuschalten.
- Bei Klick auf eine HVV-Haltestelle rechts Detailinformationen anzeigen, ohne die Karte zu verschieben.
- Alle Linien hervorheben, die an der ausgewählten HVV-Haltestelle halten.
- Für HVV-Haltestellen außerhalb des Seed-Routers eine geschätzte Reisezeit berechnen.

## Aktuelle Defaults

- Startbahnhof: `Hamburg Hbf`.
- Kartenstart: explizit auf den aktuellen Startbahnhof zentriert, Zoom `10`.
- Sichtbare HVV-Layer: `Regional/Fern`, `S-Bahn/AKN`, `U-Bahn`.
- Nicht sichtbare HVV-Layer: `Bus`, `Fähre`.
- Reisezeitfenster: 30, 45, 60, 75, 90 Minuten.
- Umstiegsfilter: maximal 2.

## Wichtige Datenpunkte

- HVV-GTFS-Artefakte liegen unter `public/data/hvv/`.
- Aktueller Importumfang:
  - 872 Routen
  - 9.577 Haltestellen
  - 118.251 Trips
  - 2.520.591 Stop-Times
  - Shapes vorhanden
- `stop-times.json` ist groß und wird aktuell nicht vom Frontend geladen.
- Hittfeld wurde dem Seed-Datensatz ergänzt und ist über `RB41` erreichbar.

## Aktuelle UX-Entscheidungen

- HVV-Haltestellen öffnen kein Leaflet-Popup. Das Detailpanel ist die einzige Detailquelle.
- Klick auf HVV-Haltestelle darf die Karte nicht pannen oder zoomen.
- Ausgewählte HVV-Haltestellen behalten den aktuellen Kartenausschnitt.
- Die Karte fokussiert nur beim Laden und Startbahnhofwechsel auf den Startbahnhof.
- HVV-Linien an der ausgewählten Haltestelle werden prominent über die Basislinien gezeichnet.
- GTFS-Shape/Stop-Versatz wird nicht geometrisch korrigiert; die Hervorhebung macht die Linienbeziehung sichtbar.

## Aktuelle Routinglogik

Seed-Routing:

- Datei: `src/domain/reachability.ts`.
- Datenbasis: `src/data/stations.ts` und `src/data/railway.ts`.
- Modell: taktähnliche Service-Patterns mit `firstDepartureMinutes`, `lastDepartureMinutes`, `intervalMinutes`.

HVV-Schätzung:

- Implementiert lokal in `src/App.tsx`.
- Nutzt importierte `HvvRoute.stationIds` und Geometrie-Distanzen.
- Sucht einen erreichbaren Seed-Anschlussbahnhof entlang einer HVV-Linie.
- Schätzt Fahrzeit anhand mode-/linientypischer Geschwindigkeit und Stop-Penalty.
- Kennzeichnet die Anzeige mit `ca.`.

## Wohnregion-Idee

Gewünschte nächste Produktfunktion:

> Zeige Wohnorte/Regionen, die mit maximal X Minuten Bahn plus maximal Y Minuten Auto vom Zielbahnhof erreichbar sind.

Empfohlene Umsetzung:

1. Bahn-Erreichbarkeit für Startbahnhof und Zeitlimit berechnen.
2. Für alle erreichbaren Bahnhöfe Auto-Anschlussflächen berechnen.
3. Flächen vereinigen und auf der Karte als Wohnregion anzeigen.
4. Später Gemeinde-/Ortsteil-Geometrien schneiden, um erreichbare Orte namentlich auszugeben.

MVP-Variante:

- Auto-Anschluss zunächst als geschätzter Radius oder Rasterzellen.
- Kein echtes Straßenrouting im ersten Schritt.

Spätere präzise Variante:

- OSRM, Valhalla oder OpenRouteService für Auto-Isochronen.
- Optional eigener Routing-Service, um API-Limits zu vermeiden.

## Verifikation

Nach den letzten Änderungen liefen erfolgreich:

```bash
npm run build
npm run test
npm run lint
```

## Git-Status

Das Arbeitsverzeichnis `/Users/dw/Projects/regionfinder` ist aktuell kein Git-Repository. Commit und Push sind deshalb in diesem Zustand nicht möglich.
