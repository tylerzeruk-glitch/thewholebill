// Watch the primary sources behind the What changed log and print candidates.
//
//   node tools/watch-sources.mjs             items from the last 35 days
//   node tools/watch-sources.mjs --days 90   a wider window
//
// Stateless and keyless on purpose: it runs the same on a laptop and in a
// fresh cloud checkout. It never writes an entry. It prints markdown: what
// each source published inside the window, plus three comparisons against the
// site's own data (the bills' cosponsor counts against src/reps.js, the poverty
// guideline year against calc.js, the newest IRS revenue procedures). A person
// decides what goes into src/updates.js; see docs/WHAT-CHANGED.md.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const args = process.argv.slice(2);
const days = Number((args[args.indexOf('--days') + 1] || 35)) || 35;
const since = new Date(Date.now() - days * 864e5);
const UA = 'thewholebill-watch/1 (+https://thewholebill.org)';
const get = async url => {
  const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/rss+xml, application/xml, text/xml, application/json, text/html;q=0.8' }, signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
};
const unesc = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;|&#0?38;/g, '&').replace(/&#8217;|&rsquo;/g, '\u2019').replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/<[^>]+>/g, '').trim();
const tag = (x, t) => { const m = x.match(new RegExp('<' + t + '[^>]*>([\\s\\S]*?)</' + t + '>')); return m ? unesc(m[1]) : ''; };
const rss = xml => [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => ({
  title: tag(m[1], 'title'), link: tag(m[1], 'link') || tag(m[1], 'guid'), date: new Date(tag(m[1], 'pubDate') || tag(m[1], 'dc:date')) }));
const inWindow = it => it.date instanceof Date && !isNaN(it.date) && it.date >= since;
const day = d => d.toISOString().slice(0, 10);
const out = [];
const section = (title, lines, note) => { out.push('', '## ' + title, ''); if (lines.length) out.push(...lines); else out.push('_nothing in the window_' + (note ? ' (' + note + ')' : '')); };
const errors = [];
const safe = async (name, fn) => { try { return await fn(); } catch (e) { errors.push(name + ': ' + e.message); return null; } };

// --- feeds: what moved in the world ------------------------------------------
const FEEDS = [
  ['KFF: Affordable Care Act', 'https://www.kff.org/topic/affordable-care-act/feed/', null],
  ['KFF: health costs', 'https://www.kff.org/topic/health-costs/feed/', /employer|premium|deductible|uninsured|marketplace|single[- ]payer|medicare for all|out-of-pocket/i],
  ['CBO', 'https://www.cbo.gov/publications/all/rss.xml', /premium tax credit|marketplace|single[- ]payer|health insurance|uninsured|medicare for all|tricare|subsid/i],
  ['CMS newsroom', 'https://www.cms.gov/newsroom/rss-feeds', /marketplace|enrollment|benefit and payment|exchange|premium/i],
];
for (const [name, url, filter] of FEEDS) {
  const items = await safe(name, async () => rss(await get(url)));
  if (!items) continue;
  const hits = items.filter(inWindow).filter(it => !filter || filter.test(it.title));
  section(name, hits.map(it => `- ${day(it.date)} [${it.title}](${it.link})`), items.length + ' items read, none matched');
}

// --- Federal Register: rules and notices by search term ------------------------
const FR = ['"premium tax credit"', '"Notice of Benefit and Payment Parameters"', '"poverty guidelines"'];
const frLines = [];
for (const term of FR) {
  const j = await safe('Federal Register ' + term, async () => JSON.parse(await get('https://www.federalregister.gov/api/v1/documents.json?conditions%5Bterm%5D=' + encodeURIComponent(term) + '&order=newest&per_page=20')));
  if (!j) continue;
  for (const d of j.results) {
    if (new Date(d.publication_date) < since) continue;
    if (/Information Collection|Regulatory Agenda|Paperwork/i.test(d.title)) continue;   // routine notices
    frLines.push(`- ${d.publication_date} ${d.type}: [${d.title.slice(0, 140)}](${d.html_url}) (search: ${term})`);
  }
}
section('Federal Register', [...new Set(frLines)].sort().reverse());

// --- the bills: has BILLSTATUS moved since the reps snapshot? -------------------
// src/reps.js marks sponsor and cosponsors alike (tools/build-reps.mjs), and a
// member who left Congress keeps their cosponsor line in the XML, so the counts
// are not directly comparable; the signal is the XML's updateDate against the
// snapshot's as-of date.
const REPS = new Function(readFileSync(new URL('../src/reps.js', import.meta.url), 'utf8') + '; return REPS;')();
const snap = { hr3069: Object.values(REPS.house).filter(m => m.co).length, s1506: Object.values(REPS.senate).flat().filter(m => m.co).length };
const billLines = [];
for (const [key, path, label] of [['hr3069', 'hr/BILLSTATUS-119hr3069', 'H.R. 3069'], ['s1506', 's/BILLSTATUS-119s1506', 'S. 1506']]) {
  const x = await safe(label, () => get('https://www.govinfo.gov/bulkdata/BILLSTATUS/119/' + path + '.xml'));
  if (!x) continue;
  const block = (x.match(/<cosponsors>([\s\S]*?)<\/cosponsors>/) || ['', ''])[1];
  const live = [...block.matchAll(/<item>([\s\S]*?)<\/item>/g)].filter(m => !/<sponsorshipWithdrawnDate>\s*\S/.test(m[1])).length;
  const la = x.match(/<latestAction>[\s\S]*?<actionDate>([^<]+)<\/actionDate>[\s\S]*?<text>([^<]+)<\/text>/);
  const upd = ((x.match(/<updateDate>([^<]+)/) || [])[1] || '').slice(0, 10);
  const moved = upd && upd > REPS.asOf;
  billLines.push(`- ${label}: ${live} current cosponsors plus the sponsor (${snap[key]} current members marked on the site, as of ${REPS.asOf}); status updated ${upd}${moved ? ' **after the snapshot: rerun node tools/build-reps.mjs and log it**' : ''}; latest action ${la ? la[1] + ', ' + la[2].slice(0, 110) : 'unknown'}`);
}
section('The bills (govinfo BILLSTATUS)', billLines);

// --- poverty guidelines: the year ASPE is showing against the year in calc.js --
const calc = readFileSync(new URL('../src/calc.js', import.meta.url), 'utf8');
const siteFpl = (calc.match(/HHS Poverty Guidelines[^\n]*?(20\d\d)|(20\d\d)[^\n]*?[Pp]overty [Gg]uidelines/) || []).slice(1).find(Boolean) || '?';
const aspe = await safe('ASPE', () => get('https://aspe.hhs.gov/topics/poverty-economic-mobility/poverty-guidelines'));
const aspeYear = aspe ? (aspe.match(/(20\d\d) Poverty Guidelines/) || [])[1] : null;
section('Poverty guidelines (ASPE)', aspeYear ? [`- ASPE shows the ${aspeYear} guidelines; calc.js cites ${siteFpl}. ${aspeYear !== siteFpl ? 'A newer year is out: an entry when published, a site change when the plan year that uses it opens.' : 'Same year.'}`] : []);

// --- IRS: revenue procedures dropped in the window (the 36B one lands in July) --
const drop = await safe('IRS drop listing', () => get('https://www.irs.gov/pub/irs-drop/'));
const rpLines = [];
if (drop) {
  for (const m of drop.matchAll(/href="(?:https:\/\/www\.irs\.gov\/pub\/irs-drop\/)?(rp-\d\d-\d+\.pdf)"[\s\S]{0,600}?(\d{4}-\d{2}-\d{2}) \d\d:\d\d/g)) {
    if (new Date(m[2]) >= since) rpLines.push(`- ${m[2]} [${m[1]}](https://www.irs.gov/pub/irs-drop/${m[1]})`);
  }
}
section('IRS revenue procedures (open each; the next year\'s applicable percentage table is a July one citing section 36B)', rpLines.sort().reverse());

// --- Census: the annual coverage report (mid September) --------------------------
const cen = await safe('Census', () => get('https://www.census.gov/topics/health/health-insurance/library/publications.html'));
const cenLines = cen ? [...new Set([...cen.matchAll(/Health Insurance Coverage in the United States: (20\d\d)/g)].map(m => m[1]))].filter(y => Number(y) >= new Date().getFullYear() - 1).map(y => `- Health Insurance Coverage in the United States: ${y} is listed`) : [];
section('Census coverage report', cenLines, 'the page may render its list with scripts; in September, check census.gov/library/publications by hand');

console.log(`# What changed: candidates from the last ${days} days (${day(since)} to ${day(new Date())})`);
console.log('\nEach line is a lead, not an entry. Read the primary document, then add a dated entry to src/updates.js under the rules in docs/WHAT-CHANGED.md.');
console.log(out.join('\n'));
if (errors.length) console.log('\n## Could not read\n\n' + errors.map(e => '- ' + e).join('\n'));
