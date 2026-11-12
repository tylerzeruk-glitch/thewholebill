/* Idaho, plan year 2027: the Department of Insurance's rate review app.
 *
 * apps-doi.idaho.gov/RateReview, "Rates by Metal Level - <County>", one page per
 * county (PM.County = 1..44, alphabetical): carrier, 2027 plan name and the
 * monthly non-tobacco premium for a 40 year old, to the cent. Off-exchange plans
 * carry "(off exchange only)" in the name. The department released the final
 * 2027 rates on 6 Oct 2026.
 *
 * The page text says it lists "each plan submitted to be available for the chosen
 * rating area", yet the lists differ between counties of one rating area. This
 * extractor reads a page as the plans offered in that county, and proves that
 * reading on the previous year: the same app's 2026 pages must list exactly the
 * on-exchange individual silver plans whose CMS 2026 service area covers the
 * county, at the CMS 2026 age 40 rate, for all 44 counties.
 *
 *   node tools/state-sources/id.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { fetchCached, stateDir, counties, writeState, fail, log, norm } from './lib.mjs';

const ST = 'ID';
const HERE = dirname(fileURLToPath(import.meta.url));
const APP = (year, n) => 'https://apps-doi.idaho.gov/RateReview/PublicForms/RateReview?Indiv=Yes&Group=&Year=' + year + '&PM.County=' + n;
const PUF26 = 'https://www.cms.gov/files/zip/idahosbepuf2026.zip';
const RELEASE = 'https://doi.idaho.gov/wp-content/uploads/NewsReleases/2026-10-06-QHP-release.pdf';

const cty = counties(ST);
if (cty.all.length !== 44) fail(ST, 'expected 44 counties, got ' + cty.all.length);

/* CMS rating areas by county */
const raOf = {};
{
  const html = readFileSync(join(HERE, '..', 'cache', 'gra', 'id.html'), 'utf-8');
  const table = (html.match(/<table[\s\S]*?<\/table>/) || [])[0];
  for (const tr of table.match(/<tr[\s\S]*?<\/tr>/g).slice(1)) {
    const cells = (tr.match(/<t[dh][\s\S]*?<\/t[dh]>/g) || []).map(c => c.replace(/<[^>]+>|&nbsp;/g, ' ').replace(/\s+/g, ' ').trim());
    const ra = parseInt((cells[0] || '').match(/Rating Area (\d+)/)?.[1], 10);
    if (!Number.isFinite(ra)) continue;
    raOf[cty.fipsOf(cells[1])] = ra;
  }
  const miss = cty.all.filter(f => !raOf[f]);
  if (miss.length) fail(ST, 'gra page lacks ' + miss.map(cty.nameOf).join(', '));
}

const ws = s => s.replace(/\s+/g, ' ').trim();
const decode = s => s.replace(/&amp;/g, '&').replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ');

/* one county page -> { county fips, silver: [{carrier, plan, premium, off}] } */
function readPage(year, n) {
  const path = fetchCached(ST, APP(year, n), year + '-county-' + n + '.html');
  const html = readFileSync(path, 'utf-8');
  const head = html.match(/Rates by Metal Level - ([^<]+?) County/);
  if (!head) fail(ST, year + ' page ' + n + ': no "Rates by Metal Level" heading');
  if (!html.includes(year + ' Plan Name')) fail(ST, year + ' page ' + n + ': not a ' + year + ' table');
  if (!/non-tobacco use rate for a 40-year-old individual/.test(ws(html))) fail(ST, year + ' page ' + n + ': no longer priced at age 40 non-tobacco');
  const cells = (html.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/g) || []).map(c => ws(decode(c.replace(/<[^>]+>/g, ' '))));
  const s = cells.indexOf('Silver'), g = cells.indexOf('Gold');
  if (s < 0 || g < s) fail(ST, year + ' page ' + n + ': no silver section');
  const rows = cells.slice(s + 1, g).filter(Boolean);
  if (rows.length % 3) fail(ST, year + ' page ' + n + ': silver rows do not come in threes');
  const silver = [];
  for (let i = 0; i < rows.length; i += 3) {
    const m = rows[i + 2].match(/^\$([\d,]+\.\d\d)$/);
    if (!m) fail(ST, year + ' page ' + n + ': bad premium "' + rows[i + 2] + '"');
    const off = /\(off exchange only\)/i.test(rows[i + 1]);
    silver.push({ carrier: rows[i], plan: ws(rows[i + 1].replace(/\(off exchange only\)/i, '')), premium: +m[1].replace(/,/g, ''), off });
  }
  return { fips: cty.fipsOf(decode(head[1]).trim()), silver };
}

/* ---- the 2026 proof of reading: app pages against the CMS 2026 Idaho PUF ---- */
{
  const need = ['IDPlans05052026.csv', 'IDServiceAreas05052026.csv', 'IDRates05052026.csv'];
  let P = join(HERE, '..', 'cache', 'sbe', 'idahosbepuf2026');      // where the 2026 build left it
  if (!need.every(f => existsSync(join(P, f)))) {
    const zip = fetchCached(ST, PUF26, 'idahosbepuf2026.zip');
    P = join(stateDir(ST), 'idahosbepuf2026');
    execFileSync('unzip', ['-oq', zip, ...need, '-d', P]);
  }
  if (!need.every(f => existsSync(join(P, f)))) fail(ST, 'the CMS 2026 Idaho PUF lacks ' + need.join(', '));
  const csv = f => {
    const lines = readFileSync(join(P, f), 'utf-8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
    const split = l => { const o = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { o.push(cur); cur = ''; } else cur += ch; } o.push(cur); return o; };
    const h = split(lines[0]);
    return lines.slice(1).map(l => { const v = split(l); return Object.fromEntries(h.map((k, i) => [k, v[i]])); });
  };
  const plans = csv('IDPlans05052026.csv').filter(r => r['MARKET COVERAGE'] === 'Individual' && r['DENTAL ONLY PLAN'] === 'No'
    && r['METAL LEVEL'] === 'Silver' && ['On Exchange', 'Both'].includes(r['QHP NONQHP TYPE ID']) && !/^Child/.test(r['CHILD ONLY OFFERING'] || ''));
  const sa = {};
  for (const r of csv('IDServiceAreas05052026.csv')) if (r['MARKET COVERAGE'] === 'Individual') (sa[r['ISSUER ID'] + '|' + r['SERVICE AREA ID']] ||= []).push(r);
  const ids = new Set(plans.map(p => p['STANDARD COMPONENT ID']));
  const rate = {};
  for (const r of csv('IDRates05052026.csv')) if (r.AGE === '40' && ids.has(r['PLAN ID'].slice(0, 14))) rate[r['PLAN ID'].slice(0, 14) + '|' + r['RATING AREA ID']] = +r['INDIVIDUAL RATE'];
  const key = s => ws(s).toLowerCase();   // lib's norm() drops digits, which tell plans apart
  let compared = 0;
  for (let n = 1; n <= 44; n++) {
    const pg = readPage(2026, n), name = cty.nameOf(pg.fips).replace(/ County$/, '');
    const page = new Map(pg.silver.filter(x => !x.off).map(x => [key(x.plan), x.premium]));
    const puf = new Map();
    for (const p of plans) {
      const rows = sa[p['ISSUER ID'] + '|' + p['SERVICE AREA ID']] || [];
      if (!rows.some(x => x['COVER ENTIRE STATE'] === 'true' || norm(x['COUNTY NAME']) === norm(name))) continue;
      puf.set(key(p['PLAN MARKETING NAME']), rate[p['STANDARD COMPONENT ID'] + '|Rating Area ' + raOf[pg.fips]]);
    }
    const a = [...page.keys()].filter(k => !puf.has(k)), b = [...puf.keys()].filter(k => !page.has(k));
    if (a.length || b.length) fail(ST, '2026 proof, ' + name + ': app lists ' + (a.join('; ') || 'nothing extra') + ' / CMS lists ' + (b.join('; ') || 'nothing extra'));
    for (const [k, v] of page) if (!(Math.abs(v - puf.get(k)) < 0.006)) fail(ST, '2026 proof, ' + name + ', ' + k + ': app ' + v + ', CMS ' + puf.get(k));
    compared += page.size;
  }
  log('  2026 proof: all 44 county pages match the CMS 2026 PUF (' + compared + ' county-plan pairs)');
}

/* ---- 2027 ---- */
const byPlan = new Map();   // id -> { issuer, name, counties:Set, rates:{ra: premium} }
const seen = new Set();
for (let n = 1; n <= 44; n++) {
  const pg = readPage(2027, n);
  if (seen.has(pg.fips)) fail(ST, 'county twice: ' + cty.nameOf(pg.fips));
  seen.add(pg.fips);
  const ra = raOf[pg.fips];
  const here = new Set();
  for (const x of pg.silver) {
    if (x.off) continue;
    const id = 'ID:' + x.carrier + ':' + x.plan;
    if (here.has(id)) fail(ST, cty.nameOf(pg.fips) + ' lists ' + id + ' twice');
    here.add(id);
    const p = byPlan.get(id) || { id, issuer: x.carrier, name: x.plan, counties: new Set(), rates: {} };
    if (p.rates[ra] != null && p.rates[ra] !== x.premium) fail(ST, id + ' is ' + p.rates[ra] + ' and ' + x.premium + ' within rating area ' + ra);
    p.rates[ra] = x.premium;
    p.counties.add(pg.fips);
    byPlan.set(id, p);
  }
  if (!here.size) fail(ST, cty.nameOf(pg.fips) + ': no on-exchange silver plan');
}
if (seen.size !== 44) fail(ST, 'pages covered ' + seen.size + ' counties');

const plans = [...byPlan.values()].map(p => ({
  id: p.id, issuer: p.issuer, name: p.name, counties: [...p.counties].sort(),
  rates: Object.fromEntries(Object.entries(p.rates).map(([ra, v]) => [ra, { at: 40, premium: v }])),
}));

/* spot values as read when this extractor was written: Ada's two lowest on-exchange silvers */
const lowIn = f => plans.filter(p => p.counties.includes(f)).map(p => [p.rates[raOf[f]].premium, p.id]).sort((a, b) => a[0] - b[0]);
const ada = lowIn(cty.fipsOf('Ada'));
if (ada[0][0] !== 520.67 || !/St Luke's Health Plan Silver 5000 Rx 1500/.test(ada[0][1]) || ada[1][0] !== 540.23 || !/SAHA Silver 3500/.test(ada[1][1]))
  fail(ST, 'Ada\'s two lowest on-exchange silvers changed: ' + JSON.stringify(ada.slice(0, 2)));

const bon = lowIn(cty.fipsOf('Bonneville'));
log('  ' + plans.length + ' on-exchange silver plans; Ada second lowest ' + ada[1][0] + ', Bonneville second lowest ' + bon[1][0] + ' at 40');
writeState({
  state: ST, planYear: 2027, kind: 'plans', final: true, precision: 'cents', statewide: false,
  sources: [
    { title: 'Idaho Department of Insurance, Rate Review, Individual, Rates by Metal Level, plan year 2027 (44 county pages)', url: APP(2027, 1), published: '2026-10-06' },
    { title: 'Idaho Department of Insurance, news release: final 2027 premium rates for individual and small group health plans', url: RELEASE, published: '2026-10-06' },
    { title: 'CMS, Idaho State-based Exchange public use files, plan year 2026 (to test how the county pages read)', url: PUF26 },
    { title: 'CMS, Idaho geographic rating areas', url: 'https://www.cms.gov/cciio/programs-and-initiatives/health-insurance-market-reforms/id-gra' },
  ],
  notes: [
    'Idaho\'s 2027 plans come from the Department of Insurance\'s rate review pages, one per county, which list every individual plan with the monthly non-tobacco premium for a 40 year old. The department announced these as the final 2027 rates on 6 October 2026.',
    'Each page says it lists the plans submitted for the county\'s rating area and that not all of them are available in every county, yet the lists differ between counties of the same rating area. We read each page as the plans offered in that county. The same pages for 2026 list exactly the on-exchange silver plans whose CMS service area covers each county, at the CMS age 40 rate, in all 44 counties, which is what that reading predicts.',
    'Plans marked "off exchange only" are left out. Plans carry no HIOS identifier on these pages, so each is identified by carrier and plan name, and a plan never shows two different premiums within one rating area.',
    'The pages price age 40 only and say other ages are proportional to it. Other ages use the federal default age curve, which every Idaho silver plan followed in the CMS 2026 rate files.',
  ],
  plans, curve: 'fed', checks: [],
});
