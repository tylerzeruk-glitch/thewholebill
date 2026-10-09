/* The Whole Bill — one suite, replaces 24 ad-hoc scripts.
 *   node test.mjs            run everything
 *   node test.mjs cliff      run checks whose name contains "cliff"
 */
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
const URL = pathToFileURL(resolve(HERE, '../dist/index.html')).href;
const only = process.argv[2];
let pass = 0, fail = 0;
const checks = [];
const test = (name, fn) => checks.push({ name, fn });
const ok = (name, cond, detail='') => {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}${detail?'  '+detail:''}`); }
  else { fail++; console.log(`  \x1b[31m✗\x1b[0m ${name}  ${detail}`); }
};

// doc picks which built document loads: the calculator by default, the
// artifact build (which lives OUTSIDE dist so it never deploys) for
// hash-router coverage, /methodology for its own page.
const page = async (browser, w, h, mobile=false, doc='index.html') => {
  // reducedMotion: the suite measures settled values and geometry, not animation frames.
  // The motion itself has its own test, which opts back in.
  const p = await browser.newPage({ viewport:{width:w,height:h}, deviceScaleFactor:1, isMobile:mobile, hasTouch:mobile, reducedMotion:'reduce' });
  p.on('pageerror', e => ok('no page errors', false, e.message));
  p.on('console', m => { if (m.type()==='error' && !/TUNNEL|ERR_|net::/.test(m.text())) ok('no console errors', false, m.text()); });
  const base = doc === 'artifact.html' ? '../preview/' : '../dist/';
  await p.goto(pathToFileURL(resolve(HERE, base + doc)).href); await p.waitForTimeout(1200);
  return p;
};
// The age boxes: the stepper sets the count, then each box takes its age.
const setAges = async (p, ages) => {
  for (let i = 0; i < 8; i++) { if ((await p.locator('#agesBoxes input').count()) <= ages.length) break; await p.locator('#sizeDown').click(); }
  for (let i = 0; i < 8; i++) { if ((await p.locator('#agesBoxes input').count()) >= ages.length) break; await p.locator('#sizeUp').click(); }
  for (let i = 0; i < ages.length; i++) await p.locator('#agesBoxes input').nth(i).fill(String(ages[i]));
  await p.locator('#agesBoxes input').last().blur();
  await p.waitForTimeout(200);
};
const setIncome = async (p, v) => { await p.locator('#income').fill(String(v)); await p.locator('#income').dispatchEvent('input'); await p.waitForTimeout(120); };

/* The benchmark table is generated data, so the suite re-verifies the
 * guarantees the pipeline asserted when it was built: real coverage, tier
 * shapes, published ratios, and that every ZIP resolves to a county entry
 * that actually exists. If a regeneration breaks any of this, tests fail
 * before the site ever ships it. */
test('benchmarks: the generated county table holds its shape', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const B = require('../src/benchmarks.js');
  ok('plan year 2026', B.planYear === 2026);
  const nCo = Object.keys(B.counties).length;
  ok('a nationwide county table', nCo > 3200, nCo + ' entries');
  let nZip = 0;
  for (const m of Object.values(B.zip)) nZip += Object.keys(m).length;
  ok('a nationwide ZIP table', nZip > 40000, nZip + ' ZIPs');

  // Hartford: the launch metro, an age-rated county
  const hart = B.counties['09003'];
  ok('Hartford is rating area 2', hart && hart[1] === 2, JSON.stringify(hart));
  ok('Hartford SLCSP is a sane monthly premium', hart[0] > 30000 && hart[0] < 120000, '$' + (hart[0] / 100).toFixed(2));

  // NY and VT rate by family tier; their published tier ratios are law
  const ny = B.counties['36061'][0], vt = B.counties['50007'][0];
  ok('Manhattan prices by family tier', Array.isArray(ny) && ny.length === 8);
  ok('NY couple tier is 2x individual', Math.abs(ny[1] / ny[0] - 2.0) < 0.001, (ny[1] / ny[0]).toFixed(3));
  ok('NY parent+children tier is 1.7x', Math.abs(ny[2] / ny[0] - 1.7) < 0.001, (ny[2] / ny[0]).toFixed(3));
  ok('NY family tier is 2.85x', Math.abs(ny[5] / ny[0] - 2.85) < 0.001, (ny[5] / ny[0]).toFixed(3));
  ok('VT parent+children tier is 1.93x', Math.abs(vt[2] / vt[0] - 1.93) < 0.001, (vt[2] / vt[0]).toFixed(3));

  // age curves: the federal default anchors, and Utah's own curve
  const fed = B.curves[B.states.FL.curve];
  ok('federal curve: age 21 is the base', fed[21] === 1000);
  ok('federal curve: 3:1 at 64', fed[64] === 3000);
  ok('federal curve: 0.765 child factor', fed[0] === 765);
  const ut = B.curves[B.states.UT.curve];
  ok('Utah has its own curve', B.states.UT.curve !== B.states.FL.curve && Math.abs(ut[40] - 1479) <= 3, ut[40]);
  ok('AL and MS share the 0.635 child factor', B.curves[B.states.AL.curve][0] === 635 && B.states.MS.curve === B.states.AL.curve);
  ok('tier states carry no curve', B.states.NY.tiers && B.states.VT.tiers && B.states.NY.curve === null);

  // every ZIP value must resolve to a county entry that exists
  const zip3ra = B.zip3ra;
  let bad = 0, asks = 0, checked = 0;
  for (const [p3, m] of Object.entries(B.zip)) {
    for (const [suf, v] of Object.entries(m)) {
      checked++;
      const cands = Array.isArray(v) ? v : [v];
      if (Array.isArray(v)) asks++;
      for (const c of cands) {
        if (c[0] === '!') { if (!B.counties[c.slice(1)]) bad++; continue; }
        let key = c;
        if (c.slice(0, 2) === '02') key = c + '|' + zip3ra.AK[p3];
        else if (c.slice(0, 2) === '25') key = c + '|' + zip3ra.MA[p3];
        else if (c === '06037') key = c + '|' + zip3ra.LA[p3];
        if (!B.counties[key]) bad++;
      }
    }
  }
  ok('every ZIP resolves to a real county entry', bad === 0, bad + ' of ' + checked + ' broken');
  ok('split ZIPs ask, and they are a minority', asks > 3000 && asks < checked * 0.2, asks + ' asks');

  // the five original metros still resolve
  for (const [zip, fips] of [['06106', '09003'], ['75201', '48113'], ['33125', null], ['19103', '42101']]) {
    const v = B.zip[zip.slice(0, 3)][zip.slice(3)];
    ok('metro ZIP ' + zip + ' is covered', v != null, JSON.stringify(v));
    if (fips) ok('  and lands on ' + fips, v === fips || (Array.isArray(v) && v.includes(fips)), JSON.stringify(v));
  }
});

test('calc: loads and computes in node, outside any browser', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const W = require('../src/calc.js');
  const B = require('../src/benchmarks.js');
  W.useBenchmarks(B);
  ok('calc.js loads in node', typeof W.summary === 'function', Object.keys(W).length + ' exports');
  const s = W.summary({ income:95000, size:4, ages:[41,39,12,9], bkey:'09003', model:'sanders1' });
  ok('poverty line for a household of 4', Math.round(s.fpl.line) === 32150, `$${Math.round(s.fpl.line)}`);
  ok('employer total is the sum of its parts',
     Math.abs(s.employer.total - (s.employer.worker + s.employer.employer + s.employer.oop + s.employer.medicareTax)) < 0.01);
  ok('exactly 400% still qualifies ("does not exceed"), at the top band\'s 9.96%', W.applicablePercentage(4.0) === 0.0996, String(W.applicablePercentage(4.0)));
  // the curve must climb to the cliff and jump, never dip first: the sample
  // that lands exactly on 400% once fell through every band to 2.10%
  const curve = W.cliffCurve({ size:4, adults:2, ages:[41,39,12,9], bkey:'48113' }, 200).points;
  let dips = 0;
  for (let i = 1; i < curve.length; i++) if (curve[i].ratio <= 4.0 && curve[i].household < curve[i - 1].household - 1) dips++;
  ok('the cliff curve never falls before the cliff', dips === 0, dips + ' dips');
  const atLine = curve.find(q => Math.abs(q.ratio - 4.0) < 1e-9);
  ok('the sample on the 400% line is priced like its neighbour under it', !atLine || Math.abs(atLine.household - curve[curve.indexOf(atLine) - 1].household) < 300,
     atLine ? `$${Math.round(atLine.household)} vs $${Math.round(curve[curve.indexOf(atLine) - 1].household)}` : 'no sample on the line');
  ok('a hair over the cliff has no credit', W.applicablePercentage(4.0001) === null);
  // the floor: §36B(c)(1)(A) below 100% FPL, §36B(c)(2)(B) Medicaid-eligible
  const gap = W.marketplaceCost({ income:30000, size:4, ages:[40,40,10,8], bkey:'48113' });   // TX, 93%
  ok('below the poverty line there is no credit (TX, 93%)', gap.belowFloor && gap.noCredit && gap.subsidy === 0
     && gap.applicablePercentage === null && !gap.overCliff, `$${Math.round(gap.subsidy)} subsidy`);
  ok('the household then bears the full benchmark', Math.abs(gap.net - gap.benchmark) < 0.01);
  const txLow = W.marketplaceCost({ income:16000, size:1, ages:[40], bkey:'48113' });          // TX, 102%
  ok('just over 100% in a non-expansion state gets the credit', !txLow.noCredit && txLow.subsidy > 0);
  const ctMed = W.marketplaceCost({ income:20000, size:1, ages:[40], bkey:'09003' });          // CT, 128%
  ok('under 138% in an expansion state is Medicaid, no credit', ctMed.medicaidLikely && ctMed.noCredit && ctMed.subsidy === 0
     && !ctMed.belowFloor);
  const ctMkt = W.marketplaceCost({ income:22000, size:1, ages:[40], bkey:'09003' });          // CT, 141%
  ok('over 138% in an expansion state gets the credit', !ctMkt.noCredit && ctMkt.subsidy > 0);
  const dc = W.marketplaceCost({ income:30000, size:1, ages:[40], bkey:'11001' });             // DC, 192%
  ok('DC covers adults to 215%, so 192% is Medicaid there', dc.medicaidLikely && dc.medicaidCeiling === 2.15);
  const dcMkt = W.marketplaceCost({ income:34000, size:1, ages:[40], bkey:'11001' });          // DC, 217%
  ok('over 215% in DC gets the credit', !dcMkt.noCredit && dcMkt.subsidy > 0);
  const d = W.cliffDrop({ size:4, ages:[41,39,12,9], bkey:'09003' });
  ok('cliff drop equals the credit lost', Math.abs(d.drop - d.lostCredit) < 1,
     `$${Math.round(d.drop)} at $${Math.round(d.income)}`);
  // the benchmark is the county rate times the state curve, per member,
  // and the members are priced at their real ages
  const bp = W.benchmarkPremium('09003', [41, 39, 12, 9]);
  const c = B.curves[B.states.CT.curve], base = B.counties['09003'][0] / 100;
  const manual = base * (c[41] + c[39] + c[12] + c[9]) / 1000 * 12;
  ok('benchmark is per-member age-rated arithmetic', Math.abs(bp.annual - manual) < 0.01,
     '$' + Math.round(bp.annual) + ' a year');
  ok('an older household pays more', W.benchmarkPremium('09003', [60, 58]).annual > W.benchmarkPremium('09003', [25, 24]).annual);
  // the ACA three-child cap: a fifth child adds nothing
  const four = W.benchmarkPremium('09003', [40, 40, 10, 9, 8]).annual;
  const five = W.benchmarkPremium('09003', [40, 40, 10, 9, 8, 7]).annual;
  ok('only the three oldest children are charged', Math.abs(four - five) < 0.01);
  // tier states: age changes nothing, family shape is everything
  const nyA = W.benchmarkPremium('36061', [30, 29, 5]).annual;
  const nyB = W.benchmarkPremium('36061', [60, 59, 15]).annual;
  ok('NY prices by tier, not age', Math.abs(nyA - nyB) < 0.01, '$' + Math.round(nyA));
  // Alaska ZIPs price at Alaska FPL
  const ak = W.zipResolve('99501');
  ok('Anchorage resolves through its ZIP3 rating area', ak.st === 'covered' && ak.key === '02020|1', JSON.stringify(ak.key));
  const akSum = W.summary({ income:95000, size:4, ages:[41,39,12,9], bkey:'02020|1', model:'sanders1' });
  ok('an Alaska household uses the Alaska poverty line', Math.round(akSum.fpl.line) === 40190, `$${Math.round(akSum.fpl.line)}`);
});

test('layout: no horizontal overflow', async b => {
  for (const [w,h,m] of [[1440,900,false],[900,900,false],[430,932,true],[390,844,true],[360,780,true]]) {
    const p = await page(b,w,h,m);
    const doc = await p.evaluate(()=>document.documentElement.scrollWidth);
    ok(`${w}px page width`, doc <= w, `${doc} vs ${w}`);
    await p.close();
  }
});

/* Overflow is not the same as a gutter. Content can sit flush against the viewport
 * edge without ever exceeding it, so the check above passes while every section runs
 * edge-to-edge -- which is exactly what a `padding` shorthand on .sec did, silently
 * resetting .wrap's padding-left/right to 0 at every width below ~1250px. */
test('layout: every section keeps its gutter', async b => {
  const MIN = 20;   // --pad floors at 24px; allow a little for sub-pixel and borders
  for (const [w,h,m] of [[1440,900,false],[1280,900,false],[1024,900,false],[768,1024,false],[430,932,true],[360,780,true]]) {
    const p = await page(b,w,h,m);
    const bad = await p.evaluate(min => {
      const vw = innerWidth, out = [];
      document.querySelectorAll('body *').forEach(e => {
        if (e.closest('[hidden]')) return;
        const cs = getComputedStyle(e);
        if (cs.position === 'fixed' || cs.overflowX === 'auto' || cs.overflowX === 'scroll') return;
        const hasText = [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
        if (!hasText) return;
        const r = e.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        const gap = Math.min(r.left, vw - r.right);
        if (gap < min) out.push(`${(typeof e.className==='string'&&e.className.trim())||e.tagName} @${gap.toFixed(0)}px "${(e.textContent||'').trim().slice(0,20)}"`);
      });
      return [...new Set(out)];
    }, MIN);
    ok(`${w}px: text clears the edge by ${MIN}px`, bad.length === 0, bad.slice(0,3).join(' | '));
    await p.close();
  }
});

/* The narrative's two bars are a comparison, so their geometry has to carry the
 * true ratio in BOTH dimensions. They previously did neither: unequal figure
 * widths left the tracks 529px and 483px, so length read 3.56x against a true
 * 3.91x, while heights of 52px and 64px made area read 4.38x. Understated one
 * way, overstated the other. */
test('narrative: the two bars encode their values truthfully', async b => {
  for (const [w,h,m] of [[1440,900,false],[900,900,false],[390,844,true]]) {
    const p = await page(b,w,h,m);
    const r = await p.evaluate(()=>{
      const rows=[...document.querySelectorAll('.cmp .cmp-row')].map(row=>{
        const t=row.querySelector('.track'), f=[...t.children], tb=t.getBoundingClientRect();
        return { trackW:tb.width, h:Math.max(...f.map(x=>x.getBoundingClientRect().height)),
                 filled:f.reduce((a,x)=>a+x.getBoundingClientRect().width,0),
                 value:+row.querySelector('.num').textContent.replace(/[^0-9]/g,'') };
      });
      const [a,b2]=rows;
      return { trackDelta:Math.abs(a.trackW-b2.trackW), heightDelta:Math.abs(a.h-b2.h),
               trueRatio:b2.value/a.value, lengthRatio:b2.filled/a.filled };
    });
    ok(`${w}px: both bars share one height`, r.heightDelta < 0.5, `Δ${r.heightDelta.toFixed(1)}px`);
    ok(`${w}px: both bars share one baseline`, r.trackDelta < 0.5, `Δ${r.trackDelta.toFixed(1)}px`);
    ok(`${w}px: bar length matches the value ratio`, Math.abs(r.lengthRatio - r.trueRatio) < 0.05,
       `drawn ${r.lengthRatio.toFixed(2)}x vs true ${r.trueRatio.toFixed(2)}x`);
    await p.close();
  }
});

/* The one-row bar has very little slack between its 900px breakpoint and ~1100px.
 * It fit on macOS and overflowed on Linux, where the same labels set a few pixels
 * wider -- so this asserts the row absorbs the squeeze at every width rather than
 * pushing the Year/Month switch out through overflow-x. */
/* Each figure is parked at the end of its own bar rather than in a right-hand
 * column, so the short bar's number is not stranded across the page from the mark
 * it labels. The number is positioned by percentage against the same box the fill
 * uses, so this asserts the two edges actually coincide at every width. */
test('narrative: each figure sits at the end of its own bar', async b => {
  for (const [w,h,m] of [[1440,900,false],[900,900,false],[390,844,true]]) {
    const p = await page(b,w,h,m);
    const r = await p.evaluate(()=>[...document.querySelectorAll('.cmp .cmp-row')].map(row=>{
      const fills=[...row.querySelector('.track').children];
      const end=Math.max(...fills.map(f=>f.getBoundingClientRect().right));
      const n=row.querySelector('.num').getBoundingClientRect();
      return { gap:n.left-end, right:n.right };
    }));
    const [a,b2]=r;
    ok(`${w}px: small figure follows its bar`, Math.abs(a.gap-16) < 1, `${a.gap.toFixed(1)}px from the bar end`);
    ok(`${w}px: total figure follows its bar`, Math.abs(b2.gap-16) < 1, `${b2.gap.toFixed(1)}px from the bar end`);
    await p.close();
  }
});

/* Notes take the width of what they annotate. These carried a 56ch measure cap
 * for a day (the readability pass); a narrow ragged column under a full-width
 * chart read as a layout accident, and one-to-three-line captions do not pay
 * the long-measure penalty paragraphs do. Deliberate reversal, 2026-08-31 --
 * this asserts the six notes from that comment round actually span their
 * containers, so a reintroduced cap fails loudly rather than quietly. */
test('readability: chart notes span the width of what they annotate', async b => {
  for (const w of [1440,1100]) {
    const p = await page(b,w,900);
    const bad = await p.evaluate(()=>
      ['panelNote','wfNote','cmpNote','cliffNote','livesNote','sec2Note']
        .map(id=>{ const e=document.getElementById(id);
          if (!e || !e.offsetHeight) return {id, w:0, cw:0, skip:!e};
          const cs=getComputedStyle(e.parentElement);
          const cw=e.parentElement.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight);
          return {id, w:e.getBoundingClientRect().width, cw}; })
        .filter(x=>x.skip || x.w < x.cw*0.55));
    ok(`${w}px: every chart note spans its container`, bad.length === 0,
       bad.map(x=>`${x.id} ${Math.round(x.w)}/${Math.round(x.cw)}px`).join(', '));
    await p.close();
  }
});

/* The tally figures sit level with the bottom of their own descriptions. With
 * first-baseline alignment the figure hung level with the first line while a
 * two-line description ran on below it. */
test('lives: tally figures align with the bottom of their text', async b => {
  const p = await page(b,1440,900);
  const bad = await p.evaluate(()=>{
    const t=document.querySelector('.tally');
    const vs=[...t.querySelectorAll('.v')], ds=[...t.querySelectorAll('.d')];
    return vs.map((v,i)=>{
      const d=+(ds[i].getBoundingClientRect().bottom - v.getBoundingClientRect().bottom).toFixed(1);
      return {i, d};
    }).filter(x=>Math.abs(x.d) > 2);
  });
  ok('each figure bottom-aligns with its description', bad.length === 0,
     bad.map(x=>`row ${x.i} Δ${x.d}px`).join(', '));
  await p.close();
});

/* A heading and its one supporting line are meant to sit on the same bottom line.
 * align-self:end aligned their BOXES, which is not the same thing: a 56px heading
 * at line-height 1.05 carries much less space below its last baseline than a 15px
 * note at 1.65, so the boxes matched to 0.0px while the text sat 9px apart. This
 * measures the baselines, using a zero-height inline-block whose bottom edge sits
 * on the baseline -- getBoundingClientRect gives the line box, which is the very
 * thing that was misleading here. */
test('splits: heading and supporting line share a baseline', async b => {
  for (const w of [1101,1250,1440,1920]) {
    const p = await page(b,w,900);
    const bad = await p.evaluate(()=>{
      const baseline = el => { const s=document.createElement('span');
        s.style.cssText='display:inline-block;width:0;height:0;overflow:hidden';
        el.appendChild(s); const y=s.getBoundingClientRect().bottom; s.remove(); return y; };
      return [...document.querySelectorAll('.split.tie')].map(sp=>{
        // only meaningful while the split is actually two columns
        if (getComputedStyle(sp).gridTemplateColumns.split(' ').length < 2) return null;
        const k=[...sp.children], h=k[0].querySelector('h1,h2');
        if (!h || k.length < 2) return null;
        const eb=(sp.closest('section')?.querySelector('.eyebrow')||{}).textContent||'';
        return { sec:eb.trim().slice(0,22), d:+(baseline(k[1])-baseline(h)).toFixed(1) };
      }).filter(x=>x && Math.abs(x.d) > 1);
    });
    ok(`${w}px: every heading sits on its note's baseline`, bad.length === 0,
       bad.map(x=>`${x.sec} Δ${x.d}px`).join(', '));
    await p.close();
  }
});

/* The dateline's amber rule and the area-picker buttons opposite it are both real
 * edges, so they align edge to edge. A 6px margin used to hold them apart, which
 * read as a mistake rather than a decision. Only meaningful while the hero is two
 * columns -- below 1101px the dateline stacks underneath. */
test('hero: the dateline ends on the same line as the controls', async b => {
  for (const w of [1101,1250,1440,1920]) {
    const p = await page(b,w,1000);
    const d = await p.evaluate(()=>{
      const hero=document.querySelector('.hero-inner');
      if (getComputedStyle(hero).gridTemplateColumns.split(' ').length < 2) return null;
      const bot=e=>document.querySelector(e).getBoundingClientRect().bottom;
      return +(bot('.dateline') - bot('#areapick')).toFixed(1);
    });
    if (d === null) continue;
    ok(`${w}px: dateline bottom meets the controls`, Math.abs(d) < 0.5, `Δ${d}px`);
    await p.close();
  }
});

/* Three bars compared by length, so each one's SOLID length has to carry the
 * figure printed beside it. This asserts the solid part only.
 * The marketplace row also carries a hatched subsidy on the end of it, drawn at
 * full height by deliberate choice -- its texture and its own caption line carry
 * the distinction -- so that row's OVERALL length is longer than its figure.
 * Do not extend this to total width; the hatch is not part of the number. */
test('comparison: every bar draws the figure printed beside it', async b => {
  for (const [w,h] of [[1440,900],[1200,900]]) {
    const p = await page(b,w,h);
    // sanders(0) and lancet(1) are formulas; cbo5(3) and urban(5) carry an
    // allocation band -- one of each shape, both widths. 500ms, not 250: when a
    // model switch keeps the same band composition the nodes survive and their
    // widths TRANSITION (350ms) -- measuring mid-animation reads a stale length.
    for (const model of [0,1,3,5]) {
      await p.locator('#pills button').nth(model).click();
      await p.waitForTimeout(500);
      const r = await p.evaluate(()=>{
        const n=e=>+document.querySelector(e).textContent.replace(/[^0-9]/g,'');
        // solid segments only: a hatched one is money the household does not bear
        const solid=id=>[...document.querySelectorAll('#'+id+' > div')]
          .filter(e=>!e.classList.contains('bar-ghost'))
          .reduce((a,e)=>a+e.getBoundingClientRect().width,0);
        const all=id=>[...document.querySelectorAll('#'+id+' > div')]
          .reduce((a,e)=>a+e.getBoundingClientRect().width,0);
        // the employer bar is drawn from its own total, so it sets the scale
        const scale = n('[data-fig="emp.total"]') / all('empBar');
        return [
          { k:'employer',    drawn: solid('empBar')*scale, said:n('[data-fig="emp.total"]') },
          { k:'marketplace', drawn: solid('mktBar')*scale, said:n('[data-fig="mkt.household"]') },
          { k:'universal',   drawn: solid('uBar')*scale,   said:n('#uVal') },
        ].map(x=>({...x, err: Math.abs(x.drawn-x.said)/x.said}));
      });
      for (const x of r)
        ok(`${w}px m${model}: ${x.k} bar length = its figure`, x.err < 0.005,
           `drawn $${Math.round(x.drawn).toLocaleString()} vs $${x.said.toLocaleString()}`);
    }
    await p.close();
  }
});

/* Every bar is now built from the same parts the waterfall uses, so a segment that
 * exists in one section has to exist in the other. This is the guard against the
 * two drifting apart again -- they already had, by the Medicare payroll tax. */
test('comparison: bars are built from the route breakdown', async b => {
  const p = await page(b,1440,900);
  const shape = await p.evaluate(()=>{
    const keys=id=>[...document.querySelectorAll('#'+id+' > div')].map(e=>e.dataset.k);
    const lines=id=>document.querySelector('#'+id).innerText.trim().split('\n').filter(Boolean).length;
    return { emp:keys('empBar'), mkt:keys('mktBar'), uni:keys('uBar'),
             empK:lines('empSub'), mktK:lines('mktSub'), uniK:lines('uniSub') };
  });
  ok('employer bar has its four components',
     shape.emp.join() === 'worker,employer,oop,tax', shape.emp.join());
  ok('marketplace bar puts the subsidy last, after what you bear',
     shape.mkt.join() === 'netPremium,oop,tax,subsidy', shape.mkt.join());
  ok('universal bar carries its financing components',
     shape.uni.join() === 'premium,payroll', shape.uni.join());
  ok('every segment is named in its key',
     shape.empK === shape.emp.length && shape.mktK === shape.mkt.length && shape.uniK === shape.uni.length,
     `${shape.empK}/${shape.emp.length}, ${shape.mktK}/${shape.mkt.length}, ${shape.uniK}/${shape.uni.length}`);
  await p.close();
});

/* 73% of the universal figure is the employer payroll tax -- employer-side money,
 * counted as the household's for the same reason the employer's premium share is
 * counted on the other side. It used to be drawn as one undifferentiated block, so
 * the argument the site is built on was visible for the status quo and invisible
 * for the alternative. The bands must account for the whole figure, or the split
 * is worse than not splitting. */
test('comparison: the universal bar accounts for its whole figure', async b => {
  const p = await page(b,1440,900);
  // two formula models draw two bands; the four allocated models add a third.
  // 500ms wait: same-composition switches transition their widths over 350ms.
  for (const [model,bands] of [[0,2],[1,2],[2,3],[3,3],[4,3],[5,3]]) {
    await p.locator('#pills button').nth(model).click();
    await p.waitForTimeout(500);
    for (const unit of ['y','m']) {
      const r = await p.evaluate(()=>{
        const n=e=>+document.querySelector(e).textContent.replace(/[^0-9]/g,'');
        const empW=[...document.querySelectorAll('#empBar > div')].reduce((a,e)=>a+e.getBoundingClientRect().width,0);
        const scale = n('[data-fig="emp.total"]')/empW;
        const segs=[...document.querySelectorAll('#uBar .bar-fill')];
        const caption=document.querySelector('#uniSub').innerText.trim().split('\n').filter(Boolean);
        return { n:segs.length, said:n('#uVal'), captionLines:caption.length,
                 drawn: segs.reduce((a,e)=>a+e.getBoundingClientRect().width,0)*scale };
      });
      ok(`model ${model} (${unit}): ${bands} bands drawn`, r.n === bands, `${r.n}`);
      ok(`model ${model} (${unit}): bands sum to the figure`,
         Math.abs(r.drawn-r.said)/r.said < 0.005,
         `$${Math.round(r.drawn).toLocaleString()} vs $${r.said.toLocaleString()}`);
      ok(`model ${model} (${unit}): every band is named`, r.captionLines === bands,
         `${r.captionLines} caption lines for ${r.n} bands`);
      if (unit === 'y') { await p.locator('#unit').click(); await p.waitForTimeout(250); }
    }
    await p.locator('#unit').click(); await p.waitForTimeout(250);
  }
  await p.close();
});

/* The ink zone escalates before it turns: the whole bill (02), then the cliff
 * (03, the statute as closing indictment), then the comparison (04, the
 * alternative). The turn is marked in the headline itself: "Another way" wears
 * universal's teal, the same colour that means universal everywhere else. */
test('narrative: the cliff precedes the turn, and the turn wears teal', async b => {
  const p = await page(b,1440,900);
  const r = await p.evaluate(()=>{
    // Visible eyebrows only: slot 03 keeps a hidden route-variant whose eyebrow
    // also says 03, and the methodology view (08) is hidden on the main flow.
    const eyebrows=[...document.querySelectorAll('.eyebrow')]
      .filter(e=>e.offsetParent !== null)
      .map(e=>e.textContent.trim()).filter(t=>/^\d\d/.test(t));
    const cliffY=document.getElementById('cliff').offsetTop;
    const cmpY=document.getElementById('pills').closest('section').offsetTop;
    const em=[...document.querySelectorAll('h2 em')].find(e=>/Another way/.test(e.textContent));
    return { seq: eyebrows.map(t=>t.slice(0,2)).join(','),
             cliffFirst: cliffY < cmpY,
             teal: em ? getComputedStyle(em).color : 'missing' };
  });
  ok('visible sections number 01-07 in page order', r.seq === '01,02,03,04,05,06,07', r.seq);
  // the 08 eyebrow lives on /methodology now; the routing test asserts it
  ok('the cliff sits before the comparison', r.cliffFirst);
  ok('"Another way" wears universal teal', r.teal === 'rgb(63, 181, 174)', r.teal);
  await p.close();
});

/* Slot 03 adapts to the route: the cliff for the marketplace, the cliff
 * reframed for employer readers (whose market it would become), the bad year
 * for the uninsured -- a subsidy cliff means nothing to a household with no
 * subsidy and no premium. The slot is constant so the numbering never gaps,
 * the modeled figure is labelled where it appears, and the statutory
 * ceiling contrast is stated. */
test('slot 03: the cliff for the covered, the bad year for the uninsured', async b => {
  const p = await page(b,1440,900);
  const view = () => p.evaluate(()=>({
    cliff: !document.getElementById('cliffView').hidden,
    bad: !document.getElementById('badYear').hidden,
    intro: document.getElementById('cliffIntro').textContent,
    eyebrows: [...document.querySelectorAll('#cliff .eyebrow')]
      .filter(e=>e.offsetParent !== null).map(e=>e.textContent.trim()) }));

  let r = await view();
  ok('employer: the cliff shows, reframed as the market waiting',
     r.cliff && !r.bad && /market waiting/.test(r.intro), r.intro.slice(0,60));

  await p.locator('#route button[data-r="marketplace"]').click(); await p.waitForTimeout(300);
  r = await view();
  ok('marketplace: the cliff speaks as their own market',
     r.cliff && !r.bad && /^Nothing in this section is modeled/.test(r.intro), r.intro.slice(0,60));

  await p.locator('#route button[data-r="none"]').click(); await p.waitForTimeout(300);
  r = await view();
  ok('uninsured: the bad year replaces the cliff', !r.cliff && r.bad);
  ok('and keeps slot number 03', r.eyebrows.join() === '03 · The bad year', r.eyebrows.join());
  const txt = await p.evaluate(()=>document.getElementById('badYear').innerText);
  ok('the modeled figure is labelled where it appears', /57,000/.test(txt) && /modeled/.test(txt));
  ok('the statutory ceiling contrast is stated', /\$10,600/.test(txt) && /No limit/.test(txt));
  ok('both care-avoidance figures appear, tied to their surveys',
     /three in four/.test(txt) && /38\.6%/.test(txt) && /KFF/.test(txt) && /NHIS/.test(txt));

  await p.close();
  // the bad-year derivation lives on /methodology, its own document now
  const pm = await page(b,1440,900,false,'methodology/index.html');
  ok('methodology carries the derivation and the bankruptcy both-sides rule',
     await pm.evaluate(()=>{
       const t=document.getElementById('methodology').innerText;
       return /What a bad year costs without coverage/i.test(t) && /3\.4/.test(t)
           && /66\.5%/.test(t) && /4% of non-elderly/.test(t);
     }));
  await pm.close();
});

/* Six models, friendliest formula to most expensive allocation. The argument is
 * cemented by SURVIVING the hostile numbers, not by curating friendly ones -- so
 * the spectrum itself is asserted: the low end is the Sanders formula, the high
 * end is the Urban allocation, and every pill swaps the provenance box to its
 * own source. */
test('models: six pills spanning the published spectrum', async b => {
  const p = await page(b,1440,900);
  const pills = await p.evaluate(()=>[...document.querySelectorAll('#pills button')].map(e=>e.textContent));
  ok('six models on offer', pills.length === 6, pills.join(' | '));
  ok('the spectrum is labelled at both ends',
     /Sanders/.test(pills[0]) && /peer-reviewed/.test(pills[1]) && /priciest/.test(pills[5]),
     pills.join(' | '));

  const totals = [], notes = new Set();
  for (let i = 0; i < 6; i++){
    await p.locator('#pills button').nth(i).click(); await p.waitForTimeout(250);
    totals.push(await p.evaluate(()=>+document.querySelector('#uVal').textContent.replace(/[^0-9]/g,'')));
    notes.add(await p.evaluate(()=>document.getElementById('who').textContent));
  }
  ok('every pill carries its own provenance note', notes.size === 6, `${notes.size} distinct`);
  ok('the Sanders formula is the floor for the default household',
     Math.min(...totals) === totals[0], totals.join(', '));
  ok('the Urban allocation is the ceiling',
     Math.max(...totals) === totals[5], totals.join(', '));

  const range = await p.evaluate(()=>({
    lo:+document.querySelector('[data-fig="uni.rangeLo"]').textContent.replace(/[^0-9]/g,''),
    hi:+document.querySelector('[data-fig="uni.rangeHi"]').textContent.replace(/[^0-9]/g,'')}));
  ok('the range strip spans exactly the six models',
     Math.abs(range.lo - Math.min(...totals)) <= 1 && Math.abs(range.hi - Math.max(...totals)) <= 1,
     `$${range.lo}-$${range.hi} vs $${Math.min(...totals)}-$${Math.max(...totals)}`);
  await p.close();
});

/* Uniform pills: a segmented control, not a tag cloud. One row, six equal
 * columns, every label inside its pill -- and below 900px (measured: the
 * longest role line needs ~106px and a 901px viewport gives ~112px per pill)
 * the native select takes over and drives the same state. */
test('models: equal pills in one row, a picker on phones', async b => {
  for (const w of [1440, 1100, 901]) {
    const p = await page(b,w,900);
    const r = await p.evaluate(()=>{
      const bs=[...document.querySelectorAll('#pills button')];
      const ws=bs.map(x=>x.getBoundingClientRect().width);
      return { rows:[...new Set(bs.map(x=>Math.round(x.getBoundingClientRect().top)))].length,
               spread: Math.max(...ws)-Math.min(...ws),
               clipped: bs.filter(x=>[...x.children].some(c=>c.scrollWidth > x.clientWidth-16)).length,
               pick: getComputedStyle(document.getElementById('modelPick')).display };
    });
    ok(`${w}px: six equal pills on one row`, r.rows === 1 && r.spread < 1.5,
       `${r.rows} rows, ${r.spread.toFixed(1)}px spread`);
    ok(`${w}px: every label fits its pill`, r.clipped === 0, `${r.clipped} clipped`);
    ok(`${w}px: no picker at this width`, r.pick === 'none');
    await p.close();
  }
  for (const [w,h,m] of [[900,900,false],[390,844,true]]) {
    const p = await page(b,w,h,m);
    const r = await p.evaluate(()=>({
      pills: getComputedStyle(document.getElementById('pills')).display,
      pick: getComputedStyle(document.getElementById('modelPick')).display,
      options: document.querySelectorAll('#modelPick option').length }));
    ok(`${w}px: the picker replaces the pills`, r.pills === 'none' && r.pick !== 'none' && r.options === 6,
       JSON.stringify(r));
    await p.locator('#modelPick').selectOption('urban');
    await p.waitForTimeout(300);
    ok(`${w}px: the picker drives the model`, await p.evaluate(()=>
       /Urban Institute/.test(document.getElementById('who').textContent)));
    await p.close();
  }
});

/* The savings panel was pinned to the employer route no matter what the household
 * selected. An uninsured household was told it would keep $22,414 a year on the
 * same screen that said it spends $6,878 -- it would in fact pay $2,879 MORE. The
 * uninsured case is the one that matters: the comparison has to be able to come
 * out negative, and say so, or the whole section is advocacy rather than a
 * calculator. */
test('savings: the panel answers for the route you picked', async b => {
  const p = await page(b,1440,900);
  const n = s => +s.replace(/[^0-9]/g,'');
  for (const route of ['employer','marketplace','none']) {
    await p.locator(`#route button[data-r="${route}"]`).click();
    await p.waitForTimeout(300);
    const r = await p.evaluate(()=>{
      const t=e=>document.querySelector(e).textContent.trim();
      return { live:t('[data-fig="route.whole"]'), borne:t('[data-fig="route.borne"]'),
               uni:t('#uVal'), save:t('#save'), decade:t('#decade'), label:t('#saveLbl'),
               neg:document.querySelector('.save').classList.contains('neg') };
    });
    const expected = Math.abs(n(r.borne) - n(r.uni));
    ok(`${route}: saving is |what you bear − universal|`, Math.abs(n(r.save)-expected) <= 1,
       `${r.save} vs $${expected.toLocaleString()}`);
    ok(`${route}: decade is ten times it`, Math.abs(n(r.decade)-n(r.save)*10) <= 10,
       `${r.decade}`);
    const shouldBeNeg = n(r.borne) < n(r.uni);
    ok(`${route}: label matches the direction`, r.neg === shouldBeNeg &&
       /would (keep|pay)/.test(r.label) && (shouldBeNeg ? /pay/ : /keep/).test(r.label),
       `"${r.label}" neg=${r.neg}`);
  }
  await p.close();
});

/* One household, one route, one number. marketplaceCost.household left the
 * Medicare payroll tax out while routeBreakdown put it in, so the same household's
 * marketplace cost read $14,532 in the comparison bars and $15,909 in the
 * waterfall -- and the gap ran in the direction that flattered this site. */
test('figures: the two sections agree on what a route costs', async b => {
  const p = await page(b,1440,900);
  const n = s => +s.replace(/[^0-9]/g,'');
  for (const route of ['employer','marketplace','none']) {
    await p.locator(`#route button[data-r="${route}"]`).click();
    await p.waitForTimeout(300);
    const r = await p.evaluate(()=>{
      const t=e=>document.querySelector(e).textContent.trim();
      const bands=[...document.querySelectorAll('#wf .wcol:not(.wcol-total) .wlab')].map(e=>e.textContent);
      return { whole:t('#wf .wcol-total .wlab'), borne:t('[data-fig="route.borne"]'),
               big:t('[data-fig="route.whole"]'), mkt:t('[data-fig="mkt.household"]'), bands };
    });
    // the waterfall's total column is the whole bill for this route, and it has
    // to be the same number the section's headline figure shows
    ok(`${route}: waterfall total is the route's whole bill`, n(r.whole) > 0 && Math.abs(n(r.whole) - n(r.big)) <= 1,
       `waterfall ${r.whole} vs headline ${r.big}`);
    if (route === 'marketplace')
      ok('marketplace bar matches what the waterfall says the household bears',
         Math.abs(n(r.mkt) - n(r.borne)) <= 1, `bar ${r.mkt} vs borne $${n(r.borne).toLocaleString()}`);
  }
  await p.close();
});

/* The strip's labels name marks at particular points, so above 900px they sit on
 * those points. "today" moved with the route once the panel stopped being pinned
 * to the employer figure, and a label that stays at the right edge while its mark
 * slides to 21% is worse than no label. Below 900px they cannot all fit on their
 * marks -- 13px of overlap at 761px, 57px at 390px -- so they become a legend. */
test('range strip: labels sit clear of each other and of the strip', async b => {
  for (const w of [1920,1440,1100,901,900,760,390,320]) {
    const p = await page(b, w, 900, w < 500);
    for (const route of ['employer','marketplace','none']) {
      await p.locator(`#route button[data-r="${route}"]`).click();
      await p.waitForTimeout(250);
      const r = await p.evaluate(()=>{
        const vis=[...document.querySelectorAll('.rlabels > span')].filter(e=>e.offsetParent!==null);
        const box=document.querySelector('.rlabels').getBoundingClientRect();
        const rs=vis.map(e=>{const b=e.getBoundingClientRect();return [b.left,b.right];});
        let ov=0;
        for(let i=0;i<rs.length;i++) for(let j=i+1;j<rs.length;j++)
          ov=Math.max(ov, Math.min(rs[i][1],rs[j][1])-Math.max(rs[i][0],rs[j][0]));
        return { ov:Math.max(0,ov),
                 out:Math.max(0, box.left-Math.min(...rs.map(x=>x[0])),
                                 Math.max(...rs.map(x=>x[1]))-box.right) };
      });
      ok(`${w}px ${route}: labels do not collide`, r.ov < 0.5, `${r.ov.toFixed(1)}px`);
      ok(`${w}px ${route}: labels stay on the strip`, r.out < 0.5, `${r.out.toFixed(1)}px`);
    }
    await p.close();
  }
});

/* The income field asks for one number that three statutes define differently, so
 * it carries a tooltip saying which one to enter (MAGI-ish, before taxes). The
 * panel is an overlay inside the field: it must actually open, stay inside the
 * viewport, and close from the keyboard. */
test('income tooltip: opens, fits, and closes', async b => {
  for (const [w,h,m] of [[1440,900,false],[390,844,true]]) {
    const p = await page(b,w,h,m);
    await p.locator('#incomeQ').click();
    await p.waitForTimeout(150);
    const r = await p.evaluate(()=>{
      const pop=document.getElementById('incomeQPop'), b=pop.getBoundingClientRect();
      return { hidden:pop.hidden, txt:pop.textContent,
               inX: b.left >= 0 && b.right <= innerWidth,
               expanded: document.getElementById('incomeQ').getAttribute('aria-expanded') };
    });
    ok(`${w}px: tooltip opens`, !r.hidden && r.expanded === 'true');
    // Deliberately plain language: "before taxes" is the one load-bearing fact,
    // and the guess-is-fine line is what lowers the stakes of the question. The
    // MAGI detail lives in the methodology, not here.
    ok(`${w}px: tooltip says before taxes and that a guess is fine`,
       /before taxes/.test(r.txt) && /guess is fine/.test(r.txt));
    ok(`${w}px: tooltip stays inside the viewport`, r.inX);
    await p.keyboard.press('Escape');
    await p.waitForTimeout(100);
    ok(`${w}px: Escape closes it`, await p.evaluate(()=>document.getElementById('incomeQPop').hidden));
    await p.close();
  }
});

/* On a mouse the panel opens on hover, and the 8px gap between button and panel
 * must be crossable: the close is on a short delay, so moving the pointer down
 * into the panel keeps it open rather than yanking it away mid-read. */
test('income tooltip: hover opens and the pointer can reach the panel', async b => {
  const p = await page(b,1440,900);
  await p.locator('#incomeQ').hover();
  await p.waitForTimeout(120);
  ok('hover opens it', await p.evaluate(()=>!document.getElementById('incomeQPop').hidden));
  await p.locator('#incomeQPop').hover();
  await p.waitForTimeout(250);
  ok('pointer inside the panel keeps it open', await p.evaluate(()=>!document.getElementById('incomeQPop').hidden));
  await p.locator('h1, .panel .lbl').first().hover();
  await p.waitForTimeout(300);
  ok('leaving closes it', await p.evaluate(()=>document.getElementById('incomeQPop').hidden));
  await p.close();
});

/* Subsidies are a marketplace mechanism. On the employer route the eligibility box
 * described a premium tax credit for a plan the household is not on. */
test('eligibility box: only where subsidies apply', async b => {
  const p = await page(b,1440,900);
  for (const [route, shown] of [['employer',false],['marketplace',true],['none',true]]) {
    await p.locator(`#route button[data-r="${route}"]`).click();
    await p.waitForTimeout(250);
    const vis = await p.evaluate(()=>{
      const e=document.getElementById('elig');
      return !e.hidden && e.offsetHeight > 0;
    });
    ok(`${route}: box ${shown?'shown':'hidden'}`, vis === shown);
  }
  await p.close();
});

/* The Ages field is wired, coarsely: under 21 is a child (the ACA child-rate
 * boundary), 21+ an adult, 65+ flagged but still priced as an adult. Ages are the
 * source of truth and household size is their count, so the two controls cannot
 * disagree. Age-RATING is deliberately absent until the Stage 2 CMS files. */
test('ages: one box per person, the stepper sets the count', async b => {
  const p = await page(b,1440,900);
  const read = () => p.evaluate(()=>({
    size:document.getElementById('sizeVal').textContent,
    ages:[...document.querySelectorAll('#agesBoxes input')].map(i=>i.value).join(', '),
    words:[...document.querySelectorAll('#agesBoxes .age-k')].map(k=>k.textContent).join(' '),
    whole:+document.querySelector('[data-fig="route.whole"]').textContent.replace(/[^0-9]/g,''),
    note:!document.getElementById('agesNote').hidden, max:!document.getElementById('sizeMax').hidden,
    upOff:document.getElementById('sizeUp').disabled, downOff:document.getElementById('sizeDown').disabled }));
  await p.locator('#route button[data-r="marketplace"]').click();
  await p.waitForTimeout(250);
  const four = await read();
  ok('four boxes for the default household, labelled adult and child', four.ages === '41, 39, 12, 9' && four.words === 'adult adult child child', four.words);
  ok('every box is a numeric keypad field with a per-person name', await p.evaluate(() => [...document.querySelectorAll('#agesBoxes input')].every((i, n) => i.getAttribute('inputmode') === 'numeric' && i.getAttribute('aria-label') === `Age of person ${n + 1} of 4`)));
  await p.locator('#agesBoxes input').nth(2).fill('30'); await p.waitForTimeout(250);   // third person becomes an adult
  const three = await read();
  ok('an extra adult changes the marketplace bill', three.whole > four.whole, `$${four.whole.toLocaleString()} -> $${three.whole.toLocaleString()}`);
  ok('and the word under the box follows', three.words === 'adult adult adult child', three.words);
  await setAges(p, [41, 39]);
  ok('the stepper down removes the last box and the size follows', (await read()).size === '2' && (await read()).ages === '41, 39');
  await p.locator('#sizeUp').click(); await p.waitForTimeout(200);
  const stepped = await read();
  ok('stepping up appends a child of 10 with the default household shape', stepped.ages === '41, 39, 10' && stepped.size === '3', stepped.ages);
  await p.locator('#agesBoxes input').first().fill('70'); await p.waitForTimeout(250);
  ok('65+ raises the Medicare note and the box says so', (await read()).note && /65 or over/.test((await read()).words));
  await p.locator('#agesBoxes input').first().fill('41'); await p.waitForTimeout(250);
  ok('and it clears again', !(await read()).note);
  // junk mid-keystroke must never blank the figures; an empty box restores on blur
  await p.locator('#agesBoxes input').first().fill('x'); await p.waitForTimeout(150);
  const junk = await read();
  ok('a letter is refused and the last good age stays in force', junk.whole > 0 && junk.size === '3', `size ${junk.size}, whole ${junk.whole}`);
  await p.locator('#agesBoxes input').first().fill('125'); await p.locator('#agesBoxes input').first().blur(); await p.waitForTimeout(150);
  ok('an impossible age is restored on blur', (await read()).ages === '41, 39, 10', (await read()).ages);
  await p.locator('#agesBoxes input').first().focus(); await p.keyboard.press('Enter');
  ok('Enter moves to the next box', await p.evaluate(() => document.activeElement === document.querySelectorAll('#agesBoxes input')[1]));
  for (let i = 0; i < 5; i++) { await p.locator('#sizeUp').click(); }   // 3 -> 8; a sixth click would wait on a disabled button
  await p.waitForTimeout(200);
  const eight = await read();
  ok('eight is the cap: plus disables and the note appears', eight.size === '8' && eight.upOff && eight.max && !eight.downOff);
  await p.close();
  // phone: eight boxes wrap into two rows of four; four fit on one row
  const q = await page(b, 390, 844, true);
  const rows = async () => q.evaluate(() => { const tops = [...document.querySelectorAll('#agesBoxes input')].map(i => Math.round(i.getBoundingClientRect().top)); const uniq = [...new Set(tops)]; return { rows: uniq.length, perRow: uniq.map(t => tops.filter(x => x === t).length), narrowest: Math.min(...[...document.querySelectorAll('#agesBoxes input')].map(i => i.getBoundingClientRect().width)) }; });
  const r4 = await rows();
  ok('phone: four people on one row, boxes at least 64px', r4.rows === 1 && r4.narrowest >= 64, JSON.stringify(r4));
  for (let i = 0; i < 4; i++) await q.locator('#sizeUp').click();
  await q.waitForTimeout(200);
  const r8 = await rows();
  ok('phone: eight people wrap into two rows of four', r8.rows === 2 && r8.perRow.join(',') === '4,4', JSON.stringify(r8));
  await q.close();
});

/* The deduction box is an override, and an OPTIONAL one: empty means the KFF
 * survey average. The user states one number -- their own paycheck deduction --
 * so the employer share stays at the survey average and the total moves; resizing
 * the invisible share from a number that says nothing about it would corrupt the
 * one figure this site exists to get right. The override must reach EVERY
 * employer figure: summary() once dropped it on the floor, so the waterfall moved
 * while the sticky bar, comparison bars and COBRA silently did not. */
test('deduction: the override reaches every figure, and resets away', async b => {
  const p = await page(b,1440,900);
  const n = s => +s.replace(/[^0-9]/g,'');
  const read = () => p.evaluate(()=>{
    const t=e=>document.querySelector(e).textContent.trim();
    return { whole:t('[data-fig="route.whole"]'), sticky:t('.sticky [data-fig="emp.total"]'),
             cobra:t('[data-fig="cobra.annual"]'),
             empShare:[...document.querySelectorAll('#cards .card-i .v')][1].textContent,
             note:t('#deductNote') };
  });
  await p.locator('#adv summary').click();       // the fields live in the drawer now
  await p.waitForTimeout(150);
  const base = await read();
  ok('marked optional', await p.evaluate(()=>/optional/i.test(document.getElementById('deductLbl').textContent))
     && /Optional/.test(base.note));

  await p.fill('#deduct','500');            // $500 every 2 weeks = $13,000/yr
  await p.waitForTimeout(250);
  const o = await read();
  ok('override moves the waterfall', n(o.whole) === n(base.whole) + (13000-6850),
     `${base.whole} -> ${o.whole}`);
  ok('sticky bar agrees with the waterfall', o.sticky === o.whole, `${o.sticky} vs ${o.whole}`);
  ok('COBRA follows the real premium', n(o.cobra) === Math.round((13000+20143)*1.02),
     o.cobra);
  ok('the employer share does not move', o.empShare === base.empShare, o.empShare);

  await p.selectOption('#period','12');     // same $500, monthly = $6,000/yr
  await p.waitForTimeout(250);
  ok('cadence reinterprets the typed amount', n((await read()).whole) === n(base.whole) - (6850-6000));

  await p.click('#advReset');
  await p.waitForTimeout(250);
  const r = await read();
  ok('reset returns to the survey average', r.whole === base.whole && /Optional/.test(r.note));

  await p.fill('#deduct','999'); await p.waitForTimeout(200);
  await p.fill('#deduct','');  await p.waitForTimeout(200);
  ok('clearing the field is also the way back', (await read()).whole === base.whole);

  await p.locator('#route button[data-r="marketplace"]').click();
  await p.waitForTimeout(250);
  ok('the drawer only exists on the employer route',
     await p.evaluate(()=>document.getElementById('adv').hidden));
  await p.close();
});

/* The drawer holds the plan-number overrides, and its summary line carries the
 * state -- a fold only earns its keep when the disclosure stays outside it. The
 * total premium is the field that matters most: with it, the employer share stops
 * being pinned at the survey average and becomes derived, exact, the user's own.
 * And an employer-plan OOP override must never leak into the marketplace figures,
 * which read the same opts object. */
test('drawer: overrides compose, disclose, and stay in their lane', async b => {
  const p = await page(b,1440,900);
  const n = s => +s.replace(/[^0-9]/g,'');
  const sum = () => p.evaluate(()=>document.getElementById('advSum').textContent.trim());
  const cards = () => p.evaluate(()=>[...document.querySelectorAll('#cards .card-i .v')].map(e=>e.textContent));

  ok('closed, it says averages are in force', /survey averages/.test(await sum()));
  await p.locator('#adv summary').click();
  await p.waitForTimeout(150);

  await p.fill('#totPrem','30000');
  await p.waitForTimeout(250);
  ok('total premium alone recomputes the share', n((await cards())[1]) === 30000-6850,
     (await cards())[1]);
  ok('summary names what is yours', /your total premium/.test(await sum()), await sum());

  await p.fill('#deduct','500');
  await p.fill('#oopIn','6000');
  await p.waitForTimeout(250);
  ok('with both premium fields the share is exact', n((await cards())[1]) === 30000-13000);
  ok('the OOP override lands', n((await cards())[2]) === 6000);
  ok('all three reads as your numbers, and offers the way back',
     /using your plan.s numbers.*Reset/i.test(await sum()), await sum());

  const mktOop = await p.evaluate(()=>{
    const line=[...document.getElementById('mktSub').innerText.split('\n')].find(l=>/out-of-pocket/.test(l));
    return +line.replace(/[^0-9]/g,'');
  });
  ok('the marketplace out-of-pocket is untouched', mktOop === 5200, `$${mktOop}`);

  await p.fill('#totPrem','9000');
  await p.waitForTimeout(250);
  ok('an impossible pair is called out', /less than the deduction/.test(await sum()));

  ok('reset-all is offered while anything is overridden',
     await p.evaluate(()=>!document.getElementById('advReset').hidden));
  ok('reset-all wears the amber', await p.evaluate(()=>
     getComputedStyle(document.getElementById('advReset')).color === 'rgb(217, 154, 63)'));
  ok('each overridden field is checked, untouched ones are not', await p.evaluate(()=>{
    const on = id => document.getElementById(id).classList.contains('on');
    return on('deductOvk') && on('totPremOvk') && on('oopInOvk');
  }));
  await p.click('#advReset');
  await p.waitForTimeout(250);
  ok('reset-all returns every figure to the averages',
     /survey averages/.test(await sum()) && n((await cards())[1]) === 20143);
  ok('and then withdraws itself',
     await p.evaluate(()=>document.getElementById('advReset').hidden));
  ok('and the checks go dark with it', await p.evaluate(()=>{
    const on = id => document.getElementById(id).classList.contains('on');
    return !on('deductOvk') && !on('totPremOvk') && !on('oopInOvk');
  }));
  await p.close();
});

/* Codex review, 6 October 2026 (CR-001, CR-002). An empty field means the survey
 * average; a zero is the reader's answer, and an employer that pays the whole
 * premium or a year with no claims is real. Zero used to be thrown away, so the
 * modeled $3,800 came back, and "-100" in two fields lost its minus sign and
 * became an override of 100. A total premium below the survey-average deduction
 * was quietly outvoted by that deduction with the summary still saying "your
 * total premium". */
test('drawer: zero is an answer, a minus sign is refused, an impossible total is called out', async b => {
  const p = await page(b,1440,900);
  const n = s => +s.replace(/[^0-9]/g,'');
  const cards = () => p.evaluate(()=>[...document.querySelectorAll('#cards .card-i .v')].map(e=>e.textContent));
  const whole = () => p.evaluate(()=>document.querySelector('[data-fig="route.whole"]').textContent);
  const sum = () => p.evaluate(()=>document.getElementById('advSum').textContent.trim());
  const on = id => p.evaluate(id=>document.getElementById(id).classList.contains('on'), id);
  await p.locator('#adv summary').click(); await p.waitForTimeout(150);
  const base = { c: await cards(), w: n(await whole()) };

  await p.fill('#oopIn','0'); await p.waitForTimeout(250);
  ok('a zero deductible is kept', n((await cards())[2]) === 0 && await on('oopInOvk'), (await cards())[2]);
  ok('and comes off the whole bill', n(await whole()) === base.w - n(base.c[2]), `${base.w} -> ${await whole()}`);
  await p.locator('#oopIn').blur(); await p.waitForTimeout(150);
  ok('the field keeps showing the zero after it loses focus', await p.inputValue('#oopIn') === '$0.00', await p.inputValue('#oopIn'));

  await p.fill('#deduct','0'); await p.waitForTimeout(250);
  ok('a zero deduction is kept, and the employer share stays at the survey average',
     n((await cards())[0]) === 0 && (await cards())[1] === base.c[1] && await on('deductOvk'), JSON.stringify(await cards()));
  await p.click('#advReset'); await p.waitForTimeout(250);

  for (const id of ['totPrem','oopIn','deduct']) {
    await p.fill('#'+id,'-100'); await p.waitForTimeout(250);
    ok(`"-100" in #${id} sets no override`, !(await on(id+'Ovk')) && JSON.stringify(await cards()) === JSON.stringify(base.c),
       JSON.stringify(await cards()));
    await p.fill('#'+id,''); await p.waitForTimeout(150);
  }

  await p.fill('#totPrem','5000'); await p.waitForTimeout(250);
  ok('a total below the survey-average deduction is called out', /less than the survey average deduction/.test(await sum()), await sum());
  await p.fill('#totPrem','30000'); await p.waitForTimeout(250);
  ok('a workable total is not', !/less than/.test(await sum()), await sum());
  await p.close();
});

/* Codex review CR-003. With no credit, the marketplace headline said every
 * household was "past the 400% cliff", including ones the eligibility box had
 * just placed in Medicaid's range or under the poverty line; the waterfall note
 * said "the credit never touches your bank account" to households with no
 * credit at all. Each cause of a zero credit gets its own reason, on both. */
test('marketplace: every reason for a zero credit is named for what it is', async b => {
  const p = await page(b, 1280, 900);
  const read = () => p.evaluate(() => ({ sub: document.getElementById('bigSub').textContent,
    wf: document.getElementById('wfNote').textContent }));
  const zip = async z => { await p.locator('#zip').fill(z); await p.locator('#zipGo').click(); await p.waitForTimeout(350); };
  await p.locator('#route button[data-r="marketplace"]').click(); await p.waitForTimeout(250);

  await setIncome(p, 40000);
  let t = await read();
  ok('with a credit: the taxpayer share, and the credit note', /carried by taxpayers/.test(t.sub) && /never touches your bank account/.test(t.wf), JSON.stringify(t));
  await setIncome(p, 240000); t = await read();
  ok('over the cliff: the cliff, on both', /400% cliff/.test(t.sub) && /400% cliff/.test(t.wf), JSON.stringify(t));
  await setIncome(p, 30000); t = await read();   // Dallas family of four at 93%
  ok('below the floor: the floor, never the cliff', /Under 100% of the poverty line/.test(t.sub) && /Under 100% of the poverty line/.test(t.wf)
     && !/cliff|never touches/.test(t.sub + t.wf), JSON.stringify(t));
  await zip('06106'); await setAges(p, [40]); await setIncome(p, 20000);   // Hartford, one adult at 128%
  t = await read();
  ok('Medicaid range: Medicaid, never the cliff', /Medicaid/.test(t.sub) && /Medicaid/.test(t.wf)
     && !/cliff|never touches/.test(t.sub + t.wf), JSON.stringify(t));
  await zip('20001'); await setAges(p, [21]); await setIncome(p, 62000);   // DC, 21, at 396%: the benchmark is under the expected share
  t = await read();
  ok('a credit that works out to $0: says so, never the cliff', /works out to \$0/.test(t.sub) && /works out to \$0/.test(t.wf)
     && !/cliff|never touches/.test(t.sub + t.wf), JSON.stringify(t));
  await p.close();
});

/* The drawer is optional input, and the word itself has to be on the summary --
 * the teal edge and the state line imply it, but implication is not a label.
 * The word is muted, not teal: it qualifies the title, it is not the title.
 * And the state line gets a full row of its own at every width: sharing a row
 * with the title left it a leftover column, and its wrapping set the height of
 * the box. */
test('drawer: says "optional" on the fold, and the fold stays flat', async b => {
  for (const w of [1440, 760, 390]) {
    const p = await page(b, w, 900);
    const r = await p.evaluate(()=>{
      const s = document.querySelector('#adv summary');
      const o = s.querySelector('.adv-opt');
      const k = s.querySelector('.adv-k').getBoundingClientRect();
      const st = s.querySelector('.adv-s').getBoundingClientRect();
      return {
        txt: s.textContent,
        col: getComputedStyle(o).color,
        titleCol: getComputedStyle(s.querySelector('.adv-k')).color,
        fits: s.scrollWidth <= s.clientWidth + 1,
        below: st.top >= k.bottom,
        h: s.getBoundingClientRect().height,
        foldW: s.getBoundingClientRect().width,
      };
    });
    ok(`${w}px: the fold says optional`, /optional/i.test(r.txt));
    ok(`${w}px: muted, not teal`, r.col === 'rgb(138, 143, 156)' && r.col !== r.titleCol, r.col);
    ok(`${w}px: the label fits the fold`, r.fits);
    ok(`${w}px: the state line sits under the title`, r.below);
    // Keyed to the FOLD's width, not the viewport: at 1440 the drawer sits in a
    // 368px panel column, narrower than its 760px self. The action-hint wording
    // earns a second line in a narrow fold, and never a third anywhere.
    ok(`${w}px: the closed fold stays flat`, r.h < (r.foldW > 450 ? 80 : 104), `${r.h}px at fold ${Math.round(r.foldW)}px`);
    await p.close();
  }
});

test('sticky: the bar never scrolls sideways', async b => {
  for (const [w,h,m] of [[1440,900,false],[1200,900,false],[1024,900,false],[901,900,false],[899,900,false],[768,1024,false],[390,844,true],[360,780,true]]) {
    const p = await page(b,w,h,m);
    const r = await p.evaluate(()=>{
      const si=document.querySelector('.sticky-in');
      const u=document.querySelector('.unit');
      return { over:si.scrollWidth-si.clientWidth, unitRight:Math.round(innerWidth-u.getBoundingClientRect().right) };
    });
    ok(`${w}px: sticky bar does not overflow`, r.over === 0, `${r.over}px`);
    ok(`${w}px: switch stays inside the gutter`, r.unitRight >= 20, `${r.unitRight}px from edge`);
    await p.close();
  }
});

test('sticky: pins across the ink zone', async b => {
  const p = await page(b,1440,900);
  const { top, height } = await p.evaluate(()=>{ const z=document.querySelector('.inkzone'); return {top:z.offsetTop, height:z.offsetHeight}; });
  for (const frac of [.2,.5,.8]) {
    await p.evaluate(y=>window.scrollTo(0,y), top + height*frac);
    await p.waitForTimeout(150);
    const t = await p.evaluate(()=>Math.round(document.querySelector('.sticky').getBoundingClientRect().top));
    ok(`pinned at ${Math.round(frac*100)}% of ink zone`, t === 0, `top=${t}`);
  }
  await p.evaluate(()=>window.scrollTo(0,0)); await p.waitForTimeout(150);
  ok('unpinned above the ink zone', !(await p.evaluate(()=>document.querySelector('.sticky').classList.contains('pinned'))));
  await p.close();
});

test('units: year/month switch drives every figure', async b => {
  const p = await page(b,1440,900);
  const read = () => p.evaluate(()=>({ big:document.querySelector('.bignum').textContent,
    decade:document.getElementById('decade').textContent,
    checked:document.getElementById('unit').getAttribute('aria-checked'),
    thumbAligned: (()=>{ const u=document.getElementById('unit'),t=u.querySelector('.unit-thumb'),o=u.querySelector('.unit-l.on');
      return Math.abs(t.getBoundingClientRect().left - o.getBoundingClientRect().left) < 2; })() }));
  const y = await read();
  await p.locator('#unit').click(); await p.waitForTimeout(400);
  const m = await read();
  const n = s => +s.replace(/[^0-9]/g,'');
  ok('annual → monthly divides by 12', Math.abs(n(y.big)/12 - n(m.big)) <= 1, `${y.big} → ${m.big}`);
  ok('decade total does not divide', y.decade === m.decade, y.decade);
  ok('aria-checked flips', y.checked==='false' && m.checked==='true');
  ok('thumb tracks the active label', y.thumbAligned && m.thumbAligned);
  await p.close();
});

test('routes: each coverage route rebuilds the waterfall', async b => {
  const p = await page(b,1440,900);
  const expect = { employer:5, marketplace:5, none:3 };
  for (const r of Object.keys(expect)) {
    await p.locator(`#route button[data-r="${r}"]`).click(); await p.waitForTimeout(300);
    const d = await p.evaluate(()=>{
      const cols=[...document.querySelectorAll('#wf .wcol')];
      const h=cols.map(c=>+[...c.querySelectorAll('.band')].reduce((a,e)=>a+e.getBoundingClientRect().height,0).toFixed(1));
      return { cols:cols.length, h, cards:document.querySelectorAll('#cards .card-i').length };
    });
    ok(`${r}: column count`, d.cols === expect[r], `${d.cols}`);
    ok(`${r}: last step reaches the total`, Math.abs(d.h[d.h.length-1]-d.h[d.h.length-2]) < 1.5, d.h.join('/'));
    ok(`${r}: cards match components`, d.cards === expect[r]-1);
  }
  await p.close();
});

/* Column width carries no meaning in a waterfall -- height is the data -- so the
 * data columns must not vary. They did: flex-grow with the default basis:auto
 * sized each column from its own label, giving 123/224/148/148 at 1440px. The
 * caption row did the same from different content, so the colour keys drifted up
 * to 58px from the columns they name, which is precisely what design-brief.md
 * says keeping the keys in the captions would prevent. */
test('waterfall: equal columns, keys aligned to them', async b => {
  for (const [w,h,m] of [[1440,900,false],[1200,900,false],[900,900,false],[520,900,false],[500,900,false],[390,844,true],[320,844,true]]) {
    const p = await page(b,w,h,m);
    for (const route of ['employer','marketplace','none']) {
      await p.locator(`#route button[data-r="${route}"]`).click();
      await p.waitForTimeout(250);
      const r = await p.evaluate(()=>{
        const wf=document.getElementById('wf');
        const cols=[...wf.children].filter(c=>c.className.startsWith('wcol'));
        const caps=[...document.getElementById('wcaps').children].filter(c=>(c.className||'').startsWith('wcap'));
        const data=cols.slice(0,-1).map(c=>c.getBoundingClientRect().width);
        const drift=cols.map((c,i)=>caps[i]?Math.abs(caps[i].getBoundingClientRect().left-c.getBoundingClientRect().left):0);
        // scrollWidth, not getBoundingClientRect: .wlab is a block, so its BOX is
        // always the column width and the nowrap TEXT is what spills out of it.
        // Measuring the box could never fail, and hid a 14px overflow at 390px.
        const over=[...wf.querySelectorAll('.wlab'),...document.querySelectorAll('#wcaps .wcap')]
          .map(e=>e.scrollWidth-e.clientWidth);
        const stacked=getComputedStyle(document.getElementById('wcaps')).flexDirection==='column';
        return { spread:Math.max(...data)-Math.min(...data), maxDrift:Math.max(...drift),
                 maxOver:Math.max(...over), stacked };
      });
      ok(`${w}px ${route}: data columns equal`, r.spread < 0.5, `spread ${r.spread.toFixed(1)}px`);
      // Below 500px a column is under 76px and no caption fits in one, so the key
      // becomes a list instead. Alignment is only worth asserting where it applies.
      if (!r.stacked)
        ok(`${w}px ${route}: keys sit under their column`, r.maxDrift < 0.5, `drift ${r.maxDrift.toFixed(1)}px`);
      ok(`${w}px ${route}: nothing overflows its column`, r.maxOver <= 0.5, `over ${r.maxOver}px`);
    }
    await p.close();
  }
});

/* The figure above a column and the colour key below it describe the same column,
 * so they have to hang from the same edge. The key is a swatch then text, which can
 * only start at the left -- so the figure does too. Right-aligning the figures read
 * well alone and disagreed with the key row, which is worse than either choice.
 * Only asserted above 500px: below that the key is a list, not a caption row. */
test('waterfall: figure and colour key share their column edge', async b => {
  for (const [w,h] of [[1440,900],[1200,900],[900,900],[520,900]]) {
    const p = await page(b,w,h);
    const r = await p.evaluate(()=>{
      const cols=[...document.getElementById('wf').children].filter(c=>c.className.startsWith('wcol'));
      const caps=[...document.getElementById('wcaps').children].filter(c=>(c.className||'').startsWith('wcap'));
      let worst=0, where='';
      cols.forEach((c,i)=>{
        const lab=c.querySelector('.wlab'); if(!lab||!caps[i]) return;
        const rg=document.createRange(); rg.selectNodeContents(lab);
        const textLeft=rg.getBoundingClientRect().left;
        const d=Math.abs(textLeft - caps[i].getBoundingClientRect().left);
        if(d>worst){ worst=d; where=lab.textContent.trim(); }
      });
      return { worst, where };
    });
    ok(`${w}px: figures hang from the same edge as their key`, r.worst < 1,
       `${r.worst.toFixed(1)}px at "${r.where}"`);
    await p.close();
  }
});

/* Collapsing a disclosure is only honest if the disclosure itself stays out in the
 * open -- this section exists to say who produced the number. Both facts a reader
 * needs to weigh it are in the summary; only the elaboration is behind the toggle. */
test('lives: the source caveat is readable without expanding', async b => {
  for (const [w,h,m] of [[1440,900,false],[390,844,true]]) {
    const p = await page(b,w,h,m);
    const r = await p.evaluate(()=>{
      const d=document.querySelector('.src'), sum=d.querySelector('summary');
      return { open:d.open, txt:sum.innerText.toLowerCase(),
               h:sum.getBoundingClientRect().height,
               shut:d.getBoundingClientRect().height };
    });
    // A closed <details> still reports a box for its subtree in Chrome, so the
    // element's own height is what says whether the detail is on screen.
    ok(`${w}px: starts collapsed`, r.open === false && r.shut < r.h + 8,
       `${Math.round(r.shut)}px tall vs a ${Math.round(r.h)}px summary`);
    ok(`${w}px: not-peer-reviewed stays visible`, /peer[\s-]?reviewed/.test(r.txt), r.txt.slice(0,70));
    ok(`${w}px: the adviser role stays visible`, /sanders/.test(r.txt), r.txt.slice(0,70));
    // Recency and the caveats travel together: the dateline over the figure and
    // the date in this summary must not outshine the disclosures beside them.
    ok(`${w}px: the preprint's date is in the summary`, /july 2026/.test(r.txt), r.txt.slice(0,70));
    // textContent, not innerText: the label's text-transform uppercases the
    // rendered text, and this asserts the authored content.
    ok(`${w}px: the figure wears its dateline`, await p.evaluate(()=>
       /Yale School of Public Health\s*·\s*July 2026/.test(document.querySelector('.bigstat').textContent)));
    ok(`${w}px: summary is a 44px target`, r.h >= 44, `${Math.round(r.h)}px`);
    const after = await p.evaluate(()=>{ const d=document.querySelector('.src'); d.open=true;
      return d.getBoundingClientRect().height; });
    ok(`${w}px: expanding reveals the detail`, after > r.shut + 100,
       `${Math.round(r.shut)}px → ${Math.round(after)}px`);
    await p.close();
  }
});

/* A footnote marker that anchors to nothing is decoration. Each objection card
 * carries the pair: * on the note, * on the claim it qualifies. */
test('objections: every footnote marker has its anchor', async b => {
  const p = await page(b,1440,900);
  const bad = await p.evaluate(()=>{
    const out=[];
    document.querySelectorAll('#objections .grid2 > .card-p').forEach(c=>{
      const fn=c.querySelector('.fn'), body=c.querySelector('p.body');
      if(!fn) return;
      if(!fn.querySelector('.fnm')) out.push('note without marker: '+fn.textContent.slice(0,30));
      if(!body || !body.querySelector('.fnr')) out.push('claim without marker: '+(body?body.textContent.slice(0,30):'none'));
    });
    return out;
  });
  ok('every objection footnote is anchored', bad.length === 0, bad.slice(0,3).join(' | '));
  await p.close();
});

test('cliff: statutory drop and no label collisions', async b => {
  const p = await page(b,1440,900);
  const d = await p.evaluate(()=>({ under:document.getElementById('cliffUnder').textContent,
    over:document.getElementById('cliffOver').textContent, drop:document.getElementById('cliffDrop').textContent }));
  const n = s => +s.replace(/[^0-9]/g,'');
  // each figure rounds to whole dollars on its own, so the identity can drift
  // by a dollar with real premiums behind it
  ok('drop = over − under', Math.abs(n(d.drop) - (n(d.over) - n(d.under))) <= 1, `${d.under} → ${d.over} = ${d.drop}`);
  for (const size of [4,2,1]) {
    await p.evaluate(t=>{ const c=+document.getElementById('sizeVal').textContent;
      for(let i=0;i<Math.abs(c-t);i++) document.getElementById(c>t?'sizeDown':'sizeUp').click(); }, size);
    let hit = null;
    for (let inc=20000; inc<=250000 && !hit; inc+=5000) {
      await setIncome(p, inc);
      hit = await p.evaluate(()=>{ const t=[...document.querySelectorAll('#cliffChart text')].map(e=>({s:e.textContent.trim(),b:e.getBoundingClientRect()}));
        for(let i=0;i<t.length;i++)for(let j=i+1;j<t.length;j++){const A=t[i].b,B=t[j].b;
          if(A.left<B.right&&B.left<A.right&&A.top<B.bottom&&B.top<A.bottom) return `${t[i].s} / ${t[j].s}`;} return null; });
      if (hit) hit = `$${inc}: ${hit}`;
    }
    ok(`household of ${size}: chart labels clear`, !hit, hit||'');
  }
  await p.close();
});

/* The chart's viewBox tracks its container width, so a stale viewBox silently
 * rescales every label. Loading at a width is not the same as resizing to it:
 * this asserts the chart follows its container after the fact, at the sizes the
 * gutter change moved. */
/* The "you" label is centred ON its guide, so a full-height dashed line ran
 * straight through the middle of the word at every income -- the guide now stops
 * above the cap height. Sampled every $2k rather than at a handful of incomes:
 * the previous collision here was missed by a 6-point sample. */
test('cliff: the "you" guide never crosses its own label', async b => {
  const p = await page(b,1440,900);
  const hits = [];
  for (let inc = 14000; inc <= 258000; inc += 2000) {
    await setIncome(p, inc);
    const bad = await p.evaluate(()=>{
      const svg = document.querySelector('#cliffChart svg');
      const you = [...svg.querySelectorAll('text')].find(t=>t.textContent === 'you');
      if (!you) return null;
      const y = you.getBBox();
      for (const el of svg.querySelectorAll('path,line,circle')) {
        const b = el.getBBox();
        if (!(b.x > y.x+y.width || b.x+b.width < y.x || b.y > y.y+y.height || b.y+b.height < y.y))
          return el.tagName + ' ' + (el.getAttribute('stroke')||'');
      }
      return null;
    });
    if (bad) hits.push(`$${inc}: ${bad}`);
  }
  ok('label is clear of every plotted mark', hits.length === 0, hits.slice(0,3).join(' | '));
  await p.close();
});

/* A couple at $131,000 is 619% of the poverty line; the chart stopped at 550% and
 * the "you" guide, drawn only inside the range, simply vanished for exactly the
 * early-retiree household the section matters most to. The chart now widens to
 * follow the household (capped at 10x, where the guide pins to the edge). */
test('cliff: a household past 550% stays on the chart, and the age note reads the state curve', async b => {
  const p = await page(b, 1440, 900);
  const youX = () => p.evaluate(() => {
    const svg = document.querySelector('#cliffChart svg'); if (!svg) return null;
    const you = [...svg.querySelectorAll('text')].find(t => t.textContent === 'you');
    const w = svg.viewBox.baseVal.width;
    const labels = [...svg.querySelectorAll('text')].map(t => t.textContent).filter(t => /^\d+%$/.test(t));
    const cliff = [...svg.querySelectorAll('line')].find(l => l.getAttribute('stroke-dasharray') === '5 4');
    return { x: you ? you.getBBox().x + you.getBBox().width / 2 : null, w, labels, cliffX: cliff ? +cliff.getAttribute('x1') : null,
             note: document.getElementById('cliffAge').hidden ? null : document.getElementById('cliffAge').textContent };
  });
  ok('default household: no age note', (await youX()).note === null);
  await setAges(p, [62, 60]); await setIncome(p, 131000);
  let g = await youX();
  ok('couple at $131,000: the guide is on the chart, right of the cliff', g.x !== null && g.cliffX !== null && g.x > g.cliffX && g.x < g.w - 20, JSON.stringify({ x: g.x, cliff: g.cliffX, w: g.w }));
  ok('and the axis runs past 500%', g.labels.includes('600%'), g.labels.join(' '));
  ok('the age note names the oldest adult and the state factor, and links the benchmark section',
     /oldest adult here is 62/.test(g.note) && /about \d\.\d times/.test(g.note) && /Retirement income counts/.test(g.note) &&
     await p.evaluate(() => !!document.querySelector('#cliffAge a.term[href="/methodology/#benchmark"]')), g.note);
  const factor = await p.evaluate(() => { const B = window.WholeBillBench; const cv = B.curves[B.states.TX.curve]; return (cv[62] / cv[21]).toFixed(1); });
  ok('the factor is the Texas curve at 62 over 21', g.note.includes('about ' + factor + ' times'), factor);
  await setIncome(p, 260000);   // the slider's top; 12.3x the line for a couple, past the 10x cap
  g = await youX();
  ok('at $260,000 (over 10x) the guide pins to the right edge, still visible', g.x !== null && g.x > g.w * 0.9 && g.labels.includes('1000%'), JSON.stringify({ x: g.x, w: g.w, labels: g.labels }));
  await setIncome(p, 20000);
  g = await youX();
  ok('under 150% the guide pins to the left edge', g.x !== null && g.x < g.w * 0.12, String(g.x));
  await setIncome(p, 95000);
  await p.locator('#zip').fill('10001'); await p.locator('#zipGo').click(); await p.waitForTimeout(400);
  g = await youX();
  ok('New York, which rates by family tier, gets the no-age-rating line', /New York does not rate marketplace premiums by/.test(g.note) && !/times what a 21-year-old/.test(g.note), g.note);
  await setAges(p, [66, 60]);
  g = await youX();
  ok('a 66-year-old is Medicare; the note follows the 60-year-old', /oldest adult here is 60/.test(g.note), g.note);
  await setAges(p, [66, 40]);
  ok('no adult of 55 to 64: no note', (await youX()).note === null);
  await p.close();
});

test('cliff: chart follows its container across resizes', async b => {
  const p = await page(b,1440,900);
  const read = () => p.evaluate(()=>{
    const host=document.getElementById('cliffChart'), svg=host.querySelector('svg');
    const vb=+svg.getAttribute('viewBox').split(' ')[2];
    const scale=svg.getBoundingClientRect().width/vb;
    return { hostW:host.clientWidth, vb, scale:+scale.toFixed(2),
             minFs:+Math.min(...[...svg.querySelectorAll('text')].map(t=>+t.getAttribute('font-size')*scale)).toFixed(1) };
  });
  for (const [w,h] of [[390,844],[480,900],[768,1024],[1440,900],[360,780]]) {
    await p.setViewportSize({width:w,height:h});
    await p.waitForTimeout(450);
    const r = await read();
    ok(`${w}px: viewBox matches container`, Math.abs(r.hostW - r.vb) <= 2,
       `host ${r.hostW} vs viewBox ${r.vb}`);
    ok(`${w}px: chart text ≥ 9px after resize`, r.minFs >= 9, `${r.minFs}px at scale ${r.scale}`);
  }
  await p.close();
});

test('cliff: chart text stays readable on a phone', async b => {
  const p = await page(b,390,844,true);
  const r = await p.evaluate(()=>{ const svg=document.querySelector('#cliffChart svg');
    const vb=+svg.getAttribute('viewBox').split(' ')[2];
    const scale=svg.getBoundingClientRect().width/vb;
    const sizes=[...svg.querySelectorAll('text')].map(t=>+t.getAttribute('font-size')*scale);
    return { scale:+scale.toFixed(2), min:+Math.min(...sizes).toFixed(1) }; });
  ok('effective font size ≥ 9px', r.min >= 9, `${r.min}px at scale ${r.scale}`);
  // the widened chart: a couple at $131,000 pulls the cliff left; the annotation
  // must not cover the axis labels, and no two labels may collide
  await p.evaluate(() => { for (let k = 0; k < 2; k++) document.getElementById('sizeDown').click(); });
  await setIncome(p, 131000);
  const phoneHit = await p.evaluate(() => {
    const t = [...document.querySelectorAll('#cliffChart text')].map(e => ({ s: e.textContent.trim(), b: e.getBoundingClientRect() }));
    const box = document.getElementById('cliffAnnotBox').getBoundingClientRect(), svgB = document.querySelector('#cliffChart svg').getBoundingClientRect();
    if (box.left < svgB.left - 0.5 || box.right > svgB.right + 0.5) return 'annotation past the plot edge';
    for (const a of t) if (/^\$/.test(a.s) && a.b.left < box.right && box.left < a.b.right && a.b.top < box.bottom && box.top < a.b.bottom) return 'box covers ' + a.s;
    for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) { const A = t[i].b, B = t[j].b;
      if (A.left < B.right && B.left < A.right && A.top < B.bottom && B.top < A.bottom) return t[i].s + ' / ' + t[j].s; }
    return null;
  });
  ok('phone, couple at $131,000: the annotation clears the axis and nothing collides', !phoneHit, phoneHit || '');
  await p.close();
});

test('mobile: touch targets and sticky layout', async b => {
  const p = await page(b,390,844,true);
  const r = await p.evaluate(()=>{
    const small=[]; document.querySelectorAll('button,select,input').forEach(el=>{
      const q=el.getBoundingClientRect(); if(q.height>0&&q.height<44) small.push(`${el.id||el.className} ${Math.round(q.height)}px`); });
    const si=document.querySelector('.sticky-in');
    return { small:[...new Set(small)], overflow:Math.round(si.scrollWidth-si.clientWidth),
             figs:[...document.querySelectorAll('.figs .fig')].filter(f=>getComputedStyle(f).display!=='none').length };
  });
  ok('all controls ≥ 44px', r.small.length === 0, r.small.join(', '));
  ok('sticky bar does not overflow', r.overflow === 0, `${r.overflow}px`);
  ok('all three figures visible', r.figs === 3, `${r.figs}`);
  await p.close();
});

/* Real routing: on the deployed site the methodology is its own document at
 * /methodology, stripped from index.html; the artifact (one document by
 * necessity) keeps the hash router. All three shapes are asserted. */
test('routing: methodology is its own page; the artifact keeps the hash', async b => {
  // index: stripped, links point at the real path, old hash links redirect
  const p = await page(b,1440,900);
  ok('the methodology is not in the calculator document',
     await p.evaluate(()=>document.getElementById('methodology') === null));
  ok('its links point at the real path', await p.evaluate(()=>
    [...document.querySelectorAll('a[href="/methodology"]')].length >= 2 &&
    [...document.querySelectorAll('a[href^="#/"]')].length === 0));
  await p.close();

  // /methodology: its own static document
  const pm = await page(b,1440,900,false,'methodology/index.html');
  const m = await pm.evaluate(()=>({
    title: document.title,
    eyebrow: [...document.querySelectorAll('.eyebrow')].some(e=>/^08/.test(e.textContent.trim())),
    visible: !document.getElementById('methodology').hidden && !document.getElementById('methBack').hidden,
    back: (document.querySelector('#methBack a.q')||{}).getAttribute?.('href'),
    scripts: document.querySelectorAll('script:not([type="application/ld+json"])').length }));   // structured data is a data block, not a script
  ok('the page carries its own title', /^Methodology.*· The Whole Bill$/.test(m.title), m.title);
  ok('the 08 eyebrow lives here', m.eyebrow);
  ok('nothing is hidden and the back link goes home', m.visible && m.back === '/', m.back);
  ok('the document is fully static', m.scripts === 0, m.scripts + ' scripts');
  await pm.close();

  // the artifact: one document, hash-routed as before
  const pa = await page(b,1440,900,false,'artifact.html');
  const st = () => pa.evaluate(()=>({ meth:!document.getElementById('methodology').hidden,
    hero:!document.querySelector('section.paper').hidden, title:document.title }));
  const a = await st();
  ok('artifact: main view by default', a.meth===false && a.hero===true);
  await pa.evaluate(()=>{location.hash='#/methodology';}); await pa.waitForTimeout(300);
  const c = await st();
  ok('artifact: hash shows the methodology and hides the flow', c.meth===true && c.hero===false);
  ok('artifact: title changes', /Methodology/.test(c.title), c.title);
  await pa.evaluate(()=>{location.hash='';}); await pa.waitForTimeout(300);
  ok('artifact: back to main', (await st()).hero===true);
  await pa.close();
});

test('scope: ZIP never returns someone else\'s numbers', async b => {
  const p = await page(b,1440,900);
  const place = () => p.evaluate(()=>document.getElementById('placeName').textContent);
  for (const [zip, county] of [['06106','Hartford'],['75201','Dallas'],['10001','New York'],
                               ['44113','Cuyahoga'],['99501','Anchorage'],['02116','Suffolk']]) {
    await p.locator('#zip').fill(zip); await p.locator('#zipGo').click(); await p.waitForTimeout(300);
    ok(`${zip} → ${county}`, (await place()).includes(county), await place());
  }
  await p.locator('#zip').fill('00000'); await p.locator('#zipGo').click(); await p.waitForTimeout(300);
  const t = await p.evaluate(()=>document.getElementById('scope').textContent);
  ok('a nonexistent ZIP says so', /not a residential US ZIP/.test(t), t.slice(0,60));
  // a ZIP that spans rating areas asks, never guesses: the figures hold the
  // previous county until the reader picks
  const before = await place();
  await p.locator('#zip').fill('30165'); await p.locator('#zipGo').click(); await p.waitForTimeout(300);
  ok('a split ZIP asks', /spans/.test(await p.evaluate(()=>document.getElementById('scope').textContent)));
  ok('and holds the old county meanwhile', (await place()) === before, await place());
  const picks = await p.evaluate(()=>[...document.querySelectorAll('#areapick button')].map(x=>x.textContent));
  ok('the choices name county and state', picks.length >= 2 && /Floyd County · GA/.test(picks.join('|')), picks.join(' | '));
  await p.locator('#areapick button').first().click(); await p.waitForTimeout(300);
  ok('picking resolves it', (await place()).includes('Floyd'), await place());
  await p.close();
});

/* Section 07: the letter is built from route, tone and emphasis, its figures
 * resolve through the same data-fig map as the charts, and its comparative
 * sentence is conditional -- "every one of them is less" is only sometimes
 * true, and the letter does not get to lie for effect. */
test('letter: built from the route, honest about the comparison', async b => {
  const p = await page(b,1440,900);
  const txt = () => p.evaluate(()=>document.getElementById('letterBd').innerText);
  ok('employer route tells the employer story',
     /payroll deduction/.test(await txt()) && /keeping this coverage/.test(await txt()));
  ok('and its comparison holds', /Every one of them is less/.test(await txt()));
  ok('figures are rounded, each with its hedge word', await p.evaluate(()=>{
    const t = document.getElementById('letterBd').innerText;
    const n = s => +s.replace(/[^0-9]/g,'');
    const more = t.match(/more than \$([\d,]+)/g) || [];
    const range = t.match(/between roughly \$([\d,]+) and \$([\d,]+)/);
    return more.length >= 2 && range &&
      more.every(s=>n(s) % 500 === 0) &&
      n(range[1]) % 500 === 0 && n(range[2]) % 500 === 0 && n(range[1]) < n(range[2]);
  }), (await txt()).match(/more than \$[\d,]+|between[^.]+/g)?.join(' | '));
  ok('word count is the real count', await p.evaluate(()=>{
    const words=(document.getElementById('letterBd').innerText.match(/\S+/g)||[]).length;
    return document.getElementById('letterCount').textContent.includes(words+' words');
  }));

  await p.locator('#route button[data-r="marketplace"]').click(); await p.waitForTimeout(250);
  ok('marketplace route swaps to the self-employed story',
     /I buy my own coverage/.test(await txt()) && !/payroll deduction/.test(await txt()));
  ok('subsidized households disclose the taxpayer help', /taxpayer help/.test(await txt()));

  await p.locator('#route button[data-r="none"]').click(); await p.waitForTimeout(250);
  const u = await txt();
  ok('uninsured route says so', /uninsured today/.test(u) && !/keeping this coverage/.test(u));
  ok('and does NOT claim universal is cheaper -- for this household it is not',
     /more than my household bears today/.test(u));

  /* Recipient switching: the letter can go to either senator, and everything
   * follows -- title, the Senate bill, statewide phrasing, the mailto subject.
   * A cosponsor is thanked; a non-cosponsor is asked. */
  await p.locator('#route button[data-r="employer"]').click(); await p.waitForTimeout(250);
  ok('the default cosponsoring rep is thanked, not lobbied cold',
     /thank you for cosponsoring/i.test(await txt()));
  ok('the rep block carries the selection ring by default', await p.evaluate(()=>
    document.getElementById('recRep').classList.contains('on')));
  await p.locator('#senRows .rec-hit[data-rec="sen0"]').click(); await p.waitForTimeout(300);
  const sTxt = await txt();
  ok('a senator letter is addressed as one', /^Dear Senator Cornyn,/.test(sTxt), sTxt.split('\n')[0]);
  ok('the ring moves to the senator', await p.evaluate(()=>
    document.querySelector('#senRows .rec-hit[data-rec="sen0"]').classList.contains('on') &&
    !document.getElementById('recRep').classList.contains('on')));
  ok('and the salutation highlights the name', await p.evaluate(()=>
    /Dear Senator <mark>Cornyn<\/mark>,/.test(document.getElementById('letterBd').innerHTML)));
  ok('and names the Senate companion', /Medicare for All Act, S\. 1506/.test(sTxt));
  ok('a non-cosponsor is asked, not thanked', !/thank you for cosponsoring/i.test(sTxt));
  const subj = await p.evaluate(()=>decodeURIComponent(document.getElementById('sendBtn').href.split('subject=')[1].split('&')[0]));
  ok('the mailto subject follows the bill', /S\. 1506/.test(subj), subj);
  // there is no public congressional inbox to fill a To: line with, so the
  // primary action opens the recipient's own site, where the contact form is
  ok('the primary action opens the senator\'s own site', await p.evaluate(()=>
    /cornyn\.senate\.gov/.test(document.getElementById('formBtn').getAttribute('href'))));
  // the selected ring must stack above a neighbour's hover tint, and the
  // neighbour's box must physically clear the 2px ring: measured, because a
  // 6px hit inflation once made the tint touch the ring and read as overlap
  ok('the selection ring stacks above hover', await p.evaluate(()=>{
    const on = document.querySelector('.rec-hit.on');
    const cs = getComputedStyle(on);
    return cs.position === 'relative' && cs.zIndex === '1';
  }));
  ok('a neighbour clears the ring', await p.evaluate(()=>{
    const rows = [...document.querySelectorAll('#senRows .rec-hit')].map(x=>x.getBoundingClientRect());
    return rows.length === 2 && rows[1].top - rows[0].bottom >= 2;
  }));
  await p.locator('#route button[data-r="marketplace"]').click(); await p.waitForTimeout(250);
  ok('the self-employed line goes statewide for a senator',
     /in this state carries this cost/.test(await txt()));
  // a cosponsoring SENATOR is thanked too (Blumenthal), and a fresh ZIP
  // returns the letter to the House member rather than a same-index senator
  await p.locator('#zip').fill('06468'); await p.locator('#zipGo').click(); await p.waitForTimeout(400);
  ok('a new ZIP addresses the rep again', /^Dear Representative Himes,/.test(await txt()), (await txt()).split('\n')[0]);
  ok('and the site button follows', await p.evaluate(()=>
    /himes\.house\.gov/.test(document.getElementById('formBtn').getAttribute('href'))));
  await p.locator('#senRows .rec-hit[data-rec="sen0"]').click(); await p.waitForTimeout(300);
  ok('a cosponsoring senator is thanked', /^Dear Senator Blumenthal,/.test(await txt()) &&
     /thank you for cosponsoring/i.test(await txt()), (await txt()).split('\n')[0]);
  await p.close();
});

test('letter: controls write the letter, edits survive the slider', async b => {
  const p = await page(b,1440,900);
  const txt = () => p.evaluate(()=>document.getElementById('letterBd').innerText);
  const count = () => p.evaluate(()=>+document.getElementById('letterCount').textContent.match(/(\d+) words/)[1]);
  await p.locator('#tone button[data-tone="personal"]').click(); await p.waitForTimeout(250);
  ok('personal tone rewrites the opener', /I live in/.test(await txt()));
  await p.locator('#tone button[data-tone="measured"]').click(); await p.waitForTimeout(250);
  // the default rep cosponsors, so measured thanks and presses rather than
  // asking them to consider their own bill
  ok('measured tone stays polite', /keep pressing for it/.test(await txt()));

  // Who is writing is one choice: switching persona swaps the paragraph
  const checked = () => p.evaluate(() => [...document.querySelectorAll('#persona .chk')].filter(b => b.getAttribute('aria-checked') === 'true').map(b => b.getAttribute('data-who')));
  ok('the employer household is the persona on the employer route', JSON.stringify(await checked()) === '["emp"]', JSON.stringify(await checked()));
  await p.locator('#persona button[data-who="mkt"]').click(); await p.waitForTimeout(250);
  ok('picking self-employed swaps the paragraph in, and the employer one out',
     /buy my own coverage through the marketplace/.test(await txt()) && !/payroll deduction/.test(await txt()));
  ok('self-employed closes on the sole proprietor', /sole proprietor/.test(await txt()) && !/old enough for Medicare/.test(await txt()));
  ok('exactly one persona is checked, and nothing is greyed', JSON.stringify(await checked()) === '["mkt"]' && await p.evaluate(() => ![...document.querySelectorAll('#persona .chk, #emph .chk')].some(b => b.disabled)));
  await p.locator('#persona button[data-who="ret"]').click(); await p.waitForTimeout(250);
  ok('retired before Medicare: same marketplace paragraph, its own closing, no sole proprietor',
     /buy my own coverage through the marketplace/.test(await txt()) && /old enough for Medicare/.test(await txt()) && /median retirement age is 62/.test(await txt()) && !/sole proprietor/.test(await txt()));
  ok('roving tabindex: only the checked radio is a tab stop', await p.evaluate(() => [...document.querySelectorAll('#persona .chk')].map(b => b.tabIndex).join(',') === '-1,-1,0'));
  await p.locator('#persona button[data-who="ret"]').focus(); await p.keyboard.press('ArrowUp'); await p.waitForTimeout(250);
  ok('arrow keys move within the group', JSON.stringify(await checked()) === '["mkt"]' && await p.evaluate(() => document.activeElement.getAttribute('data-who') === 'mkt'));
  // the job-loss addition follows the persona, not the route
  ok('a non-employer persona drops the job-loss addition: hidden, unchecked, out of the letter',
     await p.evaluate(() => { const b = document.querySelector('#emph [data-em="loss"]'); return b.hidden && b.getAttribute('aria-pressed') === 'false'; }) && !/keeping this coverage through COBRA/.test(await txt()));
  await p.locator('#persona button[data-who="emp"]').click(); await p.waitForTimeout(250);
  ok('back to the employer household, it returns checked and the COBRA line is back',
     await p.evaluate(() => { const b = document.querySelector('#emph [data-em="loss"]'); return !b.hidden && b.getAttribute('aria-pressed') === 'true'; }) && /keeping this coverage through COBRA/.test(await txt()));
  await p.locator('#emph button[data-em="nation"]').click(); await p.waitForTimeout(250);
  ok('the national block quotes both sides with their labels on',
     /Koch-funded/.test(await txt()) && /Lancet/.test(await txt()));
  await p.locator('#emph button[data-em="story"]').click(); await p.waitForTimeout(250);
  ok('the story toggle inserts the writing prompt',
     await p.evaluate(()=>!!document.querySelector('#letterBd .hint')));
  const before = await count();
  await p.locator('#emph button[data-em="loss"]').click(); await p.waitForTimeout(250);
  ok('dropping the job-loss addition drops its paragraph', (await count()) < before && !/keeping this coverage through COBRA/.test(await txt()));
  await p.locator('#emph button[data-em="loss"]').click(); await p.waitForTimeout(250);
  // the additions follow the route: job loss is an employer worry, the persona group is not for the uninsured
  await p.locator('#route button[data-r="marketplace"]').click(); await p.waitForTimeout(250);
  ok('marketplace route: self-employed is the persona, so the job-loss addition is hidden',
     await p.evaluate(() => document.querySelector('#emph [data-em="loss"]').hidden && !document.getElementById('persona').hidden) && JSON.stringify(await checked()) === '["mkt"]');
  await p.locator('#route button[data-r="none"]').click(); await p.waitForTimeout(250);
  ok('uninsured route: no persona group, and the letter still tells the household\'s story',
     await p.evaluate(() => document.getElementById('persona').hidden && getComputedStyle(document.getElementById('persona')).display === 'none') && /uninsured today/.test(await txt()));
  await p.locator('#route button[data-r="employer"]').click(); await p.waitForTimeout(250);
  ok('back on the employer route the group returns with the employer persona', JSON.stringify(await checked()) === '["emp"]' && await p.evaluate(() => !document.getElementById('persona').hidden && !document.querySelector('#emph [data-em="loss"]').hidden));

  await p.locator('#letterBd > div').first().click();
  await p.keyboard.press('End'); await p.keyboard.type(' XEDITX');
  await setIncome(p, 120000);
  ok('a hand edit survives an income change', /XEDITX/.test(await txt()));
  ok('while the figures inside stay live', await p.evaluate(()=>
     document.querySelector('#letterBd [data-fig="uni.rangeLo"]').textContent.length > 1));
  ok('and the header discloses the edit', await p.evaluate(()=>
     /Edited by you/.test(document.getElementById('letterCount').textContent)));
  await p.close();
});

test('letter: send, copy and print work without the letter leaving the browser', async b => {
  const p = await page(b,1440,900);
  // The default letter (job-loss paragraph on, plus the dated cosponsor sentence) now
  // runs past the mailto limit; a shorter one still rides the link as the body.
  await p.locator('#emph .chk[data-em="loss"]').click(); await p.waitForTimeout(200);
  const href = await p.evaluate(()=>document.getElementById('sendBtn').getAttribute('href'));
  ok('send is a mailto with the letter as the body',
     href.startsWith('mailto:?subject=') && decodeURIComponent(href).includes('Dear Representative'));
  await p.locator('#copyBtn').click(); await p.waitForTimeout(250);
  ok('copy confirms itself', await p.evaluate(()=>
     document.getElementById('copyBtn').textContent.includes('Copied')));
  await p.evaluate(()=>{ window.print = () => {}; });
  await p.locator('#printBtn').click(); await p.waitForTimeout(100);
  await p.emulateMedia({media:'print'});
  const pr = await p.evaluate(()=>({
    hero: getComputedStyle(document.querySelector('h1')).display,
    letter: getComputedStyle(document.querySelector('.letter .bd')).display,
    chrome: getComputedStyle(document.querySelector('.letter .ft')).display }));
  ok('print shows the letter and nothing else',
     pr.hero==='none' && pr.letter!=='none' && pr.chrome==='none', JSON.stringify(pr));
  await p.close();
});

/* The rep card's one unforgivable failure is guessing: about a quarter of
 * covered ZIPs genuinely span districts, and a wrong guess mails someone to
 * the wrong office. So: named when the ZIP is unambiguous, asked when it is
 * not, and the cosponsor claim carries its as-of date. */
test('rep: named from the ZIP, asked when the ZIP is ambiguous', async b => {
  const p = await page(b,1440,900);
  const st = () => p.evaluate(()=>({
    name: document.getElementById('repName').textContent,
    dist: document.getElementById('repDistrict').textContent,
    pos: document.getElementById('repPos').textContent,
    pick: !document.getElementById('repPick').hidden,
    hedge: !document.getElementById('repHedge').hidden,
    sal: document.getElementById('letterBd').innerText.split('\n')[0] }));

  let r = await st();
  ok('a one-district ZIP names the member', /Crockett\s\(D\)/.test(r.name), r.name);
  ok('and says where the district came from', /from ZIP\u00a075201/.test(r.dist));
  ok('with the boundary hedge showing', r.hedge);
  ok('cosponsorship is stated', /Cosponsor of H\.R\. 3069/.test(r.pos), r.pos);
  ok('the letter greets them by name', /Dear Representative Crockett,/.test(r.sal), r.sal);

  await p.locator('#zip').fill('10001'); await p.locator('#zipGo').click(); await p.waitForTimeout(400);
  r = await st();
  ok('a split ZIP asks instead of guessing', /share your ZIP/.test(r.name) && r.pick, r.name);
  ok('and the letter falls back to the placeholder', /\[name\]/.test(r.sal));
  ok('the picker offers each district by name', await p.evaluate(()=>
     document.querySelectorAll('#repPickBtns button').length === 2));

  await p.locator('#repPickBtns button[data-d="NY-12"]').click(); await p.waitForTimeout(300);
  r = await st();
  ok('picking resolves it', /Nadler\s\(D\)/.test(r.name) && /your pick/.test(r.dist), r.name);
  ok('and the letter follows', /Dear Representative Nadler,/.test(r.sal));

  await p.locator('#zip').fill('33125'); await p.locator('#zipGo').click(); await p.waitForTimeout(400);
  await p.locator('#repPickBtns button[data-d="FL-26"]').click(); await p.waitForTimeout(300);
  r = await st();
  ok('a non-cosponsor is stated plainly', /^Not yet a cosponsor$/.test(r.pos), r.pos);
  // the as-of date lives on its own line under the rows, for both claims, and
  // the position row never wraps (the inline date used to break mid-string)
  const asOf = await p.evaluate(()=>({
    shown: !document.getElementById('repAsOf').hidden,
    txt: document.getElementById('repAsOf').textContent,
    oneLine: document.getElementById('repPos').getBoundingClientRect().height < 22 }));
  ok('the as-of date rides its own line', asOf.shown && /as of \d{1,2} [A-Z][a-z]+ \d{4}\./.test(asOf.txt), asOf.txt);   // long date, like every other date on the page
  ok('and the position row stays on one line', asOf.oneLine);

  // the portrait: src keyed by the member's bioguide id, silhouette on failure
  const ph = await p.evaluate(()=>({
    src: document.getElementById('repPhoto').getAttribute('src') || '',
    b: REPS.house['FL-26'].b }));
  ok('the portrait is keyed by bioguide id', ph.src.includes('/congress/225x275/' + ph.b + '.jpg'), ph.src);
  ok('a failed load falls back to the silhouette', await p.evaluate(()=>{
    const i = document.getElementById('repPhoto');
    i.dispatchEvent(new Event('error'));
    return i.hidden; }));

  // nationwide now: a Connecticut suburb far outside the old metros, and an
  // at-large state that must never render as a "0th district"
  await p.locator('#zip').fill('06468'); await p.locator('#zipGo').click(); await p.waitForTimeout(400);
  r = await st();
  ok('a ZIP outside the old metros resolves', /Himes\s\(D\)/.test(r.name), r.name);
  ok('and names the district', /Connecticut’s 4th district/.test(r.dist), r.dist);
  await p.locator('#zip').fill('99501'); await p.locator('#zipGo').click(); await p.waitForTimeout(400);
  r = await st();
  ok('an at-large seat never says 0th', /at-large district/.test(r.dist) && !/0th/.test(r.dist), r.dist);

  // a sample button is a real ZIP now, so it resolves the card like typing one
  await p.locator('#areapick button[data-z="75201"]').click(); await p.waitForTimeout(400);
  r = await st();
  ok('a sample click is a ZIP: the card follows', /Crockett/.test(r.name), r.name);

  // the senators row: both of the state's senators with their own positions,
  // portraits keyed by bioguide, hidden while a split ZIP is unresolved
  const sen = await p.evaluate(()=>({
    hidden: document.getElementById('senBlock').hidden,
    rows: [...document.querySelectorAll('#senRows .senrow')].map(x=>({
      n: x.querySelector('.sen-n').textContent,
      s: x.querySelector('.sen-s').textContent,
      src: (x.querySelector('img').getAttribute('src')||''),
      oneLine: x.getBoundingClientRect().height < 58 })),   // 42px portrait + the hit's 6px padding each side
    bill: document.getElementById('senBillLbl').textContent,
    bio: REPS.senate.TX.map(m=>m.b) }));
  ok('two senators for the state', !sen.hidden && sen.rows.length === 2, JSON.stringify(sen.rows.map(x=>x.n)));
  ok('the block names the companion bill', sen.bill === 'S. 1506', sen.bill);
  ok('each carries a position', sen.rows.every(x=>/^(Cosponsor|Not yet)$/.test(x.s)), sen.rows.map(x=>x.s).join('/'));
  ok('portraits keyed by bioguide', sen.rows.every((x,i)=>x.src.includes(sen.bio[i])), sen.rows.map(x=>x.src.slice(-16)).join(' '));
  ok('rows stay compact', sen.rows.every(x=>x.oneLine));

  await p.locator('#zip').fill('10001'); await p.locator('#zipGo').click(); await p.waitForTimeout(400);
  ok('a split hides the senators until the pick', await p.evaluate(()=>document.getElementById('senBlock').hidden));
  await p.locator('#repPickBtns button[data-d="NY-12"]').click(); await p.waitForTimeout(400);
  const ny = await p.evaluate(()=>[...document.querySelectorAll('#senRows .senrow')].map(x=>
    x.querySelector('.sen-n').textContent + ' ' + x.querySelector('.sen-s').textContent));
  ok('a cosponsoring senator says so', ny.some(x=>/Gillibrand.*Cosponsor/.test(x)), ny.join(' | '));
  await p.close();
});

test('reps: the snapshot is coherent, nationwide', async () => {
  const { readFileSync } = await import('node:fs');
  const txt = readFileSync(resolve(HERE, '../src/reps.js'), 'utf-8');
  const REPS = new Function(txt + '; return REPS;')();
  ok('carries its retrieval date', /^\d{4}-\d{2}-\d{2}$/.test(REPS.asOf), REPS.asOf);
  let zips = 0, splits = 0, badKey = 0;
  const dists = new Set();
  for (const [p3, m] of Object.entries(REPS.zip)) {
    if (!/^\d{3}$/.test(p3)) badKey++;
    for (const [suf, v] of Object.entries(m)) {
      if (!/^\d{2}$/.test(suf)) badKey++;
      zips++;
      const ds = typeof v === 'string' ? [v] : v;
      if (ds.length > 1) splits++;
      for (const d of ds) dists.add(d);
    }
  }
  ok('covers the whole country', zips > 30000, `${zips} ZIPs`);
  ok('every key is prefix + suffix digits', badKey === 0, `${badKey} bad`);
  ok('splits are real but a minority', splits / zips > 0.1 && splits / zips < 0.4,
     `${splits} splits (${(splits / zips * 100).toFixed(0)}%)`);
  ok('every district is well-formed', [...dists].every(d=>/^[A-Z]{2}-\d+$/.test(d)));
  const orphan = [...dists].filter(d=>!REPS.house[d]);
  ok('only genuine vacancies lack a member', orphan.length <= 6, orphan.join(', '));
  ok('every member has a name and party', Object.values(REPS.house).every(m=>m.n && /^[DRI]$/.test(m.p)));
  ok('a full house', Object.keys(REPS.house).length >= 430, Object.keys(REPS.house).length + ' members');
  ok('one hundred senators, two per state', Object.values(REPS.senate).every(a=>a.length===2)
     && Object.values(REPS.senate).flat().length === 100);
  ok('at-large seats use district 0', REPS.house['AK-0'] != null && REPS.house['WY-0'] != null);
});

/* The privacy note in the letter's footer takes a full row of its own, left-
 * aligned under the buttons -- it once wore a 190px cap and ran three cramped
 * right-aligned lines, and a flexible-width version still right-aligned it
 * mid-air when it wrapped. */
test('letter: the privacy note sits left-aligned under the buttons', async b => {
  for (const w of [1440, 900, 390]) {
    const p = await page(b,w,900);
    const r = await p.evaluate(()=>{
      const el = document.querySelector('.letter .ft p');
      const btn = document.getElementById('formBtn');   // the first button in the row
      const range = document.createRange(); range.selectNodeContents(el);
      const lines = new Set([...range.getClientRects()].filter(x=>x.height>1).map(x=>Math.round(x.top)));
      const er = el.getBoundingClientRect(), br = btn.getBoundingClientRect();
      const tr = [...range.getClientRects()].filter(x=>x.height>1)[0];
      return { w: er.width, lines: lines.size,
               under: er.top >= br.bottom,
               flush: Math.abs(tr.left - br.left) };
    });
    // the note carries the copy-and-paste flow now, so it runs longer than the
    // old one-liner; the caps keep it from becoming a paragraph. Since the letter
    // gained its dated cosponsor sentence, the default letter is past the mailto
    // limit, so the one-line "paste it in" sentence shows by default: one more line.
    ok(`${w}px: under the buttons, text flush with their left edge, ${r.lines} line${r.lines>1?'s':''}`,
       r.under && r.flush < 1 && r.lines <= (w <= 390 ? 7 : 4), `flush Δ${r.flush.toFixed(1)}px`);
    await p.close();
  }
});

test('content: no dead links or stale placeholders', async b => {
  const p = await page(b,1440,900);
  const r = await p.evaluate(()=>({
    deadNav:[...document.querySelectorAll('nav span, footer span')].filter(e=>/How it works|Sources|About/.test(e.textContent)).length,
    bill:document.getElementById('repBill').textContent,
    letterBill:document.getElementById('letterBill').textContent,
    blanks:(document.body.innerText.match(/H\.R\. ____|\[N\] |this week/g)||[]).length }));
  ok('no orphan nav items', r.deadNav === 0, `${r.deadNav}`);
  ok('bill number rendered', /H\.R\. 3069/.test(r.bill), r.bill);
  ok('letter names the bill', /H\.R\. 3069/.test(r.letterBill), r.letterBill);
  ok('no blank placeholders', r.blanks === 0, `${r.blanks}`);
  await p.close();
});

/* The ZIP submit scrolls the instrument into view, and the sticky results bar
 * floats over the top of the page, so without a scroll margin the section
 * title parks underneath it. Measured, not assumed, at both bar layouts. */
test('scroll: the ZIP submit clears the sticky bar', async b => {
  for (const [w, h] of [[1280, 900], [800, 900]]) {
    const p = await page(b, w, h);
    await p.locator('#zip').fill('60601'); await p.locator('#zipGo').click();
    await p.waitForTimeout(1000);   // smooth scroll settles
    const g = await p.evaluate(() => ({
      instr: document.querySelector('.instr').getBoundingClientRect().top,
      bar: document.querySelector('.sticky').getBoundingClientRect().bottom
    }));
    ok(`${w}px: the section starts below the bar`, g.instr >= g.bar - 0.5,
       `instr ${g.instr.toFixed(1)} vs bar ${g.bar.toFixed(1)}`);
    await p.close();
  }
});

/* Launch furniture: share metadata on both documents, the branded 404, the
 * crawler files, and the artifact OUT of the deploy directory. All asserted
 * against the built output, because a stale dist/artifact.html once survived
 * a build change and would have deployed a bare duplicate of the site. */
test('launch: share metadata, 404, crawler files, no artifact in dist', async b => {
  const { existsSync, readFileSync: rf } = await import('node:fs');
  ok('the artifact is not in the deploy directory', !existsSync(resolve(HERE, '../dist/artifact.html')));
  ok('the artifact builds outside it', existsSync(resolve(HERE, '../preview/artifact.html')));
  for (const f of ['card.png', 'mark.png', '404.html', 'robots.txt', 'sitemap.txt', '_headers'])
    ok(f + ' ships', existsSync(resolve(HERE, '../dist/' + f)));
  ok('the sitemap lists all three pages', /thewholebill\.org\/\n.*thewholebill\.org\/methodology\n.*thewholebill\.org\/updates/s.test(rf(resolve(HERE, '../dist/sitemap.txt'), 'utf-8')));

  const p = await page(b, 1280, 900);
  const m = await p.evaluate(() => ({
    desc: (document.querySelector('meta[name="description"]') || {}).content || '',
    ogImage: (document.querySelector('meta[property="og:image"]') || {}).content || '',
    ogUrl: (document.querySelector('meta[property="og:url"]') || {}).content || '',
    canon: (document.querySelector('link[rel="canonical"]') || {}).href || '',
    twitter: (document.querySelector('meta[name="twitter:card"]') || {}).content || '' }));
  ok('index carries a description', m.desc.length > 80 && m.desc.length < 170, m.desc.length + ' chars');
  ok('and an absolute share image', m.ogImage === 'https://thewholebill.org/card.png', m.ogImage);
  ok('and its canonical URL', m.canon === 'https://thewholebill.org/' && m.ogUrl === m.canon, m.canon);
  ok('and a large-image twitter card', m.twitter === 'summary_large_image');
  await p.close();

  const pm = await page(b, 1280, 900, false, 'methodology/index.html');
  const mm = await pm.evaluate(() => ({
    title: document.title,
    ogTitle: (document.querySelector('meta[property="og:title"]') || {}).content || '',
    ogUrl: (document.querySelector('meta[property="og:url"]') || {}).content || '',
    canon: (document.querySelector('link[rel="canonical"]') || {}).href || '',
    desc: (document.querySelector('meta[name="description"]') || {}).content || '' }));
  ok('methodology carries its own share identity',
     /^Methodology/.test(mm.ogTitle) && mm.ogUrl === 'https://thewholebill.org/methodology' &&
     mm.canon === mm.ogUrl && /traced to its source/.test(mm.desc), mm.ogUrl);
  await pm.close();

  // the 404: branded, links home and to the methodology, and dash-free
  const p4 = await page(b, 1280, 900, false, '404.html');
  const f = await p4.evaluate(() => ({
    home: !!document.querySelector('a[href="/"]'),
    meth: !!document.querySelector('a[href="/methodology"]'),
    noindex: ((document.querySelector('meta[name="robots"]') || {}).content || '') === 'noindex',
    dashes: (document.body.textContent.match(/[–—]/g) || []).length }));
  ok('the 404 links home and to the methodology', f.home && f.meth);
  ok('the 404 is noindex and dash-free', f.noindex && f.dashes === 0);
  await p4.close();
});

/* The credit's floor. A Texas family at 93% of the poverty line used to be
 * shown a $25,108 credit labelled statutory; the statute gives it none, and
 * every surface that carried the credit (eligibility box, bar note, letter)
 * has to say so in the same breath. */
test('marketplace: below the floor and in Medicaid\'s range there is no credit, and the page says why', async b => {
  const p = await page(b, 1280, 900);
  await p.locator('#route button[data-r="marketplace"]').click(); await p.waitForTimeout(250);
  await setIncome(p, 30000);
  let t = await p.evaluate(() => ({ elig: document.getElementById('elig').innerText,
    note: document.getElementById('mktNote').innerText, letter: document.getElementById('letterBd').innerText }));
  ok('coverage gap: the eligibility box says no credit', /no credit at all/.test(t.elig) && /Texas has not expanded Medicaid/.test(t.elig), t.elig.slice(0, 120));
  ok('coverage gap: the bar note says why there is no subsidy', /below the credit/.test(t.note), t.note);
  ok('coverage gap: the letter claims no taxpayer help', /below the level where the marketplace tax credit begins/.test(t.letter) && !/taxpayer help/.test(t.letter));
  await p.locator('#zip').fill('06106'); await p.locator('#zipGo').click(); await p.waitForTimeout(350);
  await setAges(p, [40]);
  await setIncome(p, 20000);   // a single adult at 128% of the poverty line
  t = await p.evaluate(() => ({ elig: document.getElementById('elig').innerText, note: document.getElementById('mktNote').innerText }));
  ok('Medicaid range: the eligibility box names the state and its ceiling', /qualify for Medicaid in Connecticut/.test(t.elig) && /138%/.test(t.elig), t.elig.slice(0, 140));
  ok('Medicaid range: the bar note says so', /Medicaid/.test(t.note), t.note);
  await setIncome(p, 22000);
  t = await p.evaluate(() => document.getElementById('elig').innerText);
  ok('just above the ceiling the credit returns', /what you qualify for today/i.test(t) && /credit of \$/.test(t), t.slice(0, 100));
  await p.close();
});

/* Pre-launch review, PR 2: each of these shipped past the suite. */
test('rep card: hidden blocks are actually hidden, across ZIP changes', async b => {
  const p = await page(b, 1200, 900);
  const box = async id => p.evaluate(id => { const e = document.getElementById(id), r = e.getBoundingClientRect();
    return { hidden: e.hidden, h: Math.round(r.height), text: e.innerText.replace(/\s+/g, ' ').slice(0, 120) }; }, id);
  await p.locator('#zip').fill('30165'); await p.locator('#zipGo').click(); await p.waitForTimeout(350);
  await p.locator('#areapick button[data-k]').first().click(); await p.waitForTimeout(350);   // county first; then the district asks
  let s = await box('senBlock'), r = await box('repPick');
  ok('split ZIP: the senators block is hidden and measures nothing', s.hidden && s.h === 0, JSON.stringify(s));
  ok('split ZIP: the district chooser is showing', !r.hidden && r.h > 40, JSON.stringify(r));
  await p.locator('#zip').fill('33313'); await p.locator('#zipGo').click(); await p.waitForTimeout(350);
  r = await box('repPick'); s = await box('senBlock');
  ok('next ZIP: the stale chooser is gone', r.hidden && r.h === 0, JSON.stringify(r));
  ok('next ZIP: the senators are Florida\'s', !s.hidden && /Scott|Moody/.test(s.text), s.text);
  await p.close();
});

test('print: the letter prints on one page', async b => {
  const p = await page(b, 1280, 900);
  await p.evaluate(() => { window.print = () => {}; });   // headless has no dialog and fires no afterprint
  await p.locator('#printBtn').click(); await p.waitForTimeout(100);
  await p.emulateMedia({ media: 'print' });
  const letterBox = await p.evaluate(() => { const r = document.querySelector('.letter .bd').getBoundingClientRect(); return { w: r.width, h: r.height }; });
  ok('print: the letter body has size', letterBox.w > 300 && letterBox.h > 300, JSON.stringify(letterBox));
  for (const format of ['Letter', 'A4']) {
    await p.evaluate(() => document.getElementById('printBtn').click()); await p.waitForTimeout(100);   // page.pdf fires afterprint, which disarms; the button is display:none in print media
    const buf = await p.pdf({ format });
    const pages = (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    ok(`print: ${format} is exactly one page`, pages === 1, `${pages} pages`);
  }
  await p.emulateMedia({ media: 'screen' });
  await p.close();
});

test('letter: a reader\'s edit never freezes the calculator', async b => {
  const p = await page(b, 1280, 900);
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.evaluate(() => { const l = document.getElementById('letterBd');
    l.innerHTML = '<p>Dear Representative, a short note of my own.</p>'; l.dispatchEvent(new Event('input', { bubbles: true })); });
  await setIncome(p, 120000);
  ok('after an edit the figures still move', await p.evaluate(() => document.getElementById('incomeVal').textContent) === '$120,000');
  ok('and nothing threw', errs.length === 0, errs[0] || '');
  await p.close();
});

test('split ZIP: the rep card waits for the county, like the figures', async b => {
  const p = await page(b, 1280, 900);
  const read = () => p.evaluate(() => ({ place: document.getElementById('placeName').textContent,
    rep: document.getElementById('repName').textContent, letter: document.getElementById('letterBd').innerText.slice(0, 120) }));
  await p.locator('#zip').fill('10537'); await p.locator('#zipGo').click(); await p.waitForTimeout(350);   // Putnam / Westchester, NY
  let r = await read();
  ok('before the pick, place and rep still agree (both the previous ZIP)', /Dallas/.test(r.place) && /Crockett/.test(r.rep), `${r.place} / ${r.rep}`);
  await p.locator('#areapick button[data-k]').first().click(); await p.waitForTimeout(350);
  r = await read();
  ok('after the pick, both moved together', /NY/.test(r.place) && /Lawler/.test(r.rep), `${r.place} / ${r.rep}`);
  ok('and the letter names the new county to the new member', /Lawler/.test(r.letter) && /(Putnam|Westchester) County/.test(r.letter) && !/Dallas/.test(r.letter), r.letter);
  await p.close();
});

test('scope: county names that end in City, Columbia or Island keep their "County"', async b => {
  const p = await page(b, 1280, 900);
  for (const [z, want] of [['12017', 'Columbia County · NY'], ['98236', 'Island County · WA'], ['23081', 'James City County · VA'], ['89701', 'Carson City · NV'], ['20001', 'District of Columbia · DC']]) {
    await p.locator('#zip').fill(z); await p.locator('#zipGo').click(); await p.waitForTimeout(300);
    const got = await p.evaluate(() => document.getElementById('placeName').textContent);
    ok(`${z} reads "${want}"`, got === want, got);
  }
  await p.close();
});

test('range strip: the band stays inside the strip', async b => {
  const p = await page(b, 1440, 900);
  await setAges(p, [40]);
  await setIncome(p, 260000);
  const g = await p.evaluate(() => { const band = document.getElementById('rangeBand').getBoundingClientRect(),
    strip = document.querySelector('.range').getBoundingClientRect(), mk = document.getElementById('mk').getBoundingClientRect();
    return { band: Math.round(band.right - strip.right), mk: Math.round(mk.right - strip.right), left: Math.round(band.left - strip.left) }; });
  ok('single adult at $260,000: the band ends inside the strip', g.band <= 0 && g.left >= 0, `band overruns by ${g.band}px`);
  ok('and the marker does too', g.mk <= 2, `marker overruns by ${g.mk}px`);
  await p.close();
});

/* The site's public copy carries no em or en dashes: the owner's standing
 * style rule (CLAUDE.md, Language). Code comments are exempt. This scans what
 * a reader can see, across every state that swaps copy in: routes, models,
 * tones, emphases, subsidy states, ZIP states and the methodology view. The
 * hidden parts of the DOM are included, so both slot-03 variants and the
 * methodology section are always in scope no matter which state is showing. */
test('language: no em or en dashes anywhere a reader can see', async b => {
  const p = await page(b, 1280, 900);
  const scan = async label => {
    const hits = await p.evaluate(() => {
      const c = document.body.cloneNode(true);
      c.querySelectorAll('script,style').forEach(n => n.remove());
      const t = c.textContent + ' ' + document.title;
      return { m: (t.match(/[^\n]{0,25}[–—][^\n]{0,25}/g) || []).slice(0, 3), len: t.length };
    });
    ok(`no dashes: ${label}`, hits.m.length === 0, hits.m.join(' | '));
    return hits.len;
  };
  // guard against a silently empty scan: the page holds tens of thousands of
  // characters of copy, and a scan that sees almost none of it proves nothing
  const len = await scan('on load');
  ok('the scan is reading real copy', len > 10000, `${len} chars`);
  for (const r of ['marketplace', 'none', 'employer']) {
    await p.locator(`#route button[data-r="${r}"]`).click(); await p.waitForTimeout(250);
    await scan(`route ${r}`);
  }
  for (let i = 0; i < 6; i++) {
    await p.locator('.pills .pill').nth(i).click(); await p.waitForTimeout(250);
    await scan(`model ${i + 1} of 6`);
  }
  for (const t of ['measured', 'personal', 'direct']) {
    await p.locator(`.tbtn[data-tone="${t}"]`).click(); await p.waitForTimeout(250);
    await scan(`tone ${t}`);
  }
  for (const e of ['nation', 'story']) { await p.locator(`#emph .chk[data-em="${e}"]`).click(); await p.waitForTimeout(150); }
  await scan('every employer-side letter block');
  await p.locator('#route button[data-r="marketplace"]').click(); await p.waitForTimeout(250);
  for (const e of ['nation', 'story']) { await p.locator(`#emph .chk[data-em="${e}"]`).click(); await p.waitForTimeout(150); }
  await scan('every marketplace letter block');
  // the marketplace route checks the self-employed persona; the retiree replaces it
  await p.locator('#persona .chk[data-who="ret"]').click(); await p.waitForTimeout(150);
  await setAges(p, [62, 60]); await scan('the early-retiree letter and the age note under the cliff');
  await p.locator('#zip').fill('10001'); await p.locator('#zipGo').click(); await p.waitForTimeout(350);
  await scan('the age note in a state that does not rate by age');
  await p.locator('#zip').fill('75201'); await p.locator('#zipGo').click(); await p.waitForTimeout(350);
  await setAges(p, [41, 39, 12, 9]);
  await p.locator('#persona .chk[data-who="mkt"]').click(); await p.waitForTimeout(150);
  // recipient variants: the senator letters (non-cosponsor openings in TX)
  // across every tone; the cosponsor thank-you variants are the rep default
  for (const rec of ['sen0', 'sen1']) {
    await p.locator(`#senRows .rec-hit[data-rec="${rec}"]`).click(); await p.waitForTimeout(200);
    await scan(`letter to ${rec}`);
  }
  for (const t of ['measured', 'personal', 'direct']) {
    await p.locator(`#tone .tbtn[data-tone="${t}"]`).click(); await p.waitForTimeout(200);
    await scan(`senator letter, tone ${t}`);
  }
  await p.locator('#recRep').click(); await p.waitForTimeout(200);
  await setIncome(p, 40000);  await scan('subsidy qualifying, with CHIP');
  await setIncome(p, 240000); await scan('over the cliff');
  await setIncome(p, 30000);  await scan('below the credit floor, coverage gap');
  await setIncome(p, 95000);
  for (const z of ['10001', '44113', '06106']) {
    await p.locator('#zip').fill(z); await p.locator('#zipGo').click(); await p.waitForTimeout(350);
    await scan(`zip ${z}`);
  }
  await setIncome(p, 20000); await scan('Medicaid range in an expansion state');
  await p.locator('#zip').fill('20001'); await p.locator('#zipGo').click(); await p.waitForTimeout(350);
  await setAges(p, [21]); await setIncome(p, 62000); await scan('a credit that works out to $0, under the cliff');
  await setAges(p, [41, 39, 12, 9]);
  await setIncome(p, 95000);
  await p.locator('#route button[data-r="employer"]').click(); await p.waitForTimeout(250);   // the drawer belongs to the employer route
  await p.locator('#adv summary').click(); await p.waitForTimeout(150);
  await p.fill('#deduct', '1000'); await p.waitForTimeout(250); await scan('letter with a heavy paystub deduction');
  await p.fill('#deduct', ''); await p.waitForTimeout(150);
  await p.close();
  // the methodology is its own static document now; scan it whole
  const pm = await page(b, 1280, 900, false, 'methodology/index.html');
  const mHits = await pm.evaluate(() => {
    const t = document.body.textContent + ' ' + document.title;
    return (t.match(/[^\n]{0,25}[–—][^\n]{0,25}/g) || []).slice(0, 3);
  });
  ok('no dashes: the methodology document', mHits.length === 0, mHits.join(' | '));
  await pm.close();
  const pu = await page(b, 1280, 900, false, 'updates/index.html');
  const uHits = await pu.evaluate(() => {
    const t = document.body.textContent + ' ' + document.title;
    return (t.match(/[^\n]{0,25}[–—][^\n]{0,25}/g) || []).slice(0, 3);
  });
  ok('no dashes: the updates document', uHits.length === 0, uHits.join(' | '));
  await pu.close();
});

/* Every static figure in the HTML (what crawlers, reader mode and the share
 * unfurl see) is generated at build time from the default household, so it
 * must equal what the page paints a moment later. Two figures for one
 * household on one page is the failure mode CLAUDE.md names. The letter is
 * excluded because its figures are deliberately rounded. */
test('placeholders: the static figures equal the first paint', async b => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(resolve(HERE, '../dist/index.html'), 'utf8');
  const stat = [...html.matchAll(/<[^>]*\bdata-fig="([^"]+)"[^>]*>(\$[\d,]+)</g)].map(m => [m[1], m[2]]);
  // the script also builds data-uw spans from strings; only real markup (plain words, no quotes or concatenation) counts
  const words = [...html.matchAll(/<[^>]*\bdata-uw="([^"]+)"[^>]*>([^<]+)</g)].map(m => [m[1], m[2]]).filter(([, v]) => /^[a-z\/ ]+$/.test(v));
  ok('the markup carries placeholder figures', stat.length >= 15, stat.length + ' figures, ' + words.length + ' unit words');
  ok('no hand-typed figure survived the build', !/8,278|31,578|23,300|27,200|30,200|nine thousand/.test(html));
  const p = await page(b, 1280, 900);
  const live = await p.evaluate(() => {
    const out = { fig: {}, uw: {} };
    document.querySelectorAll('[data-fig]').forEach(e => {
      if (e.closest('#letterBd')) return;
      const k = e.getAttribute('data-fig'), v = e.textContent.trim();
      (out.fig[k] = out.fig[k] || []).includes(v) || out.fig[k].push(v);
    });
    document.querySelectorAll('[data-uw]').forEach(e => {
      if (e.closest('#letterBd')) return;
      const k = e.getAttribute('data-uw'), v = e.textContent.trim();
      (out.uw[k] = out.uw[k] || []).includes(v) || out.uw[k].push(v);
    });
    out.h2 = document.querySelector('#cliffView h2').textContent.replace(/\s+/g, ' ').trim();
    out.drop = document.getElementById('cliffDrop').textContent.trim();
    return out;
  });
  const seen = new Set();
  for (const [k, v] of stat) {
    if (seen.has(k)) continue; seen.add(k);
    const l = live.fig[k] || [];
    ok(`${k}: static ${v} is what the page paints`, l.length === 1 && l[0] === v, l.join(' / '));
  }
  for (const [k, v] of words) {
    const l = live.uw[k] || [];
    ok(`unit word ${k}: static "${v}" is what the page paints`, l.length === 1 && l[0] === v, l.join(' / '));
  }
  ok('the cliff heading prints the stat card\'s own drop', live.h2 === `One dollar, ${live.drop}.`, live.h2);
  await p.close();
});

/* The section 03 heading used to read "One dollar, nine thousand dollars"
 * above a stat card that said $12,980. It is bound to the household's own drop
 * now, and follows the household to another county and into the month view. */
test('cliff: the heading follows the household\'s own drop', async b => {
  const p = await page(b, 1280, 900);
  const read = () => p.evaluate(() => ({
    h2: document.querySelector('#cliffView h2').textContent.replace(/\s+/g, ' ').trim(),
    drop: document.getElementById('cliffDrop').textContent.trim() }));
  const dal = await read();
  ok('Dallas: heading and card agree', dal.h2 === `One dollar, ${dal.drop}.`, dal.h2);
  ok('the old hardcoded phrase is gone', !/nine thousand/.test(dal.h2));
  await p.locator('#zip').fill('06106'); await p.locator('#zipGo').click(); await p.waitForTimeout(400);
  const hart = await read();
  ok('Hartford: a different drop', hart.drop !== dal.drop, `${dal.drop} → ${hart.drop}`);
  ok('Hartford: heading and card still agree', hart.h2 === `One dollar, ${hart.drop}.`, hart.h2);
  await p.locator('#unit').click(); await p.waitForTimeout(400);
  const mon = await read();
  const n = s => +s.replace(/[^0-9]/g, '');
  ok('month view: the heading divides with the card', mon.h2 === `One dollar, ${mon.drop}.` && Math.abs(n(hart.drop) / 12 - n(mon.drop)) <= 1, mon.h2);
  await p.close();
});

/* "Less than a quarter of it shows up as the premium deduction" was true at
 * the survey average and false the moment a reader typed their own deduction
 * into the drawer; the sentence goes to a congressional office under their
 * name. It is bucketed on the real share now. The same paragraph also broke
 * the site's spends/costs rule. */
test('letter: the paystub share sentence follows the drawer', async b => {
  const p = await page(b, 1440, 900);
  const txt = () => p.evaluate(() => document.getElementById('letterBd').innerText);
  const t0 = await txt();
  ok('opens on what healthcare costs, not what the household spends',
     /what healthcare actually costs my household/.test(t0) && !/actually spends/.test(t0));
  ok('survey average: less than a quarter', /Less than a quarter of it shows up as the premium deduction/.test(t0));
  await setIncome(p, 30000);   // TX family at 93% FPL: the floor, with no exception offered
  ok('the floor copy offers no immigrant exception', !/exception; they can take the credit/.test(await p.evaluate(() => document.body.innerText)));
  await setIncome(p, 95000);
  await p.locator('#adv summary').click(); await p.waitForTimeout(150);
  await p.fill('#deduct', '500'); await p.waitForTimeout(250);         // $13,000 a year: 34%
  ok('$500 biweekly: about a third', /Only about a third of it shows up/.test(await txt()));
  await p.fill('#deduct', '1000'); await p.waitForTimeout(250);        // $26,000 a year: 51%
  ok('$1,000 biweekly: about half', /About half of it shows up/.test(await txt()));
  await p.fill('#deduct', '2000'); await p.waitForTimeout(250);        // $52,000 a year: 67%
  ok('$2,000 biweekly: most of it', /Most of it shows up/.test(await txt()));
  await p.fill('#deduct', ''); await p.waitForTimeout(250);
  ok('cleared: back to less than a quarter', /Less than a quarter of it/.test(await txt()));
  await p.close();
});

/* The methodology page prints the six financing derivations and invites the
 * reader to redo the arithmetic, so the printed figures must be exactly what
 * calc.js computes: the allocations are rounded to the dollar once, in
 * calc.js, and the Sanders exemption is the 2026 standard deduction. */
test('calc: financing models reproduce the methodology page to the dollar', async () => {
  const { createRequire } = await import('node:module');
  const { readFileSync } = await import('node:fs');
  const require = createRequire(import.meta.url);
  const W = require('../src/calc.js');
  W.useBenchmarks(require('../src/benchmarks.js'));
  const fam = W.universalCost('sanders1', 95000, 4), one = W.universalCost('sanders1', 95000, 1);
  ok('Sanders exempts the 2026 joint standard deduction, $32,200', fam.parts.premium === 0.04 * (95000 - 32200), `$${fam.parts.premium}`);
  ok('and the single one, $16,100', one.parts.premium === 0.04 * (95000 - 16100), `$${one.parts.premium}`);
  ok('the default family pays $9,637 under Sanders', fam.total === 9637, `$${fam.total}`);
  const ids = ['sanders1', 'galvani', 'rand', 'cbo5', 'blahous', 'urban'];
  const adders = { rand: 510, cbo5: 2151, blahous: 2413, urban: 5339 };
  for (const id of Object.keys(adders)) {
    const u = W.universalCost(id, 95000, 4), k = Object.keys(u.parts).find(x => /Gap$/.test(x));
    ok(`${id}: allocation is a whole-dollar $${adders[id]}`, u.parts[k] === adders[id], `$${u.parts[k]}`);
    ok(`${id}: total is the integer sum`, Number.isInteger(u.total) && u.total === 9637 + adders[id], `$${u.total}`);
  }
  const html = readFileSync(resolve(HERE, '../dist/methodology/index.html'), 'utf8');
  const sec = html.slice(html.indexOf('What universal coverage would cost you'), html.indexOf('What a bad year costs without coverage'));
  const boxes = [...sec.matchAll(/<p class="body" style="font-family:var\(--mono\)[^"]*">([\s\S]*?)<\/p>/g)].map(m => m[1]);
  ok('six derivation boxes on the methodology page', boxes.length === 6, boxes.length + ' boxes');
  const n = s => +s.replace(/[^0-9]/g, '');
  boxes.forEach((bx, i) => {
    const bolds = [...bx.matchAll(/<b>([^<]*)<\/b>/g)].map(m => m[1]);
    const total = n(bolds[bolds.length - 1]);
    const u = W.universalCost(ids[i], 95000, 4);
    ok(`methodology ${ids[i]}: printed total $${total.toLocaleString('en-US')} is what calc.js computes`, total === u.total, `calc $${u.total}`);
    if (adders[ids[i]]) {
      const per = /= <b>\$([\d,]+)<\/b> per household/.exec(bx);
      ok(`methodology ${ids[i]}: printed allocation matches`, per && n(per[1]) === adders[ids[i]], per && per[1]);
    }
  });
  ok('the methodology cites Rev. Proc. 2025-32 for the exemption', /Rev\. Proc\. 2025-32/.test(html));
  ok('no stale $29,200 exemption anywhere on the page', !/29,200/.test(html));
});

/* The prose half of the launch review: copy that had drifted behind the code.
 * Each assertion derives its expectation from calc.js or benchmarks.js, so a
 * data change fails here rather than shipping a sentence the data contradicts. */
test('prose: the methodology page says what the data says', async () => {
  const { createRequire } = await import('node:module');
  const { readFileSync } = await import('node:fs');
  const require = createRequire(import.meta.url);
  const W = require('../src/calc.js'), B = require('../src/benchmarks.js');
  W.useBenchmarks(B);
  const html = readFileSync(resolve(HERE, '../dist/methodology/index.html'), 'utf8');
  const text = html.replace(/<[^>]*>/g, ' ').replace(/&rsquo;/g, '’').replace(/\s+/g, ' ');
  // H2: the contribution paragraph quotes the worked household's own range and shares
  const S = W.summary({ income:95000, size:4, ages:[41,39,12,9], bkey:'48113', model:'sanders1' });
  const money = n => '$' + Math.round(n).toLocaleString('en-US');
  const lo = S.universalRange.lo, hi = S.universalRange.hi, tot = S.employer.total;
  const want = `${money(lo)} to ${money(hi)}`, pct = `${Math.round(lo / tot * 100)}% to ${Math.round(hi / tot * 100)}%`;
  ok(`contribution paragraph quotes the model range ${want}`, text.includes(want) && text.includes(money(tot)), want);
  ok(`and its share of today's cost, ${pct}`, text.includes(pct), pct);
  ok('the invented 28 to 32% band is gone', !/28 to 32%|30,600/.test(text));
  // H3: the age-curve sentence names every state that leaves the federal curve
  const NAMES = { AL:'Alabama', MS:'Mississippi', OR:'Oregon', UT:'Utah', DC:'District of Columbia', MA:'Massachusetts', MN:'Minnesota', NY:'New York', VT:'Vermont' };
  const para = (text.match(/Each person is priced at their own age[^.]*\.(?:[^.]*\.){0,8}/) || [''])[0];
  ok('the age-curve paragraph is present', para.length > 200, para.slice(0, 80));
  let fedCount = 0;
  for (const [st, m] of Object.entries(B.states)) {
    if (m.curve === 'fed') { fedCount++; continue; }
    ok(`${st} leaves the federal curve and is named`, NAMES[st] && para.includes(NAMES[st]), `${st}: ${m.curve}`);
  }
  const WORDS = { 40:'Forty', 41:'Forty-one', 42:'Forty-two', 43:'Forty-three', 44:'Forty-four', 45:'Forty-five' };
  ok(`the count of federal-curve states is stated (${fedCount})`, WORDS[fedCount] && para.includes(WORDS[fedCount] + ' states'), String(fedCount));
  for (const st of Object.keys(NAMES)) if (B.states[st].curve === 'fed') ok(`${st} is not named as a departure`, !para.includes(NAMES[st]));
  // H13, H14: provenance
  ok('Urban is labelled with its funder', /financed by the Commonwealth Fund/.test(text));
  ok('CBO Option 5 discloses its payment-rate assumption', /payment rates above Medicare/.test(text));
  ok('the Yale preprint has a Sources row', /Lives saved, 114,174/.test(text) && /not peer reviewed/.test(text));
  ok('the three-million figure names CMS', /CMS effectuated enrollment/.test(text));
  ok('the Lancet payroll rate is the manuscript\'s 11.29%', /11\.29%/.test(text));
  // the reconciliation law of July 2025: no immigrant exception to the floor, no repayment cap
  ok('the immigrant exception to the floor is gone, with the law named', !/they can take the credit/.test(text) && /Public Law 119-21/.test(text));
  ok('repayment of excess credit is disclosed', /no cap on repaying excess advance credit/.test(text) && /from 2028 every enrollee must re-verify/.test(text));
});

/* Objection 01 and its footnote used to argue against the employer figure and a
 * $250,000 threshold no matter which route or household was on screen. */
test('prose: the objection argues against this household, on its route', async b => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(resolve(HERE, '../dist/index.html'), 'utf8');
  const p = await page(b, 1440, 900);
  const read = () => p.evaluate(() => ({
    fig: document.querySelector('[data-fig="route.replaced"]').textContent.trim(),
    tail: document.getElementById('objTail').textContent,
    cross: document.getElementById('crossText').textContent,
    wf: [...document.querySelectorAll('#wf .wcol:not(.wcol-total) .wlab')].map(e => e.textContent.replace(/[^0-9]/g, '')),
    cards: [...document.querySelectorAll('#cards .card-i .t')].map(e => e.textContent),
    intro: document.querySelector('#story p, .sec p') && document.body.innerText }));
  const n = s => +s.replace(/[^0-9]/g, '');
  const emp = await read();
  ok('employer: the figure is what universal coverage replaces (borne less Medicare tax)',
     n(emp.fig) === n(emp.wf[0]) + n(emp.wf[1]) + n(emp.wf[2]), `${emp.fig} vs ${emp.wf.join('+')}`);
  ok('employer: "it replaces"', /it replaces/.test(emp.tail));
  const staticCross = (html.match(/id="crossText">([^<]*)</) || [])[1];
  ok('default footnote: the static text is what the page paints', staticCross === emp.cross, emp.cross);
  ok('default family: one model crosses, the rest never do', /1 of the 6 models starts costing more than today at about \$2\d\d,000 of income, and the other 5 do not/.test(emp.cross), emp.cross);
  await p.locator('#route button[data-r="none"]').click(); await p.waitForTimeout(300);
  const un = await read();
  ok('uninsured: the figure is the care it pays for, not employer premiums', n(un.fig) === n(un.wf[0]) && n(un.fig) !== n(emp.fig), `${un.fig} vs ${un.wf[0]}`);
  ok('uninsured: the tail says care, not premiums', /care your household already pays for, at cost/.test(un.tail), un.tail);
  ok('uninsured: the footnote says some models cost more at every income', /costs? more than today at every income/.test(un.cross), un.cross);
  ok('uninsured card is "Care you use, at cost", never "in cash"', un.cards.some(t => /Care you use, at cost/.test(t)) && !/in cash/i.test(un.intro));
  await p.locator('#route button[data-r="marketplace"]').click(); await p.waitForTimeout(300);
  const mk = await read();
  ok('marketplace: the tail is what the household pays today', /your household pays today/.test(mk.tail), mk.tail);
  await p.locator('#route button[data-r="employer"]').click(); await p.waitForTimeout(300);
  await setAges(p, [40]); await p.waitForTimeout(300);
  const one = await read();
  ok('single adult: every model crosses, far below $250,000', /6 of the 6 models start costing more than today between \$\d\d,000 and \$1\d\d,000 of income/.test(one.cross), one.cross);
  await p.close();
});

test('prose: section 02 and the letter agree with the rest of the page', async b => {
  const p = await page(b, 1280, 900);
  const body = await p.evaluate(() => document.body.innerText);
  ok('section 02: two paystub lines, the largest never shown', /Two of them appear on a paystub\. The largest never does/.test(body));
  ok('the cliff intro claims only its section', /Nothing in this section is modeled/.test(body) && !/Nothing on this page is modeled/.test(body));
  await p.locator('#emph .chk[data-em="nation"]').click(); await p.waitForTimeout(200);
  const letter = await p.evaluate(() => document.getElementById('letterBd').innerText);
  ok('the letter no longer calls Mercatus the least friendly estimate', /Even the estimate from a Koch-funded center/.test(letter) && !/least friendly/.test(letter));
  await p.locator('#route button[data-r="none"]').click(); await p.waitForTimeout(300);
  const un = await p.evaluate(() => document.getElementById('letterBd').innerText);
  ok('the uninsured letter says "the care we use"', /between the care we use and the Medicare payroll tax/.test(un) && !/in cash/.test(un));
  await p.close();
});

/* Accessibility floors from the launch review (A1 to A10). Where the review
 * measured a pixel or a ratio, the test measures the same thing. */
const lum = rgb => { const c = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(v => { v = v / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contrast = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };

test('accessibility: focus, state, announcements and contrast', async b => {
  const p = await page(b, 1280, 900);
  // A1: the ZIP field and the slider show focus
  await p.focus('#zip');
  const zf = await p.evaluate(() => getComputedStyle(document.querySelector('.zipfield')).outlineStyle);
  ok('ZIP field shows a focus ring (focus-within)', zf !== 'none', zf);
  await p.keyboard.press('Tab'); await p.keyboard.press('Tab');
  await p.focus('#income'); await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowLeft');
  const sf = await p.evaluate(() => ({ el: document.activeElement.id, o: getComputedStyle(document.activeElement).outlineStyle, w: getComputedStyle(document.activeElement).outlineWidth }));
  ok('slider shows a focus ring on keyboard focus', sf.el === 'income' && sf.o !== 'none' && parseFloat(sf.w) >= 2, JSON.stringify(sf));
  // A2: pressed state and grouping on the four toggle groups
  const groups = await p.evaluate(() => ['#route', '#pills', '#tone', '#repPickBtns'].map(sel => {
    const g = document.querySelector(sel), lbl = document.getElementById(g.getAttribute('aria-labelledby') || '');
    const bs = [...g.querySelectorAll('button')];
    return { sel, role: g.getAttribute('role'), label: lbl ? lbl.textContent.trim() : null, n: bs.length,
             pressed: bs.filter(x => x.getAttribute('aria-pressed') === 'true').length,
             unlabelled: bs.filter(x => !x.hasAttribute('aria-pressed')).length,
             onMatches: bs.every(x => x.classList.contains('on') === (x.getAttribute('aria-pressed') === 'true')) };
  }));
  for (const g of groups) {
    if (g.n) ok(`${g.sel}: role=group with a real label`, g.role === 'group' && g.label && g.label.length > 2, JSON.stringify(g));
    if (g.n) ok(`${g.sel}: aria-pressed mirrors .on on every button`, g.unlabelled === 0 && g.pressed === 1 && g.onMatches, JSON.stringify(g));
  }
  await p.locator('#route button[data-r="marketplace"]').click(); await p.waitForTimeout(150);
  await p.locator('.pills .pill').nth(3).click(); await p.waitForTimeout(150);
  await p.locator('#tone .tbtn[data-tone="personal"]').click(); await p.waitForTimeout(150);
  const after = await p.evaluate(() => ['#route', '#pills', '#tone'].map(sel => [...document.querySelectorAll(sel + ' button')].map(x => x.getAttribute('aria-pressed') === 'true' ? 1 : 0).join('')));
  ok('pressed state follows the click on route, model and tone', after.join('|') === '010|000100|001', after.join('|'));
  await p.locator('#route button[data-r="employer"]').click(); await p.waitForTimeout(150);
  await p.fill('#zip', '30165'); await p.locator('#zipGo').click(); await p.waitForTimeout(400);   // a district-split ZIP (Rome, GA) shows the chooser
  await p.locator('#areapick button[data-k]').first().click(); await p.waitForTimeout(400);          // once the rating area is picked
  const rp = await p.evaluate(() => { const g = document.getElementById('repPickBtns'); const bs = [...g.querySelectorAll('button')];
    return { hidden: g.closest('[hidden]') !== null, n: bs.length, label: (document.getElementById(g.getAttribute('aria-labelledby')) || {}).textContent, pressed: bs.map(x => x.getAttribute('aria-pressed')) }; });
  ok('district chooser: labelled group, every button carries aria-pressed', !rp.hidden && rp.n >= 2 && rp.label && rp.label.length > 10 && rp.pressed.every(v => v === 'true' || v === 'false'), JSON.stringify(rp));
  await p.fill('#zip', '75201'); await p.locator('#zipGo').click(); await p.waitForTimeout(300);
  // A3: ZIP errors are announced and the field only takes digits
  const zipA = await p.evaluate(() => ({ role: document.getElementById('scope').getAttribute('role'), desc: document.getElementById('zip').getAttribute('aria-describedby'), ac: document.getElementById('zip').getAttribute('autocomplete') }));
  ok('scope is a status region the field points at', zipA.role === 'status' && zipA.desc === 'scope' && zipA.ac === 'postal-code', JSON.stringify(zipA));
  await p.fill('#zip', ''); await p.type('#zip', 'ab1x23'); await p.waitForTimeout(100);
  ok('letters are stripped as they are typed', (await p.inputValue('#zip')) === '123', await p.inputValue('#zip'));
  await p.locator('#zipGo').click(); await p.waitForTimeout(200);
  const inv = await p.evaluate(() => ({ inv: document.getElementById('zip').getAttribute('aria-invalid'), msg: document.getElementById('scope').textContent }));
  ok('a short ZIP marks the field invalid and says why', inv.inv === 'true' && /all five digits/.test(inv.msg), JSON.stringify(inv));
  await p.fill('#zip', '75201'); await p.locator('#zipGo').click(); await p.waitForTimeout(300);
  ok('a good ZIP clears aria-invalid', (await p.getAttribute('#zip', 'aria-invalid')) === 'false');
  // A4: value text and one polite live region
  const vt0 = await p.getAttribute('#income', 'aria-valuetext');
  ok('slider value text reads money and poverty ratio', /^\$95,000, 29\d% of the poverty line$/.test(vt0), vt0);
  await setIncome(p, 120000); await p.waitForTimeout(700);
  const live = await p.evaluate(() => ({ vt: document.getElementById('income').getAttribute('aria-valuetext'), live: document.getElementById('liveFig').textContent,
    n: document.querySelectorAll('[aria-live]:not(#agesNote)').length, big: document.querySelector('.bignum').textContent }));   // agesNote is the other live region, by design
  ok('value text follows the slider', /^\$120,000, 37\d% of the poverty line$/.test(live.vt), live.vt);
  ok('one live region announces the headline figure', live.n === 1 && live.live.includes(live.big) && /a year\.$/.test(live.live), live.live);
  await setIncome(p, 95000);
  // A5: the waterfall is one image with a spoken summary
  const wf = await p.evaluate(() => ({ role: document.getElementById('wf').getAttribute('role'), label: document.getElementById('wf').getAttribute('aria-label'), caps: document.getElementById('wcaps').getAttribute('aria-hidden'), total: document.querySelector('#wf .wcol-total .wlab').textContent }));
  ok('waterfall reads as one image with the parts and total', wf.role === 'img' && wf.caps === 'true' && wf.label.includes(wf.total) && /plus/.test(wf.label) && /employer/i.test(wf.label), wf.label);
  // A6: the two pairs the review measured under 4.5:1
  const pairs = await p.evaluate(() => {
    const cs = e => getComputedStyle(e);
    const note = document.getElementById('placeCtrl').querySelector('.note-i'), op = [...document.querySelectorAll('#lives .op')].find(e => e.textContent.trim() === '+');
    if (!note || !op) return { missing: [!note, !op] };
    return { note: [cs(note).color, cs(document.getElementById('placeCtrl')).backgroundColor], op: [cs(op).color, cs(document.getElementById('lives')).backgroundColor] };
  });
  ok('both measured elements are present', !pairs.missing, JSON.stringify(pairs));
  if (!pairs.missing) {
  ok('"from your ZIP" on the raised card clears 4.5:1', contrast(pairs.note[0], pairs.note[1]) >= 4.5, contrast(pairs.note[0], pairs.note[1]).toFixed(2) + ':1');
  ok('the "+" in the lives tally clears 4.5:1', contrast(pairs.op[0], pairs.op[1]) >= 4.5, contrast(pairs.op[0], pairs.op[1]).toFixed(2) + ':1');
  }
  await p.close();
});

test('accessibility: reduced motion, whole-page print, sticky at 1024, structure', async b => {
  const p = await page(b, 1280, 900);
  // A7: nothing moves when the reader asks for reduced motion. page() loads under
  // reduce, so opt back in to measure what "normally" looks like first.
  await p.emulateMedia({ reducedMotion: 'no-preference' }); await p.waitForTimeout(100);
  const before = await p.evaluate(() => [...document.querySelectorAll('*')].filter(e => getComputedStyle(e).transitionDuration.split(',').some(d => parseFloat(d) > 0)).length);
  await p.emulateMedia({ reducedMotion: 'reduce' }); await p.waitForTimeout(100);
  const moving = await p.evaluate(() => [...document.querySelectorAll('*')].filter(e => { const cs = getComputedStyle(e); return cs.transitionDuration.split(',').some(d => parseFloat(d) > 0) || (cs.animationName !== 'none' && parseFloat(cs.animationDuration) > 0); }).length);
  ok('transitions exist normally and vanish under reduce', before > 10 && moving === 0, `${before} → ${moving}`);
  await p.emulateMedia({ reducedMotion: 'no-preference' });
  // A8: Cmd+P on the whole page prints the ink sections dark on white
  await p.emulateMedia({ media: 'print' }); await p.waitForTimeout(100);
  const pr = await p.evaluate(() => { const s = document.getElementById('cliff'), h = s.querySelector('h2'); const cs = getComputedStyle(s);
    return { bg: cs.backgroundColor, color: getComputedStyle(h).color, letter: document.body.classList.contains('print-letter') }; });
  ok('ink sections print dark on white', !pr.letter && lum(pr.bg) > 0.9 && lum(pr.color) < 0.2, JSON.stringify(pr));
  await p.emulateMedia({ media: 'screen' });
  // A10: landmarks and a skip link that is the first tab stop
  const st = await p.evaluate(() => ({ main: !!document.querySelector('main#main'), header: !!document.querySelector('header'),
    first: (document.querySelector('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])') || {}).className, h1: document.querySelectorAll('h1').length }));
  ok('index: main and header landmarks, one h1, skip link first', st.main && st.header && st.h1 === 1 && st.first === 'skip', JSON.stringify(st));
  await p.keyboard.press('Tab');
  const skip = await p.evaluate(() => { const a = document.activeElement; const r = a.getBoundingClientRect(); return { cls: a.className, onscreen: r.left >= 0 && r.top >= 0 && r.width > 0 }; });
  ok('the skip link appears on focus', skip.cls === 'skip' && skip.onscreen, JSON.stringify(skip));
  await p.close();
  // A9: the sticky context line fits at 1024
  const q = await page(b, 1024, 900);
  await q.evaluate(() => window.scrollTo(0, 2400)); await q.waitForTimeout(300);
  const who = await q.evaluate(() => { const e = document.getElementById('who-line'); return { sw: e.scrollWidth, cw: e.clientWidth, t: e.textContent }; });
  ok('sticky context line is not truncated at 1024', who.sw <= who.cw + 1 && /^4 · /.test(who.t), JSON.stringify(who));
  await q.close();
  // A10: the methodology document and the 404
  const m = await page(b, 1280, 900, false, 'methodology/index.html');
  const ms = await m.evaluate(() => ({ h1: [...document.querySelectorAll('h1')].map(h => h.textContent), main: !!document.querySelector('main'),
    tables: document.querySelectorAll('table').length, captions: document.querySelectorAll('table > caption').length,
    noTh: [...document.querySelectorAll('table')].filter(t => !t.querySelector('th')).length,
    noScope: document.querySelectorAll('th:not([scope])').length,
    rowhFace: (() => { const th = document.querySelector('th.rowh'), td = document.querySelector('th.rowh + td'); const a = getComputedStyle(th), b = getComputedStyle(td); return a.fontFamily === b.fontFamily && a.fontSize === b.fontSize && a.textTransform === b.textTransform; })() }));
  ok('methodology: one h1 ("Check our work.") and a main', ms.h1.length === 1 && /Check our work/.test(ms.h1[0]) && ms.main, JSON.stringify(ms.h1));
  ok('methodology: every table has a caption and headers with scope', ms.tables === 8 && ms.captions === 8 && ms.noTh === 0 && ms.noScope === 0, JSON.stringify(ms));
  ok('row headers keep the body-cell face', ms.rowhFace);
  await m.close();
  const f = await page(b, 1280, 900, false, '404.html');
  ok('404 has a main landmark', await f.evaluate(() => !!document.querySelector('main')));
  await f.close();
});

/* Launch furniture: the headers the site ships with, and the two letter
 * buttons that could tell a reader something false. The CSP is verified by
 * serving dist/ with the built headers and watching for refusals. */
test('headers: the built CSP names every inline script and nothing is refused', async b => {
  const { readFileSync } = await import('node:fs');
  const { createHash } = await import('node:crypto');
  const http = await import('node:http');
  const hdrTxt = readFileSync(resolve(HERE, '../dist/_headers'), 'utf8');
  const html = readFileSync(resolve(HERE, '../dist/index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const want = scripts.map(x => `'sha256-${createHash('sha256').update(x, 'utf8').digest('base64')}'`);
  const rootCsp = (hdrTxt.match(/\n\/\n\s+Content-Security-Policy: ([^\n]+)/) || [])[1] || '';
  ok('index has inline scripts and no src= or on*= handlers', scripts.length >= 1 && !/<script[^>]+src=/.test(html) && !/\son[a-z]+=/.test(html), scripts.length + ' scripts');
  ok('every inline script hash is in the / policy', want.every(h => rootCsp.includes(h)) && !/__INDEX_SCRIPT_HASHES__/.test(hdrTxt), rootCsp.slice(0, 120));
  ok('the policy closes the network: connect-src none, only fonts and portraits', /connect-src 'none'/.test(rootCsp) && /img-src [^;]*unitedstates\.github\.io/.test(rootCsp) && /font-src https:\/\/fonts\.gstatic\.com/.test(rootCsp));
  ok('Permissions-Policy and COOP ship for every path', /Permissions-Policy: camera=\(\)/.test(hdrTxt) && /Cross-Origin-Opener-Policy: same-origin/.test(hdrTxt));
  // parse _headers: "/*" applies to all, exact paths add theirs
  const rules = []; let cur = null;
  for (const line of hdrTxt.split('\n')) {
    if (/^\S/.test(line) && !line.startsWith('#')) { cur = { path: line.trim(), h: {} }; rules.push(cur); }
    else if (cur && /^\s+\S/.test(line)) { const i = line.indexOf(':'); cur.h[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  }
  const headersFor = p => Object.assign({}, ...rules.filter(r => r.path === '/*' || r.path === p || r.path === p.replace(/\/$/, '')).map(r => r.h));
  const root = resolve(HERE, '../dist');
  const srv = http.createServer((req, res) => {
    let p = req.url.split('?')[0];
    let file = p === '/' ? '/index.html' : p === '/methodology' || p === '/methodology/' ? '/methodology/index.html' : p === '/updates' || p === '/updates/' ? '/updates/index.html' : p;
    let body; try { body = readFileSync(root + file); } catch (e) { res.writeHead(404); res.end(); return; }
    const type = /\.html$/.test(file) ? 'text/html; charset=utf-8' : /\.svg$/.test(file) ? 'image/svg+xml' : /\.png$/.test(file) ? 'image/png' : 'application/octet-stream';
    res.writeHead(200, Object.assign({ 'Content-Type': type }, headersFor(p)));
    res.end(body);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  for (const path of ['/', '/methodology/', '/updates/']) {
    const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
    const refused = [];
    p.on('console', m => { if (/Content Security Policy|Refused to/.test(m.text())) refused.push(m.text().slice(0, 160)); });
    const resp = await p.goto(`http://127.0.0.1:${port}${path}`); await p.waitForTimeout(1500);
    const csp = (resp.headers()['content-security-policy'] || '');
    ok(`${path}: served with a CSP`, csp && csp.length > 40, csp ? csp.slice(0, 60) : 'none');
    ok(`${path}: nothing refused under the policy`, refused.length === 0, refused.join(' | '));
    if (path === '/') {
      const ran = await p.evaluate(() => ({ vt: document.getElementById('income').getAttribute('aria-valuetext'), big: document.querySelector('.bignum').textContent, fig: document.getElementById('cliffDrop').textContent }));
      ok('/: the calculator ran under the policy', /\$95,000/.test(ran.vt) && /\$/.test(ran.fig), JSON.stringify(ran));
    }
    await p.close();
  }
  srv.close();
});

test('letter buttons: copy never claims success it did not have, mailto never truncates', async b => {
  const p = await page(b, 1280, 900);
  // C7: the default mailto carries the body; with every emphasis on it is too long for Windows mail apps
  await p.locator('#emph .chk[data-em="loss"]').click(); await p.waitForTimeout(200);
  const h0 = await p.getAttribute('#sendBtn', 'href');
  ok('a shorter letter\'s mailto carries the body under the Windows limit', /&body=/.test(h0) && h0.length < 1900, h0.length + ' chars');
  ok('and its paragraphs are separated by a blank line', /%0A%0A/.test(h0) && !/%0A%0A%0A/.test(h0));
  await p.locator('#emph .chk[data-em="loss"]').click(); await p.waitForTimeout(200);
  for (const e of ['nation', 'story']) { await p.locator(`#emph .chk[data-em="${e}"]`).click(); await p.waitForTimeout(150); }
  const h1 = await p.getAttribute('#sendBtn', 'href');
  const long = await p.evaluate(() => ({ note: !document.getElementById('ftLong').hidden, text: document.getElementById('ftNote').innerText }));
  ok('all emphasis on: subject-only mailto, and the note says the letter rides the clipboard', !/&body=/.test(h1) && h1.length < 300 && long.note && /copies it and opens a message/.test(long.text), h1.length + ' chars');
  await p.evaluate(() => { window.__copied = []; navigator.clipboard.writeText = t => { window.__copied.push(t.length); return Promise.resolve(); }; });
  await p.evaluate(() => { document.getElementById('sendBtn').addEventListener('click', ev => ev.preventDefault(), true); });   // keep the test in the page
  await p.locator('#sendBtn').click(); await p.waitForTimeout(200);
  ok('the long-letter mail button copies the letter on the way out', (await p.evaluate(() => window.__copied.length)) === 1);
  for (const e of ['nation', 'story']) { await p.locator(`#emph .chk[data-em="${e}"]`).click(); await p.waitForTimeout(150); }
  // C6: failure paths report failure; the site opens only after a successful copy
  await p.evaluate(() => {
    navigator.clipboard.writeText = () => Promise.reject(new Error('Document is not focused'));
    document.execCommand = () => false;
    window.__opened = []; window.open = (u) => { window.__opened.push(u); return {}; };
  });
  await p.locator('#copyBtn').click(); await p.waitForTimeout(200);
  ok('Copy text reports the failure', /Copy failed/.test(await p.textContent('#copyBtn')), await p.textContent('#copyBtn'));
  await p.locator('#formBtn').click(); await p.waitForTimeout(200);
  const f1 = await p.evaluate(() => ({ label: document.getElementById('formBtn').textContent, opened: window.__opened.length, here: location.href }));
  ok('the dark button does not open the site when the copy failed', /Copy failed/.test(f1.label) && f1.opened === 0 && /index\.html/.test(f1.here), JSON.stringify(f1));
  await p.waitForTimeout(3300);
  // The fake now behaves like the real thing: window.open returns null when given
  // "noopener" even though the tab opened (the old fake returned {} and hid a bug
  // that also sent THIS tab to the member's site). And this page must never move.
  await p.evaluate(() => {
    navigator.clipboard.writeText = () => Promise.resolve();
    window.__opened = []; window.__w = { opener: 'page' };
    window.open = (u, t, f) => { window.__opened.push(u); return /noopener/.test(f || '') ? null : window.__w; };
  });
  const before = p.url();
  await p.locator('#formBtn').click(); await p.waitForTimeout(300);
  const f2 = await p.evaluate(() => ({ label: document.getElementById('formBtn').textContent, opened: window.__opened, href: document.getElementById('formBtn').getAttribute('href'), opener: window.__w.opener }));
  ok('after a successful copy it opens the member\'s site from inside the resolved copy', /Copied/.test(f2.label) && f2.opened.length === 1 && f2.opened[0] === f2.href && /house\.gov/.test(f2.href), JSON.stringify(f2));
  ok('the new tab is cut off from this page', f2.opener === null, String(f2.opener));
  ok('and this tab stays on The Whole Bill', p.url() === before, p.url());
  // a blocked pop-up: the button becomes a plain new-tab link for one click, this tab still stays
  await p.waitForTimeout(2800);
  await p.evaluate(() => { window.open = (u) => { window.__opened.push(u); return null; }; });
  await p.locator('#formBtn').click(); await p.waitForTimeout(300);
  const f3 = await p.evaluate(() => ({ label: document.getElementById('formBtn').textContent, direct: document.getElementById('formBtn').getAttribute('data-direct'),
    target: document.getElementById('formBtn').getAttribute('target'), rel: document.getElementById('formBtn').getAttribute('rel') }));
  ok('blocked: this tab stays put and the button offers the site as a new-tab link', p.url() === before && /now open their site/.test(f3.label) && f3.direct === '1' && f3.target === '_blank' && /noopener/.test(f3.rel), JSON.stringify(f3));
  // C8: a member with no site on file gets the honest note, not a greyed button under a promise
  await p.evaluate(() => { REPS.house[Object.keys(REPS.house).find(k => /Crockett/.test(REPS.house[k].n))].u = ''; });
  await setIncome(p, 96000);
  const ns = await p.evaluate(() => ({ dis: document.getElementById('formBtn').getAttribute('aria-disabled'), site: document.getElementById('ftNoteSite').hidden, nosite: document.getElementById('ftNoteNoSite').hidden, text: document.getElementById('ftNote').innerText }));
  ok('the note names the primary button by the colour it actually is', await p.evaluate(() =>
     getComputedStyle(document.getElementById('formBtn')).backgroundColor === 'rgb(217, 154, 63)' &&
     /amber button/.test(document.getElementById('ftNoteSite').textContent) && !/dark button/.test(document.getElementById('ftNote').textContent)));
  ok('no site on file: the note swaps to say so', ns.dis === 'true' && ns.site && !ns.nosite && /amber button is off/.test(ns.text), JSON.stringify(ns));
  await p.close();
});

/* The Worker config decides whether unknown paths get the branded 404 or an
 * empty body; the site went public with the empty body because the file did
 * not exist. Keep the three settings the site depends on pinned. */
test('hosting: wrangler.jsonc names the worker and serves the branded 404', async () => {
  const { readFileSync, existsSync } = await import('node:fs');
  const raw = readFileSync(resolve(HERE, '../wrangler.jsonc'), 'utf8');
  const cfg = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ''));
  ok('worker is named thewholebill', cfg.name === 'thewholebill', cfg.name);
  ok('assets come from dist/', /^\.\/dist\/?$/.test(cfg.assets && cfg.assets.directory), cfg.assets && cfg.assets.directory);
  ok('unknown paths serve 404.html with a 404', cfg.assets && cfg.assets.not_found_handling === '404-page');
  ok('html handling stays auto-trailing-slash (/methodology/)', cfg.assets && cfg.assets.html_handling === 'auto-trailing-slash');
  ok('dist/404.html exists for it to serve', existsSync(resolve(HERE, '../dist/404.html')));
});

test('reps data: every member has a house.gov or senate.gov URL and a plain-text name', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(resolve(HERE, '../src/reps.js'), 'utf8');
  const REPS = new Function(src + '; return REPS;')();
  const all = [...Object.values(REPS.house), ...Object.values(REPS.senate).flat()];
  const badUrl = all.filter(m => !/^https:\/\/[a-z0-9.-]+\.(house|senate)\.gov\/?[a-z0-9\/._-]*$/i.test(m.u));
  const badName = all.filter(m => /[<>&]/.test(m.n));   // nicknames carry quotes; the card sets names as text nodes, only markup characters matter
  ok('every member has a congressional URL (CA-1 shipped empty)', badUrl.length === 0, badUrl.map(m => m.n + ':' + JSON.stringify(m.u)).slice(0, 3).join(', '));
  ok('no name needs HTML escaping', badName.length === 0, badName.map(m => m.n).join(', '));
  ok('CA-1 resolves to the house.gov convention', /gallagher\.house\.gov/.test(REPS.house['CA-1'].u), REPS.house['CA-1'].u);
});

test('hygiene: the minor list from the launch review', async b => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const W = require('../src/calc.js'); W.useBenchmarks(require('../src/benchmarks.js'));
  // a single parent files head of household: the $200,000 threshold, not $250,000
  const sp = W.employerCost({ income: 230000, size: 2, adults: 1, ages: [40, 8], bkey: '48113' });
  const cp = W.employerCost({ income: 230000, size: 2, adults: 2, ages: [40, 38], bkey: '48113' });
  ok('single parent at $230k pays the additional Medicare tax above $200k', Math.abs(sp.medicareTax - (230000 * 0.0145 + 30000 * 0.009)) < 0.01, `$${sp.medicareTax.toFixed(2)}`);
  ok('a couple at $230k does not (joint threshold $250k)', Math.abs(cp.medicareTax - 230000 * 0.0145) < 0.01, `$${cp.medicareTax.toFixed(2)}`);
  const p = await page(b, 1280, 900);
  const body = () => p.evaluate(() => document.body.innerText);
  const t0 = await body();
  ok('footer no longer hedges with "live preview", and names what leaves the page', !/live preview|still being built/i.test(t0) && /nothing else leaves this page/.test(t0));
  ok('American spellings', !/labelled|modelled|modelling|maths/.test(t0));
  ok('"try a city", not "try a sample"', /try a city/.test(t0) && !/try a sample/.test(t0));
  ok('the rep card date reads as a long date', /Cosponsor status as of \d{1,2} [A-Z][a-z]+ 20\d\d/.test(t0), (t0.match(/Cosponsor status as of [^.]*/) || [''])[0]);
  ok('no motive attribution for Mercatus beyond its funding', !/built to be damning|written to show|written to make it look bad|written to argue/.test(t0));
  ok('no "anyone has published" on the calculator', !/anyone has published/.test(t0));
  // ages: "40, 12.5" must not become three people
  await p.locator('#agesBoxes input').nth(2).fill('12.5'); await p.waitForTimeout(200);   // digits only: "125" is impossible, so nothing moves
  ok('"12.5" in a box leaves the household as it was', (await p.evaluate(() => document.querySelector('.letterHh').textContent)) === 'family of four');
  await p.locator('#agesBoxes input').nth(2).blur(); await p.waitForTimeout(100);
  await setAges(p, [41, 39]);
  ok('a household of two is "household of two" in the letter', /my household of two/.test(await p.evaluate(() => document.getElementById('letterBd').innerText)));
  await setAges(p, [41, 39, 12, 9]);
  // negative override is refused, not flipped
  await p.locator('#adv summary').click(); await p.waitForTimeout(150);
  await p.fill('#deduct', '-50'); await p.waitForTimeout(250);
  const ov = await p.evaluate(() => document.getElementById('deductOvk').classList.contains('on'));
  ok('"-50" in the drawer sets no override', ov === false);
  await p.fill('#deduct', ''); await p.waitForTimeout(200);
  ok('drawer fields show thousands separators', /^\$\d{1,3}(,\d{3})*\.\d\d$/.test(await p.inputValue('#totPrem')) , await p.inputValue('#totPrem'));
  // an uncovered ZIP typed while a county chooser is up clears the chooser
  await p.fill('#zip', '10537'); await p.locator('#zipGo').click(); await p.waitForTimeout(300);
  ok('a split ZIP shows county buttons', (await p.locator('#areapick button[data-k]').count()) >= 2);
  await p.fill('#zip', '00001'); await p.locator('#zipGo').click(); await p.waitForTimeout(300);
  ok('an uncovered ZIP clears them (the sample cities take their place)', (await p.locator('#areapick button[data-k]').count()) === 0 && (await p.locator('#areapick button[data-z]').count()) >= 2 && /not a residential US ZIP/.test(await p.textContent('#scope')));
  await p.fill('#zip', '75201'); await p.locator('#zipGo').click(); await p.waitForTimeout(300);
  // month view: cliff axis labels carry separators
  await p.locator('#unit').click(); await p.waitForTimeout(400);
  const axis = await p.evaluate(() => [...document.querySelectorAll('#cliffChart text')].map(t => t.textContent).filter(t => /^\$\d/.test(t)));
  ok('month-view cliff axis prints "$1,200" not "$1200"', axis.length > 2 && axis.every(t => /^\$\d{1,3}(,\d{3})*$/.test(t)), axis.join(' '));
  await p.locator('#unit').click(); await p.waitForTimeout(200);
  // a11y polish
  const pol = await p.evaluate(() => {
    const cs = e => getComputedStyle(e);
    const off = document.querySelector('#route button:not(.on)'), on = document.querySelector('#route button.on');
    return { border: cs(off).borderColor, bg: cs(off).backgroundColor, onBorder: cs(on).borderColor,
      textbox: document.getElementById('letterBd').getAttribute('role') === 'textbox' && document.getElementById('letterBd').getAttribute('aria-multiline') === 'true',
      unit: document.getElementById('unit').getAttribute('aria-label'),
      boxSvgs: [...document.querySelectorAll('.box svg')].every(s => s.getAttribute('aria-hidden') === 'true'),
      pop: document.getElementById('incomeQPop').getAttribute('role'),
      brand: document.querySelector('.brand').getBoundingClientRect().height,
      foot: [...document.querySelectorAll('footer a.q')].map(a => a.getBoundingClientRect().height) };
  });
  ok('route button boundary clears 3:1 on the raised ground', contrast(pol.border, pol.bg) >= 3, contrast(pol.border, pol.bg).toFixed(2) + ':1');
  ok('the selected route has a stronger boundary than the others', contrast(pol.onBorder, pol.bg) > contrast(pol.border, pol.bg) + 1);
  ok('letter is a multiline textbox, unit switch names its checked state, decorative SVGs hidden, popover has a role',
     pol.textbox && /monthly/i.test(pol.unit) && pol.boxSvgs && pol.pop === 'tooltip', JSON.stringify([pol.unit, pol.pop]));
  ok('brand and footer links reach 44px', pol.brand >= 44 && pol.foot.every(h => h >= 44), JSON.stringify([pol.brand, pol.foot]));
  await p.close();
  const q = await page(b, 390, 844, true);
  await q.locator('#zip').fill('10001'); await q.locator('#zipGo').click(); await q.waitForTimeout(400);
  const sen = await q.evaluate(() => [...document.querySelectorAll('.sen-n')].map(e => ({ t: e.textContent, over: e.scrollWidth > e.clientWidth + 1 })));
  ok('senator names wrap instead of ellipsizing on a phone', sen.length === 2 && sen.every(s => !s.over), JSON.stringify(sen));
  const wl = await q.evaluate(() => Math.min(...[...document.querySelectorAll('#wf .wlab')].map(e => parseFloat(getComputedStyle(e).fontSize))));
  ok('waterfall labels are at least 10px on a phone', wl >= 10, wl + 'px');
  await q.close();
  const m = await page(b, 1280, 900, false, 'methodology/index.html');
  const mt = await m.evaluate(() => document.body.innerText);
  ok('methodology: tag chips are at least 10px', (await m.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.tag')).fontSize))) >= 10);
  ok('methodology: "the most expensive estimate we know of", American spellings, HealthCare.gov', /most expensive (one|estimate) we know of/.test(mt) && !/anyone has published|labelled|modelled|modelling/.test(mt) && /HealthCare\.gov/.test(mt) && !/healthcare\.gov|Healthcare\.gov/.test(mt));
  await m.close();
});

/* Explains-links: a curated set of phrases on the calculator link to the
 * methodology section that defines or derives them. Every one must land on a
 * real anchor, in all three documents, and none may sit in a figure, a
 * heading, the letter or the sticky bar. */
test('links: every explains-link lands on a methodology anchor, in all three documents', async b => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(resolve(HERE, '../src/page.html'), 'utf8');
  const meth = src.slice(src.indexOf('METH:START'), src.indexOf('METH:END'));
  const calc = src.slice(src.indexOf('01 HERO'), src.indexOf('METH:START')) + src.slice(src.indexOf('METH:END'));
  const ids = new Set([...meth.matchAll(/\bid="([\w-]+)"/g)].map(m => m[1]));
  const targets = [...src.matchAll(/href="#\/methodology\/([\w-]+)"/g)].map(m => m[1]);
  const missing = targets.filter(t => !ids.has(t));
  ok('every deep link names an existing methodology id', targets.length >= 20 && missing.length === 0, missing.join(', ') || targets.length + ' links');
  const termCount = (calc.match(/class="term"/g) || []).length;
  ok('a curated number of explains-links on the calculator, not a carpet', termCount >= 12 && termCount <= 24, termCount + ' term links');
  const index = readFileSync(resolve(HERE, '../dist/index.html'), 'utf8');
  const doc = readFileSync(resolve(HERE, '../dist/methodology/index.html'), 'utf8');
  ok('index: deep links point at the real page with a fragment', !/href="#\/methodology/.test(index) && /href="\/methodology\/#credit"/.test(index));
  ok('methodology page: on-page links are plain anchors that exist', !/href="#\/methodology/.test(doc) && /href="#credit"/.test(doc) && /id="credit"/.test(doc) && /id="model-blahous"/.test(doc) && /id="src-congress"/.test(doc));
  const updDoc = readFileSync(resolve(HERE, '../dist/updates/index.html'), 'utf8');
  ok('updates page: methodology links point at the real page, its own anchors are plain', !/href="#\/(methodology|updates)/.test(updDoc) && /href="\/methodology\/#credit"/.test(updDoc) && /href="#u-[\w-]+"/.test(updDoc));
  const p = await page(b, 1280, 900);
  const placed = await p.evaluate(() => [...document.querySelectorAll('a.term')].map(a => ({ t: a.textContent, bad: !!a.closest('.letter, .sticky, h1, h2, .num, .bignum, .v') })));
  ok('no explains-link inside a figure, heading, the letter or the sticky bar', placed.every(x => !x.bad), placed.filter(x => x.bad).map(x => x.t).join(', '));
  await p.locator('#route button[data-r="none"]').click(); await p.waitForTimeout(300);
  await setIncome(p, 30000); await p.waitForTimeout(200);
  const dyn = await p.evaluate(() => [...document.querySelectorAll('a.term')].map(a => a.getAttribute('href')));
  ok('script-built copy carries its links too (crossover note, eligibility box, cliff intro)', dyn.some(h => /universal/.test(h)) && dyn.some(h => /credit-floor|credit\b/.test(h)), dyn.join(' '));
  await p.close();
  const a = await page(b, 1280, 900, false, 'artifact.html');
  await a.evaluate(() => document.querySelector('a.term[href="#/methodology/credit"]').click()); await a.waitForTimeout(500);
  const land = await a.evaluate(() => ({ hash: location.hash, shown: !document.getElementById('methodology').hidden, top: document.getElementById('credit').getBoundingClientRect().top }));
  ok('artifact: the deep link opens the methodology and scrolls to the section', land.hash === '#/methodology/credit' && land.shown && land.top >= 0 && land.top < 160, JSON.stringify(land));
  await a.evaluate(() => document.querySelector('.onpage a[href="#/methodology/sources"]').click()); await a.waitForTimeout(400);
  const land2 = await a.evaluate(() => document.getElementById('sources').getBoundingClientRect().top);
  ok('artifact: the on-page list scrolls within the view', land2 >= 0 && land2 < 160, String(land2));
  await a.close();
});

/* What changed: one hand-written log (src/updates.js) renders the hero box,
 * the /updates document and the RSS feed. The suite holds the log to the
 * site's rules (dates, kinds, primary sources, methodology anchors that
 * exist, no dashes) and checks that all three outputs agree with it. */
test('updates: the log renders the hero box, its own page and the feed', async b => {
  const { readFileSync, existsSync } = await import('node:fs');
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const U = require('../src/updates.js');
  const src = readFileSync(resolve(HERE, '../src/page.html'), 'utf8');
  const meth = src.slice(src.indexOf('METH:START'), src.indexOf('METH:END'));
  const ids = new Set([...meth.matchAll(/\bid="([\w-]+)"/g)].map(m => m[1]));
  const today = new Date().toISOString().slice(0, 10);
  ok('the log has entries', U.length >= 5, U.length + ' entries');
  ok('newest first', U.every((e, i) => i === 0 || U[i - 1].date >= e.date));
  ok('every entry has an ISO date, no later than today', U.every(e => /^\d{4}-\d{2}-\d{2}$/.test(e.date) && !isNaN(Date.parse(e.date)) && e.date <= today), U.filter(e => e.date > today).map(e => e.id).join(', '));
  ok('ids are slugs and unique', new Set(U.map(e => e.id)).size === U.length && U.every(e => /^[a-z0-9-]+$/.test(e.id)));
  ok('every entry is world or site with a title and a body', U.every(e => ['world', 'site'].includes(e.kind) && e.title && e.body));
  const noSrc = U.filter(e => e.kind === 'world' && !(e.source && /^https:\/\//.test(e.source.url) && e.source.title));
  ok('every world entry carries a primary source over https', noSrc.length === 0, noSrc.map(e => e.id).join(', '));
  const badSee = U.filter(e => e.see && !(ids.has(e.see.id) && e.see.text));
  ok('every methodology pointer names a section that exists', badSee.length === 0, badSee.map(e => e.id + ':' + e.see.id).join(', '));
  const dashed = U.filter(e => /[–—]/.test([e.title, e.body, e.source && e.source.title, e.see && e.see.text].join(' ')));
  ok('no em or en dash in any entry', dashed.length === 0, dashed.map(e => e.id).join(', '));
  ok('at most three pinned entries', U.filter(e => e.pin).length <= 3);
  const { execFileSync } = await import('node:child_process');
  let parses = true; try { execFileSync('node', ['--check', resolve(HERE, '../tools/watch-sources.mjs')]); } catch (e) { parses = false; }
  ok('the source watcher parses (it is not run here: network)', parses);

  // the three outputs
  const index = readFileSync(resolve(HERE, '../dist/index.html'), 'utf8');
  const doc = readFileSync(resolve(HERE, '../dist/updates/index.html'), 'utf8');
  const rss = readFileSync(resolve(HERE, '../dist/updates.xml'), 'utf8');
  ok('the updates document builds without scripts (structured data is not a script)', existsSync(resolve(HERE, '../dist/updates/index.html')) && !/<script(?![^>]*ld\+json)/.test(doc));
  ok('it lists every entry once, newest first', (doc.match(/<article class="upd"/g) || []).length === U.length && doc.indexOf('id="u-' + U[0].id + '"') < doc.indexOf('id="u-' + U[U.length - 1].id + '"'));
  ok('its title is the h1 and its canonical URL is /updates', /<h1 class="as-h2">What changed\.<\/h1>/.test(doc) && /rel="canonical" href="https:\/\/thewholebill\.org\/updates"/.test(doc) && /<title>What changed: healthcare law and data updates · The Whole Bill<\/title>/.test(doc));
  ok('every source link on it is https with noopener', [...doc.matchAll(/<a class="srclink" href="([^"]+)"([^>]*)>/g)].every(m => /^https:\/\//.test(m[1]) && /rel="noopener"/.test(m[2])));
  ok('the feed is RSS 2.0 with a self link and one item per entry', /<rss version="2\.0"/.test(rss) && /atom:link href="https:\/\/thewholebill\.org\/updates\.xml" rel="self"/.test(rss) && (rss.match(/<item>/g) || []).length === U.length);
  ok('every feed item has a permalink guid, a parsable date and a title', [...rss.matchAll(/<item>([\s\S]*?)<\/item>/g)].every(m => /<guid isPermaLink="true">https:\/\/thewholebill\.org\/updates\/#u-[\w-]+<\/guid>/.test(m[1]) && !isNaN(Date.parse((m[1].match(/<pubDate>([^<]+)/) || [])[1])) && /<title>[^<]{10,}<\/title>/.test(m[1])));
  ok('the feed carries no raw markup or dashes in its titles', [...rss.matchAll(/<title>([^<]*)<\/title>/g)].every(m => !/[<>–—]|&lt;/.test(m[1])));
  ok('every document advertises the feed', [index, doc, readFileSync(resolve(HERE, '../dist/methodology/index.html'), 'utf8')].every(h => /rel="alternate" type="application\/rss\+xml"/.test(h)));
  ok('the headers file types the feed and keeps /updates scriptless', /\n\/updates\.xml\n\s+Content-Type: application\/rss\+xml/.test(readFileSync(resolve(HERE, '../dist/_headers'), 'utf8')) && /\n\/updates\/\n\s+Content-Security-Policy: default-src 'none'; style-src/.test(readFileSync(resolve(HERE, '../dist/_headers'), 'utf8')));

  // the hero box: pins plus the newest, three in all, each a real entry, in date order
  const sorted = U.slice().sort((a, b2) => b2.date.localeCompare(a.date));
  const want = sorted.filter(e => e.pin).concat(sorted.filter(e => !e.pin)).slice(0, 3).sort((a, b2) => b2.date.localeCompare(a.date)).map(e => e.id);
  const p = await page(b, 1280, 900);
  const box = await p.evaluate(() => ({
    k: document.querySelector('.dateline .k').textContent,
    ids: [...document.querySelectorAll('.dateline .upd-when')].map(a => a.getAttribute('href')),
    more: (document.querySelector('.dateline .more') || {}).getAttribute?.('href'),
    nav: [...document.querySelectorAll('.nav a')].map(a => a.getAttribute('href')),
    foot: [...document.querySelectorAll('footer a')].map(a => a.getAttribute('href')) }));
  ok('the hero box is titled What changed and shows the pins plus the newest', box.k === 'What changed' && JSON.stringify(box.ids) === JSON.stringify(want.map(id => '/updates/#u-' + id)), JSON.stringify(box.ids));
  ok('it links to the full log, as do the header and footer', box.more === '/updates' && box.nav.includes('/updates') && box.foot.includes('/updates') && box.foot.includes('/updates.xml'), JSON.stringify([box.more, box.nav, box.foot]));
  await p.close();
  const m = await page(b, 390, 800, true);
  const g = await m.evaluate(() => { const d = document.querySelector('.dateline'); return { sw: d.scrollWidth, cw: d.clientWidth, pw: document.documentElement.scrollWidth, vw: window.innerWidth }; });
  ok('phone: the box does not overflow', g.sw <= g.cw && g.pw <= g.vw, JSON.stringify(g));
  await m.close();

  // the artifact: the hash router shows the view and lands deep links
  const a = await page(b, 1280, 900, false, 'artifact.html');
  await a.evaluate(() => document.querySelector('.nav a[href="#/updates"]').click()); await a.waitForTimeout(400);
  const v = await a.evaluate(() => ({ shown: !document.getElementById('updates').hidden, back: !document.getElementById('updBack').hidden, meth: document.getElementById('methodology').hidden, hero: document.querySelector('section:not(.view)').hidden, title: document.title }));
  ok('artifact: #/updates shows the log alone', v.shown && v.back && v.meth && v.hero && v.title === 'What changed · The Whole Bill', JSON.stringify(v));
  const mid = sorted[Math.floor(sorted.length / 2)].id;   // not the last: the document ends too soon after it to scroll it to the top
  await a.evaluate(id => { location.hash = '#/updates/u-' + id; }, mid); await a.waitForTimeout(400);
  const top = await a.evaluate(id => document.getElementById('u-' + id).getBoundingClientRect().top, mid);
  ok('artifact: a deep link scrolls to the entry', top >= 0 && top < 160, String(top));
  await a.evaluate(() => document.querySelector('.upd .term').click()); await a.waitForTimeout(400);
  const cross = await a.evaluate(() => ({ meth: !document.getElementById('methodology').hidden, upd: document.getElementById('updates').hidden, hash: location.hash }));
  ok('artifact: an entry\'s methodology pointer crosses to the methodology view', cross.meth && cross.upd && /^#\/methodology\//.test(cross.hash), JSON.stringify(cross));
  await a.evaluate(() => document.querySelector('#methBack a.q[href="#"]').click()); await a.waitForTimeout(400);
  ok('artifact: back returns to the calculator', await a.evaluate(() => document.getElementById('methodology').hidden && document.getElementById('updates').hidden && !document.querySelector('section:not(.view)').hidden));
  await a.close();
});

/* Search engines and assistants: keyword titles per document, structured data
 * read from the page (the FAQ block from the objections cards, so it cannot
 * drift), an explicit robots.txt, llms.txt, the methodology as markdown, and
 * the IndexNow key and workflow. Nothing a reader sees changed. */
test('seo: titles, structured data, robots, llms.txt and the markdown methodology', async b => {
  const { readFileSync, existsSync, readdirSync } = await import('node:fs');
  const rd = f => readFileSync(resolve(HERE, '../' + f), 'utf8');
  const index = rd('dist/index.html'), meth = rd('dist/methodology/index.html'), upd = rd('dist/updates/index.html');
  const title = h => (h.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
  ok('index title says what the page is and keeps the name', /healthcare actually costs/.test(title(index)) && /The Whole Bill$/.test(title(index)), title(index));
  ok('methodology and updates titles carry the words people search for', /healthcare cost calculator/.test(title(meth)) && /healthcare law and data/.test(title(upd)));
  ok('keywords meta names the subject', /name="keywords" content="[^"]*Medicare for All[^"]*universal healthcare[^"]*single-payer/.test(index));
  ok('each document has its own description under 170 characters', [index, meth, upd].every(h => { const d = (h.match(/name="description" content="([^"]+)"/) || [])[1] || ''; return d.length > 80 && d.length < 170; }) && /Medicare for All/.test((index.match(/name="description" content="([^"]+)"/) || [])[1]));
  const ld = h => [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));
  const li = ld(index), lm = ld(meth), lu = ld(upd);
  ok('index carries WebSite, WebApplication and FAQPage', li.length === 1 && JSON.stringify(li[0]['@graph'].map(x => x['@type'])) === '["WebSite","WebApplication","FAQPage"]');
  const faq = li[0]['@graph'][2].mainEntity;
  const src = rd('src/page.html');
  const obj = src.slice(src.indexOf('id="objections"')); const cards = (obj.slice(0, obj.indexOf('</section>')).match(/<div class="quote">/g) || []).length;
  ok('the FAQ block has one question per objection card, in the cards\' own words', faq.length === cards && faq.every(q => q.name.length > 10 && q.acceptedAnswer.text.length > 80 && !/<|&[a-z]+;/.test(q.name + q.acceptedAnswer.text)), faq.length + ' of ' + cards);
  ok('no dashes in the structured data', ![index, meth, upd].some(h => /[–—]/.test((h.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/) || ['', ''])[1])));
  ok('methodology and updates carry a WebPage that names the site and the subject', [lm, lu].every(l => l.length === 1 && l[0]['@type'] === 'WebPage' && l[0].isPartOf.name === 'The Whole Bill' && l[0].about.some(a => /Medicare for All/.test(a.name))));
  ok('the artifact keeps no structured data placeholder', !/JSONLD/.test(rd('preview/artifact.html')));
  const robots = rd('dist/robots.txt');
  ok('robots.txt welcomes the search and AI crawlers by name', ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended', 'Bingbot'].every(u => new RegExp('User-agent: ' + u + '\\nAllow: /').test(robots)) && /Sitemap: https:\/\/thewholebill\.org\/sitemap\.txt/.test(robots));
  const llms = rd('dist/llms.txt');
  ok('llms.txt names the site, the subject and every page', /^# The Whole Bill/.test(llms) && /Medicare for All/.test(llms) && ['https://thewholebill.org/', '/methodology)', '/methodology.md)', '/updates)', '/updates.xml)'].every(s => llms.includes(s)));
  const md = rd('dist/methodology.md');
  ok('methodology.md is real markdown: a title, the sections, pipe tables with separators, no tags, no dashes', /^# Methodology/.test(md) && /\n### Sources/.test(md) && /\n\| --- \|/.test(md) && !/<[a-z]/.test(md) && !/[–—]/.test(md) && /\| 48 states & DC \| \$15,650 \|/.test(md));
  ok('its tables have no blank lines between rows and its links are absolute', !/\|\n\n\|/.test(md) && !/\]\((?!https:\/\/)/.test(md));
  ok('the headers file types the markdown and llms.txt', /\n\/methodology\.md\n\s+Content-Type: text\/markdown/.test(rd('dist/_headers')) && /\n\/llms\.txt\n\s+Content-Type: text\/plain/.test(rd('dist/_headers')));
  const key = readdirSync(resolve(HERE, '../src')).find(f => /^[0-9a-f]{32}\.txt$/.test(f));
  ok('the IndexNow key ships and matches its file', !!key && existsSync(resolve(HERE, '../dist/' + key)) && rd('dist/' + key).trim() === key.replace(/\.txt$/, ''));
  ok('the IndexNow workflow runs the tool on pushes to main', /branches: \[main\]/.test(rd('.github/workflows/indexnow.yml')) && /node tools\/indexnow\.mjs/.test(rd('.github/workflows/indexnow.yml')));
  const { execFileSync } = await import('node:child_process');
  let parses = true; try { execFileSync('node', ['--check', resolve(HERE, '../tools/indexnow.mjs')]); } catch (e) { parses = false; }
  ok('the IndexNow tool parses (not run here: network)', parses);
  ok('the methodology page carries a cite-this line', /id="cite"[^>]*>To cite this page/.test(meth));
});

/* Sources: a row that cannot be followed is a claim; every row links to its
 * primary document over https, with no summary domains standing in. */
test('sources: every row links to a primary document', async () => {
  const { readFileSync } = await import('node:fs');
  const doc = readFileSync(resolve(HERE, '../dist/methodology/index.html'), 'utf8');
  const table = doc.slice(doc.indexOf('<caption class="vh">Sources</caption>'), doc.indexOf('</table>', doc.indexOf('<caption class="vh">Sources</caption>')));
  const rows = [...table.matchAll(/<tr(?: id="[\w-]+")?><td>([^<]+)<\/td><td>([\s\S]*?)<\/td><\/tr>/g)];
  ok('the table has its rows', rows.length >= 28, rows.length + ' rows');
  const unlinked = rows.filter(r => !/href="https:\/\//.test(r[2])).map(r => r[1]);
  ok('every row carries an https link to its source', unlinked.length === 0, unlinked.join(', '));
  const hrefs = [...table.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
  ok('no plain-http or summary-site links', hrefs.every(h => /^https:\/\//.test(h)) && !hrefs.some(h => /wikipedia|scribd|researchgate|acasignups|substack/.test(h)), hrefs.filter(h => !/^https:\/\//.test(h)).join(' '));
  ok('links open without leaking a window handle', [...table.matchAll(/<a class="srclink"[^>]*>/g)].every(a => /rel="noopener"/.test(a[0])));
  ok('the retrieved-on sentence is present', /retrieved and checked on \d{1,2} [A-Z][a-z]+ 20\d\d/.test(doc));
  ok('the calculator itself gained no external links', ![...readFileSync(resolve(HERE, '../dist/index.html'), 'utf8').matchAll(/<a class="srclink"/g)].length);   // the class is srclink; <details class="src"> is the lives fold
});

/* TRICARE, Medicare and VA households: a pointer under the route control so they do
 * not read the employer figure as theirs, a methodology row that says what is
 * different, and an objection card that uses those programs as the existence proof. */
test('other coverage: the pointer, the objection and the methodology row agree', async b => {
  const { readFileSync } = await import('node:fs');
  const doc = readFileSync(resolve(HERE, '../dist/methodology/index.html'), 'utf8');
  ok('methodology row exists with the sourced figures', /id="other-coverage"/.test(doc) && /9\.4 million/.test(doc) && /\$6,800/.test(doc) && /69\.7 million/.test(doc) && /9\.1 million/.test(doc));
  ok('the two new Sources rows link to CRS, TRICARE, CMS and the VA', /crs-product\/IF13108/.test(doc) && /tricare\.mil\/Costs/.test(doc) && /medicare-monthly-enrollment/.test(doc) && /va\.gov\/health/.test(doc));
  const p = await page(b, 1280, 900);
  const r = await p.evaluate(() => {
    const cov = document.getElementById('otherCov'), a = cov.querySelector('a.term');
    const cards = [...document.querySelectorAll('#objections .card-p')];
    const grid = document.querySelector('#objections .grid2').getBoundingClientRect();
    const last = cards[cards.length - 1].getBoundingClientRect();
    return { covText: cov.textContent, href: a.getAttribute('href'), n: cards.length,
      lastQuote: cards[cards.length - 1].querySelector('.quote').textContent, lastSpans: Math.abs(last.width - grid.width) < 2,
      figs: /69\.7 million/.test(cards[cards.length - 1].textContent) && /9\.4 million/.test(cards[cards.length - 1].textContent) && /\$6,800/.test(cards[cards.length - 1].textContent) };
  });
  ok('the pointer sits under the route control and links to the row', /TRICARE, Medicare or VA care/.test(r.covText) && r.href === '/methodology/#other-coverage', r.href);
  ok('five objections, the fifth on government-run coverage, spanning the row', r.n === 5 && /cannot work here/.test(r.lastQuote) && r.lastSpans, JSON.stringify([r.n, r.lastQuote, r.lastSpans]));
  ok('the card carries the same figures as the methodology row', r.figs);
  await p.close();
});

/* The footer's contact link was underlined by a border-bottom, which the 44px
 * hit-area padding pushed 14px below the text. It is a text underline now, and
 * every document carries the copyright line. */
test('footer: copyright on every document, contact underline on the text', async b => {
  for (const doc of ['index.html', 'methodology/index.html', 'updates/index.html']) {
    const p = await page(b, 1280, 900, false, doc);
    const f = await p.evaluate(() => {
      const a = document.querySelector('footer a.q.mail'), cs = a && getComputedStyle(a);
      return { copy: /© 2026 The Whole Bill/.test(document.querySelector('footer').textContent),
        border: cs && cs.borderBottomStyle, deco: cs && cs.textDecorationLine, offset: cs && cs.textUnderlineOffset,
        h: a && a.getBoundingClientRect().height };
    });
    ok(`${doc}: the copyright line`, f.copy);
    ok(`${doc}: the contact link is underlined on its text, not 14px below it`,
       f.border === 'none' && f.deco === 'underline' && f.offset === '4px', JSON.stringify(f));
    ok(`${doc}: and still a 44px target`, f.h >= 44, String(f.h));
    await p.close();
  }
});

/* Public Notice (2026-10). Two families only: Archivo for everything that is not
 * reading, Newsreader roman for reading. Newsreader loads without an italic, so any
 * italic left in the page would be a synthesized slant; none may render. */
/* Newsroom type (2026-10): Newsreader for headlines and reading, with its real italic;
 * Hanken Grotesk for figures, labels and controls, roman only. So an italic is fine in
 * the serif and a synthesized one in the sans. Buttons do not inherit the page font,
 * which is how the model pills once rendered in Arial: a third family fails here. */
test('newsroom type: two font families, italic only where a real italic loads', async b => {
  const p = await page(b, 1280, 900);
  const f = await p.evaluate(async () => {
    await document.fonts.ready;
    const link = [...document.querySelectorAll('link[rel="stylesheet"]')].map(l => l.href).find(h => /fonts\.googleapis/.test(h)) || '';
    const used = new Set(), italic = [], fake = [];
    for (const el of document.querySelectorAll('body *')) {
      if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') continue;
      if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
      const cs = getComputedStyle(el), fam = cs.fontFamily.split(',')[0].replace(/['"]/g, '').trim();
      used.add(fam);
      if (cs.fontStyle !== 'normal') (fam === 'Newsreader' ? italic : fake).push(el.tagName + ' ' + el.textContent.trim().slice(0, 30));
    }
    return { link, used: [...used], italic: italic.length, fake: fake.slice(0, 5),
             loaded: [...document.fonts].filter(x => x.status === 'loaded').map(x => x.family.replace(/['"]/g, '') + ' ' + x.style) };
  });
  ok('one stylesheet link: Newsreader with its italic, Hanken Grotesk roman, nothing else',
     /family=Newsreader:ital,opsz,wght@0,6\.\.72,400\.\.500;1,6\.\.72,400\.\.500/.test(f.link) && /family=Hanken\+Grotesk:wght@400\.\.500/.test(f.link)
     && (f.link.match(/family=/g) || []).length === 2, f.link);
  ok('rendered text uses only the two families', f.used.every(x => x === 'Hanken Grotesk' || x === 'Newsreader'), f.used.join(', '));
  ok('the italics on the page are the serif\'s own', f.italic > 0 && f.loaded.some(x => x === 'Newsreader italic'), f.italic + ' italic runs; ' + [...new Set(f.loaded)].join(', '));
  ok('nothing in the sans is set in italic (it would be synthesized)', f.fake.length === 0, f.fake.join(' | '));
  await p.close();
});

/* The stat bands are data-figs like any other, so the app fills them. The universal
 * band's sentence must follow the sign of the savings, as the label beside the figure
 * does, or it would tell a household that pays more that it keeps money. */
test('public notice: the stat bands carry the live figures and follow the savings sign', async b => {
  const p = await page(b, 1280, 900);
  const read = () => p.evaluate(() => ({
    hidden: document.querySelector('.band-stat [data-fig="emp.invisible"]').textContent,
    callout: document.querySelector('.callout [data-fig="emp.invisible"]').textContent,
    band: document.querySelector('.band-stat.teal [data-fig="uni.savings"]').textContent,
    save: document.getElementById('save').textContent,
    lbl: document.getElementById('saveLbl').textContent,
    k: document.getElementById('bandSaveK').textContent,
    say: document.getElementById('bandSaveSay').textContent }));
  let r = await read();
  ok('the paystub band matches the callout', r.hidden === r.callout && /^\$\d/.test(r.hidden), JSON.stringify([r.hidden, r.callout]));
  ok('the universal band matches the savings panel', r.band === r.save, JSON.stringify([r.band, r.save]));
  ok('keeping money: the band says so', /keep/.test(r.lbl) && /back in your household/.test(r.say) && !/more/.test(r.k), r.say);
  await p.locator('#route button[data-r="none"]').click(); await p.waitForTimeout(250);
  r = await read();
  const pays = /pay/.test(r.lbl);
  ok('the band follows the label when the sign flips', pays ? (/more for this household/.test(r.say) && /more/.test(r.k)) : /back in your household/.test(r.say), JSON.stringify([r.lbl, r.k, r.say]));
  await p.locator('#unit').click(); await p.waitForTimeout(200);
  ok('month view: the band sentence says a month', /^a month/.test((await read()).say), (await read()).say);
  await p.close();
});

/* Motion: figures count up and bars wipe in. It may decorate, never decide: once it
 * settles, every figure must read exactly what the reduced-motion page reads, the
 * letter must be untouched, and an unrevealed figure must hold its real value. */
test('public notice: motion settles on the same figures and leaves the letter alone', async b => {
  const still = await page(b, 1280, 900);
  const grab = q => q.evaluate(() => ({ figs: [...document.querySelectorAll('[data-fig]')].map(e => e.textContent),
                                         letter: document.getElementById('letterBd').innerText }));
  const want = await grab(still);
  ok('reduced motion: no motion class', !(await still.evaluate(() => document.documentElement.classList.contains('motion'))));
  await still.close();

  const q = await b.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'no-preference' });
  await q.goto(pathToFileURL(resolve(HERE, '../dist/index.html')).href); await q.waitForTimeout(1200);
  ok('motion on: the class is set', await q.evaluate(() => document.documentElement.classList.contains('motion')));
  const early = await q.evaluate(() => document.querySelector('.save .v').textContent);
  ok('a figure below the fold holds its real value before it is revealed', /^\$[1-9]/.test(early), early);
  for (let y = 0; y < 12000; y += 600) { await q.evaluate(y => window.scrollTo(0, y), y); await q.waitForTimeout(120); }
  await q.waitForTimeout(1800);
  const got = await grab(q);
  ok('every figure settles exactly on the reduced-motion value', JSON.stringify(got.figs) === JSON.stringify(want.figs),
     got.figs.map((v, i) => v === want.figs[i] ? '' : `${i}: ${v} vs ${want.figs[i]}`).filter(Boolean).join('; '));
  ok('the letter text is identical', got.letter === want.letter);
  await q.evaluate(() => { const i = document.getElementById('income'); i.value = '148000'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await q.waitForTimeout(900);
  ok('after an input change, the eased figures land on the new values', await q.evaluate(() =>
    document.querySelector('.save .v').textContent === document.querySelector('.band-stat.teal .band-v').textContent));
  // a model change replays the comparison bars' wipe; the same model does not
  const wipe = () => q.evaluate(() => getComputedStyle(document.getElementById('uBar')).clipPath);
  await q.evaluate(() => document.getElementById('uBar').scrollIntoView({ block: 'center' })); await q.waitForTimeout(1500);
  ok('settled, the bars are fully shown', /inset\(0(px)?\)|none/.test(await wipe()), await wipe());
  await q.locator('#pills .pill').nth(3).click(); await q.waitForTimeout(150);
  const mid = await wipe();
  ok('a different model replays the wipe', mid !== 'none' && !/^inset\(0(px)?\)$/.test(mid), mid);
  await q.waitForTimeout(1700);
  ok('and it settles fully shown again', /inset\(0(px)?\)|none/.test(await wipe()), await wipe());
  await q.locator('#pills .pill').nth(3).click(); await q.waitForTimeout(150);
  ok('the same model again replays nothing', /inset\(0(px)?\)|none/.test(await wipe()), await wipe());
  await q.close();
});

/* The letter's buttons wrap by the letter's own width: one row when all four fit,
 * the primary over three equal columns when they do not, one per row on the
 * narrowest letters. Never a lone secondary button on a row of its own, and never
 * a button past the edge of the letter. */
test('letter buttons: one row, two rows or a stack, never a stray button', async b => {
  for (const w of [1440, 1280, 1180, 1100, 1024, 900, 820, 768, 600, 480, 390, 320]) {
    const p = await page(b, w, 900, w < 600);
    const r = await p.evaluate(() => {
      const ft = document.querySelector('.letter .ft').getBoundingClientRect();
      const box = id => document.getElementById(id).getBoundingClientRect();
      const ids = ['formBtn', 'copyBtn', 'printBtn', 'sendBtn'], bx = ids.map(box);
      const rows = [...new Set(bx.map(x => Math.round(x.top)))].length;
      const sec = bx.slice(1), secRows = [...new Set(sec.map(x => Math.round(x.top)))].length;
      return { rows, secRows, inside: bx.every(x => x.left >= ft.left - 0.5 && x.right <= ft.right + 0.5),
               equal: Math.max(...sec.map(x => x.width)) - Math.min(...sec.map(x => x.width)), letter: Math.round(ft.width) };
    });
    const shape = r.rows === 1 ? 'one row' : (r.rows === 2 && r.secRows === 1 && r.equal < 1) ? 'two rows' : r.rows === 4 ? 'stack' : 'broken';
    ok(`${w}px (letter ${r.letter}px): ${shape}, inside the letter`, shape !== 'broken' && r.inside, JSON.stringify(r));
    await p.close();
  }
});

/* The ZIP field is the page's one action: on load it must be fully on screen, at the
 * window sizes people actually have (Tyler's laptop browser was about 1000x625). */
test('hero: the ZIP field is on screen at load', async b => {
  for (const [w, h, m] of [[1440, 800], [1280, 720], [1000, 625], [1024, 640], [1536, 760], [390, 740, true], [375, 600, true]]) {
    const p = await page(b, w, h, !!m);
    const r = await p.evaluate(() => {
      const z = document.querySelector('.zipbar').getBoundingClientRect(), h1 = document.querySelector('h1').getBoundingClientRect();
      const lh = parseFloat(getComputedStyle(document.querySelector('h1')).lineHeight) || parseFloat(getComputedStyle(document.querySelector('h1')).fontSize) * .86;
      return { bottom: Math.round(z.bottom), vh: innerHeight, lines: Math.round(h1.height / lh) };
    });
    ok(`${w}x${h}: ZIP field fully visible (bottom ${r.bottom}px of ${r.vh}), headline ${r.lines} lines`, r.bottom <= r.vh, JSON.stringify(r));
    await p.close();
  }
});

/* What leaves the page is plain text for a contact form, and many forms collapse a
 * single line break, so paragraphs are joined by a blank line. */
test('letter: copied text keeps its paragraphs apart', async b => {
  const p = await page(b, 1280, 900);
  await p.evaluate(() => { window.__clip = ''; navigator.clipboard.writeText = t => { window.__clip = t; return Promise.resolve(); }; });
  await p.locator('#copyBtn').click(); await p.waitForTimeout(250);
  const r = await p.evaluate(() => ({ clip: window.__clip, blocks: [...document.getElementById('letterBd').children].filter(e => e.innerText.trim()).length }));
  const paras = r.clip.split('\n\n');
  ok('one blank line between paragraphs, one paragraph per block', paras.length === r.blocks && !/\n{3,}/.test(r.clip) && paras.every(x => x.trim()), `${paras.length} vs ${r.blocks}`);
  ok('it opens with the greeting and closes with the source line', /^Dear /.test(paras[0]) && /^Figures calculated at thewholebill\.org/.test(paras[paras.length - 1]));
  await p.close();
});

/* The dated cosponsor sentence: the count comes from the same snapshot as the rep
 * card, it says "signed on" (the data does not tell a sponsor from a cosponsor),
 * and a senator hears where the other senator from the state stands. */
test('letter: the dated cosponsor sentence, for every recipient case', async b => {
  const p = await page(b, 1280, 900);
  const counts = await p.evaluate(() => {
    let h = 0, s = 0; for (const k in REPS.house) if (REPS.house[k] && REPS.house[k].co) h++;
    for (const k in REPS.senate) for (const m of REPS.senate[k]) if (m && m.co) s++;
    return { h, s, d: REPS.asOf };
  });
  const [y, mo, da] = counts.d.split('-').map(Number);
  const date = `${da} ${['January','February','March','April','May','June','July','August','September','October','November','December'][mo - 1]} ${y}`;
  const letter = () => p.evaluate(() => document.getElementById('letterBd').innerText);
  const zip = async z => { await p.fill('#zip', z); await p.locator('#zipGo').click(); await p.waitForTimeout(400); };
  const to = async rec => { await p.locator(rec === 'rep' ? '#recRep' : `#senRows .rec-hit[data-rec="${rec}"]`).click(); await p.waitForTimeout(250); };
  let t = await letter();
  ok('a representative who signed on: one of N House members, dated', t.includes(`As of ${date}, you are one of ${counts.h} House members who have signed on to it.`), (t.match(/As of[^\n]*/) || [''])[0]);
  await zip('75010'); t = await letter();
  ok('a representative who has not: N of your House colleagues', t.includes(`As of ${date}, ${counts.h} of your House colleagues have signed on to it.`), (t.match(/As of[^\n]*/) || [''])[0]);
  await to('sen0'); t = await letter();
  ok('Texas, neither senator: the count, and neither of my senators', t.includes(`${counts.s} senators have signed on to it. Neither of my senators is among them yet.`), (t.match(/As of[^\n]*/) || [''])[0]);
  await zip('55011'); await to('sen0'); t = await letter();
  ok('Minnesota, to Klobuchar: Senator Smith has, you have not yet', /Dear Senator Klobuchar/.test(t) && t.includes(`Senator Smith, who also represents Minnesota, has already signed on to it, one of ${counts.s} senators who have as of ${date}. You have not yet.`), (t.match(/Senator Smith[^\n]*/) || [''])[0]);
  await to('sen1'); t = await letter();
  ok('Minnesota, to Smith: one of N senators, no "along with" (Klobuchar has not)', /Dear Senator Smith/.test(t) && t.includes(`you are one of ${counts.s} senators who have signed on to it.`) && !/along with/.test(t));
  await p.close();
});

/* Header and footer navigation share one link voice: plain lowercase, untracked. */
test('footer: its links match the header navigation', async b => {
  for (const [w, m] of [[1280, false], [390, true]]) {
    const p = await page(b, w, 900, m);
    const r = await p.evaluate(() => {
      const st = el => { const c = getComputedStyle(el); return [c.textTransform, c.fontStretch, c.fontWeight, c.letterSpacing, c.fontSize].join(' '); };
      const foot = [...document.querySelectorAll('footer .foot-nav a')], head = document.querySelector('.masthead .nav a');
      return { n: foot.length, foot: [...new Set(foot.map(st))], head: st(head) };
    });
    ok(`${w}px: footer links are lowercase and styled like the header's`, r.n >= 3 && r.foot.length === 1 && r.foot[0] === r.head && /lowercase/.test(r.foot[0]), JSON.stringify(r));
    await p.close();
  }
});

const b = await chromium.launch();
for (const c of checks) {
  if (only && !c.name.toLowerCase().includes(only.toLowerCase())) continue;
  console.log(`\n\x1b[1m${c.name}\x1b[0m`);
  await c.fn(b);
}
await b.close();
console.log(`\n${fail ? '\x1b[31m' : '\x1b[32m'}${pass} passed, ${fail} failed\x1b[0m`);
process.exit(fail ? 1 : 0);
