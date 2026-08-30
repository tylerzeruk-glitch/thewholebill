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
- Production branch: `main`. Every push deploys; every PR branch gets a preview URL.
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
`thewholebill.org` (team: `green-wildflower-b78a`), login method One-Time PIN:
a visitor enters their email, and only addresses on the Allow policy receive a
six-digit code.

- **Add or remove a person:** Zero Trust → Access → Applications → the app →
  edit the Allow policy's email list. Takes effect immediately.
- **Preview deployments:** the `*.pages.dev` URLs are a second door. The Pages
  project's Access toggle (project → Settings) must stay on, or previews leak
  the site ungated.
- **Going public is one deliberate act:** delete the Access application. No code
  changes. Do the artifact.html cleanup above first.

## Verifying the gate

From any machine NOT signed in:

    curl -sS -o /dev/null -w "%{http_code} %{redirect_url}\n" https://thewholebill.org

Gated: `302 https://green-wildflower-b78a.cloudflareaccess.com/...`
Broken open: `200` with an empty redirect — treat that as an incident, not a
curiosity; it happened once during setup when the Access application was created
without attaching to the zone's domain.
