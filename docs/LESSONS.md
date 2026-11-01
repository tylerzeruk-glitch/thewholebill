# The Whole Bill lessons

What went wrong here, why, and what changed so it does not happen again. Live: thewholebill.org ·
Stack: static site from one source (`src/page.html`, `src/calc.js`), Cloudflare Worker, Playwright
test suite, a weekly cloud routine for the "What changed" log.

Add an entry the same day something costs money, time, a broken deploy or a wrong number in front
of readers, with the next WB number, in the format below. The "Rule" line points at the owner's
cross-project rules (G-nnn), which are kept in a private log; the entry here stands on its own.

```
### WB-006 · Short title of what happened
2026-10-11 · tags: data, copy · impact: what it cost (money, hours, readers affected)

- **What happened:** the visible symptom.
- **Why:** the root cause.
- **Fix:** what was changed (PR or file).
- **Rule:** the one-line takeaway → G-nnn
```

### WB-001 · The weekly routine published a wrong cosponsor count
2026-09-28 · tags: data, automation, accuracy · impact: a wrong "What changed" entry live on the site for a few hours

- **What happened:** the routine's entry said H.R. 3069 gained two cosponsors and S. 1506 none. Each gained one
  (Rep. Wahab and Sen. Wyden, both 24 September). It was merged after a review that checked only the total (117),
  not the gain or the Senate claim.
- **Why:** the routine subtracted the rep card's count of marked members from govinfo's cosponsor count. They
  measure different things: the card includes the sponsor and only current members; govinfo keeps cosponsors who
  have since left Congress. The difference was off by one in each direction.
- **Fix:** the entry was corrected in place, keeping its link, with a note saying what was wrong (thewholebill#79).
  The watcher now compares people by ID: who signed after the snapshot, who withdrew, who has left office, and
  whether the card is stale (thewholebill#80). `docs/WHAT-CHANGED.md` tells the routine never to subtract the totals.
- **Rule:** → G-015

### WB-002 · ElevenLabs disabled the free tier partway through a voiceover run
2026-10-01 · tags: cost, ai, platform · impact: 3 of 4 takes failed; no further generations until access is restored or upgraded; credits possibly charged for the failed takes

- **What happened:** a voiceover request for four takes returned one. The other three failed with "Unusual activity
  has been detected on your account, so Free Tier access has been disabled." Separately, an earlier set of four
  takes was thrown away when the script was rewritten the same day.
- **Why:** the free tier is withdrawn when ElevenLabs flags an account, for example for a VPN or proxy. The
  generation tool defaults to four variations per request, so drafts cost four times what one read would.
- **Fix:** the one good take was used and the video cut to it. Access is the account owner's to restore (support,
  or a paid plan).
- **Rule:** → G-001 (one take until the script is final), G-010

### WB-003 · The launch video shimmered
2026-10-01 · tags: video, rendering, testing · impact: a delivered cut re-rendered; render time went from 1 to 8 minutes

- **What happened:** text in the footage of the site jittered during slow camera push-ins.
- **Why:** the zoom was a CSS transform on the live page, so the browser redrew the text every frame and snapped
  each glyph to the pixel grid differently: up to a pixel back and forth per frame. `will-change: transform` did
  not help in headless Chromium. Code review could not show it; tracking a headline across frames did.
- **Fix:** the page is filmed at a fixed framing per shot at twice the resolution, and the push-in is applied
  afterwards as a sub-pixel resample in a compositor. Measured frame-to-frame jitter went from 0.7 px to 0.08 px.
  (The renderer lives outside the repo, in the local `brag-output/work/`.)
- **Rule:** → G-017, G-014

### WB-004 · The representatives snapshot wrote a member with no name
2026-09-21 · tags: data, generator · impact: caught before merge; would have shown a blank name on the rep card for California's 14th

- **What happened:** rerunning `tools/build-reps.mjs` produced a record for a new member with an empty name.
- **Why:** the tool read `official_full` from the upstream legislators file, and the new member's record did not
  have it yet. The tool assumed the field always exists.
- **Fix:** fall back to the first, last and suffix name parts, and throw on any member who still has no name, so a
  bad snapshot is never written (thewholebill#77).
- **Rule:** → G-016

### WB-005 · The calculator ignored a typed zero and blamed the wrong cause for a missing credit
2026-10-06 · tags: input, copy, accuracy · impact: wrong figures and a false explanation in front of readers, in edge cases, since launch; found by an outside code review (Codex), not by the suite
- **What happened:** a 0 typed as the deductible or premium deduction was thrown away and the survey average used
  (+$3,800 for the default family). A minus sign in two of the three plan-number fields was stripped, so -100 became
  an override of 100. A total premium below the default deduction was silently outvoted. And every marketplace
  household with no tax credit was told it was "past the 400% cliff", including households under the poverty line
  or in Medicaid's range, contradicting the eligibility box on the same screen.
- **Why:** the handlers tested `v > 0` to mean "has a value". One field parsed with the helper that refuses a minus
  sign; the other two stripped it with a regex, and the suite tested only the first. The headline chose its sentence
  from "is there a subsidy" when the eligibility box already distinguished four reasons there might not be.
- **Fix:** zero kept, minus refused in all three fields, the conflict warning uses the deduction in force, and the
  headline and waterfall note branch on the same four conditions as the eligibility box; tests that fail on the old
  code (thewholebill#82).
- **Rule:** → G-019, G-006
