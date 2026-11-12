/* Rhode Island, plan year 2027: HealthSource RI's plan guide.
 *
 * HealthSource RI, "2027 Individual Market Plans and Benefits" (PDF created
 * 28 Oct 2026, "Rates as of November 1, 2026"): every individual plan with its
 * monthly premium before tax credit at ages 21, 40 and 60, whole dollars. Rhode
 * Island is one rating area. OHIC approved the 2027 rates in September 2026.
 *
 * Age 21 is used, with the federal default age curve; the 40 and 60 figures
 * must agree with it: some premium that rounds to the printed age 21 figure
 * must also round to the printed 40 and 60 figures on the curve.
 *
 *   node tools/state-sources/ri.mjs
 */
import { fetchCached, pdfText, writeState, fail, log, FED_CURVE } from './lib.mjs';

const ST = 'RI';
const URL = 'https://healthsourceri.com/wp-content/uploads/OE2027-IF_English_Web.pdf';
const OHIC = 'https://ohic.ri.gov/sites/g/files/xkgbur736/files/2026-09/Final%202027%20Rate%20Review%20All%20Market%20Requested%20and%20Approved%20Summary.pdf';
const SRC = 'HealthSource RI, 2027 Individual Market Plans and Benefits (rates as of 1 Nov 2026)';

const text = pdfText(fetchCached(ST, URL, 'OE2027-IF_English_Web.pdf'));
if (!/Rates as of November 1, 2026/.test(text)) fail(ST, 'the guide no longer says "Rates as of November 1, 2026"');
{
  const o = pdfText(fetchCached(ST, OHIC, 'Final-2027-Rate-Review-Requested-and-Approved-Summary.pdf'));
  if (!/Requested and Approved Summary for 2027 Rates/.test(o) || !/completed its review of plan year 2027 rates/.test(o)) fail(ST, 'OHIC summary is not the completed 2027 review');
}

/* One plan table: column centres from the METAL LEVEL row, names gathered from
 * the lines between INSURANCE COMPANY and METAL LEVEL by nearest centre. */
const tok = l => [...l.matchAll(/\S+(?: \S+)*/g)].map(m => ({ s: m[0], c: m.index + m[0].length / 2 }));
const lines = text.split('\n');
const plans = [];
for (let i = 0; i < lines.length; i++) {
  if (!/^\s*METAL LEVEL\s{2,}/.test(lines[i])) continue;
  const metals = tok(lines[i].replace(/^\s*METAL LEVEL/, m => ' '.repeat(m.length)));
  let top = i; while (top > 0 && !/INSURANCE COMPANY/.test(lines[top])) top--;
  if (i - top > 12) fail(ST, 'no INSURANCE COMPANY row above line ' + i);
  const near = c => metals.reduce((b, m, k) => Math.abs(m.c - c) < Math.abs(metals[b].c - c) ? k : b, 0);
  const issuer = [], name = metals.map(() => []);
  for (let j = top; j < i; j++) {
    const L = lines[j].replace(/^\s*(INSURANCE COMPANY|PLAN NAME)/, m => ' '.repeat(m.length));
    for (const t of tok(L)) (/INSURANCE COMPANY/.test(lines[j]) ? (issuer[near(t.c)] = t.s) : name[near(t.c)].push(t.s));
  }
  // the three premium rows that follow
  const prem = {};
  for (let j = i + 1; j < i + 14 && j < lines.length; j++) {
    const age = (lines[j + 1] || '').match(/\((\d\d)-YEAR OLD, BEFORE TAX CREDIT\)/)?.[1] || (lines[j + 2] || '').match(/\((\d\d)-YEAR OLD, BEFORE TAX CREDIT\)/)?.[1];
    const vals = [...lines[j].matchAll(/\$([\d,]+)(?!\.)/g)].map(m => ({ v: +m[1].replace(/,/g, ''), c: m.index + m[0].length / 2 }));
    if (age && vals.length === metals.length && !prem[age]) prem[age] = vals.map(x => x.v);
  }
  for (const a of ['21', '40', '60']) if (!prem[a]) fail(ST, 'table at line ' + i + ': no age ' + a + ' premium row');
  metals.forEach((m, k) => {
    if (m.s !== 'SILVER') return;
    const nm = name[k].join(' ').replace(/\s+/g, ' ').trim();
    plans.push({ issuer: issuer[k], name: nm.replace(/^\*/, ''), excludesAbortion: nm.startsWith('*'), p21: prem['21'][k], p40: prem['40'][k], p60: prem['60'][k] });
  });
}

/* what the guide printed when this extractor was written */
const EXPECT = [
  ['BCBSRI', 'VantageBlue Direct Plan 6000/12000', 665, 849, 1804],
  ['BCBSRI', 'BlueSolutions for HSA Direct 4100/8200', 624, 798, 1695],
  ['BCBSRI', 'BlueCHiP Direct 5000/10000', 617, 788, 1674],
  ['BCBSRI', 'BlueCHiP Direct Advance 4950/9900', 533, 681, 1446],
  ['NHPRI', 'Neighborhood PRIMARY 5500/11000', 492, 629, 1335],
  ['NHPRI', 'Neighborhood PRIMARY 3950/7900 HSA', 459, 587, 1247],
];
if (plans.length !== EXPECT.length) fail(ST, 'expected 6 silver plans, parsed ' + plans.length + ': ' + plans.map(p => p.name).join('; '));
for (const [iss, nm, a, b, c] of EXPECT) {
  const p = plans.find(x => x.name === nm);
  if (!p || p.issuer !== iss || p.p21 !== a || p.p40 !== b || p.p60 !== c) fail(ST, nm + ': parsed ' + JSON.stringify(p));
}

/* consistency with the federal curve: an age 21 premium x in [p21 - 0.5, p21 + 0.5]
 * must round to the printed 40 and 60 figures */
for (const p of plans) {
  let lo = p.p21 - 0.5, hi = p.p21 + 0.5;
  for (const [age, v] of [[40, p.p40], [60, p.p60]]) { lo = Math.max(lo, (v - 0.5) / FED_CURVE[age]); hi = Math.min(hi, (v + 0.5) / FED_CURVE[age]); }
  if (!(lo <= hi)) fail(ST, p.name + ': ' + p.p21 + ' / ' + p.p40 + ' / ' + p.p60 + ' do not fit the federal age curve');
}

const benchmark = [...plans].sort((a, b) => a.p21 - b.p21)[1];
if (benchmark.name !== 'Neighborhood PRIMARY 5500/11000') fail(ST, 'the second lowest silver is now ' + benchmark.name);

const out = plans.map(p => ({
  id: 'RI:' + p.issuer + ':' + p.name, issuer: p.issuer, name: p.name, counties: 'all',
  rates: { 1: { at: 21, premium: p.p21 } },
}));
log('  6 silver plans; second lowest ' + benchmark.name + ' ' + benchmark.p21 + ' at 21, ' + benchmark.p40 + ' at 40');
writeState({
  state: ST, planYear: 2027, kind: 'plans', final: true, precision: 'dollars', statewide: true,
  sources: [
    { title: SRC, url: URL, published: '2026-10-28' },
    { title: 'Rhode Island Office of the Health Insurance Commissioner, Requested and Approved Summary for 2027 Rates', url: OHIC, published: '2026-09-29' },
  ],
  notes: [
    'Rhode Island\'s 2027 plans come from HealthSource RI\'s plan guide, which prints each individual plan\'s monthly premium before tax credit at ages 21, 40 and 60 in whole dollars, with rates as of 1 November 2026. The Office of the Health Insurance Commissioner completed its review of the 2027 rates in September 2026.',
    'The age 21 figure is used with the federal default age curve, which Rhode Island followed in the CMS 2026 rate files. For every silver plan the printed age 40 and 60 figures are consistent with that curve.',
    'The guide marks plans that exclude most abortion coverage with an asterisk and footnotes plans that have such a variation; the variations are not printed separately and are not counted here. The benchmark plan, Neighborhood PRIMARY 5500/11000, is footnoted as having one. In 2026 the matching Neighborhood plan\'s variation was a separate plan priced 74 cents a month below the version the 2026 guide printed (CMS 2026 rate files, age 21), so Rhode Island\'s 2027 benchmark may be up to about a dollar a month below the figure used here at age 21.',
  ],
  plans: out, curve: 'fed', checks: [],
});
