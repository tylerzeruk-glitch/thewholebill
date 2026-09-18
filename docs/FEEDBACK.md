# Reader feedback

A running list of what readers have said about the site, what was done with it, and what
was decided about the rest. Newest first within each section. Add to it whenever feedback
arrives, even when the answer is "no": the reasoning is worth keeping.

Two sections. **Open** holds asks that are tabled or under consideration, each with an
assessment against the site's one rule (be trustworthy about numbers). **Done** holds asks
that shipped, with the PR.

## Open

### Long-run savings graphs, national and personal (16 September 2026)

> "Some graphs of overall savings in the long run of national and personal expenditure
> would be good to have."

Tabled by the owner, 16 September 2026.

Personal: the site shows a flat decade total (ten times one year) on purpose. A graph over
time needs a premium growth assumption, and compounding is where a hostile reader pounces.
The honest form is three lines on one chart (flat, historical growth, recent growth) with
the assumptions printed on the chart and the flat total kept as the headline. One PR,
moderate effort, one new modeled figure with its label.

National: the six models each publish national ten-year figures on different baselines and
scopes; the interesting fact is that they disagree about who pays more than about how much.
First step is a methodology table, each study's own national figure on its own terms,
verified against the primary documents. A chart only after that table exists.

### Deductible spend before care counts (16 September 2026)

> "Have a way to factor in deductible spend before we can actually get the care from health
> insurance currently."

Tabled by the owner, 16 September 2026. Recommended first when these reopen.

Out-of-pocket spending is already in every household total and the advanced drawer takes the
reader's own deductible, but the page never says the sentence plainly. The bigger version is
a "bad year with insurance" for the employer and marketplace routes, matching the uninsured
bad year: premium plus the statutory out-of-pocket maximum ($21,200 for a family in 2026,
$24,000 in 2027, CMS parameters). Every input is a published federal figure. For the default
household that is roughly $48,000 all in, against a universal figure with no deductible.

### Denial rates by condition and their out-of-pocket cost (16 September 2026)

> "As well as the denial rates of various conditions and their out of pocket costs. That I
> feel would supersede/outsize the costs and benefits easily."

Cannot be done honestly at that grain, and the site should say so. HealthCare.gov insurers
denied 19% of in-network claims in 2024 (3% to 36% by insurer; the most common reported reason
was "other"; under 1% of denials were appealed), per KFF's analysis of CMS transparency data.
Nothing public breaks denials down by condition or attaches a cost to them. The site can put
the aggregate rate on the page as a survey figure and note that the by-condition data is not
published. Anything more would be a made-up number wearing a label.

On the "outsize" claim: for the default family, premiums are about $27,000 and out-of-pocket
about $3,800, so in a typical year the premium dominates. The commenter is right about the
tail, which is why the insured bad year above is the piece to build.

## Done

- **TRICARE, Medicare and VA households** (4 September 2026): a note under the coverage
  control, objection 05, a methodology row. PR #68. A full TRICARE route stays parked.
- **Ages field on a phone keypad** (4 September 2026): "no way to add comma for multiple
  ages." One numeric box per person, the stepper is the only count control. PR #67.
- **Link the methodology from the calculator, and the sources to their documents**
  (4 September 2026): curated explains-links into methodology anchors; every Sources row
  links to its primary document. PRs #65 and #66. The owner did not want "hyperlinks
  everywhere," so the rule is in docs and memory.
- **The lined-paper background is distracting** (2 September 2026): replaced by a faint
  paper grain; palette unchanged. PR #61.
- **Too many fonts** (2 September 2026): the owner's diagnosis was too many treatments, not
  families. Two families, one label rule. PR #60.
