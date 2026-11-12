/* Georgia, plan year 2027: Georgia Access's own public use files.
 *
 * Georgia Access (the state exchange, run by the Office of Commissioner of
 * Insurance and Safety Fire) posts the CMS-format plan, rate and service area
 * PUFs for the plans it certified at https://georgiaaccess.gov/public-use-files/ .
 * They are the same dialect as CMS's federal PUFs, so this filters exactly the
 * way tools/build-benchmarks.mjs filters the federal files: individual market,
 * not dental-only, metal Silver, on the exchange or both, not child-only, keyed
 * by standard component ID, rates effective 1 January 2027, non-tobacco
 * IndividualRate, "0-14" spread over ages 0 to 14 and "64 and over" at 64.
 *
 * The file names carry their posting timestamp, so the extractor reads the
 * current names off the index page and fails if any of the three is missing or
 * listed twice. The Plan PUF was re-posted on 6 Nov 2026 (the 1 Oct version is
 * superseded).
 *
 *   node tools/state-sources/ga.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchCached, counties, writeState, fail, log, norm, FED_CURVE } from './lib.mjs';

const ST = 'GA';
const INDEX = 'https://georgiaaccess.gov/public-use-files/';
const HERE = dirname(fileURLToPath(import.meta.url));

/* ---- the index page: current names of the three 2027 files ---- */
// The index is cached with the rest; delete tools/cache/2027/states/ga/ to pick
// up a re-posting.
const index = readFileSync(fetchCached(ST, INDEX, 'public-use-files.html'), 'utf-8');
const hrefs = [...new Set([...index.matchAll(/href="([^"]+\.csv)"/g)].map(m => m[1]))];
function pick(kind) {
  const re = new RegExp('/' + kind + '-PUF_(\\d{14})_2027(?:-\\d+)?\\.csv$');
  const hits = hrefs.filter(h => re.test(h));
  if (hits.length !== 1) fail(ST, 'expected one 2027 ' + kind + '-PUF link on the index page, found ' + hits.length + ': ' + hits.join(', '));
  const url = new URL(hits[0], INDEX).href;
  const ts = url.match(re)[1];
  return { url, name: url.split('/').pop(), stamp: ts.slice(0, 4) + '-' + ts.slice(4, 6) + '-' + ts.slice(6, 8) };
}
const PLAN = pick('PLAN'), RATE = pick('RATE'), SA = pick('SA');
// what this extractor was written against; a re-posted file must be re-read by a person
const EXPECT = { PLAN: 'PLAN-PUF_20261106095934_2027.csv', RATE: 'RATE-PUF_20261001161618_2027.csv', SA: 'SA-PUF_20261001161627_2027.csv' };
for (const [k, f] of Object.entries({ PLAN, RATE, SA }))
  if (f.name !== EXPECT[k]) fail(ST, k + '-PUF is now ' + f.name + ' (was ' + EXPECT[k] + '); re-read it and update EXPECT');

/* ---- CSV ---- */
function parseCsv(text) {
  const rows = []; let row = [], f = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f.replace(/\r$/, '')); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  const header = rows.shift().map(h => h.trim());
  const col = n => { const i = header.indexOf(n); if (i < 0) fail(ST, 'no column ' + n); return i; };
  return { header, rows: rows.filter(r => r.length > 1), col };
}
const load = f => parseCsv(readFileSync(fetchCached(ST, f.url, f.name), 'utf-8'));

/* ---- rating areas: CMS's ga-gra page (cached 2026 copy) ---- */
const cty = counties(ST);
if (cty.all.length !== 159) fail(ST, 'expected 159 counties in the Census file, got ' + cty.all.length);
const GRA_ALIAS = { heralson: 'haralson' };   // CMS page typo (same alias as build-benchmarks.mjs)
const countyRA = {};
{
  const html = readFileSync(join(HERE, '..', 'cache', 'gra', 'ga.html'), 'utf-8');
  const table = (html.match(/<table[\s\S]*?<\/table>/) || [])[0];
  if (!table) fail(ST, 'no table in the cached ga-gra page');
  for (const tr of table.match(/<tr[\s\S]*?<\/tr>/g).slice(1)) {
    const cells = (tr.match(/<t[dh][\s\S]*?<\/t[dh]>/g) || []).map(c => c.replace(/<[^>]+>|&nbsp;/g, ' ').replace(/\s+/g, ' ').trim());
    const ra = parseInt((cells[0] || '').match(/Rating Area (\d+)/)?.[1], 10);
    if (!Number.isFinite(ra)) continue;
    if (cells[2]) fail(ST, 'unexpected 3-digit ZIP rating row: ' + cells.join(' | '));
    const n = norm(cells[1]);
    const fips = cty.fipsOf(GRA_ALIAS[n] || n);
    if (countyRA[fips] != null) fail(ST, 'county twice on the gra page: ' + cells[1]);
    countyRA[fips] = ra;
  }
  const missing = cty.all.filter(f => countyRA[f] == null);
  if (missing.length) fail(ST, 'counties with no rating area: ' + missing.map(cty.nameOf).join(', '));
  const areas = new Set(Object.values(countyRA));
  if (areas.size !== 16 || Math.max(...areas) !== 16) fail(ST, 'expected rating areas 1 to 16, got ' + [...areas].sort((a, b) => a - b));
}

/* ---- plans ---- */
const silver = {};   // scid -> { issuer, issuerId, said, name }
{
  const { rows, col } = load(PLAN);
  const iYr = col('BusinessYear'), iMc = col('MarketCoverage'), iDo = col('DentalOnlyPlan'), iSc = col('StandardComponentId'),
        iSa = col('ServiceAreaId'), iMl = col('MetalLevel'), iQ = col('QHPNonQHPTypeId'), iCh = col('ChildOnlyOffering'),
        iIss = col('IssuerId'), iIn = col('IssuerMarketPlaceMarketingName'), iNm = col('PlanMarketingName'),
        iPl = col('PlanId'), iCsr = col('CSRVariationType'), iSt = col('StateCode');
  for (const r of rows) {
    if (r[iYr] !== '2027' || r[iSt] !== 'GA') fail(ST, 'Plan PUF row outside GA 2027: ' + r[iPl]);
    if (r[iMc] !== 'Individual' || r[iDo] !== 'No') continue;
    if (r[iMl] !== 'Silver') continue;
    if (r[iQ] !== 'On the Exchange' && r[iQ] !== 'Both') continue;
    if (r[iCh] === 'Allows Child-Only') continue;
    const scid = r[iSc];
    if (!/^\d{5}GA\d{7}$/.test(scid)) fail(ST, 'odd standard component id ' + scid);
    const p = silver[scid] ||= { issuer: r[iIn], issuerId: r[iIss], said: r[iSa], name: null };
    if (p.said !== r[iSa] || p.issuerId !== r[iIss]) fail(ST, scid + ': variants disagree on issuer or service area');
    // the plan's own name is the standard variant's; CSR variants carry their own names
    if (r[iPl] === scid + '-01') {
      if (!/^Standard Silver On Exchange Plan$/.test(r[iCsr])) fail(ST, scid + '-01 is ' + r[iCsr]);
      p.name = r[iNm];
    }
  }
  for (const [k, p] of Object.entries(silver)) if (!p.name) fail(ST, k + ' has no standard -01 variant');
}
log('silver on-exchange plans: ' + Object.keys(silver).length);

/* ---- service areas ---- */
const sa = {};   // issuerId|said -> Map(fips -> partial?)
{
  const { rows, col } = load(SA);
  const iIss = col('IssuerId'), iSa = col('ServiceAreaId'), iAll = col('CoverEntireState'), iCo = col('County'),
        iPart = col('PartialCounty'), iMc = col('MarketCoverage'), iDo = col('DentalOnlyPlan'), iYr = col('BusinessYear');
  for (const r of rows) {
    if (r[iYr] !== '2027') fail(ST, 'SA PUF row not 2027');
    if (r[iMc] !== 'Individual' || r[iDo] !== 'No') continue;
    const m = (sa[r[iIss] + '|' + r[iSa]] ||= new Map());
    if (r[iAll] === 'Yes') { for (const f of cty.all) m.set(f, false); continue; }
    if (r[iAll] !== 'No') fail(ST, 'CoverEntireState ' + r[iAll]);
    const f = r[iCo].padStart(5, '0');
    if (!cty.all.includes(f)) fail(ST, 'SA PUF county ' + r[iCo] + ' is not a Georgia county');
    if (!['Yes', 'No'].includes(r[iPart])) fail(ST, 'PartialCounty ' + r[iPart]);
    const partial = r[iPart] === 'Yes';
    // a county listed whole anywhere in the service area is served whole
    m.set(f, m.has(f) ? (m.get(f) && partial) : partial);
  }
}

/* ---- rates ---- */
const rates = {};   // scid -> { ra -> Array(65) }
{
  const { rows, col } = load(RATE);
  const iPl = col('PlanId'), iRa = col('RatingAreaId'), iAge = col('Age'), iRate = col('IndividualRate'),
        iEff = col('RateEffectiveDate'), iExp = col('RateExpirationDate'), iTob = col('Tobaco'), iYr = col('BusinessYear');
  const ageIdx = a => a === '0-14' ? [...Array(15).keys()] : a === '64 and over' ? [64]
    : (+a >= 15 && +a <= 63 && String(+a) === a) ? [+a] : null;
  for (const r of rows) {
    if (r[iYr] !== '2027') fail(ST, 'Rate PUF row not 2027');
    const scid = r[iPl];
    if (!silver[scid]) continue;
    if (r[iEff] !== '2027-01-01') fail(ST, scid + ': rate effective ' + r[iEff] + ' (the extractor assumes full-year rates only)');
    if (r[iExp] !== '2027-12-31') fail(ST, scid + ': rate expires ' + r[iExp]);
    if (!['Tobacco User/Non-Tobacco User', 'No Preference'].includes(r[iTob])) fail(ST, 'tobacco flag ' + r[iTob]);
    const ra = (r[iRa].match(/^Rating Area (\d+)$/) || [])[1];
    if (!ra || +ra < 1 || +ra > 16) fail(ST, 'rating area ' + r[iRa]);
    const idx = ageIdx(r[iAge]);
    if (!idx) fail(ST, 'age band ' + r[iAge]);
    const v = +r[iRate];
    if (!(v > 0)) fail(ST, scid + ' area ' + ra + ' age ' + r[iAge] + ': rate ' + r[iRate]);
    const arr = ((rates[scid] ||= {})[ra] ||= Array(65).fill(0));
    for (const a of idx) {
      if (arr[a] && arr[a] !== v) fail(ST, scid + ' area ' + ra + ' age ' + a + ': two different rates');
      arr[a] = v;
    }
  }
}

/* ---- assemble, with self-tests ---- */
const plans = [];
// Issuers round at their own intermediate steps (area and plan factors), so a
// rate is not always the age 21 rate times the factor to the cent: in the 2027
// file the gap is at most 5 cents. Six cents still pins the curve (neighbouring
// factors differ by at least 0.4%, over a dollar at these premiums).
const TOL = 0.06;
let curveWorst = 0, partialRows = 0;
for (const [scid, p] of Object.entries(silver)) {
  const r = rates[scid];
  if (!r) fail(ST, scid + ' (' + p.name + ') has no 2027 rates');
  for (const [ra, arr] of Object.entries(r)) {
    if (arr.some(v => !(v > 0))) fail(ST, scid + ' area ' + ra + ': incomplete age table');
    // Georgia uses the federal default age curve; every age must sit on it (TOL above)
    for (let a = 0; a < 65; a++) {
      const d = Math.abs(arr[a] - arr[21] * FED_CURVE[a]);
      curveWorst = Math.max(curveWorst, d);
      if (d > TOL) fail(ST, scid + ' area ' + ra + ' age ' + a + ': ' + arr[a] + ' is off the federal curve (' + (arr[21] * FED_CURVE[a]).toFixed(2) + ')');
    }
  }
  const area = sa[p.issuerId + '|' + p.said];
  if (!area || !area.size) fail(ST, scid + ': service area ' + p.issuerId + ' ' + p.said + ' not in the SA PUF');
  const fipsList = [...area.keys()].sort();
  // every county it serves must be priced in that county's rating area
  const unpriced = fipsList.filter(f => !r[countyRA[f]]);
  if (unpriced.length) fail(ST, scid + ' serves ' + unpriced.map(cty.nameOf).join(', ') + ' but has no rate for their rating area');
  const partial = fipsList.filter(f => area.get(f));
  partialRows += partial.length;
  const used = new Set(fipsList.map(f => String(countyRA[f])));
  const out = {
    id: scid, issuer: p.issuer, name: p.name,
    counties: fipsList.length === cty.all.length && !partial.length ? 'all' : fipsList,
    rates: Object.fromEntries(Object.entries(r).filter(([ra]) => used.has(ra)).sort((a, b) => a[0] - b[0])),
  };
  if (partial.length) out.partial = partial;
  plans.push(out);
}
plans.sort((a, b) => a.id < b.id ? -1 : 1);
log('every rate row on the federal curve (worst ' + curveWorst.toFixed(4) + '); partial-county listings ' + partialRows);

/* ---- sanity print: SLCSP for three counties (not checks: nothing published) ---- */
function slcsp(fips, age) {
  const ra = String(countyRA[fips]);
  const c = plans.filter(p => p.counties === 'all' || p.counties.includes(fips)).map(p => ({ v: p.rates[ra][age], p }))
    .sort((a, b) => a.v - b.v);
  return c.length < 2 ? null : { n: c.length, v: c[1].v, plan: c[1].p.issuer + ' ' + c[1].p.name + ' ' + c[1].p.id };
}
for (const n of ['Fulton', 'Chatham', 'Ware']) {
  const f = cty.fipsOf(n);
  for (const age of [21, 40]) { const s = slcsp(f, age); log('  ' + n + ' (area ' + countyRA[f] + ') age ' + age + ': ' + (s ? s.v.toFixed(2) + ' of ' + s.n + ', ' + s.plan : 'fewer than two plans')); }
}
const thin = cty.all.filter(f => !slcsp(f, 21));
if (thin.length) fail(ST, 'counties with fewer than two silver plans: ' + thin.map(cty.nameOf).join(', '));

writeState({
  state: ST, planYear: 2027, kind: 'plans', final: true, precision: 'cents', statewide: false,
  sources: [
    { title: 'Georgia Access, Public Use Files (index)', url: INDEX },
    { title: 'Georgia Access, 2027 Plan Attributes PUF (' + PLAN.name + ')', url: PLAN.url, published: PLAN.stamp },
    { title: 'Georgia Access, 2027 Rate PUF (' + RATE.name + ')', url: RATE.url, published: RATE.stamp },
    { title: 'Georgia Access, 2027 Service Area PUF (' + SA.name + ')', url: SA.url, published: SA.stamp },
  ],
  notes: [
    'Georgia runs its own exchange, Georgia Access, which publishes plan, rate and service area files in the federal format for the plans it certified for 2027; the benchmark is computed from them with the same filters used for the federal files.',
    'The Plan Attributes file was re-posted on 6 November 2026 and that revision is used; the rate and service area files are the 1 October 2026 postings.',
    'Some plans serve only part of a county (listed by ZIP code in the service area file). Those counties count the plan as available, so in them the benchmark may include a plan not offered at every address.',
    'Georgia Access publishes no benchmark figure of its own for 2027, so there is no independent published value to check these against.',
    'Every rate in the file sits on the federal default age curve (within six cents of the age 21 rate times the federal factor, the gap issuers leave by rounding at their own intermediate steps), and rating areas are numbered as on the CMS rating area page for Georgia.',
  ],
  plans,
  checks: [],
});
