# The Whole Bill — Design Brief

**Name:** The Whole Bill · **Domain:** thewholebill.org (secured 2026-08-25)

_Working document. Started 2026-08-25. Decisions locked in this session marked ✅._

## Purpose

A personal healthcare cost calculator that reveals what a household actually pays today
(including the invisible employer premium share), shows what's available to them via the
exchanges, models what they'd pay under universal healthcare, and offers a letter template
to their representative.

## Strategic core

The hinge of the entire site is one number most people have never seen: **their true annual
healthcare cost including the employer-paid premium share.**

- Family coverage totals roughly $25–26k/yr in premium
- The worker sees only ~$6–7k of it on their paycheck
- The other ~$19k is employer-paid — but it is compensation, routed around the paycheck
- Add deductible/OOP spending + the 1.45% Medicare payroll tax → often $30k+ for a family

Everything before that reveal sets it up. Everything after asks "so what would you pay instead?"

A related point worth building in rather than hiding: most M4A financing converts the employer
premium contribution into a payroll tax, and economists broadly agree that incidence lands on
wages. So there is a legitimate "your wages could rise by $X" line — and it is both the
strongest argument on the site and the intellectually honest one.

⚠️ See `claude/numbers-and-copy-traps.md` before writing any production copy or math. Several
obvious-looking framings of this argument are wrong in ways a skeptic can exploit.

## Locked decisions

### ✅ Visual direction: Editorial + instrument hybrid

Light editorial ground for narrative sections; a distinctly darker "instrument" zone where the
calculator lives. The shift in ground signals "now we're computing your numbers."

- **Two grounds, one type system.** Paper = warm off-white (not pure white). Ink = near-black
  with a slight blue cast (not #000). Same fonts, same scale, inverted.
- **Type (as built, since 2026-10-09, the Public Notice redesign):** two families.
  **Archivo** for everything that is not reading: condensed uppercase headlines (width 62%,
  weight 850), heavy figures (72%, 800), tracked labels (85%, 700) and plain controls (100%).
  It is one variable file with a width axis, so those are one family at four widths, not four
  typefaces. **Newsreader** for reading (body copy, the lede, the letter, the objection quotes),
  loaded roman only at 400 to 500: headlines no longer use it, so the display sizes and the
  italic file went, about 230 KB. **No italics anywhere**: an italic would be synthesized, so
  emphasis in prose takes weight (500) and the suite fails on any rendered italic. Fonts went
  from about 300 KB to about 140 KB.
  History: 2026-09-02 settled Newsreader (display and prose) plus Public Sans after the launch
  feedback "too many fonts", whose real cause was treatments, not families (42 font sizes,
  13 tracked-caps label rules, IBM Plex Mono in five treatments). The one-label-style and
  one-numeral-treatment discipline from then still holds.
  **Tabular numerals are non-negotiable** — numbers that shift horizontally while updating read as a toy; numbers that
  tick in place read as an instrument.
- **Palette (as built):**
  - Paper `#FAF7F2`, paper text `#1A1815`, rule `#E3DDD2`
  - Ink `#12141A`, ink surface `#171A22`, ink text `#E8E6E1`, ink rule `#1F2330`
  - Amber `#D99A3F` = what you pay now (deep `#9E6B1C` for text on paper)
  - Teal `#3FB5AE` = universal
  - Gray `#5E6472` / `#8A8F9C` = marketplace
  - Deliberately no red/blue anywhere — the palette must carry meaning, not allegiance.
- A faint paper grain on the paper ground (an inline SVG fractal-noise tile at about 7%
  opacity, 240px) ties the light sections together. It replaced a 1px ledger rule at 34px
  pitch on 2026-09-02 after readers said the rules read as lined paper and distracted from
  the text; the grain keeps the printed-stock feel with nothing for the eye to track.
- **Sticky results bar:** once enough input exists to compute, a slim persistent bar keeps the
  user's three numbers on screen for the rest of the scroll. Every later argument then happens
  with their own number visible. Cheap to build; converts reading-an-argument into being-inside-one.

### ✅ Tone: Honest broker with a point of view

Rigorously sourced, shows real counterarguments, but does not pretend neutrality about the
conclusion. Names Medicare for All directly, cites its critics, answers them on the merits.

The "critics say" section is a **real section in the paper ground after the instrument**, not a
defensive appendix. Four things answered on the merits:

1. Your taxes go up — yes; here is your net
2. Wait times — and the US already rations by price
3. You'd lose your doctor — note that today's narrow networks already do this
4. How is it paid for — compare against the status quo, not against zero

### ✅ Universal cost model: Toggle between published models

User switches between named studies; every number traces to a citable source:

- Sanders financing options (two variants)
- Urban Institute (2019)
- Mercatus / Blahous (2018)

Each model is labeled in the UI with **who produced it and what they were trying to prove.**
That framing is what turns the toggle from a settings widget into the most persuasive element
on the page. Mercatus is the standout — but state it accurately (see traps doc, item 6).

Show a band, not a point. Showing the range makes the argument *more* persuasive: in nearly
every model the typical family still comes out ahead, and it pre-empts the obvious attack.

## Page structure

Not a multi-page site — one scrolling flow with progressive disclosure. Numbers update live so
the user is always looking at their own situation, never a demo.

| # | Ground | Section | Notes |
|---|--------|---------|-------|
| 1 | Paper | **Hook** | One question, one input (ZIP). Nothing else on screen. |
| 2 | Paper | **The part you don't see** | Two bars: visible vs. true. The invisible gap annotated. |
| 3 | Ink | **The instrument** | Household, ages, income, coverage type. Live output. |
| 4 | Ink | **The reveal** | Waterfall: deduction → employer share → OOP → payroll tax → total. |
| 5 | Ink | **The three-way** | Employer / marketplace / universal + financing model toggle. |
| 6 | Paper | **The objections** | The honest-broker section, four cards. |
| 7 | Paper | **Write your rep** | Rep lookup + letter built from the user's own numbers. |

The COBRA "if you lost your job tomorrow" callout on screen 5 is likely the most persuasive
single element on the site — it is where employer coverage looks worst.

## Data sources

- **Healthcare.gov Marketplace API** — real plans and premiums, but only the ~30 federal-exchange
  states. Needs a key; should not be called from the browser.
- **State-based exchange states** (CA, NY, MA, WA, CO, NJ, CT, others) are NOT in that API.
  Fallback: CMS public use files, or model from the benchmark second-lowest-cost silver plan.
- **KFF Employer Health Benefits Survey** — annual employer premium averages by region, single/family.
- **KFF subsidy calculator methodology** — ACA subsidy math is formula-based and computable.
- **Federal poverty level tables**; Medicaid expansion status by state; **state CHIP thresholds**.
- **Congress.gov / Google Civic** — rep lookup from ZIP.

Note: "select your state" has **four different behaviors** behind it — federal exchange,
state-based exchange, Medicaid expansion status, and CHIP threshold.

## ✅ Stack decision

Live plan lookup is the goal, but **v1 uses modeled data** so the design language can be settled
without the data plumbing in the way.

**Build the data layer swappable from day one.** Shape the modeled data exactly like the
Healthcare.gov API returns it — same field names, same nesting, same plan/issuer/metal-level
structure — behind a single `getPlans(zip, household)` function. Then v2 swaps one module
instead of rewriting every component that touches a premium. Costs nothing now; saves a rewrite.

Live lookup is a known follow-on and will need help building.

## Paystub upload — deferred

**Out of scope for now; to be scoped back in later.** When it returns:

- Parse **entirely client-side** and say so loudly. "Your paystub never leaves your device" is a
  headline feature for a site asking about money and health.
- Formats vary wildly (ADP, Paychex, Workday, Gusto) — OCR will be imperfect.
- Fast manual entry is the default (~4 fields); upload is a pre-fill convenience.
- Browser OCR is heavy (~10MB+ WASM for Tesseract) with mediocre accuracy on photographed stubs.
- Everything OCR-derived must be editable.

## Still open

- **Scope of "options" in v2.** Real named plans in the ~30 federal-exchange states + modeled
  estimates elsewhere (honest, uneven, more visceral) — or modeled estimates everywhere
  (consistent, less visceral)?
- **Mobile.** The design language is desktop-first so far; the sticky results bar and the
  waterfall both need a phone treatment.
- **Which bill to name** in the letter generator, and how to keep the rep's stated position current.

## Accessibility rule (learned the hard way)

**The palette may not use lightness to encode sequence on the ink ground.** The first waterfall
build stepped each amount down a tint ladder (`#D99A3F → #B08341 → #8A7148`), so contrast fell
from 7.6:1 to 4.0:1 as the eye moved along the row — the last two steps failed AA. Chart
geometry already carries magnitude; color must not have to. All additive steps now share one
amber, and the single neutral bar is neutral because that difference *means* something (the
part you actually see).

Same failure ran through the whole muted ramp. Verified floors now in use:

| Role | Ink ground `#12141A` | Paper `#FAF7F2` / card `#FFFDFA` |
|---|---|---|
| Primary text | `#E8E6E1` 14.8:1 | `#1A1815` 16.6:1 |
| Body / secondary | `#8A8F9C` 5.7:1 | `#443E36` 9.9:1 |
| Labels (uppercase mono) | `#8B92A4` 5.9:1 | `#786E5B` 5.0:1 |
| Footnotes / sublabels | `#7C8395` 4.9:1 | `#6B6459` 5.5:1 |
| Graphics & control borders | `#5E6472` 3.1:1 | `#8F8674` 3.4:1 / `#988B76` 3.3:1 |
| Teal | `#3FB5AE` 8.4:1 | `#1A7A75` for text on paper |

### Cost-component ramp (warm, analogous)

Every component that adds to the total keeps its own shade **everywhere it appears**, so a
stacked or accumulated view reads as strata rather than one undifferentiated mass. Light → deep
in narrative order:

| Component | Band | Contrast on ink |
|---|---|---|
| Your premium deduction | `#F0C98D` | 11.8:1 |
| Employer's share (the hidden one) | `#D99A3F` | 7.6:1 |
| Deductible, copays & OOP | `#A87A43` | 4.9:1 |
| Medicare payroll tax | `#86603E` | 3.3:1 |
| Total | `linear-gradient(#E8AC53 → #C9832F)` | — |

`#86603E` clears the 3:1 band floor but not the 4.5:1 text floor, so its **label** uses a
lightened tint of the same hue, `#C39258` (6.6:1). That split — band colour vs. label tint — is
the general escape hatch when a ramp needs to go darker than text can follow.

**No cool gray in this chart.** An earlier version used `#5E6472` for the accumulated total and
it fought the argument: if every component is adding up to the amber figure, a gray band reads
as a different category of thing. Warm analogous shades make the total feel assembled from its
parts.

Targets: **4.5:1 for text, 3:1 for graphics and control boundaries.** Form-field borders are the
easy miss — the first build had them at 1.4:1, effectively borderless. Add a contrast check to
the build's CI rather than eyeballing it; the failures here were all invisible to me by eye and
obvious in the numbers.


## Chart-form rules

- **A waterfall must show the running total.** The first build floated each segment with nothing
  under it, so it read as five unrelated bars rather than one accumulating figure. Every floating
  segment now sits on the stack of what came before. The payoff: the final step column reaches
  exactly the same height as the total bar beside it, which is the thing the chart exists to say.
- **Show the strata, not a single block.** Once the accumulated area is segmented by component,
  the reader can trace each layer left to right and see where the money actually is.
- **Colour keys belong in the captions**, not in a separate legend row — a swatch beside each
  column's caption removes a whole element and can't drift out of sync with the chart.
- Chart geometry carries magnitude. Colour carries category. Never make colour do both.
- **Pin every bar with `flex-shrink:0`.** A bar's pixel height *is* the data, and flex children
  shrink by default. In the first build each column's label pushed its content past the chart
  container, so flex quietly squeezed the bars to fit — and squeezed them by *different* amounts,
  because the total column's 44px label overflowed more than the other columns' 21px labels. The
  visible symptom was the total bar sitting slightly shorter than the column beside it; the real
  problem was that no column was drawn to scale. Let the columns size to their content and align
  bar bottoms with `align-items: flex-end` instead of capping them at a fixed height.
- **Measure the render, don't eyeball it.** Reading the bar rectangles back out of the DOM caught
  this in one pass, and would have caught it before it shipped. Worth a test in the real build:
  assert that each column's rendered stack height matches `value / total × chartHeight`.


## Identity

**The Whole Bill** — chosen over descriptive options (`whathealthcarecosts.org` and similar)
because literal names in this space compete with a large volume of insurance lead-gen and
affiliate content, and worse, *look* like it at a glance. For a site whose premise is "trust
these numbers," a distinctive name is more credible than the literal one. `.org` reinforces it.

The name was already in the design before it was the name: "Here is the whole bill" is the
reveal headline. It now reads as a callback rather than a label, and the headline italicises the
phrase to make the echo deliberate.

**Wordmark:** "The Whole Bill" in Newsreader 400, 21px, `-0.012em`. No italics, no colour — the
mark carries the colour.

**The mark encodes the chart.** Four stacked warm bands in roughly the real proportions of the
waterfall — payroll tax, deductible/OOP, employer share, premium deduction, top to bottom. It is
the same four-colour ramp used everywhere else, so the logo is literally the data. 13×24px,
`viewBox="0 0 13 24"`, bands at 2.5 / 3.5 / 12 / 6. Works on both grounds unchanged.

**Favicon:** the same four bands on the ink ground with a 4px radius, inlined as an SVG data URI.

**Where the name appears:** masthead lockup, hero footline (domain in mono), the reveal headline
(italicised callback), the letter's sign-off, and the footer lockup. The letter placement matters
most — a staffer who wants to check the math needs somewhere to go, and it is the site's only
organic distribution channel.

## Units: year / month

A single Year/Month control lives in the sticky results bar and governs **every figure on the
page** — instrument, waterfall, comparison, the objections, and the letter. Monthly is how most
people actually experience money, so it is not a secondary view; it is a peer.

Implementation rule, worth keeping in the real build: **every figure is stored as an annual
number and rendered through one formatter.** Nothing on the page holds a pre-divided monthly
value. One source of truth means the two views can never drift apart, and it is the only way the
rounding stays honest — the monthly waterfall bands ($575 + $1,625 + $317 + $115) still sum
exactly to the monthly total ($2,632), which they would not if each were authored separately.

Two figures deliberately do **not** divide:

- The decade total. A ten-year sum is a ten-year sum in either view.
- COBRA, which is authored annually ($26,928) and displays monthly by default, so it flips the
  same way as everything else instead of being a special case.

Unit words follow the toggle too (`per year` / `a year` / `every year` / `/ year`), so no
sentence is left describing the wrong unit.

## "Costs", not "spends"

The household does not *spend* the employer's premium share — that is the entire argument. Copy
throughout says what the household's healthcare **costs**, reserving "spends" for money that
genuinely leaves its hands. The waterfall's summary caption is "What your household actually
costs," and the letter reads "my family of four's healthcare costs $31,578 a year."

This is a small wording change that protects the site's central claim from an easy objection:
a reader who notices that $19,500 never passed through their bank account would be right to
distrust a chart that said they spent it.

---

# Stage 1 — the calculation layer (built 2026-08-25)

`calc.js` is a dependency-free module: sourced static tables plus pure functions. No network,
no API key, no backend. It is the seam Stage 2 plugs into.

## The honesty contract

Every returned figure carries a `basis`:

| basis | meaning |
|---|---|
| `statutory` | fixed in law or an IRS/HHS table — exact |
| `survey` | a published survey average (KFF) — real, but an average |
| `modeled` | our estimate — **must be labelled wherever it is shown** |

The instrument's footer states plainly which parts are which. This is the difference between a
calculator people trust and one they screenshot to mock.

## Verified tables (all checked 2026-08-25)

**FPL — HHS 2025 guidelines** (the ones in force at the start of 2026 open enrollment, so they
govern 2026 coverage): contiguous base $15,650 / +$5,500; Alaska $19,550 / +$6,880; Hawaii
$17,990 / +$6,330.

**Applicable percentage — IRS Rev. Proc. 2025-25, 2026 table.** Rises linearly within each band:

| % FPL | from | to |
|---|---|---|
| <133% | 2.10% | 2.10% |
| 133–150% | 3.14% | 4.19% |
| 150–200% | 4.19% | 6.60% |
| 200–250% | 6.60% | 8.44% |
| 250–300% | 8.44% | 9.96% |
| 300–400% | 9.96% | 9.96% |
| **≥400%** | **no credit at all** | |

⚠️ **The enhanced (ARPA/IRA) credits expired 31 December 2025 and the 400% cliff is back.** Any
figure or copy written before that assumed the old schedule and is wrong. KFF reports 2026
enrollee premium payments up 58% ($113 → $178/mo), average deductibles up 37% to $3,786, and
enrollment down from 22.3M to roughly 16.5–17.5M.

**Employer — KFF EHBS 2025:** family premium $26,993 (worker $6,850 / employer $20,143); single
$9,325 (worker $1,440 / employer $7,885).

**Statutory:** Medicare 1.45% employee (+0.9% above $200k single / $250k joint); COBRA 102%.

## The cliff is a feature

At 400% FPL the credit does not taper — it vanishes. For a family of four the boundary is
$128,600, where the household jumps from paying ~$17,900 to ~$27,400 on one extra dollar of
income. The instrument detects this and swaps the eligibility panel for a warning. This is the
most viscerally persuasive thing the calculator does, and it is entirely statutory — no
modelling, no assumptions, nothing to argue with.

## What is still modeled

- **Benchmark (second-lowest-cost silver) premiums** — five demo rating areas only. Stage 2
  replaces this object wholesale from CMS Rate + Service Area PUFs (federal) and the State-based
  Exchange PUFs (21 SBE states). ~500 rating areas; ships as JSON, no API.
- **Out-of-pocket spend** — anchored to published average deductibles, not actual spend. MEPS
  would fix this.
- **Universal models** — only Sanders Option 1 has a published household formula. Option 4 is our
  approximation; Urban and Mercatus are our allocation of a national estimate. Each carries its
  own `basis` string and the UI prints it. See traps #7 and #8.

## Wired into the preview

State/rating area, household size and income are live controls; every figure on the page —
narrative bars, waterfall band heights, comparison bars, the objections, the letter — derives
from one `summary()` call. Nothing is authored twice. Waterfall band heights are computed from
the values rather than hand-set, so they cannot go off-scale again.

## The comparison basis — fixed after the cliff turned out to be invisible

The first live build displayed the marketplace figure as **total cost of care** (benchmark
premium + out-of-pocket). That number does not move at the 400% cliff, because the care costs
the same either way — only *who pays* changes. So the single most dramatic statutory fact on the
site was computed correctly and shown nowhere.

Fixing the display exposed a deeper problem: **the three bars were not on the same basis.**

- The employer bar counts the employer's premium share as the household's, on wage incidence —
  which is the site's central claim.
- The marketplace bar was counting the government subsidy the same way. But a subsidy is *not*
  the household's money. Same bar, two different kinds of dollars.

**The rule now: every bar shows what this household bears.** The employer share counts (it is
compensation routed around the paycheck). The subsidy does not (taxpayers pay it) — it renders as
a hatched segment continuing past the solid bar, so the reader sees both the household's burden
and the true cost of the care, without the two being added together.

At the cliff the hatching vanishes and the solid bar expands to fill it: same total, completely
different composition. That is the cliff, drawn.

Family of four in Hartford, one dollar apart:

| income | % FPL | household bears | subsidy |
|---|---|---|---|
| $128,000 | 398% | $17,949 | $9,451 |
| $129,000 | 401% | **$27,400** | **$0** |

**General lesson worth keeping:** a figure that is computed correctly but never rendered is not a
feature. Before claiming any behaviour, check it against the screen and not the test output —
this is the second time in this project that the arithmetic was right and the pixels were wrong.

## Coverage routes — employer / marketplace / uninsured

The segmented control is live and drives the whole instrument. Each route gets its **own**
breakdown rather than being forced into the employer shape, because each one hides its cost in a
different way — and the contrast between them is the argument.

| | employer | marketplace | uninsured |
|---|---|---|---|
| components | 4 | 4 | 2 |
| whole bill | $32,171 | $28,778 | $6,878 |
| household bears | $32,171 | $15,909 | $6,878 |
| shows on a paystub | $8,228 | $1,378 | $1,378 |

_(family of four, Hartford, $95,000)_

**The parallel is the point.** Under employer coverage the biggest band is the employer's share —
concealed, but *yours*. Under the marketplace the biggest band is the premium tax credit —
equally invisible, but *not yours*. Same rhetorical shape, opposite ownership. The kicker above
the band says "The part you don't see" in one case and "Not your money" in the other, and the
credit renders hatched to mark the difference.

Two implementation rules this produced:

- **`hidden`, not "off-paystub", earns the kicker.** Cash you hand a clinic is not on a paystub
  but it is not concealed either. Only the employer share and the tax credit carry `hidden:true`.
  The first version labelled an uninsured household's own cash spending "the part you don't see",
  which is nonsense.
- **All routes share one vertical scale** (`routeMax` = the largest whole across the three).
  Scaling each route to its own maximum made every route draw the same height, so switching the
  control changed the labels and nothing else — which defeats the entire purpose of a
  visualisation. Uninsured now draws at ~21% of employer's height, which is the honest picture.

**Uninsured is the most important route and the easiest to get wrong.** The total is small, and a
naïve reading says going without insurance is cheap. Two guards: the note states plainly that
uninsured households spend less because they *skip care*, not because care is cheaper; and the
eligibility panel is replaced by a risk panel — every insured plan has a legal out-of-pocket
maximum, and without coverage there is no ceiling at all. The total column is captioned "What you
spend **and what you risk**".

Modeled: uninsured cash spend ($1,900/adult, $850/child). Needs MEPS.

---

# Session: honest scope, methodology, and the model cut

## Financing models cut from four to two

**Kept:** Sanders Option 1 (the only published household-level formula) and Blahous/Mercatus.
**Dropped:** Sanders Option 4 (we invented the bracket schedule and hung a real senator's name on
it — indefensible) and Urban Institute (a middle number doing no rhetorical work).

**The Blahous model got rebuilt on real numbers.** The earlier version used an effective rate of
15.37% reverse-engineered to land near a figure I liked. That is exactly the thing the site
accuses its opponents of. The derivation now runs:

- Blahous modelled **two** scenarios. His **main** one has national health spending **falling
  $2.054T** over a decade against current law. His **alternative** — where provider payments do
  not drop to Medicare rates — has it **rising $3.252T**.
- We use the **alternative**, so the site never rests on the friendly reading of an unfriendly
  study. This is a stronger rhetorical position than cherry-picking his savings number, and it
  cannot be attacked as selective.
- `$3.252T ÷ 10 years ÷ 134,790,000 households = $2,413 per household per year`, added to the
  Sanders result. Every term is published; the whole sum is printed on the methodology page.
- Flat-per-household is a stated simplification — real financing would be progressive.

Range is now **$9,757 – $12,170** for the sample household. Narrower than before, and every
figure in it is either published or shown as arithmetic.

## Honest area scope

The hero ZIP field is a real input matched against a three-digit prefix table for five metros.
An uncovered ZIP says so plainly and offers the five areas rather than silently returning
someone else's numbers — which was the single worst failure mode on the site.

The prefix table is an approximation and the methodology page says so: **rating areas are defined
by county, not ZIP.** The CMS Service Area PUF replaces it in Stage 2.

## "Why now" in the hero

A dateline in the hero's right column carries the 2025 expiry, the 58% premium rise, the record
$3,786 deductible and the ~5M coverage losses. The site previously had no urgency at all; this is
the cheapest persuasion available and it is this year's news.

## The methodology page

New section at `#methodology`, linked from six places that previously pointed nowhere. Contains:
the three-tier basis system (statutory / survey / modeled), the full FPL and applicable-percentage
tables, KFF employer figures, both universal derivations shown as arithmetic, a **"What we know is
wrong"** table, and a source list.

That limitations table is the most important thing on the page. It discloses the ZIP
approximation, modeled OOP, the Sanders pairing, the uninsured framing, wage-incidence caveats,
and the Medicare tax asymmetry (traps #4 and #8) — including the ones that cut *against* the
site's argument. A methodology page that only lists strengths is marketing.

## Still open

1. **The cliff deserves its own section** — pure statute, most unarguable thing on the site, and
   currently only visible if a user happens to slide past 400% FPL.
2. **Stage 2: the PUF pipeline** — every state, real premiums.
3. **Rep lookup** — address-level, not ZIP. Google's Civic Representatives API was retired in
   April 2025; use `unitedstates/congress-legislators` plus real geocoding.
4. **A real mobile design pass** — responsive is not the same as designed.

---

# Session: the cliff, the mortality case, and view routing

## 04 · The cliff — now a section, drawn as a curve

Previously the cliff only surfaced if a user happened to slide past 400% FPL, so most visitors
never saw the most unarguable thing on the site. It is now a section of its own, in the ink zone
after the comparison.

The chart plots what a household bears on a benchmark plan across 150%–550% of the poverty line.
It rises smoothly, then **genuinely discontinues** at 400% and runs flat forever after — because
the credit does not taper, it stops. A teal marker shows where the current household sits, so the
reader's own position is on the same axis as the cliff.

Family of four, Hartford: **$18,008 → $27,400** on one dollar of income. A $9,392 drop.

Two properties worth preserving:

- **The chart is generated from the same functions that drive the calculator** (`cliffCurve`,
  `cliffDrop` in calc.js), so it can never disagree with the numbers printed beside it. Change
  household size and the cliff moves — a household of two drops $7,974 instead.
- **Nothing on it is modeled.** Poverty guidelines and the IRS table, both statutory. This is the
  one place on the site with no assumptions to attack, and the copy says so.

## 05 · The other number — the Yale mortality case

New paper-ground section between the cliff and the objections. The site argued entirely in
dollars; this adds the dimension dollars cannot carry.

- **114,174** deaths a year projected preventable — 62,863 from extending coverage, **51,311 from
  reversing the coverage policies enacted since 2025**. That second figure is the same policy
  change the hero dateline describes, which ties the section back to the "why now".
- **29,631** of the coverage-related deaths would be among people who *already have insurance* —
  the underinsured. That is the site's own thesis counted in a different unit, and it is the
  reason this section earns its place rather than being a statistic bolted on.

**The disclosure is the section, not a footnote.** It states that the study is a preprint, that
its senior author advised Sen. Sanders' office on the legislation and testified in support, and —
the sharpest point — that its savings rest on the *same* Medicare-rates assumption Blahous called
"relatively generous" and rejected. Yale and Mercatus are **not independent confirmations of each
other; they are the same bet framed in opposite directions.**

Deliberately kept **out** of the calculator. It is a national estimate with no household formula,
it has not cleared peer review, and adding a third advocacy-adjacent allocation would undo the
model cut. Use it for the moral argument, not the arithmetic.

## View routing

Methodology is now its own view at `#/methodology` — hidden from the main flow, its own title, its
own back link, working browser history. The main scroll got materially shorter.

**At deploy this becomes a real page and the only change is `#/methodology` → `/methodology`.**
The section is already self-contained; the router is ~12 lines. Splitting into real documents was
deliberately deferred rather than done now, because the single-file build is what makes the
preview trivial to send and publish.

## Section order

01 the part you don't see · 02 the reveal · 03 the comparison · **04 the cliff** ·
**05 the other number** · 06 the other side · 07 write your rep · 08 methodology (routed)

### Chart label collision — and the check that should have caught it

The "you" marker label was pinned to the top of the plot, which is exactly where the cliff
annotation sits. Any household past 400% FPL put the two on top of each other. Fixed by anchoring
the label to the **foot** of its guide line instead: the bottom of the plot is always free, and it
sits next to the income axis the marker actually refers to, which reads better anyway.

**The reusable part is the test, not the fix.** A sweep now walks the income slider from $20k to
$250k at three household sizes and checks every pair of SVG `<text>` bounding boxes for
intersection. Rendered-geometry assertions like this have now caught three separate defects in
this project — bars silently shrunk by flex, a chart that never changed height between routes,
and this. Anything positioned by computed coordinates should get one.

### The sticky bar was never sticking — and why

`html, body { overflow-x: hidden }` was added as a guard against sub-pixel horizontal overflow.
It has a side effect that is easy to miss: **a non-visible `overflow-x` computes `overflow-y` to
`auto`, which makes html/body scroll containers, which silently disables `position: sticky` for
every descendant.** The bar was scrolling away with the page the entire time.

Fix: **`overflow-x: clip`**. Same clipping, but it does not create a scroll container, so sticky
survives. Use `clip` rather than `hidden` anywhere a sticky element lives inside.

The bar now also gains a `.pinned` class — a slight shadow and a firmer border — via a 1px
sentinel placed in normal flow just above it. The sentinel's `boundingClientRect.top` sign tells
which edge it left by, so approaching from below does not falsely register as pinned. A naïve
`!isIntersecting` check reports pinned when the bar is still far below the fold.

Verified pinned at `top: 0` across the full height of the ink zone and correctly unpinned above it.

### Year / Month is a switch, not two buttons

Pill-shaped track with a sliding amber thumb that resizes to the active label — "Year" and
"Month" are different widths, so a fixed-width thumb would misalign on one side. Thumb width and
offset are read from the active label's own layout (`offsetWidth` / `offsetLeft`), so it stays
correct if the copy ever changes.

- Amber thumb ties the control to the cost palette rather than introducing a new accent.
- Active label sits at `#1E1509` on amber; inactive is `#8A8F9C` on the chip at 4.6:1.
- Real `<button role="switch">` with `aria-checked`, keyboard operable, visible focus ring.

---

# Mobile pass (enough to show people, not a redesign)

## SVG text does not scale the way you want it to

The cliff chart was authored with a 920-wide viewBox. Squeezed into a 340px phone column that is
a 0.37 scale factor, so its 11px labels rendered at **4.1px**. Nothing in the CSS says anything is
wrong; the chart just becomes unreadable.

Fix: the chart picks its **own geometry from the container width**. Under 560px it uses a
340×268 viewBox with tighter margins and fewer gridlines, so the scale factor is ~1.0 and 11px
renders as 11px. A resize listener repaints across the breakpoint.

The annotation also flips: on desktop it sits to the right of the cliff line, on a phone it
right-aligns to the left of it, because there is not enough room to its right.

**Rule: any SVG with text needs a viewBox roughly matching its rendered width, or the text needs
to scale inversely. Check the effective font size, not the declared one.**

## The sticky bar goes two-row on phones

Row 1: household context + the Year/Month switch. Row 2: all three figures, label above value.
109px tall — more than ideal, but the switch's 44px touch target sets the floor and the bar is
the site's main orientation device.

The context line is **shortened on mobile** (`4 · Hartford · $95k` rather than the full
sentence) — the full string plus the switch overran the row by 49px. It also carries
`min-width:0; overflow:hidden; text-overflow:ellipsis` so no future copy change can push the row
wide again.

## Touch targets and type

All controls now clear 44px (steppers, the switch, segmented buttons, ZIP field, area chips,
range thumb). The smallest type moved up: eyebrows to 12px, labels to 11.5px, notes to 13.5px,
chart captions rewritten shorter.

## The CSS-order trap, twice in one session

The new mobile block was inserted *before* an existing `@media (max-width:760px)` block, so the
old one-row sticky rules won on source order and silently hid the household line and the
Marketplace figure. Symptom looked like the new rules "not applying".

**Two sources of truth for the same breakpoint is the bug.** The stale rules are deleted; there
is now a single mobile block. Worth watching for whenever a media query gets extended.

## Verified

390 / 360 / 430px: no document overflow, no sticky overflow, all three figures present, no touch
target under 44px, and no chart label collision sweeping income from $30k to $230k. Desktop and
tablet regressions all still pass.

---

# Housekeeping

## The repo

11MB → 272KB. Six files now:

    src/calc.js               calculation layer, no dependencies
    page.inc.html             source of truth: styles, markup, app script
    build.sh                  inlines calc.js, emits the standalone document
    test.mjs                  the whole suite
    thewholebill-preview.html built output, never hand-edited
    README.md

Deleted: 24 ad-hoc test scripts, 46 screenshots, and four HTML fragments
(`meth.html`, `sections.html`, `lives.html`, `favicon.txt`) that had already been spliced into
the page and would have drifted out of sync with it.

## One test suite

`node test.mjs`, or `node test.mjs cliff` to filter. Forty-two assertions across ten groups:
overflow at five widths, sticky pinning, the unit switch, all three coverage routes, the cliff
drop and label collisions, phone-legible chart text, touch targets, view routing, ZIP scope, and
a content check for dead links and stale placeholders.

**It caught a defect on its first run** — the chart's axis caption rendered at 8.5px on a phone,
below the 9px floor I had set for myself two sessions earlier and never enforced. That is the
argument for the suite in one line: the rules only hold if something checks them.

## Dead code removed

`.slider` and `.caret` (both replaced by real form controls), the `--u` and `--teal-deep`
variables, and the unused `#bigCap`. calc.js needed nothing — its apparently-unused exports are
the public API that `summary()` and `routeBreakdown()` call internally.

## Navigation

"How it works" and "About" pointed nowhere and are gone. "Sources" is folded into
**Methodology & sources**, which is honest — the methodology page already carries the source
table. Masthead and footer now offer exactly one link, and it works.

## Bill numbers

The Medicare for All Act is **H.R. 3069** (House, Jayapal/Dingell) and **S. 1506** (Senate,
Sanders) in the 119th Congress. These change every Congress, so they live in a single `BILL`
constant rather than being scattered through the markup. The letter now names the bill, and the
rep card shows the House bill, the Senate companion, and an honest `[not yet wired]` for the
member's actual position.

The letter no longer claims the reader "did the arithmetic this week" — a small falsehood, but
the letter is the one artifact that leaves the site and lands on a staffer's desk.
