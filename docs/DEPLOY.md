# Deploying The Whole Bill

Live at **https://thewholebill.org** since 2026-08-30, behind an access gate.
Three surfaces exist and this is how each stays current:

| surface | updates when | audience |
|---|---|---|
| thewholebill.org | automatically, on every push to `main` | people on the allowlist |
| the Claude artifact | manually republished after each merge | review + comments |
| local `dist/index.html` | `npm run build` | development |

## Hosting: Cloudflare Workers (static assets), via Workers Builds

Settled 2026-09-02: the site is a **Worker named `thewholebill`** serving static
assets with no script, not a Pages project. (This file said Pages until then; the
tell was a 404 with an empty body, which is the Workers default, while Pages
serves a root `404.html` on its own.) The Worker is connected to the GitHub repo
through Workers Builds. Settings that matter:

- Build command: **`npm run build`**. Assets and serving behaviour come from
  `wrangler.jsonc` in the repo root: `assets.directory` is `dist/`,
  `not_found_handling` is `404-page` (the branded 404), `html_handling` is
  `auto-trailing-slash` (`/methodology` redirects to `/methodology/`, `/updates` to
  `/updates/`; `/updates.xml` is the RSS feed, typed by `_headers`).
- The deploy command in Settings, Build should be plain `npx wrangler deploy`.
  If it carries an `--assets` flag from before the config file existed, remove
  the flag; the config file is the single source for the assets directory.
- Production branch: `main`. Every push to it deploys. There are no branch
  builds, so PRs carry only the GitHub CI check.
- The build does **not** run the test suite; GitHub CI remains the gate on PRs.
  Keep it that way: Playwright in the build image would slow every deploy for a
  check that already ran.
- `build.sh` is POSIX sh + python3 on purpose. Do not add macOS-only tools
  (BSD `sed -i ''` and friends) or the build breaks.
- The artifact build lives in `preview/`, outside `dist/`, so it never deploys;
  `/artifact` and `/artifact.html` return the branded 404.

## The gate: Cloudflare Access

The site is **not public**. A Zero Trust Access application covers
`thewholebill.org` (team: `thewholebill-preview`), login method One-Time PIN:
a visitor enters their email, and only addresses on the Allow policy receive a
six-digit code.

- **Add or remove a person:** Zero Trust → Access → Applications → the app →
  edit the Allow policy's email list. Takes effect immediately.
- **Side doors are closed at the source (2026-08-31):** the `workers.dev` route,
  Preview URLs, and builds for non-production branches are all disabled in the
  project's settings. The site exists at thewholebill.org and nowhere else, and
  only pushes to `main` build. If previews are ever re-enabled, they come back
  ungated -- re-close or gate them deliberately.
- **One deliberate hole: `/logo.svg`.** The Access login page shows a logo to
  people who are not signed in yet, so the mark it loads cannot sit behind the
  gate. A second, path-scoped Access application (`thewholebill.org/logo.svg`,
  policy: Bypass · Everyone) exposes exactly that file — the most specific
  application wins, so the site-wide app still covers everything else. The SVG
  is four amber rectangles; it carries no data. Keep the path exact: no
  wildcard.
- **Going public is one deliberate act:** delete the Access application. No code
  changes. Work through the go-public checklist below first.

## Go-public checklist

**The site went public on 2026-09-02.** The list is kept as the record of what
was checked, and as the checklist for any future re-gating. Launch-day
verification from outside: `/`, `/methodology/`, `/logo.svg`, `/card.png` 200;
`/artifact`, `/artifact.html` and a nonsense path 404; every `src/_headers`
header live; no HTML rewriting (script hashes hold, four inline scripts); the
calculator runs and the ZIP lookup resolves. Outstanding from the list: HSTS
(item 8b) and the analytics beacon switch (item 5).

Each of these before deleting the Access application:

1. **artifact.html stays out of the deploy** — the build now writes it to
   `preview/` and deletes any stale `dist/artifact.html`, and the suite
   asserts both. Verify once after the launch deploy: `/artifact` and
   `/artifact.html` should 404.
2. **Decide the parked questions first.** Section 03's framing, the Medicare
   tax asymmetry, and the parked rich-world PR should each get a deliberate
   yes/no/ship-as-is BEFORE strangers read the site. Reframing under public
   criticism reads as retreat; reframing before launch is editorial control.
3. **The contact address must work, and decide the reply posture.**
   Email Routing for contact@thewholebill.org verified end to end (send a
   test from an outside account). Replying from the personal inbox reveals
   the owner's name and address: either do not reply from it, or set up a
   send-as so replies come from contact@ before public mail starts.
4. **Launch-day data freshness**: rerun `node tools/build-reps.mjs` that
   morning so every cosponsor claim carries a launch-day as-of date.
   Benchmarks are frozen by CMS until the next plan year; nothing to do.
5. **Analytics is a values decision; make it on purpose.** The site promises
   "we never see your letter." Consistent options: no analytics, or
   Cloudflare Web Analytics (cookieless). Nothing heavier: a reader
   checking the network tab and finding a tracker spends that against us.
   **Decided 2026-09-02: zone analytics only** (Analytics & Logs, Traffic:
   edge request counts, approximate uniques, top paths, countries). Nothing
   runs in the reader's browser and the footer's "nothing else leaves this
   page" stays literally true. The Web Analytics beacon that Cloudflare
   auto-injects is blocked by the CSP anyway, so it must be OFF (Analytics &
   Logs, Web Analytics, disable automatic setup or remove the site); left on,
   it collects nothing and prints a refusal in every reader's console.
   Verify: `curl -s https://thewholebill.org/ | grep -c cloudflareinsights`
   should print 0. If page-level data is ever wanted, the cost is one CSP
   line (`static.cloudflareinsights.com` in script-src,
   `cloudflareinsights.com` in connect-src) and one footer sentence
   disclosing the beacon.
6. **Branch protection on `main`** before public attention. GitHub refuses it
   on a free private repository ("Upgrade to GitHub Pro or make this
   repository public"), and making the repo public contradicts item 7. Either
   GitHub Pro (about $4 a month) or accept single-maintainer discipline: CI is
   advisory, nothing stops a direct push to `main`, and every push to `main`
   deploys. Decide which, and write the answer here.
7. **Anonymity re-check.** As of 2026-08-31 the owner's name is not reachable
   from the site, and launch is when that's worth re-verifying:
   - Shipped pages and headers carry no name, email, or repo link. Re-check:
     `grep -riIE 'zeruk|gmail' dist/ src/` should stay empty, and
     `grep -riI 'github' dist/ src/ | grep -v 'unitedstates.github.io'` too
     (the member portraits legitimately load from the @unitedstates
     collection on github.io; that is a data source, not attribution).
     The first name alone is no longer a useful probe: Tyler County, TX and
     Tyler County, WV live in the benchmark data on their own merits.
   - WHOIS/RDAP registrant data is redacted by Cloudflare Registrar by default;
     only the state ("CT") stays visible, per ICANN rules. Verify:
     `curl -s https://rdap.cloudflare.com/rdap/v1/domain/thewholebill.org`
     should show `DATA REDACTED` on the registrant.
   - The GitHub repo is **private**, and the site must not link to it. Making
     the repo public attributes the site via commit author, account name, and
     PR history — if the code should ever be public without attribution, that
     is a fresh-history push from a new account, not a visibility flip.
8. **Delete the logo-bypass application too.** The `/logo.svg` bypass app only
   exists to serve the login page's mark; with the gate gone it is a leftover
   exception with nothing to except. Remove both Access applications together,
   site-wide app first, then the bypass, so the site is never "logo gated, site
   open". Access sets `no-store` on its 302s, so no stale redirect is cached.
   Then delete the One-Time-PIN allowlist (the reviewers' emails).
8a. **Which product hosts the site: settled, Workers** (see Hosting above). The
   side door for a Worker is the `workers.dev` route; it was disabled on
   2026-08-31. Re-check after any dashboard change: `curl -sI` the
   `thewholebill.<account>.workers.dev` hostname and confirm it does not answer
   `200` for the site.
8b. **Headers and zone settings, launch day.** `src/_headers` now ships
   `Permissions-Policy`, `Cross-Origin-Opener-Policy` and a Content Security
   Policy: `/methodology` runs with no scripts at all, and `/` names each of
   its inline scripts by sha256 (build.sh computes them into `dist/_headers`;
   the suite serves `dist/` with those headers and asserts nothing is
   refused). Two consequences:
   - Any Cloudflare feature that rewrites HTML breaks the hash: **Rocket
     Loader, Auto Minify and Email Address Obfuscation must be off** for the
     zone (Speed and Scrape Shield). Check before launch and after any zone
     change; the symptom is a page that loads but does not calculate.
   - HSTS is a zone setting, not a header: SSL/TLS, Edge Certificates, enable
     with max-age six months and includeSubDomains on; leave preload off for
     now.
   Also set `SKIP_DEPENDENCY_INSTALL=1` in the build settings: build.sh needs
   nothing from node_modules, and npm is the deploy's only dependency chain.
9. **Verify the launch, not just the gate:** immediately after deleting the
   Access apps, from a machine not signed in:
   - `/`, `/methodology` and `/logo.svg` return `200`; `/artifact` and a
     nonsense path return the branded 404.
   - Paste the URL into a LinkedIn/Bluesky draft (do not post) and confirm
     the share card unfurls: title, description, and the card image. Run
     LinkedIn's Post Inspector on the URL first: it cached the card while the
     URL 302'd to the login page. Bluesky re-fetches on paste.
   - Nothing else about the site should differ from the gated version.
10. **Then the announcement posts** — the LinkedIn and Bluesky threads that
    recruited reviewers are the natural place for the "it is open now"
    follow-up, and that second touch reaches the people who engaged first.

## Verifying the gate

From any machine NOT signed in:

    curl -sS -o /dev/null -w "%{http_code} %{redirect_url}\n" https://thewholebill.org

Gated: `302 https://thewholebill-preview.cloudflareaccess.com/...`
Broken open: `200` with an empty redirect — treat that as an incident, not a
curiosity; it happened once during setup when the Access application was created
without attaching to the zone's domain.
