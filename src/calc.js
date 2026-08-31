/* ============================================================================
 * The Whole Bill — Stage 1 calculation layer
 *
 * Pure functions + sourced static tables. No network, no API key, no backend.
 *
 * HONESTY CONTRACT
 * Every returned figure carries a `basis`:
 *   'statutory' — fixed in law or an IRS/HHS table. Exact.
 *   'survey'    — a published survey average (KFF). Real, but an average.
 *   'modeled'   — our estimate. Must be labelled as such wherever it is shown.
 * The UI is expected to surface anything that is not 'statutory' or 'survey'.
 *
 * SOURCES
 *   FPL .................. HHS 2025 poverty guidelines (the guidelines in force
 *                          at the start of 2026 open enrollment, so these are the
 *                          ones that govern 2026 coverage).
 *   Applicable percentage  IRS Rev. Proc. 2025-25, table for taxable years
 *                          beginning in 2026. NOTE: the enhanced (ARPA/IRA)
 *                          schedule EXPIRED 31 Dec 2025. The 400% FPL cliff is
 *                          back — above 400% the credit is zero, not tapered.
 *   Employer premiums .... KFF Employer Health Benefits Survey 2025.
 *   Marketplace deductible KFF, 2026 marketplace analysis.
 * ========================================================================== */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.WholeBill = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------------------------------------------------------- tables */

  var YEAR = 2026;

  // HHS 2025 poverty guidelines.
  var FPL = {
    contiguous: { base: 15650, add: 5500 },
    AK:         { base: 19550, add: 6880 },
    HI:         { base: 17990, add: 6330 }
  };

  // IRS Rev. Proc. 2025-25 — applicable percentage table for 2026.
  // Within a band the percentage rises linearly from `from` to `to`.
  // There is no band above 400%: that is the cliff.
  var APPLICABLE = [
    { lo: 0.00, hi: 1.33, from: 0.0210, to: 0.0210 },
    { lo: 1.33, hi: 1.50, from: 0.0314, to: 0.0419 },
    { lo: 1.50, hi: 2.00, from: 0.0419, to: 0.0660 },
    { lo: 2.00, hi: 2.50, from: 0.0660, to: 0.0844 },
    { lo: 2.50, hi: 3.00, from: 0.0844, to: 0.0996 },
    { lo: 3.00, hi: 4.00, from: 0.0996, to: 0.0996 }
  ];
  var CLIFF = 4.00;

  // KFF Employer Health Benefits Survey 2025.
  var EMPLOYER = {
    family: { premium: 26993, worker: 6850 },   // employer share = 20,143
    single: { premium:  9325, worker: 1440 }    // employer share =  7,885
  };

  var MEDICARE_RATE = 0.0145;   // employee share, Additional Medicare Tax ignored below the threshold
  var ADDL_MEDICARE_RATE = 0.009;
  var ADDL_MEDICARE_THRESHOLD = { single: 200000, joint: 250000 };
  var COBRA_ADMIN = 1.02;       // statute permits 102% of the full premium

  // Modeled out-of-pocket spend. NOT a survey figure for actual spend — it is our
  // estimate, anchored to published average deductibles. Replace with MEPS-derived
  // values when you have them.
  var OOP = {
    employerSingle: 1400,
    employerPerPerson: 950,
    employerFamilyFloor: 3800,
    marketplaceSingle: 2600,
    marketplacePerPerson: 1300,
    marketplaceFamilyFloor: 5200
  };

  /* -------------------------------------------------------- benchmark rates
   * STAGE 1 PLACEHOLDER.
   * The second-lowest-cost silver plan premium is what drives the subsidy.
   * Stage 2 replaces this whole object with values derived from the CMS Rate and
   * Service Area PUFs (federal exchange) and the State-based Exchange PUFs
   * (21 SBE states) — roughly 500 rating areas, small enough to ship as JSON.
   * Until then these are MODELED and must be labelled in the UI.
   * ---------------------------------------------------------------------- */
  var BENCHMARK = {
    'CT-1': { city: 'Hartford', st: 'Connecticut', label: 'Connecticut · Hartford area', exchange: 'state', medicaidExpanded: true,
              chipUpTo: 3.18, adult: 8200, child: 2900 },
    'NY-4': { city: 'New York City', st: 'New York', label: 'New York · NYC area',         exchange: 'state', medicaidExpanded: true,
              chipUpTo: 4.00, adult: 9400, child: 3100 },
    'TX-26':{ city: 'Dallas', st: 'Texas', label: 'Texas · Dallas area',         exchange: 'federal', medicaidExpanded: false,
              chipUpTo: 2.06, adult: 7100, child: 2500 },
    'FL-27':{ city: 'Miami', st: 'Florida', label: 'Florida · Miami area',        exchange: 'federal', medicaidExpanded: false,
              chipUpTo: 2.15, adult: 7600, child: 2650 },
    'PA-9': { city: 'Philadelphia', st: 'Pennsylvania', label: 'Pennsylvania · Philadelphia', exchange: 'state', medicaidExpanded: true,
              chipUpTo: 3.19, adult: 7900, child: 2750 }
  };

  /* ------------------------------------------------------------- primitives */

  function povertyLine(size, region) {
    var t = FPL[region] || FPL.contiguous;
    return t.base + t.add * (Math.max(1, size) - 1);
  }

  function fplRatio(income, size, region) {
    return income / povertyLine(size, region);
  }

  // Returns the share of income a household is expected to contribute toward the
  // benchmark plan, or null when it is over the cliff and gets nothing.
  function applicablePercentage(ratio) {
    if (ratio >= CLIFF) return null;
    for (var i = 0; i < APPLICABLE.length; i++) {
      var b = APPLICABLE[i];
      if (ratio >= b.lo && ratio < b.hi) {
        if (b.from === b.to) return b.from;
        return b.from + (b.to - b.from) * ((ratio - b.lo) / (b.hi - b.lo));
      }
    }
    return APPLICABLE[0].from;
  }

  function medicareTax(income, filing) {
    var base = income * MEDICARE_RATE;
    var thr = ADDL_MEDICARE_THRESHOLD[filing === 'joint' ? 'joint' : 'single'];
    if (income > thr) base += (income - thr) * ADDL_MEDICARE_RATE;
    return base;
  }

  /* ------------------------------------------------------------ the pillars */

  // What the household's healthcare COSTS through an employer — including the
  // share routed around the paycheck, which is the entire point of the site.
  function employerCost(o) {
    var tier = o.size > 1 ? 'family' : 'single';
    var t = EMPLOYER[tier];
    var premium = o.totalPremium != null ? o.totalPremium : t.premium;
    var worker  = o.workerPremium != null ? o.workerPremium : t.worker;
    var employer = Math.max(0, premium - worker);
    // employerOop is the route-scoped override: o.oop applies to every route (and
    // summary() computes employer AND marketplace from one opts object), so a
    // number describing the user's employer plan must ride its own field or it
    // would silently rewrite the marketplace comparison too.
    var oop = o.employerOop != null ? o.employerOop
            : o.oop != null ? o.oop
            : (tier === 'single' ? OOP.employerSingle
               : Math.max(OOP.employerFamilyFloor, OOP.employerPerPerson * o.size));
    var tax = medicareTax(o.income, o.size > 1 ? 'joint' : 'single');
    return {
      worker: worker, employer: employer, oop: oop, medicareTax: tax,
      total: worker + employer + oop + tax,
      visible: worker + tax,          // what a paystub actually shows
      invisible: employer + oop,      // what it never shows
      basis: { premium: 'survey', worker: 'survey', oop: 'modeled', medicareTax: 'statutory' }
    };
  }

  // What a benchmark silver plan costs, and who pays which part of it.
  function marketplaceCost(o) {
    var area = BENCHMARK[o.area];
    if (!area) return null;
    var adults = Math.max(1, o.adults == null ? Math.min(2, o.size) : o.adults);
    var kids = Math.max(0, o.size - adults);
    var benchmark = area.adult * adults + area.child * kids;

    var ratio = fplRatio(o.income, o.size, o.region);
    var pct = applicablePercentage(ratio);
    var expected = pct === null ? benchmark : o.income * pct;
    var subsidy = pct === null ? 0 : Math.max(0, benchmark - expected);
    var net = Math.max(0, benchmark - subsidy);
    var oop = o.oop != null ? o.oop
            : Math.max(OOP.marketplaceFamilyFloor, OOP.marketplacePerPerson * o.size);
    if (o.size === 1) oop = o.oop != null ? o.oop : OOP.marketplaceSingle;
    // The Medicare payroll tax belongs here for the same reason it belongs in
    // employerCost: the household pays it on this route too. Leaving it out made
    // the SAME household's marketplace cost $14,532 in the comparison bars and
    // $15,909 in the waterfall, which builds its own total from routeBreakdown.
    // One page, one household, two numbers -- and the gap ran in the direction
    // that flattered this site's conclusion.
    var tax = medicareTax(o.income, o.size > 1 ? 'joint' : 'single');

    return {
      benchmark: benchmark, applicablePercentage: pct, expectedContribution: expected,
      subsidy: subsidy, net: net, oop: oop, medicareTax: tax,
      household: net + oop + tax,          // what the household bears
      total: benchmark + oop + tax,        // the whole bill, however routed
      fplRatio: ratio,
      overCliff: pct === null,
      chipLikely: kids > 0 && ratio <= area.chipUpTo,
      area: area,
      basis: { benchmark: 'modeled', applicablePercentage: 'statutory', oop: 'modeled', medicareTax: 'statutory' }
    };
  }

  function cobra(o) {
    var e = employerCost(o);
    var annual = (e.worker + e.employer) * COBRA_ADMIN;
    return { annual: annual, monthly: annual / 12, basis: 'statutory' };
  }

  /* --------------------------------------------------------------- universal
   * Only the first of these has a published household-level formula. The others
   * are OUR allocation of a national estimate onto one household — `basis` says
   * so, and the UI must repeat it. See numbers-and-copy-traps.md #7 and #8.
   * ---------------------------------------------------------------------- */

  /* Six models, each one traceable, spanning peer-reviewed-friendly to the most
   * expensive estimate anyone has published. The argument is cemented by
   * SURVIVING the hostile numbers, not by curating friendly ones.
   *
   * Two are published household-level formulas (Sanders Option 1; Galvani/Lancet
   * 2020). The other four are OUR allocation of a published national estimate
   * onto one household — the Blahous convention, stated where it applies:
   *
   *      annual national-spending delta vs current law / 134.79M households
   *
   * (Blahous's own delta is a ten-year figure, so his divides by 10 first.)
   * Flat-per-household is a simplification — real financing would spread it
   * progressively. The deltas also come from different base years and baselines
   * (Blahous 2020s decade, Urban 2020, RAND 2019, CBO 2030): we spread each
   * source's own dollars over one household count rather than false-precision
   * adjust them — stated on the methodology page, not buried.
   */
  var BLAHOUS = {
    altDelta: 3.252e12,   // Blahous alternative scenario, 10-yr increase vs current law
    mainDelta: -2.054e12, // Blahous main scenario, 10-yr decrease vs current law
    years: 10,
    households: 134790000 // Census, 2025
  };
  var BLAHOUS_ADDER = BLAHOUS.altDelta / BLAHOUS.years / BLAHOUS.households;

  /* RAND RR-3106 (Liu & Eibner, 2019): NHE +$68.8B (+1.8%) in 2019 with the plan
   * fully in place — $3,823.1B -> $3,891.9B, Table 1. Models the bill WITH
   * long-term care, payment rates ~109% of Medicare, supply constraints
   * absorbing half of new demand (+9.8% without that constraint). */
  var RAND_ADDER = 68.8e9 / BLAHOUS.households;

  /* CBO Working Paper 2020-08 (Dec 2020), Exhibit 1-1: five illustrative
   * options for 2030. We use Option 5 — the one shaped most like the bill
   * (LTSS covered, no cost sharing) — which RAISES NHE $290B, the least
   * friendly of the five. CBO's four options WITHOUT long-term care all LOWER
   * national spending (-$42B to -$743B). CBO never scored the bill itself. */
  var CBO_ADDER = 290e9 / BLAHOUS.households;

  /* Urban Institute, "From Incremental to Comprehensive" (Oct 2019), Table 13:
   * "Single-Payer Enhanced" raises national health spending $719.7B (+20.6%)
   * in 2020 — the most expensive estimate anyone has published. LTSS, dental,
   * zero cost sharing, all residents covered. */
  var URBAN_ADDER = 719.7e9 / BLAHOUS.households;

  function sandersOne(income, size) {
    var exempt = size > 1 ? 29200 : 14600;
    var premium = 0.04 * Math.max(0, income - exempt);
    var payroll = 0.075 * income;
    return { total: premium + payroll, parts: { premium: premium, payroll: payroll } };
  }

  /* Galvani, Parpia, Foster, Singer & Fitzpatrick, The Lancet 395:524-533
   * (Feb 2020) — the only PEER-REVIEWED estimate in this set, and the second
   * published household-level formula: a 5% household income tax above a
   * $29,000 exemption (the paper's stated threshold, "as stipulated by Sanders
   * and colleagues") plus a 10% employer payroll tax replacing employer
   * premiums (12.29% is the paper's break-even upper bound). The paper leaves
   * ~$507 average out-of-pocket, which — like every model here — we exclude
   * for comparability; the methodology page says so. The single-filer
   * exemption is halved by us, mirroring sandersOne; the paper states only
   * the $29,000 figure. */
  function galvani(income, size) {
    var exempt = size > 1 ? 29000 : 14500;
    var premium = 0.05 * Math.max(0, income - exempt);
    var payroll = 0.10 * income;
    return { total: premium + payroll, parts: { premium: premium, payroll: payroll } };
  }

  function sandersPlus(adderKey, adder) {
    return function (income, size) {
      var s = sandersOne(income, size);
      var parts = { premium: s.parts.premium, payroll: s.parts.payroll };
      parts[adderKey] = adder;
      return { total: s.total + adder, parts: parts };
    };
  }

  /* Ordered friendliest formula to most hostile allocation, so the pill row
   * reads as a spectrum. Chips name the source; notes carry the provenance,
   * friendly and hostile labelled to the same standard. */
  var MODELS = [
    {
      id: 'sanders1',
      chip: 'Sanders \u00b7 Option 1',
      basis: 'published formula',
      note: 'Sen. Bernie Sanders\u2019 office, 2019, from its published list of financing options \u2014 ' +
            'the first of two household-level formulas anyone in this debate has published. A 4% ' +
            'income-based premium above a standard-deduction exemption, plus a 7.5% employer payroll ' +
            'tax replacing what your employer pays now. The list presents these as separate options; ' +
            'pairing them is our doing.',
      compute: sandersOne
    },
    {
      id: 'galvani',
      chip: 'Lancet \u00b7 peer-reviewed',
      basis: 'published formula',
      note: 'Galvani and colleagues, The Lancet, 2020 \u2014 the only peer-reviewed estimate here, ' +
            'and the second published household formula: a 5% income tax above a $29,000 exemption ' +
            'plus a 10% employer payroll tax replacing premiums. The senior author was an unpaid ' +
            'adviser to Sen. Sanders\u2019 office \u2014 we say that for the same reason we label Mercatus ' +
            'Koch-funded. The same team\u2019s 2026 preprint (not peer reviewed) re-ran the model on ' +
            '2024 data and found national spending falling 19.7%.',
      compute: galvani
    },
    {
      id: 'rand',
      chip: 'RAND \u00b7 2019',
      basis: 'published estimate + our allocation',
      note: 'RAND Corporation, 2019 \u2014 nonpartisan, modelling the bill WITH long-term care. It ' +
            'found national health spending rising 1.8%, about $69 billion a year; we spread that ' +
            'across 134.79 million households and add it to the Sanders formula, the same ' +
            'allocation we apply to Blahous. RAND assumed supply constraints absorb half of new ' +
            'demand \u2014 without that assumption its increase is 9.8%.',
      compute: sandersPlus('randGap', RAND_ADDER)
    },
    {
      id: 'cbo5',
      chip: 'CBO \u00b7 bill-like option',
      basis: 'published estimate + our allocation',
      note: 'Congressional Budget Office, 2020 \u2014 five illustrative options; CBO never scored the ' +
            'bill itself. We use the option shaped most like the bill (long-term care covered, no ' +
            'cost sharing), which RAISES national spending $290 billion in 2030 \u2014 the least ' +
            'friendly of the five. CBO\u2019s four options without long-term care all LOWER national ' +
            'spending. The per-household allocation is ours, like Blahous.',
      compute: sandersPlus('cboGap', CBO_ADDER)
    },
    {
      id: 'blahous',
      chip: 'Blahous \u00b7 pessimistic',
      basis: 'published formula + our allocation',
      note: 'Mercatus Center, 2018 \u2014 Koch-funded and written to show single-payer was ' +
            'unaffordable. Blahous modelled two scenarios; his main one has national spending ' +
            'FALLING $2.05 trillion over a decade. We use his other one, where it rises $3.25 ' +
            'trillion, so this site never leans on the friendly reading of an unfriendly study. ' +
            'He published no household figure: we spread that $3.25 trillion evenly across ten ' +
            'years and 134.79 million households (about $2,413 a year) and add it to the Sanders ' +
            'formula. Flat-per-household is a simplification; real financing would be progressive.',
      compute: sandersPlus('blahousGap', BLAHOUS_ADDER)
    },
    {
      id: 'urban',
      chip: 'Urban \u00b7 most expensive',
      basis: 'published estimate + our allocation',
      note: 'Urban Institute, 2019 \u2014 a left-leaning institute\u2019s \u201cSingle-Payer Enhanced\u201d, and ' +
            'the most expensive estimate anyone has published: national spending rising $720 ' +
            'billion a year, covering long-term care, dental, zero cost sharing and every ' +
            'resident. We include it so the range\u2019s top end is the hardest number on offer \u2014 if ' +
            'the argument survives this one, it survives. The per-household allocation is ours, ' +
            'like Blahous.',
      compute: sandersPlus('urbanGap', URBAN_ADDER)
    }
  ];

  function universalCost(modelId, income, size) {
    for (var i = 0; i < MODELS.length; i++) {
      if (MODELS[i].id === modelId) {
        var r = MODELS[i].compute(income, size);
        return { id: MODELS[i].id, chip: MODELS[i].chip, basis: MODELS[i].basis,
                 note: MODELS[i].note, total: r.total, parts: r.parts };
      }
    }
    return null;
  }


  /* ------------------------------------------------------------------ routes
   * Each coverage route hides its cost in a different way, so each gets its own
   * breakdown rather than being forced into the employer shape.
   *
   *   bears:false  the household does NOT bear this dollar (a taxpayer subsidy).
   *                It is still part of the whole bill, so it is drawn hatched.
   *   onPaystub    whether this dollar is visible on a paystub.
   * ---------------------------------------------------------------------- */

  var UNINSURED = { perAdult: 1900, perChild: 850 };

  function routeBreakdown(route, o) {
    var tax = medicareTax(o.income, o.size > 1 ? 'joint' : 'single');
    var adults = Math.max(1, o.adults == null ? Math.min(2, o.size) : o.adults);
    var kids = Math.max(0, o.size - adults);
    var parts, note;

    if (route === 'marketplace') {
      var m = marketplaceCost(o);
      parts = [
        { key:'netPremium', tone:1, bears:true,  onPaystub:false,
          label:'Your premium', caption:'What you pay the insurer<br>after any credit', value:m.net },
        { key:'subsidy', tone:2, bears:false, onPaystub:false, ghost:true, hidden:true,
          label:'Premium tax credit', caption:'Paid by taxpayers<br>on your behalf', value:m.subsidy },
        { key:'oop', tone:3, bears:true, onPaystub:false,
          label:'Deductible & out-of-pocket', caption:'Deductible, copays<br>&amp; out-of-pocket', value:m.oop },
        { key:'tax', tone:4, bears:true, onPaystub:true,
          label:'Medicare payroll tax', caption:'Medicare payroll tax<br>(1.45%)', value:tax }
      ];
      note = m.overCliff
        ? 'Over the 400% cliff there is no credit at all, so the whole premium is yours.'
        : 'The credit never touches your bank account, so most people never count it.';
    } else if (route === 'none') {
      var cash = UNINSURED.perAdult * adults + UNINSURED.perChild * kids;
      parts = [
        { key:'cash', tone:1, bears:true, onPaystub:false,
          label:'Care you pay for in cash', caption:'Care you pay for<br>in cash', value:cash },
        { key:'tax', tone:4, bears:true, onPaystub:true,
          label:'Medicare payroll tax', caption:'Medicare payroll tax<br>(1.45%)', value:tax }
      ];
      note = 'Uninsured households spend less because they go without care, not because care is ' +
             'cheaper. And there is no out-of-pocket maximum: nothing caps a bad year.';
    } else {
      var e = employerCost(o);
      parts = [
        { key:'worker', tone:1, bears:true, onPaystub:true,
          label:'Your premium deduction', caption:'Your premium<br>deduction', value:e.worker },
        { key:'employer', tone:2, bears:true, onPaystub:false, hidden:true,
          label:'Your employer&#8217;s share', caption:'Your employer&#8217;s share<br>of the same premium', value:e.employer },
        { key:'oop', tone:3, bears:true, onPaystub:false,
          label:'Deductible & out-of-pocket', caption:'Deductible, copays<br>&amp; out-of-pocket', value:e.oop },
        { key:'tax', tone:4, bears:true, onPaystub:true,
          label:'Medicare payroll tax', caption:'Medicare payroll tax<br>(1.45%)', value:tax }
      ];
      note = 'Your employer\u2019s share is your compensation, spent on a product instead of paid to you.';
    }

    var whole = 0, borne = 0, seen = 0;
    for (var i = 0; i < parts.length; i++) {
      whole += parts[i].value;
      if (parts[i].bears) borne += parts[i].value;
      if (parts[i].onPaystub) seen += parts[i].value;
    }
    return {
      route: route, parts: parts, note: note,
      whole: whole,        // the whole bill, whoever writes the cheque
      borne: borne,        // what this household bears
      onPaystub: seen,     // what a paystub would show
      offPaystub: whole - seen,
      uninsured: route === 'none'
    };
  }


  /* The cliff, as a curve. What a household bears on a benchmark marketplace plan
   * across a range of incomes. Below 400% FPL it rises smoothly with the applicable
   * percentage; at 400% the credit does not taper, it stops — so the series has a
   * genuine discontinuity, and above it the household pays the full premium no
   * matter how little more it earns. This is statute, not a model. */
  function cliffCurve(o, steps) {
    var line = povertyLine(o.size, o.region || 'contiguous');
    var lo = line * 1.5, hi = line * 5.5, n = steps || 120, out = [], i;
    for (i = 0; i <= n; i++) {
      var income = lo + (hi - lo) * (i / n);
      var m = marketplaceCost({ income: income, size: o.size, adults: o.adults,
                                area: o.area, region: o.region || 'contiguous' });
      out.push({ income: income, ratio: income / line,
                 household: m.household, subsidy: m.subsidy, overCliff: m.overCliff });
    }
    return { points: out, cliffIncome: line * CLIFF, povertyLine: line };
  }

  // The size of the drop at the boundary: one dollar of income, this many dollars.
  function cliffDrop(o) {
    var line = povertyLine(o.size, o.region || 'contiguous');
    var at = line * CLIFF;
    var under = marketplaceCost({ income: at - 1, size: o.size, adults: o.adults,
                                  area: o.area, region: o.region || 'contiguous' });
    var over = marketplaceCost({ income: at + 1, size: o.size, adults: o.adults,
                                 area: o.area, region: o.region || 'contiguous' });
    return { income: at, under: under.household, over: over.household,
             drop: over.household - under.household, lostCredit: under.subsidy };
  }

  /* ------------------------------------------------------------- the bundle */

  // The route the household is actually ON decides what universal coverage would
  // save it. Pinning this to the employer route told an uninsured household it
  // would keep $22,414 a year when the same page had just said it spends $6,878 --
  // it would in fact pay $2,879 MORE. Pass `route` to get the honest figure.
  function savingsFor(route, o) {
    var uni = universalCost(o.model || 'sanders1', o.income, o.size);
    var borne = routeBreakdown(route || 'employer', o).borne;
    return { borne: borne, universal: uni.total, delta: borne - uni.total };
  }

  function summary(o) {
    var opts = {
      income: o.income, size: o.size, adults: o.adults,
      area: o.area, region: o.region || 'contiguous',
      // The premium overrides must ride along: summary() feeds the sticky bar,
      // the comparison bars and COBRA, while routeBreakdown() is called with the
      // caller's own opts and feeds the waterfall. Dropping these here made the
      // two halves of the page disagree the moment a user typed their own
      // deduction -- the waterfall moved and everything else silently did not.
      workerPremium: o.workerPremium, totalPremium: o.totalPremium, employerOop: o.employerOop
    };
    var emp = employerCost(opts);
    var mkt = marketplaceCost(opts);
    var uni = universalCost(o.model || 'sanders1', o.income, o.size);
    var all = MODELS.map(function (m) { return m.compute(o.income, o.size).total; });

    return {
      year: YEAR,
      employer: emp,
      marketplace: mkt,
      universal: uni,
      universalRange: { lo: Math.min.apply(null, all), hi: Math.max.apply(null, all) },
      savings: emp.total - uni.total,          // employer route; see savingsFor()
      decade: (emp.total - uni.total) * 10,
      cobra: cobra(opts),
      fpl: { line: povertyLine(o.size, opts.region), ratio: fplRatio(o.income, o.size, opts.region) },
      replacedByUniversal: emp.total - emp.medicareTax   // the payroll tax is not a premium
    };
  }

  return {
    YEAR: YEAR, FPL: FPL, APPLICABLE: APPLICABLE, CLIFF: CLIFF,
    EMPLOYER: EMPLOYER, BENCHMARK: BENCHMARK, MODELS: MODELS,
    povertyLine: povertyLine, fplRatio: fplRatio,
    applicablePercentage: applicablePercentage, medicareTax: medicareTax,
    employerCost: employerCost, marketplaceCost: marketplaceCost,
    routeBreakdown: routeBreakdown, UNINSURED: UNINSURED,
    cliffCurve: cliffCurve, cliffDrop: cliffDrop,
    BLAHOUS: BLAHOUS, BLAHOUS_ADDER: BLAHOUS_ADDER,
    RAND_ADDER: RAND_ADDER, CBO_ADDER: CBO_ADDER, URBAN_ADDER: URBAN_ADDER,
    universalCost: universalCost, cobra: cobra, summary: summary, savingsFor: savingsFor
  };
}));
