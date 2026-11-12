/* Shared pieces for the per-state extractors (see README.md in this folder).
 * Node built-ins plus curl, python3 (standard library only) and pdftotext. */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PLAN_YEAR = 2027;
export const CACHE = join(HERE, '..', 'cache', String(PLAN_YEAR));
export const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export const log = m => console.log(m);
export function fail(st, m) { console.error('FAIL ' + st + ': ' + m); process.exit(1); }

export function stateDir(st) {
  const d = join(CACHE, 'states', st.toLowerCase());
  mkdirSync(d, { recursive: true });
  return d;
}

/* Download once into the state's cache folder; returns the local path. */
export function fetchCached(st, url, name) {
  const dest = join(stateDir(st), name);
  if (!existsSync(dest)) {
    log('  fetching ' + url);
    execFileSync('curl', ['-sfL', '--max-time', '300', '-A', UA, url, '-o', dest]);
  }
  return dest;
}

/* Every row of one sheet as an array of cell values (strings or numbers).
 * `sheet` is a name or a 0-based index. */
export function xlsxRows(path, sheet = 0) {
  const out = execFileSync('python3', ['-I', join(HERE, 'xlsx-rows.py'), path, String(sheet)],
    { maxBuffer: 1 << 30 }).toString();
  return JSON.parse(out);
}
export function xlsxSheets(path) {
  return JSON.parse(execFileSync('python3', ['-I', join(HERE, 'xlsx-rows.py'), path, '--list']).toString());
}

export function pdfText(path, layout = true) {
  return execFileSync('pdftotext', [...(layout ? ['-layout'] : []), path, '-'], { maxBuffer: 1 << 30 }).toString();
}

/* The federal default age curve (45 CFR 147.102), age 21 = 1, index = age. */
export const FED_CURVE = [
  0.765,0.765,0.765,0.765,0.765,0.765,0.765,0.765,0.765,0.765,0.765,0.765,0.765,0.765,0.765,
  0.833,0.859,0.885,0.913,0.941,0.970,1.000,1.000,1.000,1.000,1.004,1.024,1.048,1.087,1.119,
  1.135,1.159,1.183,1.198,1.214,1.222,1.230,1.238,1.246,1.262,1.278,1.302,1.325,1.357,1.397,
  1.444,1.500,1.563,1.635,1.706,1.786,1.865,1.952,2.040,2.135,2.230,2.333,2.437,2.548,2.603,
  2.714,2.810,2.873,2.952,3.000
];

/* Census 2020 county names for one state: { normalised name -> fips5 }, with
 * and without the "County"/"Parish"... suffix. Throws on an ambiguous name. */
const ST_FIPS = { AL:'01',AK:'02',AZ:'04',AR:'05',CA:'06',CO:'08',CT:'09',DE:'10',DC:'11',FL:'12',GA:'13',HI:'15',ID:'16',IL:'17',IN:'18',IA:'19',KS:'20',KY:'21',LA:'22',ME:'23',MD:'24',MA:'25',MI:'26',MN:'27',MS:'28',MO:'29',MT:'30',NE:'31',NV:'32',NH:'33',NJ:'34',NM:'35',NY:'36',NC:'37',ND:'38',OH:'39',OK:'40',OR:'41',PA:'42',RI:'44',SC:'45',SD:'46',TN:'47',TX:'48',UT:'49',VT:'50',VA:'51',WA:'53',WV:'54',WI:'55',WY:'56' };
export const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
let countyCache = null;
export function counties(st) {
  if (!countyCache) {
    const f = join(CACHE, 'zcta_county.txt');
    if (!existsSync(f)) {
      mkdirSync(CACHE, { recursive: true });
      execFileSync('curl', ['-sfL', '-A', UA,
        'https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt', '-o', f]);
    }
    const lines = readFileSync(f, 'utf-8').replace(/^﻿/, '').split('\n');
    const hdr = lines[0].split('|');
    const iF = hdr.indexOf('GEOID_COUNTY_20'), iN = hdr.indexOf('NAMELSAD_COUNTY_20');
    countyCache = {};
    for (const line of lines.slice(1)) {
      const p = line.split('|');
      if (p[iF] && p[iF].length === 5) countyCache[p[iF]] = p[iN];
    }
  }
  const pre = ST_FIPS[st], byName = {}, all = [];
  for (const [f, n] of Object.entries(countyCache)) {
    if (f.slice(0, 2) !== pre) continue;
    all.push(f);
    const full = norm(n), bare = full.replace(/ (county|parish|borough|census area|municipality|city and borough|city)$/, '');
    for (const k of new Set([full, bare])) byName[k] = byName[k] === undefined ? f : 'DUP';
  }
  return { all: all.sort(), fipsOf(name) {
    const f = byName[norm(name)];
    if (!f || f === 'DUP') throw new Error(st + ': county "' + name + '" ' + (f ? 'is ambiguous' : 'not found'));
    return f;
  }, nameOf: f => countyCache[f] };
}

/* Check the shape against README.md and write the state's JSON. */
export function writeState(o) {
  const st = o.state, bad = m => fail(st, 'shape: ' + m);
  if (!/^[A-Z]{2}$/.test(st)) bad('state');
  if (o.planYear !== PLAN_YEAR) bad('planYear');
  if (!['plans', 'slcsp'].includes(o.kind)) bad('kind');
  if (typeof o.final !== 'boolean') bad('final');
  if (!['cents', 'dollars'].includes(o.precision)) bad('precision');
  if (!Array.isArray(o.sources) || !o.sources.length || o.sources.some(s => !/^https:\/\//.test(s.url) || !s.title)) bad('sources');
  for (const n of o.notes || []) if (/[–—]/.test(n)) bad('a note carries an em or en dash');
  const fips = f => typeof f === 'string' && f.length === 5 && f.slice(0, 2) === ST_FIPS[st];
  const curveOk = c => c === 'fed' || (Array.isArray(c) && c.length === 65 && Math.abs(c[21] - 1) < 1e-9);
  if (o.kind === 'plans') {
    if (!Array.isArray(o.plans) || o.plans.length < 2) bad('plans');
    let needCurve = false;
    const ids = new Set();
    for (const p of o.plans) {
      if (!p.id || ids.has(p.id)) bad('duplicate or missing id ' + p.id);
      ids.add(p.id);
      if (p.counties !== 'all' && (!Array.isArray(p.counties) || !p.counties.length || !p.counties.every(fips))) bad('counties of ' + p.id);
      for (const [ra, r] of Object.entries(p.rates || {})) {
        if (!/^\d+$/.test(ra)) bad('rating area key ' + ra + ' of ' + p.id);
        if (Array.isArray(r)) { if (r.length !== 65 || !r.every(v => v > 0)) bad('age rates of ' + p.id + ' area ' + ra); }
        else if (r.tiers) { if (r.tiers.length !== 8 || !r.tiers.every(v => v > 0)) bad('tiers of ' + p.id); }
        else if (r.at != null) { needCurve = true; if (!(r.premium > 0)) bad('premium of ' + p.id); }
        else bad('rate form of ' + p.id);
      }
      if (!Object.keys(p.rates || {}).length) bad('no rates for ' + p.id);
    }
    if (needCurve && !curveOk(o.curve)) bad('curve');
  } else {
    if (![21, 40].includes(o.age) && !(o.age >= 0 && o.age <= 64)) bad('age');
    if (!curveOk(o.curve)) bad('curve');
    const keys = Object.keys(o.counties || {});
    if (!keys.length || !keys.every(fips) || keys.some(k => !(o.counties[k].premium > 0))) bad('counties');
  }
  for (const c of o.checks || []) {
    if (!['slcsp', 'lowest'].includes(c.what) || !(c.premium > 0) || !c.source) bad('check ' + JSON.stringify(c));
    if (!c.fips && c.ra == null) bad('check without fips or ra');
  }
  const out = join(CACHE, 'states', st.toLowerCase() + '.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(o, null, 1));
  log('wrote ' + out + ' (' + o.kind + (o.kind === 'plans' ? ', ' + o.plans.length + ' plans' : ', ' + Object.keys(o.counties).length + ' counties') + ', ' + (o.checks || []).length + ' checks)');
}
