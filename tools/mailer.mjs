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
    const s = connect({ host: c.host, port: c.port || 465, servername: c.host }); s.setEncoding('utf8'); s.setTimeout(20000, () => { s.destroy(); reject(new Error('SMTP timeout')); });
    let buf = ''; const steps = [
      [null, 220], [`EHLO rideframe`, 250], ['AUTH LOGIN', 334], [Buffer.from(c.user).toString('base64'), 334], [Buffer.from(c.pass).toString('base64'), 235],
      [`MAIL FROM:<${addr(from)}>`, 250], [`RCPT TO:<${to}>`, 250], ['DATA', 354], [raw.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..') + '\r\n.', 250], ['QUIT', 221]];
    let i = 0; const nextStep = () => { const [cmd] = steps[i]; if (cmd != null) s.write(cmd + '\r\n'); };
    s.on('data', d => { buf += d; const lines = buf.split('\r\n'); buf = lines.pop();
      for (const l of lines) { if (/^\d{3}-/.test(l)) continue; // multi-line reply continues
        const code = +l.slice(0, 3), want = steps[i][1];
        if (code !== want) { s.destroy(); return reject(new Error(`SMTP ${i === 4 ? '(login refused) ' : ''}${l}`)); }
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
const page = (title, body) => `<!doctype html><html lang="en"><body style="margin:0;background:#0b0b0b;padding:32px 16px;font-family:Helvetica,Arial,sans-serif;color:#f4f1ea">
<div style="max-width:520px;margin:0 auto;background:#161616;border-radius:12px;padding:28px 24px">
<div style="font-weight:900;font-size:22px;letter-spacing:.02em">RIDE<span style="color:#ff5a1f">FRAME</span></div>
<h1 style="font-size:20px;margin:22px 0 12px">${esc(title)}</h1>${body}
<p style="color:#8a8a8a;font-size:12px;margin-top:28px">You are getting this mail because a RIDEFRAME account is linked to your address.</p></div></body></html>`;
const btn = (href, label) => `<p style="margin:24px 0"><a href="${esc(href)}" style="background:#ff5a1f;color:#0b0b0b;text-decoration:none;font-weight:800;padding:14px 22px;border-radius:8px;display:inline-block">${esc(label)}</a></p>`;

export function welcomeMail(name, base) {
  const text = `Hi ${name},\n\nthanks for signing up to RIDEFRAME! Your account is ready; from now on your rides and workouts are saved and available on all your devices.\n\nLet's go: ${base}/handy.html\n\nIf you ever forget your password, tap “Forgot password?” in the app and a link will come to this address.\n\nEnjoy the ride!\nRIDEFRAME`;
  const html = page(`Welcome, ${name}!`, `<p style="line-height:1.5">Thanks for signing up to RIDEFRAME! Your account is ready. From now on your rides and workouts are saved and available on all your devices.</p>${btn(base + '/handy.html', 'Open RIDEFRAME')}<p style="line-height:1.5;color:#bdbdbd">If you ever forget your password, tap “Forgot password?” in the app and a link will come to this address.</p>`);
  return ['Welcome to RIDEFRAME', text, html];
}
export function resetMail(name, link) {
  const text = `Hi ${name},\n\nyou asked for a new RIDEFRAME password. Set it with this link (valid for 1 hour, once):\n\n${link}\n\nIf this was not you, just ignore this mail. Your old password stays valid.\n\nRIDEFRAME`;
  const html = page('Set a new password', `<p style="line-height:1.5">Hi ${esc(name)}, you asked for a new RIDEFRAME password.</p>${btn(link, 'Set new password')}<p style="line-height:1.5;color:#bdbdbd">The link is valid for 1 hour and works once. If this was not you, just ignore this mail; your old password stays valid.</p>`);
  return ['Your new RIDEFRAME password', text, html];
}
