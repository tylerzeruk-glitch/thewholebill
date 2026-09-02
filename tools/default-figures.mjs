// The figures the default household paints, as the page's static placeholders.
//
// Before JavaScript runs (and for crawlers, reader mode, the share unfurl) the
// HTML shows hardcoded figures. They drifted: $8,278 in the markup against the
// $8,228 the code painted a second later, two numbers for one household on one
// page. build.sh now runs this and writes each figure into its data-fig
// element, so the placeholders are generated from the same arithmetic as the
// live page and cannot drift again. The default household is read from
// src/page.html's own `var state = {...}` so there is one source for it.
//
//   node tools/default-figures.mjs      prints {"emp.total":"$32,171",...}
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const W = require('../src/calc.js');
const B = require('../src/benchmarks.js');
W.useBenchmarks(B);

const page = readFileSync(new URL('../src/page.html', import.meta.url), 'utf8');
const m = page.match(/\n  var state = (\{[\s\S]*?\});\n/);
if (!m) throw new Error('default-figures: could not find `var state = {...}` in src/page.html');
const state = new Function('return ' + m[1])();
const adults = state.ages.filter(a => a >= 21).length;
const opts = { income: state.income, size: state.size, adults, ages: state.ages,
               bkey: state.bkey, model: state.model };

const S = W.summary(opts);
if (!S.marketplace) throw new Error('default-figures: no benchmark entry for the default key ' + state.bkey);
const R = W.routeBreakdown(state.route, opts);
const sav = W.savingsFor(state.route, opts);
const cliff = W.cliffDrop({ size: state.size, adults, ages: state.ages, bkey: state.bkey });
const e = S.employer, mk = S.marketplace, u = S.universal;

// Mirrors figures() in the page script; the suite asserts the two agree by
// comparing the static text with the first paint.
const F = {
  'emp.worker': e.worker, 'emp.employer': e.employer, 'emp.oop': e.oop,
  'emp.tax': e.medicareTax, 'emp.total': e.total,
  'emp.visible': e.visible, 'emp.invisible': e.invisible,
  'emp.cash': e.worker + e.oop, 'emp.replaced': S.replacedByUniversal,
  'mkt.total': mk.total, 'mkt.household': mk.household, 'mkt.subsidy': mk.subsidy,
  'mkt.benchmark': mk.benchmark,
  'uni.total': u.total, 'uni.savings': Math.abs(sav.delta), 'uni.decade': Math.abs(sav.delta) * 10,
  'uni.rangeLo': S.universalRange.lo, 'uni.rangeHi': S.universalRange.hi,
  'cobra.annual': S.cobra.annual, 'cliff.drop': cliff ? cliff.drop : null,
  'route.whole': R.whole, 'route.borne': R.borne,
  'route.replaced': R.borne - ((R.parts.find(p => p.key === 'tax') || { value: 0 }).value),
  'route.onPaystub': R.onPaystub, 'route.offPaystub': R.offPaystub
};
const money = n => '$' + Math.round(n).toLocaleString('en-US');
const out = {};
for (const k in F) if (F[k] != null) out[k] = money(F[k]);   // annual: the default unit is the year
process.stdout.write(JSON.stringify(out, null, 1) + '\n');
