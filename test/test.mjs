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

const page = async (browser, w, h, mobile=false) => {
  const p = await browser.newPage({ viewport:{width:w,height:h}, deviceScaleFactor:1, isMobile:mobile, hasTouch:mobile });
  p.on('pageerror', e => ok('no page errors', false, e.message));
  p.on('console', m => { if (m.type()==='error' && !/TUNNEL|ERR_|net::/.test(m.text())) ok('no console errors', false, m.text()); });
  await p.goto(URL); await p.waitForTimeout(1200);
  return p;
};
const setIncome = async (p, v) => { await p.locator('#income').fill(String(v)); await p.locator('#income').dispatchEvent('input'); await p.waitForTimeout(120); };

test('calc: loads and computes in node, outside any browser', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const W = require('../src/calc.js');
  ok('calc.js loads in node', typeof W.summary === 'function', Object.keys(W).length + ' exports');
  const s = W.summary({ income:95000, size:4, adults:2, area:'CT-1', model:'sanders1' });
  ok('poverty line for a household of 4', Math.round(s.fpl.line) === 32150, `$${Math.round(s.fpl.line)}`);
  ok('employer total is the sum of its parts',
     Math.abs(s.employer.total - (s.employer.worker + s.employer.employer + s.employer.oop + s.employer.medicareTax)) < 0.01);
  ok('the 400% cliff has no credit', W.applicablePercentage(4.0) === null);
  ok('just under the cliff still has one', W.applicablePercentage(3.99) > 0);
  const d = W.cliffDrop({ size:4, adults:2, area:'CT-1', region:'contiguous' });
  ok('cliff drop equals the credit lost', Math.abs(d.drop - d.lostCredit) < 1,
     `$${Math.round(d.drop)} at $${Math.round(d.income)}`);
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

/* Supporting text inherits the width of whatever chart it sits under, so these
 * blocks ran 108-147 characters per line against a readable 45-75 -- the worst
 * of them WHILE carrying max-width:820px, because a pixel cap cannot know the
 * type was made smaller. The cap is in `ch` now; this asserts the result rather
 * than the rule, so shrinking a font or widening a container fails here. */
test('readability: supporting text keeps a readable measure', async b => {
  for (const [w,h] of [[1440,900],[1100,900]]) {
    const p = await page(b,w,h);
    for (const view of ['main','methodology']) {
      if (view === 'methodology') { await p.evaluate(()=>{location.hash='#/methodology';}); await p.waitForTimeout(300); }
      const bad = await p.evaluate(()=>[...document.querySelectorAll('p.note,p.note-i,p.fn')]
        .filter(e=>e.offsetHeight>0)
        .map(e=>{ const r=document.createRange(); r.selectNodeContents(e);
          const lines=new Set([...r.getClientRects()].filter(x=>x.height>1).map(x=>Math.round(x.top)));
          const t=e.textContent.trim().replace(/\s+/g,' ');
          return { cpl: lines.size ? Math.round(t.length/lines.size) : 0, t:t.slice(0,44) }; })
        .filter(x=>x.cpl>75));
      ok(`${w}px ${view}: every note under 75 characters per line`, bad.length === 0,
         bad.slice(0,2).map(x=>`${x.cpl}cpl "${x.t}…"`).join(' | '));
    }
    await p.close();
  }
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
    for (const model of [0,1]) {
      await p.locator('#pills button').nth(model).click();
      await p.waitForTimeout(250);
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
  for (const [model,bands] of [[0,2],[1,3]]) {
    await p.locator('#pills button').nth(model).click();
    await p.waitForTimeout(250);
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
               mkt:t('[data-fig="mkt.household"]'), bands };
    });
    // the waterfall's total column is the whole bill for this route
    ok(`${route}: waterfall total is the route's whole bill`, n(r.whole) > 0, r.whole);
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
test('ages: the field drives the split, and size follows it', async b => {
  const p = await page(b,1440,900);
  const read = () => p.evaluate(()=>({
    size:document.getElementById('sizeVal').textContent,
    ages:document.getElementById('ages').value,
    whole:+document.querySelector('[data-fig="route.whole"]').textContent.replace(/[^0-9]/g,''),
    note:!document.getElementById('agesNote').hidden }));
  await p.locator('#route button[data-r="marketplace"]').click();
  await p.waitForTimeout(250);

  const two = await read();
  await p.fill('#ages', '41, 39, 30, 9');       // third person becomes an adult
  await p.waitForTimeout(250);
  const three = await read();
  ok('an extra adult changes the marketplace bill', three.whole > two.whole,
     `$${two.whole.toLocaleString()} -> $${three.whole.toLocaleString()}`);

  await p.fill('#ages', '41, 39');
  await p.waitForTimeout(250);
  ok('the count of ages is the household size', (await read()).size === '2');

  await p.locator('#sizeUp').click();
  await p.waitForTimeout(200);
  const stepped = await read();
  ok('stepping size grows the ages list', stepped.ages === '41, 39, 10' && stepped.size === '3', stepped.ages);

  await p.fill('#ages', '70, 39');
  await p.waitForTimeout(250);
  ok('65+ raises the Medicare note', (await read()).note);
  await p.fill('#ages', '41, 39');
  await p.waitForTimeout(250);
  ok('and it clears again', !(await read()).note);

  // Junk mid-keystroke must never blank the model or the figures.
  await p.fill('#ages', 'x,,');
  await p.waitForTimeout(200);
  const junk = await read();
  ok('junk input leaves the last good state in force', +junk.size >= 1 && junk.whole > 0,
     `size ${junk.size}, whole ${junk.whole}`);
  await p.fill('#ages', '8 22 45');
  await p.locator('#ages').blur();
  await p.waitForTimeout(200);
  ok('blur normalises the separators', (await read()).ages === '8, 22, 45', (await read()).ages);
  await p.close();
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

  await p.click('#deductReset');
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
  ok('all three reads as your numbers', /Using your numbers/.test(await sum()));

  const mktOop = await p.evaluate(()=>{
    const line=[...document.getElementById('mktSub').innerText.split('\n')].find(l=>/out-of-pocket/.test(l));
    return +line.replace(/[^0-9]/g,'');
  });
  ok('the marketplace out-of-pocket is untouched', mktOop === 5200, `$${mktOop}`);

  await p.fill('#totPrem','9000');
  await p.waitForTimeout(250);
  ok('an impossible pair is called out', /less than the deduction/.test(await sum()));

  for (const id of ['totPrem','deduct','oopIn']) await p.fill('#'+id,'');
  await p.waitForTimeout(250);
  ok('clearing all three returns to the averages',
     /survey averages/.test(await sum()) && n((await cards())[1]) === 20143);
  await p.close();
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
  ok('drop = over − under', n(d.drop) === n(d.over) - n(d.under), `${d.under} → ${d.over} = ${d.drop}`);
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

test('routing: methodology is its own view', async b => {
  const p = await page(b,1440,900);
  const st = () => p.evaluate(()=>({ meth:!document.getElementById('methodology').hidden,
    hero:!document.querySelector('section.paper').hidden, title:document.title }));
  const a = await st();
  ok('main view by default', a.meth===false && a.hero===true);
  await p.evaluate(()=>{location.hash='#/methodology';}); await p.waitForTimeout(300);
  const c = await st();
  ok('methodology view hides the flow', c.meth===true && c.hero===false);
  ok('title changes', /Methodology/.test(c.title), c.title);
  await p.evaluate(()=>{location.hash='';}); await p.waitForTimeout(300);
  ok('back to main', (await st()).hero===true);
  await p.close();
});

test('scope: ZIP never returns someone else\'s numbers', async b => {
  const p = await page(b,1440,900);
  for (const [zip, expect] of [['06106','CT-1'],['75201','TX-26'],['10001','NY-4']]) {
    await p.locator('#zip').fill(zip); await p.locator('#zipGo').click(); await p.waitForTimeout(300);
    ok(`${zip} → correct area`, (await p.evaluate(()=>document.getElementById('area').value)) === expect);
  }
  await p.locator('#zip').fill('44113'); await p.locator('#zipGo').click(); await p.waitForTimeout(300);
  const t = await p.evaluate(()=>document.getElementById('scope').textContent);
  ok('uncovered ZIP says so', /not in this preview/.test(t), t.slice(0,60));
  await p.close();
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

const b = await chromium.launch();
for (const c of checks) {
  if (only && !c.name.toLowerCase().includes(only.toLowerCase())) continue;
  console.log(`\n\x1b[1m${c.name}\x1b[0m`);
  await c.fn(b);
}
await b.close();
console.log(`\n${fail ? '\x1b[31m' : '\x1b[32m'}${pass} passed, ${fail} failed\x1b[0m`);
process.exit(fail ? 1 : 0);
