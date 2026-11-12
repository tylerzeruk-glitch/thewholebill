/* Regenerates src/benchmarks.js: the county-level benchmark (second-lowest-cost
 * silver, SLCSP) table for one plan year (PLAN_YEAR below), plus the ZIP to county
 * map and per-state age curves. Hand-run:
 *
 *     node tools/state-sources/<st>.mjs     # each state in STATE_SOURCED, first
 *     node tools/build-benchmarks.mjs
 *
 * Every state comes from one of three places, recorded per state in the output
 * (states[ST].src and .year) and printed on the methodology page:
 *   'cms'    the CMS public use files for the HealthCare.gov states. CMS posts
 *            them before open enrollment.
 *   'state'  the state's own official publications, one extractor per state in
 *            tools/state-sources/ (README there). CMS posts the state-based
 *            exchanges' files only the following May, so for those states the
 *            site reads the exchange's or regulator's own rate tables instead.
 *   'prior'  HELD: a state whose own rates were not published when the table
 *            was built stays wholly on last year (its benchmarks from FROZEN,
 *            and calc.js prices it on last year's poverty line and credit
 *            schedule). Move it to STATE_SOURCED as soon as its rates appear.
 *
 * A NEW PLAN YEAR (each fall; CLAUDE.md ritual 7):
 *   1. PLAN_YEAR must equal calc.js's YEAR (the suite fails on a mismatch).
 *   2. Point FROZEN at the commit holding last year's table, and list in HELD
 *      the states with nothing published yet.
 *   3. Run each state's extractor; each one checks its own sources and carries
 *      the independent published figures (checks) this build must reproduce.
 *   4. Re-read NOT_EXPANDED and CHIP against Medicaid.gov for the new year.
 * Downloads are cached per year (tools/cache/<year>/), so last year's files
 * can never stand in for this year's.
 *
 * Inputs (all keyless, all public domain except GeoNames CC BY 4.0; downloaded
 * into tools/cache/<year>/ on first run):
 *   HealthCare.gov states:
 *     https://download.cms.gov/marketplace-puf/<year>/rate-puf.zip
 *     https://download.cms.gov/marketplace-puf/<year>/plan-attributes-puf.zip
 *     https://download.cms.gov/marketplace-puf/<year>/service-area-puf.zip
 *     https://data.healthcare.gov/datafile/py<year>/individual_market_medical.zip
 *       (county to rating area + an independent per-county SLCSP cross-check;
 *        convert to landscape_slim.csv with tools/xlsx-slim.py)
 *   State-sourced states: tools/cache/<year>/states/<st>.json, written by the
 *     extractors from each state's own files (sources listed in each JSON).
 *   Held states: src/benchmarks.js at the FROZEN commit (git show).
 *   Rating areas: https://www.cms.gov/cciio/.../{st}-gra (county or 3-digit-ZIP
 *     tables; AK and MA rate by ZIP3, Los Angeles County splits by ZIP3)
 *   ZIP to county: Census tab20_zcta520_county20_natl.txt (public domain) filled
 *     with GeoNames US.zip (CC BY 4.0, geonames.org) for PO-box-only ZIPs.
 *
 * The benchmark is computed PER COUNTY, not per rating area: a rating area sets
 * the price but each plan's service area sets availability, and 37% of FFM
 * counties (and e.g. Tompkins County NY, +$359/mo) differ from their rating
 * area's naive answer. SLCSP = the second plan in premium order among silver,
 * individual-market, on-exchange, non-dental plans serving the county, priced
 * at the county's rating area, age 21 non-tobacco (NY and VT: family tiers).
 * A state that publishes the benchmark itself (kind "slcsp") is taken as
 * published, priced at its stated age and converted to age 21 on its curve.
 *
 * Every computed table is validated before writing:
 *   - HealthCare.gov counties must match the landscape file's own per-county
 *     second-lowest age-21 silver premium to the cent (AK excepted; the
 *     landscape approximates AK by dominant rating area, we resolve ZIP3 exactly).
 *   - Every state-sourced state's published figures (its JSON's checks: the
 *     state's own SLCSP or lowest-silver tables) are reproduced, to the cent
 *     or, for a whole-dollar figure, to the dollar.
 *   - Per-state age curves must be uniform across every silver plan in the
 *     state (they are, by regulation) or the build fails.
 */
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLAN_YEAR = 2027;
const CACHE = join(HERE, 'cache', String(PLAN_YEAR));
const OUT = join(HERE, '..', 'src', 'benchmarks.js');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// The state-based exchanges (Oregon joined them for 2027 with its own
// platform). Every one is either STATE_SOURCED or HELD.
const SBE_STATES = ['CA','CO','CT','DC','GA','ID','IL','KY','ME','MD','MA','MN','NV','NJ','NM','NY','OR','PA','RI','VT','VA','WA'];
const HELD = ['CO','IL','KY','ME','MD','MA','NJ','PA','VA'];
const STATE_SOURCED = SBE_STATES.filter(st => !HELD.includes(st));
// Why a held state is held, when it is not simply that nothing is published yet.
const HELD_WHY = {
  IL: 'The Illinois Department of Insurance published its 2027 benchmark and lowest silver premiums by county (2027 Analysis of Illinois On-Exchange Plans, 9 October 2026), but in three rating areas, 20 counties, its lowest silver premium is higher than its second lowest, and nothing published says which table is wrong. Rather than pick one, the state stays on 2026 until the department corrects it or CMS posts the plan files.',
  PA: 'Pennsylvania\'s exchange, Pennie, published its 2027 benchmark by county (27 October 2026), and the Insurance Department published every insurer\'s approved 2027 rates (September 2026), but the two disagree: in 20 counties Pennie prices Ambetter\'s silver plans about 4 percent above the approved rates, and nothing published says which is current. Rather than pick one, the state stays on 2026 until they agree or CMS posts the plan files.'
};
// Who published each state-sourced state's rates, as the page names them.
const PUBLISHER = {
  CA: 'Covered California', CT: 'Access Health CT', DC: 'the DC Department of Insurance, Securities and Banking',
  GA: 'Georgia Access', ID: 'the Idaho Department of Insurance', IL: 'the Illinois Department of Insurance',
  MN: 'the Minnesota Department of Commerce', NM: 'New Mexico\'s Office of Superintendent of Insurance',
  NV: 'the Nevada Division of Insurance', NY: 'New York\'s Department of Financial Services',
  OR: 'Oregon\'s Division of Financial Regulation', PA: 'the Pennsylvania Insurance Department',
  RI: 'HealthSource RI', VT: 'Vermont Health Connect', WA: 'Washington\'s Office of the Insurance Commissioner'
};
// Last year's table, for the held states: the plan-year 2026 build.
const FROZEN = { year: 2026, commit: '3946a8aacdfb538b1963b3e48f3bd97f3eee3588', path: 'src/benchmarks.js' };
const FIPS2 = { AL:'01',AK:'02',AZ:'04',AR:'05',CA:'06',CO:'08',CT:'09',DE:'10',DC:'11',FL:'12',GA:'13',HI:'15',ID:'16',IL:'17',IN:'18',IA:'19',KS:'20',KY:'21',LA:'22',ME:'23',MD:'24',MA:'25',MI:'26',MN:'27',MS:'28',MO:'29',MT:'30',NE:'31',NV:'32',NH:'33',NJ:'34',NM:'35',NY:'36',NC:'37',ND:'38',OH:'39',OK:'40',OR:'41',PA:'42',RI:'44',SC:'45',SD:'46',TN:'47',TX:'48',UT:'49',VT:'50',VA:'51',WA:'53',WV:'54',WI:'55',WY:'56' };
const ST_OF_FIPS2 = Object.fromEntries(Object.entries(FIPS2).map(([k,v]) => [v,k]));
// AK and MA rate by 3-digit ZIP (CMS ak-gra / ma-gra); LA County splits 15/16.
const AK_ZIP3 = { 995:1, 996:2, 997:2, 998:3, 999:3 };

// Medicaid expansion (2026: the 10 holdouts unchanged; re-read for each new plan year) and children's
// Medicaid/CHIP upper limits as %FPL, Medicaid.gov eligibility-levels table
// (Dec 2023 convention, no 5-pt MAGI disregard) with the two verified 2024
// updates (AZ 225 KidsCare, ND 200) and Iowa's all-ages 302 in place of its
// infants-only 375.
const NOT_EXPANDED = new Set(['AL','FL','GA','KS','MS','SC','TN','TX','WI','WY']);
const CHIP = { AL:312,AK:203,AZ:225,AR:211,CA:261,CO:260,CT:318,DE:212,DC:319,FL:210,GA:247,HI:308,ID:185,IL:313,IN:250,IA:302,KS:250,KY:213,LA:250,ME:300,MD:317,MA:300,MI:212,MN:275,MS:209,MO:300,MT:261,NE:213,NV:200,NH:318,NJ:350,NM:240,NY:400,NC:211,ND:200,OH:206,OK:205,OR:300,PA:314,RI:261,SC:208,SD:204,TN:250,TX:201,UT:200,VT:312,VA:200,WA:312,WV:300,WI:301,WY:200 };

const log = m => console.log(m);
const fail = m => { console.error('FAIL: ' + m); process.exit(1); };
if (createRequire(import.meta.url)('../src/calc.js').YEAR !== PLAN_YEAR)
  fail('PLAN_YEAR ' + PLAN_YEAR + ' is not calc.js\'s YEAR: the benchmarks and the credit schedule must be the same plan year');
if (createRequire(import.meta.url)('../src/calc.js').PRIOR.year !== FROZEN.year)
  fail('FROZEN is plan year ' + FROZEN.year + ' but calc.js\'s PRIOR tables are ' + createRequire(import.meta.url)('../src/calc.js').PRIOR.year);

/* ------------------------------------------------------------ downloads */
function fetchTo(url, dest, binary) {
  if (existsSync(join(CACHE, dest))) return;
  log('  fetching ' + url);
  execFileSync('curl', ['-sfL', '-A', UA, url, '-o', join(CACHE, dest)]);
}
function unzipTo(zip, dir) {
  execFileSync('unzip', ['-o', '-q', join(CACHE, zip), '-d', join(CACHE, dir)]);
}
function ensureInputs() {
  mkdirSync(join(CACHE, 'gra'), { recursive: true });
  if (!existsSync(join(CACHE, 'Rate_PUF.csv'))) {
    fetchTo('https://download.cms.gov/marketplace-puf/' + PLAN_YEAR + '/rate-puf.zip', 'rate-puf.zip');
    unzipTo('rate-puf.zip', 'rate-tmp');
    execFileSync('sh', ['-c', `mv "${CACHE}/rate-tmp/"*.csv "${CACHE}/Rate_PUF.csv"`]);
  }
  if (!existsSync(join(CACHE, 'Plan_Attributes_PUF.csv'))) {
    fetchTo('https://download.cms.gov/marketplace-puf/' + PLAN_YEAR + '/plan-attributes-puf.zip', 'plan-attributes-puf.zip');
    unzipTo('plan-attributes-puf.zip', 'pa-tmp');
    execFileSync('sh', ['-c', `mv "${CACHE}/pa-tmp/"*.csv "${CACHE}/Plan_Attributes_PUF.csv"`]);
  }
  if (!existsSync(join(CACHE, 'Service_Area_PUF.csv'))) {
    fetchTo('https://download.cms.gov/marketplace-puf/' + PLAN_YEAR + '/service-area-puf.zip', 'service-area-puf.zip');
    unzipTo('service-area-puf.zip', 'sa-tmp');
    execFileSync('sh', ['-c', `mv "${CACHE}/sa-tmp/"*.csv "${CACHE}/Service_Area_PUF.csv"`]);
  }
  if (!existsSync(join(CACHE, 'landscape_slim.csv'))) {
    fetchTo('https://data.healthcare.gov/datafile/py' + PLAN_YEAR + '/individual_market_medical.zip', 'individual_market_medical.zip');
    unzipTo('individual_market_medical.zip', 'land-tmp');
    execFileSync('python3', [join(HERE, 'xlsx-slim.py'),
      join(CACHE, 'land-tmp', 'individual_market_medical.xlsx'), join(CACHE, 'landscape_slim.csv')]);
  }
  if (!existsSync(join(CACHE, 'zcta_county.txt')))
    fetchTo('https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt', 'zcta_county.txt');
  if (!existsSync(join(CACHE, 'US.txt'))) {
    fetchTo('https://download.geonames.org/export/zip/US.zip', 'US.zip');
    unzipTo('US.zip', '.');
  }
  // rating-area tables for the states not on the landscape file
  for (const st of STATE_SOURCED) {
    const f = join(CACHE, 'gra', st.toLowerCase() + '.html');
    if (!existsSync(f))
      execFileSync('curl', ['-sf', '-A', UA,
        'https://www.cms.gov/cciio/programs-and-initiatives/health-insurance-market-reforms/' + st.toLowerCase() + '-gra',
        '-o', f]);
  }
  // every state-sourced state's extractor output, and the right year
  const missing = STATE_SOURCED.filter(st => !existsSync(join(CACHE, 'states', st.toLowerCase() + '.json')));
  if (missing.length) fail('no extractor output for ' + missing.join(', ') +
    ': run node tools/state-sources/<st>.mjs for each (tools/state-sources/README.md)');
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

/* -------------------------------------------------- age index helpers */
// index 0..64; '0-14' fills 0..14, '64 and over' -> 64
function ageIndices(label) {
  if (label === '0-14') return Array.from({ length: 15 }, (_, i) => i);
  if (label === '64 and over') return [64];
  const n = parseInt(label, 10);
  return Number.isFinite(n) && n >= 15 && n <= 63 ? [n] : null;
}

/* ------------------------------------------------------------ main */
ensureInputs();
log('== inputs ready ==');

/* ---- counties: names + state sets (Census relationship file) ---- */
const countyName = {};            // fips5 -> "Hartford County"
const stateCounties = {};         // ST -> Set(fips5)
{
  const txt = readFileSync(join(CACHE, 'zcta_county.txt'), 'utf-8').replace(/^﻿/, '');
  const lines = txt.split('\n');
  const hdr = lines[0].split('|');
  const iF = hdr.indexOf('GEOID_COUNTY_20'), iN = hdr.indexOf('NAMELSAD_COUNTY_20');
  for (const line of lines.slice(1)) {
    const p = line.split('|');
    const fips = p[iF];
    if (!fips || fips.length !== 5) continue;
    countyName[fips] = p[iN];
    const st = ST_OF_FIPS2[fips.slice(0, 2)];
    if (!st) continue;             // territories
    (stateCounties[st] ||= new Set()).add(fips);
  }
  log('counties: ' + Object.keys(countyName).length + ' named');
}

/* ---- county -> rating area ---- */
// FFM: from the landscape file (county-keyed, one RA per county; AK excluded,
// resolved by ZIP3 instead). SBE: from the CMS {st}-gra pages by county name.
const countyRA = {};              // fips5 -> ra number (not for AK/MA; LA handled apart)
const landSilver = {};            // fips5 -> sorted age-21 premium list (cross-check)
{
  const { header, rows } = readCsv(join(CACHE, 'landscape_slim.csv'));
  // columns (see tools/xlsx-slim.py; its header labels are positional):
  // 0 state, 1 fips, 2 county, 3 metal, 4 planId, 5 ratingArea, 6 prem21
  for (const r of rows) {
    const [st, fips, , metal, , ra, prem] = r;
    if (st === 'AK') { countyRA[fips] = null; }
    else {
      const n = parseInt(ra.replace('Rating Area ', ''), 10);
      if (countyRA[fips] != null && countyRA[fips] !== n) fail('landscape RA conflict in ' + fips);
      countyRA[fips] = n;
    }
    if (metal === 'Silver' && st !== 'AK') {
      const cents = Math.round(parseFloat(prem.replace(/[$,]/g, '')) * 100);
      (landSilver[fips] ||= []).push(cents);
    }
  }
  for (const k in landSilver) landSilver[k].sort((a, b) => a - b);
  log('landscape: RA for ' + Object.keys(countyRA).length + ' FFM counties');
}
const norm = s => s.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
// Typos and name variants on the CMS gra pages, mapped to Census county names.
const GRA_ALIAS = {
  'san bernadino': 'san bernardino',   // CA page typo
  'heralson': 'haralson',              // GA page typo
  'dewitt': 'de witt',                 // IL: Census spells it "De Witt"
  'vermillion': 'vermilion',           // IL page typo
  'dona ana': 'doa ana',               // NM: Census "Doña Ana"; norm() strips the ñ
  'debaca': 'de baca',                 // NM: Census "De Baca"
  'deleware': 'delaware'               // NY page typo
};
const graZip3 = { MA: {}, CA_LA: {} };   // zip3 -> ra
{
  // county-name -> fips per state, from the Census names
  const nameToFips = {};          // ST -> { normname -> fips }
  for (const [st, set] of Object.entries(stateCounties)) {
    const m = {};
    for (const f of set) {
      const full = norm(countyName[f]);                                  // "hartford county"
      const bare = full.replace(/ (county|parish|borough|census area|municipality|city and borough|municipio)$/, '');
      m[full] = m[full] === undefined ? f : 'DUP';
      if (bare !== full) m[bare] = m[bare] === undefined ? f : 'DUP';    // "hartford"
    }
    nameToFips[st] = m;
  }
  const unresolved = [];
  for (const st of STATE_SOURCED) {
    const html = readFileSync(join(CACHE, 'gra', st.toLowerCase() + '.html'), 'utf-8');
    const table = (html.match(/<table[\s\S]*?<\/table>/) || [])[0];
    if (!table) fail('no gra table for ' + st);
    for (const tr of table.match(/<tr[\s\S]*?<\/tr>/g).slice(1)) {
      const cells = (tr.match(/<t[dh][\s\S]*?<\/t[dh]>/g) || [])
        .map(c => c.replace(/<[^>]+>|&nbsp;/g, ' ').replace(/\s+/g, ' ').trim());
      if (cells.length < 2) continue;
      const ra = parseInt((cells[0].match(/Rating Area (\d+)/) || [])[1], 10);
      if (!Number.isFinite(ra)) continue;
      const county = cells[1], zip3 = (cells[2] || '').match(/^(\d{3})/);
      if (zip3) {
        if (st === 'MA') graZip3.MA[zip3[1]] = ra;
        else if (st === 'CA') graZip3.CA_LA[zip3[1]] = ra;   // "(only within LA County)"
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
  if (Object.keys(graZip3.CA_LA).length !== 21) fail('CA LA zip3 table incomplete');
  log('gra: state-sourced county rating areas resolved; LA zip3s ' + Object.keys(graZip3.CA_LA).length);
}

/* ---- FFM plans, service areas, rates ---- */
const silverPlan = {};   // scid -> { issuer, said, st }
{
  const { header, rows } = readCsv(join(CACHE, 'Plan_Attributes_PUF.csv'));
  const iSt = col(header, 'StateCode'), iIss = col(header, 'IssuerId'),
        iMc = col(header, 'MarketCoverage'), iDo = col(header, 'DentalOnlyPlan'),
        iSc = col(header, 'StandardComponentId'), iSa = col(header, 'ServiceAreaId'),
        iMl = col(header, 'MetalLevel'), iQ = col(header, 'QHPNonQHPTypeId'),
        iCh2 = col(header, 'ChildOnlyOffering');
  for (const r of rows) {
    if (r[iMc] !== 'Individual' || r[iDo] !== 'No') continue;
    if (r[iMl] !== 'Silver') continue;
    if (r[iQ] !== 'On the Exchange' && r[iQ] !== 'Both') continue;
    if (r[iCh2] === 'Allows Child-Only') continue;   // none in PY2026, guards future years
    if (SBE_STATES.includes(r[iSt])) fail('the CMS plan file lists ' + r[iSt] + ', a state exchange: update SBE_STATES');
    silverPlan[r[iSc]] = { issuer: r[iIss], said: r[iSa], st: r[iSt] };
  }
  log('FFM silver on-exchange plans: ' + Object.keys(silverPlan).length);
}
const saCounties = {};   // issuer|said -> Set(fips)
{
  const { header, rows } = readCsv(join(CACHE, 'Service_Area_PUF.csv'));
  const iSt = col(header, 'StateCode'), iIss = col(header, 'IssuerId'),
        iSa = col(header, 'ServiceAreaId'), iAll = col(header, 'CoverEntireState'),
        iCo = col(header, 'County');
  for (const r of rows) {
    const key = r[iIss] + '|' + r[iSa];
    const set = (saCounties[key] ||= new Set());
    if (r[iAll] === 'Yes') for (const f of stateCounties[r[iSt]] || []) set.add(f);
    else if (r[iCo]) set.add(r[iCo].padStart(5, '0'));
  }
}
// FFM rates: only silver scids, individual market (full-year rows), all 51 ages
const rateOf = {};       // scid|ra -> Float64Array(65)
await new Promise((resolve) => {
  const rl = createInterface({ input: createReadStream(join(CACHE, 'Rate_PUF.csv')) });
  let header = null, iPl, iRa, iAge, iRate, iEff;
  let kept = 0;
  rl.on('line', line => {
    if (!header) {
      header = parseCsvLine(line.replace(/^﻿/, ''));
      iPl = col(header, 'PlanId'); iRa = col(header, 'RatingAreaId');
      iAge = col(header, 'Age'); iRate = col(header, 'IndividualRate');
      iEff = col(header, 'RateEffectiveDate');
      return;
    }
    // cheap prefilter before full parse
    if (!line.includes('Rating Area')) return;
    const r = parseCsvLine(line);
    const scid = r[iPl];
    if (!silverPlan[scid]) return;
    if (r[iEff] !== PLAN_YEAR + '-01-01') return;
    const idx = ageIndices(r[iAge]);
    if (!idx) return;
    const key = scid + '|' + parseInt(r[iRa].replace('Rating Area ', ''), 10);
    const arr = (rateOf[key] ||= new Float64Array(65));
    const v = parseFloat(r[iRate]);
    for (const a of idx) arr[a] = v;
    kept++;
  });
  rl.on('close', () => { log('FFM rate rows kept: ' + kept); resolve(); });
});

/* ---- state-sourced states: the extractors' JSON (tools/state-sources) ---- */
const sbeTiers = {};     // ST -> true when the state rates by family tier (NY, VT)
const stateJson = {};    // ST -> the extractor's JSON
const givenCurve = {};   // ST -> 65 factors, when the source prices one age only
const published = {};    // ST -> { fips: { cents, ra } } for kind "slcsp"
const FED_CURVE = [
  0.765,0.765,0.765,0.765,0.765,0.765,0.765,0.765,0.765,0.765,0.765,0.765,0.765,0.765,0.765,
  0.833,0.859,0.885,0.913,0.941,0.970,1.000,1.000,1.000,1.000,1.004,1.024,1.048,1.087,1.119,
  1.135,1.159,1.183,1.198,1.214,1.222,1.230,1.238,1.246,1.262,1.278,1.302,1.325,1.357,1.397,
  1.444,1.500,1.563,1.635,1.706,1.786,1.865,1.952,2.040,2.135,2.230,2.333,2.437,2.548,2.603,
  2.714,2.810,2.873,2.952,3.000
];
const curveOf = c => c === 'fed' ? FED_CURVE : c;
{
  for (const st of STATE_SOURCED) {
    const j = JSON.parse(readFileSync(join(CACHE, 'states', st.toLowerCase() + '.json'), 'utf-8'));
    if (j.state !== st || j.planYear !== PLAN_YEAR) fail(st + ': extractor output is ' + j.state + ' ' + j.planYear);
    stateJson[st] = j;
    const all = [...(stateCounties[st] || [])];
    const raOf = f => countyRA[f];
    if (j.kind === 'slcsp') {
      const curve = curveOf(j.curve);
      givenCurve[st] = curve;
      const m = published[st] = {};
      for (const [fips, v] of Object.entries(j.counties)) {
        if (!stateCounties[st].has(fips)) fail(st + ': unknown county ' + fips);
        if (raOf(fips) == null) fail(st + ': no rating area for ' + fips);
        m[fips] = { cents: Math.round(v.premium / curve[j.age] * 100), ra: raOf(fips), plan: v.plan };
      }
      const absent = all.filter(f => !m[f]);
      if (absent.length) fail(st + ': the published table lacks ' + absent.join(' '));
      log('state ' + st + ': published benchmark for ' + Object.keys(m).length + ' counties (age ' + j.age + ')');
      continue;
    }
    if (j.curve) givenCurve[st] = curveOf(j.curve);
    let tiers = 0, ages = 0;
    for (const p of j.plans) {
      const scid = st + '#' + p.id;            // never collides with a CMS id
      const said = 'json:' + p.id;
      silverPlan[scid] = { issuer: st, said, st, name: p.issuer + ' ' + p.name };
      saCounties[st + '|' + said] = new Set(p.counties === 'all' ? all : p.counties);
      for (const [ra, r] of Object.entries(p.rates)) {
        const key = scid + '|' + (j.statewide ? 1 : +ra);
        if (Array.isArray(r)) { rateOf[key] = Float64Array.from(r); ages++; }
        else if (r.tiers) { rateOf[key] = { tiers: r.tiers.slice() }; tiers++; }
        else {
          const c = curveOf(j.curve);
          rateOf[key] = Float64Array.from(c, f => r.premium * f / c[r.at]);
          ages++;
        }
      }
    }
    if (tiers && ages) fail(st + ': mixes tier and age rates');
    if (tiers) sbeTiers[st] = true;
    if (j.statewide) for (const f of all) if (countyRA[f] !== 1) fail(st + ': statewide but ' + f + ' is not rating area 1');
    log('state ' + st + ': ' + j.plans.length + ' plans' + (tiers ? ' (family tiers)' : '') +
        (j.final ? '' : ', PRELIMINARY rates') + (j.precision === 'dollars' ? ', whole dollars' : ''));
  }
}

/* ---- per-county SLCSP ---- */
// entries: key -> { p: slcsp cents | tier cents array, ra, fips }
// key is fips, or fips|ra for the ZIP3-rated geographies (AK, MA, LA County).
const entries = {};
function computeCounty(fips, ra, st) {
  if (published[st]) {
    const m = published[st][fips];
    return m && m.ra === ra ? { p: m.cents, ra, n: null, plan: m.plan } : null;
  }
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
  // a county's candidates must be uniformly tier-rated or uniformly age-rated
  const tiered = prems.filter(p => p.t).length;
  if (tiered !== 0 && tiered !== prems.length)
    fail('mixed tier/age candidates in ' + fips + ' (' + st + '): ' + tiered + ' of ' + prems.length);
  prems.sort((a, b) => a.v - b.v);
  const second = prems[1];
  return second.t
    ? { p: second.t.map(x => Math.round(x * 100)), ra, n: prems.length }
    : { p: Math.round(second.v * 100), ra, n: prems.length, lo: Math.round(prems[0].v * 100) };
}
{
  let done = 0, skipped = [];
  for (const [st, counties] of Object.entries(stateCounties)) {
    if (!FIPS2[st]) continue;
    for (const fips of counties) {
      if (st === 'AK') {
        for (const ra of [1, 2, 3]) {
          const e = computeCounty(fips, ra, st);
          if (e) { entries[fips + '|' + ra] = e; done++; }
        }
      } else if (HELD.includes(st)) {
        continue;                    // copied from FROZEN below
      } else if (fips === '06037') {
        for (const ra of [15, 16]) {
          const e = computeCounty(fips, ra, st);
          if (e) { entries[fips + '|' + ra] = e; done++; }
        }
      } else {
        const ra = countyRA[fips];
        if (ra == null) { skipped.push(fips); continue; }
        const e = computeCounty(fips, ra, st);
        if (e) { entries[fips] = e; done++; }
        else skipped.push(fips);
      }
    }
  }
  log('county entries: ' + done + ' (skipped, no silver market: ' + skipped.length + ')');
  if (skipped.length) log('  e.g. ' + skipped.slice(0, 8).join(' '));
}

/* ---- validation 1: FFM counties vs the landscape file, to the cent ---- */
{
  let checked = 0, bad = [];
  for (const [fips, list] of Object.entries(landSilver)) {
    const e = entries[fips];
    if (!e || list.length < 2) continue;
    checked++;
    if (e.p !== list[1]) bad.push(fips + ': puf ' + e.p + ' vs landscape ' + list[1]);
  }
  log('cross-check vs landscape: ' + checked + ' counties');
  if (bad.length) fail(bad.length + ' mismatches, e.g. ' + bad.slice(0, 5).join(' | '));
}
/* ---- validation 2: each state's own published figures (its JSON checks) ---- */
// Recompute from the plans, ranking at the check's own age or tier, so a
// check priced at age 40 is compared with each plan's actual age-40 rate.
// A rating-area figure ("ra") ranks every plan rated in that area, which is
// how a regulator that publishes by area (NM) computes it.
const TIER = ['individual', 'couple', 'parent+1', 'parent+2', 'parent+3', 'couple+1', 'couple+2', 'couple+3'];
const unchecked = [];
const checkedCount = {};   // ST -> published figures this build reproduced
{
  let n = 0;
  for (const st of STATE_SOURCED) {
    const j = stateJson[st];
    if (!(j.checks || []).length) { unchecked.push(st); continue; }
    for (const c of j.checks) {
      const where = c.fips ? c.fips : 'area ' + c.ra;
      let got;
      if (published[st] && c.what === 'lowest')
        fail(st + ' check: a state that publishes only the benchmark cannot check a lowest silver figure');
      if (published[st]) {
        const m = published[st][c.fips];
        if (!m) fail(st + ' check: no published county ' + where);
        got = m.cents / 100 * givenCurve[st][c.age];
      } else {
        const ra = c.ra != null ? c.ra : countyRA[c.fips];
        const vals = [];
        for (const [scid, p] of Object.entries(silverPlan)) {
          if (p.st !== st) continue;
          if (c.fips) { const set = saCounties[p.issuer + '|' + p.said]; if (!set || !set.has(c.fips)) continue; }
          const r = rateOf[scid + '|' + (j.statewide ? 1 : ra)];
          if (!r) continue;
          if (c.tier) { if (!r.tiers) fail(st + ' check by tier on an age-rated state'); vals.push(r.tiers[TIER.indexOf(c.tier)]); }
          else vals.push(r[c.age]);
        }
        vals.sort((a, b) => a - b);
        got = vals[c.what === 'lowest' ? 0 : 1];
        if (got == null) fail(st + ' check: fewer than two plans at ' + where);
      }
      if (c.factor) got *= c.factor;
      const tol = Number.isInteger(c.premium) || c.precision === 'dollars' ? 0.5 + 1e-6 : 0.005 + 1e-6;
      if (Math.abs(got - c.premium) > tol)
        fail(st + ' check failed: ' + c.what + ' at ' + where + ' ' + (c.tier || 'age ' + c.age) + ' computes ' +
             got.toFixed(2) + ', published ' + c.premium + ' (' + c.source + ')');
      n++;
      checkedCount[st] = (checkedCount[st] || 0) + 1;
    }
  }
  log('validated: ' + n + ' published state figures reproduced' +
      (unchecked.length ? '; no independent figure published for ' + unchecked.join(', ') : ''));
}

/* ---- per-state age curves, derived from the rate files themselves ---- */
const stateCurve = {};   // ST -> [65 floats] (x1000 ints at emit) ; tier states excluded
{
  for (const st of Object.keys(FIPS2)) {
    if (sbeTiers[st] || HELD.includes(st)) continue;
    if (published[st]) { stateCurve[st] = givenCurve[st]; continue; }
    const per = [];      // one factor array per plan|ra
    for (const [key, r] of Object.entries(rateOf)) {
      const scid = key.split('|')[0];
      if (!silverPlan[scid] || silverPlan[scid].st !== st) continue;
      if (!(r instanceof Float64Array) || !(r[21] > 0)) continue;
      per.push(Array.from({ length: 65 }, (_, a) => r[a] / r[21]));
      if (per.length >= 40) break;   // plenty for a uniformity check
    }
    if (!per.length) fail('no rate arrays for curve in ' + st);
    const med = Array.from({ length: 65 }, (_, a) => {
      const v = per.map(p => p[a]).sort((x, y) => x - y);
      return v[v.length >> 1];
    });
    // uniformity: every plan's curve must match the state's (regulated) curve
    for (const p of per) for (let a = 0; a < 65; a++) {
      if (p[a] > 0 && Math.abs(p[a] - med[a]) > 0.006)
        fail('non-uniform age curve in ' + st + ' at age ' + a + ': ' + p[a] + ' vs ' + med[a]);
    }
    stateCurve[st] = med;
  }
  // sanity: federal default anchors
  const fl = stateCurve.FL;
  if (Math.abs(fl[0] - 0.765) > 0.002 || Math.abs(fl[64] - 3.0) > 0.002) fail('FL curve off federal default');
  if (Math.abs(stateCurve.UT[40] - 1.479) > 0.003) fail('UT custom curve not detected');
  if (Math.abs(stateCurve.AL[0] - 0.635) > 0.003) fail('AL child factor not detected');
  log('age curves derived for ' + Object.keys(stateCurve).length + ' states (uniform within each)');
}

/* ---- held states: last year's table, unchanged (FROZEN) ---- */
{
  const src = execFileSync('git', ['-C', join(HERE, '..'), 'show', FROZEN.commit + ':' + FROZEN.path],
    { maxBuffer: 1 << 28 }).toString();
  const F = new Function('module', src + '; return module.exports;')({ exports: {} });
  if (F.planYear !== FROZEN.year) fail('FROZEN is plan year ' + F.planYear + ', not ' + FROZEN.year);
  let n = 0;
  for (const st of HELD) {
    const meta = F.states[st];
    if (meta.tiers) fail('held tier state ' + st + ' is not handled');
    stateCurve[st] = F.curves[meta.curve].map(v => v / 1000);
    for (const [key, e] of Object.entries(F.counties)) {
      if (F.fips[key.slice(0, 2)] !== st) continue;
      entries[key] = { p: e[0], ra: e[1], n: null };
      n++;
    }
  }
  graZip3.MA = F.zip3ra.MA;
  if (Object.keys(graZip3.MA).length !== 18) fail('MA zip3 table incomplete: ' + JSON.stringify(graZip3.MA));
  log('held on plan year ' + FROZEN.year + ': ' + HELD.join(', ') + ' (' + n + ' county entries from ' + FROZEN.commit.slice(0, 7) + ')');
}

/* ---- ZIP -> county ---- */
// Census ZCTA (candidates ordered by land-area share) + GeoNames fill.
const zipCand = {};      // zip5 -> [fips...] ordered
{
  const txt = readFileSync(join(CACHE, 'zcta_county.txt'), 'utf-8').replace(/^﻿/, '');
  const lines = txt.split('\n');
  const hdr = lines[0].split('|');
  const iZ = hdr.indexOf('GEOID_ZCTA5_20'), iF = hdr.indexOf('GEOID_COUNTY_20'), iA = hdr.indexOf('AREALAND_PART');
  const tmp = {};
  for (const line of lines.slice(1)) {
    const p = line.split('|');
    const z = p[iZ], f = p[iF];
    if (!z || !f || f.length !== 5) continue;
    if (!ST_OF_FIPS2[f.slice(0, 2)]) continue;
    (tmp[z] ||= []).push([f, +p[iA] || 0]);
  }
  for (const [z, list] of Object.entries(tmp)) {
    list.sort((a, b) => b[1] - a[1]);
    zipCand[z] = list.map(x => x[0]);
  }
  let filled = 0;
  for (const line of readFileSync(join(CACHE, 'US.txt'), 'utf-8').split('\n')) {
    const p = line.split('\t');
    if (p.length < 7) continue;
    const z = p[1], st = p[4], a2 = p[6];
    if (zipCand[z]) continue;
    if (!FIPS2[st] || !/^\d{3}$/.test(a2)) continue;
    zipCand[z] = [FIPS2[st] + a2];
    filled++;
  }
  log('zips: ' + Object.keys(zipCand).length + ' (' + filled + ' filled from GeoNames)');
}

/* ---- collapse zips to entries; ask only across genuinely different pricing ---- */
// zip value: "fips"  (unambiguous or price-identical candidates)
//            ["fips","fips",...]  (the reader must pick a county)
const zipVal = {};
function keyFor(fips, zip) {
  const st = ST_OF_FIPS2[fips.slice(0, 2)];
  if (st === 'AK') { const ra = AK_ZIP3[zip.slice(0, 3)]; return ra ? fips + '|' + ra : null; }
  if (st === 'MA') { const ra = graZip3.MA[zip.slice(0, 3)]; return ra ? fips + '|' + ra : null; }
  // LA County: a ZIP3 outside CMS's split list never resolves — no guessing
  if (fips === '06037') { const ra = graZip3.CA_LA[zip.slice(0, 3)]; return ra ? fips + '|' + ra : null; }
  return fips;
}
{
  let asks = 0, covered = 0, dropped = [];
  for (const [zip, cands] of Object.entries(zipCand)) {
    const valid = cands.filter(f => { const k = keyFor(f, zip); return k && entries[k]; });
    if (!valid.length) { dropped.push(zip + ' (' + cands.map(f => ST_OF_FIPS2[f.slice(0, 2)] + ' ' + f).join(', ') + ')'); continue; }
    const sigs = valid.map(f => { const e = entries[keyFor(f, zip)]; return JSON.stringify(e.p); });
    const allSame = sigs.every(s => s === sigs[0]);
    zipVal[zip] = allSame || valid.length === 1 ? valid[0] : valid;
    if (!allSame && valid.length > 1) asks++;
    covered++;
  }
  log('zip entries: ' + covered + ' covered, ' + asks + ' ask-the-reader splits, ' + dropped.length + ' with no marketplace county');
  // PO-box-only ZIPs can point at geography the marketplace files don't use
  // (CT's new planning-region FIPS; LA's PO-box-only ZIP3 901 absent from the
  // CMS split table). They have no residents' homes of their own: inherit the
  // nearest deliverable ZIP's resolution, by GeoNames coordinates, same state.
  // Stored as "!key" (a fully resolved county entry) so the client never
  // re-derives a rating area from a ZIP3 the CMS tables do not know.
  {
    const zipLL = {};
    for (const line of readFileSync(join(CACHE, 'US.txt'), 'utf-8').split('\n')) {
      const p = line.split('\t');
      if (p.length < 11) continue;
      zipLL[p[1]] = [+p[9], +p[10], p[4]];
    }
    let inherited = 0, still = [];
    for (const d of dropped) {
      const zip = d.slice(0, 5);
      const me = zipLL[zip];
      if (!me) { still.push(d); continue; }
      let best = null, bd = Infinity;
      for (const [z, v] of Object.entries(zipVal)) {
        const o = zipLL[z];
        if (!o || o[2] !== me[2]) continue;
        const dd = (o[0] - me[0]) ** 2 + ((o[1] - me[1]) * Math.cos(me[0] / 57.3)) ** 2;
        if (dd < bd) { bd = dd; best = z; }
      }
      if (!best || bd > 0.09) { still.push(d); continue; }   // ~33km cap
      const v = zipVal[best];
      const fips = Array.isArray(v) ? v[0] : v;
      const k = keyFor(fips, best);                          // neighbour's own ZIP3 resolves it
      if (!k || !entries[k]) { still.push(d); continue; }
      zipVal[zip] = k === fips ? fips : '!' + k;
      inherited++;
    }
    log('PO-box fallback: ' + inherited + ' ZIPs inherit their nearest deliverable ZIP; ' + still.length + ' stay uncovered');
    if (still.length) log('  ' + still.slice(0, 12).join(' | '));
  }
}

/* ---- emit ---- */
{
  // dedupe curves
  const curveKey = c => c.map(v => Math.round(v * 1000)).join(',');
  const curves = {}, stCurve = {};
  let cn = 0;
  const fedKey = curveKey(stateCurve.FL);
  for (const [st, c] of Object.entries(stateCurve)) {
    const k = curveKey(c);
    let id = Object.keys(curves).find(i => curves[i] === k);
    if (!id) { id = k === fedKey ? 'fed' : st.toLowerCase(); curves[id] = k; }
    stCurve[st] = id;
  }
  const curveOut = Object.fromEntries(Object.entries(curves).map(([id, k]) => [id, k.split(',').map(Number)]));

  const states = {};
  for (const st of Object.keys(FIPS2)) {
    states[st] = {
      year: HELD.includes(st) ? FROZEN.year : PLAN_YEAR,
      src: HELD.includes(st) ? 'prior' : STATE_SOURCED.includes(st) ? 'state' : 'cms',
      curve: sbeTiers[st] ? null : stCurve[st],
      tiers: !!sbeTiers[st],
      exchange: SBE_STATES.includes(st) ? 'state' : 'federal',
      expanded: !NOT_EXPANDED.has(st),
      chip: CHIP[st] / 100
    };
  }

  // Provenance for the methodology page, per state that is not CMS's.
  const provenance = {};
  for (const st of STATE_SOURCED) {
    const j = stateJson[st];
    provenance[st] = {
      by: PUBLISHER[st] || fail('no PUBLISHER for ' + st),
      kind: j.kind, final: j.final, precision: j.precision, age: j.kind === 'slcsp' ? j.age : undefined,
      sources: j.sources, notes: j.notes || [], checks: checkedCount[st] || 0
    };
  }
  for (const st of HELD) provenance[st] = { held: true, year: FROZEN.year, why: HELD_WHY[st] };

  const co = {};
  for (const [key, e] of Object.entries(entries)) {
    const fips = key.split('|')[0];
    co[key] = [e.p, e.ra, (countyName[fips] || '').replace(/ County$/, '')];
  }

  // zip table grouped by prefix for size
  const zipOut = {};
  for (const [zip, v] of Object.entries(zipVal)) {
    (zipOut[zip.slice(0, 3)] ||= {})[zip.slice(3)] = v;
  }

  const today = new Date().toISOString().slice(0, 10);
  const data = {
    asOf: today, planYear: PLAN_YEAR,
    fips: ST_OF_FIPS2,
    zip3ra: { AK: AK_ZIP3, MA: graZip3.MA, LA: graZip3.CA_LA },
    curves: curveOut, states, provenance, counties: co, zip: zipOut
  };
  const json = JSON.stringify(data);
  const out = `/* Generated by tools/build-benchmarks.mjs — DO NOT EDIT BY HAND. Regenerate with:
 *     node tools/build-benchmarks.mjs
 * Retrieved ${today}. Sources (plan year ${PLAN_YEAR}, all public domain except GeoNames CC BY 4.0):
 * CMS Exchange PUFs (rate, plan attributes, service area) and the QHP landscape
 * file for the healthcare.gov states (states[ST].src "cms"); each state's own
 * published rate tables for the state exchanges (src "state", sources in
 * provenance); the ${FROZEN.year} table for states held on last year (src "prior",
 * year ${FROZEN.year}); CMS geographic-rating-area tables (AK and MA rate by
 * 3-digit ZIP; Los Angeles County splits into two areas by ZIP); Census 2020
 * ZCTA-county relationship file plus GeoNames (geonames.org) for PO-box ZIPs;
 * Medicaid.gov eligibility-levels table for expansion status and CHIP limits.
 * counties["fips"] (or "fips|ratingArea" where ZIP3 decides the area) =
 * [slcspAge21Cents | tierCentsArray, ratingArea, countyName]. NY and VT rate by
 * family tier: [individual, couple, primary+1/2/3+, couple+1/2/3+] cents. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.WholeBillBench = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  return ${json};
}));
`;
  writeFileSync(OUT, out);
  log('wrote ' + OUT + ' (' + (out.length / 1024).toFixed(0) + ' KB, ' + Object.keys(co).length + ' county entries, ' + Object.keys(zipVal).length + ' zips)');
  // eyeball line for the five previous metros
  for (const [name, fips] of [['Hartford', '09003'], ['NYC (Manhattan)', '36061'], ['Dallas', '48113'], ['Miami-Dade', '12086'], ['Philadelphia', '42101']]) {
    const e = entries[fips];
    log('  ' + name + ': ' + (e ? (Array.isArray(e.p) ? 'tiers ' + e.p.map(c => (c / 100).toFixed(2)).join('/') : '$' + (e.p / 100).toFixed(2) + '/mo age 21') + ' · RA ' + e.ra + ' · ' + e.n + ' plans' : 'MISSING'));
  }
}
