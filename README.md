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
| X / Gamepad D-Pad → | Workout: nächster Schritt (wie die Lap-Taste am Radcomputer) |

## Eigene Workouts (Workout-Builder)

Profil → **My workouts** → **New workout**, oder auf einer Strecke **Customise** bei einem Standard-Workout. Der Builder arbeitet wie die Workout-Editoren bekannter Radcomputer-Plattformen:

- **Schritte** mit Typ (Warm up, Bike, Recover, Rest, Cool down, Other; farbige Karten), **Dauer** (Zeit als `mm:ss` oder `h:mm:ss`, Distanz, Lap-Taste, Kalorien, Puls über/unter, Leistung über/unter) und **Ziel** (keins, Leistungszone, Watt-Bereich, % FTP mit Rampe, Pulszone, Puls-Bereich, Trittfrequenz, Tempo). Dazu ein zweites Anzeige-Ziel (Puls, Trittfrequenz, Tempo) und eine Notiz pro Schritt.
- **Wiederholungen** (× 1–99, eine Ebene, bis 20 Schritte im Block) mit „letzte Erholung auslassen“. Schritte per Griff (Maus, Touch, Pfeiltasten ↑ ↓) in einen Block hinein- und herausziehen, ganze Blöcke verschieben.
- Zusammenfassung und Diagramm laufen live mit; Löschen lässt sich per Toast rückgängig machen. Höchstens 200 Schritte nach dem Ausklappen der Wiederholungen.
- Neues Workout: Warm up bis Lap-Taste, 10:00 Bike, Cool down bis Lap-Taste, alles ohne Ziel.

Beim Fahren: ERG nur bei Leistungszielen (Zone/Bereich: Mitte des Bereichs). Puls-, Trittfrequenz- und Tempoziele werden nur angezeigt (Band, „zu hoch / im Bereich“). Offene Schritte (Lap, Distanz, Kalorien, Puls, Leistung) enden live; **Next step** in der Leiste, Taste X, Gamepad → oder die Handy-Fernbedienung beenden jeden Schritt sofort. Für Gesamtzeit und Diagramm werden offene Schritte geschätzt (`~`): Lap 5 min, Puls 5 min, Leistung 3 min, Distanz bei 30 km/h, Kalorien aus den Watt des Schritts (1 kcal ≈ 1 kJ mechanisch). Puls/Leistung beenden einen Schritt, wenn der Wert 2 s über/unter der Grenze bleibt. Alte Workouts (ohne Versionsfeld) laden unverändert, gespeichert wird im neuen Format (`v: 2`).

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

## Claude-Connector: Uhr-Workouts per Chat

RIDEFRAME hat einen eigenen MCP-Server (`tools/mcp-api.mjs`, Streamable HTTP unter `/mcp/<token>`, ohne SDK). Damit baut Claude Kraft-Workouts direkt in dein Konto, z. B. „Mach mir ein Push-Workout mit 4 Übungen, orientier dich an meinen letzten Gewichten“. Sie erscheinen in der App (Strength → Watch workouts, Settings → Devices → Watch screens & workouts) und auf der Garmin-Uhr bei ihrer nächsten Synchronisierung.

1. In RIDEFRAME angemeldet, **über die öffentliche https-Adresse** (z. B. den Tailscale-Funnel-Link): Settings → Devices → **Claude connector** → **Create link** → **Copy**. Der Link wird nur dieses eine Mal angezeigt.
2. In Claude (claude.ai oder App): Settings → Connectors → **Add custom connector**, Namen eingeben (z. B. RIDEFRAME), Link einfügen, hinzufügen.
3. Im Chat den Connector einschalten und loslegen.

Werkzeuge: `list_exercises`, `list_workouts`, `create_workout`, `update_workout`, `delete_workout`, `get_strength_history`. Geprüft wird mit derselben Regel wie im Uhr-Editor (`js/watchfields.js`): bis 30 Workouts, je bis 20 Übungen, 1–10 Sätze, 1–100 Wiederholungen (bei Zeitübungen Sekunden), 0–500 kg in 0,25er-Schritten, 0–600 s Pause in 5er-Schritten. Unbekannte Übungsnamen werden abgelehnt (mit den ähnlichsten Treffern), nie geraten.

**Wichtig:** Der Link ist ein Geheimnis. Wer ihn kennt, kann ohne weiteres Login deine Uhr-Workouts lesen, ändern und löschen und deine Krafttrainings lesen (sonst nichts: keine Fahrten, keine Kontodaten). Also nicht teilen oder posten. Bis zu 3 Links pro Konto; unter Settings → Devices → Claude connector → **Remove** ist ein Link sofort tot. Auf dem Server liegt nur ein SHA-256-Hash, je Link höchstens 60 Aufrufe pro Minute.

## Technik

Reines HTML/CSS/JavaScript ohne Build-Schritt und ohne Abhängigkeiten.

- `js/gpmf.js` liest die GoPro-Telemetrie (GPMF, GPS5/GPS9) direkt aus dem MP4, ohne die ganze Datei zu laden
- `js/track.js` rechnet GPS in eine Strecke um (Distanz, geglättete Höhe, Steigung, Videozeit)
- `js/physics.js` Rad-Physik (Rollwiderstand, Luftwiderstand, Hangabtrieb)
- `js/trainer.js` Web Bluetooth: FTMS (Indoor Bike Simulation), Wahoo-Legacy-Fallback, Pulsgurt
- `js/ride.js` Fahrmodus: Videotempo-Regelung, HUD, Ghost, Speichern
- `js/demo.js` eingebaute Demo-Strecke ohne Video

Lizenz: MIT
