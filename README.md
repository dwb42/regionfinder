# Regionfinder Bahn

Web-MVP zur Analyse von Bahn- und ÖPNV-Erreichbarkeit ab einem frei wählbaren Startbahnhof. Die App ist auf Hamburg und Umland optimiert und kombiniert:

- einen kleinen, schnellen Seed-Router für Bahn-Reisezeiten,
- importierte HVV-GTFS-Static-Daten für Haltestellen, Linien und Shapes,
- eine Leaflet/OpenStreetMap-Karte mit zuschaltbaren ÖPNV-Layern.

Der Standard-Startbahnhof ist `Hamburg Hbf`. Beim Laden zentriert die Karte explizit auf den aktuellen Startbahnhof.

## Setup

```bash
npm install
npm run dev
```

## Befehle

```bash
npm run dev        # lokale Entwicklung
npm run import:hvv # HVV-GTFS nach public/data/hvv importieren
npm run build      # TypeScript- und Produktionsbuild
npm run test       # Validierung der Seed-Daten und Routinglogik
npm run lint       # ESLint
npm run preview    # gebaute App lokal ansehen
```

## Datenquellen

Das Projekt trennt bewusst Seed-Daten, importierte Fahrplandaten und Kartenbasis:

- `src/data/stations.ts`: Seed-Bahnhöfe und Haltepunkte im Raum Hamburg mit Koordinaten, Ort, Bundesland und Region.
- `src/data/railway.ts`: vereinfachte Bahnachsen als Liniengeometrie sowie taktähnliche Service-Patterns für RE/RB/S-Bahn/AKN.
- `public/data/hvv/*.json`: normalisierte Artefakte aus HVV GTFS Static.
- Kartenbasis: OpenStreetMap-Kacheln über Leaflet.
- Optionales Overlay: OpenRailwayMap-Standardtiles als Infrastruktur-Layer, keine Fahrplandatenquelle.

Die Seed-Daten sind für schnelle Entwicklung und stabile Tests da. HVV-GTFS ist die primäre Quelle für vollständige ÖPNV-Haltestellen, Linien und Geometrien, aber noch nicht die primäre exakte Routingquelle.

## HVV-GTFS-Import

Der Importer liest GTFS Static aus einer ZIP-Datei und schreibt normalisierte Artefakte nach `public/data/hvv/`. Die App lädt beim Start nur `manifest.json`, `stations.json` und `routes.json`. Große Fahrplanartefakte wie `stop-times.json` bleiben für den späteren GTFS-Router vorhanden, werden aber nicht im Browser geladen.

```bash
mkdir -p data/raw/hvv
# ZIP aus dem Transparenzportal nach data/raw/hvv/ legen, dann:
npm run import:hvv

# alternativ direkter Download der aktuell konfigurierten Transparenzportal-Ressource:
npm run import:hvv -- --download

# oder explizit:
npm run import:hvv -- --input data/raw/hvv/hvv_Rohdaten_GTFS.zip
HVV_GTFS_URL=https://example.org/hvv.zip npm run import:hvv -- --download
```

Der Importer verarbeitet:

- Pflichtdateien: `agency.txt`, `stops.txt`, `routes.txt`, `trips.txt`, `stop_times.txt`, `calendar.txt`
- optionale Dateien: `calendar_dates.txt`, `shapes.txt`

Liniengeometrien nutzen bevorzugt `shapes.txt`; falls Shapes fehlen, nutzt die Karte die Haltestellenfolge einer repräsentativen Fahrt als Polyline-Fallback. Der Import begrenzt dargestellte Stops/Routen auf Hamburg/Umland-Bounds, um die Karte performant und relevant zu halten.

Aktuell importierter Datensatz:

- Datensatz: `hvv Fahrplandaten (GTFS) April 2026 bis Dezember 2026`, Transparenzportal Hamburg.
- Veröffentlichende Stelle und Namensnennung: `Hamburger Verkehrsverbund GmbH`.
- Lizenz: `Datenlizenz Deutschland Namensnennung 2.0`.
- Inhalt laut Datensatz: AKN, Bus, Fähre, Regional-Express, Regionalbahn, S-Bahn und U-Bahn.
- Importumfang im aktuellen Arbeitsstand: 872 Routen, 9.577 Haltestellen, 118.251 Trips, 2.520.591 Stop-Times, Shapes vorhanden.

Geofox wird in diesem MVP nicht genutzt, weil der HVV den Zugang zur Schnittstelle als beschränkt beschreibt.

## UI-Verhalten

- Startbahnhof-Auswahl per Suche/Autocomplete.
- Default und Initialfokus: `Hamburg Hbf`.
- Karte wird beim Laden und Startbahnhofwechsel auf den Startbahnhof gesetzt.
- Klick auf eine HVV-Haltestelle verschiebt oder zoomt die Karte nicht. Er aktualisiert nur Auswahl, Marker-Highlight und Detailpanel.
- HVV-Karten-Popups sind deaktiviert; Details stehen rechts im Panel.
- Bei ausgewählter HVV-Haltestelle werden alle dort haltenden Linien auf der Karte hervorgehoben.
- Layer-Toggles:
  - `Regional/Fern`
  - `S-Bahn/AKN`
  - `U-Bahn`
  - `Bus`
  - `Fähre`
  - `Bahninfrastruktur`
- Default-Layer: Schiene sichtbar (`Regional/Fern`, `S-Bahn/AKN`, `U-Bahn`), Bus/Fähre aus.
- Wenn eine HVV-Haltestelle per Suche ausgewählt wird, aktiviert die App automatisch den passenden Layer.

## Routing und Reisezeiten

Der exakte Router in `src/domain/reachability.ts` arbeitet weiterhin auf Seed-Service-Patterns. Er berechnet erreichbare Seed-Bahnhöfe inklusive Wartezeit, Fahrzeit, Umstiegen und Beispielverbindung.

Für HVV-Haltestellen gibt es aktuell zwei Fälle:

1. **HVV-Haltestelle entspricht Seed-Station**
   - Die Detailkarte zeigt die Seed-Reisezeit, Umstiege und Verbindung.
   - Beispiel: Hittfeld ist als Seed-Station ergänzt und über `RB41` erreichbar.

2. **HVV-Haltestelle ist nicht im Seed-Router**
   - Die Detailkarte zeigt einen `ca.`-Wert.
   - Der Wert wird aus Seed-Router plus importiertem HVV-Linienverlauf geschätzt:
     `Startbahnhof -> erreichbarer Seed-Anschlussbahnhof -> HVV-Linie -> Zielhaltestelle`.
   - Diese Schätzung lädt keine `stop_times.json` und ist nicht fahrplanexakt.
   - Die Detailkarte benennt den Anschluss und weist auf den späteren GTFS-Router hin.

## MVP-Funktionen

- OpenStreetMap-basierte, zoombare und verschiebbare Karte.
- Seed-Erreichbarkeit ab Startbahnhof für 30, 45, 60, 75 und 90 Minuten.
- Maximaler Umstiegsfilter.
- Sortierbare Ergebnisliste nach Reisezeit, Name, Umstiegen und Entfernung.
- Farbige Markierung erreichbarer Seed-Ziele auf der Karte.
- HVV-GTFS-Layer für Linien und Haltestellen.
- Hervorhebung der ausgewählten HVV-Linien.
- Optionales OpenRailwayMap-Infrastruktur-Overlay.
- Wohnregion-Radius für alle aktuell sichtbaren erreichbaren Seed-Zielbahnhöfe.

## Bekannte Einschränkungen

- Noch kein exakter zeitabhängiger GTFS-Router im Browser oder Backend.
- `stop-times.json` ist groß und wird bewusst nicht im Frontend geladen.
- HVV-Reisezeiten für Nicht-Seed-Haltestellen sind Näherungen.
- Keine Echtzeitdaten, Störungen, Gleiswechsel oder Verkehrstage außerhalb des Seed-Werktagsmodells.
- GTFS-Stop-Koordinaten und Shape-Geometrien können wenige Meter auseinanderliegen; ausgewählte Linien werden deshalb deutlich hervorgehoben.
- Wohnregion-Radius nutzt aktuell konservative Luftlinienkreise, keine Straßenrouting-Berechnung.
- Das lokale Arbeitsverzeichnis ist derzeit kein Git-Repository.

## Nächste Ausbauschritte

1. Zeitabhängigen GTFS-Router bauen: Servicekalender, `calendar_dates`, `trips`, `stop_times`, Umstiege über gleiche Station/Parent-Station/kurze Fußwege.
2. `stop-times.json` in ein performanteres Format überführen, z. B. kompakte Indizes oder serverseitige Query-Schicht.
3. Wohnregion-Funktion entwickeln:
   - Bahnlimit wählen, z. B. 60 Minuten.
   - erreichbare Bahnhöfe bestimmen.
   - Auto-Anschlusszeit wählen, z. B. 15 Minuten.
   - zunächst geschätzte Isochronen/Kreise oder Raster anzeigen.
   - später echtes Straßenrouting über OSRM, Valhalla oder OpenRouteService.
4. Gemeinde-/Ortsteil-Datensatz ergänzen, um erreichbare Wohnorte namentlich auszugeben.
5. Persistente Szenarien für Wohnortvergleiche ergänzen.
