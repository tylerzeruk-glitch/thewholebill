# State sources for a plan year CMS has not published

CMS posts the plan files for the HealthCare.gov states before open enrollment,
but the state-based exchanges' files only months later (plan year 2026's
arrived on 5 May 2026). For plan year 2027 the site builds those states from
each state's own official publications instead, one extractor per state.

    node tools/state-sources/wa.mjs      # downloads, parses, writes the JSON

Each extractor downloads into `tools/cache/<year>/states/<st>/` and writes
`tools/cache/<year>/states/<st>.json` in the format below. `tools/build-benchmarks.mjs`
reads those files the same way for every state. An extractor never guesses: if
a source is missing, malformed or disagrees with itself, it exits non-zero
with a message, and the state is not built.

Primary sources only (the exchange, the state insurance regulator, the state's
own published rate tables). Never a broker, a news story or SERFF behind a
terms click-through.

## The JSON

```js
{
  "state": "WA",
  "planYear": 2027,
  "kind": "plans",            // or "slcsp" (below)
  "final": true,              // false when the publisher labels the rates preliminary
  "precision": "cents",       // or "dollars" when the source rounds to whole dollars
  "sources": [ { "title": "...", "url": "https://...", "published": "2026-09-09" } ],
  "notes": [ "Disclosures for the methodology page, plain sentences, no em or en dashes." ],

  // ---- kind "plans": every on-exchange, individual-market, silver plan ----
  // Leave out: off-exchange-only plans, child-only plans, CSR variants,
  // tobacco rates, catastrophic and other metals.
  "statewide": false,         // true when the state is one rating area (area 1)
  "plans": [ {
    "id": "61836WA0050037",   // 14-character HIOS standard component ID when the
                              // source gives one; otherwise a stable "ST:issuer:plan name"
    "issuer": "Ambetter",
    "name": "Cascade Select Silver",
    "counties": ["53033"],    // 5-digit county FIPS where it is offered on-exchange, or "all"
    "partial": ["53061"],     // optional: counties it serves only in part (also listed in counties)
    "rates": {                // keyed by rating area number, as a string
      "1": [ /* 65 monthly premiums in dollars, index = age, [64] = 64 and over,
                [0..14] all the 0-14 rate */ ]
      // or { "tiers": [individual, couple, parent+1, parent+2, parent+3 or more,
      //                couple+1, couple+2, couple+3 or more] }   (NY, VT)
      // or { "at": 40, "premium": 599.00 }  when the source gives one age only;
      //    then the top-level "curve" is required
    }
  } ],
  "curve": "fed",             // only with "at" rates: "fed" or 65 factors, age 21 = 1

  // ---- kind "slcsp": the state publishes the benchmark itself, per county ----
  "age": 21,                  // the age its table is priced at
  "curve": "fed",             // "fed" or 65 factors, age 21 = 1
  "counties": { "17031": { "premium": 444.70, "plan": "HCSC Blue Choice Silver" } },

  // ---- both kinds: independent published values the build must reproduce ----
  "checks": [
    { "what": "slcsp",        // or "lowest": the lowest on-exchange silver
      "fips": "42029",        // or "ra": 1 for a rating-area figure
      "age": 40,              // or "tier": "individual" (NY, VT)
      "premium": 590.68,
      "factor": 0.9999,       // optional: the published figure is premium x factor
                              // (Pennie prints the EHB portion only)
      "source": "Pennie, Second Lowest Cost Silver Plan by County, PY 2027, p. 1" }
  ]
}
```

Rating areas come from CMS's per-state rating-area pages, which the builder
already reads; a `plans` extractor keys `rates` by the area number those pages
use, and says so in a note if the state's own source numbers areas differently.

`lib.mjs` has the shared pieces: cached downloads, an xlsx reader that needs only
the Python standard library, `pdftotext` (poppler) for PDFs, the federal default
age curve, county name to FIPS, and `writeState()`, which checks the shape before
writing.
