// Wizard points (owner 19.11.): the one currency of RIDEFRAME. Riding earns them, the shop (js/shop.js) turns them into looks
// for your rider. Per ride: 1 per km + 1 per 10 m climbed + half the training load (TSS-like: one hour exactly at FTP = 100),
// +25 for a passed wizard trial, +15 per won challenge (3 a ride at most). Under 10 minutes pays nothing. The day caps of the
// old wager stay (150 km, 3000 m). Strength after the ride pays per rep. Pure: no DOM, no storage (tools/wizpoints-test.mjs);
// the server (tools/accounts-api.mjs) uses the same wallet rules.
export const WP = { hmPer: 10, loadDiv: 2, trial: 25, win: 15, winsCap: 3, minMin: 10, dayKm: 150, dayHm: 3000 };
export const PARTS = [['distance', 'Distance'], ['climbing', 'Climbing'], ['intensity', 'Intensity'], ['trial', 'Trial'], ['challenges', 'Challenges'], ['strength', 'Strength']];

/** training load of dt seconds at power W (TSS-like: (P/FTP)² × 100 per hour); 0 without power or FTP */
export const loadStep = (dt, power, ftp) => (power > 0 && ftp > 0 && dt > 0 ? dt * (power / ftp) ** 2 * 100 / 3600 : 0);

/** one ride's Wizard points with the breakdown; every part rounded on its own so the lines add up to the total */
export function ridePoints({ km = 0, hm = 0, load = 0, trials = 0, wins = 0, strength = 0, minutes = 0 } = {}) {
  const p = { distance: Math.round(Math.max(0, km)), climbing: Math.round(Math.max(0, hm) / WP.hmPer), intensity: Math.round(Math.max(0, load) / WP.loadDiv),
    trial: Math.max(0, trials | 0) * WP.trial, challenges: Math.min(WP.winsCap, Math.max(0, wins | 0)) * WP.win, strength: Math.max(0, Math.round(strength)) };
  if (!(minutes >= WP.minMin)) for (const k in p) p[k] = 0; // a ride under 10 minutes pays nothing
  p.total = PARTS.reduce((a, [k]) => a + p[k], 0);
  return p;
}
/** which of distance / climbing / intensity a ride's points came from: only for the week's colour of the world (king / devil / wizard) */
export const splitOf = p => ({ king: p.distance || 0, devil: p.climbing || 0, wizard: (p.intensity || 0) + (p.trial || 0) + (p.challenges || 0) });

// ---- strength after the ride (the inn): the same per-rep rates and caps as the old wager, now paid in Wizard points ----
export const STR_DAY = 30, STR_DAYS = 4; // points a day, days a week
export const EXERCISES = [ // per: reps (or minutes) for one point
  { id: 'pull', what: 'Pull-ups', per: 2 }, { id: 'push', what: 'Push-ups', per: 5 }, { id: 'sit', what: 'Sit-ups', per: 8 },
  { id: 'burpee', what: 'Burpees', per: 3, more: true }, { id: 'squat', what: 'Squats', per: 8, more: true }, { id: 'plank', what: 'Plank', per: 0.5, unit: 'min', more: true },
];
/** points for n reps (or minutes) of exercise e, capped by what is left today */
export const strengthPts = (e, n, left = STR_DAY) => Math.max(0, Math.min(left, Math.floor((+n || 0) / e.per)));

// ---- the wallet: L.wp = { earned, spent, owned: [ids], v: 1 }, balance = earned − spent ----
const num = (v, max = 1e8) => (Number.isFinite(+v) ? Math.max(0, Math.min(max, Math.round(+v))) : 0);
const ID = /^[a-z0-9-]{1,40}$/;
/** never trust a wallet from the network or an old save */
export function cleanWallet(w) {
  w = w && typeof w === 'object' ? w : {};
  return { earned: num(w.earned), spent: num(w.spent), owned: [...new Set((Array.isArray(w.owned) ? w.owned : []).filter(x => typeof x === 'string' && ID.test(x)))].slice(0, 200), v: 1 };
}
/** what you can spend (grant: the ?wp= test hook, in memory only) */
export const balanceOf = w => Math.max(0, Math.round((w?.earned || 0) + (w?.grant || 0) - (w?.spent || 0)));
/** two devices / the server: the higher earned and spent win, owned is the union (a second device never wipes a purchase) */
export function mergeWallet(a, b) {
  const x = cleanWallet(a), y = cleanWallet(b);
  return { earned: Math.max(x.earned, y.earned), spent: Math.max(x.spent, y.spent), owned: [...new Set([...x.owned, ...y.owned])], v: 1 };
}
const sum3 = p => (p ? (+p.wizard || 0) + (+p.king || 0) + (+p.devil || 0) : 0);
/** one-time move from the three-figure wager: the lifetime's worth (km + Hm / 10) plus this week's old points. Returns true when it ran. */
export function migrateLedger(L, week) {
  if (L.wp && L.wp.v) return false;
  const old = L.week === week ? Math.round(sum3(L.pts)) : 0;
  L.wp = { ...cleanWallet(null), earned: Math.round((+L.life?.km || 0) + (+L.life?.hm || 0) / WP.hmPer) + old };
  if (L.week === week) L.weekWp = old;
  return true;
}
/** book n points: wallet and this week's total (the leaderboard) */
export function earn(L, n) { n = Math.max(0, Math.round(n || 0)); L.wp.earned += n; L.weekWp = (L.weekWp || 0) + n; return n; }
/** "1 240": thin-space thousands like the spec's "🧙 1 240" */
export const fmtWp = n => Math.round(+n || 0).toLocaleString('en-GB').replace(/,/g, ' ');
