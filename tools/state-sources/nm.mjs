/* New Mexico, plan year 2027: every on-exchange individual silver plan, from the
 * Office of Superintendent of Insurance's approved broker rate sheets.
 *
 *   node tools/state-sources/nm.mjs
 *
 * Source: OSI, "2027 Individual Market Premium Rate sheets" (approved rates,
 * posted September 2026), linked from
 * https://osi.state.nm.us/en/insurance-professionals/life-and-health-division/resource-binder/premium-rate-instructions/
 * One sheet per rating area ("Region 1 Rates" .. "Region 5 Rates"), one column
 * per plan, header rows Company Name .. Smoke Status, then 51 age rows
 * (0-14, 15 .. 63, 64 and over) for non-tobacco and again for tobacco. The
 * "Second Lowest Silver" sheet is OSI's own benchmark by region at ages 21,
 * 40 and 55; every one of those 15 figures is a check.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchCached, xlsxRows, xlsxSheets, counties, writeState, fail, log, norm, CACHE } from './lib.mjs';

const ST = 'NM';
const INDEX = 'https://osi.state.nm.us/en/insurance-professionals/life-and-health-division/resource-binder/premium-rate-instructions/';
const URL = 'https://osi.state.nm.us/wp-content/uploads/2026/09/FY27-individual-market-premium-rate-sheets_broker-sheet.xlsx';

// OSI's region numbers and names, as printed in cell A1 of each sheet. They are
// the same numbers CMS uses on its nm-gra page; the counties below are read from
// that page and the town named by OSI must fall in it.
const REGIONS = { 1: 'Albuquerque', 2: 'Farmington', 3: 'Las Cruces', 4: 'Santa Fe', 5: 'Rural' };
const TOWN_COUNTY = { 1: '35001', 2: '35045', 3: '35013', 4: '35049' };   // Bernalillo, San Juan, Dona Ana, Santa Fe

/* ---- CMS rating areas (cached 2026 page; numbering checked against OSI) ---- */
const GRA_ALIAS = { 'debaca': 'de baca' };
function graCounties() {
  const html = readFileSync(join(CACHE, '..', 'gra', 'nm.html'), 'utf-8');
  const table = (html.match(/<table[\s\S]*?<\/table>/) || [])[0];
  if (!table) fail(ST, 'no table on the cached CMS nm-gra page');
  const C = counties(ST), byArea = {}, seen = {};
  for (const tr of table.match(/<tr[\s\S]*?<\/tr>/g).slice(1)) {
    const cells = (tr.match(/<t[dh][\s\S]*?<\/t[dh]>/g) || []).map(c => c.replace(/<[^>]+>|&nbsp;/g, ' ').replace(/\s+/g, ' ').trim());
    const ra = parseInt((cells[0].match(/Rating Area (\d+)/) || [])[1], 10);
    if (!Number.isFinite(ra)) continue;
    if (cells[2]) fail(ST, 'unexpected ZIP3 row on nm-gra');
    const n = norm(cells[1]);
    let f;
    try { f = C.fipsOf(GRA_ALIAS[n] || n); } catch (e) { fail(ST, e.message); }
    if (seen[f]) fail(ST, 'county ' + cells[1] + ' in two rating areas');
    seen[f] = ra;
    (byArea[ra] ||= []).push(f);
  }
  const missing = C.all.filter(f => !seen[f]);
  if (missing.length) fail(ST, 'counties missing from nm-gra: ' + missing.join(' '));
  return { byArea, all: C.all };
}

const gra = graCounties();
for (const [ra, town] of Object.entries(REGIONS)) {
  if (!gra.byArea[ra]) fail(ST, 'CMS has no rating area ' + ra);
  if (TOWN_COUNTY[ra] && !gra.byArea[ra].includes(TOWN_COUNTY[ra])) fail(ST, 'OSI region ' + ra + ' (' + town + ') does not hold ' + TOWN_COUNTY[ra] + ' on the CMS page');
}
if (Object.keys(gra.byArea).length !== 5) fail(ST, 'CMS lists ' + Object.keys(gra.byArea).length + ' rating areas, OSI 5');

/* ---- the rate sheets ---- */
const file = fetchCached(ST, URL, 'FY27-individual-market-premium-rate-sheets_broker-sheet.xlsx');
const sheets = xlsxSheets(file);
const label = r => String(r || '').replace(/\s+/g, ' ').trim();
const plans = {};   // id -> plan
const offNamed = new Set();
for (const ra of Object.keys(REGIONS)) {
  const name = 'Region ' + ra + ' Rates';
  if (!sheets.includes(name)) fail(ST, 'missing sheet ' + name);
  const rows = xlsxRows(file, name);
  const a1 = label(rows[0][0]);
  if (!a1.includes('Rating Area ' + ra) || !a1.includes(REGIONS[ra])) fail(ST, name + ' A1 reads "' + a1 + '"');
  const want = ['Company Name', 'SERFF Tracking #', 'Metal Level', 'Plan Type', 'Plan Name', 'Plan ID', 'Exchange', 'Smoke Status'];
  for (let i = 0; i < 8; i++) if (!label(rows[i][1]).startsWith(want[i])) fail(ST, name + ' row ' + (i + 1) + ' is "' + label(rows[i][1]) + '"');
  // the non-tobacco age block: rows 9..59
  const ages = rows.slice(8, 59).map(r => label(r[1]));
  const expect = ['0-14', ...Array.from({ length: 49 }, (_, i) => String(15 + i)), '64 and over'];
  if (ages.join() !== expect.join()) fail(ST, name + ' age column is not 0-14, 15 .. 63, 64 and over');
  if (label(rows[59][1]) !== 'Smoke Status') fail(ST, name + ' tobacco block not where expected');
  for (let c = 2; c < rows[0].length; c++) {
    const h = i => label(rows[i][c]);
    if (!h(5)) continue;
    if (h(7) !== 'Non-Tobacco') fail(ST, name + ' column ' + c + ' first block is ' + h(7));
    if (label(rows[59][c]) !== 'Tobacco') fail(ST, name + ' column ' + c + ' second block is not tobacco');
    if (h(2) !== 'Silver') continue;
    const ex = h(6);
    if (!['On-Exchange', 'Off-Exchange'].includes(ex)) fail(ST, name + ' ' + h(5) + ' exchange field "' + ex + '"');
    if (ex !== 'On-Exchange') continue;
    const id = h(5);
    if (!/^\d{5}NM\d{7}$/.test(id)) fail(ST, 'plan id ' + id);
    if (/off.exchange/i.test(h(4)) && !/on.exchange/i.test(h(4))) offNamed.add(id);
    const v = rows.slice(8, 59).map(r => r[c]);
    if (!v.every(x => typeof x === 'number' && x > 0)) fail(ST, name + ' ' + id + ' has a blank or non-numeric rate');
    const rates = [...Array(15).fill(v[0]), ...v.slice(1)];
    const p = plans[id] ||= { id, issuer: h(0), name: h(4).replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' '), areas: [], rates: {} };
    if (p.issuer !== h(0)) fail(ST, id + ' issuer differs between regions');
    if (p.rates[ra]) fail(ST, id + ' appears twice in ' + name);
    p.areas.push(+ra);
    p.rates[ra] = rates;
  }
}

/* ---- availability: OSI rates by region; no county footprint is published ---- */
const LSA = Object.values(plans).filter(p => /limited service area/i.test(p.name)).map(p => p.id).sort();
if (LSA.join() !== '57173NM0310004,57173NM0310008') fail(ST, 'limited service area plans changed: ' + LSA.join());
const out = Object.values(plans).map(p => {
  const cs = p.areas.flatMap(ra => gra.byArea[ra]).sort();
  return { id: p.id, issuer: p.issuer, name: p.name,
    counties: cs.length === gra.all.length ? 'all' : cs, rates: p.rates };
});
for (const id of LSA) log('  ' + id + ' rated in regions ' + plans[id].areas.join(', '));

/* ---- OSI's own benchmark sheet: the checks, and a self-check ---- */
const SLS = 'Second Lowest Silver';
if (!sheets.includes(SLS)) fail(ST, 'missing sheet ' + SLS);
const slRows = xlsxRows(file, SLS);
if (!slRows.some(r => /based on On-Exchange plans only/i.test(label(r[1])))) fail(ST, 'benchmark sheet lost its on-exchange note');
const checks = [];
for (const r of slRows) {
  const m = label(r[1]).match(/^Rating Area (\d)$/);
  if (!m) continue;
  const ra = m[1], age = r[2], prem = r[3], pid = label(r[4]);
  // reproduce it here as well, so a parse error fails now rather than in the build
  const sorted = out.filter(p => p.rates[ra]).map(p => ({ id: p.id, v: p.rates[ra][age] })).sort((a, b) => a.v - b.v);
  if (sorted.length < 2) fail(ST, 'fewer than two silver plans in region ' + ra);
  const ours = sorted[1];
  if (Math.abs(ours.v - prem) > 0.005 || ours.id !== pid)
    fail(ST, 'region ' + ra + ' age ' + age + ': OSI ' + prem + ' (' + pid + '), file gives ' + ours.v + ' (' + ours.id + ')');
  checks.push({ what: 'slcsp', ra: +ra, age, premium: prem,
    source: 'OSI, 2027 Individual Market Premium Rate sheets, sheet "Second Lowest Silver", Rating Area ' + ra + ', age ' + age });
}
if (checks.length !== 15) fail(ST, 'expected 15 benchmark figures, found ' + checks.length);

for (const ra of Object.keys(REGIONS)) {
  const s = out.filter(p => p.rates[ra]).map(p => p.rates[ra]).sort((a, b) => a[40] - b[40]);
  log('  region ' + ra + ' ' + REGIONS[ra] + ': ' + s.length + ' silver plans, SLCSP 21 ' + out.filter(p => p.rates[ra]).map(p => p.rates[ra][21]).sort((a, b) => a - b)[1] + ', 40 ' + s[1][40]);
}

writeState({
  state: ST, planYear: 2027, kind: 'plans', final: true, precision: 'cents',
  sources: [
    { title: 'New Mexico Office of Superintendent of Insurance, 2027 Individual Market Premium Rate sheets (broker rate sheets with gross premiums)', url: URL, published: '2026-09-09' },
    { title: 'OSI, Premium Rate Instructions (index of the 2027 rate sheets)', url: INDEX },
    { title: 'CMS, New Mexico geographic rating areas', url: 'https://www.cms.gov/cciio/programs-and-initiatives/health-insurance-market-reforms/nm-gra' }
  ],
  notes: [
    'New Mexico rates are the approved 2027 individual market premiums published by the Office of Superintendent of Insurance in its broker rate sheets, non-tobacco, for every plan marked On-Exchange.',
    'OSI numbers its five regions (Albuquerque, Farmington, Las Cruces, Santa Fe, Rural) the same way CMS numbers the state\'s rating areas, and each region\'s counties are taken from the CMS rating area page.',
    'Plans are selected by the rate sheet\'s Exchange Plan field, not by their names: ' + offNamed.size + ' BlueCross BlueShield silver plans whose names end in "Off Exchange" are marked On-Exchange in the same sheet and are included.',
    'Presbyterian offers two on-exchange silver plans "with Limited Service Area" (57173NM0310004 and 57173NM0310008), rated in regions 1 and 4 only. Neither OSI nor Presbyterian publishes which counties of those regions they serve for 2027, so they are treated as available in every county of regions 1 and 4. That is also how OSI\'s own region-level benchmark treats them: 57173NM0310008 is OSI\'s second lowest silver in region 1 and 57173NM0310004 in region 4. A household in a county outside their real footprint would have a different, likely higher, benchmark.',
    'OSI\'s published second lowest silver premiums for every region at ages 21, 40 and 55 are reproduced exactly from the rate sheets.'
  ],
  statewide: false,
  plans: out,
  checks
});
