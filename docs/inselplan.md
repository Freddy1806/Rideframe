# RIDEFRAME Insel: Entwurf 2 (fahrbar), 18.11.2026

Baut auf Entwurf 1 vom Mac mini auf (INSELPLAN.md, `tools/insel_proto.py`): gleiche Insel, gleiche Orte, gleiche Straßen.
Neu ist, dass daraus jetzt echte Spielgeometrie wird, die man im 3D-Renderer fahren kann.

## Was Entwurf 2 anders macht als Entwurf 1

| | Entwurf 1 (Skizze) | Entwurf 2 (fahrbar) |
|---|---|---|
| Höhenkarte | 1200 × 850 px, 40 m pro px | 4096 × 4096 px, 13 m pro px (53 km, Insel in der Mitte), Format wie `kueste60.bin` |
| Straßenlänge | gerade Linie × Kurvenfaktor (geschätzt) | echte Linie alle 10 m, Kurven und Kehren wirklich gelegt |
| Kehren | nur im Faktor | untere Hälfte lange Rampen, obere Hälfte Kehrenpakete (Radius ~20 m, alle ~380 m) |
| Steigung | Mischung aus Rampe und Gelände, teils Sprünge | Pässe ohne Gegenanstieg, max. 9 % (Gipfelstraße 9,5 %), Küste max. 8 % |
| Gelände an der Straße | 3 px Band | „Straße zuerst“: Berge werden in zwei Stufen unter die Straße geschoben (650 m und 170 m Umkreis), danach Böschung je nach Höhenunterschied |
| Fahrbar | nein | ja: fünf Beispielrunden als normale Strecken (`?insel`) |

## Zahlen (aus `node tools/island.mjs --stats`)

288 km Straßen, davon 121 km Küstenring. Insel 48 × 34 km.

| Straße | km | Hm hoch / runter | max. % |
|---|---|---|---|
| Klippenküste Ost (Hafenstadt → Leuchtturm) | 17,8 | +228 / −189 | 8,0 |
| Nordküste (Leuchtturm → Nordbucht) | 15,7 | +111 / −148 | 5,2 |
| Nordwestküste (Nordbucht → Westkap) | 27,9 | +99 / −82 | 5,8 |
| Steilküste West (Westkap → Südwesthafen) | 18,5 | +509 / −528 | 8,0 |
| Südküste (Südwesthafen → Südstrand) | 17,4 | +123 / −125 | 5,1 |
| Südostküste (Südstrand → Hafenstadt) | 23,2 | +110 / −108 | 4,8 |
| Flusstal (Hafenstadt → Bergdorf) | 23,3 | +256 / 0 | 2,5 |
| Nordpass Südrampe (Bergdorf → Nordpass 1.012 m) | 19,6 | +750 | 9,0 |
| Nordpass Nordrampe (→ Nordbucht) | 15,6 | −1.004 | 9,0 |
| Gipfelstraße zur Burg (1.480 m, Sackgasse) | 8,4 | +468 | 9,5 |
| Hochtal zum Kloster | 11,4 | +35 / −117 | 3,9 |
| Westpass Ostrampe (Kloster → 705 m) | 11,7 | +525 | 9,0 |
| Westpass Westrampe (→ Westkap) | 16,4 | −680 | 9,0 |
| Westpass Südrampe (→ Südwesthafen) | 13,6 | −699 | 9,0 |
| Südhügel Nordseite (Bergdorf → Südsattel 385 m) | 10,2 | +164 / −41 | 7,6 |
| Südhügel Abfahrt (→ Südstrand) | 8,1 | −381 | 9,0 |
| Ostsattel Auffahrt (Hafenstadt → 548 m) | 17,9 | +542 | 9,0 |
| Ostsattel Nordseite (→ Leuchtturm) | 11,1 | −503 | 9,0 |

Die Küstenrunde hat jetzt rund 1.180 Hm statt der geschätzten 380, vor allem wegen der Steilküste West (die Straße
klettert dort über die Klippen). Wenn die Küste flacher sein soll: Parameter `mix` für `cliff` senken.

## Fünf Beispielrunden (im Spiel mit `index.html?insel`, Branch, nicht live)

| Runde | km | Hm |
|---|---|---|
| Island: East Saddle (Feierabend) | 46,9 | 731 |
| Island: South Saddle | 64,8 | 529 |
| Island: West Pass | 100,6 | 1.048 |
| Island: Coast Loop | 120,5 | 1.179 |
| Island: Queen Stage (Nordpass, Burg, Nordbucht, Leuchtturm) | 108,8 | 1.810 |

Jede Runde nimmt pro Abschnitt die passende Landschaft (Küste, Klippe, Fluss, Kehren, Hügel), Orte werden als Dörfer
gesetzt, die Gipfelstraße endet mit der Burg (Belagerung aus `siege.js`). Das ist die Vorstufe zur offenen Welt:
statt fester Runden hängt das Spiel später an jeder Kreuzung die gewählte Straße an (Entwurf 1, Abschnitt 5 und 8).

## Dateien

- `tools/island.mjs`: erzeugt alles, fester Startwert, also auf Mac und Cloud identisch (30 s).
  `assets/dem/insel.bin` (32 MB, nicht im Git wie die anderen Höhenkarten), `insel_net.json` (Netz für das Spiel:
  Knoten + Straßen mit Punkten alle 10 m), `insel_*.json` (die fünf Runden).
- `tools/island_map.py`: Karte, Höhenprofile und die Farbkarte fürs Gelände (`assets/dem/insel_sat.jpg`).
- Mac mini: `node tools/island.mjs && python3 tools/island_map.py` im RIDEFRAME-Ordner, dann `?insel`.

## Noch offen / nächste Schritte

1. Auf dem Mac mini mit echten Texturen ansehen (kleines Testvideo der Königsetappe, danach löschen). In der Cloud
   fehlen die Foto-Texturen, dort ist das Gelände nur grau-weiß, die Geometrie (Kehren, Böschungen) passt.
2. Kreuzungen: Ankündigung 500 m vorher, Wahl per Steuerkreuz / Handy, nächste Straße anhängen (Entwurf 1, Punkt 3).
3. Alle Straßen sichtbar zeichnen, nicht nur die gefahrene (heute sieht man abzweigende Straßen nur als Geländeband).
4. Freddys Antworten auf die vier Fragen einarbeiten (Größe, Story-Dorf, Kehren am Nordpass, Gruppe am Abzweig).
