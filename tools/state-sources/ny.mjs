/* New York, plan year 2027: the regulator's approved rates and the exchange's
 * participation grid.
 *
 * Rates: NY DFS "2027 Final Exhibits", one zip per insurer. Exhibit 23 lists
 * every plan (16-digit HIOS ID) with its metal, exchange status, child-only and
 * dependent-age flags and the approved individual rate in each of the eight
 * DFS regions. Family tiers come from each insurer's "Approved Rates" file (the
 * CMS Rates Table Template, family-tier method) on DFS's "Additional Information
 * 2027" page, joined on the 14-character plan ID; its individual rate must equal
 * Exhibit 23's to the cent.
 *
 * Availability: NY State of Health, "2027 Individual Qualified Health Plan
 * Participation by Issuer & County" (an x per insurer brand and county).
 *
 * Validation (not a check, it is 2026): the same exhibits' 2026 columns with the
 * 2026 participation grid must reproduce NY State of Health's published 2026
 * lowest cost silver plan for every county, to the cent.
 *
 *   node tools/state-sources/ny.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fetchCached, stateDir, xlsxRows, xlsxSheets, pdfText, counties, writeState, fail, log, norm } from './lib.mjs';

const ST = 'NY';
const DIR = stateDir(ST);
const DFS = 'https://myportal.dfs.ny.gov';
const FINAL_IDX = DFS + '/web/prior-approval/2027-final-exhibits';
const ADDL_IDX = DFS + '/web/prior-approval/ind-and-sg-medical/additional-information-2027';
const NYSOH = 'https://info.nystateofhealth.ny.gov';
const PART = y => NYSOH + '/sites/default/files/' + y + '%20Individual%20Qualified%20Health%20Plan%20Participation%20by%20Issuer%20%26%20County.pdf';
const LCSP26 = NYSOH + '/sites/default/files/2026%20Lowest%20Cost%20SIlver%20Plan%20by%20County.pdf';
const PRESS = 'https://www.health.ny.gov/press/releases/2026/2026-10-28_open_enrollment_2027_coverage.htm';
const PLANS_IDX = NYSOH + '/2027plans';

/* The fixed New York tier multipliers (11 NYCRR 360.4; DFS family-tier rating):
 * individual, couple, parent and child(ren), couple and child(ren). The site's
 * tier array is [individual, couple, parent+1, parent+2, parent+3+, couple+1,
 * couple+2, couple+3+]. */
const MULT = [1, 2, 1.7, 1.7, 1.7, 2.85, 2.85, 2.85];

/* Exhibit 23 file prefix -> HIOS issuer ID. The off-exchange-only filers are
 * listed so that a new on-exchange filing from them is noticed, not dropped. */
const ISSUERS = {
  Aetna_Life: { hios: '17210', offOnly: true },
  Anthem_HP: { hios: '41046', name: 'Anthem' },
  CDPHP: { hios: '94788', name: 'CDPHP' },
  Excellus: { hios: '78124', name: 'Excellus' },
  HIP: { hios: '88582', name: 'EmblemHealth' },
  Healthfirst_PHSP: { hios: '91237', name: 'Healthfirst' },
  Highmark: { hios: '40064', name: 'Highmark' },
  IHBC: { hios: '18029', name: 'Independent Health' },
  MVP_HP: { hios: '56184', name: 'MVP' },
  MetroPlus: { hios: '11177', name: 'MetroPlus' },
  NYQHC: { hios: '25303', name: 'Fidelis Care' },
  Oscar: { hios: '74289', name: 'Oscar', leaving: true },
  UHC: { hios: '54235', name: 'UnitedHealthcare' },
  UHIC: { hios: '54297', offOnly: true },
};
/* Participation-grid column headers, left to right, and the issuer each brand
 * files under. Anthem, Excellus (Univera) and Highmark each sell two brands. */
const BRANDS = {
  2027: [['Ambetter', '25303'], ['Anthem', '41046'], ['Anthem', '41046'], ['CDPHP', '94788'], ['Emblem', '88582'],
    ['Excellus', '78124'], ['Healthfirst', '91237'], ['Highmark', '40064'], ['Highmark', '40064'],
    ['Independent', '18029'], ['MetroPlus', '11177'], ['MVP', '56184'], ['United', '54235'], ['Univera', '78124']],
};
BRANDS[2026] = [...BRANDS[2027].slice(0, 12), ['Oscar', '74289'], ...BRANDS[2027].slice(12)];

const sh = (cmd, args) => execFileSync(cmd, args, { maxBuffer: 1 << 30 }).toString();
const cents = v => Math.round(v * 100);
const isRate = v => typeof v === 'number' && v > 0;
const pdfDate = f => (sh('pdfinfo', [f]).match(/CreationDate:\s+\w+ (\w+)\s+(\d+) [\d:]+ (\d{4})/) || []).slice(1);
const MON = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
const isoPdf = f => { const [m, d, y] = pdfDate(f); if (!y) fail(ST, 'no creation date in ' + f); return y + '-' + MON[m] + '-' + d.padStart(2, '0'); };
const unzipTo = (zip, dir, pattern) => {
  if (!existsSync(dir)) { mkdirSync(dir, { recursive: true }); sh('unzip', ['-o', '-j', '-q', zip, ...(pattern ? [pattern] : []), '-d', dir]); }
  return readdirSync(dir).map(f => join(dir, f));
};
const zipNewest = zip => {
  const ds = [...sh('unzip', ['-l', zip]).matchAll(/(\d\d)-(\d\d)-(\d{4}) \d\d:\d\d/g)].map(m => m[3] + '-' + m[1] + '-' + m[2]);
  return ds.sort().pop();
};

/* ---- legacy .xls (BIFF8): a standard-library reader, since lib.mjs reads only xlsx ---- */
const XLS_PY = String.raw`
import sys, struct, json
data = open(sys.argv[1], 'rb').read()
if data[:8] != bytes.fromhex('D0CF11E0A1B11AE1'): raise SystemExit('not an OLE2 file')
ssz = 1 << struct.unpack_from('<H', data, 30)[0]
nfat = struct.unpack_from('<I', data, 44)[0]
dir0 = struct.unpack_from('<I', data, 48)[0]
difat0, ndifat = struct.unpack_from('<II', data, 68)
def sec(i): return data[512 + i * ssz: 512 + (i + 1) * ssz]
difat = list(struct.unpack_from('<109I', data, 76)); d = difat0
for _ in range(ndifat):
    vals = struct.unpack_from('<%dI' % (ssz // 4), sec(d)); difat += vals[:-1]; d = vals[-1]
fat = []
for i in difat[:nfat]: fat += struct.unpack_from('<%dI' % (ssz // 4), sec(i))
def chain(start):
    out, i, seen = [], start, set()
    while i < 0xFFFFFFFA:
        if i in seen: raise SystemExit('FAT loop')
        seen.add(i); out.append(sec(i)); i = fat[i]
    return b''.join(out)
dirs = chain(dir0); book = None
for k in range(len(dirs) // 128):
    e = dirs[k * 128:(k + 1) * 128]; nl = struct.unpack_from('<H', e, 64)[0]
    if e[:max(0, nl - 2)].decode('utf-16-le') in ('Workbook', 'Book'):
        start, size = struct.unpack_from('<II', e, 116)
        if size < 4096: raise SystemExit('workbook in the mini stream')
        book = chain(start)[:size]
if book is None: raise SystemExit('no Workbook stream')
recs, p = [], 0
while p + 4 <= len(book):
    t, n = struct.unpack_from('<HH', book, p); recs.append((t, book[p + 4:p + 4 + n], p)); p += 4 + n
class Seg:
    def __init__(s, parts): s.parts, s.i, s.p = parts, 0, 0
    def need(s):
        if s.p >= len(s.parts[s.i]): s.i += 1; s.p = 0; return True
        return False
    def take(s, n):
        out = b''
        while n:
            s.need(); b = s.parts[s.i][s.p:s.p + n]; out += b; s.p += len(b); n -= len(b)
        return out
    def chars(s, cch, high):
        out = ''
        while cch:
            if s.need(): high = s.parts[s.i][0] & 1; s.p = 1
            w = 2 if high else 1; k = min((len(s.parts[s.i]) - s.p) // w, cch)
            b = s.parts[s.i][s.p:s.p + k * w]; s.p += k * w
            out += b.decode('utf-16-le' if high else 'latin-1'); cch -= k
        return out
def ustr(seg, lb):
    cch = struct.unpack('<H' if lb == 2 else '<B', seg.take(lb))[0]; fl = seg.take(1)[0]; runs = ext = 0
    if fl & 8: runs = struct.unpack('<H', seg.take(2))[0]
    if fl & 4: ext = struct.unpack('<I', seg.take(4))[0]
    s = seg.chars(cch, fl & 1); seg.take(4 * runs + ext); return s
def rk(v):
    x = float(struct.unpack('<i', struct.pack('<I', v))[0] >> 2) if v & 2 else struct.unpack('<d', struct.pack('<Q', (v & 0xFFFFFFFC) << 32))[0]
    return x / 100 if v & 1 else x
def num(x): return int(x) if float(x).is_integer() else x
sst, sheets = [], []
for k, (t, b, pos) in enumerate(recs):
    if t == 0x85: sheets.append((ustr(Seg([b[6:]]), 1), struct.unpack_from('<I', b, 0)[0], b[5]))
    elif t == 0xFC:
        parts = [b[8:]]; j = k + 1
        while recs[j][0] == 0x3C: parts.append(recs[j][1]); j += 1
        seg = Seg(parts)
        for _ in range(struct.unpack_from('<I', b, 4)[0]): sst.append(ustr(seg, 2))
byoff = {pos: k for k, (t, b, pos) in enumerate(recs)}; out = {}
for name, off, kind in sheets:
    if kind != 0: continue
    k = byoff[off]; cells = {}; pend = None
    while True:
        k += 1; t, b, _ = recs[k]
        if t == 0x0A: break
        if t == 0xFD: r, c, _x, i = struct.unpack_from('<HHHI', b); cells[(r, c)] = sst[i]
        elif t == 0x203: r, c, _x, v = struct.unpack_from('<HHHd', b); cells[(r, c)] = num(v)
        elif t == 0x27E: r, c, _x, v = struct.unpack_from('<HHHI', b); cells[(r, c)] = num(rk(v))
        elif t == 0xBD:
            r, c = struct.unpack_from('<HH', b)
            for q in range((len(b) - 6) // 6): _x, v = struct.unpack_from('<HI', b, 4 + 6 * q); cells[(r, c + q)] = num(rk(v))
        elif t == 0x204: r, c, _x = struct.unpack_from('<HHH', b); cells[(r, c)] = ustr(Seg([b[6:]]), 2)
        elif t == 0x205: r, c, _x, v, e = struct.unpack_from('<HHHBB', b); cells[(r, c)] = bool(v) if e == 0 else None
        elif t == 0x06:
            r, c, _x = struct.unpack_from('<HHH', b); res = b[6:14]
            if res[6:8] == b'\xff\xff':
                if res[0] == 0: pend = (r, c)
                elif res[0] == 1: cells[(r, c)] = bool(res[2])
                else: cells[(r, c)] = None
            else: cells[(r, c)] = num(struct.unpack('<d', res)[0])
        elif t == 0x207 and pend:
            parts = [b]; j = k + 1
            while recs[j][0] == 0x3C: parts.append(recs[j][1]); j += 1
            cells[pend] = ustr(Seg(parts), 2); pend = None
    rows = [[] for _ in range(max([r for r, c in cells] + [-1]) + 1)]
    for (r, c), v in sorted(cells.items()):
        while len(rows[r]) < c: rows[r].append(None)
        rows[r].append(v)
    out[name] = rows
print(json.dumps(out))
`;
const xlsBook = f => JSON.parse(execFileSync('python3', ['-I', '-c', XLS_PY, f], { maxBuffer: 1 << 30 }).toString());
/* every sheet of an xls/xlsx/xlsm as { name: rows } */
function workbook(f) {
  const head = readFileSync(f).subarray(0, 8).toString('hex');
  if (head === 'd0cf11e0a1b11ae1') return xlsBook(f);
  if (head.startsWith('504b0304')) {
    const out = {};
    xlsxSheets(f).forEach((n, i) => { out[n] = xlsxRows(f, i); });
    return out;
  }
  fail(ST, 'unknown spreadsheet format: ' + f);
}

/* ---- geography: CMS rating areas (the area numbers the build keys on) ---- */
const cty = counties(ST);
if (cty.all.length !== 62) fail(ST, 'expected 62 counties, got ' + cty.all.length);
const graFile = join(DIR, '..', '..', '..', 'gra', 'ny.html');
if (!existsSync(graFile)) fail(ST, 'missing the CMS rating-area page ' + graFile);
const areaOf = {};
{
  const t = readFileSync(graFile, 'utf-8');
  const CMS_TYPO = { Deleware: 'Delaware' };   // CMS spells it "Deleware"
  for (const tr of t.match(/<tr[\s\S]*?<\/tr>/g)) {
    const c = [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map(m => m[1].replace(/<[^>]+>/g, '').trim());
    const m = c[0] && c[0].match(/^Rating Area (\d+)$/);
    if (!m) continue;
    const f = cty.fipsOf(CMS_TYPO[c[1]] || c[1]);
    if (areaOf[f]) fail(ST, 'county twice on the CMS page: ' + c[1]);
    areaOf[f] = +m[1];
  }
}
if (cty.all.some(f => !areaOf[f])) fail(ST, 'CMS page lacks ' + cty.all.filter(f => !areaOf[f]).map(cty.nameOf).join(', '));
/* DFS names its regions after a city; that city's county must be in the CMS area of the same number */
const REGION_COUNTY = { Albany: 'Albany', Buffalo: 'Erie', 'Mid-Hudson': 'Dutchess', 'New York': 'New York', Rochester: 'Monroe', Syracuse: 'Onondaga', Utica: 'Oneida', 'Long Island': 'Nassau' };

/* ---- downloads ---- */
const idxFinal = readFileSync(fetchCached(ST, FINAL_IDX, 'final-exhibits-index.html'), 'utf-8');
const idxAddl = readFileSync(fetchCached(ST, ADDL_IDX, 'additional-info-index.html'), 'utf-8');
const links = (html, kind) => [...new Set([...html.matchAll(new RegExp('href="(/documents/538523/\\d+/([A-Za-z_]+?)_IND_(ONX|BOTHX|OFFX)_([A-Z]+-\\d+)_' + kind + ')"', 'g'))].map(m => m.slice(1).join('|')))]
  .map(s => { const [path, ins, ex, serff] = s.split('|'); return { path, ins, ex, serff }; });
const finals = links(idxFinal, 'FinalExhibits'), apprs = links(idxAddl, 'ApprRatesTemplate');
const filed = new Set(finals.map(x => x.ins));
for (const ins of Object.keys(ISSUERS)) if (!filed.has(ins)) fail(ST, 'no 2027 individual final exhibits for ' + ins);
for (const x of finals) {
  const I = ISSUERS[x.ins];
  if (!I) fail(ST, 'an individual-market insurer this extractor does not know: ' + x.ins + ' (' + x.serff + ')');
  if (!!I.offOnly !== (x.ex === 'OFFX')) fail(ST, x.ins + ' files ' + x.ex + ', expected ' + (I.offOnly ? 'OFFX' : 'ONX or BOTHX'));
}
if (finals.length !== Object.keys(ISSUERS).length) fail(ST, 'expected ' + Object.keys(ISSUERS).length + ' individual final exhibits, found ' + finals.length);
/* the page states the approved action next to each insurer: confirm we are on the final page */
if (!/Approved 2027 Rate Action/.test(idxFinal)) fail(ST, 'final exhibits page no longer says "Approved 2027 Rate Action"');

let finalDate = '';
const ex23 = {}, ex18 = {};
for (const x of finals) {
  const zip = fetchCached(ST, DFS + x.path, x.path.split('/').pop() + '.zip');
  const d = zipNewest(zip); if (d > finalDate) finalDate = d;
  const base = join(DIR, 'final', x.ins);
  const f23 = unzipTo(zip, base + '-23', '*_IN_23_*.xlsm');
  if (f23.length !== 1) fail(ST, x.ins + ': expected one Exhibit 23 workbook, got ' + f23.length);
  ex23[x.ins] = f23[0];
  if (!ISSUERS[x.ins].offOnly && !ISSUERS[x.ins].leaving) {
    const f18 = unzipTo(zip, base + '-18', '*_IN_18_*.xlsm');
    if (f18.length !== 1) fail(ST, x.ins + ': expected one Exhibit 18 workbook, got ' + f18.length);
    ex18[x.ins] = f18[0];
  }
}

/* ---- Exhibit 23 ---- */
const NREG = 8;
function readEx23(ins) {
  const f = ex23[ins];
  const sheets = xlsxSheets(f), i = sheets.indexOf('23');
  if (i < 0) fail(ST, ins + ': Exhibit 23 has no sheet "23"');
  const rows = xlsxRows(f, i);
  const hr = rows.findIndex(r => r && r[0] === '1. Company Name');
  if (hr < 0) fail(ST, ins + ': Exhibit 23 header row not found');
  const h = rows[hr].map(v => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim()));
  const col = re => { const k = h.findIndex(v => re.test(v)); if (k < 0) fail(ST, ins + ': Exhibit 23 lacks a column ' + re); return k; };
  const c = { market: col(/^4\. Market$/), id: col(/^5\. Current HIOS ID/), metal: col(/^7\. Metal Level/), ex: col(/^8\. Exchange \/ CSR Type/),
    age: col(/^10\. Limiting Child Age/), child: col(/^17\. Child-Only Plan/) };
  const reg = {};
  for (const y of [2026, 2027]) {
    reg[y] = [];
    for (let r = 1; r <= NREG; r++) {
      const k = col(new RegExp('^Region ' + r + ' - ' + y + ' Rate \\(([^)]+)\\)$'));
      const city = h[k].match(/\(([^)]+)\)$/)[1];
      if (!REGION_COUNTY[city] || areaOf[cty.fipsOf(REGION_COUNTY[city])] !== r) fail(ST, ins + ': DFS region ' + r + ' (' + city + ') is not CMS rating area ' + r);
      reg[y].push(k);
    }
  }
  const out = [];
  for (const r of rows.slice(hr + 1)) {
    const id = r && r[c.id];
    if (!id) continue;
    // a plan discontinued before 2026 keeps its row with Current ID "NA" and no rates
    if (/^N\/?A$/i.test(id) && [...reg[2026], ...reg[2027]].every(k => !isRate(r[k]))) continue;
    if (!/^\d{5}NY\d{9}$/.test(id)) fail(ST, ins + ': bad HIOS ID ' + id);
    if (id.slice(0, 5) !== ISSUERS[ins].hios) fail(ST, ins + ': plan ' + id + ' is not issuer ' + ISSUERS[ins].hios);
    if (r[c.market] !== 'Individual') fail(ST, ins + ': ' + id + ' market ' + r[c.market]);
    const rate = y => reg[y].map(k => (isRate(r[k]) ? r[k] : null));
    out.push({ id, base: id.slice(0, 14), metal: r[c.metal], ex: String(r[c.ex] || '').trim(), age: r[c.age] == null ? null : Number(r[c.age]),
      child: String(r[c.child] || '').trim().toLowerCase(), r2026: rate(2026), r2027: rate(2027) });
  }
  if (!out.length) fail(ST, ins + ': no plans in Exhibit 23');
  return out;
}
/* on-exchange, individual, silver, not child-only, dependents to 26, no CSR variant */
function silver(rows, ins, y) {
  const keep = rows.filter(p => p.metal === 'Silver' && p.ex === 'On' && p.child === 'no' && p.age === 26);
  for (const p of rows) if (p.metal === 'Silver' && p.ex === 'On' && !['yes', 'no'].includes(p.child)) fail(ST, ins + ': child-only flag "' + p.child + '" on ' + p.id);
  for (const p of rows) if (p.metal === 'Silver' && p.ex === 'On' && p.child === 'no' && ![26, 30].includes(p.age)) fail(ST, ins + ': dependent age ' + p.age + ' on ' + p.id);
  const by = {};
  for (const p of keep) {
    const v = p['r' + y];
    if (!v.some(Boolean)) continue;
    const k = JSON.stringify(v);
    if (by[p.base] && by[p.base].k !== k) fail(ST, ins + ': variants of ' + p.base + ' disagree on ' + y + ' rates');
    by[p.base] = { k, base: p.base, rates: v };
  }
  return Object.values(by);
}
const E23 = {};
for (const ins of Object.keys(ISSUERS)) E23[ins] = readEx23(ins);
for (const ins of Object.keys(ISSUERS)) {
  if (ISSUERS[ins].offOnly && E23[ins].some(p => p.ex !== 'Off')) fail(ST, ins + ' files off-exchange only but Exhibit 23 lists an on-exchange plan');
}

/* ---- participation grids ---- */
function grid(year) {
  const f = fetchCached(ST, PART(year), year + '-participation.pdf');
  const xml = sh('pdftotext', ['-bbox', f, '-']);
  const pages = xml.split('<page ').slice(1);
  const W = p => [...p.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)]
    .map(m => ({ x: (+m[1] + +m[3]) / 2, x0: +m[1], y: +m[2], w: m[5].replace(/&amp;/g, '&') }));
  const words = pages.map(W);
  if (!/Individual/.test(xml) || !new RegExp(year + ' NYSOH').test(sh('pdftotext', ['-layout', f, '-']))) fail(ST, year + ' participation PDF title changed');
  // column centres from every x mark, merged within 3pt
  const xs = words.flat().filter(w => w.w === 'x').map(w => w.x).sort((a, b) => a - b);
  const cols = [];
  for (const x of xs) { if (cols.length && x - cols[cols.length - 1].hi < 3) { const c = cols[cols.length - 1]; c.hi = x; c.n++; c.s += x; } else cols.push({ lo: x, hi: x, n: 1, s: x }); }
  const ctr = cols.map(c => c.s / c.n);
  const brands = BRANDS[year];
  if (ctr.length !== brands.length) fail(ST, year + ' grid: ' + ctr.length + ' columns of marks, expected ' + brands.length);
  const nearest = x => ctr.reduce((b, c, i) => (Math.abs(c - x) < Math.abs(ctr[b] - x) ? i : b), 0);
  const out = {}; let marks = 0;
  for (const ws of words) {
    // the header: each brand's first word must sit over its own column, in order
    const keys = new Set(brands.map(b => b[0]));
    const anchors = ws.filter(w => w.y < 100 && keys.has(w.w)).sort((a, b) => a.x - b.x);
    if (anchors.map(a => a.w).join() !== brands.map(b => b[0]).join()) fail(ST, year + ' grid header reads ' + anchors.map(a => a.w).join());
    anchors.forEach((a, i) => { if (nearest(a.x) !== i) fail(ST, year + ' grid: header ' + a.w + ' is not over column ' + i); });
    // county names: words left of the first column, grouped by line
    const lines = {};
    for (const w of ws) if (w.y > 100 && w.x0 < 70 && w.w !== 'x') (lines[w.y.toFixed(1)] ||= []).push(w);
    const rows = Object.entries(lines).map(([y, l]) => ({ y: +y, name: l.sort((a, b) => a.x - b.x).map(w => w.w).join(' ') }));
    for (const w of ws.filter(w => w.w === 'x')) {
      const r = rows.filter(r => Math.abs(w.y - r.y - 2.4) < 4);
      if (r.length !== 1) fail(ST, year + ' grid: an x at ' + w.x.toFixed(1) + ',' + w.y.toFixed(1) + ' matches ' + r.length + ' county rows');
      const fips = cty.fipsOf(r[0].name);
      (out[fips] ||= new Set()).add(brands[nearest(w.x)][1]);
      marks++;
    }
    for (const r of rows) cty.fipsOf(r.name);
  }
  if (xs.length !== marks) fail(ST, year + ' grid: ' + xs.length + ' marks, ' + marks + ' placed');
  const miss = cty.all.filter(f => !out[f]);
  if (miss.length) fail(ST, year + ' grid has no insurer in ' + miss.map(cty.nameOf).join(', '));
  return { at: f, sets: out, marks };
}
const G27 = grid(2027), G26 = grid(2026);
for (const s of Object.values(G27.sets)) if (s.has(ISSUERS.Oscar.hios)) fail(ST, 'Oscar appears in the 2027 grid');

/* Oscar: DFS approved a BOTHX filing, but the Department of Health says it leaves NY State of Health */
const press = readFileSync(fetchCached(ST, PRESS, 'doh-press-2026-10-28.html'), 'utf-8').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
if (!/October 28, 2026/.test(press) || !/Oscar Health is no longer participating in the Marketplace/.test(press)) fail(ST, 'the DOH 28 Oct 2026 release no longer says Oscar leaves the Marketplace');
const nIss = (press.match(/(\w+) health insurers are offering Qualified Health Plans in 2027/) || [])[1];
const onEx = Object.keys(ISSUERS).filter(i => !ISSUERS[i].offOnly && !ISSUERS[i].leaving);
if (nIss !== 'Eleven' || onEx.length !== 11) fail(ST, 'DOH counts ' + nIss + ' insurers for 2027; this extractor has ' + onEx.length);
const gridIssuers = new Set(Object.values(G27.sets).flatMap(s => [...s]));
if (gridIssuers.size !== 11 || onEx.some(i => !gridIssuers.has(ISSUERS[i].hios))) fail(ST, 'the 2027 grid insurers differ from the filings');

/* ---- each plan's 2026 service area, from CMS's 2026 New York state-exchange PUF ----
 * The participation grid is per insurer, but some products are local: Excellus
 * sells its Bassett Preferred silver only in Delaware, Herkimer, Oneida and Otsego,
 * though Excellus is marked in every Utica-region county. Read alone, the grid
 * misses NY State of Health's own 2026 figure for Clinton County. So a plan that
 * was sold in 2026 is placed only in the 2026 counties of its service area that
 * the 2027 grid still marks for its insurer. */
const csv = t => {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(f); f = ''; }
    else if (ch === '\n') { row.push(f.replace(/\r$/, '')); rows.push(row); row = []; f = ''; }
    else f += ch;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const h = rows.shift().map(s => s.replace(/^﻿/, ''));
  return rows.filter(r => r.length === h.length).map(r => Object.fromEntries(h.map((k, i) => [k, r[i]])));
};
const PUF26 = 'https://www.cms.gov/files/zip/newyorksbepuf2026.zip';
const sa26 = {};
{
  const files = unzipTo(fetchCached(ST, PUF26, 'newyorksbepuf2026.zip'), join(DIR, 'puf2026'));
  const pick = re => { const f = files.filter(x => re.test(x)); if (f.length !== 1) fail(ST, 'CMS 2026 NY PUF: expected one file like ' + re); return csv(readFileSync(f[0], 'utf-8')); };
  const P = pick(/NYPlans\d+\.csv$/), A = pick(/NYServiceAreas\d+\.csv$/);
  const area = {};
  for (const r of A) {
    if (r['MARKET COVERAGE'] !== 'Individual' || r['DENTAL PLAN ONLY'] === 'Yes' || r['BUSINESS YEAR'] !== '2026') continue;
    const k = r['ISSUER ID'] + '|' + r['SERVICE AREA ID'];
    area[k] ||= new Set();
    if (r['COVER ENTIRE STATE'] === 'true') cty.all.forEach(f => area[k].add(f));
    else { const m = r.COUNTY.match(/(36\d{3})$/); if (!m || r['PARTIAL COUNTY'] !== 'false') fail(ST, 'CMS 2026 NY PUF: county "' + r.COUNTY + '" partial=' + r['PARTIAL COUNTY']); area[k].add(m[1]); }
  }
  for (const r of P) {
    if (r['MARKET COVERAGE'] !== 'Individual' || r['DENTAL ONLY PLAN'] === 'Yes') continue;
    const s = area[r['ISSUER ID'] + '|' + r['SERVICE AREA ID']];
    if (!s) fail(ST, 'CMS 2026 NY PUF: no service area ' + r['SERVICE AREA ID'] + ' for ' + r['STANDARD COMPONENT ID']);
    sa26[r['STANDARD COMPONENT ID']] = s;
  }
  if (Object.keys(sa26).length < 100) fail(ST, 'CMS 2026 NY PUF: only ' + Object.keys(sa26).length + ' plans');
}
/* counties for one plan: rated in the county's area, insurer marked in the grid, and
 * inside the plan's 2026 service area when it had one */
const placed = [];   // [plan, county] pairs the 2026 service area could not settle
function where(id, hios, rated, G) {
  return cty.all.filter(f => {
    if (!rated(areaOf[f]) || !G.sets[f].has(hios)) return false;
    if (sa26[id]) return sa26[id].has(f);
    placed.push(id + ' ' + cty.nameOf(f)); return true;
  });
}

/* ---- 2026 validation: lowest on-exchange silver per county vs NY State of Health ---- */
{
  const lc = fetchCached(ST, LCSP26, '2026-lcsp.pdf');
  const txt = pdfText(lc);
  if (!/2026 Monthly Premium Amount of Lowest Cost Silver Plan/.test(txt)) fail(ST, '2026 LCSP PDF title changed');
  const pub = {};
  for (const m of txt.matchAll(/([A-Z][A-Za-z.]+(?: [A-Z][A-Za-z.]+)?)\s+\$([\d,]+\.\d\d)/g)) {
    const f = cty.fipsOf(m[1]);
    if (pub[f]) fail(ST, '2026 LCSP lists ' + m[1] + ' twice');
    pub[f] = +m[2].replace(/,/g, '');
  }
  if (Object.keys(pub).length !== 62) fail(ST, '2026 LCSP PDF parsed ' + Object.keys(pub).length + ' counties');
  const plans26 = [];
  for (const ins of Object.keys(ISSUERS)) if (!ISSUERS[ins].offOnly) for (const p of silver(E23[ins], ins, 2026)) {
    if (!sa26[p.base]) fail(ST, '2026 validation: ' + p.base + ' has 2026 rates but no 2026 CMS service area');
    plans26.push({ ...p, counties: new Set(where(p.base, ISSUERS[ins].hios, ra => p.rates[ra - 1], G26)) });
  }
  const bad = [];
  for (const f of cty.all) {
    const ra = areaOf[f];
    const v = plans26.filter(p => p.counties.has(f)).map(p => p.rates[ra - 1]).sort((a, b) => a - b);
    if (!v.length || cents(v[0]) !== cents(pub[f])) bad.push(cty.nameOf(f) + ' computed ' + v[0] + ' published ' + pub[f]);
  }
  if (bad.length) fail(ST, '2026 validation: ' + bad.length + ' counties differ: ' + bad.join('; '));
  // the grid alone, for the record
  const gridOnly = cty.all.filter(f => {
    const ra = areaOf[f];
    const v = plans26.filter(p => G26.sets[f].has(p.base.slice(0, 5)) && p.rates[ra - 1]).map(p => p.rates[ra - 1]).sort((a, b) => a - b);
    return cents(v[0]) !== cents(pub[f]);
  });
  log('  2026 with the insurer grid alone would miss ' + gridOnly.length + ' counties: ' + gridOnly.map(cty.nameOf).join(', '));
  const want = { Albany: 680.51, Bronx: 806.61, Erie: 581.62, Monroe: 730.00, Tompkins: 1041.11 };
  for (const [n, v] of Object.entries(want)) if (cents(pub[cty.fipsOf(n)]) !== cents(v)) fail(ST, '2026 LCSP for ' + n + ' is now ' + pub[cty.fipsOf(n)]);
  log('  2026 validation: lowest silver reproduced for all 62 counties to the cent (' + plans26.length + ' plans)');
  var lcspDate = isoPdf(lc);
}

/* ---- approved family-tier rates ---- */
const tiers = {};
let apprDate = '';
for (const ins of onEx) {
  const a = apprs.find(x => x.ins === ins);
  if (!a) fail(ST, 'no Approved Rates file for ' + ins);
  const bin = fetchCached(ST, DFS + a.path, a.path.split('/').pop() + '.bin');
  let files = [bin];
  if (readFileSync(bin).subarray(0, 4).toString('hex') === '504b0304' && !sh('unzip', ['-l', bin]).includes('xl/workbook.xml')) {
    files = unzipTo(bin, join(DIR, 'appr', ins)).filter(f => /\.xls[xm]?$/.test(f));
    const d = zipNewest(bin); if (d > apprDate) apprDate = d;
  }
  let n = 0;
  for (const f of files) for (const [sheet, rows] of Object.entries(workbook(f))) {
    const hr = rows.findIndex(r => r && r[0] === 'Plan ID*');
    if (hr < 0) continue;
    const want = ['Plan ID*', 'Rating Area ID*', 'Tobacco*', 'Age*', 'Individual Rate*', 'Individual Tobacco Rate*', 'Couple*',
      'Primary Subscriber and One Dependent*', 'Primary Subscriber and Two Dependents*', 'Primary Subscriber and Three or More Dependents*',
      'Couple and One Dependent*', 'Couple and Two Dependents*', 'Couple and Three or More Dependents*'];
    if (rows[hr].slice(0, 13).join('|') !== want.join('|')) fail(ST, ins + ' ' + sheet + ': template columns changed');
    const method = (rows.find(r => r && r[0] === 'Rating Method*') || [])[1];
    const issuer = String((rows.find(r => r && r[0] === 'HIOS Issuer ID*') || [])[1]);
    if (method !== 'Family-Tier Rates') continue;          // age-based sheets carry child-only plans
    if (issuer !== ISSUERS[ins].hios) fail(ST, ins + ' ' + sheet + ': template issuer ' + issuer);
    for (const r of rows.slice(hr + 1)) {
      if (!r || !/^\d{5}NY\d{7}$/.test(r[0] || '')) continue;
      const m = String(r[1]).match(/^Rating Area (\d+)$/);
      if (!m || +m[1] < 1 || +m[1] > NREG) fail(ST, ins + ': rating area "' + r[1] + '" for ' + r[0]);
      const t = r.slice(4, 13); t.splice(1, 1);              // drop the tobacco column
      if (!t.every(isRate)) fail(ST, ins + ': incomplete tiers for ' + r[0] + ' area ' + m[1]);
      const key = r[0] + '|' + m[1];
      if (tiers[key] && tiers[key].join() !== t.join()) fail(ST, ins + ': two different tier rows for ' + key);
      tiers[key] = t; n++;
    }
  }
  if (!n) fail(ST, ins + ': no family-tier rows in its Approved Rates file');
}

/* ---- plan names, from Exhibit 18 ("Plan Name*" over "HIOS Plan ID (14 Digits)*") ---- */
const names = {};
for (const ins of onEx) {
  const rows = xlsxRows(ex18[ins], 0);
  const lab = r => String((r && r[2]) || '').trim();
  const nr = rows.findIndex(r => /^Plan Name\*/.test(lab(r))), ir = rows.findIndex(r => /^HIOS Plan ID \(14 Digits\)\*/.test(lab(r)));
  if (nr < 0 || ir < 0) fail(ST, ins + ': Exhibit 18 lacks the plan name or plan ID row');
  rows[ir].forEach((id, k) => { if (k > 3 && id && rows[nr][k]) names[String(id).trim()] = String(rows[nr][k]).split(',')[0].trim(); });
}

/* ---- the 2027 plans ---- */
const plans = [], disagree = [];
for (const ins of onEx) {
  const I = ISSUERS[ins];
  for (const p of silver(E23[ins], ins, 2027)) {
    const rates = {}, areas = [];
    p.rates.forEach((v, k) => {
      if (!v) return;
      const ra = k + 1, t = tiers[p.base + '|' + ra];
      if (!t) fail(ST, ins + ': ' + p.base + ' has a 2027 rate in area ' + ra + ' but no approved tier row');
      MULT.forEach((m, i) => { if (Math.abs(t[i] - t[0] * m) > 0.02) fail(ST, ins + ': ' + p.base + ' area ' + ra + ' tier ' + i + ' is ' + t[i] + ', not ' + m + ' x ' + t[0]); });
      // the two DFS documents must agree; a disagreement is tolerated only if it
      // cannot move any county's lowest or second lowest silver (tested below)
      if (cents(t[0]) !== cents(v)) disagree.push({ id: p.base, ins, ra, ex23: v, tmpl: t[0] });
      rates[ra] = { tiers: t }; areas.push(ra);
    });
    const cs = where(p.base, I.hios, ra => areas.includes(ra), G27);
    if (!cs.length) { log('  dropped ' + p.base + ' (' + ins + '): no county where it is rated, its insurer is marked and it was sold in 2026'); continue; }
    if (!names[p.base]) fail(ST, ins + ': no Exhibit 18 plan name for ' + p.base);
    plans.push({ id: p.base, issuer: I.name, name: names[p.base], counties: cs, rates });
  }
}
log('  ' + plans.length + ' on-exchange silver plans from ' + new Set(plans.map(p => p.issuer)).size + ' insurers');
if (placed.length) log('  placed by the insurer grid alone (no 2026 service area): ' + placed.join('; '));
/* insurers the 2027 grid marks in a county where none of their plans landed */
const orphan = [];
for (const f of cty.all) for (const h of G27.sets[f]) if (!plans.some(p => p.id.slice(0, 5) === h && p.counties.includes(f))) orphan.push(h + ' ' + cty.nameOf(f));
if (orphan.length) log('  marked in the 2027 grid but no silver plan placed: ' + orphan.join('; '));

/* what the insurer grid alone would have done to the 2027 benchmark, for the note */
const second = (f, all) => {
  const ra = String(areaOf[f]);
  const v = plans.filter(p => (all ? p.rates[ra] && G27.sets[f].has(p.id.slice(0, 5)) : p.counties.includes(f) && p.rates[ra])).map(p => p.rates[ra].tiers[0]).sort((a, b) => a - b);
  return v[1];
};
const gridOnly27 = cty.all.filter(f => cents(second(f, true)) !== cents(second(f, false)));
log('  the insurer grid alone would change the 2027 benchmark in: ' + gridOnly27.map(f => cty.nameOf(f) + ' ' + second(f, true) + ' vs ' + second(f, false)).join('; '));
const BASSETT = '78124NY0920007';
const bassett = [...(sa26[BASSETT] || [])].map(cty.nameOf).sort();
if (bassett.join() !== 'Delaware County,Herkimer County,Oneida County,Otsego County') fail(ST, 'Bassett Preferred 2026 service area is now ' + bassett.join(', '));
const list = a => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];

/* a disagreement between Exhibit 23 and the template must not decide any benchmark */
for (const d of disagree) {
  log('  Exhibit 23 and template differ: ' + d.ins + ' ' + d.id + ' area ' + d.ra + ': ' + d.ex23 + ' vs ' + d.tmpl);
  for (const f of cty.all.filter(f => areaOf[f] === d.ra)) {
    const others = plans.filter(p => p.id !== d.id && p.counties.includes(f) && p.rates[d.ra]).map(p => p.rates[d.ra].tiers[0]).sort((a, b) => a - b);
    if (!plans.find(p => p.id === d.id).counties.includes(f)) continue;
    if (others.length < 2 || Math.min(d.ex23, d.tmpl) <= others[1]) fail(ST, d.ins + ' ' + d.id + ': its disputed rate could set the benchmark in ' + cty.nameOf(f));
  }
}

/* ---- print the benchmark the build will compute, for review ---- */
const slc = f => {
  const ra = String(areaOf[f]);
  const v = plans.filter(p => p.counties.includes(f) && p.rates[ra]).map(p => ({ p, v: p.rates[ra].tiers[0] })).sort((a, b) => a.v - b.v);
  return v;
};
for (const n of ['Albany', 'Bronx', 'Erie', 'Monroe', 'Tompkins', 'Suffolk', 'Herkimer', 'Clinton']) {
  const v = slc(cty.fipsOf(n));
  log('  ' + n.padEnd(9) + ' area ' + areaOf[cty.fipsOf(n)] + '  lowest ' + v[0].v.toFixed(2) + ' ' + v[0].p.issuer + '  second ' + (v[1] ? v[1].v.toFixed(2) + ' ' + v[1].p.issuer + ' ' + v[1].p.id + ' tiers ' + v[1].p.rates[areaOf[cty.fipsOf(n)]].tiers.join(' ') : 'none'));
}
const single = cty.all.filter(f => slc(f).length < 2);
if (single.length) fail(ST, 'fewer than two silver plans in ' + single.map(cty.nameOf).join(', '));

/* the hero figures the researcher computed, as read when this extractor was written */
const LOW27 = [722.57, 591.28, 849.76, 941.66, 773.55, 748.01, 732.28, 925.84];
for (let ra = 1; ra <= NREG; ra++) {
  const fid = plans.find(p => p.id === '25303NY0020001');
  if (!fid || cents(fid.rates[ra].tiers[0]) !== cents(LOW27[ra - 1])) fail(ST, 'Fidelis standard silver in area ' + ra + ' is no longer ' + LOW27[ra - 1]);
}

writeState({
  state: ST, planYear: 2027, kind: 'plans', final: true, precision: 'cents',
  sources: [
    { title: 'NY DFS, 2027 Final Exhibits (individual market, Exhibit 23 per insurer)', url: FINAL_IDX, published: finalDate },
    { title: 'NY DFS, Additional Information 2027 (Approved Rates, CMS Rates Table Template, per insurer)', url: ADDL_IDX, published: apprDate },
    { title: 'NY State of Health, 2027 Individual Qualified Health Plan Participation by Issuer & County', url: PART(2027), published: isoPdf(G27.at) },
    { title: 'CMS, New York State-based Exchange Public Use Files, plan year 2026 (plans and service areas)', url: PUF26 },
    { title: 'NY Department of Health, Announces Open Enrollment for 2027 Coverage (Oscar leaves the Marketplace)', url: PRESS, published: '2026-10-28' },
    { title: 'NY State of Health, 2026 Lowest Cost Silver Plan by County (validation of the method)', url: LCSP26, published: lcspDate },
    { title: 'NY State of Health, 2026 Individual Qualified Health Plan Participation by Issuer & County (validation)', url: PART(2026), published: isoPdf(G26.at) },
  ],
  notes: [
    'Rates are the 2027 individual rates approved by the New York Department of Financial Services, read from each insurer\'s Final Exhibit 23 and its Approved Rates template, which agree to the cent for every plan and region except as noted.',
    'New York rates by family tier, not age. The tiers are the insurers\' own approved figures, each confirmed to equal the individual rate times New York\'s fixed multipliers (couple 2.0, one adult with children 1.7, two adults with children 2.85) to within a cent of rounding.',
    'NY State of Health publishes 2027 availability per insurer, not per plan: its participation grid marks which insurers sell in each county. Some products are local, so each plan is placed only in counties where its insurer is marked for 2027, where the Department approved a rate for its region, and where CMS\'s 2026 file shows the same plan was sold in 2026. Every 2027 silver plan was sold in 2026. A plan whose service area changed for 2027 would be misplaced, which no 2027 source can yet confirm.',
    'Using the insurer grid alone would put Excellus\'s Bassett Preferred silver, sold in 2026 only in Delaware, Herkimer, Oneida and Otsego counties, in every county of its rating regions where Excellus is marked. That misses NY State of Health\'s published 2026 figure for Clinton County, and for 2027 it would change the benchmark in ' + list(gridOnly27.map(f => cty.nameOf(f).replace(/ County$/, ''))) + ' ' + (gridOnly27.length > 1 ? 'counties' : 'County') + '.',
    'Oscar filed on and off exchange and the Department lists an approved 2027 rate action for it, but its exhibit carries no 2027 rates, the Department of Health\'s 28 October 2026 release says Oscar is no longer participating in the Marketplace, and the 2027 participation grid omits it, so it is excluded.',
    'Aetna Life Insurance Company and UnitedHealthcare Insurance Company of New York sell off exchange only and are excluded, as are child only plans, plans that cover dependents to age 30, and cost sharing reduction variants.',
    'The Department\'s eight regions (Albany, Buffalo, Mid-Hudson, New York, Rochester, Syracuse, Utica, Long Island) are numbered as CMS numbers New York\'s rating areas.',
    ...(disagree.length ? ['For plans ' + list([...new Set(disagree.map(d => d.id))]) + ', Exhibit 23 and the Approved Rates template differ by up to ' + Math.max(...disagree.map(d => Math.abs(d.ex23 - d.tmpl))).toFixed(2) + ' dollars a month. The template\'s figures are used; under either figure none of them is the lowest or second lowest silver plan in any county, so no benchmark depends on the difference.'] : []),
    'Checked against 2026: the same method applied to the exhibits\' 2026 rates and the 2026 participation grid reproduces NY State of Health\'s published 2026 lowest cost silver premium in all 62 counties to the cent. NY State of Health had not published a 2027 benchmark table when this was built, so there are no 2027 checks.',
  ],
  statewide: false,
  plans,
  checks: [],
});
