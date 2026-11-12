# Dorfplan – das Dorf des Boten (Story „The Bet“, Stufe 2)

Stand 12.11.2026. Planungsdokument, kein Code. Vorbild: mitteleuropäisches Angerdorf bzw. kleiner Marktflecken, ca. 1300–1450.
Im Text heißt **L/R** links/rechts in Fahrtrichtung, **m** ist die Strecke entlang der Straße (0 = Beginn der Feldflur),
**Abstand** ist quer zur Straßenmitte gemessen (Straße: 6,6 m breit, `ROAD_W` = 3,3 m halbe Breite).
„vorh.“ = Modellname wird im Code schon benutzt (`byName('…')` in `js/world/lofoten.js`); die GLBs liegen auf dem Mac, dort gegenprüfen.

## 1. Leitgedanke

Bei 30 km/h sind es 8,3 m pro Sekunde. Ein Haus ist 1–2 Sekunden im Bild, das ganze Dorf (ca. 450 m Kern) knapp eine Minute.
Deshalb gilt: **Silhouette und Reihenfolge vor Detail.** Der Fahrer soll nicht „Häuser“ sehen, sondern eine Abfolge, die er nach
drei Fahrten wiedererkennt und an der er merkt, was neu ist.

Was man in welcher Reihenfolge sieht:
1. **Von weitem (ab 600 m):** Kirchturm über Baumkronen und Rauchfahnen, davor gestreifte Felder. Das Ziel ist sichtbar, bevor man da ist.
2. **Annäherung:** Wegkreuz, Obstbäume, Gänse auf der Wiese, dann Zaun und Tor. Die Welt wird enger und kleinteiliger.
3. **Im Dorf:** Höfe dicht an der Straße, Hühner, Hämmern aus der Schmiede, Wäsche. Die Straße macht einen leichten Knick, damit man nie durchschaut.
4. **Die Mitte öffnet sich:** Anger mit Linde, Brunnen und Teich, Kirche erhöht auf der rechten Seite.
5. **Finale:** Das **Wirtshaus der drei Wetter** steht quer am Ende des Platzes genau in der Blickachse; die Straße biegt davor ab.
   Im Fenster drei Lichter: blau (Wizard), gold (King), rot (Devil). Das ist das Bild, das hängen bleibt.
6. **Ausklang:** Brücke, Mühle am Bach, wieder Felder.

Drei Regeln für alles Weitere:
- **Jedes Ding hat einen Grund.** Schmiede am Rand (Feuer, Durchreisende), Mühle am Bach, Backhaus frei stehend (Brandgefahr), Kirche erhöht, Wirtshaus an der Straße.
- **Nichts steht nackt da.** Jedes Gebäude bekommt Zaun, Pfad zur Tür, ein Arbeitsding davor (Holzstapel, Karren, Fass). Das macht den Unterschied zwischen „Haus“ und „Hof“.
- **Im Sattel zählt der Streifen 4–15 m neben der Straße.** Dort sitzt das Detail. Dahinter reichen Kulissen.

## 2. Was zu einem Mittelalterdorf gehört

**Kirche & Friedhof**
- Einziges Steingebäude im Dorf: gedrungener Bau, schmale Fenster, Turm mit Satteldach oder kurzem Spitzhelm, verputzt und hell.
- Steht leicht erhöht, umgeben von der **Kirchhofmauer** (hüfthoch bis mannshoch) mit kleinem Torhäuschen. Der Kirchhof war Friedhof und Zuflucht.
- Im Kirchhof: einfache Holzkreuze und wenige Steinplatten, großes Friedhofskreuz, ein alter Baum (Linde oder Eibe).
- Daneben der **Pfarrhof** (wie ein besserer Bauernhof) und später die **Zehntscheune** (große Scheune für die Abgaben).

**Anger und Markt**
- Der **Anger** ist die gemeinsame Wiese in der Dorfmitte: Dorflinde mit Bank (Treffpunkt, Gericht), Brunnen, Dorfteich (Löschwasser, Viehtränke, Enten und Gänse).
- Wird das Dorf Marktflecken, kommt dazu: **Marktkreuz** oder Marktfahne (Zeichen des Marktrechts), gepflasterter Platz, feste Verkaufsbänke
  (Brot, Fleisch) und Buden, **Waage**, **Pranger**, später eine offene **Rathauslaube**.
- Markt ist nur an Markttagen voll. Sonst stehen leere Bänke und zwei, drei Stände. Das spart Modelle und ist richtig.

**Wirtshaus (Schlüssel-Landmarke)**
- Größtes Fachwerkhaus: zwei Geschosse, Obergeschoss kragt vor, breites Tor zum Hof, Stall und Remise für Fuhrleute dahinter.
- Zeichen: ausgehängter **Kranz oder Strohwisch** an einer Stange (so zeigte man Ausschank an), dazu ein gemaltes Schild. Unser Schild: drei Becher oder Würfel.
- Davor: Anbindebalken mit Pferd, Tränktrog, Bank, Fässer, ein abgestellter Fuhrwagen. Warmes Licht aus den Fenstern, kräftigster Rauch im Dorf.
- Im Erkerfenster oder unter dem Vordach sitzen die drei Wetter am Tisch. Sie müssen aus dem Sattel als drei Farben lesbar sein, nicht als Gesichter.

**Handwerk**
- **Schmiede:** offener Vorbau, Esse mit Glut (das einzige gemauerte Stück mit Schornstein), Amboss, Wassertrog, Hufeisen an der Wand. Liegt am Dorfrand.
- **Stellmacher/Wagner (Wheelwright):** baut Räder und Wagen. Erkennbar an Rädern an der Wand, einem Wagen auf Böcken ohne Rad, Stapel Speichen und Felgenholz.
  Steht neben der Schmiede: der Wagner baut das Rad, der Schmied zieht den Eisenreifen auf. Beide zusammen ergeben eine glaubhafte Werkstattecke.
- **Mühle:** Wassermühle am Bach, außerhalb des Dorfes, mit Mühlgraben, Wehr und Steg. Davor Säcke und ein Esel.
- **Bäcker/Backhaus:** frei stehender, kleiner Lehm- oder Steinofen mit Dach, vom ganzen Dorf genutzt. Davor Brotschieber, Reisigbündel. Im Marktflecken zusätzlich die Brotbank.
- Optional später: Töpfer (Brennofen), Gerber (am Bach unterhalb, weil es stank), Zimmermann (Baustelle, siehe Abschnitt 3).

**Höfe**
- Eine **Hofstelle** ist ein Paket: Wohnhaus (Fachwerk, Lehmgefache, Stroh- oder Schindeldach), Scheune, kleiner Stall, Misthaufen, Küchengarten mit Flechtzaun, Hoftor.
- Die Höfe stehen in einer Reihe, schmal zur Straße, und haben hinter sich lange, schmale Feldstreifen (die Hufe). Das Dorf ist also vorne dicht und hinten offen.
- Bauernhäuser hatten meist **keinen Schornstein**: Der Rauch zieht durch das Dach oder ein Giebelloch ab. Fenster sind kleine Luken mit Holzläden, kein Glas.
- Unterschiede zeigen: ein großer Hof (Schultheiß/Meier), mehrere mittlere, am Rand kleine Hütten der Tagelöhner.

**Wege, Brücken, Zäune**
- **Etter:** der Dorfzaun aus Flechtwerk oder Hecke mit Graben, rund ums Dorf. An der Straße ein **Falltor** (Gatter). Das ist unser „Home Gate“.
- Hauptstraße im Dorf gestampfte Erde mit Fahrspuren, am Markt Kopfsteinpflaster. Trampelpfade zu jeder Tür, zum Brunnen, zur Kirche.
- Feldwege zweigen rechtwinklig ab, teils als Hohlweg. Über den Bach erst Furt mit Holzsteg, später eine einbogige Steinbrücke.
- Zauntypen: Flechtzaun (Gärten), Stangenzaun (Weide), Trockenmauer (Kirchhof), Hecke (Etter).

**Kleinkram (macht das Dorf bewohnt)**
- Wegkreuz und **Bildstock**, Wegweiser, Grenzstein, Ruhebank.
- Holzstapel, Hackklotz mit Axt, Leiter am Haus, Schubkarre, Fässer, Körbe, Säcke, Tröge, Heuhaufen, Garbenhocken, Bienenkörbe aus Stroh.
- Wäscheleine, Waschplatz am Teich, Taubenschlag, Vogelscheuche, Heuwagen, Pflug, Egge.

**Leben**
- Menschen bei einer Tätigkeit, nie nur stehend: Magd mit Eimern, Frau mit Korb, Bauer mit Sense, Schmied am Amboss, Hirte mit Stab, Kinder, Händler, Mönch oder Pfarrer.
- Tiere: Hühner überall, Gänse am Anger, Schweine (liefen frei herum), Schafe und Rinder auf der Allmende, Ochsen als Zugtiere (häufiger als Pferde), Katze, Hofhund, Tauben.

**Landschaft rundherum**
- **Dreifelderwirtschaft:** drei große Feldblöcke – Wintergetreide (gelb), Sommergetreide (grüngelb), Brache (graubraun, mit Schafen). Jeder Block ist in lange, schmale Streifen geteilt.
- **Baumgärten** direkt hinter den Höfen (Apfel, Birne, Kirsche, hochstämmig, Gras darunter). Gleicher Anblick wie eine Streuobstwiese.
- **Allmende:** gemeinsame Weide am Dorfrand mit Hirte und Vieh, dahinter Wald (Holz, Schweinemast).
- Bach mit Kopfweiden und Erlen, Wiesen in der Aue, in der Ferne ein Hügel für spätere Bauten (Warte, Burg).

**Nicht bauen (verrät die falsche Zeit):** Kartoffeln, Mais, Sonnenblumen, Glasfenster in Bauernhäusern, Ziegelschornsteine auf jedem Dach,
Geranien, weiße Lattenzäune, Straßenlaternen, bunte Fensterläden, Kutschen mit Federung. Das vorhandene `kutsche` besser nur am Wirtshaus oder als Karren-Variante.

## 3. Layout entlang der Straße

### 3.1 Zonen (voll ausgebautes Dorf, Stufe 8)

| m | Zone | Links (L) | Rechts (R) | Blick |
|---|---|---|---|---|
| 0–250 | **Feldflur** | Winterfeld in Streifen quer zur Straße, Garbenhocken, Bauer mit Sense | Brache mit Schafen, Vogelscheuche | Kirchturm und Rauch über den Bäumen; Straße zielt leicht daran vorbei |
| 250 | **Wegkreuz** | Wegweiser, Feldweg zweigt ab | Bildstock unter einem Baum, Ruhebank | erstes Ding ganz nah an der Straße (Abstand 5 m) |
| 250–340 | **Allmende & Baumgärten** | Weide mit Stangenzaun, Rinder, Hirte | Obstbäume, Bienenkörbe, Gänse | Etter (Hecke) wird als dunkle Linie quer sichtbar |
| 340 | **Tor (Home Gate)** | Hecke + Graben, Torpfosten | Hecke, Fahnenstange | man fährt durch; später Torturm aus Stein |
| 350–470 | **Hofreihe** | 3 Hofstellen, Abstand 8–11 m, Giebel zur Straße | 3 Hofstellen, traufseitig, 1 großer Hof | Straße knickt bei 420 m um ca. 12° nach R: kein Durchblick |
| 470–540 | **Handwerk / Kirche** | Schmiede (Abstand 7 m) und Stellmacher mit gemeinsamem Hofplatz | Kirche auf 2 m Anhöhe, Abstand 28 m, Kirchhofmauer bis 8 m an die Straße, Pfarrhof | Turm ragt R über alles; L Glut und Hammerschlag |
| 540–640 | **Anger** | Dorfteich mit Enten, Waschplatz, Backhaus | Linde mit Bank (Abstand 9 m), Brunnen (6 m), Höfe am Angerrand in zweiter Reihe (20 m) | Raum öffnet sich auf 50 m Breite; Wirtshaus erscheint am Ende |
| 640–700 | **Markt** | Marktkreuz, Verkaufsbänke, Waage, Krämerhaus | Stände, Pranger, Rathauslaube | Pflaster; alles führt auf die Wirtshausfassade zu |
| 700–740 | **Wirtshaus** | **Wirtshaus quer in der Achse**, Straße biegt nach R daran vorbei (Abstand 7 m) | Stall, Remise, Fuhrwagen, Anbindebalken | die drei Lichter im Fenster, Schild über der Straße |
| 740–800 | **Ausgang** | Bach, Steinbrücke bei 770, Kopfweiden | Mühle 40 m bachabwärts, Mühlrad zur Straße gedreht | zweites, kleines Falltor bei 790 |
| 800–1000 | **Feldflur** | Sommerfeld | Wiesen, Hügel mit Warte/Burg (Höhenmeter-Bau) | offener Horizont, Dorf im Rücken |

Hinweise zur Platzierung:
- Bis 1,5 m neben dem Asphalt bleibt frei (Sturzraum, Kamera). Kleinkram 1,5–5 m, Fassaden 7–11 m, Kirche und Mühle 25–40 m.
- Große Blickfänge abwechselnd L und R, nie zwei direkt gegenüber. So wandert der Blick, und beide Seiten werden wahrgenommen.
- Die Kirche steht auf der Außenseite des Knicks, das Wirtshaus in der Verlängerung der Geraden. Das sind die zwei festen Sichtachsen.
- Hinter der ersten Häuserreihe genügen Scheunendächer und Obstbäume als Kulisse (ab 25 m Abstand, sehr wenige Polygone).

### 3.2 Wachstum mit den Lebens-Kilometern

Grundsatz: **Das Dorf wächst vom Wirtshaus aus dem Fahrer entgegen.** Das Wirtshaus steht von Anfang an (dort wird gewettet).
Der Etter mit dem Tor umschließt immer nur, was schon gebaut ist, und wandert mit nach außen. Was noch nicht gebaut ist, ist
fertige Landschaft (Wiese, Feld, Baumgarten) und keine Baugrube. Erlaubt ist **genau eine Baustelle**: der nächste Bau als
Balkengerüst mit Zimmermann. Sie zeigt dem Fahrer, was als Nächstes kommt.

| Stufe | ab km | Name | Was dazukommt | Tor bei m | Wirkt wie |
|---|---|---|---|---|---|
| 0 | 0 | The Inn | Wirtshaus mit Stall, Linde, Brunnen, Wegkreuz, Felder | – | einsame Schenke an der Landstraße |
| 1 | 10 | **Home Gate** | Hof des Boten (L bei 650 m) mit Garten, Etter und Falltor | 620 | Weiler mit Zaun: „hier wohne ich“ |
| 2 | 40 | The Green | 4 Höfe um den Anger, Dorfteich, Backhaus, Hühner und Gänse | 530 | kleines Angerdorf |
| 3 | 100 | **Wheelwright** | Stellmacherei und Schmiede mit Hofplatz, Karren auf der Straße | 480 | Dorf mit Handwerk |
| 4 | 200 | The Church | Kirche, Kirchhofmauer, Friedhof, Pfarrhof, Glocke läutet | 470 | Kirchdorf |
| 5 | 350 | The Farms | Hofreihe 350–470 m (6 Hofstellen), Baumgärten, Allmende mit Hirte | 340 | volles Straßendorf, Knick in der Straße |
| 6 | 550 | **Market Square** | Pflaster, Marktkreuz, Bänke, Stände, Waage, Pranger, Händler | 340 | Marktflecken |
| 7 | 800 | The Mill | Steinbrücke statt Holzsteg, Mühle mit Rad, Zehntscheune | 340 | wohlhabend |
| 8 | 1200 | The Town Gate | Torturm aus Stein statt Falltor, Rathauslaube, Fahnen | 340 | kleine Stadt |

- Die Schwellen sind Vorschläge. Die erste Fahrt (10 km) schaltet sofort etwas frei; bei rund 100 km pro Woche kommt in den ersten zwei Monaten etwa alle ein bis zwei Wochen eine Stufe.
- Die Schmiede liegt in Stufe 3 richtig am Rand. Später wächst das Dorf darüber hinaus, das ist bei echten Dörfern genauso.
- **Höhenmeter bauen nach oben** (eigene, kurze Leiter, passend zum Devil): 500 Hm Bildstock auf dem Hügel · 2 000 Hm Spitzhelm und Wetterhahn
  auf dem Kirchturm · 5 000 Hm Warte (Wachturm) auf dem Hügel · 10 000 Hm kleine Burg. Diese Bauten sieht man schon aus der Feldflur.
- Technisch: jede Stufe ist eine Liste „Slot → Modell“. Leere Slots bekommen ihr Landschafts-Ersatzstück (Wiese mit Zaun, Obstbäume, Feldstreifen).

## 4. Asset-Liste

Priorität **A** = für Freitag spielbar (Stufen 0–3 und ein einfacher Markt), **B** = Stufen 4–6 vollständig, **C** = Stufen 7–8 und Schmuck.
Polycount in Dreiecken. „Proz.“ = prozedural in three.js, „Inst.“ = als `InstancedMesh`.

| Name | Prio | Größe (m, B×T×H) | Dreiecke | Varianten | Notizen |
|---|---|---|---|---|---|
| `wirtshaus` | A | 14×10×10 | 3 500 | 1 | Blender. Vorkragendes Obergeschoss, Tordurchfahrt, Erker mit drei Fenstern (blau, gold, rot leuchtend) |
| `wirtshausschild` | A | 1,2×0,1×1,5 | 150 | 1 | Blender. Ausleger mit Kranz und Schild (drei Becher); hängt über den Straßenrand |
| `fachwerkhaus_a`, `_b` | A | 8×6×7 | 1 500 | vorh. 2, Ziel 4 | Blender. Fehlende Varianten: Strohdach tief gezogen, Schindeldach; Farbe per Vertexfarbe variieren |
| `scheune` | A | 10×7×7 | 800 | 2 | Blender. Bretterwand, großes Tor (einmal offen mit Heu); auch als Kulisse hinten |
| `stall_klein` | B | 5×4×3,5 | 400 | 1 | Blender. Schweine- und Hühnerstall, Pultdach |
| `huette` | B | 5×4×4 | 500 | 2 | Blender. Tagelöhnerhütte am Rand |
| `dorftor` (Home Gate) | A | 6×1×3,5 | 400 | 1 | Blender. Zwei Pfosten, Querbalken, offenes Gatter, Wimpel |
| `etter_hecke` | A | 4×1,2×1,6 | 60 | 2 | Blender, Inst. entlang einer Kurve; Graben über Geländefarbe |
| `flechtzaun` | A | 3×0,2×1 | 80 | vorh. | Inst. um jeden Garten |
| `stangenzaun` | B | 3×0,1×1,1 | 40 | 1 | Proz., Inst. (drei Boxen) |
| `stellmacherei` (Wheelwright) | A | 9×7×6 | 1 800 | 1 | Blender. Offene Werkstattseite, Räder an der Wand, Wagen auf Böcken |
| `wagenrad` | A | Ø 1,2 | 180 | 1 | Blender, Inst. Mehrfach nutzbar (Wand, Stapel, Karren) |
| `schmiede` | A | 8×6×5 | 1 500 | 1 | Blender. Offener Vorbau, Esse mit Glut (leuchtendes Material), Amboss. Figur `schmied` vorh. |
| `leiterwagen` / `karren` | A | 4×1,8×1,8 | 600 | 2 (leer, Heu) | Blender. Ersetzt die `kutsche` im Dorf |
| `dorflinde` | A | Ø 12, H 14 | 1 200 | 1 | Blender. Dicker Stamm, Rundbank; weit sichtbare Krone |
| `dorfbrunnen` | A | Ø 2, H 3 | 400 | vorh. | Ziehbrunnen mit Dach und Eimer |
| `dorfteich` | A | 25×15 | 100 | – | Proz. Flache Wasserfläche mit Uferring, Schilf als Inst. |
| `backhaus` | B | 3×4×3 | 400 | 1 | Blender. Ofenkuppel, Vordach, Rauch |
| `dorfkirche` | B | 12×22×20 | 4 500 | vorh. | Prüfen: romanisch-gedrungen statt `kirche_gotisch`. Helm als eigenes Teil (Hm-Stufe) |
| `kirchhofmauer` | B | 4×0,5×1,4 | 60 | 2 (Stück, Tor) | Blender, Inst. Ersatzweise `trockenmauer` (vorh.) |
| `grabkreuz` / `grabstein` | B | 0,5×0,1×1 | 30 | 3 | Blender, Inst. Rund 30 Stück |
| `pfarrhof` | B | 10×7×8 | 1 500 | – | `steinhaus` (vorh.) im Sockel + Fachwerk-Obergeschoss, oder Variante von `fachwerkhaus` |
| `marktkreuz` | A | 1,5×1,5×5 | 300 | 1 | Blender. Steinsockel mit Stufen, Kreuz oder Fahne |
| `marktstand_obst` | A | 3×2×2,5 | 500 | vorh., Ziel 3 | Weitere: Brot, Tuch/Töpfe |
| `verkaufsbank` | B | 3×1×1 | 80 | 1 | Blender, Inst. Leere Bänke für Nicht-Markttage |
| `pflaster` | B | – | 0 | – | Proz. Textur/Farbe im Straßenshader im Bereich Markt, keine Geometrie |
| `pranger`, `waage` | C | 1×1×3 | 250 | je 1 | Blender |
| `rathauslaube` | C | 10×8×9 | 2 500 | 1 | Blender. Offene Bogenhalle unten |
| `torturm` | C | 7×7×14 | 2 000 | 1 | Blender. Ersetzt `dorftor` in Stufe 8 |
| `wassermuehle` | C | 10×8×8 | 2 500 | vorh. | Rad als eigenes Objekt, damit es sich dreht |
| `steinbruecke` / `holzsteg` | C | 10×5×3 | 500 / 200 | je 1 | Blender. Brüstung niedrig, damit man den Bach sieht |
| `zehntscheune` | C | 18×10×10 | 1 000 | 1 | Blender oder skalierte `scheune` mit Steinsockel |
| `wegkreuz`, `wegweiser` | A | 0,8×0,3×3 | 150 | vorh. | Bei 250 m |
| `bildstock` | B | 0,8×0,8×2,5 | 200 | 1 | Blender. Steinsäule mit Häuschen |
| `misthaufen` | A | 3×3×1 | 60 | 1 | Blender, Inst. Vor jedem Hof; billig und sehr typisch |
| `holzstapel`, `heuhaufen`, `garbenhocke`, `schubkarre`, `fass`, `faesser_kisten`, `viehtraenke`, `waescheleine` | A | 1–3 | 100–300 | vorh. | Inst. Je Hof zwei bis drei davon, zufällig aus fester Liste |
| `korb`, `sack`, `leiter`, `hackklotz`, `bank`, `bienenkorb`, `trog` | B | 0,4–3 | 30–120 | je 1 | Blender in einer Sitzung als „Kleinkram-Satz“, Inst. |
| `vogelscheuche`, `taubenschlag`, `pflug` | C | 1–2 | 150 | je 1 | Blender |
| `obstbaum` | A | Ø 5, H 5 | 300 | 3 | Blender, Inst. Hochstamm, runde Krone; im Herbst rote Punkte per Vertexfarbe |
| `kopfweide` | C | Ø 4, H 5 | 300 | 2 | Blender, Inst. am Bach |
| `feldstreifen` | A | 10×200 | 2 je Streifen | 3 Farben | Proz. Lange Rechtecke auf dem Gelände oder Geländefarbe; keine Halme nötig |
| `baustelle` | B | 8×6×6 | 400 | 1 | Blender. Nacktes Balkengerüst, Balkenstapel, Sägebock |
| `rauch` | A | – | 12 Sprites je Quelle | – | Proz. (siehe 5) |
| `kulisse_dachreihe` | B | 30×3×6 | 100 | 2 | Blender. Zusammengefasste Dächer und Bäume für die zweite Reihe |

Budget für das ganze Dorf im Bild: unter 200 000 Dreiecke und unter 120 Draw Calls. Dafür alle Gebäude mit **einer** gemeinsamen
Palette (siehe 6), statische Teile zusammenfassen, Wiederholtes als Instanzen. Alle Modelle: Ursprung unten in der Mitte, +Z ist die
Eingangsseite, Maßstab 1 Einheit = 1 m, Größe im `manifest.json` eintragen (wie bei den bisherigen Modellen).

## 5. Animationen und Figuren (wenige, billig)

| Was | Prio | Technik | Anzahl | Notizen |
|---|---|---|---|---|
| Rauch | A | Proz.: 8–12 weiche Sprites je Quelle, steigen und driften mit dem Wind | 1 je bewohntes Haus | Bauernhaus: dünn, aus First/Giebel. Wirtshaus und Schmiede: kräftig. Wichtigstes Lebenszeichen aus der Ferne |
| Die drei Wetter | A | Statische Sitzfiguren oder nur drei farbige Lichter im Fenster, leichtes Flackern | 3 | Kein Skelett nötig. Führender der Woche leuchtet heller |
| Wirtshausschild, Wimpel | A | Proz.: Sinus-Drehung um die Aufhängung | 3–5 | Eine Zeile Code je Objekt |
| Frau mit Korb, `magd_eimer` (vorh.) | A | Skelett, Clip `Gehen` (so heißt er im Code), läuft auf festem Pfad hin und her | 3–5 | Pfade: Hof ↔ Brunnen, Hof ↔ Markt, Teich ↔ Wäscheleine. Immer parallel zur Straße oder weg von ihr, nie darüber |
| `schmied` (vorh.) | A | Clip Hämmern, dazu Funken-Sprites und Ton | 1 | Ton trägt weiter als das Bild |
| `bauer_sense` (vorh.), Hirte | B | Clip Mähen / stehend mit Stab | 2 | In der Feldflur und auf der Allmende |
| Hühner | A | Kein Skelett: Körper hüpft und pickt per Code (Kippen um die Füße), zufällige kurze Läufe | 8–12, Inst. | 150 Dreiecke. Weichen aus, wenn der Fahrer näher als 8 m ist |
| Gänse, Enten | B | Wie Hühner; Enten gleiten auf dem Teich | 6 + 4 | Gänse als Trupp hintereinander |
| `schaf`, `pferd`, `pony`, `katze` (vorh.), Rind, Schwein | B | Vorhandene Clips; Rind und Schwein neu, nur Grasen/Stehen | 10–15 | Pferd am Anbindebalken des Wirtshauses, Schwein frei auf der Dorfstraße neben dem Weg |
| Wäsche | A | Proz.: Vertex-Wellen im Shader (wie das Gras) oder Drehung der Tücher | 2 Leinen | `waescheleine` vorh.; Tücher hell, fallen stark auf |
| Mühlrad | C | Proz.: Drehung, dazu Wasser-Sprites | 1 | Rad muss eigenes Objekt im GLB sein |
| Kirchenglocke | B | Nur Ton beim Einfahren in den Anger; Glocke im Turm schwingt per Code | 1 | Wirkt stark, kostet nichts |
| Ochsenkarren | C | Fährt langsam am Straßenrand in Fahrtrichtung, wird überholt | 1 | Überholen fühlt sich im Sattel gut an |
| Kinder | C | Laufen ein Stück mit und winken | 2 | Nur am Anger |

Regeln: höchstens etwa 12 Figuren mit Skelett gleichzeitig; alles weiter als 150 m steht still; Tiere ohne Skelett.
Figuren stehen dort, wo Dinge sind (Brunnen, Stand, Tor), nicht gleichmäßig verteilt.

## 6. Farbe und Material

Ziel: Das Dorf sieht aus wie aus einem Guss, und es sind nur wenige Materialien im Speicher.
Technik: **ein** gemeinsames Material mit Vertexfarben für alle Gebäude und Requisiten (kleine Palette, matt), plus drei Sondermaterialien.

| Zweck | Farbe | Hex | Einsatz |
|---|---|---|---|
| Lehmputz hell | warmes Creme | `#d9cbb0` | Gefache, Kirche (etwas heller: `#e6dcc8`) |
| Lehmputz dunkel | Ocker | `#b89b6e` | zweite Hausvariante, Backhaus |
| Fachwerkbalken | dunkles Braun | `#3d2b1f` | Balken, Türen, Läden |
| Holz verwittert | Graubraun | `#7a6a58` | Scheunen, Zäune, Karren, Schindeln |
| Holz frisch | Honig | `#b08a55` | Baustelle, neue Räder, Stellmacher |
| Stroh/Reet | Graugold | `#a8935a` | Dächer (alt: `#857a55`), Heu, Garben |
| Stein | warmes Grau | `#9a9488` | Kirche, Mauern, Marktkreuz, Brunnen, Pflaster |
| Erde/Weg | Braun | `#6e5a44` | Dorfstraße, Pfade, Misthaufen (dunkler) |
| Wiese | gedecktes Grün | `#6f8a46` | Anger, Allmende; Laub etwas dunkler `#4f6e36` |
| Felder | Gelb / Grüngelb / Graubraun | `#c9a94e` / `#9aa552` / `#8a7a5c` | Winterfeld / Sommerfeld / Brache |
| Akzent Tuch | Krapprot, Waidblau, Leinen | `#9b3a2a` / `#3f5f7f` / `#e8e2d2` | Kleidung, Wimpel, Wäsche, Standdächer. Sparsam |
| Wetter | Blau / Gold / Rot | `#6fb6ff` / `#f2c14e` / `#ff5a3c` | Nur am Wirtshaus (Fenster, Schild). Farben aus `js/story.js` |

Sondermaterialien: (1) **Leuchtend** für Fenster, Glut und die drei Lichter (emissive, ohne Schatten), (2) **Wasser** für Teich und Bach,
(3) **Laub mit Alpha** für Bäume und Hecken (gibt es schon für Sträucher).

Regeln für den Look:
- Dächer sind die größte Fläche im Bild. Zwei Dachfarben reichen (Stroh, Schindel); nur die Kirche darf ein drittes, rötliches Dach haben.
- Kräftige Farbe gibt es nur bei Menschen, Wimpeln und am Wirtshaus. Dadurch findet das Auge die Landmarke von selbst.
- Unten dunkler, oben heller (Vertexfarbe am Sockel um 15 % abdunkeln). Das erdet die Häuser ohne Textur und ohne teure Schatten.
- Keine reinen Farben, kein reines Weiß oder Schwarz. Alles leicht warm, passend zum vorhandenen Dunst und Abendlicht.
- Keine Bildtexturen für das Dorf nötig; falls doch, die vorhandenen (`planks`, `stone` aus `js/world/tex.js`) nur als feine Körnung über der Vertexfarbe.

## 7. Reihenfolge der Arbeit (Vorschlag)

1. **Bis Freitag (A):** `wirtshaus` + Schild + drei Lichter, `dorftor`, `stellmacherei`, `schmiede`, `wagenrad`, `karren`, `dorflinde`, `scheune`, `marktkreuz`, `obstbaum`, `misthaufen`, `etter_hecke`;
   prozedural Rauch, Feldstreifen, Teich, Hühner. Mit den vorhandenen Modellen ergibt das die Stufen 0–3 und einen einfachen Markt.
2. **Danach (B):** Kirchhof, Backhaus, Hütten und Ställe, Kleinkram-Satz, Baustelle, Kulissen, Gänse, Glocke.
3. **Zum Schluss (C):** Mühle mit drehendem Rad, Brücke, Torturm, Rathauslaube, Höhenmeter-Bauten auf dem Hügel.

Offene Punkte für die Entscheidung des Besitzers: (a) Schwellenwerte der Stufen, (b) ob „Home Gate“ wie hier das Dorftor samt Hof des Boten ist,
(c) ob das Dorf eine eigene kurze Strecke bekommt oder als Abschnitt in bestehende Strecken eingesetzt wird.
