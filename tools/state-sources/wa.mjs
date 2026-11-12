/* Washington, plan year 2027: the Insurance Commissioner's approved rate schedules.
 *
 * The Office of the Insurance Commissioner approved the 2027 individual-market
 * rates on 9 Sep 2026 and posts one rate schedule PDF per carrier on its
 * "Individual and family health plans & premiums" page (13 carriers; Asuris's
 * was posted in October). Each PDF has one page per plan headed RATE SCHEDULE:
 * HIOS plan ID, exchange status, metal level, the rating areas the plan is
 * offered in with the counties it serves there, and monthly rates to the cent
 * for ages 0-14, 15 to 63 and 64 and over in nine area columns, non-smoker then
 * smoker. A column is BLANK where the plan is not offered, so the rates are read
 * by x position from pdftotext's word boxes, never by token order.
 *
 * Rating areas: the Exchange's own 2027 plan certification packet (board,
 * 10 Sep 2026) prints the nine areas with their counties; the extractor checks
 * that against the CMS wa-gra page (cached 2026 copy) and against every plan
 * page's county list.
 *
 *   node tools/state-sources/wa.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchCached, pdfText, counties, writeState, fail, log, norm, FED_CURVE } from './lib.mjs';

const ST = 'WA';
const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX = 'https://www.insurance.wa.gov/insurance-resources/health-insurance/health-insurance-coverage/individual-and-family-health-plans-premiums';
const PACKET = 'https://www.wahbexchange.org/content/dam/materials/communications/committees-and-workgroups/board/2026/Plan-Cert-Requests_PY2027.pdf';

const cty = counties(ST);
if (cty.all.length !== 39) fail(ST, 'expected 39 counties in the Census file, got ' + cty.all.length);

/* ---- rating areas: CMS wa-gra (cached), confirmed by the Exchange's 2027 packet ---- */
const countyRA = {};
{
  const html = readFileSync(join(HERE, '..', 'cache', 'gra', 'wa.html'), 'utf-8');
  const table = (html.match(/<table[\s\S]*?<\/table>/) || [])[0];
  if (!table) fail(ST, 'no table in the cached wa-gra page');
  for (const tr of table.match(/<tr[\s\S]*?<\/tr>/g).slice(1)) {
    const cells = (tr.match(/<t[dh][\s\S]*?<\/t[dh]>/g) || []).map(c => c.replace(/<[^>]+>|&nbsp;/g, ' ').replace(/\s+/g, ' ').trim());
    const ra = parseInt((cells[0] || '').match(/Rating Area (\d+)/)?.[1], 10);
    if (!Number.isFinite(ra)) continue;
    const f = cty.fipsOf(cells[1]);
    if (countyRA[f] != null) fail(ST, 'county twice on the gra page: ' + cells[1]);
    countyRA[f] = ra;
  }
  const missing = cty.all.filter(f => countyRA[f] == null);
  if (missing.length) fail(ST, 'counties with no rating area: ' + missing.map(cty.nameOf).join(', '));
}
{
  // Packet page 2 is a 3 x 3 grid: "Area n" headings, and beneath each a block
  // "<N> Count(y|ies): a, b, ...". Raw text order scrambles the grid, so the
  // blocks are read from word boxes: a block belongs to the nearest heading
  // column in the last heading row above it.
  const path = fetchCached(ST, PACKET, 'Plan-Cert-Requests_PY2027.pdf');
  const pg = execFileSync('pdftotext', ['-bbox', '-f', '2', '-l', '2', path, '-']).toString();
  if (!/>RATING<\/word>\s*<word[^>]*>AREAS</.test(pg)) fail(ST, 'packet: page 2 is not the rating area page');
  const W = wordsOfPage(pg);
  const heads = [];
  W.forEach((w, i) => { if (w.t === 'Area' && /^\d$/.test((W[i + 1] || {}).t)) heads.push({ n: +W[i + 1].t, x: w.x0, y: w.y0 }); });
  if (heads.map(h => h.n).sort().join() !== '1,2,3,4,5,6,7,8,9') fail(ST, 'packet: headings ' + heads.map(h => h.n));
  const WORD = { One: 1, Two: 2, Three: 3, Four: 4, Five: 5, Six: 6, Seven: 7, Eight: 8, Nine: 9, Ten: 10 };
  const starts = W.map((w, i) => ({ w, i })).filter(({ w, i }) => /^Count(y|ies):$/.test(w.t) && WORD[(W[i - 1] || {}).t]);
  if (starts.length !== 9) fail(ST, 'packet: ' + starts.length + ' county blocks, not 9');
  const colXs = [...new Set(heads.map(h => Math.round(h.x / 10)))].length;
  if (colXs > 4) fail(ST, 'packet: headings do not form three columns');
  const seen = new Set();
  for (const { w, i } of starts) {
    const x0 = W[i - 1].x0, y0 = w.y0;
    const rowY = Math.max(...heads.filter(h => h.y < y0).map(h => h.y));
    const row = heads.filter(h => Math.abs(h.y - rowY) < 2);
    const head = row.reduce((a, b) => Math.abs(b.x - x0) < Math.abs(a.x - x0) ? b : a);
    // the block: words in this column, from this line down 50pt
    // ends where the next column's blocks start
    const right = Math.min(Infinity, ...starts.map(s => W[s.i - 1].x0).filter(x => x > x0 + 20));
    const text = W.filter(v => v.y0 >= y0 - 1 && v.y0 < y0 + 50 && v.x0 >= x0 - 1 && v.x0 < right - 1)
      .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0).map(v => v.t).join(' ');
    const m = text.match(/^(\w+) Count(?:y|ies): (.+)$/);
    const names = m ? m[2].split(',').map(s => s.trim()).filter(Boolean) : [];
    if (!m || names.length !== WORD[m[1]]) fail(ST, 'packet: area ' + head.n + ' block reads "' + text + '"');
    for (const n of names) {
      const f = cty.fipsOf(n);
      if (countyRA[f] !== head.n) fail(ST, 'packet puts ' + n + ' in area ' + head.n + ', CMS wa-gra in ' + countyRA[f]);
      if (seen.has(f)) fail(ST, 'packet lists ' + n + ' twice');
      seen.add(f);
    }
  }
  if (seen.size !== 39) fail(ST, 'packet: the nine areas list ' + seen.size + ' counties, not 39');
  log('rating areas: CMS wa-gra and the Exchange 2027 packet agree on all 39 counties');
}

/* ---- the OIC page: the 2027 rate schedule PDFs ---- */
const page = readFileSync(fetchCached(ST, INDEX, 'individual-and-family-health-plans-premiums.html'), 'utf-8');
const links = [...page.matchAll(/<a [^>]*href="([^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/g)]
  .filter(m => /2027 plan rates/.test(m[2].replace(/<[^>]+>/g, ' ')))
  .map(m => new URL(m[1], INDEX).href);
const PDFS = [...new Set(links)];
// as posted when this extractor was written; a change must be read by a person
const EXPECT_PDFS = [
  '2026-10/asuris-ind-rate-2027.pdf', '2026-09/bridgespan-ind-rate-2027_4.pdf', '2026-09/chpw-ind-rate-2027.pdf',
  '2026-09/coordinated%20care-indv-rate.pdf', '2026-09/kaisernw-ind-rate-2027.pdf', '2026-09/kaiser-foundation-ind-rate-2027.pdf',
  '2026-09/lifewise-ind-rate-2027.pdf', '2026-09/molina-ind-rate-2027.pdf', '2026-09/premera-ind-rate-2027.pdf',
  '2026-09/regence-oregon-ind-rate-2027.pdf', '2026-09/regence-blueshield-ind-rate-2027.pdf', '2026-09/uhc-oregon-ind-rate-2027.pdf',
  '2026-09/wellpoint-ind-rate-2027.pdf',
].map(p => 'https://www.insurance.wa.gov/sites/default/files/' + p);
if (PDFS.slice().sort().join() !== EXPECT_PDFS.slice().sort().join())
  fail(ST, 'the 2027 rate PDF list changed:\n  now ' + PDFS.join('\n      ') + '\n  was ' + EXPECT_PDFS.join('\n      '));

/* ---- one plan page ---- */
const IN = new Set(['In the exchange', 'In the Exchange', 'Inside the Exchange', 'Both inside and outside the exchange']);
const OUT = new Set(['Outside the Exchange', 'Outside the exchange']);
const METALS = new Set(['Bronze', 'Expanded Bronze', 'Silver', 'Gold', 'Platinum', 'Catastrophic']);
const AGE_ROWS = ['0-14', ...Array.from({ length: 49 }, (_, i) => String(i + 15)), '64 and over'];   // 51 rows

function wordsOfPage(bboxPage) {
  return [...bboxPage.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)]
    .map(m => ({ x0: +m[1], y0: +m[2], x1: +m[3], y1: +m[4], t: m[5].replace(/&amp;/g, '&') }));
}
function lines(words) {
  // group by vertical centre: carriers' PDFs set the numbers and the age labels in
  // different fonts, so baselines differ by a point or two within a row
  const out = [];
  for (const w of words.map(w => ({ ...w, c: (w.y0 + w.y1) / 2, h: w.y1 - w.y0 })).sort((a, b) => a.c - b.c)) {
    const l = out.find(l => Math.abs(l.c - w.c) < 0.35 * Math.min(l.h, w.h));
    if (l) l.w.push(w); else out.push({ c: w.c, h: w.h, w: [w] });
  }
  for (const l of out) { l.w.sort((a, b) => a.x0 - b.x0); l.y = l.c; }
  return out.sort((a, b) => a.y - b.y);
}

function parsePlan(text, bboxPage, where) {
  const field = n => {
    const m = text.match(new RegExp('^\\s*' + n + ':[ \\t]+(.+?)\\s*$', 'm'));
    if (!m) fail(ST, where + ': no "' + n + '"');
    return m[1].replace(/\s+/g, ' ');
  };
  if (!/RATE SCHEDULE/.test(text)) fail(ST, where + ': not a RATE SCHEDULE page');
  const plan = {
    name: field('Plan Name'), id: field('HIOS Plan ID'), eff: field('Effective Date'), market: field('Market Type'),
    exchange: field('Exchange Status'), metal: field('Metal Level'), type: field('Plan Type'),
  };
  if (!/^\d{5}WA\d{7}$/.test(plan.id)) fail(ST, where + ': HIOS ID ' + plan.id);
  if (plan.eff !== '1/1/2027') fail(ST, where + ' ' + plan.id + ': effective ' + plan.eff);
  if (plan.market !== 'Individual') fail(ST, where + ' ' + plan.id + ': market ' + plan.market);
  if (!METALS.has(plan.metal)) fail(ST, where + ' ' + plan.id + ': metal level "' + plan.metal + '"');
  if (IN.has(plan.exchange)) plan.onExchange = true;
  else if (OUT.has(plan.exchange)) plan.onExchange = false;
  else fail(ST, where + ' ' + plan.id + ': unknown exchange status "' + plan.exchange + '"');
  // the carrier's name: the line between the header and RATE SCHEDULE
  const top = text.slice(0, text.indexOf('RATE SCHEDULE')).split('\n').map(s => s.trim()).filter(Boolean);
  plan.issuer = top[top.length - 1];
  if (!top[0].includes(plan.id)) fail(ST, where + ': page header ID differs from the HIOS Plan ID ' + plan.id);

  // availability block
  const a0 = text.indexOf('Plan Geographic Availability'), a1 = text.indexOf('Plan Rates');
  if (a0 < 0 || a1 < a0) fail(ST, where + ' ' + plan.id + ': no availability block');
  plan.avail = {};
  for (const line of text.slice(a0, a1).split('\n').slice(1)) {
    if (!line.trim() || /^\s*(Area\s+Available|Number\s+in area\?)/.test(line) || /^\s*Counties where this plan is available\s*$/.test(line)) continue;
    const m = line.match(/^\s*(\d)\s+(Yes|No|N\/A)\s*(.*?)\s*$/);   // Asuris prints N/A for No
    if (!m) fail(ST, where + ' ' + plan.id + ': unreadable availability line "' + line.trim() + '" (a wrapped county list?)');
    if (plan.avail[m[1]]) fail(ST, where + ' ' + plan.id + ': area ' + m[1] + ' listed twice');
    const names = m[3] ? m[3].split(/\s*,\s*(?:and\s+)?|\s+and\s+/).map(s => s.trim()) : [];   // KFHPWA writes "Kitsap and Lewis"
    if ((m[2] === 'Yes') !== (names.length > 0)) fail(ST, where + ' ' + plan.id + ': area ' + m[1] + ' says ' + m[2] + ' with counties "' + m[3] + '"');
    plan.avail[m[1]] = names.map(n => {
      const f = cty.fipsOf(n);
      if (countyRA[f] !== +m[1]) fail(ST, where + ' ' + plan.id + ': ' + n + ' listed under area ' + m[1] + ', CMS puts it in ' + countyRA[f]);
      return f;
    });
  }
  if (Object.keys(plan.avail).sort().join() !== '1,2,3,4,5,6,7,8,9') fail(ST, where + ' ' + plan.id + ': availability does not list areas 1 to 9');

  // rates, by x position
  const L = lines(wordsOfPage(bboxPage));
  const hdr = L.find(l => l.w.filter(w => w.t === 'Area').length === 18);
  if (!hdr) fail(ST, where + ' ' + plan.id + ': no 18-column Area header');
  const cols = [];
  for (let i = 0; i < hdr.w.length - 1; i++) if (hdr.w[i].t === 'Area' && /^\d$/.test(hdr.w[i + 1].t))
    cols.push({ n: +hdr.w[i + 1].t, c: (hdr.w[i].x0 + hdr.w[i + 1].x1) / 2 });
  if (cols.map(c => c.n).join() !== '1,2,3,4,5,6,7,8,9,1,2,3,4,5,6,7,8,9') fail(ST, where + ' ' + plan.id + ': header columns ' + cols.map(c => c.n));
  const ns = L.find(l => l.y < hdr.y && hdr.y - l.y < 40 && l.w.some(w => /^Non-Smoker$/.test(w.t)));
  const sm = ns && ns.w.find(w => w.t === 'Smoker');
  const nsw = ns && ns.w.find(w => w.t === 'Non-Smoker');
  if (!nsw || !sm || !(nsw.x1 < cols[9].c && sm.x0 > cols[8].c)) fail(ST, where + ' ' + plan.id + ': Non-Smoker / Smoker headings not over the two halves');
  const pitch = Math.min(...cols.slice(1).map((c, i) => c.c - cols[i].c));
  let worstOff = 0;
  const rows = {};
  for (const l of L) {
    if (l.y <= hdr.y) continue;
    const label = l.w.filter(w => !/^\d+\.\d\d$/.test(w.t)).map(w => w.t).join(' ');
    if (!AGE_ROWS.includes(label)) continue;
    if (rows[label]) fail(ST, where + ' ' + plan.id + ': age row ' + label + ' twice');
    const cells = Array(18).fill(null);
    for (const w of l.w.filter(w => /^\d+\.\d\d$/.test(w.t))) {
      const mid = (w.x0 + w.x1) / 2;
      const d = cols.map(c => Math.abs(c.c - mid));
      const k = d.indexOf(Math.min(...d));
      worstOff = Math.max(worstOff, d[k] / pitch);
      if (d[k] > 0.4 * pitch) fail(ST, where + ' ' + plan.id + ' age ' + label + ': ' + w.t + ' sits between columns');
      if (cells[k] != null) fail(ST, where + ' ' + plan.id + ' age ' + label + ': two values under one column');
      cells[k] = +w.t;
    }
    rows[label] = cells;
  }
  if (Object.keys(rows).length !== 51) fail(ST, where + ' ' + plan.id + ': ' + Object.keys(rows).length + ' age rows, not 51');
  plan.rates = {};
  for (let k = 0; k < 9; k++) {
    const area = String(k + 1), offered = plan.avail[area].length > 0;
    const nsCol = AGE_ROWS.map(a => rows[a][k]), smCol = AGE_ROWS.map(a => rows[a][k + 9]);
    const filled = nsCol.filter(v => v != null).length, smFilled = smCol.filter(v => v != null).length;
    if (offered ? (filled !== 51 || smFilled !== 51) : (filled || smFilled))
      fail(ST, where + ' ' + plan.id + ' area ' + area + ': offered ' + offered + ' but ' + filled + ' non-smoker and ' + smFilled + ' smoker rates');
    if (!offered) continue;
    if (smCol.some((v, i) => v < nsCol[i])) fail(ST, where + ' ' + plan.id + ' area ' + area + ': a smoker rate below the non-smoker rate');
    const arr = Array(65);
    for (let a = 0; a <= 14; a++) arr[a] = nsCol[0];
    for (let a = 15; a <= 64; a++) arr[a] = nsCol[a - 14];
    plan.rates[area] = arr;
  }
  plan.worstOff = worstOff;
  return plan;
}

/* ---- read every PDF ---- */
const all = [];
let worstOff = 0;
for (const url of PDFS) {
  const name = decodeURIComponent(url.split('/').pop()).replace(/\s+/g, '-');
  const path = fetchCached(ST, url, name);
  const pages = pdfText(path).split('\f').filter(p => p.trim());
  const bpages = execFileSync('pdftotext', ['-bbox', path, '-'], { maxBuffer: 1 << 28 }).toString().split('<page ').slice(1);
  if (pages.length !== bpages.length) fail(ST, name + ': layout and bbox page counts differ');
  pages.forEach((p, i) => {
    const plan = parsePlan(p, bpages[i], name + ' p.' + (i + 1));
    plan.file = name; plan.page = i + 1;
    worstOff = Math.max(worstOff, plan.worstOff);
    all.push(plan);
  });
}
{
  const ids = new Set();
  for (const p of all) { if (ids.has(p.id)) fail(ST, 'plan ' + p.id + ' appears twice'); ids.add(p.id); }
}
log('plan pages read: ' + all.length + ' (worst value offset from its column centre: ' + (worstOff * 100).toFixed(0) + '% of the column pitch)');

const silver = all.filter(p => p.metal === 'Silver' && p.onExchange);
log('silver: ' + all.filter(p => p.metal === 'Silver').length + ' plans, ' + silver.length + ' on the exchange');
if (silver.length !== 16) fail(ST, 'expected 16 on-exchange silver plans, found ' + silver.length);

/* ---- the same 16 the Exchange board certified (packet, resolution Exhibit A) ---- */
{
  const txt = pdfText(fetchCached(ST, PACKET, 'Plan-Cert-Requests_PY2027.pdf'), false);
  const a = txt.indexOf('EXHIBIT A'), b = txt.indexOf('Certifying Qualified Dental Plans');
  if (a < 0 || b < a) fail(ST, 'packet: no Exhibit A to the QHP resolution');
  const certified = txt.slice(a, b).split('\n').map(l => l.trim()).filter(l => /Silver/.test(l));
  const names = silver.map(p => p.name);
  const missing = names.filter(n => !certified.includes(n)), extra = certified.filter(n => !names.includes(n));
  if (missing.length || extra.length || certified.length !== 16)
    fail(ST, 'on-exchange silver plans differ from the certified list: not certified ' + missing.join('; ') + ' / certified but not read ' + extra.join('; '));
  log('the 16 on-exchange silver plans are exactly the 16 silver plans the Exchange board certified');
}

/* ---- self-tests on every silver rate row: the federal default curve ---- */
let worstCurve = 0;
for (const p of silver) for (const [ra, r] of Object.entries(p.rates)) {
  if (Math.abs(r[40] / r[21] - 1.278) > 0.01 / r[21] + 1e-9) fail(ST, p.id + ' area ' + ra + ': age 40 / age 21 = ' + (r[40] / r[21]).toFixed(5) + ', not 1.278');
  for (let a = 0; a < 65; a++) {
    const d = Math.abs(r[a] - r[21] * FED_CURVE[a]);
    worstCurve = Math.max(worstCurve, d);
    // Carriers round at their own intermediate steps (area and plan factors), so a rate
    // is not always the age 21 rate times the factor to the cent: in the 2027
    // schedules the gap is at most 3 cents. Six cents (as for Georgia) still pins the
    // curve: neighbouring factors differ by at least 0.4%, over a dollar here.
    if (d > 0.06) fail(ST, p.id + ' area ' + ra + ' age ' + a + ': ' + r[a] + ' vs ' + (r[21] * FED_CURVE[a]).toFixed(3) + ' on the federal curve');
  }
}
log('every silver rate within ' + worstCurve.toFixed(4) + ' of the age 21 rate times the federal factor');

const plans = silver.map(p => {
  const fips = Object.values(p.avail).flat().sort();
  return { id: p.id, issuer: p.issuer, name: p.name, counties: fips.length === 39 ? 'all' : fips, rates: p.rates };
}).sort((a, b) => a.id < b.id ? -1 : 1);

/* ---- the Exchange's packet: per-plan age 40 premium ranges across areas ---- */
// The packet prints, per plan, "Premium Range: Low $x High $y" (age 40, whole
// dollars, cents dropped) and a county count, as images; these three were read
// off pages 3, 5 and 7 by eye. They are a parse cross-check here, not `checks`:
// a range across areas does not identify any county's benchmark.
const PACKET_RANGES = [
  { id: '53732WA0790025', low: 1066, high: 1221, counties: 14 },   // BridgeSpan Cascade Silver, p. 3
  { id: '18581WA0140002', low: 695, high: 799, counties: 27 },     // CHPW Cascade Select Silver, p. 5
  { id: '61836WA0050017', low: 768, high: 867, counties: 34 },     // Ambetter Cascade Silver, p. 7
];
for (const r of PACKET_RANGES) {
  const p = plans.find(p => p.id === r.id);
  const v = Object.values(p.rates).map(a => a[40]);
  const n = p.counties === 'all' ? 39 : p.counties.length;
  if (Math.floor(Math.min(...v)) !== r.low || Math.floor(Math.max(...v)) !== r.high || n !== r.counties)
    fail(ST, r.id + ': packet range $' + r.low + ' to $' + r.high + ' over ' + r.counties + ' counties, parsed ' + Math.min(...v) + ' to ' + Math.max(...v) + ' over ' + n);
}
log('packet age 40 ranges reproduced for ' + PACKET_RANGES.length + ' plans');

/* ---- sanity print (computed here, not published anywhere: not a check) ---- */
function slcsp(fips, age) {
  const ra = String(countyRA[fips]);
  const c = plans.filter(p => p.counties === 'all' || p.counties.includes(fips)).map(p => ({ v: p.rates[ra][age], p })).sort((a, b) => a.v - b.v);
  return c.length < 2 ? null : { n: c.length, v: c[1].v, lo: c[0].v, plan: c[1].p.issuer + ' ' + c[1].p.name + ' ' + c[1].p.id };
}
for (const n of ['King', 'Spokane', 'Yakima']) {
  const f = cty.fipsOf(n);
  for (const age of [21, 40]) { const s = slcsp(f, age); log('  ' + n + ' (area ' + countyRA[f] + ') age ' + age + ': ' + s.v.toFixed(2) + ' of ' + s.n + ', ' + s.plan); }
}
{
  const k21 = slcsp(cty.fipsOf('King'), 21), k40 = slcsp(cty.fipsOf('King'), 40);
  if (k21.v !== 592.68 || k40.v !== 757.44 || !k21.plan.endsWith('61836WA0050037'))
    fail(ST, 'King County no longer reproduces the research pass (592.68 / 757.44, Ambetter Cascade Select Silver): ' + k21.v + ' / ' + k40.v + ' ' + k21.plan);
}
const thin = cty.all.filter(f => !slcsp(f, 21));
if (thin.length) fail(ST, 'counties with fewer than two on-exchange silver plans: ' + thin.map(cty.nameOf).join(', '));

writeState({
  state: ST, planYear: 2027, kind: 'plans', final: true, precision: 'cents', statewide: false,
  sources: [
    { title: 'Washington Office of the Insurance Commissioner, Individual and family health plans and premiums, 2027 plan rates (13 carrier rate schedules)', url: INDEX, published: '2026-09-09' },
    ...PDFS.map(u => ({ title: 'OIC 2027 individual rate schedule, ' + decodeURIComponent(u.split('/').pop()), url: u, published: u.includes('/2026-10/') ? '2026-10' : '2026-09-09' })),
    { title: 'Washington Health Benefit Exchange, 2027 Qualified Health Plan and Qualified Dental Plan Certification Requests (board packet, rating areas)', url: PACKET, published: '2026-09-10' },
  ],
  notes: [
    'Washington is built from the rate schedules the Insurance Commissioner approved for 2027 and posts per carrier: one page per plan with its HIOS ID, exchange status, the counties it serves in each rating area and its monthly rates to the cent.',
    'Only plans the schedules mark as sold inside the exchange (In the exchange, Inside the Exchange, or Both inside and outside the exchange) are counted; that gives 16 silver plans, the same 16 the Exchange board certified on 10 September 2026.',
    'Availability is by county as each rate schedule prints it. The schedules do not say whether a plan serves only part of a county, so a county listed for a plan counts the plan as available throughout it.',
    'Every silver rate sits on the federal default age curve: within three cents of the age 21 rate times the federal factor (carriers round at their own intermediate steps), and every age 40 rate is the age 21 rate times 1.278 to the cent.',
    'Rating areas are numbered as on the CMS rating area page for Washington, which matches the nine areas printed in the Exchange\'s 2027 certification packet.',
    'Neither the Insurance Commissioner nor the Exchange publishes a 2027 benchmark figure by county, so there is no independent published value to check these against; the packet\'s per-plan premium ranges (age 40, whole dollars, across areas) do not identify a benchmark, but the extractor reproduces three of them as a check on its reading of the schedules.',
  ],
  plans,
  checks: [],
});
