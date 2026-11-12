/* Minnesota, plan year 2027: Commerce's own benchmark table.
 *
 * Minnesota Department of Commerce, "Plan Year 2027 Individual Market Rate
 * Charts Supplemental Table" (PDF created 28 Sep 2026, with the final rates):
 * all 87 counties, the second lowest cost silver plan premium for a 40 year old,
 * monthly, to the cent. Commerce's 2027 county map of the same figures is titled
 * for a 40 year old who buys the second lowest cost silver plan on MNsure.
 *
 * The table's second column (a 40 year old with one child under 18) is not used
 * for the curve: it is higher than the child age factor alone gives in most
 * counties, for reasons the table does not state.
 *
 *   node tools/state-sources/mn.mjs
 */
import { fetchCached, pdfText, counties, writeState, fail, log, FED_CURVE } from './lib.mjs';

const ST = 'MN';
const URL = 'https://mn.gov/commerce-stat/insurance/rates/2027/Rate%20Sheet%20Supplemental%20Table.pdf';
const SRC = 'Minnesota Department of Commerce, Plan Year 2027 Individual Market Rate Charts Supplemental Table (28 Sep 2026)';

/* Minnesota's age curve: 0.890 for ages 0 to 20, the federal default from 21 up.
 * This is the curve in the CMS 2026 rate files for every Minnesota silver plan
 * (src/benchmarks.js curves.mn) and the Minnesota row of CMS's state specific age
 * curve table. No 2027 Minnesota publication restating it was found (Minn. Stat.
 * 62A.65 subd. 3 defers age rating to the ACA). */
const CHILD = 0.890;
const CURVE = FED_CURVE.map((v, a) => (a <= 20 ? CHILD : v));

const cty = counties(ST);
if (cty.all.length !== 87) fail(ST, 'expected 87 counties in the Census file, got ' + cty.all.length);
const ALIAS = { 'Saint Louis': 'St. Louis' };

const pdf = fetchCached(ST, URL, 'Rate_Sheet_Supplemental_Table.pdf');
const text = pdfText(pdf);
if (!/Plan Year 2027 Individual Market Rate Charts Supplemental Table/.test(text)) fail(ST, 'not the 2027 supplemental table');
const flat = text.replace(/\s+/g, ' ');
if (!/Second Lowest-Cost Silver/.test(flat) || !/Premium for a 40-year-/.test(flat) || !/one child under 18/.test(flat))
  fail(ST, 'the benchmark column is no longer headed for a 40 year old');

const out = {}, childRatio = {};
for (const line of text.split('\n')) {
  // carrier names as Commerce abbreviates them; a county name is everything before them
  const C = '(?:Aspirus|Blue Plus|HP Inc|HPIC|MIC|Quartz)';
  const m = line.match(new RegExp('^(\\S.*?)\\s+(' + C + '(?:, ' + C + ')*)\\s+(\\d)\\s+\\$\\s+([\\d,]+\\.\\d\\d)\\s+\\$\\s+([\\d,]+\\.\\d\\d)\\s*$'));
  if (!m) { if (/\$\s+\d/.test(line)) fail(ST, 'unread line: ' + line.trim()); continue; }
  const [, name, carriers, n, p40, pKid] = m;
  if (carriers.split(',').length !== +n) fail(ST, name + ': carrier count ' + n + ' disagrees with "' + carriers + '"');
  const fips = cty.fipsOf(ALIAS[name] || name);
  if (out[fips]) fail(ST, 'county twice: ' + name);
  const v = +p40.replace(/,/g, ''), k = +pKid.replace(/,/g, '');
  out[fips] = { premium: v };
  childRatio[fips] = (k - v) / (v / CURVE[40]);
}
const missing = cty.all.filter(f => !out[f]);
if (missing.length) fail(ST, 'no benchmark for ' + missing.map(cty.nameOf).join(', '));

/* the figures as read when this extractor was written */
const EXPECT = { Hennepin: 482.92, 'St. Louis': 535.80, Aitkin: 573.02, Olmsted: 699.42, Fillmore: 653.29 };
for (const [n, v] of Object.entries(EXPECT)) if (v != null && out[cty.fipsOf(n)].premium !== v) fail(ST, n + ': parsed ' + out[cty.fipsOf(n)].premium + ', expected ' + v);

/* the child column can never be below the child factor's share; note where it equals it */
const exact = [];
for (const [f, r] of Object.entries(childRatio)) {
  if (r < CHILD - 0.0015) fail(ST, cty.nameOf(f) + ': the 40 year old with a child figure implies a child factor of ' + r.toFixed(4) + ', below ' + CHILD);
  if (Math.abs(r - CHILD) < 0.0015) exact.push(cty.nameOf(f).replace(/ County$/, ''));
}
const hi = Math.max(...Object.values(childRatio));

log('  87 counties; Hennepin ' + out[cty.fipsOf('Hennepin')].premium + ', St. Louis ' + out[cty.fipsOf('St. Louis')].premium + ' at 40; child column equals ' + CHILD + ' in ' + exact.join(', '));
writeState({
  state: ST, planYear: 2027, kind: 'slcsp', final: true, precision: 'cents',
  sources: [
    { title: SRC, url: URL, published: '2026-09-28' },
    { title: 'Minnesota Department of Commerce, 2027 individual market maps (second lowest cost silver plan on MNsure, 40 year old)', url: 'https://mn.gov/commerce/insurance/health/consumer-protections/rates/maps/2027/', published: '2026-09-28' },
  ],
  notes: [
    'Minnesota\'s 2027 benchmark comes from the Department of Commerce\'s supplemental table to the final 2027 individual market rate charts, which prints the second lowest cost silver plan premium for a 40 year old in each of the 87 counties. Commerce\'s county map of the same figures describes them as the second lowest cost silver plan on MNsure, and notes they reflect Minnesota\'s reinsurance program.',
    'The table is priced at age 40 only. Other ages use Minnesota\'s own age curve: 0.890 for every age from 0 to 20 and the federal default from 21 up. That is the curve every Minnesota silver plan used in the CMS 2026 rate files; no 2027 Minnesota publication restating it was found, so it is carried forward from 2026.',
    'The table\'s second column, a 40 year old with one child under 18, is not used for the curve. In ' + exact.slice(0, -1).join(', ') + (exact.length > 1 ? ' and ' : '') + exact.slice(-1) + (exact.length > 1 ? ' counties' : ' County') + ' the child\'s share equals exactly 0.890 times the age 21 rate; elsewhere it is up to ' + Math.round((hi / CHILD - 1) * 100) + ' percent higher, for reasons the table does not state.',
  ],
  age: 40, curve: CURVE, counties: out, checks: [],
});
