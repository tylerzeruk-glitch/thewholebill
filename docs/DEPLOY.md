# Deploying The Whole Bill

Live at **https://thewholebill.org** since 2026-08-30, behind an access gate.
Three surfaces exist and this is how each stays current:

| surface | updates when | audience |
|---|---|---|
| thewholebill.org | automatically, on every push to `main` | people on the allowlist |
| the Claude artifact | manually republished after each merge | review + comments |
| local `dist/index.html` | `npm run build` | development |

## Hosting: Cloudflare Pages

The Pages project is connected to the GitHub repo. Settings that matter:

- Framework preset: **None** · Build command: **`npm run build`** · Output directory: **`dist`**
- Production branch: `main`. Every push to it deploys. Branch builds are OFF, so PRs carry only the GitHub CI check.
- The Pages build does **not** run the test suite — GitHub CI remains the gate on PRs.
  Keep it that way: Playwright in the Pages image would slow every deploy for a
  check that already ran.
- `build.sh` is POSIX sh + python3 on purpose. Do not add macOS-only tools
  (BSD `sed -i ''` and friends) or the Pages build breaks.
- `dist/artifact.html` (the skeleton-less artifact build) deploys alongside
  `index.html` and is reachable at `/artifact`. Harmless while gated; before going
  public, either exclude it from the deploy or accept that it serves a bare
  fragment.

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
- **Going public is one deliberate act:** delete the Access application. No code
  changes. Work through the go-public checklist below first.

## Go-public checklist

Each of these before deleting the Access application:

1. **artifact.html** — exclude it from the deploy, or accept that `/artifact`
   serves a bare fragment (see the hosting notes above).
2. **Anonymity re-check.** As of 2026-08-31 the owner's name is not reachable
   from the site, and launch is when that's worth re-verifying:
   - Shipped pages and headers carry no name, email, or repo link. Re-check:
     `grep -riE 'tyler|zeruk|gmail|github' dist/ src/ docs/` should stay empty
     for `dist/` and `src/`.
   - WHOIS/RDAP registrant data is redacted by Cloudflare Registrar by default;
     only the state ("CT") stays visible, per ICANN rules. Verify:
     `curl -s https://rdap.cloudflare.com/rdap/v1/domain/thewholebill.org`
     should show `DATA REDACTED` on the registrant.
   - The GitHub repo is **private**, and the site must not link to it. Making
     the repo public attributes the site via commit author, account name, and
     PR history — if the code should ever be public without attribution, that
     is a fresh-history push from a new account, not a visibility flip.
3. **Verify the gate is the only thing that changed:** immediately after
   deleting the Access app, the curl below should return `200` — and nothing
   else about the site should differ.

## Verifying the gate

From any machine NOT signed in:

    curl -sS -o /dev/null -w "%{http_code} %{redirect_url}\n" https://thewholebill.org

Gated: `302 https://thewholebill-preview.cloudflareaccess.com/...`
Broken open: `200` with an empty redirect — treat that as an incident, not a
curiosity; it happened once during setup when the Access application was created
without attaching to the zone's domain.
