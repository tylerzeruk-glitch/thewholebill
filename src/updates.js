/* What changed: the dated log behind the hero's "What changed" box, the
 * /updates page and /updates.xml. Hand-written, newest first. build.sh runs
 * tools/build-updates.mjs over this file and writes all three from it, so
 * updating the hero box means adding an entry here, never editing hero copy.
 *
 * Two kinds of entry, and the tag says which:
 *   world   a law, a ruling or a dataset the site rests on moved
 *   site    a number, a source or a piece of copy here changed, and why
 *
 * Every entry: id (a stable slug; it is the permalink and the RSS guid), date
 * (ISO), kind, title (one sentence, inline markup allowed), body (a short
 * paragraph). A world entry must carry its primary source over https. `see`
 * points at the methodology section that explains the number. `pin: true`
 * keeps an entry in the hero box regardless of age (at most three pins; the
 * box shows the pins plus the newest entries to fill three). The suite checks
 * all of this, and that no entry carries an em or en dash. */
var UPDATES = [
  {
    id: 'search-and-assistants', date: '2026-09-18', kind: 'site',
    title: 'The site now introduces itself to search engines and assistants: titles that say what it is, structured data, a plain-text methodology.',
    body: 'Nothing a reader sees changed. Each page&rsquo;s title now carries the words people search for (healthcare cost, Medicare for All, the premium tax credit), the objections section is marked up as questions and answers, the methodology is also served as markdown at /methodology.md, an llms.txt describes the site for assistants, and robots.txt names the search and AI crawlers it welcomes, which is all of them. A cite-this line joined the Sources.',
    see: { id: 'sources', text: 'Sources' }
  },
  {
    id: 'early-retirees', date: '2026-09-18', kind: 'site',
    title: 'Early retirees: the letter can speak as one, the cliff explains age rating, and the chart follows a household past 550% of the poverty line.',
    body: 'A reader who retired before Medicare found the generated letter speaking as a sole proprietor. There is now a fourth persona for the letter (retired before Medicare, buying on the exchange), with the retirement figures cited to EBRI. Under the cliff, a household with an adult of 55 to 64 sees how far up the state&rsquo;s age curve it sits, read from the same curve the benchmark uses, and is told that retirement income counts toward the line. And the cliff chart, which stopped at 550% of the poverty line and so dropped a couple at $131,000 off its right edge, now widens to keep the household on it. The letter&rsquo;s emphasis list is two lists now, who is writing (one choice) and what else to mention, so no story has to grey another out.',
    see: { id: 'benchmark', text: 'The benchmark premium' }
  },
  {
    id: 'tricare-medicare-va', date: '2026-09-04', kind: 'site',
    title: 'Households on TRICARE, Medicare or VA care are now told the calculator does not price them, with the numbers behind that.',
    body: 'A note under the coverage control, a fifth objection (the three programs are the existence proof that government-run coverage already works here, for tens of millions of people) and a methodology row with the Military Health System&rsquo;s headcount, budget and fee schedule, each sourced. A full TRICARE route is under consideration. The honest result would be that many military families pay more under every financing model, and that needs its own copy before it ships.',
    see: { id: 'other-coverage', text: 'Households the calculator does not price' }
  },
  {
    id: 'source-links', date: '2026-09-04', kind: 'site',
    title: 'Every source now links to its primary document, and key terms link to the methodology section that explains them.',
    body: 'Reader feedback after launch. Seventeen phrases on the calculator carry a dotted link into the methodology, chosen because a reader needs them to trust the number in front of them. Every row of the Sources table links to the document itself, not a summary of it; the links were retrieved on 4 September 2026.',
    see: { id: 'sources', text: 'Sources' }
  },
  {
    id: 'floor-and-repayment', date: '2026-09-02', kind: 'site',
    title: 'Correction: the credit&rsquo;s income floor and the repayment rule under Public Law 119-21.',
    body: 'Before this the methodology described the pre-2026 exception that let lawfully present immigrants below the poverty line claim the credit, and did not say that the cap on repaying excess advance credit is gone. Both are now stated where the credit is explained. No calculated figure changed; the copy did.',
    see: { id: 'credit-floor', text: 'The credit&rsquo;s floor' }
  },
  {
    id: 'public', date: '2026-09-02', kind: 'site',
    title: 'The site is public.',
    body: 'Until now it sat behind a login while reviewers checked it. Every number had been through six review passes and every finding is closed. The site keeps no analytics script and sets no cookies; traffic is read as edge request counts.',
    see: { id: 'kinds', text: 'Three kinds of number' }
  },
  {
    id: 'benchmarks-cms', date: '2026-08-31', kind: 'site',
    title: 'Benchmark premiums are now the real second-lowest-cost silver plan for every county, from CMS&rsquo;s plan-year 2026 files.',
    body: 'Until this the benchmark premium was modeled from a handful of metros and labelled as such. It is now built per county from the CMS public use files (3,288 county entries, per-state age curves, family tiers in New York and Vermont) and validated to the cent against the published landscape file and against New York&rsquo;s and California&rsquo;s own figures on every rebuild. Its basis tag moved from modeled to statutory.',
    see: { id: 'benchmark', text: 'The benchmark premium' }
  },
  {
    id: 'six-models', date: '2026-08-31', kind: 'site',
    title: 'Six financing models replace one.',
    body: 'The universal figure is shown under six published models spanning the spectrum: the bill&rsquo;s own financing list, the Lancet 2020 study, RAND, CBO, the Mercatus (Blahous) alternative and Urban&rsquo;s most expensive scenario. Where a study published no household figure, the allocation is shown and labelled modeled. The mixed vintages are disclosed.',
    see: { id: 'universal', text: 'Universal coverage, six models' }
  },
  {
    id: 'kff-2027-rates', date: '2026-08-03', kind: 'world', pin: true,
    title: 'Insurers propose a median <b>15%</b> premium increase for 2027, the second double-digit year in a row.',
    body: 'KFF&rsquo;s read of preliminary rate filings across all 50 states and DC: a median proposed increase of 15% for 2027, after 2026 finalized at 20%. Insurers cite rising prices for care, inflation and labor shortages, and two things specific to this market: the enhanced credits&rsquo; expiry and the sicker risk pool it left behind. Final 2027 rates arrive in the fall, when the benchmark table on this site is rebuilt from CMS&rsquo;s files.',
    source: { title: 'KFF, How much and why ACA Marketplace premiums are going up in 2027', url: 'https://www.kff.org/affordable-care-act/how-much-and-why-aca-marketplace-premiums-are-going-up-in-2027/' },
    see: { id: 'benchmark', text: 'The benchmark premium' }
  },
  {
    id: 'irs-2027-schedule', date: '2026-07-21', kind: 'world',
    title: 'The IRS set the 2027 credit schedule: the expected contribution rises in every band, and the top band goes from 9.96% to 10.22%.',
    body: 'Rev. Proc. 2026-26 gives the applicable percentage table for taxable years beginning in 2027: 2.15% of income below 133% of the poverty line, rising through the bands to 10.22% from 300% to 400%, against 2.10% to 9.96% in 2026. The required contribution percentage, which decides whether an employer offer counts as affordable, is also 10.22%. The calculator uses the 2026 table until open enrollment for 2027 begins on 1 November; the 2027 table is on this site&rsquo;s list.',
    source: { title: 'IRS Rev. Proc. 2026-26, applicable percentage table for 2027 (Internal Revenue Bulletin 2026-31)', url: 'https://www.irs.gov/pub/irs-drop/rp-26-26.pdf' },
    see: { id: 'credit', text: 'The premium tax credit' }
  },
  {
    id: 'kff-2026-marketplace', date: '2026-05-19', kind: 'world',
    title: 'KFF measured the first plan year without the enhanced credits: net premiums up <b>58%</b>, a record <b>$3,786</b> average deductible, and roughly <b>five million fewer enrollees</b>.',
    body: 'The average premium a marketplace enrollee pays after the credit rose 58%, from $113 to $178 a month. The average deductible reached $3,786. KFF projects average monthly enrollment falling from 22.3 million in 2025 to about 17.5 million in 2026; early CMS effectuated-enrollment data already count nearly three million gone.',
    source: { title: 'KFF, What we know so far about 2026 ACA Marketplace enrollment, premiums and deductibles', url: 'https://www.kff.org/affordable-care-act/what-we-know-so-far-about-2026-aca-marketplace-enrollment-premiums-and-deductibles/' },
    see: { id: 'credit', text: 'The premium tax credit' }
  },
  {
    id: 'poverty-guidelines-2026', date: '2026-01-15', kind: 'world',
    title: 'HHS published the 2026 poverty guidelines: $33,000 for a family of four in the 48 contiguous states, up from $32,150.',
    body: 'The guidelines took effect on 13 January 2026 and reflect a 2.63% price increase. The credit for a plan year uses the guidelines in force when its open enrollment began, so plan year 2026 still runs on the 2025 figures the calculator uses today; these are the figures the 2027 credit will use.',
    source: { title: 'Federal Register, Annual Update of the HHS Poverty Guidelines, 15 January 2026', url: 'https://www.federalregister.gov/documents/2026/01/15/2026-00755/annual-update-of-the-hhs-poverty-guidelines' },
    see: { id: 'poverty', text: 'Poverty guidelines' }
  },
  {
    id: 'enhanced-credits-expired', date: '2025-12-31', kind: 'world', pin: true,
    title: 'The enhanced premium tax credits expired. The 400% subsidy cliff is back for plan year 2026.',
    body: 'The 2021 enhancements (no income ceiling, a lower expected contribution at every income) ran through 2025 and were not renewed. From 1 January 2026 the schedule in IRS Rev. Proc. 2025-25 applies, and a household above 400% of the poverty line gets no credit at all. Every figure on this site uses the 2026 schedule.',
    source: { title: 'IRS Rev. Proc. 2025-25, the applicable percentage table for 2026', url: 'https://www.irs.gov/pub/irs-drop/rp-25-25.pdf' },
    see: { id: 'credit', text: 'The premium tax credit' }
  },
  {
    id: 'public-law-119-21', date: '2025-07-04', kind: 'world',
    title: 'Public Law 119-21 tightened the credit from 2026: no cap on repayment, and lawfully present immigrants below the poverty line lose it.',
    body: 'The July 2025 reconciliation law removed the exception that let lawfully present immigrants below 100% of the poverty line claim the credit, for plan years from 2026; from 2027 refugees, asylees and people with temporary protected status are excluded too. It also ended the cap on repaying excess advance credit from tax year 2026, so a household that earns more than it projected repays the whole difference at filing. The calculator reflects both.',
    source: { title: 'H.R. 1, 119th Congress, enacted as Public Law 119-21', url: 'https://www.congress.gov/bill/119th-congress/house-bill/1' },
    see: { id: 'credit-floor', text: 'The credit&rsquo;s floor' }
  }
];
if (typeof module !== 'undefined') module.exports = UPDATES;
