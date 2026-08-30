# The Whole Bill — working notes

A calculator that shows a household what its healthcare actually costs — including the employer
premium share that never appears on a paystub — what the alternatives cost, and what universal
coverage would cost instead. It then drafts a letter to their representative.

    ./build.sh && node test/test.mjs      # or: npm test

`src/page.html` is the source of truth. `dist/` is generated — never edit it.
`src/calc.js` has no dependencies and runs in node or a browser.

---

## The one rule everything else serves

**This site's only asset is being trustworthy about numbers.** It argues a contested political
position, so the arithmetic has to survive a hostile reader. Every convention below exists
because a shortcut got caught.

## Every figure carries a basis

`calc.js` tags each returned figure:

| tag | meaning |
|---|---|
| `statutory` | fixed in law or a published federal table — exact |
| `survey` | a real published measurement, but an average (KFF) |
| `modeled` | our estimate — **must be labelled wherever it is shown** |

Never ship an unlabelled modeled figure. The UI surfaces the tag; the methodology page
(`#/methodology`) shows the arithmetic. If you add a figure, add its basis.

## Disclose provenance, including for sources you agree with

Mercatus is labelled Koch-funded. The Yale preprint is labelled as not peer reviewed, with its
author's advisory role to Sen. Sanders stated. Apply the same standard to friendly and hostile
sources or the labelling means nothing.

Where a study published no household-level figure, say so and show the allocation — see the
Blahous derivation in `calc.js`. Do not reverse-engineer a rate to land on a number you like;
an earlier version did exactly that and it was indefensible.

## Verify rendered geometry, not source

Three separate defects shipped past code review and were caught only by measuring actual pixels:

- bars silently squashed because flex children shrink by default (`flex-shrink: 0` on anything
  whose pixel size *is* the data)
- a chart that drew the same height for every route, because each route scaled to its own maximum
- chart labels colliding at incomes past the subsidy cliff

`test/test.mjs` asserts rendered geometry for exactly this reason. **Do not claim a visual
behaviour without checking the screen.** It caught the axis caption rendering at 8.5px on its
first run.

## Traps that have bitten this codebase

- **`overflow-x: hidden` on html/body kills `position: sticky`** — it computes `overflow-y` to
  `auto`, making them scroll containers. Use `overflow-x: clip`.
- **SVG text scales with the viewBox.** A 920-wide viewBox in a 340px column renders 11px text at
  4px. The cliff chart picks its geometry from the container width. Check the *effective* size.
- **One media query block per breakpoint.** Two `max-width: 760px` blocks meant source order
  silently decided which rules won, and the newer ones looked like they "weren't applying".
- **Chart geometry carries magnitude; colour carries category.** Never make colour do both — an
  early waterfall encoded sequence as decreasing lightness and ran out of contrast before it ran
  out of steps.

## Money

Every figure is stored as an **annual** number and rendered through one formatter. The Year/Month
switch divides at render time. Nothing holds a pre-divided monthly value — that is what keeps the
two views from drifting and the rounding honest (the monthly waterfall bands still sum exactly to
the monthly total).

Two exceptions, both deliberate: the decade total never divides, and COBRA is authored annually
and displayed monthly.

## Language

The household does not *spend* the employer's premium share — that is the entire argument. Copy
says what healthcare **costs** a household, and reserves "spends" for money that leaves its hands.

## Volatile constants

Bill numbers change every Congress: one `BILL` constant in the app script (currently H.R. 3069 /
S. 1506, 119th). FPL tables, the applicable-percentage schedule, employer premiums and the
financing models all live in `calc.js` with their sources in comments.

**The enhanced premium tax credits expired 31 Dec 2025 and the 400% FPL cliff is back.** Any
figure or copy written before that assumed the old schedule and is wrong.

## Accessibility floors

4.5:1 for text, 3:1 for graphics and control boundaries, 44px touch targets. The palette table is
in `docs/design-brief.md`. The ink ground runs out of contrast quickly — do not encode meaning in
lightness there.

## Next

1. **Stage 2 — the CMS pipeline.** `BENCHMARK` in `calc.js` is five hand-modelled metro areas.
   Replace it from the CMS Exchange PUFs (healthcare.gov states) and State-based Exchange PUFs
   (21 states). Precompute the second-lowest-cost silver benchmark per rating area — roughly 500
   numbers, shipped as JSON. No API key, no backend.
2. **Rep lookup.** Google's Civic Representatives API was retired in April 2025. Use
   `unitedstates/congress-legislators` plus real geocoding — ZIP-only is wrong often enough to
   send people to the wrong office, which for this site is a serious failure.
3. **Real routing.** `#/methodology` becomes `/methodology`; the section is already self-contained
   and the router is about twelve lines.
4. ~~Deploy~~ **Done 2026-08-30**: live at thewholebill.org via Cloudflare Pages,
   auto-deployed from `main`, gated by Cloudflare Access (allowlisted emails only).
   Settings, gate management and the go-public checklist: `docs/DEPLOY.md`.
   Going public is a deliberate step, not a default.
