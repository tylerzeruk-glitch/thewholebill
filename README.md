# The Whole Bill

What your healthcare actually costs — including the employer premium share that never appears on
a paystub — what the alternatives cost, and what universal coverage would cost instead.

**thewholebill.org** · preview build

## Run it

    npm run setup     # installs deps + the chromium the tests drive
    npm test          # builds, then runs the suite
    ./build.sh        # build only -> dist/

Then open `dist/index.html`. No server needed; the page is self-contained.

## Layout

    src/page.html     source of truth: styles, markup, app script
    src/calc.js       calculation layer — no dependencies, runs in node or a browser
    build.sh          inlines calc.js, emits dist/
    test/test.mjs     the whole suite (`node test/test.mjs cliff` filters by name)
    docs/             design brief, and the numbers/copy traps worth reading first
    dist/             generated — never edit

`dist/index.html` is a standalone document. `dist/artifact.html` is the same page without the
document skeleton, for hosts that supply their own.

## What is real and what is not

The subsidy arithmetic is exact and sourced: HHS poverty guidelines, the IRS applicable-percentage
table for 2026, KFF employer premium averages, statutory Medicare and COBRA rates. Every figure
carries a `statutory` / `survey` / `modeled` tag and the UI shows it.

Benchmark marketplace premiums are **modeled placeholders for five metro areas**. Replacing them
from the CMS public use files is the next piece of work — see `CLAUDE.md`.

## Reading order

1. `CLAUDE.md` — conventions, and the traps this codebase has already fallen into
2. `docs/numbers-and-copy-traps.md` — the ways these numbers go wrong
3. `src/calc.js` — every constant, with its source in a comment
