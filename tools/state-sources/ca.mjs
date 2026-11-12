/* California, plan year 2027: every on-exchange individual silver plan, from
 * Covered California's own rate and availability files.
 *
 *   node tools/state-sources/ca.mjs
 *
 * Sources (all linked from https://hbex.coveredca.com/data-research/):
 *  - "2027 QHP Individual Product Prices 8.18.2026.xlsx": sheet "2027 QHP
 *    Individual Rates", header on row 7 (Plan ID*, Rating Area ID*, Age*,
 *    Individual Rate*, Applicant, HOIS ID, Metal Level, Network, Benefit Design,
 *    Full Plan Name). Covered California sells only its standardized designs,
 *    so every silver row is a Silver 70 plan; CSR variants are not in the file.
 *  - "2027 Plans by Zip - Individual.xlsx": sheet "PBZ PY 2027 IndH", header on
 *    row 8, one row per ZIP and county, one column per carrier network holding
 *    the number of that network's products sold in the ZIP (blank: not sold).
 *  - The enroller booklet "2027 Sample Regional Bronze & Silver Rates for 16
 *    Counties" (toolkit PDF, published 1 October 2026): each county's Silver page
 *    ranks the plans sold in one ZIP of that county by 2027 gross premium for a
 *    single 40 year old, in whole dollars, and draws a dashed box around the
 *    benchmark plan. The box is found in the rendered page (pdftoppm), the row
 *    it encloses by the text positions (pdftotext -bbox).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fetchCached, xlsxRows, xlsxSheets, pdfText, counties, writeState, fail, log, norm, CACHE } from './lib.mjs';

const ST = 'CA';
const BASE = 'https://hbex.coveredca.com/';
const RATES_URL = BASE + 'financial-reports/2027%20QHP%20Individual%20Product%20Prices%208.18.2026.xlsx';
const PBZ_URL = BASE + 'financial-reports/2027%20Plans%20by%20Zip%20-%20Individual.xlsx';
const BOOK_URL = BASE + 'toolkit/downloads/2027_Health_Plan_Bronze_and_Sliver_Rates_by_County.pdf';
const INDEX = BASE + 'data-research/';

/* Plans-by-ZIP column -> rate file Applicant (and Benefit Design where one
 * applicant has two columns). Sharp's two columns are its two benefit-design
 * families: "HMO 1 (Copay)" counts 4 products in every San Diego ZIP and Sharp
 * has exactly 4 Copay plans (Gold 80 Premier, Platinum 90 Premier, Silver 70
 * Performance, Silver 70 Premier); "HMO 2 (Coin)" counts 5 and Sharp has 5
 * Coinsurance plans. So both Sharp silver plans sit under "HMO 1 (Copay)". The
 * script re-proves every such count below. */
const COLUMNS = {
  'Anthem EPO':              { applicant: 'Anthem EPO' },
  'Anthem HMO':              { applicant: 'Anthem HMO' },
  'Blue Sheild HMO':         { applicant: 'Blue Shield HMO' },   // sic, in the source
  'Blue Shield PPO':         { applicant: 'Blue Shield PPO' },
  'CalOptima HMO':           { applicant: 'CalOptima' },
  'Chinese Community HMO':   { applicant: 'CCHP' },
  'Health Net CA HMO':       { applicant: 'Health Net HMO' },
  'Health Net CA PPO':       { applicant: 'Health Net PPO' },
  'IEHP HMO':                { applicant: 'IEHP' },
  'Kaiser HMO':              { applicant: 'Kaiser' },
  'LA Care HMO':             { applicant: 'L.A. Care' },
  'Molina HMO':              { applicant: 'Molina' },
  'Sharp HMO 1 (Copay)':     { applicant: 'Sharp', design: 'Copay' },
  'Sharp HMO 2 (Coin)':      { applicant: 'Sharp', design: 'Coinsurance' },
  'Valley HMO':              { applicant: 'Valley' },
  'Western Health HMO':      { applicant: 'Western' }
};
// Names the booklet prints -> rate file Applicant (+ plan name for Sharp).
const BOOK_NAMES = {
  'Kaiser': ['Kaiser'], 'Blue Shield HMO': ['Blue Shield HMO'], 'Blue Shield PPO': ['Blue Shield PPO'],
  'Anthem EPO': ['Anthem EPO'], 'Anthem HMO': ['Anthem HMO'], 'Molina': ['Molina'],
  'Health Net HMO': ['Health Net HMO'], 'Health Net PPO': ['Health Net PPO'], 'L.A. Care': ['L.A. Care'],
  'Cal Optima': ['CalOptima'], 'IEHP': ['IEHP'], 'Western': ['Western'], 'CCHP': ['CCHP'], 'Valley': ['Valley'],
  'Sharp Premier': ['Sharp', 'Silver 70 Premier HMO'], 'Sharp Performance': ['Sharp', 'Silver 70 Performance HMO']
};

const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();

/* ---- CMS rating areas: county -> area, and LA County's ZIP3 -> 15/16 ---- */
const C = counties(ST);
const graCounty = {}, graLA = {};
{
  const html = readFileSync(join(CACHE, '..', 'gra', 'ca.html'), 'utf-8');
  const table = (html.match(/<table[\s\S]*?<\/table>/) || [])[0];
  if (!table) fail(ST, 'no table on the cached CMS ca-gra page');
  const ALIAS = { 'san bernadino': 'san bernardino' };   // CMS page typo
  for (const tr of table.match(/<tr[\s\S]*?<\/tr>/g).slice(1)) {
    const cells = (tr.match(/<t[dh][\s\S]*?<\/t[dh]>/g) || []).map(c => clean(c.replace(/<[^>]+>|&nbsp;/g, ' ')));
    const ra = parseInt((cells[0].match(/Rating Area (\d+)/) || [])[1], 10);
    if (!Number.isFinite(ra)) continue;
    const z = (cells[2] || '').match(/^(\d{3}) \(only within LA County\)$/);
    if (z) { graLA[z[1]] = ra; continue; }
    let f; const n = norm(cells[1]);
    try { f = C.fipsOf(ALIAS[n] || n); } catch (e) { fail(ST, e.message); }
    if (graCounty[f]) fail(ST, 'county ' + cells[1] + ' twice on ca-gra');
    graCounty[f] = ra;
  }
  if (Object.keys(graLA).length !== 21) fail(ST, 'LA ZIP3 table on ca-gra is not 21 rows');
  const missing = C.all.filter(f => f !== '06037' && !graCounty[f]);
  if (missing.length || graCounty['06037']) fail(ST, 'ca-gra does not cover every county exactly once: ' + missing.join(' '));
}

/* ---- rates ---- */
const ratesFile = fetchCached(ST, RATES_URL, '2027 QHP Individual Product Prices 8.18.2026.xlsx');
if (!xlsxSheets(ratesFile).includes('2027 QHP Individual Rates')) fail(ST, 'rate sheet renamed');
const rr = xlsxRows(ratesFile, '2027 QHP Individual Rates');
const RH = ['Plan ID*', 'Rating Area ID*', 'Age*', 'Individual Rate*', 'Applicant', 'HOIS ID', 'Metal Level', 'Network', 'Benefit Design', 'Full Plan Name'];
if (rr[6].map(clean).join('|') !== RH.join('|')) fail(ST, 'rate file header changed: ' + rr[6].join('|'));
if (clean(rr[2][8]) !== 'Coverage Year = 2027') fail(ST, 'rate file is not coverage year 2027');
const ageIndex = a => a === '0-14' ? 0 : a === '64 and over' ? 64 : (/^\d+$/.test(a) && +a >= 15 && +a <= 63 ? +a : -1);
const allPlans = {};       // id -> { applicant, design, metal, name, areas: { ra: [65] } }
for (const r of rr.slice(7)) {
  if (!r.length || r.every(v => v == null)) continue;
  const [id, area, age, rate, applicant, hios, metal, network, design, name] = r.map((v, i) => i === 3 ? v : clean(v));
  if (!/^\d{5}CA\d{7}$/.test(id) || id.slice(0, 5) !== hios) fail(ST, 'bad plan id row ' + JSON.stringify(r));
  const ra = (area.match(/^Rating Area (\d{1,2})$/) || [])[1];
  if (!ra || +ra < 1 || +ra > 19) fail(ST, 'bad rating area ' + area);
  const ai = ageIndex(age);
  if (ai < 0) fail(ST, 'bad age ' + age);
  if (!(typeof rate === 'number' && rate > 0)) fail(ST, 'bad rate for ' + id);
  const p = allPlans[id] ||= { id, applicant, design, metal, network, name, areas: {} };
  if (p.applicant !== applicant || p.metal !== metal || p.name !== name || p.design !== design) fail(ST, id + ' changes attributes between rows');
  const a = p.areas[ra] ||= Array(65).fill(null);
  if (ai === 0) for (let i = 0; i < 15; i++) a[i] = rate; else a[ai] = rate;
}
for (const p of Object.values(allPlans)) for (const [ra, a] of Object.entries(p.areas))
  if (a.some(v => v == null)) fail(ST, p.id + ' area ' + ra + ' lacks some ages');
const silver = Object.values(allPlans).filter(p => p.metal === 'Silver');
for (const p of silver) if (!/^Silver 70 /.test(p.name)) fail(ST, 'unexpected silver plan name ' + p.name);
const applicants = new Set(Object.values(allPlans).map(p => p.applicant));
const mapped = new Set(Object.values(COLUMNS).map(c => c.applicant));
for (const a of applicants) if (!mapped.has(a)) fail(ST, 'rate file applicant "' + a + '" has no plans-by-ZIP column');

/* ---- availability by ZIP ---- */
const pbzFile = fetchCached(ST, PBZ_URL, '2027 Plans by Zip - Individual.xlsx');
const pr = xlsxRows(pbzFile, 'PBZ PY 2027 IndH');
if (clean(pr[2][2]) !== '2027 Products by Zip Code' || clean(pr[3][2]) !== 'Health Individual') fail(ST, 'plans-by-ZIP title changed');
const ph = pr[7].map(clean);
const fixed = ['Covered California Rating Region', 'County', 'FIPS County Code', 'Zip Code', 'Zip Code Split Across Counties'];
if (ph.slice(1, 6).join('|') !== fixed.join('|')) fail(ST, 'plans-by-ZIP header changed: ' + ph.join('|'));
const cols = ph.slice(6);
for (const c of cols) if (!COLUMNS[c]) fail(ST, 'unmapped plans-by-ZIP column "' + c + '"');
for (const c of Object.keys(COLUMNS)) if (!cols.includes(c)) fail(ST, 'plans-by-ZIP lacks column "' + c + '"');
// products per (column, area), for the count cross-check
const products = (col, ra) => Object.values(allPlans).filter(p => p.applicant === COLUMNS[col].applicant &&
  (!COLUMNS[col].design || p.design === COLUMNS[col].design) && (ra == null || p.areas[ra])).length;

const zipRows = [];     // { fips, ra, zip, marked: Set(col) }
const countMiss = new Set(), laUnlisted = new Set(), laUnlistedZips = new Set();
for (const r of pr.slice(8)) {
  if (!r.length || r.every(v => v == null || clean(v) === '')) continue;
  const reg = r[1], cname = clean(r[2]), code = clean(r[3]), zip = clean(r[4]);
  if (!Number.isInteger(reg) || !/^\d{3}$/.test(code) || !/^\d{5}$/.test(zip)) fail(ST, 'bad plans-by-ZIP row ' + JSON.stringify(r));
  const fips = '06' + code;
  if (!C.nameOf(fips) || norm(C.nameOf(fips)).replace(/ county$/, '') !== norm(cname)) fail(ST, 'county ' + cname + ' is not FIPS ' + fips);
  let cmsRA = fips === '06037' ? graLA[zip.slice(0, 3)] : graCounty[fips];
  // LA ZIP3s the CMS table does not list (901: PO box and unique ZIPs) take
  // Covered California's region, which must still be 15 or 16
  if (fips === '06037' && cmsRA == null && (reg === 15 || reg === 16)) { laUnlisted.add(zip.slice(0, 3) + ' in area ' + reg); laUnlistedZips.add(zip); cmsRA = reg; }
  if (cmsRA !== reg) fail(ST, 'ZIP ' + zip + ' in ' + cname + ': Covered California region ' + reg + ', CMS rating area ' + cmsRA);
  const marked = new Set();
  cols.forEach((c, i) => {
    const v = r[6 + i];
    if (v == null || clean(v) === '') return;
    if (!Number.isInteger(v) || v < 1) fail(ST, 'non-count cell ' + c + ' ZIP ' + zip + ': ' + v);
    // the count must equal that network's products rated in this region. Western
    // is the one exception: it counts its products in both of its regions (10).
    if (v !== products(c, reg) && !(c === 'Western Health HMO' && v === products(c))) countMiss.add(c + ' region ' + reg + ': ' + v + ' vs ' + products(c, reg));
    if (!products(c, reg)) fail(ST, c + ' marked in ZIP ' + zip + ' but has no plans rated in region ' + reg);
    marked.add(c);
  });
  zipRows.push({ fips, ra: reg, zip, marked });
}
if (laUnlisted.size) log('  LA ZIP3 not on the CMS table, Covered California region used: ' + [...laUnlisted].join(', '));
if (countMiss.size) fail(ST, 'plans-by-ZIP product counts disagree with the rate file:\n  ' + [...countMiss].join('\n  '));
const zipCounties = new Set(zipRows.map(z => z.fips));
if (zipCounties.size !== 58) fail(ST, 'plans-by-ZIP covers ' + zipCounties.size + ' counties, not 58');

/* ---- silver plans: counties, partial counties, rates only where sold ---- */
const colOf = p => Object.keys(COLUMNS).filter(c => COLUMNS[c].applicant === p.applicant && (!COLUMNS[c].design || COLUMNS[c].design === p.design));
const plans = [];
for (const p of silver) {
  const pc = colOf(p);
  if (pc.length !== 1) fail(ST, p.id + ' maps to ' + pc.length + ' plans-by-ZIP columns');
  const col = pc[0];
  const cs = new Set(), partial = new Set(), rates = {};
  for (const ra of Object.keys(p.areas)) {
    // the ZIP rows of this rating area, by county; LA County's are its ZIPs in this area only
    const byCounty = {};
    for (const z of zipRows) if (z.ra === +ra) (byCounty[z.fips] ||= []).push(z);
    let sold = false;
    for (const [f, zs] of Object.entries(byCounty)) {
      const n = zs.filter(z => z.marked.has(col)).length;
      if (!n) continue;
      sold = true; cs.add(f);
      if (n < zs.length) partial.add(f);
    }
    if (sold) rates[ra] = p.areas[ra];
    else log('  ' + p.id + ' ' + p.applicant + ' is rated in area ' + ra + ' but sold in no ZIP there; area dropped');
  }
  // a county counts as partial only if no area of this plan covers all its ZIPs
  // in that area (LA: a plan sold in every region 15 ZIP but not region 16 is
  // whole in 15, and the 16 rates are simply absent)
  if (!cs.size) { log('  ' + p.id + ' sold nowhere; left out'); continue; }
  const out = { id: p.id, issuer: p.applicant, name: p.name, counties: [...cs].sort(), rates };
  if (partial.size) out.partial = [...partial].sort();
  plans.push(out);
}
log('  ' + plans.length + ' silver plans (' + silver.length + ' in the rate file)');

/* ---- what the builder will compute, for the checks and the samples ---- */
const benchmark = (fips, ra, age, onlyWhole) => {
  const v = plans.filter(p => p.counties.includes(fips) && p.rates[ra] && !(onlyWhole && (p.partial || []).includes(fips)))
    .map(p => ({ p, v: p.rates[ra][age] })).sort((a, b) => a.v - b.v);
  return v;
};

/* ---- the booklet ---- */
const bookFile = fetchCached(ST, BOOK_URL, '2027_Health_Plan_Bronze_and_Sliver_Rates_by_County.pdf');
const bookAll = pdfText(bookFile);
if (!/preliminary and currently undergoing regulatory review/.test(bookAll.replace(/\s+/g, ' '))) fail(ST, 'booklet no longer calls the rates preliminary: re-check final status');
if (!/based on individual aged 40, single status/.test(bookAll.replace(/\s+/g, ' '))) fail(ST, 'booklet persona changed');
const bookPages = bookAll.split('\f');
const tmp = mkdtempSync(join(tmpdir(), 'ca-book-'));
const checks = [], bookNotes = [], partialChecks = [];
let silverPages = 0;
try {
  bookPages.forEach((txt, i) => {
    if (!/Silver Plan/.test(txt) || !/Benchmark Plan/.test(txt)) return;
    silverPages++;
    const page = i + 1;
    const title = clean(txt.split('\n').find(l => l.trim()));
    const m = title.match(/^(.+?) County(?: [–-] (East|West))? \(Region (\d+)\)$/);
    if (!m) fail(ST, 'booklet page ' + page + ' title "' + title + '"');
    const [, cname, side, region] = m;
    const fips = C.fipsOf(cname);
    const ra = +region;
    const expectRA = fips === '06037' ? { East: 15, West: 16 }[side] : graCounty[fips];
    if (expectRA !== ra) fail(ST, title + ': CMS area is ' + expectRA);
    // words with positions: rank, plan, 2026, 2027 columns
    const bbox = execFileSync('pdftotext', ['-f', String(page), '-l', String(page), '-bbox', bookFile, '-'], { maxBuffer: 1 << 26 }).toString();
    const words = [...bbox.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)]
      .map(w => ({ x0: +w[1], y0: +w[2], x1: +w[3], y1: +w[4], t: w[5].replace(/&amp;/g, '&') }));
    const lines = txt.split('\n');
    const rows = [];
    for (const l of lines) {
      const r = l.match(/^\s*(?:.*?\s{2,})?(\d{1,2})\s{2,}([A-Z][A-Za-z.' ]+?)\s{2,}(\$[\d,]+|-)\s+(\$[\d,]+)\s/);
      if (r) rows.push({ rank: +r[1], name: clean(r[2]), p27: +r[4].replace(/[$,]/g, ''), t27: r[4] });
    }
    if (!rows.length || rows.some((r, k) => r.rank !== k + 1)) fail(ST, title + ': silver ranks not 1..n');
    for (let k = 1; k < rows.length; k++) if (rows[k].p27 < rows[k - 1].p27) fail(ST, title + ': ranking not by 2027 premium');
    // the 2027 column is the one to the right of the 2026 column; find each row's 2027 word
    const xc = w => (w.x0 + w.x1) / 2;   // the columns are centred
    const head27 = words.filter(w => w.t === '2027' && w.x0 > 300 && w.y1 < 200);   // the table's "2027 Monthly Gross Premium" header
    if (head27.length !== 1) fail(ST, title + ': cannot find the 2027 column header');
    const x27 = xc(head27[0]);
    for (const r of rows) {
      const w = words.find(w => w.t === r.t27 && Math.abs(xc(w) - x27) < 12 && !rows.some(o => o.w === w));
      if (!w) fail(ST, title + ': no position for ' + r.t27);
      r.w = w; r.yc = (w.y0 + w.y1) / 2;
    }
    // the dashed benchmark box, from the rendered page at 72 dpi (1 px = 1 pt)
    execFileSync('pdftoppm', ['-f', String(page), '-l', String(page), '-r', '72', bookFile, join(tmp, 'p')]);
    const ppm = readFileSync(join(tmp, 'p-' + String(page).padStart(2, '0') + '.ppm'));
    const hdr = ppm.toString('latin1', 0, 32).split(/\s+/);
    const W = +hdr[1], H = +hdr[2], off = ppm.indexOf('255\n') + 4;
    const tableTop = Math.min(...rows.map(r => r.w.y0)) - 30;
    let yMin = Infinity, yMax = -1, xMin = Infinity, xMax = -1;
    for (let y = Math.max(0, Math.floor(tableTop)); y < H; y++) for (let x = 0; x < W; x++) {
      const o = off + 3 * (y * W + x);
      if (ppm[o] > 200 && ppm[o + 1] > 200 && ppm[o + 2] < 120) { yMin = Math.min(yMin, y); yMax = Math.max(yMax, y); xMin = Math.min(xMin, x); xMax = Math.max(xMax, x); }
    }
    if (yMax < 0 || xMax - xMin < 300) fail(ST, title + ': no benchmark box found');
    const boxed = rows.filter(r => r.yc > yMin && r.yc < yMax);
    if (boxed.length !== 1) fail(ST, title + ': benchmark box encloses ' + boxed.length + ' rows');
    const bm = boxed[0];
    // each booklet row must be a plan rated in this area, at the same whole dollars
    const fileVal = r => {
      const b = BOOK_NAMES[r.name];
      if (!b) fail(ST, title + ': unknown carrier "' + r.name + '"');
      const ps = silver.filter(p => p.applicant === b[0] && (!b[1] || p.name === b[1]) && p.areas[ra]);
      if (ps.length !== 1) fail(ST, title + ': ' + r.name + ' matches ' + ps.length + ' silver plans in area ' + ra);
      return ps[0];
    };
    for (const r of rows) {
      r.plan = fileVal(r);
      const v = r.plan.areas[ra][40];
      if (Math.round(v) !== r.p27) fail(ST, title + ': ' + r.name + ' booklet $' + r.p27 + ', file ' + v);
    }
    if (bm.rank !== 2) fail(ST, title + ': the boxed benchmark is rank ' + bm.rank + ', not the second lowest');
    // like with like: the booklet ranks the plans of one ZIP; the builder ranks
    // every plan sold anywhere in the county (in this area for LA). Emit the
    // checks only when the two agree on lowest and second lowest; otherwise say so.
    const ours = benchmark(fips, ra, 40);
    const bookIds = rows.map(r => r.plan.id).sort().join();
    const countyIds = ours.map(o => o.p.id).sort().join();
    const tag = fips === '06037' ? { ra } : { fips };
    const where = title.replace(/ [–-] /, ', ') + ' (booklet p. ' + page + ')';   // no dashes in copy
    const extra = ours.filter(o => !rows.some(r => r.plan.id === o.p.id)).map(o => o.p.issuer);
    const sameTop = ours.length >= 2 && ours[0].p.id === rows[0].plan.id && ours[1].p.id === bm.plan.id;
    if (!sameTop) {
      bookNotes.push(where + ': the booklet\'s ZIP lacks ' + extra.join(', ') + ', which the county ranking includes; its lowest and benchmark are not used as checks.');
      log('  ' + where + ': county ranking differs from the booklet ZIP (extra: ' + extra.join(', ') + '); no check');
      return;
    }
    if (bookIds !== countyIds) log('  ' + where + ': county also has ' + extra.join(', ') + ' (partial), ranking above them unchanged');
    const isPartial = o => (o.p.partial || []).includes(fips);
    const partNote = [ours[0], ours[1]].some(isPartial) ? '; reproduced only when plans sold in part of the county count, as they do in the booklet\'s ZIP (' +
      [ours[0], ours[1]].filter(isPartial).map(o => o.p.issuer).join(', ') + ')' : '';
    if (partNote) partialChecks.push(where.replace(/ \(booklet.*/, ''));
    const src = 'Covered California, 2027 Sample Regional Bronze & Silver Rates for 16 Counties, ' + where + ', single 40 year old, whole dollars';
    checks.push({ what: 'lowest', ...tag, age: 40, premium: rows[0].p27, source: src + ', lowest price (' + rows[0].name + ')' + partNote });
    checks.push({ what: 'slcsp', ...tag, age: 40, premium: bm.p27, source: src + ', marked Benchmark Plan (' + bm.name + ')' + partNote });
  });
} finally { rmSync(tmp, { recursive: true, force: true }); }
if (silverPages !== 17) fail(ST, 'expected 17 silver pages (16 counties, LA twice), found ' + silverPages);

/* ---- samples ---- */
const show = (label, fips, ra) => {
  for (const age of [21, 40]) {
    const v = benchmark(fips, ra, age);
    log('  ' + label + ' age ' + age + ': lowest ' + v[0].v + ' (' + v[0].p.issuer + '), SLCSP ' + v[1].v + ' (' + v[1].p.issuer + ' ' + v[1].p.id + ')');
  }
};
show('LA East (15)', '06037', '15'); show('LA West (16)', '06037', '16');
show('Alameda (6)', '06001', '6'); show('Fresno (11)', '06019', '11');

const partialCount = plans.filter(p => p.partial).length;
writeState({
  state: ST, planYear: 2027, kind: 'plans', final: false, precision: 'cents',
  sources: [
    { title: 'Covered California, 2027 QHP Individual Product Prices (8.18.2026)', url: RATES_URL, published: '2026-09-04' },
    { title: 'Covered California, 2027 Plans by Zip, Individual', url: PBZ_URL, published: '2026-07-21' },
    { title: 'Covered California, 2027 Sample Regional Bronze & Silver Rates for 16 Counties', url: BOOK_URL, published: '2026-10-01' },
    { title: 'Covered California, Data and Research (index of the files above)', url: INDEX },
    { title: 'CMS, California geographic rating areas', url: 'https://www.cms.gov/cciio/programs-and-initiatives/health-insurance-market-reforms/ca-gra' }
  ],
  notes: [
    'California rates are Covered California\'s 2027 individual premiums from its product price file dated 18 August 2026. Covered California calls them preliminary and under regulatory review with the Department of Managed Health Care, and had posted no later rate file when these were read (11 November 2026), so they are marked not final.',
    'The rates are full premiums. For 2026 Covered California also posted a file without the non essential health benefit portion (at most 0.43 percent of a silver premium at age 40 that year); no such file exists for 2027, so the 2027 figures include that small portion.',
    'Covered California numbers its 19 pricing regions as CMS numbers the state\'s rating areas; every ZIP\'s region in the plans by ZIP file was checked against the CMS table, including Los Angeles County\'s split into areas 15 and 16 by the first three digits of the ZIP code. ' + (laUnlistedZips.size ? laUnlistedZips.size + ' Los Angeles County ZIPs (' + [...laUnlistedZips].sort().join(', ') + ') fall under a three digit prefix the CMS table does not list; Covered California places them (' + [...laUnlisted].join(', ') + '), and that is used.' : ''),
    'Where a plan is sold is read from Covered California\'s plans by ZIP file, which lists carriers and networks rather than plans. A plan counts as sold in a county when its network is marked for any ZIP there, and as partial when marked for only some of them (' + partialCount + ' plans are partial somewhere). Sharp\'s two silver plans both belong to its "HMO 1 (Copay)" column: that column counts four products and Sharp has exactly four copay design plans, the two silvers among them.',
    'The checks come from Covered California\'s enroller booklet, which ranks the silver plans of one ZIP in each of 16 counties for a single 40 year old in whole dollars and marks the benchmark. Each booklet premium matches the rate file to the dollar, and the booklet\'s benchmark is always the second lowest. A county\'s booklet figures are used as checks only when the county wide ranking (every plan sold anywhere in the county, or in the area for Los Angeles) has the same lowest and second lowest plans as the booklet\'s ZIP.',
    ...(partialChecks.length ? ['In ' + partialChecks.length + ' of the booklet pages (' + partialChecks.join('; ') + ') the lowest or benchmark plan is one sold in only part of the county. The booklet\'s ZIP is served by it, so those checks hold for a ranking that counts plans sold anywhere in the county; a ranking of only county wide plans would give a different, higher figure there.'] : []),
    ...bookNotes
  ],
  statewide: false,
  plans,
  checks
});
