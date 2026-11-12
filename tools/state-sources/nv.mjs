/* Nevada, plan year 2027: every on-exchange individual silver plan, from the
 * Division of Insurance's health rate search (approved rates).
 *
 *   node tools/state-sources/nv.mjs
 *
 * The only primary source is the Division's Oracle APEX application
 *   https://di.nv.gov/nv/r/doi/insurance-rates/health-insurance-rates
 * Its report export works only inside a browser session (the session id in the
 * URL is refused without the session cookie), so this script cannot download
 * it; it parses CSVs saved from a browser. How they were made, on 11 November 2026:
 *
 *   1. Open the page above. Set Carrier = Show All, County = Show All,
 *      Plan Year = 2027, Type = Individual, Metal = Silver,
 *      On The Exchange = "Yes, On the Exchange", HSA = All.
 *   2. For each age (21, 40, "64 and over"): set Age, store it in session state,
 *      then fetch the report's CSV in the same session:
 *        apex.item('P2_AGE').setValue(age);
 *        await apex.server.process('X', { pageItems: '#P2_AGE' }, { dataType: 'text' }).catch(() => {});
 *        await (await fetch(location.pathname + '?session=' + apex.env.APP_SESSION + '&request=CSV')).text();
 *      (the same bytes as Actions > Download > CSV; the HTML and Excel downloads
 *      hold the same two decimal text, and an interactive report filter shows the
 *      Rate column is itself formatted text, so no export has more digits).
 *      Save each response unchanged as
 *        tools/cache/2027/states/nv/nv-2027-silver-onexchange-age21.csv
 *        tools/cache/2027/states/nv/nv-2027-silver-onexchange-age40.csv
 *        tools/cache/2027/states/nv/nv-2027-silver-onexchange-age64.csv
 *      SHA-256 of the files saved on 11 November 2026 (716 rows each):
 *        age21 39e3a5469d180da135b469e851e2887f640ee8268bdf1e7274d1de0e1ed7cdd3
 *        age40 c9bcf4d56ea5040460922a402b801f6ae9b6b87c0bd8922dfb4d7cc063f1a19f
 *        age64 015b318a149e0d25608a0ce15f91c71df96b499566074702f1518871ed4064e7
 *
 * In the same session all 51 age tables (0-14, 15 .. 63, 64 and over) were read
 * and compared in the browser: every published premium is within 5 cents of the
 * age 21 premium times the federal default age factor (largest factor deviation
 * 0.00011), so the age 21 table plus the federal curve is used, and this script
 * re-checks ages 40 and 64 from the saved files.
 *
 * The CSV has no plan ID. Most plans are listed twice with identical name and
 * rate; the Division's detail pages for sampled pairs show one plan ID for both
 * (for example 35107NV0010009 twice in Mineral), so rows are deduplicated on
 * carrier, plan name, county and rate.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { stateDir, counties, writeState, fail, log, norm, FED_CURVE, CACHE } from './lib.mjs';

const ST = 'NV';
const PAGE = 'https://di.nv.gov/nv/r/doi/insurance-rates/health-insurance-rates';
const DIR = stateDir(ST);
const FILES = { 21: 'nv-2027-silver-onexchange-age21.csv', 40: 'nv-2027-silver-onexchange-age40.csv', 64: 'nv-2027-silver-onexchange-age64.csv' };
for (const f of Object.values(FILES)) if (!existsSync(join(DIR, f)))
  fail(ST, 'missing ' + join(DIR, f) + '. Export it from ' + PAGE + ' in a browser as described at the top of tools/state-sources/nv.mjs.');

/* ---- CMS rating areas ---- */
const C = counties(ST);
const areaOf = {};
{
  const html = readFileSync(join(CACHE, '..', 'gra', 'nv.html'), 'utf-8');
  const table = (html.match(/<table[\s\S]*?<\/table>/) || [])[0];
  if (!table) fail(ST, 'no table on the cached CMS nv-gra page');
  for (const tr of table.match(/<tr[\s\S]*?<\/tr>/g).slice(1)) {
    const cells = (tr.match(/<t[dh][\s\S]*?<\/t[dh]>/g) || []).map(c => c.replace(/<[^>]+>|&nbsp;/g, ' ').replace(/\s+/g, ' ').trim());
    const ra = parseInt((cells[0].match(/Rating Area (\d+)/) || [])[1], 10);
    if (!Number.isFinite(ra)) continue;
    let f;
    try { f = C.fipsOf(cells[1]); } catch (e) { fail(ST, e.message); }
    if (areaOf[f]) fail(ST, cells[1] + ' twice on nv-gra');
    areaOf[f] = ra;
  }
  const missing = C.all.filter(f => !areaOf[f]);
  if (missing.length || C.all.length !== 17) fail(ST, 'nv-gra does not cover the 17 counties: ' + missing.join(' '));
}

/* ---- the CSVs ---- */
const HEADER = 'Carrier,Plan Name,Metal Tier,Exchange,HSA,County,Partial,Rate,Med Deductible,Rx Deductible';
function parseCsv(text) {
  const lines = text.replace(/\s+$/, '').split('\n');
  if (lines[0].trim() !== HEADER) fail(ST, 'CSV header changed: ' + lines[0]);
  return lines.slice(1).map(line => {
    const f = []; let cur = '', q = false;
    for (const ch of line) {
      if (ch === '"') { q = !q; continue; }
      if (ch === ',' && !q) { f.push(cur); cur = ''; continue; }
      cur += ch;
    }
    f.push(cur);
    if (f.length !== 10) fail(ST, 'CSV row with ' + f.length + ' fields: ' + line);
    return f.map(s => s.trim());
  });
}
const money = s => {
  if (!/^\$\d{1,3}(,\d{3})*\.\d{2}$/.test(s)) fail(ST, 'rate "' + s + '" is not dollars and cents');
  return +s.replace(/[$,]/g, '');
};
const tables = {};       // age -> { "carrier|plan|fips": rate }
const partialSeen = {};  // "carrier|plan" -> Set(fips)
for (const [age, file] of Object.entries(FILES)) {
  const raw = readFileSync(join(DIR, file));
  log('  ' + file + ' sha256 ' + createHash('sha256').update(raw).digest('hex'));
  const t = {};
  for (const r of parseCsv(raw.toString('utf-8'))) {
    const [carrier, plan, metal, exch, , county, partial, rate] = r;
    if (metal !== 'Silver' || exch !== 'Yes') fail(ST, file + ': row is ' + metal + ' / exchange ' + exch + ', not the Silver on-exchange filter');
    let fips;
    try { fips = C.fipsOf(county); } catch (e) { fail(ST, e.message); }
    const k = carrier + '|' + plan + '|' + fips, v = money(rate);
    if (t[k] != null && t[k] !== v) fail(ST, file + ': ' + k + ' listed at ' + t[k] + ' and ' + v);
    t[k] = v;
    if (partial) (partialSeen[carrier + '|' + plan] ||= new Set()).add(fips);
  }
  tables[age] = t;
}
const keys = Object.keys(tables[21]).sort();
for (const age of [40, 64]) {
  const k2 = Object.keys(tables[age]).sort();
  if (k2.join('\n') !== keys.join('\n')) fail(ST, 'age ' + age + ' lists different plans or counties than age 21');
  let worst = 0;
  for (const k of keys) {
    const d = Math.abs(tables[age][k] - Math.round(tables[21][k] * FED_CURVE[age] * 100) / 100);
    worst = Math.max(worst, d);
    if (d > 0.05 + 1e-9) fail(ST, k + ' age ' + age + ' is ' + tables[age][k] + ', the federal curve gives ' + (tables[21][k] * FED_CURVE[age]).toFixed(2));
  }
  log('  age ' + age + ': every premium within ' + worst.toFixed(2) + ' of age 21 times the federal factor');
}

/* ---- plans, with one rate per rating area ---- */
const byPlan = {};
for (const k of keys) {
  const [carrier, plan, fips] = k.split('|');
  const p = byPlan[carrier + '|' + plan] ||= { carrier, plan, counties: [], rates: {} };
  p.counties.push(fips);
  const ra = String(areaOf[fips]);
  if (p.rates[ra] != null && p.rates[ra] !== tables[21][k]) fail(ST, carrier + ' ' + plan + ': counties of area ' + ra + ' differ (' + p.rates[ra] + ' vs ' + tables[21][k] + ' in ' + C.nameOf(fips) + ')');
  p.rates[ra] = tables[21][k];
}
const plans = Object.values(byPlan).map(p => {
  const out = { id: 'NV:' + p.carrier + ':' + p.plan, issuer: p.carrier, name: p.plan,
    counties: p.counties.length === 17 ? 'all' : p.counties.sort(),
    rates: Object.fromEntries(Object.entries(p.rates).map(([ra, v]) => [ra, { at: 21, premium: v }])) };
  const part = partialSeen[p.carrier + '|' + p.plan];
  if (part) out.partial = [...part].sort();
  return out;
});
const partialAny = Object.keys(partialSeen).length;
// a plan sold in only some counties of an area is fine (it is listed per county);
// say how often that happens
const splitAreas = plans.filter(p => p.counties !== 'all' && Object.keys(p.rates).some(ra =>
  C.all.filter(f => areaOf[f] === +ra).some(f => !p.counties.includes(f)))).length;

/* ---- samples ---- */
for (const [name, fips] of [['Clark', '32003'], ['Nye', '32023'], ['Washoe', '32031'], ['Carson City', '32510'], ['Elko', '32007'], ['Esmeralda', '32009']]) {
  const ra = String(areaOf[fips]);
  const v = plans.filter(p => (p.counties === 'all' || p.counties.includes(fips)) && p.rates[ra])
    .map(p => ({ p, v: p.rates[ra].premium })).sort((a, b) => a.v - b.v);
  log('  ' + name + ' (area ' + ra + ', ' + v.length + ' plans): age 21 lowest ' + v[0].v + ', SLCSP ' + v[1].v + ' (' + v[1].p.issuer + ', ' + v[1].p.name + '); age 40 SLCSP ' + (v[1].v * FED_CURVE[40]).toFixed(2));
}
log('  ' + plans.length + ' plans from ' + keys.length + ' plan and county pairs; ' + splitAreas + ' plans are sold in only part of a rating area');

writeState({
  state: ST, planYear: 2027, kind: 'plans', final: true, precision: 'cents',
  sources: [
    { title: 'Nevada Division of Insurance, Health Insurance Rates search (plan year 2027, individual, silver, on the exchange), CSV exports for ages 21, 40 and 64 and over, read 11 November 2026', url: PAGE, published: '2026-10-01' },
    { title: 'CMS, Nevada geographic rating areas', url: 'https://www.cms.gov/cciio/programs-and-initiatives/health-insurance-market-reforms/nv-gra' }
  ],
  notes: [
    'Nevada rates are the Division of Insurance\'s approved 2027 individual premiums, read from its public rate search with the filters plan year 2027, individual, silver and on the exchange, for every county.',
    'The search lists premiums for one age at a time. All 51 age tables were read and every premium is within 5 cents of the age 21 premium times the federal default age factor, so the age 21 premiums are stored with the federal curve; ages 40 and 64 are rechecked from saved copies on every build.',
    'The Division publishes premiums in dollars and cents, and its CSV, HTML and Excel exports carry the same two decimal text as the page, so the premiums are used exactly as published. If the filed rates carry more decimals, the page may cut them off rather than round them, so a premium here can be up to one cent below the filed rate; no Division source shows the extra digits.',
    'The search gives no plan ID, and most plans appear twice with the same name and premium. The Division\'s own detail pages show one plan ID for both copies, so each plan is counted once, identified by carrier and plan name.',
    'Counties map to CMS\'s four Nevada rating areas, and every plan has the same premium in each county of an area where it is sold.',
    partialAny ? 'The search marks ' + partialAny + ' plans as serving only part of some counties; they are listed as partial there.'
               : 'The search\'s Partial column is empty for every 2027 silver plan, so no plan is marked as serving only part of a county.',
    'No published 2027 Nevada benchmark premium was found to check these figures against.'
  ],
  statewide: false,
  plans,
  curve: 'fed',
  checks: []
});
