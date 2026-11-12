/* District of Columbia, plan year 2027: DISB's approved individual rates.
 *
 * DISB, "January 2027 Rates for Health Insurance Products - Individual FINAL"
 * (18 Sep 2026): for each carrier, product type (INS, HMO) and metal, the plan
 * count and the low, high and average monthly premium at ages 27, 40 and 55, in
 * whole dollars. DC is one rating area with five individual silver plans:
 * CareFirst INS 1, CareFirst HMO 1, Kaiser HMO 3.
 *
 * Why the benchmark is determined without a model:
 *  - a cell holding one plan prints that plan's premium (low = high = average);
 *  - "Average" is the plain mean of the cell's plans: every two-plan cell in the
 *    table sits at the midpoint of its low and high to within rounding (checked
 *    below, every one of them);
 *  - so Kaiser's middle silver plan is 3 x average - low - high, to within the
 *    rounding of three printed figures, and at every age it lies above
 *    CareFirst's HMO silver. The lowest silver is Kaiser's low plan, and the
 *    second lowest is CareFirst's single HMO silver plan, printed exactly.
 *
 *   node tools/state-sources/dc.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchCached, stateDir, counties, writeState, fail, log } from './lib.mjs';

const ST = 'DC';
const HERE = dirname(fileURLToPath(import.meta.url));
const URL = 'https://disb.dc.gov/sites/default/files/2026-09/2027ApprovedIndividualRates.pdf';
const YOY = 'https://disb.dc.gov/sites/default/files/2026-09/2027ComparisonYearOverYearRateChangesApproved.pdf';
const PUF26 = 'https://www.cms.gov/files/zip/districtofcolumbiapuf2026.zip';
const SRC = 'DC Department of Insurance, Securities and Banking, January 2027 Rates for Health Insurance Products, Individual, FINAL (18 Sep 2026)';
const AGES = [27, 40, 55];

/* ---- words with their boxes ---- */
const pdf = fetchCached(ST, URL, '2027ApprovedIndividualRates.pdf');
const bbox = execFileSync('pdftotext', ['-bbox', pdf, '-'], { maxBuffer: 1 << 26 }).toString();
const words = [...bbox.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)]
  .map(m => ({ x0: +m[1], y: +m[2], x1: +m[3], s: m[5].replace(/&amp;/g, '&') }));
const flat = words.map(w => w.s).join(' ');
if (!/January 2027 Rates for Health Insurance Products - Individual FINAL/.test(flat)) fail(ST, 'not the final 2027 individual rate table');

/* header: Plans / Low / High / Average for each metal, by right edge */
const metalsH = ['Catastrophic', 'Bronze', 'Silver', 'Gold', 'Platinum'].map(m => {
  const w = words.find(x => x.s === m); if (!w) fail(ST, 'no ' + m + ' heading'); return { m, c: (w.x0 + w.x1) / 2 };
});
const hdrY = words.find(w => w.s === 'Average').y;
const hdr = words.filter(w => Math.abs(w.y - hdrY) < 2 && ['Plans', 'Low', 'High', 'Average'].includes(w.s)).sort((a, b) => a.x1 - b.x1);
if (hdr.length !== 20) fail(ST, 'expected 20 Plans/Low/High/Average headings, found ' + hdr.length);
const cols = hdr.map((w, i) => ({ metal: metalsH[Math.floor(i / 4)].m, field: w.s, x1: w.x1 }));
for (let k = 0; k < 5; k++) if (cols.slice(4 * k, 4 * k + 4).map(c => c.field).join() !== 'Plans,Low,High,Average') fail(ST, 'heading order under ' + metalsH[k].m);

/* data rows: a product type at the left, then figures */
const rows = [];
for (const t of words.filter(w => (w.s === 'INS' || w.s === 'HMO') && w.x0 < 220 && w.y > hdrY)) {
  const cells = words.filter(w => Math.abs(w.y - t.y) < 2 && w.x0 > 225 && w.x1 < 1040);
  if (!cells.some(w => /^\$|#REF!/.test(w.s))) continue;   // the plan-count summary rows carry no premiums
  const row = { type: t.s, y: t.y, v: {} };
  for (const w of cells) {
    const c = cols.reduce((b, k) => Math.abs(k.x1 - w.x1) < Math.abs(b.x1 - w.x1) ? k : b);
    if (Math.abs(c.x1 - w.x1) > 15) fail(ST, 'figure "' + w.s + '" at x ' + w.x1 + ' fits no column');
    const key = c.metal + '.' + c.field;
    if (row.v[key] != null) fail(ST, 'two figures in ' + key + ' at y ' + t.y);
    row.v[key] = w.s;
  }
  rows.push(row);
}
rows.sort((a, b) => a.y - b.y);
if (rows.length !== 12) fail(ST, 'expected 12 carrier rows, found ' + rows.length);
const ageLabels = words.filter(w => w.x1 < 185 && /^(27|40|55)$/.test(w.s)).sort((a, b) => a.y - b.y);
const carrierLabels = words.filter(w => w.x1 < 185 && /^(CareFirst|Kaiser)$/.test(w.s)).sort((a, b) => a.y - b.y).map(w => w.s);
if (ageLabels.map(w => w.s).join() !== '27,40,55,27,40,55' || carrierLabels.join() !== 'CareFirst,Kaiser') fail(ST, 'row labels moved');
rows.forEach((r, i) => {
  r.carrier = i < 6 ? 'CareFirst' : 'Kaiser';
  r.age = +ageLabels.reduce((b, w) => Math.abs(w.y - r.y) < Math.abs(b.y - r.y) ? w : b).s;
  if (r.age !== AGES[Math.floor((i % 6) / 2)] || r.type !== (i % 2 ? 'HMO' : 'INS')) fail(ST, 'row ' + i + ' is ' + r.carrier + ' ' + r.type + ' ' + r.age);
});
const money = s => /^\$[\d,]+$/.test(s || '') ? +s.slice(1).replace(/,/g, '') : null;
const cell = (carrier, type, age, metal) => {
  const r = rows.find(x => x.carrier === carrier && x.type === type && x.age === age);
  return { low: money(r.v[metal + '.Low']), high: money(r.v[metal + '.High']), avg: money(r.v[metal + '.Average']) };
};
const count = (carrier, type, metal) => {
  const r = rows.find(x => x.carrier === carrier && x.type === type && x.age === 40);
  return +r.v[metal + '.Plans'];
};

/* ---- plan counts: five silver plans ---- */
const SILVER = [['CareFirst', 'INS', 1], ['CareFirst', 'HMO', 1], ['Kaiser', 'HMO', 3], ['Kaiser', 'INS', 0]];
for (const [c, t, n] of SILVER) if (count(c, t, 'Silver') !== n) fail(ST, c + ' ' + t + ' silver plan count is ' + count(c, t, 'Silver') + ', expected ' + n);

/* ---- "Average" is the plain mean: every two-plan cell sits at its midpoint ---- */
let pairs = 0;
for (const metal of ['Bronze', 'Silver', 'Gold', 'Platinum']) for (const c of ['CareFirst', 'Kaiser']) for (const t of ['INS', 'HMO']) {
  if (count(c, t, metal) !== 2) continue;
  for (const age of AGES) {
    const { low, high, avg } = cell(c, t, age, metal);
    if (low == null || high == null || avg == null) fail(ST, c + ' ' + t + ' ' + metal + ' ' + age + ': missing figure');
    // true values lie within 0.5 of the printed ones
    if (Math.abs((low + high) / 2 - avg) > 1 + 1e-9) fail(ST, c + ' ' + t + ' ' + metal + ' ' + age + ': average ' + avg + ' is not the midpoint of ' + low + ' and ' + high);
    pairs++;
  }
}
if (pairs < 15) fail(ST, 'only ' + pairs + ' two-plan cells to test the averaging on');

/* ---- the benchmark at each age ---- */
const bench = {};
for (const age of AGES) {
  const cfH = cell('CareFirst', 'HMO', age, 'Silver'), cfI = cell('CareFirst', 'INS', age, 'Silver'), kp = cell('Kaiser', 'HMO', age, 'Silver');
  for (const [n, x] of [['CareFirst HMO', cfH], ['CareFirst INS', cfI]]) if (x.low == null || x.low !== x.high || x.high !== x.avg) fail(ST, n + ' silver at ' + age + ' is not one plan: ' + JSON.stringify(x));
  if (kp.low == null || kp.high == null || kp.avg == null) fail(ST, 'Kaiser silver at ' + age + ' incomplete');
  const midLo = 3 * (kp.avg - 0.5) - (kp.low + 0.5) - (kp.high + 0.5), midHi = 3 * (kp.avg + 0.5) - (kp.low - 0.5) - (kp.high - 0.5);
  if (midHi < kp.low - 0.5 || midLo > kp.high + 0.5) fail(ST, 'Kaiser middle silver at ' + age + ' falls outside its own low and high');
  // ordering: Kaiser low < CareFirst HMO < Kaiser middle, Kaiser high, CareFirst INS
  if (!(kp.low + 0.5 < cfH.low - 0.5)) fail(ST, 'at ' + age + ' Kaiser\'s lowest silver ' + kp.low + ' is not clearly below CareFirst HMO ' + cfH.low);
  if (!(cfH.low + 0.5 < Math.max(midLo, kp.low - 0.5))) fail(ST, 'at ' + age + ' Kaiser\'s middle silver (' + midLo.toFixed(1) + ' to ' + midHi.toFixed(1) + ') could be below CareFirst HMO ' + cfH.low);
  if (!(cfH.low + 0.5 < kp.high - 0.5) || !(cfH.low + 0.5 < cfI.low - 0.5)) fail(ST, 'at ' + age + ' the order of the silver plans is not settled');
  bench[age] = { premium: cfH.low, lowest: kp.low, mid: [midLo, midHi] };
}
if (bench[27].premium !== 505 || bench[40].premium !== 678 || bench[55].premium !== 1205 || bench[40].lowest !== 627) fail(ST, 'figures changed: ' + JSON.stringify(bench));

/* ---- DC's age curve: the 2026 CMS rates of the same CareFirst HMO silver plan ---- */
let P = join(HERE, '..', 'cache', 'sbe', 'districtofcolumbiapuf2026', 'DCRates05052026.csv');   // where the 2026 build left it
if (!existsSync(P)) {
  const zip = fetchCached(ST, PUF26, 'districtofcolumbiapuf2026.zip');
  execFileSync('unzip', ['-oq', zip, 'DCRates05052026.csv', '-d', stateDir(ST)]);
  P = join(stateDir(ST), 'DCRates05052026.csv');
}
if (!existsSync(P)) fail(ST, 'the CMS 2026 DC rate file is missing');
const r26 = {};
{
  const lines = readFileSync(P, 'utf-8').replace(/^﻿/, '').split(/\r?\n/);
  const h = lines[0].split(',').map(s => s.replace(/"/g, ''));
  const iP = h.indexOf('PLAN ID'), iA = h.indexOf('AGE'), iR = h.indexOf('INDIVIDUAL RATE');
  for (const l of lines.slice(1)) {
    const v = l.split(',').map(s => s.replace(/"/g, ''));
    if ((v[iP] || '').startsWith('86052DC0400001')) {
      const a = v[iA] === '0-14' ? 0 : v[iA] === '64 and over' ? 64 : +v[iA];
      r26[a] = +v[iR];
    }
  }
}
if (!(r26[0] > 0 && r26[21] > 0 && r26[64] > 0)) fail(ST, '2026 CareFirst HMO silver rates not found');
const curve = Array.from({ length: 65 }, (_, a) => Math.round(1000 * r26[a <= 14 ? 0 : a] / r26[21]) / 1000);
// the 2027 table must fit that curve: a single base premium explains all three
// printed ages. The age 21 base is the middle of the range every printed whole
// dollar allows, so no one printed age's rounding is carried into the others.
let base21;
{
  let lo = -Infinity, hi = Infinity;
  for (const a of AGES) { lo = Math.max(lo, (bench[a].premium - 0.5) / curve[a]); hi = Math.min(hi, (bench[a].premium + 0.5) / curve[a]); }
  if (!(lo <= hi + 0.01)) fail(ST, 'the 2027 benchmark at 27, 40 and 55 does not fit DC\'s 2026 age curve');
  base21 = Math.round((lo + hi) / 2 * 100) / 100;
  log('  age 21 base ' + base21 + ' (every value from ' + lo.toFixed(2) + ' to ' + hi.toFixed(2) + ' prints the three figures)');
}
if (curve[27] !== 1) fail(ST, 'DC curve no longer flat to 27');

const fips = counties(ST).all;
if (fips.length !== 1) fail(ST, 'DC should be one county equivalent');
const checks = AGES.map(age => ({ what: 'slcsp', fips: fips[0], age, premium: bench[age].premium,
  source: SRC + ', CareFirst HMO silver (one plan), age ' + age }));

log('  benchmark CareFirst HMO silver ' + bench[27].premium + ' at 27, ' + bench[40].premium + ' at 40, ' + bench[55].premium + ' at 55; ' + pairs + ' two-plan cells average to their midpoint');
writeState({
  state: ST, planYear: 2027, kind: 'slcsp', final: true, precision: 'dollars',
  sources: [
    { title: SRC, url: URL, published: '2026-09-18' },
    { title: 'DISB, Comparison of Year-over-Year Rate Changes, plans in both 2026 and 2027, approved', url: YOY, published: '2026-09-18' },
    { title: 'CMS, District of Columbia State-based Exchange public use files, plan year 2026 (age curve)', url: PUF26 },
  ],
  notes: [
    'DC\'s 2027 benchmark comes from DISB\'s final 2027 individual rate table, which gives each carrier\'s plan count and the low, high and average premium per product and metal at ages 27, 40 and 55, in whole dollars. DC is one rating area with five individual silver plans: one CareFirst PPO, one CareFirst HMO and three Kaiser HMO.',
    'The second lowest silver plan is CareFirst BlueChoice\'s single HMO silver plan, whose premium the table prints exactly: $505 at 27, $678 at 40, $1,205 at 55. The lowest is Kaiser\'s cheapest silver ($627 at 40). Kaiser\'s other two silver plans sit above CareFirst\'s because the table\'s averages are plain means (every two-plan cell in the table sits at the midpoint of its low and high), which places Kaiser\'s middle plan at about $697 at 40.',
    'The table is priced at three ages. Other ages use DC\'s own age curve as charged by the same CareFirst plan in the CMS 2026 rate files; the 2027 figures at 27, 40 and 55 fit that curve to the dollar, and the base rate used is the middle of the narrow range (under 30 cents at age 21) that prints all three.',
    'DC\'s exchange site sits behind a bot check, so its plan level 2027 premiums were not read.',
  ],
  age: 21, curve, counties: { [fips[0]]: { premium: base21, plan: 'CareFirst BlueChoice HMO silver' } }, checks,
});
