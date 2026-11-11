// Voice commands (Freddy: "Sprachsteuerung mit Rideframe"): say "Rideframe" and a command, e.g. "Rideframe Pause",
// "Rideframe schwerer", "Rideframe Foto". Uses the browser's own speech recognition (Chrome / Edge, needs the
// microphone once); off by default (setting "Sprachbefehle"). Short commands also work without the wake word while
// a challenge is offered ("annehmen").
const WAKE = /\b(ride ?frame|rite ?frame|reid ?frame|raid ?frame|ride ?fra[mn]e?s?|reifrei?m|raidfreim|rydeframe|right ?frame)\b/i;
export const COMMANDS = [
  ['pause', /\b(pause|stopp?|anhalten|halt)\b/],
  ['resume', /\b(weiter|fortsetzen|los geht|weitermachen)\b/],
  ['harder', /(?:^|\s)(schwerer|hoch ?schalten|härter|großer gang)(?=$|\s|[.,!?])/],
  ['easier', /\b(leichter|runter ?schalten|kleiner gang)\b/],
  ['photo', /\b(foto|bild|screenshot)\b/],
  ['next', /(?:^|\s)(nächste[sr]? (lied|song|titel)|skip|überspringen)(?=$|\s|[.,!?])/],
  ['music', /\b(musik)\b/],
  ['view', /\b(ansicht|kamera|perspektive)\b/],
  ['accept', /\b(annehmen|angenommen|challenge|ich bin dabei|na warte)\b/],
  ['watts', /\b(\d{2,4}) ?watt\b/],
];
export function voiceSupported() { return !!(window.SpeechRecognition || window.webkitSpeechRecognition); }

/** parse one recognised phrase: returns { cmd, n? } or null; free = no wake word needed (e.g. while a dare is offered) */
export function parseCommand(text, free = []) {
  const t = text.toLowerCase().normalize('NFC'), woke = WAKE.test(t), rest = woke ? t.slice(t.search(WAKE)) : t;
  for (const [cmd, re] of COMMANDS) { const m = re.exec(rest); if (!m) continue;
    if (!woke && !free.includes(cmd)) continue;
    return cmd === 'watts' ? { cmd, n: +m[1] } : { cmd }; }
  return null;
}

export class VoiceCommands {
  constructor(onCmd, free = () => []) { this.onCmd = onCmd; this.free = free; this.on = false; }
  start() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SR || this.on) return false;
    const r = this.r = new SR(); r.lang = 'de-DE'; r.continuous = true; r.interimResults = false; r.maxAlternatives = 3;
    r.onresult = e => { for (let i = e.resultIndex; i < e.results.length; i++) { if (!e.results[i].isFinal) continue;
      for (const alt of e.results[i]) { const c = parseCommand(alt.transcript, this.free()); if (c) { this.onCmd(c, alt.transcript); break; } } } };
    r.onerror = e => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { this.on = false; this.denied = true; } };
    r.onend = () => { if (this.on) setTimeout(() => { try { this.on && r.start(); } catch { /* already running */ } }, 300); }; // Chrome ends after silence: listen again
    this.on = true; try { r.start(); } catch { this.on = false; }
    return this.on;
  }
  stop() { this.on = false; try { this.r?.abort(); } catch { /* gone */ } this.r = null; }
}
