/* Connecticut, plan year 2027: the exchange's own commissioned report.
 *
 * Wakely, "PY2027 AHCT Consumer Impact Full Report" (27 Oct 2026), prepared for
 * Access Health CT from the final rate filings as of September 2026 (the
 * Connecticut Insurance Department announced its final decisions on 11 Sep 2026).
 * Page 52, "Change in Benchmark Plan", prints the 2027 second lowest silver plan
 * per county at the age 21 rate, to the cent. Pages 57 to 59 print the same
 * benchmark for three personas, aged one year for 2027, to the dollar: those are
 * the checks.
 *
 *   node tools/state-sources/ct.mjs
 */
import { fetchCached, pdfText, counties, writeState, fail, log, FED_CURVE } from './lib.mjs';

const ST = 'CT';
const URL = 'https://agency.accesshealthct.com/wp-content/uploads/2026/11/PY2027-AHCT-Consumer-Impact-Full-Report-2026.10.27.pdf';
const SRC = 'Wakely for Access Health CT, PY2027 AHCT Consumer Impact Full Report (27 Oct 2026)';

const pdf = fetchCached(ST, URL, 'PY2027-AHCT-Consumer-Impact-Full-Report-2026.10.27.pdf');
const pages = pdfText(pdf).split('\f');
const pageNo = p => { const m = p.match(/Page\s+(\d+)\s*$/); return m ? +m[1] : null; };

const cty = counties(ST);
if (cty.all.length !== 8) fail(ST, 'expected the 8 legacy counties in the Census file, got ' + cty.all.length);

/* ---- page 52: the benchmark per county, age 21 ---- */
const bp = pages.filter(p => /Change in Benchmark Plan/.test(p) && /2027 Second/.test(p) && /Age 21 Rate/.test(p));
if (bp.length !== 1) fail(ST, 'expected one "Change in Benchmark Plan" page, found ' + bp.length);
if (pageNo(bp[0]) !== 52) fail(ST, 'the benchmark table moved off page 52 (now ' + pageNo(bp[0]) + ')');

const rowRe = /^\s*([A-Z][a-z]+(?: [A-Z][a-z]+)?)\s{2,}(\S+)\s+(.+?)\s{2,}(\S+)\s+(.+?)\s{2,}\$([\d,]+\.\d\d)\s+\$([\d,]+\.\d\d)\s+([\d,]+)\s+(-?[\d.]+)%\s*$/;
const out = {};
for (const line of bp[0].split('\n')) {
  const m = line.match(rowRe);
  if (!m) continue;
  const [, name, , , issuer27, plan27, p26, p27, , pct] = m;
  const fips = cty.fipsOf(name);
  if (out[fips]) fail(ST, 'county listed twice: ' + name);
  const v26 = +p26.replace(/,/g, ''), v27 = +p27.replace(/,/g, '');
  // the printed change must agree with the two printed premiums
  if (Math.abs((v27 / v26 - 1) * 100 - +pct) > 0.051) fail(ST, name + ': printed change ' + pct + '% disagrees with ' + v26 + ' to ' + v27);
  out[fips] = { premium: v27, plan: issuer27 + ' ' + plan27.trim() };
}
const missing = cty.all.filter(f => !out[f]);
if (missing.length) fail(ST, 'no benchmark parsed for ' + missing.map(cty.nameOf).join(', '));

/* the figures as read when this extractor was written; a changed report must be re-read */
const EXPECT = { Fairfield: 843.71, Hartford: 720.95, Litchfield: 779.51, Middlesex: 778.96,
  'New Haven': 778.96, 'New London': 779.51, Tolland: 779.51, Windham: 779.51 };
for (const [n, v] of Object.entries(EXPECT)) {
  const got = out[cty.fipsOf(n)].premium;
  if (got !== v) fail(ST, n + ': parsed ' + got + ', expected ' + v);
  if (out[cty.fipsOf(n)].plan !== 'CBI Choice Silver Standard POS') fail(ST, n + ': benchmark plan is now ' + out[cty.fipsOf(n)].plan);
}

/* ---- pages 57 to 59: benchmark before subsidy for the personas ---- */
const checks = [];
const personas = [
  { page: 57, head: /Single,\s+Age 28/, age: 29, factor: 1, who: 'Household #1, single age 28 in 2026, priced at 29' },
  { page: 58, head: /Single,\s+Age 44/, age: 45, factor: 1, who: 'Household #2, single age 44 in 2026, priced at 45' },
  { page: 59, head: /Couple,\s+Age 50/, age: 51, factor: 2, who: 'Household #3, couple both age 50 in 2026, priced at 51 each' },
];
for (const ps of personas) {
  const pg = pages.find(p => pageNo(p) === ps.page);
  if (!pg || !ps.head.test(pg) || !/Benchmark \(SLC Silver\) Premium Before Subsidy/.test(pg)) fail(ST, 'persona page ' + ps.page + ' is not where it was');
  let n = 0;
  for (const line of pg.split('\n')) {
    const m = line.match(/^\s*([A-Z][a-z]+(?: [A-Z][a-z]+)?)\s{2,}\d+%\s+\$([\d,]+)\s+\$([\d,]+)\s/);
    if (!m || m[1] === 'TOTAL') continue;
    const fips = cty.fipsOf(m[1]), v = +m[3].replace(/,/g, '');
    // sanity inside the report: the persona figure is the age 21 benchmark on the federal curve
    const implied = out[fips].premium * FED_CURVE[ps.age] * ps.factor;
    if (Math.abs(implied - v) > 1) fail(ST, 'page ' + ps.page + ' ' + m[1] + ': printed ' + v + ', age 21 benchmark on the federal curve gives ' + implied.toFixed(2));
    checks.push({ what: 'slcsp', fips, age: ps.age, ...(ps.factor !== 1 ? { factor: ps.factor } : {}), premium: v,
      source: SRC + ', p. ' + ps.page + ', ' + ps.who + ', 2027 benchmark (SLC Silver) premium before subsidy, whole dollars' });
    n++;
  }
  if (n !== 8) fail(ST, 'page ' + ps.page + ': expected 8 counties, parsed ' + n);
}
const spot = (n, age) => checks.find(c => c.fips === cty.fipsOf(n) && c.age === age).premium;
if (spot('Fairfield', 29) !== 944 || spot('Hartford', 29) !== 807 || spot('Litchfield', 29) !== 872) fail(ST, 'age 29 persona figures changed');
if (spot('Fairfield', 45) !== 1218 || spot('Hartford', 45) !== 1041) fail(ST, 'age 45 persona figures changed');

log('  ' + Object.keys(out).length + ' counties; Hartford ' + out['09003'].premium + ' at 21');
writeState({
  state: ST, planYear: 2027, kind: 'slcsp', final: true, precision: 'cents',
  sources: [
    { title: SRC + ', p. 52 Change in Benchmark Plan, pp. 57 to 59 persona benchmarks', url: URL, published: '2026-10-27' },
    { title: 'Connecticut Insurance Department, 2027 health insurance rate decisions (press release)', url: 'https://portal.ct.gov/cid/press-releases/2026-press-releases/2026-09-11-health-insurance-rate-decision-for-2027', published: '2026-09-11' },
  ],
  notes: [
    'Connecticut\'s 2027 benchmark comes from a report Access Health CT commissioned from the actuarial firm Wakely, which priced the second lowest cost silver plan in each county from the final rate filings as of September 2026. The Connecticut Insurance Department announced its final 2027 rate decisions on 11 September 2026.',
    'The report prints the benchmark at the age 21 rate only. Other ages here apply the federal default age curve, and the report\'s own persona figures at ages 29, 45 and 51 match that curve to the dollar in every county.',
    'The benchmark plan is ConnectiCare Benefits (CBI) Choice Silver Standard POS in all eight counties. Counties are Connecticut\'s eight legacy counties, which the exchange still uses for rating.',
  ],
  age: 21, curve: 'fed', counties: out, checks,
});
