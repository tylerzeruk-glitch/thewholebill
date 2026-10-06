# Codex Review

Review date: 6 October 2026  
Repository: `tylerzeruk-glitch/thewholebill`  
Reviewed branch: `main`  
Reviewed commit: [`e4566d1c014462e36778ea84e303f430ef434f82`](https://github.com/tylerzeruk-glitch/thewholebill/commit/e4566d1c014462e36778ea84e303f430ef434f82)

This records a read-only code review. All three findings below were reproduced by executing the existing calculation functions or extracted UI functions with minimal DOM stubs. No application fixes were made as part of the review or this documentation commit.

## Findings

All findings are P2 (normal-priority correctness issues). Status: open as of the reviewed commit.

### CR-001: Zero overrides are ignored, and some negative inputs become positive

**Location:** [src/page.html, lines 3157 to 3174](https://github.com/tylerzeruk-glitch/thewholebill/blob/e4566d1c014462e36778ea84e303f430ef434f82/src/page.html#L3157-L3174)

**Reproduction:**

1. Use the default employer-covered household of four and expand the plan-number drawer.
2. Enter `0` in the annual deductible/out-of-pocket field (`oopIn`).
3. The handler stores `null`, restoring the modeled $3,800 rather than using zero.
4. Enter `-100` in `oopIn` or the total-premium field (`totPrem`).
5. The handler strips the minus sign and stores positive `100`.

The paystub-deduction handler also rejects zero, although its `parseMoney()` function correctly refuses a minus sign.

**Cause:** Both handlers require `v > 0` to retain an override. Additionally, `wireOverride()` removes every character other than digits and periods before parsing, including minus signs.

**Impact:** A household cannot enter genuine zero spending or a zero employee premium contribution. For the default household, ignoring zero out-of-pocket spending adds $3,800 to the annual cost and projected savings. Negative values in two fields silently become positive overrides.

**Suggested correction:** Distinguish an empty field from a valid zero, accept nonnegative values within the intended limits, and consistently reject negative inputs before stripping formatting.

**Verification to add:** Zero deduction and zero out-of-pocket overrides remain active and propagate through the figures. Negative inputs in all three drawer fields are refused rather than converted to positive values. The existing negative-input test covers only `deduct`.

### CR-002: A total-premium override can leave premium components inconsistent without a warning

**Location:** [src/page.html, lines 2493 to 2520](https://github.com/tylerzeruk-glitch/thewholebill/blob/e4566d1c014462e36778ea84e303f430ef434f82/src/page.html#L2493-L2520)  
**Related calculation:** `employerCost()` in `src/calc.js`

**Reproduction:**

1. Use the default employer-covered household of four.
2. Enter `5000` in the annual total-premium field.
3. Leave the deduction at its survey default.
4. The worker premium remains $6,850 and the employer share is clamped to $0.
5. The calculated premium components therefore sum to $6,850, despite the entered total of $5,000.
6. The summary reads: "Currently using your total premium, with survey averages for the rest." No inconsistency warning appears.

**Cause:** `employerCost()` clamps the employer share with `Math.max(0, premium - worker)`. The UI only warns about an inconsistent pair when both `state.totPrem` and `state.deductPer` are explicitly set, excluding a total-premium override that conflicts with the default worker contribution.

**Impact:** The calculator claims to use the reader's total premium while computing a larger premium. This affects the headline, comparison figures, savings and COBRA estimate.

**Suggested correction:** Validate the entered total against the effective annual worker contribution, including its survey default. Ask for a compatible deduction or clearly mark the estimate as unresolved when the inputs conflict.

**Verification to add:** A total-only override below the effective worker contribution produces an explicit validation state. Valid total-only overrides continue to calculate correctly.

### CR-003: Marketplace headline text incorrectly attributes every zero subsidy to the 400% cliff

**Location:** [src/page.html, lines 2470 to 2477](https://github.com/tylerzeruk-glitch/thewholebill/blob/e4566d1c014462e36778ea84e303f430ef434f82/src/page.html#L2470-L2477)

**Reproduction:**

1. Select marketplace coverage.
2. Use Hartford County, Connecticut (`bkey: '09003'`), a single adult age 40, and annual income of $20,000.
3. The calculation returns an FPL ratio of approximately 1.278, `medicaidLikely: true`, and `overCliff: false`.
4. `renderCards()` nevertheless generates this headline explanation:

> Nothing here hides on a paystub, and past the 400% cliff nobody shares it: every dollar is yours.

The same fallback applies to households below the credit floor and any other case with no subsidy.

**Cause:** The explanation checks only whether `R.borne < R.whole`. Its alternative assumes that a zero subsidy always means the household is above 400% FPL.

**Impact:** The headline gives a false explanation of the household's eligibility and contradicts the calculator's dedicated eligibility box. The error is especially misleading for readers whom the calculation identifies as Medicaid eligible.

**Suggested correction:** Choose the explanation using `overCliff`, `belowFloor`, `medicaidLikely`, and the remaining zero-subsidy case separately, consistent with the eligibility box.

**Verification to add:** Headline text distinguishes an above-cliff household, a below-floor household, a Medicaid-eligible household, and a household whose calculated credit is zero for another reason.

## Verification and scope

- Read the calculation layer, household input and rendering logic, build configuration, relevant data-generation code, repository notes and test coverage.
- Reproduced the findings with focused execution of the existing functions using the checked-in benchmark table. UI-function checks used minimal DOM stubs; they were not full browser interaction tests.
- Confirmed that the latest GitHub Actions test job for the reviewed commit completed successfully, including `npm test`: [test run 37125191227](https://github.com/tylerzeruk-glitch/thewholebill/actions/runs/37125191227).
- Did not rerun the complete browser suite locally.
- This was not an independent audit of every healthcare source, legal assumption or deployed-site behavior.

The project has a separate calculation layer, explicit source and modeling disclosures, and meaningful rendered-geometry tests. The findings above identify gaps that remain despite the passing test run.
