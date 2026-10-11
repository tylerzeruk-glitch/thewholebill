# The Whole Bill

**[thewholebill.org](https://thewholebill.org)** · a calculator that shows what healthcare
actually costs your household, including the part your employer pays that never appears on a
paystub, what the alternatives cost, and what universal coverage would cost you instead.

## What it does

- **Adds up the whole bill.** Your premium deduction, your employer's share of the same premium,
  your deductible and out-of-pocket spending, and the Medicare payroll tax, for your ZIP, your
  household and your income.
- **Prices the alternatives.** What the same household would pay on the marketplace (including
  the subsidy cliff at 400% of the poverty line, back since the enhanced credits expired at the
  end of 2025) or uninsured in a bad year.
- **Compares universal coverage under six published estimates,** from the bill's own authors to
  its opponents, so you can pick whose numbers you trust.
- **Drafts a letter** to your representative and senators, built from your own figures.

## Check our work

This site argues a contested position, so its numbers have to survive a hostile reader. That is
why the code is public.

- **Every figure carries a basis**, shown on the page: `statutory` (fixed in law or a federal
  table, exact), `survey` (a published average), or `modeled` (our estimate, always labelled).
- **The methodology page shows the arithmetic** for every figure and every financing model:
  [thewholebill.org/methodology](https://thewholebill.org/methodology).
- **Every constant has its source beside it** in [`src/calc.js`](src/calc.js): poverty
  guidelines, the IRS applicable-percentage table, employer premiums, the financing models.
- **Marketplace premiums are real**, not estimated: the benchmark silver plan for every county
  in the 50 states and DC, built from the CMS public use files by
  [`tools/build-benchmarks.mjs`](tools/build-benchmarks.mjs) and checked to the cent against
  published figures on every rebuild.
- **Provenance is disclosed both ways.** The Mercatus estimate is labelled Koch-funded; the Yale
  mortality study is labelled not peer reviewed, with its author's advisory role to Sen.
  Sanders stated. Where a study published no household-level figure, the page says so and shows
  how we allocated it.
- **Changes are logged**, with dates and sources: [thewholebill.org/updates](https://thewholebill.org/updates)
  ([RSS](https://thewholebill.org/updates.xml)).
- **What went wrong and what we changed:** [`docs/LESSONS.md`](docs/LESSONS.md).

## Found a mistake?

Email **contact@thewholebill.org** or [open an issue](https://github.com/tylerzeruk-glitch/thewholebill/issues).
Say which figure, for what inputs (ZIP, household, income), and what you think it should be and
why. Corrections are logged on the updates page.

## Privacy

The calculator runs entirely in your browser. There is no analytics script, no cookies and no
server receiving your inputs; the letter is never sent to us. The page loads fonts from Google
and member portraits from a public GitHub collection, and nothing else.

## Reuse it

Campaigns, offices, journalists and anyone else may use and adapt the copy, the methodology and
the data, with credit: *Source: The Whole Bill (thewholebill.org)*. The code is under the MIT
License ([`LICENSE`](LICENSE)); the content and data tables are under CC BY 4.0, with each
third-party source's terms in [`LICENSE-CONTENT.md`](LICENSE-CONTENT.md).

## For developers

    npm run setup     # installs dependencies and the Chromium the tests drive
    npm test          # builds, then runs the suite
    ./build.sh        # build only, into dist/

Then open `dist/index.html`; no server needed. `src/page.html` is the source of truth (styles,
markup, app script), `src/calc.js` the calculation layer (no dependencies, runs in node or a
browser), `src/updates.js` the dated log, and `test/test.mjs` the suite, which measures rendered
geometry as well as numbers. `dist/` is generated: never edit it. Read
[`CLAUDE.md`](CLAUDE.md) and [`docs/numbers-and-copy-traps.md`](docs/numbers-and-copy-traps.md)
before changing anything.
