# Numbers & Copy Traps — things that will get the site attacked

_Found while building the v1 design mock, 2026-08-25. Every one of these is a real trap the
production build has to handle, not a mock artifact._

## Definition traps (these are the dangerous ones)

**1. "The part you don't see" must exclude the Medicare payroll tax.** The 1.45% payroll tax
IS a line on every paystub. Lumping it into the invisible bucket hands a skeptic an easy kill.

- On the paystub: premium deduction + Medicare tax
- Genuinely invisible: employer premium share + deductible/OOP
- Sample household: $8,278 visible / $23,300 invisible / $31,578 total

Pick ONE definition of "money you see" and hold it across every screen, the letter included.
Three screens drifting into three definitions is how this breaks.

**2. Compare on a consistent basis.** The site's thesis is total cost however routed. So the
marketplace figure must be *your share + the subsidy paid on your behalf* — not just the
household's cash outlay — or the bars compare different things. Label it explicitly in the UI.

**3. Don't round in one place and not another.** Two totals visible in the same frame ($31,600
in the sticky bar, $31,578 in the hero number) reads as sloppy arithmetic. Use exact everywhere;
an instrument that rounds inconsistently isn't trusted.

**4. The Medicare tax asymmetry.** Today's total includes the employee's 1.45%; the universal
models as commonly stated don't carry a continuing Medicare tax. And if the employer premium
share is "really your money" by wage incidence, so is the employer's matching 1.45% — which the
current framing silently drops. Decide the treatment and state it on the methodology page.

## Factual traps

**5. Germany and France are NOT single-payer.** Germany is multi-payer statutory sickness funds;
France is statutory with near-universal supplementary cover. Any wait-times rebuttal that calls
them single-payer is the easiest sentence on the site to discredit — and it would sit in the
one section whose whole premise is intellectual honesty.

**6. Do not overstate Mercatus.** Blahous's ~$2T savings figure holds only under the bill's own
assumption that provider payments fall to Medicare rates; his alternative scenario shows higher
national spending and he rejects the savings reading himself. Stated flatly, it is the mirror
image of the cherry-picking the site accuses opponents of. State both halves — it is still a
devastating detail, and it survives scrutiny.

**7. No study published per-household figures.** Sanders, Urban and Mercatus all produced
national estimates. Any per-household number is *the site's own allocation* of a national
estimate and must be labeled that way, especially under a card headed "who produced this."

**8. Sanders' 2019 list treats the 4% income premium and the 7.5% payroll tax as SEPARATE
options.** Bundling them into "Option 1" misstates the source. If you combine them, say so.

**9. Cost-delayed-care statistic.** KFF surveys land around four in ten adults, not one in four.
Understating it is as damaging as overstating — it signals the numbers weren't checked.

**10. CHIP eligibility is not Medicaid eligibility.** Connecticut's HUSKY B reaches roughly 318%
FPL, so children in a household at 295% FPL are likely eligible — which materially changes that
household's marketplace figure. The state logic needs a third branch: Medicaid, CHIP, exchange.

**11. Don't fabricate plan counts.** "Fourteen silver plans in your rating area" is invented, and
CT has had two carriers in recent years. Bracket anything that must come from live data.

## Consistency traps

- **A hardcoded number in the Critics section will disagree with the model toggle** the instant a
  user switches models. Every figure downstream of the toggle must bind to the selection.
- **"Nothing leaves your browser" vs. live plan lookup.** A live lookup sends the ZIP off-device.
  Reconcile the privacy claim with the architecture before either ships. Safer framing: income
  and household details stay local; only the ZIP is used for a plan query.
- **Break-even thresholds must reconcile.** If Critics says "above ~$250k you pay more" and a
  model card says "under ~$125k you pay less," a reader a page apart sees a contradiction.
- **Keep one source list.** Cite the same set everywhere; don't name CBO or BLS on one screen and
  never use them.
