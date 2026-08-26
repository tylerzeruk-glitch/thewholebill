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

/* The one-row bar has very little slack between its 900px breakpoint and ~1100px.
 * It fit on macOS and overflowed on Linux, where the same labels set a few pixels
 * wider -- so this asserts the row absorbs the squeeze at every width rather than
 * pushing the Year/Month switch out through overflow-x. */
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
