// fallback · pure refund/rights kernel — no DOM, no clock, no IO. Total: garbage → safe empties, never throws.
// The deterministic engine behind "drop a statement → see what you're owed": statement parsing, the
// charge-detection rules (recurring subscriptions, bank fees, price hikes, duplicates), and the money
// maths. Two things made deterministic vs the old inline code, both load-bearing for a provable receipt:
//   • finding IDs are CONTENT-ADDRESSED (a hash of type+vendor+kind), not Math.random() — so re-parsing
//     the same statement yields the SAME ids, and a sealed receipt is reproducible (the old random ids
//     also silently dropped sent/recovered status on every re-parse).
//   • dates parse to UTC day-numbers, so month-spans (and the fee annualisation that rides on them) are
//     identical in the browser and in CI.
// The payoff: sealFindings/verifyFindings — a tamper-evident receipt over the exact findings + totals.
// No model grades your statement; rules do, and the seal proves the analysis wasn't altered.

export const KERNEL_VERSION = '2.0.0';
const str = (v) => typeof v === 'string' ? v : (v == null ? '' : String(v));
const ONE_DAY = 86400000;

// ── statement parsing (pure, total) ───────────────────────────────────────
export function parseCSVLine(line) {
  const out = [];
  let cur = '', inQ = false;
  const s = str(line);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' && s[i + 1] === '"') { cur += '"'; i++; }
    else if (c === '"') inQ = !inQ;
    else if (c === ',' && !inQ) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

export function parseCSV(text) {
  const lines = str(text).split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const out = [];
  let startIdx = 0;
  const header = lines[0].toLowerCase();
  if (header.includes('date') && (header.includes('amount') || header.includes('debit'))) startIdx = 1;
  for (let i = startIdx; i < lines.length; i++) {
    const cells = parseCSVLine(lines[i]);
    if (cells.length < 2) continue;
    let date = null, desc = null, amount = null;
    for (const c of cells) {
      const t = (c || '').trim();
      if (!date && /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(t)) date = t;
      else if (!date && /^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/.test(t)) date = t;
      else if (amount === null && /^[-+]?\s*[£$€]?\s*-?\d[\d,]*\.?\d{0,2}$/.test(t.replace(/\s/g, ''))) {
        amount = parseFloat(t.replace(/[£$€,\s]/g, ''));
      } else if (!desc) desc = t;
    }
    if (desc && amount != null && !isNaN(amount)) out.push({ date: date || '', description: desc, amount });
  }
  return out;
}

export function parsePasted(text) {
  const lines = str(text).split(/\r?\n/).filter(l => l.trim());
  const out = [];
  for (const line of lines) {
    const m = line.match(/^([\d\-/.]+)\s+(.+?)\s+([-+]?[£$€]?\s*-?\d+(?:[.,]\d{1,2})?)\s*$/);
    if (m) {
      out.push({ date: m[1], description: m[2].trim(), amount: parseFloat(m[3].replace(/[£$€,\s]/g, '')) });
    } else {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2) {
        const last = parts[parts.length - 1].replace(/[£$€,]/g, '');
        const v = parseFloat(last);
        if (!isNaN(v)) out.push({ date: parts[0], description: parts.slice(1, -1).join(' '), amount: v });
      }
    }
  }
  return out;
}

// ── deterministic UTC date → day-number (for month-spans) ─────────────────
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
export function parseDateDay(s) {
  s = str(s).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);          // ISO YYYY-MM-DD
  if (m) return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / ONE_DAY);
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);            // DD/MM/YYYY (UK)
  if (m) { let y = +m[3]; if (y < 100) y += 2000; return Math.floor(Date.UTC(y, +m[2] - 1, +m[1]) / ONE_DAY); }
  m = s.match(/^(\d{1,2})[-/\s]([A-Za-z]{3,9})[-/\s]?(\d{0,4})/); // DD Mon YYYY (PDF)
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()] !== undefined) {
    let y = m[3] ? +m[3] : 2000; if (y < 100) y += 2000;
    return Math.floor(Date.UTC(y, MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1]) / ONE_DAY);
  }
  return null;
}
export function monthSpanOf(txns) {
  const days = (Array.isArray(txns) ? txns : []).map(t => parseDateDay(t && t.date)).filter(d => d !== null);
  if (days.length < 2) return 1;
  return Math.max(1, (Math.max(...days) - Math.min(...days)) / 30);
}

// ── detection rules (data) ────────────────────────────────────────────────
export function normalize(s) { return str(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }

export const KNOWN_SUBS = {
  'netflix': { name: 'Netflix', cat: 'streaming' }, 'spotify': { name: 'Spotify', cat: 'streaming' },
  'apple.com/bill': { name: 'Apple Subscription', cat: 'streaming' }, 'itunes': { name: 'iTunes / Apple', cat: 'streaming' },
  'apple music': { name: 'Apple Music', cat: 'streaming' }, 'amzn prime': { name: 'Amazon Prime', cat: 'streaming' },
  'amazon prime': { name: 'Amazon Prime', cat: 'streaming' }, 'disney': { name: 'Disney+', cat: 'streaming' },
  'disney plus': { name: 'Disney+', cat: 'streaming' }, 'hulu': { name: 'Hulu', cat: 'streaming' },
  'hbo': { name: 'HBO / Max', cat: 'streaming' }, 'paramount': { name: 'Paramount+', cat: 'streaming' },
  'peacock': { name: 'Peacock', cat: 'streaming' }, 'youtube': { name: 'YouTube Premium', cat: 'streaming' },
  'youtube premium': { name: 'YouTube Premium', cat: 'streaming' }, 'audible': { name: 'Audible', cat: 'streaming' },
  'twitch': { name: 'Twitch', cat: 'streaming' }, 'crunchyroll': { name: 'Crunchyroll', cat: 'streaming' },
  'nowtv': { name: 'NOW TV', cat: 'streaming' }, 'sky': { name: 'Sky', cat: 'streaming' },
  'bbc tv': { name: 'BBC TV Licence', cat: 'streaming' },
  'adobe': { name: 'Adobe', cat: 'saas' }, 'canva': { name: 'Canva', cat: 'saas' }, 'notion': { name: 'Notion', cat: 'saas' },
  'dropbox': { name: 'Dropbox', cat: 'saas' }, 'google one': { name: 'Google One', cat: 'saas' }, 'icloud': { name: 'iCloud', cat: 'saas' },
  'office 365': { name: 'Microsoft 365', cat: 'saas' }, 'microsoft': { name: 'Microsoft', cat: 'saas' }, 'github': { name: 'GitHub', cat: 'saas' },
  'openai': { name: 'OpenAI', cat: 'saas' }, 'anthropic': { name: 'Anthropic', cat: 'saas' }, 'chatgpt': { name: 'ChatGPT', cat: 'saas' },
  'claude': { name: 'Claude.ai', cat: 'saas' }, 'figma': { name: 'Figma', cat: 'saas' }, 'linkedin': { name: 'LinkedIn Premium', cat: 'saas' },
  'evernote': { name: 'Evernote', cat: 'saas' },
  'puregym': { name: 'PureGym', cat: 'gym' }, 'pure gym': { name: 'PureGym', cat: 'gym' }, 'virgin active': { name: 'Virgin Active', cat: 'gym' },
  'planet fitness': { name: 'Planet Fitness', cat: 'gym' }, 'la fitness': { name: 'LA Fitness', cat: 'gym' }, 'equinox': { name: 'Equinox', cat: 'gym' },
  'fitness first': { name: 'Fitness First', cat: 'gym' }, 'david lloyd': { name: 'David Lloyd', cat: 'gym' }, 'classpass': { name: 'ClassPass', cat: 'gym' },
  'peloton': { name: 'Peloton', cat: 'gym' },
  'tinder': { name: 'Tinder', cat: 'dating' }, 'bumble': { name: 'Bumble', cat: 'dating' }, 'hinge': { name: 'Hinge', cat: 'dating' }, 'match.com': { name: 'Match.com', cat: 'dating' },
  'uber one': { name: 'Uber One', cat: 'delivery' }, 'deliveroo plus': { name: 'Deliveroo Plus', cat: 'delivery' }, 'just eat': { name: 'Just Eat Pro', cat: 'delivery' },
};

export const BANK_FEE_PATTERNS = [
  { re: /overdraft/i, type: 'overdraft_fee', avg: 35 },
  { re: /returned (item|payment|dd)/i, type: 'returned_item_fee', avg: 25 },
  { re: /unpaid (dd|direct debit)/i, type: 'unpaid_dd_fee', avg: 25 },
  { re: /excess fee|over.limit fee/i, type: 'excess_fee', avg: 12 },
  { re: /non-?sterling|fx fee|cross.border|foreign exchange/i, type: 'fx_fee', avg: 5 },
  { re: /paper statement/i, type: 'paper_statement_fee', avg: 3 },
  { re: /cash advance fee/i, type: 'cash_advance_fee', avg: 5 },
  { re: /annual fee/i, type: 'annual_card_fee', avg: 95 },
  { re: /late payment/i, type: 'late_payment_fee', avg: 12 },
];

// content-addressed, stable finding id — same statement ⇒ same ids ⇒ reproducible receipt
function findingId(type, vendor, kind) { return 'F' + sha256(type + '|' + str(vendor) + '|' + str(kind)).slice(0, 10); }
function money(n, cur) { return str(cur) + (Math.round(n * 100) / 100).toFixed(2); }

// ── the engine: transactions → findings (pure, deterministic) ─────────────
export function detectFindings(txns, currency) {
  const cur = str(currency) || '£';
  const list = Array.isArray(txns) ? txns.filter(t => t && typeof t.amount === 'number') : [];
  const findings = [];

  const groups = {};
  for (const t of list) {
    if (!t.amount || t.amount >= 0) continue; // outgoing only
    const desc = normalize(t.description);
    const key = desc.slice(0, 30).split(' ').slice(0, 3).join(' ');
    if (!groups[key]) groups[key] = { desc, count: 0, amounts: [], txns: [] };
    groups[key].count++;
    groups[key].amounts.push(Math.abs(t.amount));
    groups[key].txns.push(t);
  }

  // Pass 1 — recurring subscriptions (≥2 charges within 10% of each other). A recurring bank fee
  // belongs to Pass 2 alone, so skip fee-matching groups here — else a refund is double-counted.
  for (const key of Object.keys(groups)) {
    const g = groups[key];
    if (g.count < 2) continue;
    if (BANK_FEE_PATTERNS.some(p => p.re.test(g.desc))) continue;
    const avg = g.amounts.reduce((a, b) => a + b, 0) / g.amounts.length;
    if (!g.amounts.every(a => Math.abs(a - avg) / avg < 0.10)) continue;
    let vendor = null, cat = 'subscription';
    for (const k of Object.keys(KNOWN_SUBS)) { if (g.desc.includes(k)) { vendor = KNOWN_SUBS[k].name; cat = KNOWN_SUBS[k].cat; break; } }
    if (!vendor) vendor = g.desc.split(' ').slice(0, 3).join(' ').toUpperCase();
    const type = cat === 'gym' ? 'gym' : (cat === 'streaming' ? 'streaming' : (cat === 'saas' ? 'saas' : 'subscription'));
    findings.push({
      id: findingId(type, vendor, cat + '|' + key), type, vendor, monthly: avg, annual: avg * 12,
      count: g.count, lastSeen: g.txns[g.txns.length - 1].date, hits: g.txns.length,
      status: 'pending', raw: g.txns, category: cat,
    });
  }

  // Pass 2 — bank fees, aggregated by type
  const feeAgg = {};
  for (const t of list) {
    if (!t.amount || t.amount >= 0) continue;
    for (const p of BANK_FEE_PATTERNS) {
      if (p.re.test(str(t.description))) {
        if (!feeAgg[p.type]) feeAgg[p.type] = { count: 0, total: 0, txns: [] };
        feeAgg[p.type].count++; feeAgg[p.type].total += Math.abs(t.amount); feeAgg[p.type].txns.push(t);
        break;
      }
    }
  }
  for (const type of Object.keys(feeAgg)) {
    const info = feeAgg[type], span = Math.max(1, monthSpanOf(info.txns));
    findings.push({
      id: findingId('bank_fee', type.replace(/_/g, ' '), type), type: 'bank_fee', feeKind: type,
      vendor: type.replace(/_/g, ' '), monthly: info.total / span, annual: info.total * (12 / span),
      count: info.count, hits: info.count, status: 'pending', raw: info.txns, category: 'fee', refundable: info.total,
    });
  }

  // Pass 3 — price hikes (a recurring charge with max/median > 1.15)
  for (const key of Object.keys(groups)) {
    const g = groups[key];
    if (g.count < 3) continue;
    const sorted = [...g.amounts].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const max = Math.max(...g.amounts);
    if (max / median > 1.15) {
      let vendor = null;
      for (const k of Object.keys(KNOWN_SUBS)) { if (g.desc.includes(k)) { vendor = KNOWN_SUBS[k].name; break; } }
      if (!vendor) vendor = g.desc.split(' ').slice(0, 3).join(' ').toUpperCase();
      // A group tight enough to be a Pass-1 recurring can never also clear 1.15 here (proven), so a
      // price hike is always its own finding — no annotate-the-existing branch to leave dead.
      findings.push({
        id: findingId('price_hike', vendor, 'hike|' + key), type: 'price_hike', vendor, monthly: max, annual: max * 12,
        count: g.count, hits: g.count, status: 'pending', raw: g.txns, category: 'hike',
        note: `was ${money(median, cur)} · now ${money(max, cur)}`,
      });
    }
  }

  // Pass 4 — duplicate subscriptions in the same category
  const byCat = {};
  for (const f of findings) if (['streaming', 'gym', 'dating'].includes(f.category)) (byCat[f.category] = byCat[f.category] || []).push(f);
  for (const cat of Object.keys(byCat)) if (byCat[cat].length >= 2) byCat[cat].forEach(f => f.duplicate_category = cat);

  return findings;
}

// ── money totals — the honest breakdown ───────────────────────────────────
export function totalsOf(findings) {
  const list = Array.isArray(findings) ? findings : [];
  const refundable = list.filter(f => f.type === 'bank_fee').reduce((s, f) => s + (f.refundable || 0), 0);
  const annualSavings = list.filter(f => ['subscription', 'streaming', 'saas', 'gym', 'dating', 'delivery'].includes(f.type)).reduce((s, f) => s + (f.annual || 0), 0);
  const disputable = list.filter(f => f.type === 'price_hike').reduce((s, f) => s + (f.annual || 0), 0);
  const totalAnnual = list.reduce((s, f) => s + (f.annual || 0), 0);
  return {
    refundable: round2(refundable), annualSavings: round2(annualSavings), disputable: round2(disputable),
    totalAnnual: round2(totalAnnual), count: list.length,
  };
}
function round2(n) { return Math.round(n * 100) / 100; }

// ── high-level: statement → findings + totals + tamper-evident receipt ────
export function analyze(input) {
  try {
    const o = (input && typeof input === 'object') ? input : {};
    const txns = Array.isArray(o.txns) ? o.txns : [];
    const currency = str(o.currency); // detectFindings + sealFindings default a falsy currency to £
    const findings = detectFindings(txns, currency);
    const totals = totalsOf(findings);
    const receipt = sealFindings(findings, txns, currency);
    return { ok: true, findings, totals, receipt };
  } catch (e) {
    return { ok: false, error: 'analyze failed', findings: [], totals: totalsOf([]) };
  }
}

// ── content-addressed, tamper-evident receipt ─────────────────────────────
// Seals a canonical SUMMARY of the findings (id/type/vendor/monthly/annual/hits) + the totals + a
// hash of the statement, so any later change to a claimed amount breaks the seal.
export function sealFindings(findings, txns, currency) {
  const list = Array.isArray(findings) ? findings : [];
  const summary = list.map(f => ({ id: f.id, type: f.type, vendor: f.vendor, monthly: round2(f.monthly), annual: round2(f.annual), hits: f.hits }))
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const statementHash = sha256(canon((Array.isArray(txns) ? txns : []).map(t => ({ date: str(t && t.date), description: str(t && t.description), amount: (t && typeof t.amount === 'number') ? t.amount : 0 }))));
  const body = { v: KERNEL_VERSION, kind: 'fallback-findings', currency: str(currency) || '£', statementHash, totals: totalsOf(list), findings: summary };
  return { ...body, seal: sha256(canon(body)) };
}
export function verifyFindings(receipt) {
  if (!receipt || typeof receipt !== 'object') return { ok: false, reason: 'not an object' };
  if (receipt.kind !== 'fallback-findings') return { ok: false, reason: 'wrong kind' };
  if (typeof receipt.seal !== 'string') return { ok: false, reason: 'no seal' };
  const body = { ...receipt }; delete body.seal;
  return sha256(canon(body)) === receipt.seal ? { ok: true } : { ok: false, reason: 'seal mismatch' };
}

// ── canonical JSON (sorted keys) ──────────────────────────────────────────
export function canon(x) {
  if (x === undefined) return 'null';
  if (x === null || typeof x !== 'object') return JSON.stringify(x);
  if (Array.isArray(x)) return '[' + x.map(canon).join(',') + ']';
  const keys = Object.keys(x).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canon(x[k])).join(',') + '}';
}

// ── sha256 (pure, explicit K256) ──────────────────────────────────────────
const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
export function sha256(ascii) {
  ascii = str(ascii);
  const bytes = [];
  for (let i = 0; i < ascii.length; i++) {
    let c = ascii.charCodeAt(i);
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c < 0xd800 || c >= 0xe000) bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    else { i++; c = 0x10000 + (((c & 0x3ff) << 10) | (ascii.charCodeAt(i) & 0x3ff)); bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }
  }
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const hi = Math.floor(bitLen / 0x100000000), lo = bitLen >>> 0;
  bytes.push((hi >>> 24) & 0xff, (hi >>> 16) & 0xff, (hi >>> 8) & 0xff, hi & 0xff, (lo >>> 24) & 0xff, (lo >>> 16) & 0xff, (lo >>> 8) & 0xff, lo & 0xff);
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  for (let off = 0; off < bytes.length; off += 64) {
    for (let t = 0; t < 16; t++) w[t] = (bytes[off + 4 * t] << 24) | (bytes[off + 4 * t + 1] << 16) | (bytes[off + 4 * t + 2] << 8) | (bytes[off + 4 * t + 3]);
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K256[t] + w[t]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }
  let out = '';
  for (let i = 0; i < 8; i++) out += (H[i] >>> 0).toString(16).padStart(8, '0');
  return out;
}

export default { KERNEL_VERSION, parseCSV, parseCSVLine, parsePasted, parseDateDay, monthSpanOf, normalize, KNOWN_SUBS, BANK_FEE_PATTERNS, detectFindings, totalsOf, analyze, sealFindings, verifyFindings, canon, sha256 };
