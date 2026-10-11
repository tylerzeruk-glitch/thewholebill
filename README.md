# The Whole Bill

What your healthcare actually costs, including the employer premium share that never appears on
a paystub, what the alternatives cost, and what universal coverage would cost instead.

**thewholebill.org**

## Run it

    npm run setup     # installs deps + the chromium the tests drive
    npm test          # builds, then runs the suite
    ./build.sh        # build only -> dist/

Then open `dist/index.html`. No server needed; the page is self-contained.

## Layout

    src/page.html     source of truth: styles, markup, app script
    src/calc.js       calculation layer, no dependencies, runs in node or a browser
    src/updates.js    the dated log: the hero's What changed box, /updates and the RSS feed
    build.sh          inlines calc.js, emits dist/
    test/test.mjs     the whole suite (`node test/test.mjs cliff` filters by name)
    docs/             design brief, and the numbers/copy traps worth reading first
    dist/             generated, never edit

`dist/index.html` is the calculator, `dist/methodology/index.html` the methodology and
`dist/updates/index.html` the dated log (with `dist/updates.xml` as its feed), all standalone. `preview/artifact.html` is the whole page without the document skeleton, for the
Artifact host, and lives outside `dist/` so it never deploys.

## What is real and what is not

The subsidy arithmetic is exact and sourced: HHS poverty guidelines, the IRS applicable-percentage
table for 2026, KFF employer premium averages, statutory Medicare and COBRA rates. Every figure
carries a `statutory` / `survey` / `modeled` tag and the UI shows it.

Benchmark marketplace premiums are real: the second-lowest-cost silver plan for every county in
the 50 states and DC, built from the CMS plan-year 2026 public use files by
`tools/build-benchmarks.mjs` and validated against the published landscape file, NY State of
Health and Covered California figures on every rebuild. The representative lookup
(`tools/build-reps.mjs`) is likewise keyless public data with its as-of date on the card.

## Reading order

1. `CLAUDE.md`: conventions, and the traps this codebase has already fallen into
2. `docs/numbers-and-copy-traps.md`: the ways these numbers go wrong
3. `src/calc.js`: every constant, with its source in a comment
4. `docs/LESSONS.md`: what has gone wrong here and the rule each time taught

## License

Code under MIT (`LICENSE`); the copy, methodology, docs and data tables under CC BY 4.0, with
the third-party data terms listed in `LICENSE-CONTENT.md`. Reuse it freely, with credit:
"Source: The Whole Bill (thewholebill.org)".
