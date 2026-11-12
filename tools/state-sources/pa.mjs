/* Pennsylvania, plan year 2027: the insurance department's final rate decisions.
 *
 * The Pennsylvania Insurance Department posts one "Rate Change Decision Details"
 * PDF per individual-market insurer. Each embeds the insurer's CMS Rates Table
 * Template (every plan, rating area and age band, to the cent) and the
 * Department's "Plan Design Summary" (each plan's metal, on or off exchange
 * status and the counties it covers). This extractor reads both, keeps the
 * on-exchange silver plans, and checks every plan against the federal default
 * age curve.
 *
 * Checks: Pennie's "2027 Second Lowest Cost Silver Plan (by County)" prints the
 * benchmark per county at age 40, EHB portion only, with the EHB percentage. The
 * script reproduces all 68 rows (Centre County is split by ZIP) before writing.
 *
 *   node tools/state-sources/pa.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchCached, stateDir, pdfText, counties, writeState, fail, log, FED_CURVE } from './lib.mjs';

const ST = 'PA';
const DIR = stateDir(ST);
const BASE = 'https://www.pa.gov/content/dam/copapwp-pagov/en/insurance/documents/posted-filings-reports-orders/aca-health-rate-filings/plan-year-2027/individual-market/';
const INDEX = 'https://www.pa.gov/agencies/insurance/posted-filings-reports-company-orders/posted-product-and-rate-filings/aca-health-rate-filings';
const PENNIE = 'https://agency.pennie.com/wp-content/uploads/2026/10/Second-Lowest-Cost-Silver-Plan-by-County-PY-2027.pdf';
const CODES = ['ah', 'ahs', 'caac', 'ghp', 'gqo', 'hbg', 'highmark', 'hpp', 'khpc', 'khpe', 'oscar', 'pic', 'qcc', 'upmchn', 'upmchp'];
const url = c => BASE + c + '-rate-change-decision-indv-mkt.pdf';

const sh = (cmd, args) => execFileSync(cmd, args, { maxBuffer: 1 << 30 }).toString();
const cents = v => Math.round(v * 100);
const MON = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
const pdfDate = f => {
  const m = sh('pdfinfo', [f]).match(/CreationDate:\s+\w+ (\w+)\s+(\d+) [\d:]+ (\d{4})/);
  if (!m) fail(ST, 'no creation date in ' + f);
  return m[3] + '-' + MON[m[1]] + '-' + m[2].padStart(2, '0');
};

/* ---- geography: CMS rating areas ---- */
const cty = counties(ST);
if (cty.all.length !== 67) fail(ST, 'expected 67 counties, got ' + cty.all.length);
const graFile = join(DIR, '..', '..', '..', 'gra', 'pa.html');
if (!existsSync(graFile)) fail(ST, 'missing the CMS rating-area page ' + graFile);
const areaOf = {};
for (const tr of readFileSync(graFile, 'utf-8').match(/<tr[\s\S]*?<\/tr>/g)) {
  const c = [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map(m => m[1].replace(/<[^>]+>/g, '').trim());
  const m = c[0] && c[0].match(/^Rating Area (\d+)$/);
  if (!m) continue;
  const f = cty.fipsOf(c[1]);
  if (areaOf[f]) fail(ST, 'county twice on the CMS page: ' + c[1]);
  areaOf[f] = +m[1];
}
if (cty.all.some(f => !areaOf[f])) fail(ST, 'CMS page lacks ' + cty.all.filter(f => !areaOf[f]).map(cty.nameOf).join(', '));
const NAREA = Math.max(...Object.values(areaOf));
if (NAREA !== 9) fail(ST, 'expected 9 rating areas, got ' + NAREA);
const BYNAME = {};   // lower-case bare name -> fips (Highmark prints "Mckean")
for (const f of cty.all) BYNAME[cty.nameOf(f).replace(/ County$/, '').toLowerCase()] = f;
const COUNTY = new Proxy({}, { get: (_, k) => (typeof k === 'string' ? BYNAME[k.toLowerCase()] : undefined) });

/* ---- the Department's coverage-area page: the counties each insurer serves in 2027 ---- */
const COVURL = 'https://www.pa.gov/agencies/insurance/posted-filings-reports-company-orders/posted-product-and-rate-filings/aca-health-rate-filings/coverage-areas-individual-market';
const COVID = { ah: 'ahp', ahs: 'ahsp', caac: 'caac', ghp: 'ghp', gqo: 'gqo', hbg: 'hbg', highmark: 'hig', hpp: 'hpp', khpc: 'khpc', khpe: 'khpe', oscar: 'ohpp', pic: 'pic', qcc: 'qccic', upmchn: 'uhoi', upmchp: 'uhpi' };
const coverage = {}, legalName = {};
{
  const h = readFileSync(fetchCached(ST, COVURL, 'coverage-areas.html'), 'utf-8');
  if (!/Coverage Areas for 2027 Individual Market Plans/.test(h)) fail(ST, 'the coverage-area page is not the 2027 individual market page');
  for (const m of h.matchAll(/<a id=\\?"coverage-indv-([a-z0-9-]+)\\?"><\/a>([\s\S]*?)<\/p>/g)) {
    const t = m[2].replace(/<[^>]+>/g, '').replace(/&nbsp;|\u00a0/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    const lm = t.match(/covers the following Pennsylvania counties in 2027:\s*(.+?)\.?$/) || t.match(/covers (.+?) in 2027\.?$/);
    if (!lm) fail(ST, 'coverage page: cannot read ' + m[1] + ': ' + t.slice(0, 120));
    const names = lm[1].replace(/\band\b/g, ',').split(',').map(x => x.trim().replace(/ County$/, '')).filter(Boolean);
    const fs = names.map(n => COUNTY[n]);
    if (fs.some(f => !f)) fail(ST, 'coverage page: unknown county in ' + m[1] + ': ' + names.filter(n => !COUNTY[n]).join(', '));
    if (coverage[m[1]]) fail(ST, 'coverage page lists ' + m[1] + ' twice');
    coverage[m[1]] = new Set(fs);
    legalName[m[1]] = t.match(/^(.+?) covers /)[1].replace(/ \(formerly [^)]*\)/, '');
  }
  for (const id of Object.values(COVID)) if (!coverage[id]) fail(ST, 'coverage page lacks ' + id);
}

/* ---- the index must still list exactly these decision documents ---- */
const idx = readFileSync(fetchCached(ST, INDEX, 'index.html'), 'utf-8');
const listed = [...new Set([...idx.matchAll(/plan-year-2027\/individual-market\/([a-z0-9]+)-rate-change-decision-indv-mkt\.pdf/g)].map(m => m[1]))].sort();
if (listed.join() !== [...CODES].sort().join()) fail(ST, 'the Department lists ' + listed.join(', ') + ' for 2027 individual market');

/* ---- PDF words, page by page ---- */
function pages(f) {
  const xml = execFileSync('pdftotext', ['-bbox', f, '-'], { maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'ignore'] }).toString().replace(/[​‌‍﻿]/g, '');
  return xml.split('<page ').slice(1).map(p => [...p.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)]
    .map(m => ({ x0: +m[1], y0: +m[2], x1: +m[3], y1: +m[4], h: +m[4] - +m[2], w: m[5].replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").trim() }))
    .filter(w => w.w));
}
const PID = /^\d{5}PA\d{7}$/;
const ANNUAL = '1/1/2027-12/31/2027';
const AGES = ['0-14', ...Array.from({ length: 49 }, (_, i) => String(15 + i)), '64+'];

/* Rates Table Template rows: plan ID, "Rating Area n", tobacco, age, rate(s).
 * Some insurers' tables print the area and age cells a fraction of a point off
 * the row, so every word goes to the plan-ID row nearest it vertically. */
function rateRows(pgs, code) {
  const out = {};   // plan|ra -> { age: rate }
  let eff = null, n = 0;
  for (const ws of pgs) {
    const txt = ws.map(w => w.w).join(' ');
    // the Rates Table Template's own header: "Rate Effective Date*" with its value on the same line
    const dateBy = kind => ws.filter((w, i) => w.w === 'Date*' && ws[i - 1] && ws[i - 1].w === kind && ws[i - 2] && ws[i - 2].w === 'Rate').map(L => {
      const v = ws.filter(w => /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(w.w) && Math.abs(w.y0 - L.y0) < 0.6 * (L.y1 - L.y0) && w.x0 > L.x1).sort((a, b) => a.x0 - b.x0);
      if (!v.length) fail(ST, code + ': a Rates Table Template header without a ' + kind + ' date, page ' + (pgs.indexOf(ws) + 1));
      const [mo, dy, yr] = v[0].w.split('/').map(Number);
      return mo + '/' + dy + '/' + (yr < 100 ? 2000 + yr : yr);
    });
    const e1 = dateBy('Effective'), e2 = dateBy('Expiration');
    if (e1.length !== e2.length || e1.length > 1) fail(ST, code + ': Rates Table Template dates unreadable, page ' + (pgs.indexOf(ws) + 1));
    if (e1.length) eff = e1[0] + '-' + e2[0];   // a sheet's rates apply from its effective to its expiration date
    const ids = ws.filter(w => PID.test(w.w));
    if (!ids.length || !/Tobacco/.test(txt) || !/Area/.test(txt)) continue;
    const near = (id, re) => ws.some(w => re.test(w.w) && Math.abs(w.y0 - id.y0) < 1.5 * id.h && w.x0 > id.x0);
    // a template row: one plan ID on its line, with a rating area and a tobacco cell
    const isRow = id => near(id, /^Area$/) && near(id, /^User(\/Non-Tobacco)?$/) && !ids.some(o => o !== id && Math.abs(o.y0 - id.y0) < 0.5 * id.h);
    const rows = ids.filter(isRow).map(id => ({ id, words: [] }));
    if (!rows.length) continue;
    for (const w of ws) {
      if (PID.test(w.w)) continue;
      let best = null, bd = Infinity, b2 = Infinity;
      for (const r of rows) { const d = Math.abs(w.y0 - r.id.y0); if (d < bd) { b2 = bd; bd = d; best = r; } else if (d < b2) b2 = d; }
      if (!best || bd >= 1.5 * best.id.h || w.x0 <= best.id.x0) continue;
      if (b2 - bd < 0.2 * best.id.h && /Area|Tobacco|^\d|over/.test(w.w)) fail(ST, code + ': cannot tell which row "' + w.w + '" belongs to, page ' + (pgs.indexOf(ws) + 1));
      best.words.push(w);
    }
    for (const r of rows) {
      const t = r.words.sort((a, b) => a.x0 - b.x0).map(w => w.w);
      const s = t.join(' ');
      const am = s.match(/Rat\s*i?\s*ng\s+Area\s+(\d+)/);
      // not a Rates Table Template row (a missing real row fails the 51-band check below)
      if (!am || !/Tobacco User\/Non-Tobacco User|Tobacco User/.test(s)) continue;
      const rest = s.slice(s.indexOf(am[0]) + am[0].length);
      const rates = [...rest.matchAll(/(?:^|\s)([\d,]+\.\d\d)(?=\s|$)/g)].map(m => +m[1].replace(/,/g, ''));
      const ageM = rest.replace(/[\d,]+\.\d\d/g, ' ').match(/(?:^|\s)(0-14|\d{2})(\s+and\s+over)?(?=\s|$)/);
      if (!ageM || !rates.length || rates.length > 2) fail(ST, code + ': cannot read row ' + r.id.w + ': ' + s);
      const age = ageM[2] ? '64+' : ageM[1];
      if (!AGES.includes(age)) fail(ST, code + ': age "' + age + '" in row ' + r.id.w);
      if (!eff) fail(ST, code + ': a rates row before any Rate Effective Date, page ' + (pgs.indexOf(ws) + 1) + ': ' + s);
      const k = r.id.w + '|' + am[1] + '|' + eff;
      out[k] ||= {};
      if (out[k][age] != null && out[k][age] !== rates[0]) fail(ST, code + ': two rates for ' + k + ' age ' + age);
      out[k][age] = rates[0]; n++;
    }
  }
  return { out, n };
}

/* Plan Design Summary: HIOS Plan ID, name, product, metal, on/off exchange,
 * network, rating area(s), counties covered (a comma list that may wrap). */
function designRows(pgs, code, ratedAreas) {
  const plans = {}, modes = {};
  for (const ws of pgs) {
    const hios = ws.find(w => w.w === 'HIOS' && ['Counties', 'Metal', 'Product', 'Network'].every(h => ws.some(v => v.w === h && Math.abs(v.y0 - w.y0) < 3)));
    if (!hios) continue;
    const pageNo = pgs.indexOf(ws) + 1;
    const H = {};
    for (const h of ['Name', 'Product', 'Metal', 'Exchange', 'Network', 'Area', 'Counties']) {
      const c = ws.filter(v => v.w === h && Math.abs(v.y0 - hios.y0) < 3);
      if (c.length !== 1) fail(ST, code + ': Plan Design Summary header "' + h + '" found ' + c.length + ' times, page ' + pageNo);
      H[h] = c[0];
    }
    const order = ['Name', 'Product', 'Metal', 'Exchange', 'Network', 'Area', 'Counties'];
    for (let i = 1; i < order.length; i++) if (H[order[i]].x0 <= H[order[i - 1]].x1) fail(ST, code + ': Plan Design Summary headers out of order, page ' + pageNo);
    // values sit left of their centred headers, so a column runs from the previous header's right edge to its own
    const col = w => w.x0 > H.Area.x1 ? 'counties' : w.x0 > H.Network.x1 ? 'ra' : w.x0 > H.Exchange.x1 ? 'network'
      : w.x0 > H.Metal.x1 ? 'ex' : w.x0 > H.Product.x1 ? 'metal' : w.x0 > H.Name.x1 ? 'product' : 'name';
    const ids = ws.filter(w => PID.test(w.w) && w.y0 > hios.y0 + 3 && w.x1 < H.Name.x0 + 20).sort((a, b) => a.y0 - b.y0);
    if (!ids.length) continue;
    const mid = w => (w.y0 + w.y1) / 2;
    const hgt = ids[0].y1 - ids[0].y0;
    const body = ws.filter(w => w.y0 > hios.y0 + 3 && w.x0 >= ids[0].x0 - 2 && !PID.test(w.w)).sort((a, b) => a.y0 - b.y0);
    // blocks: runs of lines with no vertical gap wider than two word heights
    const blocks = [];
    for (const w of [...body, ...ids].sort((a, b) => a.y0 - b.y0)) {
      const b = blocks[blocks.length - 1];
      if (b && w.y0 - b.bottom <= 2 * hgt) { b.words.push(w); b.bottom = Math.max(b.bottom, w.y0); }
      else blocks.push({ words: [w], bottom: w.y0 });
    }
    const blockOf = new Map();
    for (const b of blocks) for (const w of b.words) blockOf.set(w, b);
    // Which plan a word belongs to depends on how the spreadsheet aligned its cells:
    // centred on the plan's line, or bottom aligned (Excel's default) so every cell
    // ends on it, or top aligned. Each reading is tried, and the page is accepted
    // only under a reading in which every plan's cells are internally consistent.
    const pick = {
      center: (w, cand) => cand.reduce((p, c) => (Math.abs(mid(c) - mid(w)) < Math.abs(mid(p) - mid(w)) ? c : p)),
      bottom: (w, cand) => cand.find(c => mid(c) >= mid(w) - 0.5 * hgt) || null,
      top: (w, cand) => [...cand].reverse().find(c => mid(c) <= mid(w) + 0.5 * hgt) || null,
    };
    const read = mode => {
      const cells = ids.map(() => ({ name: [], product: [], metal: [], ex: [], network: [], ra: [], counties: [] }));
      for (const w of body) {
        const cand = ids.filter(id => blockOf.get(id) === blockOf.get(w));
        let id = cand.length ? pick[mode](w, cand) : null;
        if (!id) {
          // a page header or footer: never part of a cell
          if (COUNTY[w.w.replace(/,$/, '')] || /^(Silver|Rating|On\/Off|Off)$/.test(w.w)) return null;
          continue;
        }
        const k = ids.indexOf(id);
        let cl = col(w);
        if (w.x0 < ids[k].x1 && cl === 'name') continue;
        if (cl === 'ra' && !/^(Rating|Area|\d(,\d)*,?)$/.test(w.w)) cl = 'network';   // a long network name runs on
        cells[k][cl].push(w);
      }
      const rd = a => a.sort((p, q) => (Math.abs(p.y0 - q.y0) < 2 ? p.x0 - q.x0 : p.y0 - q.y0)).map(w => w.w);
      return ids.map((id, i) => {
        const c = cells[i];
        const line = a => a.filter(w => Math.abs(mid(w) - mid(id)) < 3).map(w => w.w).join(' ');
        const metal = line(c.metal), ex = line(c.ex);
        const cw = rd(c.counties).flatMap(w => w.split(/(?<=,)(?=\S)/)).filter(w => w !== 'and');
        let defect = cw.length ? null : 'no counties';
        const ras = rd(c.ra).join(' ').replace(/Rating Area/g, ' ').replace(/,/g, ' ').trim();
        if (!/^\d( +\d)*$/.test(ras)) defect ||= 'rating area cell reads "' + rd(c.ra).join(' ') + '"';
        const raList = [...ras.matchAll(/\d/g)].map(Number).sort();
        if (cw.length === 1 && cw[0] === 'All') cw.splice(0, 1, ...cty.all.filter(f => raList.includes(areaOf[f])).map(f => cty.nameOf(f).replace(/ County$/, '')).map((n, j, a) => n + (j < a.length - 1 ? ',' : '')));
        cw.forEach((w, j) => {
          if (!COUNTY[w.replace(/,$/, '')]) defect ||= '"' + w + '" is not a Pennsylvania county';
          if ((j < cw.length - 1) !== w.endsWith(',')) defect ||= 'the county list does not read as one comma list: ' + cw.join(' ');
        });
        const counties = cw.map(w => COUNTY[w.replace(/,$/, '')]).filter(Boolean);
        if (!defect && counties.some(f => !raList.includes(areaOf[f]))) defect = 'a county lies outside the listed rating areas';
        if (!defect && raList.some(r => !counties.some(f => areaOf[f] === r))) defect = 'a listed rating area has no county';
        if (!defect && ratedAreas[id.w] && ratedAreas[id.w].join() !== raList.join()) defect = 'lists rating areas ' + raList.join(',') + ' but is rated in ' + ratedAreas[id.w].join(',');
        return { id: id.w, metal, ex, defect, counties: [...new Set(counties)].sort(), ras: raList, nameLine: rd(c.name).join(' ').replace(/\s+/g, ' ') };
      });
    };
    const tried = Object.keys(pick).map(m => ({ m, r: read(m) })).filter(t => t.r);
    if (!tried.length) fail(ST, code + ': page ' + pageNo + ': Plan Design Summary text outside any plan under every reading');
    const score = t => t.r.filter(p => !p.defect).length;
    const best = Math.max(...tried.map(score));
    const winners = tried.filter(t => score(t) === best);
    const key = p => JSON.stringify([p.counties, p.ras, p.defect]);
    // the plans that matter must read the same under every best reading
    const kept = winners[0].r.filter(p => p.metal === 'Silver' && p.ex !== 'Off').map(p => p.id);
    for (const t of winners.slice(1)) for (const id of kept) if (key(t.r.find(p => p.id === id)) !== key(winners[0].r.find(p => p.id === id))) fail(ST, code + ': page ' + pageNo + ': ' + id + ' reads differently as ' + winners[0].m + ' and ' + t.m + ' aligned');
    modes[winners.map(t => t.m).join('/')] = (modes[winners.map(t => t.m).join('/')] || 0) + 1;
    for (const p of winners[0].r) {
      if (plans[p.id] && key(plans[p.id]) !== key(p)) fail(ST, code + ': ' + p.id + ' twice in the Plan Design Summary, differently');
      plans[p.id] = p;
    }
  }
  return { plans, modes };
}

/* The CMS Unified Rate Review Template, Worksheet 2, also in each decision: one
 * column per plan with "1.5 Metal" and "1.9 Exchange Plan?". Read from the layout
 * text, where the n-th value on a row belongs to the n-th plan ID; a block whose
 * rows do not carry one value per plan is skipped rather than guessed. */
function urrt(f) {
  const lines = pdfText(f).replace(/[​‌‍﻿]/g, '').split('\n');
  const out = {};
  lines.forEach((l, i) => {
    const m = l.match(/^\s*1\.4 Plan ID \(Standard Component ID\)\s+(.*)$/);
    if (!m) return;
    const ids = m[1].trim().split(/\s+/);
    if (!ids.every(x => PID.test(x))) return;
    const row = re => { const k = lines.slice(i + 1, i + 12).find(x => re.test(x)); return k ? k.replace(re, '') : null; };
    const met = row(/^\s*1\.5 Metal\s+/), ex = row(/^\s*1\.9 Exchange Plan\?\s+/);
    if (!met || !ex) return;
    const mv = [...met.matchAll(/Expanded Bronze|Bronze|Silver|Gold|Platinum|Catastrophic/g)].map(x => x[0]);
    const ev = ex.trim().split(/\s+/);
    if (mv.length !== ids.length || ev.length !== ids.length || !ev.every(x => /^(Yes|No)$/.test(x))) return;
    ids.forEach((id, j) => {
      const v = { metal: mv[j], ex: ev[j] };
      if (out[id] && JSON.stringify(out[id]) !== JSON.stringify(v)) fail(ST, 'URRT lists ' + id + ' twice, differently');
      out[id] = v;
    });
  });
  return out;
}

/* ---- read every insurer ---- */
const plans = [], sources = [], omitted = [], clipped = [], quarterly = [];
let nOn = 0, urrtAgree = 0;
const curveDev = {}, perIssuer = [];
for (const code of CODES) {
  const f = fetchCached(ST, url(code), code + '.pdf');
  const pgs = pages(f);
  const first = pgs[0].map(w => w.w).join(' ');
  const nm = first.match(/Rate Decision\W+2027.*?www\.insurance\.pa\.gov\s+(.+?)\s+\W\s+Individual Plans/);
  if (!nm) fail(ST, code + ': not a 2027 individual rate decision');
  const issuer = legalName[COVID[code]];   // the decision headings abbreviate some ("KHPE", "QCC")
  // the decision itself: the Department states the approved average change
  const dec = pgs.slice(0, 4).map(p => p.map(w => w.w).join(' ')).join(' ');
  if (!/average final rate change\s+approved for this insurer is\s+-?[\d.]+%?,/.test(dec)) fail(ST, code + ': no approved rate change stated');
  sources.push({ title: 'Pennsylvania Insurance Department, Rate Decision 2027, ' + nm[1] + ', individual plans', url: url(code), published: pdfDate(f) });

  const { out: R, n } = rateRows(pgs, code);
  const effs = [...new Set(Object.keys(R).map(k => k.split('|')[2]))];
  const ratedAreas = {};
  for (const k of Object.keys(R)) { const [id, ra, e] = k.split('|'); if (e === ANNUAL) (ratedAreas[id] ||= []).push(+ra); }
  for (const id in ratedAreas) ratedAreas[id].sort();
  const { plans: D, modes } = designRows(pgs, code, ratedAreas);
  if (!effs.includes(ANNUAL)) fail(ST, code + ': no rates for all of 2027 (' + effs.join(', ') + ')');
  const rated = new Set(Object.keys(R).filter(k => k.endsWith('|' + ANNUAL)).map(k => k.split('|')[0]));
  // plans rated only on part-year sheets: individual-market rates are fixed for the plan year
  // (45 CFR 147.102 and 156.80(d)), so these cannot be exchange plans; they must also be absent
  // from the Plan Design Summary
  const partYear = [...new Set(Object.keys(R).map(k => k.split('|')[0]))].filter(id => !rated.has(id));
  for (const id of partYear) if (D[id]) fail(ST, code + ': ' + id + ' has only part-year rates but is in the Plan Design Summary');
  if (partYear.length) quarterly.push(code + ': ' + partYear.length + ' plans (' + partYear.join(', ') + ') on sheets ' + effs.filter(e => e !== ANNUAL).join(', '));
  const U = urrt(f);
  let fromUrrt = 0;
  for (const id of rated) {
    if (D[id]) {
      // where Worksheet 2 was readable it must agree with the Plan Design Summary
      const u = U[id];
      if (u && ((u.metal === 'Silver') !== (D[id].metal === 'Silver') || (u.ex === 'Yes') !== (D[id].ex !== 'Off'))) fail(ST, code + ': ' + id + ' is ' + D[id].metal + ' ' + D[id].ex + ' in the Plan Design Summary but ' + u.metal + ', exchange ' + u.ex + ' in the URRT');
      continue;
    }
    // a rated plan the Plan Design Summary omits must be shown off exchange or not silver
    const u = U[id];
    if (!u) fail(ST, code + ': ' + id + ' has rates but appears in neither the Plan Design Summary nor a readable URRT Worksheet 2');
    if (u.metal === 'Silver' && u.ex === 'Yes') fail(ST, code + ': ' + id + ' is an exchange silver plan missing from the Plan Design Summary, so its counties are unknown');
    fromUrrt++; omitted.push(code + ' ' + id + ' (' + u.metal + ', exchange ' + u.ex + ')');
  }
  let kept = 0;
  for (const p of Object.values(D)) {
    if (!rated.has(p.id)) fail(ST, code + ': ' + p.id + ' is in the Plan Design Summary but has no rates for all of 2027');
    if (U[p.id]) urrtAgree++;
    if (!['On/Off', 'Off', 'On'].includes(p.ex)) fail(ST, code + ': exchange "' + p.ex + '" for ' + p.id);
    if (p.metal !== 'Silver' || p.ex === 'Off') { if (p.defect) log('  ' + code + ': ' + p.id + ' (' + p.metal + ', ' + p.ex + ', not used): ' + p.defect.slice(0, 90)); continue; }
    const cov = coverage[COVID[code]];
    if (p.defect) {
      // Excel printed some county cells clipped. Such a plan is placed in every county the
      // Department lists for the insurer within the plan's rated areas, and only when every
      // county that is legible in its cell is on that list.
      if (!p.counties.length || p.counties.some(f => !cov.has(f))) fail(ST, code + ': ' + p.id + ': ' + p.defect);
      const ra = ratedAreas[p.id] || [];
      p.counties = [...cov].filter(f => ra.includes(areaOf[f])).sort();
      p.ras = ra;
      clipped.push(code + ' ' + p.id);
    }
    if (p.counties.some(f => !cov.has(f))) fail(ST, code + ': ' + p.id + ' lists ' + p.counties.filter(f => !cov.has(f)).map(cty.nameOf).join(', ') + ', which the coverage page does not give the insurer');
    const rates = {};
    for (let ra = 1; ra <= NAREA; ra++) {
      const r = R[p.id + '|' + ra + '|' + ANNUAL];
      if (!r) continue;
      const miss = AGES.filter(a => r[a] == null);
      if (miss.length) fail(ST, code + ': ' + p.id + ' area ' + ra + ' lacks ages ' + miss.join(','));
      const v = Array.from({ length: 65 }, (_, a) => (a <= 14 ? r['0-14'] : a === 64 ? r['64+'] : r[String(a)]));
      // the federal default curve: the smallest d such that one base rate puts every
      // printed age rate within d of base times the curve (rounding alone gives 0.005)
      const fits = d => { let lo = 0, hi = Infinity; v.forEach((x, a) => { lo = Math.max(lo, (x - d) / FED_CURVE[a]); hi = Math.min(hi, (x + d) / FED_CURVE[a]); }); return lo <= hi; };
      let dlo = 0, dhi = 1;
      if (!fits(dhi)) fail(ST, code + ': ' + p.id + ' area ' + ra + ' is not on the federal age curve (age 21 ' + v[21] + ', age 64 ' + v[64] + ')');
      for (let it = 0; it < 30; it++) { const m = (dlo + dhi) / 2; if (fits(m)) dhi = m; else dlo = m; }
      if (dhi > 0.0151) fail(ST, code + ': ' + p.id + ' area ' + ra + ' strays ' + dhi.toFixed(4) + ' from the federal age curve');
      curveDev[code] = Math.max(curveDev[code] || 0, dhi);
      rates[ra] = v;
    }
    const bad = p.counties.filter(c => !rates[areaOf[c]]);
    if (bad.length) fail(ST, code + ': ' + p.id + ' covers ' + bad.map(cty.nameOf).join(', ') + ' but has no rate for that area');
    for (const ra of Object.keys(rates)) if (!p.counties.some(c => areaOf[c] === +ra)) fail(ST, code + ': ' + p.id + ' is rated in area ' + ra + ' but covers no county there');
    if (Object.keys(rates).map(Number).sort().join() !== p.ras.join()) fail(ST, code + ': ' + p.id + ' lists rating areas ' + p.ras.join(',') + ' but is rated in ' + Object.keys(rates).join(','));
    if (/child/i.test(p.nameLine)) fail(ST, code + ': ' + p.id + ' looks child only: ' + p.nameLine);
    plans.push({ id: p.id, issuer, name: p.nameLine, counties: [...new Set(p.counties)].sort(), rates });
    kept++;
  }
  nOn += kept;
  perIssuer.push(code + ' ' + kept);
  log('  ' + code.padEnd(9) + issuer.slice(0, 48).padEnd(49) + Object.keys(D).length + ' plans, ' + kept + ' on-exchange silver, ' + n + ' rate rows, curve within ' + (curveDev[code] || 0).toFixed(4) + ', PDS read ' + JSON.stringify(modes) + (effs.length > 1 ? ' (sheets ' + effs.join(', ') + '; the full-year sheet used)' : ''));
}
const dup = plans.map(p => p.id).filter((id, i, a) => a.indexOf(id) !== i);
if (dup.length) fail(ST, 'plans filed twice: ' + dup.join(', '));
log('  ' + plans.length + ' on-exchange silver plans; URRT Worksheet 2 read for ' + urrtAgree + ' Plan Design Summary plans and agrees on every one');
if (omitted.length) log('  rated, absent from the Plan Design Summary, shown by the URRT not to be exchange silver: ' + omitted.join('; '));
if (clipped.length) log('  county cells printed clipped, counties from the coverage page: ' + clipped.join(', '));
if (quarterly.length) log('  part-year rate sheets, not used: ' + quarterly.join('; '));

/* ---- Pennie's benchmark table, and the reproduction of every row ---- */
const pf = fetchCached(ST, PENNIE, 'pennie-slcsp-2027.pdf');
const ptxt = pdfText(pf);
if (!/Pennie 2027 - Second Lowest Cost Silver Plan \(by County\)/.test(ptxt) || !/EHB Portion Only/.test(ptxt)) fail(ST, 'Pennie PDF title or basis changed');
const rows = [];
ptxt.split('\f').forEach((pg, i) => {
  for (const m of pg.matchAll(/^\s*([A-Z][A-Za-z]+)?\s+(42\d{3})\s+\$([\d,]+\.\d\d)\s+([\d.]+)%\s+(\d{5}PA\d{7})_Rating Area (\d)\s+(.+?)\s+\$([\d,]+\.\d\d)\s+\$([\d,]+\.\d\d)\s+(YES|NO)\s*$/gm)) {
    const [, name, fips, , ehb, plan, ra, who, , a40] = m;
    if (name && COUNTY[name] !== fips) fail(ST, 'Pennie: ' + name + ' is not ' + fips);
    if (+ra !== areaOf[fips]) fail(ST, 'Pennie: ' + fips + ' in area ' + ra + ', CMS says ' + areaOf[fips]);
    rows.push({ fips, ehb: +ehb / 100, ehbTxt: ehb, plan, ra: +ra, who: who.replace(/\s{2,}/g, ' | '), a40: +a40.replace(/,/g, ''), page: i + 1 });
  }
});
if (rows.length !== 68) fail(ST, 'Pennie table parsed ' + rows.length + ' rows, expected 68');
const centre = rows.filter(r => r.fips === COUNTY.Centre);
if (centre.length !== 2 || !/zip 16801/.test(ptxt) || !/zip 16677/.test(ptxt)) fail(ST, 'Pennie: expected Centre split into two ZIP rows');
if (cty.all.some(f => !rows.some(r => r.fips === f))) fail(ST, 'Pennie lacks a county');

const at40 = f => plans.filter(p => p.counties.includes(f) && p.rates[areaOf[f]]).map(p => ({ id: p.id, v: p.rates[areaOf[f]][40] })).sort((a, b) => a.v - b.v);
/* Pennie prints the EHB share to two decimals or fewer ("99.8%"), so the product of a
 * printed share and a premium can miss Pennie's figure by up to half a unit of the last
 * printed digit times the premium. Each row is classed:
 *   exact     our second lowest silver times the printed share is Pennie's figure to the cent
 *   rounding  the same plan, within the rounding of the printed share
 *   ranking   Pennie's plan is priced as we price it, but it is not our second lowest by
 *             full premium (Pennie ranks by the EHB portion, which reorders plans whose
 *             premium includes adult dental or vision)
 *   price     Pennie's plan is priced differently from the Department's decision        */
const half = t => 0.5 * 10 ** -((t.split('.')[1] || '').length) / 100;
for (const r of rows) {
  const v = at40(r.fips), own = v.find(x => x.id === r.plan);
  const bound = q => q * half(r.ehbTxt) + 0.005 + 1e-6;
  r.ours = v[1];
  if (!own) r.cls = 'price';
  else if (Math.abs(own.v * r.ehb - r.a40) > bound(own.v)) { r.cls = 'price'; r.ratio = r.a40 / r.ehb / own.v; }
  else if (v[1].id !== r.plan && v[1].v !== own.v) r.cls = 'ranking';
  else r.cls = Math.abs(v[1].v * r.ehb - r.a40) <= 0.005 + 1e-6 ? 'exact' : 'rounding';
}
for (const n of ['Philadelphia', 'Allegheny', 'Centre', 'Chester']) {
  const v = at40(COUNTY[n]);
  log('  ' + n.padEnd(14) + 'area ' + areaOf[COUNTY[n]] + '  age 40: lowest ' + v[0].v.toFixed(2) + ' ' + v[0].id + ', second ' + v[1].v.toFixed(2) + ' ' + v[1].id);
}
const by = c => rows.filter(r => r.cls === c);
log('  Pennie rows: ' + ['exact', 'rounding', 'ranking', 'price'].map(c => by(c).length + ' ' + c).join(', '));
const showR = r => cty.nameOf(r.fips).replace(/ County$/, '') + ' ' + r.plan + ' ' + r.a40 + ' at ' + r.ehbTxt + '% (ours ' + (r.ours ? r.ours.id + ' ' + r.ours.v : 'none') + (r.ratio ? ', Pennie/Department ' + r.ratio.toFixed(4) : '') + ')';
if (by('price').length || by('ranking').length) {
  const priced = {};
  for (const r of by('price')) (priced[r.plan] ||= []).push(r.ratio);
  fail(ST, 'Pennie does not reproduce from the Department\'s decisions. ' +
    (by('price').length ? 'Priced differently (' + by('price').length + ' rows): ' + Object.entries(priced).map(([id, q]) => id + ' Pennie/Department ' + Math.min(...q).toFixed(4) + ' to ' + Math.max(...q).toFixed(4) + ' in ' + q.length + ' counties').join('; ') + '. ' : '') +
    (by('ranking').length ? 'Ranked differently (' + by('ranking').length + ' rows): ' + by('ranking').map(showR).join('; ') + '.' : ''));
}
// one Centre row: both of Pennie's Centre rows must agree, since the filings give whole counties
const centreRows = rows.filter(r => r.fips === COUNTY.Centre);
if (centreRows[0].a40 !== centreRows[1].a40 || centreRows[0].plan !== centreRows[1].plan) fail(ST, 'Pennie\'s two Centre rows differ; the filings cannot place a plan in part of a county');

/* the builder checks to the cent, so only rows the printed share reproduces exactly are checks */
const checks = [];
for (const r of by('exact')) {
  if (r.fips === COUNTY.Centre && r !== by('exact').find(x => x.fips === COUNTY.Centre)) continue;
  checks.push({ what: 'slcsp', fips: r.fips, age: 40, premium: r.a40, ...(r.ehb !== 1 ? { factor: r.ehb } : {}),
    source: 'Pennie, 2027 Second Lowest Cost Silver Plan (by County), p. ' + r.page + ', age 40, EHB portion only (' + r.ehbTxt + '% EHB)' });
}

const names = l => [...new Set(l.map(x => legalName[COVID[x.split(/[: ]/)[0]]]))].join(', ');
writeState({
  state: ST, planYear: 2027, kind: 'plans', final: true, precision: 'cents',
  sources: [...sources, { title: 'Pennie, 2027 Second Lowest Cost Silver Plan (by County)', url: PENNIE, published: pdfDate(pf) }],
  notes: [
    'Rates are the 2027 individual rates in the Pennsylvania Insurance Department\'s final rate decision for each of the ' + CODES.length + ' insurers, read from the CMS Rates Table Template that each decision embeds. Metal level, exchange status, rating areas and counties come from the Department\'s Plan Design Summary in the same document, cross-checked against the CMS URRT Worksheet 2 wherever that could be read.',
    'Only plans sold on Pennie (marked On or On/Off) are used. Every plan follows the federal default age curve: one base rate reproduces each printed age rate within ' + Math.max(...Object.values(curveDev)).toFixed(3) + ' dollars, against 0.005 from rounding alone.',
    ...(quarterly.length ? [names(quarterly) + ' also files rate sheets for coverage starting in each quarter. They cover plans that appear in neither the Plan Design Summary nor the URRT, and individual rates are fixed for the plan year, so only the full year sheet is used.'] : []),
    ...(omitted.length ? ['The Plan Design Summary of ' + names(omitted) + ' leaves out ' + omitted.length + ' rated plans; the URRT shows that none is a silver plan sold on the exchange.'] : []),
    ...(clipped.length ? ['Some Plan Design Summaries were printed with county cells cut off (' + clipped.length + ' plans of ' + [...new Set(clipped.map(c => c.split(' ')[0]))].join(', ') + '). Those plans are placed in every county the Department\'s coverage area page lists for the insurer within the plan\'s rated areas, and only where every county legible in the cell is on that list.'] : []),
    'Pennie prints the benchmark as the essential health benefit portion only, with the plan\'s EHB percentage rounded to two decimals or fewer. Rows that the printed percentage reproduces to the cent are checks; the other rows were verified within the rounding of the printed percentage.',
    'Pennie splits Centre County by ZIP code because some plans serve only part of it. The Department\'s filings list whole counties, both of Pennie\'s Centre rows show the same benchmark, and the county is checked against it.',
  ],
  statewide: false,
  plans,
  checks,
});
