# AGENTS

Projektbezogene Hinweise für zukünftige Coding-Sessions.

## Arbeitsstand

- Dieses Verzeichnis ist aktuell kein Git-Repository. `git status`, Commit und Push schlagen fehl, solange kein `.git` vorhanden ist.
- Es können mehrere Vite-Server parallel laufen. Vor UI-Tests den tatsächlich genutzten Port prüfen.
- `public/data/hvv/` enthält große generierte Artefakte. `stop-times.json` ist sehr groß und darf nicht unbedacht im Browser geladen werden.

## Standardprüfung

Nach Codeänderungen ausführen:

```bash
npm run build
npm run test
npm run lint
```

## Datenimport

HVV-Artefakte mit folgendem Befehl regenerieren:

```bash
npm run import:hvv -- --download
```

Der Import nutzt den im Script hinterlegten Transparenzportal-Link oder `HVV_GTFS_URL`.

## Architekturregeln

- Seed-Router und HVV-GTFS-Daten getrennt halten.
- `stop-times.json` nicht direkt in React laden.
- Neue Routinglogik möglichst aus `App.tsx` in Domain-/Utility-Module auslagern, sobald sie über MVP-Nähe hinausgeht.
- HVV-Reisezeiten ohne echten GTFS-Router als `ca.` kennzeichnen.
- HVV-Haltestellenklicks dürfen Karte nicht pannen oder zoomen.
- Detailinformationen sollen im rechten Panel erscheinen, nicht in Leaflet-Popups.
- Bus/Fähre bleiben standardmäßig deaktiviert, solange keine bessere Dichte-/Clustering-Strategie existiert.

## UX-Konventionen

- Initiale Karte: aktueller Startbahnhof, default `Hamburg Hbf`.
- Klick auf Seed-Ziel: Seed-Detail mit Reisezeit und Verbindung.
- Klick auf HVV-Haltestelle:
  - Auswahl aktualisieren,
  - Marker hervorheben,
  - haltende Linien hervorheben,
  - Detailpanel mit Linien und Reisezeit/Schätzung anzeigen,
  - Kartenausschnitt nicht verändern.

## Nächster fachlicher Schwerpunkt

Wohnregion-Funktion:

1. Bahnlimit bestimmen.
2. Erreichbare Bahnhöfe bestimmen.
3. Auto-Anschlusslimit anwenden.
4. Zunächst geschätzte Radien/Raster anzeigen.
5. Später echte Auto-Isochronen via OSRM, Valhalla oder OpenRouteService.
