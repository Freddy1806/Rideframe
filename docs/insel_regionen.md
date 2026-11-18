# RIDEFRAME Insel: 7 Regionen und die Neu-Regel (18.11.2026)

Grundlage: Inselplan Entwurf 2 (`docs/inselplan.md`), Karte `261118_Insel_Entwurf2_Karte.png`.

## Neu-Regel

- Jede Region hat **mindestens ein neues Wahrzeichen und ein neues Ereignis**, die es im Spiel bisher nicht gibt.
- Alles steht im **Katalog** (Tabelle `261118_Insel_Katalog` in der Drive): jede Zeile ein Asset, Ereignis oder Stimmungs-Element,
  mit Region, „neu“ oder „gibt es schon“, wer baut, Status und Screenshot-Link.
- Eine Zeile ist erst **fertig**, wenn sie im Spiel steht und ein Screenshot aus dem Spiel verlinkt ist. Eine Region ist fertig,
  wenn alle ihre Zeilen fertig sind.
- Was es schon gibt, wird wiederverwendet, aber nie als „neu“ gezählt. Vor jeder neuen Zeile wird im Katalog nachgesehen, dass
  es das nicht schon gibt.

## Ablauf pro Region

1. Steckbrief (dieses Dokument) prüfen und schärfen, ein Referenzbild pro Region (Higgsfield, wenige Credits).
2. Modelle bestellen beim Blender-Thread (Liste aus dem Katalog, Spalte „Wer“ = Blender).
3. Einbauen: Region bekommt eigene Werte für Licht, Nebel, Farbkarte, Pflanzen- und Tierdichte; Wahrzeichen an feste Punkte
   des Straßennetzes; Ereignis in `surprises.js` / `events.js` an die Region gebunden.
4. Prüfen: Testvideo klein auf dem Mac mini, Screenshots gegen den Steckbrief, Katalog abhaken. Video danach löschen.

## Regionen

Die Insel wird von Grenzlinien in Regionen geteilt; jede Straße gehört zu einer Region (oder wechselt unterwegs). Übergänge
weich über ~1 km (Farben, Pflanzen, Nebel blenden über).

### 1. Hochgebirge: Nordpass und Burg (zuerst)
- **Straßen**: Nordpass Südrampe, Nordpass Nordrampe, Gipfelstraße zur Burg.
- **Stimmung**: kühl, klare Luft, oben Wolken unter einem, ab 900 m Nebelfetzen, auf dem Gipfel Wind. Grau-grüner Fels,
  Geröll, oben kurzes gelbliches Gras, Schneereste in Rinnen.
- **Pflanzen / Tiere**: Lärchen unten, oben nur Latschen; Steinböcke, Adler (gibt es: seeadler), Murmeltiere.
- **Gibt es schon**: Burg mit Belagerung, Wasserfälle, Kehrenmauer (steinmauer_kehre), Schneestangen, Passschild, Kehrenschild,
  Wegkreuz, Adler.
- **NEU Wahrzeichen**: Lawinengalerie (Betondach über der Straße an der Nordrampe, offene Seite zum Tal) und ein Passhospiz
  am Nordpass (Steinhaus mit Glockenturm, Stempelstelle).
- **NEU Ereignis**: Schafherde wird über den Pass getrieben (Hirte, Hunde, Glocken, Herde füllt die Straße kurz, man fährt
  langsam durch). Dazu Steinböcke, die an der Felswand über der Straße klettern.

### 2. Nordküste und Fjord
- **Straßen**: Nordküste, Nordwestküste, Nordbucht.
- **Stimmung**: Lofoten-Look, dunkles Wasser, tiefe Sonne, Schären. Gibt es fast komplett (Ausgangs-Welt).
- **Gibt es schon**: rorbu-Hütten, Hjell (Trockengestelle), Nordlandboote, Orca, Buckelwal, Möwen, Langschiff.
- **NEU Wahrzeichen**: Brücke über den Fjord (hohe Bogenbrücke, Straße darüber, Boote darunter).
- **NEU Ereignis**: Fischer holen das Netz ein, Möwenschwarm stürzt sich darauf (Lärm, Flügel nah an der Kamera).

### 3. Steilküste West mit Leuchtturm-Kap
- **Straßen**: Steilküste West, Westkap, Klippenküste Ost (Leuchtturm-Sprint).
- **Stimmung**: rau, Wind, Gischt, Straße hoch über dem Meer, Abendsonne von Westen (Sonnenuntergang über dem Meer).
- **NEU Wahrzeichen**: Leuchtturm mit drehendem Licht (Strahl sichtbar in der Dämmerung), Felsbogen über der Straße, Tunnel
  durch eine Landzunge an der Ostküste.
- **NEU Ereignis**: Brandung schlägt an die Klippe, Gischt weht über die Straße (Tropfen auf der Kamera, kurz Rauschen).

### 4. Flusstal und Bergdorf im Becken
- **Straßen**: Flusstal, Hochtal zum Kloster, Bergdorf.
- **Stimmung**: warm, satt grün, Pappeln am Fluss, Dunst am Morgen.
- **Gibt es schon**: Wassermühle, Ruderboote, Angler, Gassen mit Kopfsteinpflaster (gassenhaus, Torbögen), Markt, Brunnen,
  Kirche, Fachwerk, Fest mit Band.
- **NEU Wahrzeichen**: Steinbrücke mit mehreren Bögen über den Fluss im Dorf, Mühlrad-Kette (mehrere Mühlen hintereinander).
- **NEU Ereignis**: Markttag: Stände mitten auf dem Dorfplatz, man fährt durch eine Gasse aus Menschen, Händler rufen.

### 5. Klosterplateau (Westpass)
- **Straßen**: Westpass Ostrampe, Klosterplateau.
- **Stimmung**: Nebel im Bambus, Laternen, Glocken. Gibt es (Misty Monastery).
- **Gibt es schon**: Pagoden, Teehaus, Klostermauer, Kampfmönche, Gebetsfahnen, Glockenpavillon, Bambus.
- **NEU Wahrzeichen**: Steinkreis / Torii-Reihe auf dem Westpass (Tore über der Straße, eins nach dem anderen).
- **NEU Ereignis**: Laternen steigen in der Dämmerung auf (Himmelslaternen, viele kleine Lichter).

### 6. Weinberge Südost und Osthügel
- **Straßen**: Südostküste, Ostsattel Auffahrt und Nordseite.
- **Stimmung**: golden, trocken, Mittagslicht, Zypressen, Terrassenmauern.
- **NEU Wahrzeichen**: Weinterrassen mit Rebzeilen am Hang, Weingut mit Kelterhaus, Windmühlen auf dem Ostsattel.
- **NEU Ereignis**: Weinlese: Erntehelfer mit Körben, Ochsenkarren voller Trauben rollt mit, Fässer.

### 7. Dünen und Salzwiesen im Süden
- **Straßen**: Südküste, Südstrand, Südhügel.
- **Stimmung**: hell, flach, weiter Himmel, Sand weht über die Straße, Strandhafer.
- **NEU Wahrzeichen**: Holzstege über die Salzwiesen, Strandkörbe, gestrandetes Schiffswrack am Strand.
- **NEU Ereignis**: Flamingos fliegen in einer Reihe tief über die Straße; Drachen (Lenkdrachen) am Strand.

## Querschnitt (alle Regionen)
- **Kreuzungen**: Wegweiser mit echten Zielen und km (gibt es: wegweiser, wird Teil der Abzweig-Wahl).
- **Wetter je Region** (neu): Nebel am Pass, Wind an der Küste, Sonne im Becken.
- **Tageszeit läuft mit** (teilweise da: Sonne sinkt langsam).
- **Entdecker-Karte**: gefahrene Straßen färben sich, Wahrzeichen werden gesammelt (neu).

### 8. Lange Brücke und Robbeninsel (Freddy 18.11.)
- **Straßen**: Lange Brücke (Südstrand → Robbeninsel, 5,7 km, davon 4,7 km über dem Meer, Bogen bis 30 m über dem Wasser),
  Robbeninsel-Runde (9,7 km, +143 m, Zeitfahrkurs). Runde „Island: Long Bridge“ 67,5 km.
- **Gibt es schon**: Brückenbau aus den echten Lofoten-Strecken (Fahrbahnplatte, Brüstung, Pfeiler ins Wasser).
- **NEU Wahrzeichen**: Schrägseil-Pylon in der Mitte, nachts beleuchtet.
- **NEU Ereignis**: Robben auf den Felsen, ein Schiff fährt unter der Brücke durch.
