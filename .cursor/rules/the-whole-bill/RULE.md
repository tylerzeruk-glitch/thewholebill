---
description: "Conventions for The Whole Bill — a healthcare cost calculator whose only asset is being trustworthy about numbers."
alwaysApply: true
---

**Read `CLAUDE.md` at the repo root before changing anything.** It is the full set of
conventions and the traps this codebase has already fallen into. `docs/numbers-and-copy-traps.md`
covers the ways these particular numbers go wrong. This file carries only the rules that must
apply even before those are opened.

## Non-negotiables

1. **Every figure carries a basis.** `calc.js` tags each one `statutory` (fixed in law or a
   federal table), `survey` (a published average), or `modeled` (our estimate). A modeled figure
   must be labelled wherever it is shown. If you add a figure, add its basis.

2. **Never reverse-engineer a rate to reach a number you like.** Where a source published no
   household-level figure, show the allocation arithmetic instead — see the Blahous derivation in
   `calc.js`. An earlier version picked an effective rate to land near a preferred total; that is
   exactly what this site accuses its opponents of.

3. **Disclose provenance for friendly sources as well as hostile ones.** Mercatus is labelled
   Koch-funded; the Yale preprint is labelled not-peer-reviewed with its author's advisory role
   stated. Apply the standard evenly or it means nothing.

4. **Verify rendered geometry, not source.** Three defects shipped past review and were caught
   only by measuring pixels: bars squashed by flex defaults, a chart that drew the same height
   for every route, and colliding labels. `test/test.mjs` asserts real layout. Do not claim a
   visual behaviour without checking it.

5. **Money is stored annually and divided at render.** One formatter, one source of truth. The
   Year/Month switch must never read a pre-divided value.

6. **"Costs", not "spends".** A household does not *spend* its employer's premium share — that is
   the entire argument of the site. Reserve "spends" for money that leaves its hands.

## Build

    ./build.sh && node test/test.mjs

`src/page.html` is the source of truth; `dist/` is generated and must never be hand-edited.
`src/calc.js` has no dependencies and loads in node or a browser — keep it that way, and do not
reintroduce `"type": "module"` to package.json, which silently breaks `require()`.
