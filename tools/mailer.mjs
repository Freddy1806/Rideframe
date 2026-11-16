// Sends the account mails (welcome, password reset). Settings in <data>/mail.json, readable by the host user only:
//   Gmail / any SMTP:  { "smtp": { "host": "smtp.gmail.com", "port": 465, "user": "rideframe.app@gmail.com", "pass": "<app password>" }, "from": "RIDEFRAME <rideframe.app@gmail.com>", "base": "https://…" }
//   Brevo:             { "brevo": { "key": "<api key>" }, "from": "RIDEFRAME <hallo@…>", "base": "https://…" }
// Without mail.json nothing is sent (sendMail returns false) and the rest of the app works as before.
// No packages: SMTP over TLS (port 465) is spoken directly, Brevo over its HTTP API.
import { readFile } from 'node:fs/promises';
import { connect } from 'node:tls';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DATA = process.env.RIDEFRAME_DATA || join(homedir(), 'RIDEFRAME_data');
export const mailConfig = async () => { try { return JSON.parse(await readFile(join(DATA, 'mail.json'), 'utf8')); } catch { return null; } };
const addr = s => (String(s).match(/<([^>]+)>/) || [, s])[1].trim();
const enc = s => /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`;
const fromHeader = f => { const m = String(f).match(/^(.*)<([^>]+)>$/); return m ? `${enc(m[1].trim())} <${m[2]}>` : f; };

function smtp(c, from, to, raw) {
  return new Promise((resolve, reject) => {
    const s = connect({ host: c.host, port: c.port || 465, servername: c.host }); s.setEncoding('utf8'); s.setTimeout(20000, () => { s.destroy(); reject(new Error('SMTP Zeitüberschreitung')); });
    let buf = ''; const steps = [
      [null, 220], [`EHLO rideframe`, 250], ['AUTH LOGIN', 334], [Buffer.from(c.user).toString('base64'), 334], [Buffer.from(c.pass).toString('base64'), 235],
      [`MAIL FROM:<${addr(from)}>`, 250], [`RCPT TO:<${to}>`, 250], ['DATA', 354], [raw.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..') + '\r\n.', 250], ['QUIT', 221]];
    let i = 0; const nextStep = () => { const [cmd] = steps[i]; if (cmd != null) s.write(cmd + '\r\n'); };
    s.on('data', d => { buf += d; const lines = buf.split('\r\n'); buf = lines.pop();
      for (const l of lines) { if (/^\d{3}-/.test(l)) continue; // multi-line reply continues
        const code = +l.slice(0, 3), want = steps[i][1];
        if (code !== want) { s.destroy(); return reject(new Error(`SMTP ${i === 4 ? '(Login abgelehnt) ' : ''}${l}`)); }
        if (++i >= steps.length) { s.end(); return resolve(true); } nextStep(); } });
    s.on('error', reject); nextStep();
  });
}

/** sends one mail; returns true, or false when no mail is set up; throws when sending fails */
export async function sendMail(to, subject, text, html) {
  const c = await mailConfig(); if (!c || !to) return false;
  const from = c.from || c.smtp?.user;
  if (c.brevo?.key) {
    const m = String(from).match(/^(.*)<([^>]+)>$/), sender = m ? { name: m[1].trim(), email: m[2] } : { email: from };
    const r = await fetch('https://api.brevo.com/v3/smtp/email', { method: 'POST', headers: { 'api-key': c.brevo.key, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender, to: [{ email: to }], subject, textContent: text, htmlContent: html || undefined }) });
    if (!r.ok) throw new Error('Brevo ' + r.status); return true;
  }
  if (!c.smtp?.host) return false;
  const b = 'rf' + randomBytes(8).toString('hex');
  const raw = [`From: ${fromHeader(from)}`, `To: <${to}>`, `Subject: ${enc(subject)}`, `Date: ${new Date().toUTCString()}`, `Message-ID: <${randomBytes(12).toString('hex')}@rideframe>`, 'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${b}"`, '', `--${b}`, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', Buffer.from(text).toString('base64').replace(/.{76}/g, '$&\n'),
    ...(html ? [`--${b}`, 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64', '', Buffer.from(html).toString('base64').replace(/.{76}/g, '$&\n')] : []), `--${b}--`, ''].join('\n');
  return smtp(c.smtp, from, to, raw);
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const page = (title, body) => `<!doctype html><html lang="de"><body style="margin:0;background:#0b0b0b;padding:32px 16px;font-family:Helvetica,Arial,sans-serif;color:#f4f1ea">
<div style="max-width:520px;margin:0 auto;background:#161616;border-radius:12px;padding:28px 24px">
<div style="font-weight:900;font-size:22px;letter-spacing:.02em">RIDE<span style="color:#ff5a1f">FRAME</span></div>
<h1 style="font-size:20px;margin:22px 0 12px">${esc(title)}</h1>${body}
<p style="color:#8a8a8a;font-size:12px;margin-top:28px">Du bekommst diese Mail, weil mit deiner Adresse ein RIDEFRAME-Konto verknüpft ist.</p></div></body></html>`;
const btn = (href, label) => `<p style="margin:24px 0"><a href="${esc(href)}" style="background:#ff5a1f;color:#0b0b0b;text-decoration:none;font-weight:800;padding:14px 22px;border-radius:8px;display:inline-block">${esc(label)}</a></p>`;

export function welcomeMail(name, base) {
  const text = `Hallo ${name},\n\ndanke fürs Registrieren bei RIDEFRAME! Dein Konto ist angelegt, deine Fahrten und Workouts werden ab jetzt gespeichert und sind auf all deinen Geräten da.\n\nLos geht's: ${base}/handy.html\n\nFalls du dein Passwort mal vergisst: in der App auf „Passwort vergessen?“ tippen, dann kommt ein Link an diese Adresse.\n\nViel Spaß beim Fahren!\nRIDEFRAME`;
  const html = page(`Willkommen, ${name}!`, `<p style="line-height:1.5">Danke fürs Registrieren bei RIDEFRAME! Dein Konto ist angelegt. Deine Fahrten und Workouts werden ab jetzt gespeichert und sind auf all deinen Geräten da.</p>${btn(base + '/handy.html', 'RIDEFRAME öffnen')}<p style="line-height:1.5;color:#bdbdbd">Falls du dein Passwort mal vergisst: in der App auf „Passwort vergessen?“ tippen, dann kommt ein Link an diese Adresse.</p>`);
  return ['Willkommen bei RIDEFRAME', text, html];
}
export function resetMail(name, link) {
  const text = `Hallo ${name},\n\ndu hast ein neues Passwort für RIDEFRAME angefordert. Über diesen Link legst du es fest (gilt 1 Stunde, nur einmal):\n\n${link}\n\nWenn du das nicht warst, ignoriere diese Mail einfach. Dein altes Passwort bleibt dann gültig.\n\nRIDEFRAME`;
  const html = page('Neues Passwort festlegen', `<p style="line-height:1.5">Hallo ${esc(name)}, du hast ein neues Passwort für RIDEFRAME angefordert.</p>${btn(link, 'Neues Passwort festlegen')}<p style="line-height:1.5;color:#bdbdbd">Der Link gilt 1 Stunde und nur einmal. Wenn du das nicht warst, ignoriere diese Mail einfach, dein altes Passwort bleibt dann gültig.</p>`);
  return ['Dein neues RIDEFRAME-Passwort', text, html];
}
