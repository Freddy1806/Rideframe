# RIDEFRAME

Open-Source-Indoor-Cycling mit deinen eigenen GoPro-Videos. Lade ein POV-Video mit GPS hoch, verbinde deinen Smart-Trainer (z. B. Wahoo KICKR) und fahr die echte Strecke nach:

- **Widerstand aus GPS:** Die Steigung der Strecke wird per Bluetooth (FTMS) an den Trainer geschickt.
- **Video im echten Tempo:** Deine Geschwindigkeit wird aus Watt, Gewicht und Steigung berechnet (wie draußen). Das Video läuft genau so schnell, wie du fährst. 60-fps-Material bleibt auch bei halbem Tempo flüssig.
- **Overlay:** Watt, W/kg, km/h, Trittfrequenz, Puls, Distanz, Höhe, Steigung, Höhenprofil, nächster Anstieg.
- **Rekorde:** Bestzeit pro Strecke, Ghost-Vergleich live (vor/hinter Bestzeit), beste 20-Minuten-Leistung, Verlauf.
- **Bibliothek:** Videos bleiben im Browser gespeichert (IndexedDB), ein Klick genügt zum Losfahren.

## Starten (Mac)

1. Ordner irgendwo ablegen, Doppelklick auf `start.command` (beim ersten Mal: Rechtsklick > Öffnen).
2. Chrome öffnet `http://localhost:8765`.
3. Oben rechts **KICKR verbinden**, GoPro-MP4 in die Bibliothek ziehen, losfahren.

Alternativ im Terminal: `node serve.mjs` oder `python3 -m http.server 8765`.

Wichtig: **Chrome oder Edge** verwenden (Safari kann kein Web Bluetooth). Immer denselben Port nutzen, sonst sieht der Browser die gespeicherten Strecken nicht.

## Bedienung beim Fahren

| Taste | Funktion |
|---|---|
| Leertaste / Esc | Pause (Weiterfahren, Speichern, Verwerfen) |
| ↑ / ↓ | Watt ohne Trainer (Testmodus), mit Shift ±50 W |
| F | Vollbild |
| Q / E (oder , / .) | Virtuell leichter / schwerer schalten |
| Gamepad LB / RB | Virtuell schalten, Start = Pause |

## Schaltung

- **Echte Schaltung** (Standard): Du schaltest am Rad. Der KICKR stellt nur den Widerstand der Steigung ein, die Trittfrequenz bestimmst du selbst. Die App schätzt deinen Gang aus Tempo und Trittfrequenz und sagt dir, wann du schalten solltest (Lieblings-Trittfrequenz in den Einstellungen).
- **Virtuelle Schaltung**: Rad bleibt in einem Gang (z. B. 50×17). Du schaltest in der App (15 Gänge aus deinen Kettenblättern und der Kassette), der KICKR ändert dafür den Widerstand.

## Eingebaute Strecken

- **Felsenküste** (3D-Welt, Lofoten-Stil, Serpentinen an Kirchturm-Rampe und Burgberg): 37 km, ca. 660 hm, für Schwellen-Intervalle. Vier Anstiege (Kirchturm-Rampe 8 min, Mühlenpass 10 min, Klippenstraße 12 min, Burgberg 10 min) bei FTP, dazwischen ca. 5 min Abfahrt und Küste. Im Anstieg zeigt die App Intervall, Restzeit und Zielbereich 95–105 % FTP.
- **Passo Demo**: 12 km Alpenanstieg zum Ausprobieren.

## Footage-Tipps

- GoPro mit **GPS an** filmen (HERO5 bis HERO13 schreiben GPS ins MP4). Lange Fahrten teilt die GoPro in Kapitel (GX01…, GX02…): alle Kapitel zusammen auswählen.
- Kamera ruhig am Lenker oder Brustgurt, 60 fps, Linear-Modus.
- GoPro-Höhendaten sind ungenau. Beim Import holt die App die Höhe aus einem Geländemodell (Open-Meteo, kostenlos). Ohne Internet wird die GPS-Höhe stark geglättet.
- Andere Kameras: Video plus GPX-Datei zusammen auswählen (Start von Video und GPX sollte gleich sein).

## Technik

Reines HTML/CSS/JavaScript ohne Build-Schritt und ohne Abhängigkeiten.

- `js/gpmf.js` liest die GoPro-Telemetrie (GPMF, GPS5/GPS9) direkt aus dem MP4, ohne die ganze Datei zu laden
- `js/track.js` rechnet GPS in eine Strecke um (Distanz, geglättete Höhe, Steigung, Videozeit)
- `js/physics.js` Rad-Physik (Rollwiderstand, Luftwiderstand, Hangabtrieb)
- `js/trainer.js` Web Bluetooth: FTMS (Indoor Bike Simulation), Wahoo-Legacy-Fallback, Pulsgurt
- `js/ride.js` Fahrmodus: Videotempo-Regelung, HUD, Ghost, Speichern
- `js/demo.js` eingebaute Demo-Strecke ohne Video

Lizenz: MIT
