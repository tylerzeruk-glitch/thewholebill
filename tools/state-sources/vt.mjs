/* Vermont, plan year 2027: Vermont Health Connect's own plan and rate chart.
 *
 * Vermont is one rating area with a merged individual and small group market,
 * and it prices by family tier, not by age. Vermont Health Connect (the state
 * exchange, run by DVHA) publishes "2027 Plan Designs & Premiums" (posted
 * 15 Oct 2026, file name FinalRates, after the Green Mountain Care Board's
 * August 2026 rate decisions): one wide page, a column per plan design, and
 * "Premiums by Tier (monthly cost)" rows Single, Couple, Parent and Child(ren),
 * Family for BCBSVT and MVP to the cent. A standardized design is one column
 * carrying both carriers' plans ("BCBSVT Silver Plan - MVP VT Silver 3");
 * carrier-only designs leave the other carrier's cells blank, so the rates are
 * read by x position from word boxes. The exchange's silver brochure prints the
 * silver premiums again; the two must agree.
 *
 * Neither publication gives HIOS IDs, so plans carry stable synthetic IDs.
 *
 *   node tools/state-sources/vt.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchCached, pdfText, counties, writeState, fail, log } from './lib.mjs';

const ST = 'VT';
const HERE = dirname(fileURLToPath(import.meta.url));
const RATES = 'https://info.healthconnect.vermont.gov/sites/vhc/files/documents/2027-PlanDesigns-FinalRates.pdf';
const SILVER = 'https://info.healthconnect.vermont.gov/sites/vhc/files/documents/2027-PCB-Silver.pdf';

const cty = counties(ST);
if (cty.all.length !== 14) fail(ST, 'expected 14 counties in the Census file, got ' + cty.all.length);

/* ---- one rating area: CMS vt-gra (cached) puts every county in area 1 ---- */
{
  const html = readFileSync(join(HERE, '..', 'cache', 'gra', 'vt.html'), 'utf-8');
  const table = (html.match(/<table[\s\S]*?<\/table>/) || [])[0];
  if (!table) fail(ST, 'no table in the cached vt-gra page');
  const seen = new Set();
  for (const tr of table.match(/<tr[\s\S]*?<\/tr>/g).slice(1)) {
    const c = (tr.match(/<t[dh][\s\S]*?<\/t[dh]>/g) || []).map(x => x.replace(/<[^>]+>|&nbsp;/g, ' ').replace(/\s+/g, ' ').trim());
    if (c[0] !== 'Rating Area 1') fail(ST, 'vt-gra row not in area 1: ' + c.join(' | '));
    seen.add(cty.fipsOf(c[1]));
  }
  if (seen.size !== 14) fail(ST, 'vt-gra lists ' + seen.size + ' counties, not 14');
}

/* ---- the tier layout: how the 2026 CMS PUF for Vermont filled the 8 slots ---- */
// The site's tier array is [individual, couple, parent+1, parent+2, parent+3 or more,
// couple+1, couple+2, couple+3 or more]. Vermont's four tiers map as Single, Couple,
// Parent and Child(ren) in all three parent slots, Family in all three couple slots.
// The 2026 build took VT from CMS's SBE PUF; confirm that file used the same mapping.
{
  const dir = join(HERE, '..', 'cache', 'sbe', 'vermontsbepuf2026');
  const f = readdirSync(dir).find(n => /Rates.*\.csv$/.test(n));
  if (!f) fail(ST, 'no cached 2026 VT rates PUF in ' + dir);
  const lines = readFileSync(join(dir, f), 'utf-8').replace(/^﻿/, '').trim().split('\n');
  const split = l => l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map(x => x.replace(/,$/, '').replace(/^"|"$/g, ''));
  const h = split(lines[0]);
  const ix = n => { const i = h.indexOf(n); if (i < 0) fail(ST, '2026 PUF: no column ' + n); return i; };
  const k = ['INDIVIDUAL RATE', 'COUPLE', 'PRIMARY SUBSCRIBER AND ONE DEPENDENT', 'PRIMARY SUBSCRIBER AND TWO DEPENDENTS',
    'PRIMARY SUBSCRIBER AND THREE OR MORE DEPENDENTS', 'COUPLE AND ONE DEPENDENT', 'COUPLE AND TWO DEPENDENTS',
    'COUPLE AND THREE OR MORE DEPENDENTS'].map(ix);
  let n = 0;
  for (const l of lines.slice(1)) {
    const v = k.map(i => +split(l)[i]);
    if (!(v[0] > 0)) continue;
    if (v[2] !== v[3] || v[3] !== v[4] || v[5] !== v[6] || v[6] !== v[7])
      fail(ST, '2026 PUF row does not repeat one parent tier and one family tier: ' + l.slice(0, 120));
    n++;
  }
  if (n < 20) fail(ST, '2026 PUF: only ' + n + ' tier rows');
  log('2026 CMS PUF for VT: ' + n + ' rows, each with one parent tier in slots 3 to 5 and one family tier in slots 6 to 8');
}

/* ---- the chart, by word boxes ---- */
const pdf = fetchCached(ST, RATES, '2027-PlanDesigns-FinalRates.pdf');
const bbox = execFileSync('pdftotext', ['-bbox', pdf, '-']).toString();
if ((bbox.match(/<page /g) || []).length !== 1) fail(ST, 'the chart is no longer one page');
const W = [...bbox.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)]
  .map(m => ({ x0: +m[1], y0: +m[2], x1: +m[3], y1: +m[4], t: m[5].replace(/&amp;/g, '&') }))
  .map(w => ({ ...w, cx: (w.x0 + w.x1) / 2, cy: (w.y0 + w.y1) / 2, h: w.y1 - w.y0 }));
if (!W.some(w => w.t === '2027') || !/2027 Plan Designs/.test(pdfText(pdf, false))) fail(ST, 'not the 2027 chart');

const MONEY = /^\$[\d,]+\.\d\d$/;
const money = W.filter(w => MONEY.test(w.t));
// rows: group money words by vertical centre
const rows = [];
for (const w of money.slice().sort((a, b) => a.cy - b.cy)) {
  const r = rows.find(r => Math.abs(r.cy - w.cy) < 0.4 * w.h);
  if (r) r.w.push(w); else rows.push({ cy: w.cy, w: [w] });
}
if (rows.length !== 8) fail(ST, 'expected 8 premium rows (4 tiers x 2 carriers), found ' + rows.length);
// columns: cluster all money x centres
const xs = money.map(w => w.cx).sort((a, b) => a - b);
const cols = [];
for (const x of xs) { const c = cols[cols.length - 1]; if (c && x - c.max < 15) { c.max = x; c.n++; c.sum += x; } else cols.push({ min: x, max: x, n: 1, sum: x }); }
cols.forEach(c => { c.c = c.sum / c.n; });
if (cols.length !== 19) fail(ST, 'expected 19 plan columns, found ' + cols.length);
const pitch = Math.min(...cols.slice(1).map((c, i) => c.c - cols[i].c));
if (Math.max(...cols.map(c => c.max - c.min)) > 0.3 * pitch) fail(ST, 'a premium column is ragged');
const colOf = (x, tol = 0.3) => { const d = cols.map(c => Math.abs(c.c - x)); const k = d.indexOf(Math.min(...d)); return d[k] < tol * pitch ? k : -1; };

// each row: its carrier label on the left, then the tier labels between the pairs
const TIERS = ['Single', 'Couple', 'Parent and Child(ren)', 'Family'];
const CARRIERS = ['BCBSVT', 'MVP'];
const left = W.filter(w => w.x1 < cols[0].c - 0.5 * pitch);
const grid = { BCBSVT: {}, MVP: {} };   // carrier -> tier -> Array(19)
rows.forEach((r, i) => {
  const carrier = CARRIERS[i % 2], tier = TIERS[i >> 1];
  const label = left.filter(w => Math.abs(w.cy - r.cy) < 0.6 * w.h && CARRIERS.includes(w.t));
  if (label.length !== 1 || label[0].t !== carrier) fail(ST, 'premium row ' + (i + 1) + ' should be ' + carrier + ' ' + tier + ', its label reads ' + label.map(w => w.t).join(' '));
  const cells = Array(19).fill(null);
  for (const w of r.w) {
    const k = colOf(w.cx);
    if (k < 0 || cells[k] != null) fail(ST, carrier + ' ' + tier + ': ' + w.t + ' does not sit in one free column');
    cells[k] = +w.t.replace(/[$,]/g, '');
  }
  grid[carrier][tier] = cells;
});
// the tier labels sit between (or level with) their two carrier rows
for (let t = 0; t < 4; t++) {
  const y0 = rows[2 * t].cy, y1 = rows[2 * t + 1].cy, first = TIERS[t].split(' ')[0];
  const lab = left.find(w => w.t === first && w.cy > y0 - 2 && w.cy < y1 + 2);
  if (!lab) fail(ST, 'tier label "' + TIERS[t] + '" is not beside rows ' + (2 * t + 1) + ' and ' + (2 * t + 2));
}
{
  const caption = W.find(w => w.t === 'Premiums' && W.some(v => v.t === 'Tier' && Math.abs(v.cy - w.cy) < 2));
  if (!caption || caption.cy > rows[0].cy) fail(ST, 'no "Premiums by Tier" caption above the premium rows');
}

/* ---- each column's plan names, from the header block above the deductible row ---- */
const names = cols.map((c, k) => {
  // the deductible row ("Individual / Family") is the first line under the plan names
  const inds = W.filter(w => w.t === 'Individual' && colOf(w.cx, 0.5) === k && w.cy < rows[0].cy);
  if (!inds.length) fail(ST, 'column ' + (k + 1) + ': no deductible row');
  const ind = inds.reduce((a, b) => b.cy < a.cy ? b : a);
  // header words are centred over their column, so a long line's first word sits off centre
  const ws = W.filter(w => colOf(w.cx, 0.5) === k && w.cy < ind.cy - 2).sort((a, b) => a.y0 - b.y0);
  // the name is the block of lines directly above that row: walk up until a gap
  // wider than a line (the group headings such as "BCBSVT Plans Only" sit above it)
  let topY = ws.length ? ws[ws.length - 1].y0 : null;
  for (let i = ws.length - 1; i > 0; i--) { if (topY - ws[i - 1].y0 > 12.5) break; topY = Math.min(topY, ws[i - 1].y0); }
  let hdr = ws.filter(w => w.y0 >= topY - 0.5);
  const hMed = hdr.map(w => w.h).sort((a, b) => a - b)[hdr.length >> 1];
  hdr = hdr.filter(w => !(w.h < 0.8 * hMed && /^\d+$/.test(w.t)));   // footnote superscripts
  const text = hdr.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0).map(w => w.t).join(' ').replace(/\s+/g, ' ').trim();
  const parts = text.split(' - ');
  const out = {};
  for (const p of parts) {
    const carrier = CARRIERS.find(c => p.startsWith(c + ' '));
    if (!carrier || out[carrier]) fail(ST, 'column ' + (k + 1) + ': unreadable header "' + text + '"');
    out[carrier] = p;
  }
  return out;
});

/* ---- plans ---- */
// a carrier's plan exists in a column iff all four of its tier cells are filled
const plans = [];
for (let k = 0; k < 19; k++) for (const carrier of CARRIERS) {
  const v = TIERS.map(t => grid[carrier][t][k]);
  const filled = v.filter(x => x != null).length;
  if (filled && filled !== 4) fail(ST, 'column ' + (k + 1) + ' ' + carrier + ': ' + filled + ' of 4 tiers');
  if (!filled !== !names[k][carrier]) fail(ST, 'column ' + (k + 1) + ' ' + carrier + ': premiums and header disagree on whether it offers a plan');
  if (!filled) continue;
  const name = names[k][carrier];
  const metal = (name.match(/\b(Platinum|Gold|Silver|Bronze)\b/g) || []);
  if (metal.length !== 1) fail(ST, 'column ' + (k + 1) + ': no single metal in "' + name + '"');
  const [single, couple, parent, family] = v;
  // Vermont's tier structure: couple is twice single, parent and child(ren) and
  // family are fixed multiples of single (1.93 and 2.81 in 2026 and 2027)
  if (Math.abs(couple - 2 * single) > 0.011) fail(ST, name + ': couple ' + couple + ' is not twice single ' + single);
  if (Math.abs(parent / single - 1.93) > 0.0005 || Math.abs(family / single - 2.81) > 0.0005)
    fail(ST, name + ': tier ratios ' + (parent / single).toFixed(4) + ' and ' + (family / single).toFixed(4) + ', not 1.93 and 2.81');
  plans.push({ col: k + 1, carrier, name, metal: metal[0], tiers: [single, couple, parent, parent, parent, family, family, family] });
}
log('chart: ' + plans.length + ' plans in 19 columns');
const silver = plans.filter(p => p.metal === 'Silver');

/* what the chart said when this extractor was written; a re-posted chart must be re-read */
const EXPECT = {
  'BCBSVT Silver Plan': 1538.33, 'BCBSVT Silver CDHP Plan': 1596.45, 'BCBSVT Vermont Preferred Silver Plan': 1518.55,
  'BCBSVT Vermont Select Silver CDHP Plan': 1493.07, 'MVP VT Silver 3': 1299.13, 'MVP VT Silver 4 HDHP': 1326.41,
  'MVP VT Plus Silver 1': 1313.33, 'MVP VT Plus Silver 2 HDHP': 1376.37,
};
if (silver.length !== 8 || silver.some(p => EXPECT[p.name] !== p.tiers[0]))
  fail(ST, 'silver plans changed: ' + silver.map(p => p.name + ' ' + p.tiers[0]).join('; '));

/* ---- the silver brochure must print the same premiums ---- */
{
  const txt = pdfText(fetchCached(ST, SILVER, '2027-PCB-Silver.pdf'));
  const i = txt.indexOf('MONTHLY PREMIUMS BY TIERS');
  if (i < 0) fail(ST, 'silver brochure: no MONTHLY PREMIUMS BY TIERS block');
  const block = txt.slice(i).split('\n').slice(1, 16);
  const got = {};   // carrier|tierIndex -> sorted amounts
  let t = -1, pendingCarrier = null;
  const LAB = [/^\s*SINGLE\b/, /^\s*COUPLE\b/, /^\s*PARENT AND CHILD\(REN\)/, /^\s*FAMILY\b/];
  for (const l of block) {
    const lab = LAB.findIndex(re => re.test(l));
    const m = l.match(/^\s*(BCBSVT|MVP)\s+(.*)$/);
    if (m) {
      const amts = [...m[2].matchAll(/\$([\d,]+\.\d\d)/g)].map(x => +x[1].replace(/,/g, '')).sort((a, b) => a - b);
      // carrier rows come in pairs around their tier label: BCBSVT, label, MVP
      if (m[1] === 'BCBSVT') { t++; }
      (got[m[1] + '|' + t] = amts);
    } else if (lab >= 0 && lab !== t) fail(ST, 'silver brochure: tier label ' + TIERS[lab] + ' out of order');
  }
  for (const carrier of CARRIERS) for (let ti = 0; ti < 4; ti++) {
    const ours = silver.filter(p => p.carrier === carrier).map(p => p.tiers[[0, 1, 2, 5][ti]]).sort((a, b) => a - b);
    const theirs = got[carrier + '|' + ti] || [];
    if (ours.join() !== theirs.join()) fail(ST, 'silver brochure ' + carrier + ' ' + TIERS[ti] + ': ' + theirs.join(', ') + ' vs chart ' + ours.join(', '));
  }
  log('silver brochure prints the same 32 silver premiums as the chart');
}

const out = silver.map(p => ({
  id: 'VT:' + p.carrier + ':' + p.name, issuer: p.carrier, name: p.name, counties: 'all', rates: { 1: { tiers: p.tiers } },
}));

/* ---- sanity print (the statewide benchmark the builder will compute) ---- */
{
  const s = silver.slice().sort((a, b) => a.tiers[0] - b.tiers[0]);
  log('  lowest silver: ' + s[0].name + ' ' + s[0].tiers[0] + '; second lowest (statewide benchmark): ' + s[1].name + ' tiers ' + [s[1].tiers[0], s[1].tiers[1], s[1].tiers[2], s[1].tiers[5]].join(' / '));
}

writeState({
  state: ST, planYear: 2027, kind: 'plans', final: true, precision: 'cents', statewide: true,
  sources: [
    { title: 'Vermont Health Connect, 2027 Plan Designs & Premiums for Individuals and Families (final rates)', url: RATES, published: '2026-10-15' },
    { title: 'Vermont Health Connect, 2027 silver plans comparison brochure', url: SILVER, published: '2026-10-15' },
  ],
  notes: [
    'Vermont is one rating area with a merged individual and small group market, and premiums are set by family tier, not by age; the figures are Vermont Health Connect\'s published 2027 premiums by tier, as approved by the Green Mountain Care Board.',
    'Vermont\'s four tiers fill the site\'s eight household slots the same way the 2026 federal file for Vermont did: Single, Couple, Parent and Child(ren) for one parent with any number of children, and Family for a couple with any number of children.',
    'Every plan Vermont Health Connect lists is sold through the exchange; the eight silver plans (four from BCBSVT, four from MVP) are all counted.',
    'The chart gives no HIOS plan IDs, so the plans are identified by carrier and plan name.',
    'Vermont Health Connect publishes no separate benchmark figure, so there is no independent published value to check against; the silver brochure prints the same premiums as the chart and the extractor requires them to agree.',
  ],
  plans: out,
  checks: [],
});
