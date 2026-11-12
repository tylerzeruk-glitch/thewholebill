/* Oregon, plan year 2027: the Division of Financial Regulation's plan table.
 *
 * DFR, "2027 Plan Comparison Table" (xlsx, last modified 29 Oct 2026), sheet
 * "Plan Information": every individual plan with carrier, name, HIOS id, whether
 * it is sold in the marketplace ("Both") or only outside it ("Off the Exchange"),
 * metal, and the monthly premium for a 40 year old in each of 36 counties grouped
 * under AREA 1..7 (blank = not offered there). The Overview sheet says premiums
 * are rounded to the nearest dollar; Kaiser and Moda print whole dollars,
 * BridgeSpan and Regence print cents.
 *
 * DFR, "2027 rate and county coverage" (2 Oct 2026): final rate decisions, the
 * final Portland silver 40 year old rate per carrier, carriers per county, and
 * Kaiser's partial counties.
 *
 * Age curve: BridgeSpan's 2027 individual rate tables, "Age Factor Summary".
 *
 *   node tools/state-sources/or.mjs
 */
import { readFileSync } from 'node:fs';
import { fetchCached, xlsxRows, xlsxSheets, pdfText, counties, writeState, fail, log } from './lib.mjs';

const ST = 'OR';
const U = {
  table: 'https://dfr.oregon.gov/healthrates/Documents/2027-plan-comparison-table.xlsx',
  cover: 'https://dfr.oregon.gov/healthrates/Documents/2027-rate-and-county-coverage.pdf',
  bs: 'https://dfr.oregon.gov/healthrates/Documents/rate-filings/bridespan-rate-tables-individual-2027.pdf',
  gra: 'https://www.cms.gov/cciio/programs-and-initiatives/health-insurance-market-reforms/or-gra',
};
const cty = counties(ST);
if (cty.all.length !== 36) fail(ST, 'expected 36 counties, got ' + cty.all.length);
const ws = s => String(s ?? '').replace(/\s+/g, ' ').trim();

/* ---- CMS rating areas (Oregon's 2026 page is not in tools/cache/gra) ---- */
const raOf = {};
{
  const html = readFileSync(fetchCached(ST, U.gra, 'or-gra.html'), 'utf-8');
  const table = (html.match(/<table[\s\S]*?<\/table>/) || [])[0];
  if (!table) fail(ST, 'no table on the CMS or-gra page');
  for (const tr of table.match(/<tr[\s\S]*?<\/tr>/g).slice(1)) {
    const cells = (tr.match(/<t[dh][\s\S]*?<\/t[dh]>/g) || []).map(c => ws(c.replace(/<[^>]+>|&nbsp;/g, ' ')));
    const ra = parseInt((cells[0] || '').match(/Rating Area (\d+)/)?.[1], 10);
    if (Number.isFinite(ra)) raOf[cty.fipsOf(cells[1])] = ra;
  }
  const miss = cty.all.filter(f => !raOf[f]);
  if (miss.length) fail(ST, 'or-gra lacks ' + miss.map(cty.nameOf).join(', '));
}

/* ---- the age curve from BridgeSpan's filing ---- */
const curve = new Array(65).fill(null);
{
  const t = pdfText(fetchCached(ST, U.bs, 'bridgespan-rate-tables-individual-2027.pdf'));
  if (!/Age Factor Summary/.test(t) || !/Rates Effective 01\/01\/2027/.test(t)) fail(ST, 'BridgeSpan filing: no 2027 age factor summary');
  const sect = t.slice(t.indexOf('Age Factor Summary'), t.indexOf('Area Factor Summary'));
  for (const m of sect.matchAll(/(0-14|64 and older|\d{2})\s+(\d\.\d{3})/g)) {
    const v = +m[2];
    const ages = m[1] === '0-14' ? [...Array(15).keys()] : m[1] === '64 and older' ? [64] : [+m[1]];
    for (const a of ages) { if (curve[a] != null) fail(ST, 'age ' + a + ' twice in the BridgeSpan table'); curve[a] = v; }
  }
  if (curve.some(v => v == null)) fail(ST, 'BridgeSpan age table incomplete: ages ' + curve.map((v, a) => v == null ? a : null).filter(a => a != null).join(','));
  if (curve[21] !== 1 || curve[0] !== 0.635 || curve[20] !== 0.635 || curve[40] !== 1.278 || curve[64] !== 3) fail(ST, 'BridgeSpan anchors moved: ' + [curve[0], curve[20], curve[21], curve[40], curve[64]]);
}

/* ---- DFR rate and county coverage ---- */
const portland = {}, coverCount = {}, kaiserPartial = [];
{
  const t = pdfText(fetchCached(ST, U.cover, '2027-rate-and-county-coverage.pdf'));
  if (!/FINAL 2027 INDIVIDUAL PLAN COVERAGE BY COUNTY/.test(t)) fail(ST, 'coverage PDF: no final 2027 individual county table');
  const ind = t.slice(t.indexOf('INDIVIDUAL MARKET'), t.indexOf('SMALL GROUP MARKET'));
  if (!/Final Portland\s+silver 40-year-/.test(ind.replace(/\s+/g, ' ')) && !/Final Portland/.test(ind)) fail(ST, 'coverage PDF: no final Portland silver column');
  for (const [key, re] of [['BridgeSpan', /BridgeSpan Health Company[^\n]*/], ['Kaiser', /Kaiser Foundation Health Plan[^\n]*/], ['Moda', /Moda Health Plan, Inc\.[^\n]*/], ['Regence', /Regence BlueCross BlueShield[^\n]*/]]) {
    // a long company name wraps, and its figures sit on the next line
    const L = ind.split('\n'), at = L.findIndex(l => re.test(l));
    if (at < 0) fail(ST, 'coverage PDF: no ' + key + ' row');
    const ds = l => [...(l || '').matchAll(/\$([\d,]+)/g)].map(m => +m[1].replace(/,/g, ''));
    const dollars = ds(L[at]).length ? ds(L[at]) : ds(L[at + 1]);
    if (dollars.length !== 3) fail(ST, 'coverage PDF: ' + key + ' row has ' + dollars.length + ' dollar figures');
    portland[key] = dollars[2];
  }
  const cov = t.slice(t.indexOf('FINAL 2027 INDIVIDUAL PLAN COVERAGE BY COUNTY'));
  // each county row marks its carriers with a check glyph (U+F0FC) under the carrier's column
  const lines = cov.split('\n');
  const hdr = lines.find(l => /^County\s+BridgeSpan/.test(l));
  if (!hdr) fail(ST, 'coverage PDF: no county table header');
  const heads = ['BridgeSpan', 'Kaiser', 'Moda', 'Regence'].map(k => ({ k, x: hdr.indexOf(k) + k.length / 2 }));
  for (const l of lines) {
    const m = l.match(/^([A-Z][A-Z ]*?[A-Z])\s[\s\uF0FC]*?(\d)\s*$/);
    if (!m) continue;
    const f = cty.fipsOf(m[1]);
    const marks = [...l.matchAll(/\uF0FC/g)].map(x => heads.reduce((b, h) => Math.abs(h.x - x.index) < Math.abs(b.x - x.index) ? h : b).k);
    if (new Set(marks).size !== marks.length || marks.length !== +m[2]) fail(ST, 'coverage PDF: ' + m[1] + ' marks ' + marks.join('/') + ' but totals ' + m[2]);
    coverCount[f] = new Set(marks);
  }
  if (Object.keys(coverCount).length !== 36) fail(ST, 'coverage PDF: ' + Object.keys(coverCount).length + ' counties read');
  const pm = cov.replace(/\s+/g, ' ').match(/Kaiser is offering partial service in ([A-Za-z ,]+?) counties/);
  if (!pm) fail(ST, 'coverage PDF: Kaiser partial-service footnote missing');
  for (const n of pm[1].split(/\s*,\s*(?:and\s+)?|\s+and\s+/).filter(Boolean)) kaiserPartial.push(cty.fipsOf(n));
}

/* ---- DFR plan comparison table ---- */
const xlsx = fetchCached(ST, U.table, '2027-plan-comparison-table.xlsx');
if (!xlsxSheets(xlsx).includes('Plan Information')) fail(ST, 'no "Plan Information" sheet');
const overview = xlsxRows(xlsx, 'Overview').flat().filter(Boolean).join(' ');
if (!/Premiums cited in this table are for 40-year old individuals/.test(overview) || !/rounded to the nearest dollar/.test(overview)) fail(ST, 'Overview no longer describes 40 year old premiums rounded to the dollar');
const rows = xlsxRows(xlsx, 'Plan Information');
const H = rows[1].map(ws), N = rows[3].map(ws);
const col = name => { const i = H.indexOf(name); if (i < 0) fail(ST, 'no column ' + name); return i; };
const C = { carrier: col('Carrier'), name: col('Plan Name'), id: col('Plan ID number'), mkt: col('Marketplace'), metal: col('Level of Coverage') };
const cCols = [];   // { i, fips, area }
{
  let area = null;
  for (let i = 0; i < N.length; i++) {
    const a = H[i].match(/^AREA (\d)$/);
    if (a) area = +a[1];
    if (area && N[i]) cCols.push({ i, fips: cty.fipsOf(N[i]), area });
  }
  if (cCols.length !== 36 || new Set(cCols.map(c => c.fips)).size !== 36) fail(ST, 'county columns: ' + cCols.length);
  for (const c of cCols) if (c.area !== raOf[c.fips]) fail(ST, cty.nameOf(c.fips) + ' is DFR AREA ' + c.area + ' but CMS rating area ' + raOf[c.fips]);
}

const plans = [], carriersIn = {};
for (const r of rows.slice(4)) {
  if (!r || !ws(r[C.carrier])) continue;
  const carrier = ws(r[C.carrier]), metal = ws(r[C.metal]), mkt = ws(r[C.mkt]), id = ws(r[C.id]);
  if (!['Both', 'Off the Exchange'].includes(mkt)) fail(ST, 'unknown Marketplace value "' + mkt + '" for ' + id);
  const prices = {};
  for (const c of cCols) {
    const v = r[c.i];
    if (v === '' || v == null) continue;
    if (typeof v !== 'number' || !(v > 0)) fail(ST, id + ' in ' + cty.nameOf(c.fips) + ': bad premium ' + JSON.stringify(v));
    prices[c.fips] = v;
    (carriersIn[c.fips] ||= new Set()).add(carrier);
  }
  if (metal !== 'Silver' || mkt !== 'Both') continue;
  if (!/^\d{5}OR\d{7}$/.test(id)) fail(ST, 'bad HIOS id ' + id);
  if (!Object.keys(prices).length) fail(ST, id + ' is offered nowhere');
  const rates = {};
  for (const [f, v] of Object.entries(prices)) {
    const ra = raOf[f];
    if (rates[ra] && rates[ra].premium !== v) fail(ST, id + ' is ' + rates[ra].premium + ' and ' + v + ' within rating area ' + ra);
    rates[ra] = { at: 40, premium: v };
  }
  const cs = Object.keys(prices).sort();
  const p = { id, issuer: carrier, name: ws(r[C.name]), counties: cs, rates };
  if (/^Kaiser/.test(carrier)) { const part = kaiserPartial.filter(f => cs.includes(f)); if (part.length) p.partial = part; }
  plans.push(p);
}
if (new Set(plans.map(p => p.id)).size !== plans.length) fail(ST, 'duplicate HIOS ids');

/* carriers per county must agree with DFR's coverage PDF, carrier for carrier */
const short = c => ['BridgeSpan', 'Kaiser', 'Moda', 'Regence'].find(k => c.toLowerCase().startsWith(k.toLowerCase())) || c;
for (const f of cty.all) {
  const a = [...(carriersIn[f] || [])].map(short).sort().join('/'), b = [...coverCount[f]].sort().join('/');
  if (a !== b) fail(ST, cty.nameOf(f) + ': the table has carriers ' + a + ', the coverage PDF ' + b);
}

/* DFR's "Final Portland silver 40-year-old rate" is each carrier's Oregon Standard
 * Silver plan in Multnomah (it is not each carrier's cheapest silver: Regence's
 * cheapest there is 606.80 and Moda's 679). Moda's prints $706 where the table
 * has $707; the extractor accepts exactly that known $1 difference and no other. */
const MUL = cty.fipsOf('Multnomah');
const portlandSeen = {};
for (const [key, want] of Object.entries(portland)) {
  const std = plans.filter(p => p.issuer.toLowerCase().startsWith(key.toLowerCase()) && /Standard Silver/i.test(p.name) && p.counties.includes(MUL));
  if (std.length !== 1) fail(ST, key + ': ' + std.length + ' standard silver plans in Multnomah');
  const got = std[0].rates[raOf[MUL]].premium;
  portlandSeen[key] = got;
  if (Math.round(got) === want) continue;
  if (key === 'Moda' && got === 707 && want === 706) continue;
  fail(ST, key + ': DFR\'s final Portland silver rate is ' + want + ', the table\'s standard silver in Multnomah ' + got);
}

const lowIn = f => plans.filter(p => p.counties.includes(f)).map(p => [p.rates[raOf[f]].premium, p.issuer + ' ' + p.name]).sort((a, b) => a[0] - b[0]);
const mul = lowIn(MUL), lane = lowIn(cty.fipsOf('Lane'));
if (mul[0][0] !== 599 || mul[1][0] !== 606.8) fail(ST, 'Multnomah\'s two lowest on-exchange silvers changed: ' + JSON.stringify(mul.slice(0, 2)));
log('  ' + plans.length + ' on-exchange silver plans; Multnomah second lowest ' + mul[1][0] + ', Lane second lowest ' + lane[1][0] + ' at 40');

writeState({
  state: ST, planYear: 2027, kind: 'plans', final: true, precision: 'dollars', statewide: false,
  sources: [
    { title: 'Oregon Division of Financial Regulation, 2027 Plan Comparison Table (individual plans)', url: U.table, published: '2026-10-29' },
    { title: 'Oregon Division of Financial Regulation, 2027 health insurance rate requests and final individual plan coverage by county', url: U.cover, published: '2026-10-02' },
    { title: 'BridgeSpan Health Company, 2027 ACA-Compliant Individual Product Rates (age factor summary)', url: U.bs, published: '2026-05-27' },
    { title: 'CMS, Oregon geographic rating areas', url: U.gra },
  ],
  notes: [
    'Oregon\'s 2027 plans come from the Division of Financial Regulation\'s plan comparison table, which DFR extracted from the approved plan and benefit templates. It gives every individual plan\'s monthly premium for a 40 year old in each county; plans marked "Off the Exchange" are left out and plans marked "Both" are kept as the marketplace plans.',
    'DFR says the premiums are rounded to the nearest dollar. Kaiser and Moda print whole dollars while BridgeSpan and Regence print cents, so Oregon figures are treated as accurate to the dollar.',
    'Kaiser serves Benton, Lane, Linn and Hood River counties only in part, per DFR\'s coverage table; there its plans count as offered in the county.',
    'Other ages use Oregon\'s age curve as printed in BridgeSpan\'s 2027 rate filing: 0.635 for every age from 0 to 20 and the federal default from 21 up. DFR\'s seven areas are the same as CMS\'s seven Oregon rating areas, county for county.',
    'DFR\'s "Final Portland silver 40-year-old rate" matches each carrier\'s Oregon Standard Silver plan in Multnomah County except Moda\'s, printed as $706 where the plan table has $707. Nothing published explains the dollar; the table\'s figure is used.',
    'The table\'s Overview still describes marketplace plans as sold at the federal HealthCare.gov site, text carried over from earlier years; Oregon runs its own exchange from plan year 2027.',
  ],
  plans, curve, checks: [],
});
