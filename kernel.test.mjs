import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  parseCSV, parseCSVLine, parsePasted, parseDateDay, monthSpanOf, normalize,
  detectFindings, totalsOf, analyze, sealFindings, verifyFindings, canon, sha256,
} from './kernel.mjs';

const STMT = `Date,Description,Amount
2026-01-05,NETFLIX.COM,-9.99
2026-02-05,NETFLIX.COM,-9.99
2026-03-05,NETFLIX.COM,-9.99
2026-01-10,SPOTIFY,-11.99
2026-02-10,SPOTIFY,-11.99
2026-01-15,OVERDRAFT FEE,-35.00
2026-02-15,OVERDRAFT FEE,-35.00
2026-01-20,PUREGYM LTD,-20.00
2026-02-20,PUREGYM LTD,-20.00
2026-03-20,PUREGYM LTD,-30.00
2026-01-25,SALARY ACME,2500.00`;

// ── statement parsing ─────────────────────────────────────────────────────
test('parseCSVLine: quoted cells with embedded commas and escaped quotes', () => {
  assert.deepEqual(parseCSVLine('a,"b,c",d'), ['a', 'b,c', 'd']);
  assert.deepEqual(parseCSVLine('"He said ""hi""",5'), ['He said "hi"', '5']);
  assert.deepEqual(parseCSVLine(null), ['']);
});

test('parseCSV: detects header, extracts date/desc/amount, keeps sign', () => {
  const rows = parseCSV(STMT);
  assert.equal(rows.length, 11);          // 10 charges + 1 salary, header skipped
  assert.equal(rows[0].description, 'NETFLIX.COM');
  assert.equal(rows[0].amount, -9.99);
  assert.equal(rows[10].amount, 2500);
  assert.deepEqual(parseCSV(''), []);
  assert.deepEqual(parseCSV(null), []);
});

test('parsePasted: whitespace-separated date description amount', () => {
  const rows = parsePasted('2026-01-05 NETFLIX.COM -9.99\n2026-01-06 Tesco £-43.21');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].amount, -9.99);
  assert.equal(rows[1].amount, -43.21);
  assert.deepEqual(parsePasted(''), []);
});

// ── deterministic date parsing + month span ───────────────────────────────
test('parseDateDay: ISO, UK DD/MM, and DD Mon YYYY all agree', () => {
  const iso = parseDateDay('2026-01-15');
  assert.equal(typeof iso, 'number');
  assert.equal(parseDateDay('15/01/2026'), iso);   // UK DD/MM
  assert.equal(parseDateDay('15 Jan 2026'), iso);  // PDF style
  assert.equal(parseDateDay('garbage'), null);
  assert.equal(parseDateDay(''), null);
});
test('monthSpanOf: 30 days = 1 month; <2 dates = 1', () => {
  assert.equal(monthSpanOf([{ date: '2026-01-01' }, { date: '2026-01-31' }]), 1); // 30 days / 30
  assert.equal(monthSpanOf([{ date: '2026-01-01' }]), 1);
  assert.equal(monthSpanOf([]), 1);
  assert.equal(monthSpanOf('junk'), 1);
});

test('normalize: lowercased, punctuation to spaces, collapsed', () => {
  assert.equal(normalize('NETFLIX.COM  *SUB'), 'netflix com sub');
  assert.equal(normalize(null), '');
});

// ── the engine ────────────────────────────────────────────────────────────
test('detectFindings: subscriptions, bank fees, price hikes, duplicates', () => {
  const f = detectFindings(parseCSV(STMT), '£');
  assert.equal(f.length, 4);
  const by = (t, v) => f.find(x => x.type === t && (v ? x.vendor === v : true));

  const nf = by('streaming', 'Netflix');
  assert.ok(nf); assert.equal(nf.monthly, 9.99); assert.equal(nf.annual, 9.99 * 12); assert.equal(nf.hits, 3);
  assert.equal(nf.duplicate_category, 'streaming'); assert.equal(nf.status, 'pending');

  const sp = by('streaming', 'Spotify');
  assert.ok(sp); assert.equal(sp.annual, 11.99 * 12); assert.equal(sp.duplicate_category, 'streaming');

  const od = by('bank_fee');
  assert.ok(od); assert.equal(od.feeKind, 'overdraft_fee'); assert.equal(od.refundable, 70); assert.equal(od.hits, 2);

  const hike = by('price_hike', 'PureGym');
  assert.ok(hike); assert.equal(hike.monthly, 30); assert.equal(hike.annual, 360);
  assert.match(hike.note, /now £30\.00/);
});

test('detectFindings: outgoing only — income is never a finding', () => {
  const f = detectFindings([{ date: '2026-01-01', description: 'SALARY', amount: 2500 }, { date: '2026-02-01', description: 'SALARY', amount: 2500 }], '£');
  assert.equal(f.length, 0);
});

test('detectFindings: <2 charges is not recurring; the 10% variance boundary is exclusive', () => {
  const one = detectFindings([{ date: '2026-01-01', description: 'ACMECORP', amount: -10 }], '£');
  assert.equal(one.length, 0, 'a single charge is not recurring');
  // two charges exactly ±10% of the average → NOT recurring (the bound is strict <0.10)
  const edge = detectFindings([{ date: '2026-01-01', description: 'ACMECORP', amount: -9 }, { date: '2026-02-01', description: 'ACMECORP', amount: -11 }], '£');
  assert.equal(edge.length, 0, '9 and 11 sit exactly at ±10% of 10 — excluded');
  // within 10% → recurring
  const ok = detectFindings([{ date: '2026-01-01', description: 'ACMECORP', amount: -10 }, { date: '2026-02-01', description: 'ACMECORP', amount: -10.5 }], '£');
  assert.equal(ok.length, 1);
});

test('detectFindings: a price hike needs 3+ charges and strictly >1.15 (a Pass-1 recurring at 1.15 stays one finding)', () => {
  // 10,10,11.5 is tight enough to be recurring (Pass 1) and its max/median is exactly 1.15 → NO hike
  const f = detectFindings([
    { date: '2026-01-01', description: 'GYMXYZ', amount: -10 },
    { date: '2026-02-01', description: 'GYMXYZ', amount: -10 },
    { date: '2026-03-01', description: 'GYMXYZ', amount: -11.5 },
  ], '£');
  assert.equal(f.length, 1, 'exactly 1.15 is not >1.15 → recurring only, no separate hike');
  assert.equal(f[0].type, 'subscription');
});

test('detectFindings: CONTENT-ADDRESSED ids — same statement, same ids (reproducible)', () => {
  const a = detectFindings(parseCSV(STMT), '£').map(f => f.id).sort();
  const b = detectFindings(parseCSV(STMT), '£').map(f => f.id).sort();
  assert.deepEqual(a, b);
  assert.ok(a.every(id => /^F[0-9a-f]{10}$/.test(id)), 'ids are F + 10 hex, not random');
});

// ── totals ────────────────────────────────────────────────────────────────
test('totalsOf: the honest breakdown — refundable vs savings vs disputable', () => {
  const t = totalsOf(detectFindings(parseCSV(STMT), '£'));
  assert.equal(t.refundable, 70);                    // the overdraft fees — actual money back
  assert.equal(t.annualSavings, 9.99 * 12 + 11.99 * 12); // Netflix + Spotify, cancel to save
  assert.equal(t.disputable, 360);                   // the PureGym hike
  assert.equal(t.count, 4);
});

// ── analyze end-to-end + receipt ──────────────────────────────────────────
test('analyze: statement → findings + totals + a verifying receipt', () => {
  const r = analyze({ txns: parseCSV(STMT), currency: '£' });
  assert.equal(r.ok, true);
  assert.equal(r.findings.length, 4);
  assert.equal(r.totals.refundable, 70);
  assert.equal(r.receipt.kind, 'fallback-findings');
  assert.equal(verifyFindings(r.receipt).ok, true);
});

test('sealFindings/verifyFindings: honest seal passes, any tamper fails', () => {
  const findings = detectFindings(parseCSV(STMT), '£');
  const receipt = sealFindings(findings, parseCSV(STMT), '£');
  assert.equal(verifyFindings(receipt).ok, true);
  // seal is stable for the same input
  assert.equal(sealFindings(findings, parseCSV(STMT), '£').seal, receipt.seal);
  // tamper a claimed amount → seal breaks
  const forged = JSON.parse(JSON.stringify(receipt));
  forged.totals.refundable = 99999;
  assert.equal(verifyFindings(forged).ok, false);
  assert.equal(verifyFindings(forged).reason, 'seal mismatch');
  assert.deepEqual(verifyFindings(null), { ok: false, reason: 'not an object' });
  assert.deepEqual(verifyFindings({}), { ok: false, reason: 'wrong kind' });
  assert.deepEqual(verifyFindings({ kind: 'fallback-findings' }), { ok: false, reason: 'no seal' });
});

// ── canon + sha256 ────────────────────────────────────────────────────────
test('canon: sorted keys, arrays, null', () => {
  assert.equal(canon({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(canon([1, 2]), '[1,2]');
  assert.equal(canon(null), 'null');
  assert.equal(canon(undefined), 'null');
});
test('sha256 matches node:crypto across lengths and unicode', () => {
  for (const s of ['', 'abc', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'x'.repeat(120),
    '', '', '߿', 'ࠀ', '', '𐀀', '£5 café 😀',
    canon(detectFindings(parseCSV(STMT), '£').map(f => ({ id: f.id, annual: f.annual })))]) {
    assert.equal(sha256(s), createHash('sha256').update(s, 'utf8').digest('hex'), 'mismatch for ' + JSON.stringify(s));
  }
});

// ── fuzz ──────────────────────────────────────────────────────────────────
test('fuzz: total on garbage — never throws', () => {
  const junk = [null, undefined, '', 7, {}, [], { txns: 'nope' }, { txns: [null, 7, { amount: 'x' }] }, [1, 2], NaN];
  for (const j of junk) {
    assert.doesNotThrow(() => analyze(j));
    assert.doesNotThrow(() => detectFindings(j, '£'));
    assert.doesNotThrow(() => totalsOf(j));
    assert.doesNotThrow(() => parseCSV(j));
    assert.doesNotThrow(() => parsePasted(j));
    assert.doesNotThrow(() => monthSpanOf(j));
    assert.doesNotThrow(() => sha256(j));
    assert.doesNotThrow(() => verifyFindings(j));
  }
  assert.equal(analyze(null).ok, true);          // empty but valid
  assert.equal(analyze(null).findings.length, 0);
});

// ══════════════════════════════════════════════════════════════════════════
// KILL-CRAFT — boundary probes, forged rows, and a pinned seal
// ══════════════════════════════════════════════════════════════════════════

test('parseCSV: a data row is not mistaken for a header just because it says "date"', () => {
  // "my date note" contains the word date but no amount/debit column → NOT a header, must be parsed
  const rows = parseCSV('my date note,Some Vendor,-5.00');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, -5);
});
test('parseCSV: a headerless 2-cell desc,amount row is kept (kills cells.length<2 → <=2)', () => {
  const rows = parseCSV('Tesco,-5.00');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].description, 'Tesco');
  assert.equal(rows[0].amount, -5);
});
test('parseCSV: the first date/amount/desc cell wins, not a later one', () => {
  assert.equal(parseCSV('2026-01-01,15/02/2026,-5')[0].date, '2026-01-01'); // 2nd date cell is desc, not date
  assert.equal(parseCSV('2026-01-01,-5,-10')[0].amount, -5);                // 2nd money cell is desc, not amount
});
test('parseCSV: a row with no amount, or an empty description, is not a transaction', () => {
  assert.equal(parseCSV('2026-01-01,NETFLIX').length, 0);   // desc but no amount
  assert.equal(parseCSV('2026-01-01,,-5').length, 0);       // amount but empty desc
});
test('parsePasted: a 2-token "vendor amount" line is parsed (kills parts.length>=2 → >2)', () => {
  const rows = parsePasted('Vendor -5.00');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, -5);
});

test('parseDateDay: 2-digit year → +2000, 3-digit year stays literal (kills the <100 boundary)', () => {
  assert.equal(parseDateDay('15/01/26'), parseDateDay('2026-01-15'));          // DD/MM, 26 → 2026
  assert.notEqual(parseDateDay('15/01/100'), parseDateDay('15/01/2100'));      // DD/MM, 100 stays 100
  assert.notEqual(parseDateDay('15 Jan 100'), parseDateDay('15 Jan 2100'));    // DD Mon, 100 stays 100
});

test('monthSpanOf: exactly 2 far-apart dates compute the span; invalid dates are dropped', () => {
  assert.equal(monthSpanOf([{ date: '2026-01-01' }, { date: '2026-04-01' }]), 3);              // 90 days / 30 (kills <2 → <=2)
  assert.equal(monthSpanOf([{ date: '2026-01-01' }, { date: 'junk' }, { date: '2026-04-01' }]), 3); // junk filtered (kills !==null → ===, && → ||)
});

test('detectFindings: a valid+invalid mix keeps only valid txns (kills the filter && → ||)', () => {
  const f = detectFindings([
    { date: '2026-01-01', description: 'ACMECORP', amount: -10 },
    { date: '2026-02-01', description: 'ACMECORP', amount: -10 },
    { date: '2026-03-01', description: 'ACMECORP', amount: 'bad' }, // dropped → group stays clean → recurring
  ], '£');
  assert.equal(f.length, 1);
});
test('detectFindings: a POSITIVE overdraft (a refund) is not scanned as a fee (kills Pass-2 || → &&)', () => {
  assert.equal(detectFindings([{ date: '2026-01-01', description: 'OVERDRAFT REFUND', amount: 35 }], '£').length, 0);
});
test('detectFindings: the currency default fills a note when currency is falsy (kills str()||£ → &&)', () => {
  const hike = [{ date: '2026-01-01', description: 'GYMX', amount: -20 }, { date: '2026-02-01', description: 'GYMX', amount: -20 }, { date: '2026-03-01', description: 'GYMX', amount: -30 }];
  assert.match(detectFindings(hike, '').find(f => f.type === 'price_hike').note, /£/);
});

test('totalsOf: totalAnnual is the real sum, not zero (kills reduce || → &&)', () => {
  const t = totalsOf(detectFindings(parseCSV(STMT), '£'));
  assert.ok(t.totalAnnual > 700);
  assert.equal(t.totalAnnual, round2(t.annualSavings + t.disputable + detectFindings(parseCSV(STMT), '£').filter(f => f.type === 'bank_fee').reduce((s, f) => s + f.annual, 0)));
});
function round2(n) { return Math.round(n * 100) / 100; }

test('analyze: currency default flows through to notes (kills analyze str()||£ → &&)', () => {
  const hike = [{ date: '2026-01-01', description: 'GYMX', amount: -20 }, { date: '2026-02-01', description: 'GYMX', amount: -20 }, { date: '2026-03-01', description: 'GYMX', amount: -30 }];
  assert.match(analyze({ txns: hike, currency: '' }).findings.find(f => f.type === 'price_hike').note, /£/);
});

// ⚑ the receipt binds the EXACT findings+totals+statement — pin the seal so any change to the
// sealed body (summary rows, totals, statement hash) is caught. Kills the whole seal-construction path.
test('sealFindings: the seal and statementHash are pinned for the fixed statement', () => {
  const r = analyze({ txns: parseCSV(STMT), currency: '£' });
  assert.equal(r.receipt.statementHash, 'bf09136ea8a27d4f6090864bddcc934c1a84202c86396f3cd4b3734a84448387');
  assert.equal(r.receipt.seal, '00fe19af944df99854fad7bc2d170672ef1d7fda38cba6d531e898ff59513489');
  assert.equal(verifyFindings(r.receipt).ok, true);
});
test('sealFindings: a non-numeric amount hashes as 0, not itself (kills statementHash t && number → ||)', () => {
  const a = sealFindings([], [{ date: 'd', description: 'x', amount: 'notnum' }], '£').statementHash;
  const b = sealFindings([], [{ date: 'd', description: 'x', amount: 0 }], '£').statementHash;
  assert.equal(a, b, 'a garbage amount is sanitised to 0 before hashing');
});
test('sealFindings: the receipt records the currency, defaulting a falsy one to £ (kills body currency || → &&)', () => {
  assert.equal(sealFindings([], [], '').currency, '£');
  assert.equal(sealFindings([], [], '$').currency, '$');
});
