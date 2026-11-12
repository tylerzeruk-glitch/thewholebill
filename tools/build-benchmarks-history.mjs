/* Regenerates src/benchmarks-<year>.js: a past plan year's county benchmark
 * (second-lowest-cost silver, SLCSP) table, so the calculator can show what the
 * same household's coverage cost in earlier years. Hand-run, one year at a time:
 *
 *     node tools/build-benchmarks-history.mjs 2025
 *     node tools/build-benchmarks-history.mjs 2026
 *
 * A past year is built ENTIRELY from CMS's files, which is only possible after
 * the fact: CMS posts the HealthCare.gov states' plan files before open
 * enrollment, and every state exchange's files the following May. The current
 * year's table (tools/build-benchmarks.mjs) cannot wait for May, so it reads
 * the state exchanges' own publications instead; this one never has to.
 *
 * The output carries no ZIP table and no county names: a reader's ZIP resolves
 * against the current table (src/benchmarks.js), and the county key it yields
 * (fips, or fips|ratingArea in AK, MA and Los Angeles County) indexes this one.
 * The build reports every current county key this year lacks.
 *
 * Inputs (all keyless and public domain, cached in tools/cache/<year>/):
 *   HealthCare.gov states:
 *     https://download.cms.gov/marketplace-puf/<year>/rate-puf.zip
 *     https://download.cms.gov/marketplace-puf/<year>/plan-attributes-puf.zip
 *     https://download.cms.gov/marketplace-puf/<year>/service-area-puf.zip
 *     https://data.healthcare.gov/datafile/py<year>/individual_market_medical.zip
 *       (county to rating area + an independent per-county SLCSP cross-check;
 *        converted to landscape_slim.csv with tools/xlsx-slim.py)
 *   State exchanges: https://www.cms.gov/files/zip/<name>.zip (YEARS below)
 *   Rating areas for the state exchanges: CMS's {st}-gra pages. These are
 *     the CURRENT pages; a state that redrew its rating areas since the year
 *     being built would show up as rates filed under an area the page does not
 *     list, which fails the build.
 *   County names and state membership: Census tab20_zcta520_county20_natl.txt.
 *
 * Validation before writing:
 *   - HealthCare.gov counties match the landscape file's own second-lowest
 *     age-21 silver premium, to the cent (AK excepted, as in the main build).
 *   - 2026 only: the result must reproduce the shipped 2026 table (the
 *     src/benchmarks.js FROZEN commit), every county and every age curve,
 *     exactly. That table was itself checked against NY State of Health's and
 *     Covered California's published figures, so a 2026 rebuild that matches
 *     it proves this code, which then builds 2025 from the same kind of files.
 *   - Per-state age curves must be uniform across every silver plan.
 *
 * One exception, in YEARS below: CMS's 2025 Vermont service-area file is empty,
 * and Vermont's one service area is taken as statewide, as CMS's 2026 file
 * defines it. The build fails if that stops being true.
 */
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLAN_YEAR = parseInt(process.argv[2], 10);
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// The state exchanges each year, and the name of each one's CMS file. Georgia
// left HealthCare.gov for 2025, Illinois for 2026, Oregon for 2027.
const SBE_NAME = {
  CA: 'california', CO: 'colorado', CT: 'connecticut', DC: 'districtofcolumbia', GA: 'georgia',
  ID: 'idaho', IL: 'illinois', KY: 'kentucky', ME: 'maine', MD: 'maryland', MA: 'massachusetts',
  MN: 'minnesota', NV: 'nevada', NJ: 'newjersey', NM: 'newmexico', NY: 'newyork',
  PA: 'pennsylvania', RI: 'rhodeisland', VT: 'vermont', VA: 'virginia', WA: 'washington'
};
const YEARS = {
  2025: {
    sbe: ['CA','CO','CT','DC','GA','ID','KY','ME','MD','MA','MN','NV','NJ','NM','NY','PA','RI','VT','VA','WA'],
    file: st => SBE_NAME[st] + 'sbepuf2025',
    // CMS's 2025 Vermont service-area file has a header and no rows (its 2024
    // file is empty too). Both Vermont issuers filed every 2025 silver plan
    // under service area VTS001, which CMS's 2026 file defines as the entire
    // state for each of them, and Vermont is one rating area. Treated as
    // statewide; the build fails if any other service area id appears.
    statewide: { VT: ['VTS001'] },
    kff: { VT: 1277, DC: 578, RI: 425 }
  },
  2026: {
    sbe: ['CA','CO','CT','DC','GA','ID','IL','KY','ME','MD','MA','MN','NV','NJ','NM','NY','PA','RI','VT','VA','WA'],
    file: st => ({ CA: 'californiasbpuf2026', DC: 'districtofcolumbiapuf2026', IL: 'illinois-sbe-qhp-puf' })[st]
                || SBE_NAME[st] + 'sbepuf2026',
    kff: { VT: 1299, DC: 610, RI: 506 },
    frozen: '3946a8aacdfb538b1963b3e48f3bd97f3eee3588'
  }
};
const CFG = YEARS[PLAN_YEAR];
const log = m => console.log(m);
const fail = m => { console.error('FAIL: ' + m); process.exit(1); };
if (!CFG) fail('usage: node tools/build-benchmarks-history.mjs <' + Object.keys(YEARS).join('|') + '>');
const calc = createRequire(import.meta.url)('../src/calc.js');
if (PLAN_YEAR >= calc.YEAR) fail(PLAN_YEAR + ' is not a past plan year (calc.js YEAR is ' + calc.YEAR + ')');
calc.tablesFor(PLAN_YEAR);   // throws if calc.js has no credit schedule for this year
const SBE_STATES = CFG.sbe;
const CACHE = join(HERE, 'cache', String(PLAN_YEAR));
const OUT = join(HERE, '..', 'src', 'benchmarks-' + PLAN_YEAR + '.js');

const FIPS2 = { AL:'01',AK:'02',AZ:'04',AR:'05',CA:'06',CO:'08',CT:'09',DE:'10',DC:'11',FL:'12',GA:'13',HI:'15',ID:'16',IL:'17',IN:'18',IA:'19',KS:'20',KY:'21',LA:'22',ME:'23',MD:'24',MA:'25',MI:'26',MN:'27',MS:'28',MO:'29',MT:'30',NE:'31',NV:'32',NH:'33',NJ:'34',NM:'35',NY:'36',NC:'37',ND:'38',OH:'39',OK:'40',OR:'41',PA:'42',RI:'44',SC:'45',SD:'46',TN:'47',TX:'48',UT:'49',VT:'50',VA:'51',WA:'53',WV:'54',WI:'55',WY:'56' };
const ST_OF_FIPS2 = Object.fromEntries(Object.entries(FIPS2).map(([k,v]) => [v,k]));

/* ------------------------------------------------------------ downloads */
function fetchTo(url, dest) {
  if (existsSync(join(CACHE, dest))) return;
  log('  fetching ' + url);
  execFileSync('curl', ['-sfL', '-A', UA, url, '-o', join(CACHE, dest)]);
}
function unzipTo(zip, dir) {
  execFileSync('unzip', ['-o', '-q', join(CACHE, zip), '-d', join(CACHE, dir)]);
}
function ensureInputs() {
  mkdirSync(join(CACHE, 'gra'), { recursive: true });
  mkdirSync(join(CACHE, 'sbe'), { recursive: true });
  for (const [name, csv] of [['rate-puf', 'Rate_PUF.csv'], ['plan-attributes-puf', 'Plan_Attributes_PUF.csv'], ['service-area-puf', 'Service_Area_PUF.csv']]) {
    if (existsSync(join(CACHE, csv))) continue;
    fetchTo('https://download.cms.gov/marketplace-puf/' + PLAN_YEAR + '/' + name + '.zip', name + '.zip');
    unzipTo(name + '.zip', name + '-tmp');
    execFileSync('sh', ['-c', `mv "${CACHE}/${name}-tmp/"*.csv "${CACHE}/${csv}"`]);
  }
  if (!existsSync(join(CACHE, 'landscape_slim.csv'))) {
    fetchTo('https://data.healthcare.gov/datafile/py' + PLAN_YEAR + '/individual_market_medical.zip', 'individual_market_medical.zip');
    unzipTo('individual_market_medical.zip', 'land-tmp');
    const x = readdirSync(join(CACHE, 'land-tmp')).find(f => /\.xlsx$/i.test(f));
    if (!x) fail('no xlsx in the landscape zip');
    execFileSync('python3', [join(HERE, 'xlsx-slim.py'), join(CACHE, 'land-tmp', x), join(CACHE, 'landscape_slim.csv')]);
  }
  if (!existsSync(join(CACHE, 'zcta_county.txt')))
    fetchTo('https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt', 'zcta_county.txt');
  for (const st of SBE_STATES) {
    const name = CFG.file(st);
    if (!existsSync(join(CACHE, 'sbe', name))) {
      fetchTo('https://www.cms.gov/files/zip/' + name + '.zip', name + '.zip');
      unzipTo(name + '.zip', 'sbe/' + name);
    }
    const f = join(CACHE, 'gra', st.toLowerCase() + '.html');
    if (!existsSync(f))
      execFileSync('curl', ['-sf', '-A', UA,
        'https://www.cms.gov/cciio/programs-and-initiatives/health-insurance-market-reforms/' + st.toLowerCase() + '-gra',
        '-o', f]);
  }
}

/* ------------------------------------------------------------ csv */
function parseCsvLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
function readCsv(path) {
  const txt = readFileSync(path, 'utf-8').replace(/^﻿/, '');
  const lines = txt.split(/\r?\n/).filter(l => l.length);
  const header = parseCsvLine(lines[0]).map(h => h.trim());
  return { header, rows: lines.slice(1).map(parseCsvLine) };
}
const col = (header, name) => {
  const i = header.indexOf(name);
  if (i < 0) fail('missing column ' + name + ' in [' + header.join(', ') + ']');
  return i;
};
// index 0..64; '0-14' fills 0..14, '64 and over' -> 64
function ageIndices(label) {
  if (label === '0-14') return Array.from({ length: 15 }, (_, i) => i);
  if (label === '64 and over') return [64];
  const n = parseInt(label, 10);
  return Number.isFinite(n) && n >= 15 && n <= 63 ? [n] : null;
}

/* ------------------------------------------------------------ main */
ensureInputs();
log('== plan year ' + PLAN_YEAR + ': inputs ready ==');

const countyName = {}, stateCounties = {};
{
  const lines = readFileSync(join(CACHE, 'zcta_county.txt'), 'utf-8').replace(/^﻿/, '').split('\n');
  const hdr = lines[0].split('|');
  const iF = hdr.indexOf('GEOID_COUNTY_20'), iN = hdr.indexOf('NAMELSAD_COUNTY_20');
  for (const line of lines.slice(1)) {
    const p = line.split('|');
    const fips = p[iF];
    if (!fips || fips.length !== 5) continue;
    countyName[fips] = p[iN];
    const st = ST_OF_FIPS2[fips.slice(0, 2)];
    if (st) (stateCounties[st] ||= new Set()).add(fips);
  }
}

/* ---- county -> rating area: landscape (HealthCare.gov), gra pages (state exchanges) ---- */
const countyRA = {}, landSilver = {};
{
  const { rows } = readCsv(join(CACHE, 'landscape_slim.csv'));
  // tools/xlsx-slim.py columns: 0 state, 1 fips, 2 county, 3 metal, 4 planId, 5 ratingArea, 6 prem21
  for (const [st, fips, , metal, , ra, prem] of rows) {
    if (SBE_STATES.includes(st)) fail('the landscape file lists ' + st + ', a ' + PLAN_YEAR + ' state exchange');
    if (st === 'AK') { countyRA[fips] = null; continue; }
    const n = parseInt(ra.replace('Rating Area ', ''), 10);
    if (countyRA[fips] != null && countyRA[fips] !== n) fail('landscape RA conflict in ' + fips);
    countyRA[fips] = n;
    if (metal === 'Silver') (landSilver[fips] ||= []).push(Math.round(parseFloat(prem.replace(/[$,]/g, '')) * 100));
  }
  for (const k in landSilver) landSilver[k].sort((a, b) => a - b);
  log('landscape: rating area for ' + Object.keys(countyRA).length + ' HealthCare.gov counties');
}
const norm = s => s.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
const GRA_ALIAS = {                    // typos and variants on the CMS gra pages
  'san bernadino': 'san bernardino', 'heralson': 'haralson', 'dewitt': 'de witt',
  'vermillion': 'vermilion', 'dona ana': 'doa ana', 'debaca': 'de baca', 'deleware': 'delaware'
};
const graZip3 = { MA: {}, CA_LA: {} };
const graAreas = {};                   // ST -> Set(ra) the page lists
{
  const nameToFips = {};
  for (const [st, set] of Object.entries(stateCounties)) {
    const m = {};
    for (const f of set) {
      const full = norm(countyName[f]);
      const bare = full.replace(/ (county|parish|borough|census area|municipality|city and borough|municipio)$/, '');
      m[full] = m[full] === undefined ? f : 'DUP';
      if (bare !== full) m[bare] = m[bare] === undefined ? f : 'DUP';
    }
    nameToFips[st] = m;
  }
  const unresolved = [];
  for (const st of SBE_STATES) {
    const html = readFileSync(join(CACHE, 'gra', st.toLowerCase() + '.html'), 'utf-8');
    const table = (html.match(/<table[\s\S]*?<\/table>/) || [])[0];
    if (!table) fail('no gra table for ' + st);
    const areas = graAreas[st] = new Set();
    for (const tr of table.match(/<tr[\s\S]*?<\/tr>/g).slice(1)) {
      const cells = (tr.match(/<t[dh][\s\S]*?<\/t[dh]>/g) || [])
        .map(c => c.replace(/<[^>]+>|&nbsp;/g, ' ').replace(/\s+/g, ' ').trim());
      if (cells.length < 2) continue;
      const ra = parseInt((cells[0].match(/Rating Area (\d+)/) || [])[1], 10);
      if (!Number.isFinite(ra)) continue;
      areas.add(ra);
      const county = cells[1], zip3 = (cells[2] || '').match(/^(\d{3})/);
      if (zip3) {
        if (st === 'MA') graZip3.MA[zip3[1]] = ra;
        else if (st === 'CA') graZip3.CA_LA[zip3[1]] = ra;
        else fail('unexpected zip3 rating row in ' + st);
        continue;
      }
      const nc = norm(county);
      const fips = nameToFips[st][GRA_ALIAS[nc] || nc];
      if (!fips || fips === 'DUP') { unresolved.push(st + ': "' + county + '"'); continue; }
      if (countyRA[fips] != null && countyRA[fips] !== ra) fail('RA conflict ' + fips);
      countyRA[fips] = ra;
    }
  }
  if (unresolved.length) fail('gra counties unresolved:\n  ' + unresolved.join('\n  '));
  if (SBE_STATES.includes('MA') && Object.keys(graZip3.MA).length !== 18) fail('MA zip3 table incomplete');
  if (Object.keys(graZip3.CA_LA).length !== 21) fail('CA LA zip3 table incomplete');
}

/* ---- HealthCare.gov plans, service areas, rates ---- */
const silverPlan = {};   // scid -> { issuer, said, st }
{
  const { header, rows } = readCsv(join(CACHE, 'Plan_Attributes_PUF.csv'));
  const iSt = col(header, 'StateCode'), iIss = col(header, 'IssuerId'),
        iMc = col(header, 'MarketCoverage'), iDo = col(header, 'DentalOnlyPlan'),
        iSc = col(header, 'StandardComponentId'), iSa = col(header, 'ServiceAreaId'),
        iMl = col(header, 'MetalLevel'), iQ = col(header, 'QHPNonQHPTypeId'),
        iCh = col(header, 'ChildOnlyOffering');
  for (const r of rows) {
    if (r[iMc] !== 'Individual' || r[iDo] !== 'No' || r[iMl] !== 'Silver') continue;
    if (r[iQ] !== 'On the Exchange' && r[iQ] !== 'Both') continue;
    if (r[iCh] === 'Allows Child-Only') continue;
    if (SBE_STATES.includes(r[iSt])) fail('the CMS plan file lists ' + r[iSt] + ', a ' + PLAN_YEAR + ' state exchange');
    silverPlan[r[iSc]] = { issuer: r[iIss], said: r[iSa], st: r[iSt] };
  }
}
const saCounties = {};   // issuer|said -> Set(fips)
{
  const { header, rows } = readCsv(join(CACHE, 'Service_Area_PUF.csv'));
  const iSt = col(header, 'StateCode'), iIss = col(header, 'IssuerId'),
        iSa = col(header, 'ServiceAreaId'), iAll = col(header, 'CoverEntireState'),
        iCo = col(header, 'County');
  for (const r of rows) {
    const set = (saCounties[r[iIss] + '|' + r[iSa]] ||= new Set());
    if (r[iAll] === 'Yes') for (const f of stateCounties[r[iSt]] || []) set.add(f);
    else if (r[iCo]) set.add(r[iCo].padStart(5, '0'));
  }
}
const rateOf = {};       // scid|ra -> Float64Array(65) | { tiers }
await new Promise((resolve) => {
  const rl = createInterface({ input: createReadStream(join(CACHE, 'Rate_PUF.csv')) });
  let header = null, iPl, iRa, iAge, iRate, iEff, kept = 0;
  rl.on('line', line => {
    if (!header) {
      header = parseCsvLine(line.replace(/^﻿/, ''));
      iPl = col(header, 'PlanId'); iRa = col(header, 'RatingAreaId');
      iAge = col(header, 'Age'); iRate = col(header, 'IndividualRate');
      iEff = col(header, 'RateEffectiveDate');
      return;
    }
    if (!line.includes('Rating Area')) return;
    const r = parseCsvLine(line);
    if (!silverPlan[r[iPl]] || r[iEff] !== PLAN_YEAR + '-01-01') return;
    const idx = ageIndices(r[iAge]);
    if (!idx) return;
    const arr = (rateOf[r[iPl] + '|' + parseInt(r[iRa].replace('Rating Area ', ''), 10)] ||= new Float64Array(65));
    const v = parseFloat(r[iRate]);
    for (const a of idx) arr[a] = v;
    kept++;
  });
  rl.on('close', () => { log('HealthCare.gov: ' + Object.keys(silverPlan).length + ' silver plans, ' + kept + ' rate rows'); resolve(); });
});

/* ---- state exchanges: CMS's files for each ---- */
const sbeTiers = {};
{
  for (const st of SBE_STATES) {
    let dir = join(CACHE, 'sbe', CFG.file(st));
    const top = readdirSync(dir).filter(f => !f.startsWith('.'));
    if (top.length === 1 && !top[0].includes('.csv')) dir = join(dir, top[0]);   // some zips nest one folder
    const file = n => {
      const f = readdirSync(dir).find(f => f.includes(n) && /\.csv$/i.test(f));
      if (!f) fail(st + ': no ' + n + ' csv in ' + dir);
      return join(dir, f);
    };
    const plans = readCsv(file('Plans'));
    const iMc = col(plans.header, 'MARKET COVERAGE'), iDo = col(plans.header, 'DENTAL ONLY PLAN'),
          iSc = col(plans.header, 'STANDARD COMPONENT ID'), iSa = col(plans.header, 'SERVICE AREA ID'),
          iMl = col(plans.header, 'METAL LEVEL'), iQ = col(plans.header, 'QHP NONQHP TYPE ID'),
          iIss = col(plans.header, 'ISSUER ID'), iCh = col(plans.header, 'CHILD ONLY OFFERING');
    const seen = new Set();
    for (const r of plans.rows) {
      if (r[iMc] !== 'Individual' || r[iDo] !== 'No' || !/^Silver/.test(r[iMl])) continue;
      if (r[iQ] !== 'On the Exchange' && r[iQ] !== 'Both') continue;
      // a child-only plan is not available to the household, so it can never be its benchmark
      if (r[iCh] === 'Allows Child-Only' || seen.has(r[iSc])) continue;
      seen.add(r[iSc]);
      silverPlan[r[iSc]] = { issuer: r[iIss], said: r[iSa], st };
    }
    const sa = readCsv(file('ServiceAreas'));
    const jIss = col(sa.header, 'ISSUER ID'), jSa = col(sa.header, 'SERVICE AREA ID'),
          jAll = col(sa.header, 'COVER ENTIRE STATE'), jCo = col(sa.header, 'COUNTY');
    const statewide = (CFG.statewide || {})[st];
    if (!sa.rows.length) {
      if (!statewide) fail(st + ': CMS\'s ' + PLAN_YEAR + ' service-area file has no rows');
      for (const [scid, p] of Object.entries(silverPlan)) {
        if (p.st !== st) continue;
        if (!statewide.includes(p.said)) fail(st + ': plan ' + scid + ' is in service area ' + p.said + ', not ' + statewide.join('/'));
        saCounties[p.issuer + '|' + p.said] = new Set(stateCounties[st]);
      }
      log('state exchange ' + st + ': no service-area rows; ' + statewide.join('/') + ' taken as statewide');
    } else if (statewide) fail(st + ': its service-area file has rows now; drop the statewide exception');
    for (const r of sa.rows) {
      const set = (saCounties[r[jIss] + '|' + r[jSa]] ||= new Set());
      // state-exchange dialect: COVER ENTIRE STATE is true/TRUE, COUNTY is "Name - 06037"
      if (/^(yes|true)$/i.test(r[jAll])) for (const f of stateCounties[st] || []) set.add(f);
      else {
        const m = (r[jCo] || '').match(/(\d{5})\s*$/);
        if (m) set.add(m[1]);
        else if (/^\d{4,5}$/.test(r[jCo] || '')) set.add(r[jCo].padStart(5, '0'));
      }
    }
    const rates = readCsv(file('Rates'));
    const k = n => col(rates.header, n);
    const kPl = k('PLAN ID'), kRa = k('RATING AREA ID'), kAge = k('AGE'), kRate = k('INDIVIDUAL RATE');
    const kTier = ['COUPLE', 'PRIMARY SUBSCRIBER AND ONE DEPENDENT', 'PRIMARY SUBSCRIBER AND TWO DEPENDENTS',
      'PRIMARY SUBSCRIBER AND THREE OR MORE DEPENDENTS', 'COUPLE AND ONE DEPENDENT', 'COUPLE AND TWO DEPENDENTS',
      'COUPLE AND THREE OR MORE DEPENDENTS'].map(k);
    let tierRows = 0, ageRows = 0;
    for (const r of rates.rows) {
      const scid = r[kPl];
      if (!silverPlan[scid] || silverPlan[scid].st !== st) continue;
      const ra = parseInt((r[kRa] || '').replace('Rating Area ', ''), 10);
      if (!Number.isFinite(ra)) continue;
      if (!graAreas[st].has(ra)) fail(st + ': ' + PLAN_YEAR + ' rates filed under rating area ' + ra + ', which CMS\'s current page does not list');
      const key = scid + '|' + ra;
      if ((r[kAge] || '').trim() === '') {
        rateOf[key] = { tiers: [r[kRate], ...kTier.map(i => r[i])].map(x => parseFloat(x)) };
        tierRows++;
      } else {
        const idx = ageIndices(r[kAge].trim());
        if (!idx) continue;
        const cur = rateOf[key];
        if (cur && cur.tiers) continue;
        const arr = (cur instanceof Float64Array) ? cur : (rateOf[key] = new Float64Array(65));
        const v = parseFloat(r[kRate]);
        for (const a of idx) arr[a] = v;
        ageRows++;
      }
    }
    if (tierRows) sbeTiers[st] = true;
    log('state exchange ' + st + ': ' + seen.size + ' silver plans' + (tierRows ? ', family tiers' : ''));
  }
  // NY quotes child-only per-age rows (0.00 for adults) beside its tier rows; the tier rows win.
  for (const [key, v] of Object.entries(rateOf))
    if (v instanceof Float64Array && v[21] === 0 && v[40] === 0) delete rateOf[key];
}

/* ---- per-county SLCSP ---- */
// key is fips, or fips|ra where ZIP3 decides the area (AK, MA, Los Angeles County)
const entries = {};
function computeCounty(fips, ra, st) {
  const prems = [];
  for (const [scid, p] of Object.entries(silverPlan)) {
    if (p.st !== st) continue;
    const set = saCounties[p.issuer + '|' + p.said];
    if (!set || !set.has(fips)) continue;
    const r = rateOf[scid + '|' + ra];
    if (!r) continue;
    if (r.tiers) prems.push({ v: r.tiers[0], t: r.tiers });
    else if (r[21] > 0) prems.push({ v: r[21] });
  }
  if (prems.length < 2) return null;
  const tiered = prems.filter(p => p.t).length;
  if (tiered !== 0 && tiered !== prems.length) fail('mixed tier/age candidates in ' + fips);
  prems.sort((a, b) => a.v - b.v);
  const second = prems[1];
  return { p: second.t ? second.t.map(x => Math.round(x * 100)) : Math.round(second.v * 100), ra };
}
{
  let skipped = 0;
  const maAreas = [...new Set(Object.values(graZip3.MA))];
  for (const [st, counties] of Object.entries(stateCounties)) {
    for (const fips of counties) {
      const split = st === 'AK' ? [1, 2, 3] : st === 'MA' ? maAreas : fips === '06037' ? [15, 16] : null;
      if (split) {
        for (const ra of split) { const e = computeCounty(fips, ra, st); if (e) entries[fips + '|' + ra] = e; }
        continue;
      }
      const ra = countyRA[fips];
      const e = ra == null ? null : computeCounty(fips, ra, st);
      if (e) entries[fips] = e; else skipped++;
    }
  }
  log('county entries: ' + Object.keys(entries).length + ' (no silver market: ' + skipped + ')');
}

/* ---- validation: HealthCare.gov counties vs the landscape file, to the cent ---- */
{
  let checked = 0;
  const bad = [];
  for (const [fips, list] of Object.entries(landSilver)) {
    const e = entries[fips];
    if (!e || list.length < 2) continue;
    checked++;
    if (e.p !== list[1]) bad.push(fips + ': puf ' + e.p + ' vs landscape ' + list[1]);
  }
  if (bad.length) fail(bad.length + ' landscape mismatches, e.g. ' + bad.slice(0, 5).join(' | '));
  log('validated: ' + checked + ' HealthCare.gov counties match the landscape file to the cent');
  if (checked < 1500) fail('only ' + checked + ' counties cross-checked');
}

/* ---- per-state age curves, from the rate files themselves ---- */
const stateCurve = {};
{
  for (const st of Object.keys(FIPS2)) {
    if (sbeTiers[st]) continue;
    const per = [];
    for (const [key, r] of Object.entries(rateOf)) {
      const scid = key.split('|')[0];
      if (silverPlan[scid].st !== st || !(r instanceof Float64Array) || !(r[21] > 0)) continue;
      per.push(Array.from({ length: 65 }, (_, a) => r[a] / r[21]));
      if (per.length >= 40) break;
    }
    if (!per.length) fail('no rate arrays for a curve in ' + st);
    const med = Array.from({ length: 65 }, (_, a) => per.map(p => p[a]).sort((x, y) => x - y)[per.length >> 1]);
    for (const p of per) for (let a = 0; a < 65; a++)
      if (p[a] > 0 && Math.abs(p[a] - med[a]) > 0.006)
        fail('non-uniform age curve in ' + st + ' at age ' + a + ': ' + p[a] + ' vs ' + med[a]);
    stateCurve[st] = med;
  }
  const fl = stateCurve.FL;
  if (Math.abs(fl[0] - 0.765) > 0.002 || Math.abs(fl[64] - 3.0) > 0.002) fail('FL curve off the federal default');
  log('age curves derived for ' + Object.keys(stateCurve).length + ' states (uniform within each)');
}

/* ---- assemble ---- */
const curveKey = c => c.map(v => Math.round(v * 1000)).join(',');
const curves = {}, states = {}, counties = {};
{
  const fedKey = curveKey(stateCurve.FL);
  for (const st of Object.keys(FIPS2)) {
    let id = null;
    if (!sbeTiers[st]) {
      const k = curveKey(stateCurve[st]);
      id = Object.keys(curves).find(i => curves[i] === k);
      if (!id) { id = k === fedKey ? 'fed' : st.toLowerCase(); curves[id] = k; }
    }
    states[st] = { curve: id, tiers: !!sbeTiers[st], exchange: SBE_STATES.includes(st) ? 'state' : 'federal' };
  }
  for (const id in curves) curves[id] = curves[id].split(',').map(Number);
  for (const key of Object.keys(entries).sort()) counties[key] = [entries[key].p, entries[key].ra];
}

/* ---- state exchanges vs KFF, where KFF's average is a single benchmark ---- */
// KFF's "Marketplace Average Monthly Benchmark Premiums" indicator is the
// county second-lowest silver for a 40 year old, weighted by plan selections.
// Where one benchmark covers the whole state (Vermont, one rating area with no
// age rating; DC and Rhode Island, one rating area with a single benchmark),
// the weighting cannot move it, so KFF's whole-dollar figure must match ours.
// These are the only independent published checks on the state-exchange
// files; the HealthCare.gov states have the landscape file.
{
  const kff = 'https://www.kff.org/affordable-care-act/state-indicator/marketplace-average-benchmark-premiums/';
  for (const [st, want] of Object.entries(CFG.kff || {})) {
    const keys = Object.keys(counties).filter(k => ST_OF_FIPS2[k.slice(0, 2)] === st);
    const vals = new Set(keys.map(k => JSON.stringify(counties[k][0])));
    if (vals.size !== 1) fail(st + ': expected one benchmark statewide, found ' + vals.size);
    const p = counties[keys[0]][0];
    // the unrounded curve: the table stores factors to three decimals (DC's
    // 1.3411 as 1.341, 6 cents a month at 40), which is not what KFF priced
    const got = (Array.isArray(p) ? p[0] : p * stateCurve[st][40]) / 100;
    if (Math.abs(got - want) > 0.5 + 1e-6) fail(st + ': age-40 benchmark ' + got.toFixed(2) + ', KFF publishes ' + want + ' (' + kff + ')');
  }
  if (CFG.kff) log('validated: ' + Object.keys(CFG.kff).join(', ') + ' match KFF\'s published ' + PLAN_YEAR + ' benchmark to the dollar');
}

/* ---- 2026: must reproduce the shipped table exactly ---- */
if (CFG.frozen) {
  const src = execFileSync('git', ['-C', join(HERE, '..'), 'show', CFG.frozen + ':src/benchmarks.js'], { maxBuffer: 1 << 28 }).toString();
  const F = new Function('module', src + '; return module.exports;')({ exports: {} });
  if (F.planYear !== PLAN_YEAR) fail('the frozen table is plan year ' + F.planYear);
  const bad = [];
  const keys = new Set([...Object.keys(F.counties), ...Object.keys(counties)]);
  for (const key of keys) {
    const a = F.counties[key], b = counties[key];
    if (!a || !b || JSON.stringify(a[0]) !== JSON.stringify(b[0]) || a[1] !== b[1])
      bad.push(key + ': shipped ' + (a ? JSON.stringify(a.slice(0, 2)) : 'none') + ', rebuilt ' + (b ? JSON.stringify(b) : 'none'));
  }
  for (const st of Object.keys(FIPS2)) {
    const a = F.states[st], b = states[st];
    if (a.tiers !== b.tiers) bad.push(st + ': tiers differ');
    else if (!a.tiers && JSON.stringify(F.curves[a.curve]) !== JSON.stringify(curves[b.curve])) bad.push(st + ': age curve differs');
  }
  if (bad.length) fail(bad.length + ' differences from the shipped 2026 table, e.g.\n  ' + bad.slice(0, 10).join('\n  '));
  log('validated: the rebuild reproduces the shipped 2026 table exactly (' + Object.keys(F.counties).length + ' county entries, every age curve)');
}

/* ---- coverage against the current table's county keys ---- */
const current = createRequire(import.meta.url)('../src/benchmarks.js');
const lacking = Object.keys(current.counties).filter(k => !counties[k]);
const extra = Object.keys(counties).filter(k => !current.counties[k]);
log('current county keys this year lacks: ' + lacking.length + (lacking.length ? ' (' + lacking.slice(0, 12).join(' ') + ')' : ''));
log('county keys only this year has: ' + extra.length + (extra.length ? ' (' + extra.slice(0, 12).join(' ') + ')' : ''));

/* ---- emit ---- */
{
  const today = new Date().toISOString().slice(0, 10);
  const data = { asOf: today, planYear: PLAN_YEAR, curves, states, counties };
  const out = `/* Generated by tools/build-benchmarks-history.mjs — DO NOT EDIT BY HAND. Regenerate with:
 *     node tools/build-benchmarks-history.mjs ${PLAN_YEAR}
 * Plan year ${PLAN_YEAR}, retrieved ${today}, entirely from CMS (public domain): the
 * Exchange PUFs and QHP landscape file for the HealthCare.gov states, CMS's
 * state-based exchange PUFs for the ${SBE_STATES.length} state exchanges, and CMS's
 * geographic-rating-area tables. counties[key] = [slcspAge21Cents |
 * tierCentsArray, ratingArea], keyed exactly as src/benchmarks.js (fips, or
 * fips|ratingArea in AK, MA and Los Angeles County); NY and VT rate by family
 * tier: [individual, couple, primary+1/2/3+, couple+1/2/3+] cents. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { (root.WholeBillHistory = root.WholeBillHistory || {})[${PLAN_YEAR}] = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  return ${JSON.stringify(data)};
}));
`;
  writeFileSync(OUT, out);
  log('wrote ' + OUT + ' (' + (out.length / 1024).toFixed(0) + ' KB, ' + Object.keys(counties).length + ' county entries)');
  for (const [name, key] of [['Dallas', '48113'], ['Hartford', '09003'], ['Manhattan', '36061'], ['Denver', '08031'], ['Chicago', '17031'], ['Los Angeles R15', '06037|15']]) {
    const e = counties[key], c = current.counties[key];
    const fmt = v => Array.isArray(v) ? 'tiers ' + v.map(x => (x / 100).toFixed(2)).join('/') : '$' + (v / 100).toFixed(2);
    log('  ' + name + ': ' + (e ? fmt(e[0]) : 'MISSING') + (c ? '   (current table ' + current.planYear + ': ' + fmt(c[0]) + ')' : ''));
  }
}
