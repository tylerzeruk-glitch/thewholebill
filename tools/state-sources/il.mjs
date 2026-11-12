/* Illinois, plan year 2027: the Department of Insurance's own analysis.
 *
 * IDOI, "2027 Analysis of Illinois On-Exchange Plans" (PDF created 9 Oct 2026).
 * Page 18 prints the second lowest cost silver plan per rating area at the
 * 21 year old non-tobacco rate, monthly, to the cent; footnotes split a rating
 * area into county groups where the benchmark differs by county. Page 16 is the
 * same table for the lowest cost silver plan (kept as checks). Page 9 says which
 * issuers cover each rating area fully or in part.
 *
 * Rating areas are CMS's (tools/cache/gra/il.html), which IDOI's 13 areas match
 * ("Rating areas in plan year 2027 remain unchanged from plan year 2026").
 *
 *   node tools/state-sources/il.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchCached, pdfText, counties, writeState, fail, log, norm } from './lib.mjs';

const ST = 'IL';
const URL = 'https://idoi.illinois.gov/content/dam/soi/en/web/insurance/consumers/documents/2027-analysis-of-illinois-on-exchange.pdf';
const SRC = 'Illinois Department of Insurance, 2027 Analysis of Illinois On-Exchange Plans (9 Oct 2026)';
const HERE = dirname(fileURLToPath(import.meta.url));

const cty = counties(ST);
if (cty.all.length !== 102) fail(ST, 'expected 102 counties in the Census file, got ' + cty.all.length);

/* CMS rating areas by county */
const GRA_ALIAS = { dewitt: 'de witt', vermillion: 'vermilion' };   // CMS page spellings
const raOf = {};
{
  const html = readFileSync(join(HERE, '..', 'cache', 'gra', 'il.html'), 'utf-8');
  const table = (html.match(/<table[\s\S]*?<\/table>/) || [])[0];
  if (!table) fail(ST, 'no table on the CMS il-gra page');
  for (const tr of table.match(/<tr[\s\S]*?<\/tr>/g).slice(1)) {
    const cells = (tr.match(/<t[dh][\s\S]*?<\/t[dh]>/g) || []).map(c => c.replace(/<[^>]+>|&nbsp;/g, ' ').replace(/\s+/g, ' ').trim());
    const ra = parseInt((cells[0] || '').match(/Rating Area (\d+)/)?.[1], 10);
    if (!Number.isFinite(ra)) continue;
    const n = norm(cells[1]);
    const f = cty.fipsOf(GRA_ALIAS[n] || n);
    if (raOf[f]) fail(ST, 'county twice on the gra page: ' + cells[1]);
    raOf[f] = ra;
  }
  const miss = cty.all.filter(f => !raOf[f]);
  if (miss.length) fail(ST, 'counties missing from the gra page: ' + miss.map(cty.nameOf).join(', '));
}
const RAS = [...new Set(Object.values(raOf))].sort((a, b) => a - b);
if (RAS.length !== 13) fail(ST, 'expected 13 rating areas, got ' + RAS.length);

const pdf = fetchCached(ST, URL, '2027-analysis-of-illinois-on-exchange.pdf');
const pages = pdfText(pdf).split('\f');
if (!/Rating areas in plan year 2027 remain unchanged from plan year 2026/.test(pages.join(' ').replace(/\s+/g, ' ')))
  fail(ST, 'the analysis no longer says the rating areas are unchanged from 2026');

/* ---- page 9: issuer participation per rating area (Full / Partial) ---- */
const partialRA = new Set();
{
  const pg = pages.find(p => /ISSUERS PARTICIPATING BY PLAN TYPE AND BY RATING AREA/.test(p));
  if (!pg) fail(ST, 'no issuer participation page');
  let rows = 0;
  for (const line of pg.split('\n')) {
    const m = line.match(/^\s*Rating Area (\d+)\s+(.*)$/);
    if (!m) continue;
    rows++;
    if (/Partial/.test(m[2])) partialRA.add(+m[1]);
    if (!/^(?:\s*(?:Full|Partial))+\s*$/.test(m[2])) fail(ST, 'participation row ' + m[1] + ' unreadable: ' + m[2]);
  }
  if (rows !== 13) fail(ST, 'participation table: expected 13 rows, got ' + rows);
}

/* ---- one rate table page: rows, footnoted county groups, county assignment ---- */
const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
function readTable(title, pageWant) {
  const hits = pages.map((p, i) => [p, i + 1]).filter(([p]) => p.replace(/\s+/g, ' ').includes(title));
  if (hits.length !== 1) fail(ST, 'expected one page titled "' + title + '", found ' + hits.length);
  const [pg, no] = hits[0];
  if (no !== pageWant) fail(ST, '"' + title + '" moved from page ' + pageWant + ' to ' + no);
  if (!/2027 21 Year-Old/.test(pg) || !/Non-Tobacco Rate/.test(pg)) fail(ST, 'page ' + no + ' is not priced at the 21 year old non-tobacco rate');

  const [body, notes] = pg.split(/\n\s*Notes:\s*\n/);
  if (!notes) fail(ST, 'page ' + no + ': no notes');
  // footnoted county groups
  const flat = notes.replace(/\s+/g, ' ');
  const groups = {};
  for (const m of flat.matchAll(/(\d+[a-z])\. In ([a-z0-9]+) count(?:y|ies) \(([^)]+)\)/g)) {
    const names = m[3].split(/\s*,\s*(?:and\s+)?|\s+and\s+/).map(s => s.trim()).filter(Boolean);
    const want = WORDS[m[2]] || +m[2];
    if (names.length !== want) fail(ST, 'page ' + no + ' note ' + m[1] + ' says ' + m[2] + ' counties but lists ' + names.length);
    if (groups[m[1]]) fail(ST, 'note ' + m[1] + ' twice');
    groups[m[1]] = names.map(n => cty.fipsOf(n));
  }
  // rate rows, in table order
  const rows = [];
  for (const line of body.split('\n')) {
    const m = line.match(/^\s*(?:Rating Area (\d+)\s+)?([A-Za-z]+)\s+\$([\d,]+\.\d\d)\s+([A-Za-z]+?)(\d+[a-z])?\s+\$([\d,]+\.\d\d)\s+(-?\d+)%\s*$/);
    if (!m) { if (/\$\d/.test(line)) fail(ST, 'page ' + no + ': unread rate line: ' + line.trim()); continue; }
    const [, , , p26, issuer, note, p27, pct] = m;
    const v26 = +p26.replace(/,/g, ''), v27 = +p27.replace(/,/g, '');
    if (Math.abs((v27 / v26 - 1) * 100 - +pct) > 0.5 + 1e-9) fail(ST, 'page ' + no + ': printed change ' + pct + '% disagrees with ' + v26 + ' to ' + v27);
    rows.push({ issuer, note: note || null, premium: v27 });
  }
  // a footnoted row belongs to the rating area of its counties
  for (const r of rows) {
    if (!r.note) continue;
    const g = groups[r.note];
    if (!g) fail(ST, 'page ' + no + ': row note ' + r.note + ' has no footnote');
    const ras = new Set(g.map(f => raOf[f]));
    if (ras.size !== 1) fail(ST, 'page ' + no + ': note ' + r.note + ' spans rating areas ' + [...ras]);
    r.ra = [...ras][0];
  }
  // an unfootnoted row covers a whole rating area that has no footnoted rows, in table order
  const splitRA = new Set(rows.filter(r => r.note).map(r => r.ra));
  const wholeRA = RAS.filter(ra => !splitRA.has(ra));
  const plain = rows.filter(r => !r.note);
  if (plain.length !== wholeRA.length) fail(ST, 'page ' + no + ': ' + plain.length + ' whole-area rows for ' + wholeRA.length + ' unsplit areas');
  plain.forEach((r, i) => { r.ra = wholeRA[i]; });
  for (let i = 1; i < rows.length; i++) if (rows[i].ra < rows[i - 1].ra) fail(ST, 'page ' + no + ': rows out of rating area order at row ' + (i + 1));
  const labels = [...body.matchAll(/Rating Area (\d+)/g)].map(m => +m[1]);
  if (labels.join() !== RAS.join()) fail(ST, 'page ' + no + ': rating area labels ' + labels.join());

  // every county exactly once
  const out = {};
  for (const r of rows) {
    const fs = r.note ? groups[r.note] : cty.all.filter(f => raOf[f] === r.ra);
    for (const f of fs) {
      if (out[f] && out[f].premium !== r.premium) fail(ST, 'page ' + no + ': ' + cty.nameOf(f) + ' gets two figures');
      out[f] = { premium: r.premium, plan: r.issuer, ra: r.ra };
    }
  }
  const miss = cty.all.filter(f => !out[f]);
  if (miss.length) fail(ST, 'page ' + no + ': no figure for ' + miss.map(cty.nameOf).join(', '));
  for (const ra of splitRA) {
    const covered = cty.all.filter(f => raOf[f] === ra).every(f => rows.some(r => r.note && groups[r.note].includes(f)));
    if (!covered) fail(ST, 'page ' + no + ': split rating area ' + ra + ' leaves counties unassigned');
  }
  for (const ra of wholeRA) if (partialRA.has(ra)) fail(ST, 'page ' + no + ': rating area ' + ra + ' has one figure but an issuer covering it only in part');
  return { out, rows, no };
}

const slc = readTable('SECOND LOWEST COST SILVER PLANS IS AN', 18);
const low = readTable('FOR THE LOWEST COST SILVER PLANS IS A', 16);

/* the figures as read when this extractor was written */
const f = n => cty.fipsOf(n);
const EXPECT = [['Cook', 444.70, 'HCSC'], ['Lake', 486.54, 'Celtic'], ['McHenry', 544.39, 'United'],
  ['DuPage', 463.38, 'Celtic'], ['Kane', 463.38, 'Celtic'], ['McLean', 964.15, 'HCSC'], ['Champaign', 1080.51, 'HCSC'],
  ['Bond', 635.45, 'United'], ['Madison', 501.33, 'Celtic'], ['Effingham', 656.30, 'Celtic'], ['Crawford', 1135.86, 'HCSC'],
  ['Jackson', 1135.86, 'HCSC'], ['Sangamon', 880.26, 'United']];
for (const [n, v, iss] of EXPECT) {
  const g = slc.out[f(n)];
  if (g.premium !== v || g.plan !== iss) fail(ST, n + ': parsed ' + g.plan + ' ' + g.premium + ', expected ' + iss + ' ' + v);
}
if (Object.keys(slc.out).length !== 102) fail(ST, 'not 102 counties');
/* The lowest silver can never cost more than the second lowest. The 9 Oct 2026
 * edition breaks this wherever United is both: McHenry (rating area 2, lowest
 * 545.04 against second lowest 544.39), the ten counties of note 7c in rating
 * area 10 (881.32 against 880.26) and all of rating area 11 (636.21 against
 * 635.45). The ratio is the same 1.0012 in all three, so one of the two tables
 * appears to carry the wrong United plan, but nothing published says which.
 * The state is not built until IDOI corrects it or another primary source settles it. */
const bad = cty.all.filter(fp => low.out[fp].premium > slc.out[fp].premium);
const upside = [...new Set(bad.map(fp => slc.out[fp].ra))];
if (upside.length) fail(ST, 'the analysis disagrees with itself in rating area ' + upside.map(ra => {
  const fp = bad.find(x => slc.out[x].ra === ra);
  return ra + ' (' + bad.filter(x => slc.out[x].ra === ra).length + ' counties)' + ': lowest silver ' + low.out[fp].plan + ' ' + low.out[fp].premium + ' (p. ' + low.no + ') is above the second lowest ' + slc.out[fp].plan + ' ' + slc.out[fp].premium + ' (p. ' + slc.no + ')';
}).join('; '));

const countiesOut = {};
for (const fp of cty.all) countiesOut[fp] = { premium: slc.out[fp].premium, plan: slc.out[fp].plan };

const checks = cty.all.map(fp => ({ what: 'lowest', fips: fp, age: 21, premium: low.out[fp].premium,
  source: SRC + ', p. 16, lowest cost silver plan, 2027 21 year old non-tobacco rate (' + low.out[fp].plan + ', rating area ' + low.out[fp].ra + ')' }));

log('  102 counties; Cook ' + countiesOut[f('Cook')].premium + ', Sangamon ' + countiesOut[f('Sangamon')].premium);
writeState({
  state: ST, planYear: 2027, kind: 'slcsp', final: true, precision: 'cents',
  sources: [
    { title: SRC + ', p. 18 second lowest cost silver, p. 16 lowest cost silver, p. 9 issuer participation', url: URL, published: '2026-10-09' },
    { title: 'CMS, Illinois geographic rating areas', url: 'https://www.cms.gov/cciio/programs-and-initiatives/health-insurance-market-reforms/il-gra' },
  ],
  notes: [
    'Illinois\'s 2027 benchmark comes from the Illinois Department of Insurance\'s analysis of the final on-exchange plans, which prints the second lowest cost silver plan per rating area at the 21 year old non-tobacco rate and footnotes the county groups where it differs within a rating area. Plan level 2027 rate tables are not published.',
    'Every one of the 102 counties is assigned from that table exactly once: a footnoted row covers the counties its footnote lists, and an unfootnoted row covers its whole rating area. The department\'s issuer participation table shows every issuer in each unsplit rating area covering that area in full.',
    'The analysis names the issuer of the benchmark plan (for example HCSC, Celtic, United, MercyCare, Oscar) but not the plan, so the plan field carries the issuer only.',
    'The table is priced at age 21 only. Other ages apply the federal default age curve, which Illinois used in 2026 (the CMS 2026 rate files for Illinois follow it to the thousandth).',
    'The table\'s column footnote reads "Lowest across the rating area. May not be available in all counties in the Rating Area." The county footnotes resolve that for the split areas; for the unsplit areas every issuer covers the whole area, so the figure is read as applying to every county in it.',
  ],
  age: 21, curve: 'fed', counties: countiesOut, checks,
});
