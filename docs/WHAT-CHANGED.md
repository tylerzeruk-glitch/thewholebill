# What changed: keeping the log

The log is `src/updates.js`. `tools/build-updates.mjs` renders it into the hero's "What
changed" box (pins plus the newest, three in all), the `/updates` page and `/updates.xml`.
The box is never edited by hand: to change it, add an entry. The suite enforces the shape
of every entry (ISO date no later than today, newest first, unique slug, a world entry's
https primary source, methodology pointers that exist, no em or en dashes, at most three
pins).

## What qualifies

Two kinds of entry, and only three reasons to write one.

- **A constant the site uses moved.** The poverty guidelines, the IRS applicable-percentage
  table, KFF's employer premiums, the CMS plan-year files, the bill numbers, the cosponsor
  snapshot. A `world` entry when it is published, a `site` entry when the number changes here;
  the two link to the same methodology section.
- **A measurement of what the site argues about.** Enrollment, premiums, deductibles, the
  uninsured rate, from KFF, CMS or the Census Bureau. `world`.
- **Legislative motion on the bill or on the credits.** Floor votes, hearings, a state
  single-payer bill advancing. `world`, cited to congress.gov, govinfo or the state
  legislature's own bill page.

Not op-eds, not polls, not campaign statements, not secondary coverage, not a change that
moves no number and no copy (fonts, layout). Titles state the number and the date and do
not editorialise. An entry that cannot be cited to a primary document waits.

## The calendar

Most of it is annual and predictable.

| When | Source | Why it matters |
|---|---|---|
| Mid January | HHS poverty guidelines, Federal Register | the next plan year's credit uses them |
| Late January | CMS open-enrollment national snapshot | sign-ups for the year |
| May | KFF "what we know so far" on the year's enrollment | the measurement entry |
| May | HHS Notice of Benefit and Payment Parameters, final rule | only if it changes a number |
| Late July | IRS revenue procedure with next year's applicable percentages | the credit schedule (a site change on 1 November) |
| July, updated August | KFF preliminary rate filings | next year's premiums |
| Mid September | Census CPS ASEC health insurance report | the uninsured rate |
| October | KFF Employer Health Benefits Survey | the site's employer constants (a site change) |
| October | CMS plan-year public use files | the benchmark rebuild, ritual 7 in CLAUDE.md |
| 1 November | Open enrollment | the plan-year switch |
| Continuous | govinfo BILLSTATUS for H.R. 3069 and S. 1506 | cosponsors, ritual 6 in CLAUDE.md |

## The watcher

    node tools/watch-sources.mjs             # the last 35 days
    node tools/watch-sources.mjs --days 90

Keyless and stateless, so it runs the same on a laptop and in a fresh cloud checkout. It
reads KFF's ACA and health-cost feeds, CBO, the CMS newsroom, the Federal Register API (three
searches), govinfo BILLSTATUS for both bills (by name: who signed or withdrew after the reps
snapshot, and whether the rep card is stale), ASPE's poverty page (against the year calc.js cites), the IRS drop listing (new
revenue procedures; the section 36B one lands in July) and the Census publications page. It
prints leads in markdown. It never writes an entry: read the primary document, then write.

**Cosponsor counts: compare people, never totals.** govinfo's cosponsor count and the number
of members marked on the rep card are different quantities: the card marks the sponsor too
and holds only current members, while govinfo keeps the line of a cosponsor who has left
Congress. Subtracting one from the other is wrong by one or two in either direction, and the
routine's 28 September 2026 entry did exactly that (it said H.R. 3069 gained two and S. 1506
none; each gained one, and the entry was corrected in place). An entry states the gain the
watcher prints ("signed after the snapshot"), names who signed and when, and reads the total
from govinfo alone.

Sources that block keyless fetches and have to be checked by hand: congress.gov itself
(use govinfo), Health Affairs, the New York Senate bill pages.

## The routine

A weekly cloud routine can run the watcher and open a draft pull request that proposes
entries, each with its primary link, for a person to accept, edit or reject. It must never
merge, never edit anything but `src/updates.js`, and must leave out anything it could not
cite. Its configuration lives at https://claude.ai/code/routines.

The routine's cloud environment must be able to reach the sources. The Default environment's
**Trusted** network level allows package registries and GitHub only, and the first run
(14 September 2026) found every source refused by the egress proxy and correctly opened
nothing. Set the environment's **Network access** to **Custom**, tick "Also include default
list of common package managers", and list:

    *.kff.org
    *.cbo.gov
    *.cms.gov
    *.federalregister.gov
    *.govinfo.gov
    *.hhs.gov
    *.irs.gov
    *.census.gov
    *.congress.gov
    *.healthaffairs.org
    *.nysenate.gov

The selector is the cloud icon in the routine editor or the environment dialog at
https://claude.ai/code. The last three are for reading primary documents by hand in a
cloud session; the watcher itself does not need them.
