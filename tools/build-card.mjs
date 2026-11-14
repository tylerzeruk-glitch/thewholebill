// Renders src/card.png, the 1200x630 share image, from the same faces the site
// uses (Newsreader for the headline and wordmark, Inter for the labels), so the
// card never drifts from the page when the typography changes. Needs playwright
// (npm run setup) and network for fonts.
//   node tools/build-card.mjs
// The story bar (2026-11-14): the site's opening in miniature. The dark ink ground,
// the headline in Newsreader with its amber italic, Inter for labels (the site's sans
// since 2026-11-12), and the one stacked bar the page is built around, at the example
// household's proportions ($7,471 paycheck, $1,378 Medicare tax, $20,832 employer,
// $3,800 at the doctor). Parts are named, not priced: a figure on a share card would
// read as the viewer's own. Flat colours, no gradient: bands are data.
import { chromium } from 'playwright';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../src/card.png');
const H = 452;
const parts = [   // bottom to top, as the story stacks them
  [7471, '#F0C98D', 'From your paycheck'],
  [1378, '#86603E', 'Medicare tax'],
  [20832, '#D99A3F', 'Paid by your employer'],
  [3800, '#A87A43', 'At the doctor'],
];
const whole = parts.reduce((a, p) => a + p[0], 0);
const segs = parts.map(([v, c, l]) => {
  const h = v / whole * H;
  return `<div class="seg" style="height:${h.toFixed(1)}px;background:${c}">` +
    (h >= 18 ? `<span class="lab">${l}</span>` : '') + '</div>';
}).join('');
const html = `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400..500;1,6..72,400..500&family=Inter:wght@400..500&display=swap">
<style>
*{margin:0;box-sizing:border-box}
body{width:1200px;height:630px;background:#12141A;color:#E8E6E1;font-family:'Inter',sans-serif;position:relative;overflow:hidden}
.brand{position:absolute;left:72px;top:58px;display:flex;align-items:center;gap:14px;font-family:'Newsreader',Georgia,serif;font-size:30px;letter-spacing:-.012em}
.year{position:absolute;left:72px;top:118px;font-weight:500;font-size:15px;letter-spacing:.14em;text-transform:uppercase;color:#3FB5AE}
h1{position:absolute;left:72px;top:160px;width:640px;font-family:'Newsreader',Georgia,serif;font-weight:400;font-size:92px;line-height:1;letter-spacing:-.026em}
h1 em{font-style:italic;color:#D99A3F}
.sub{position:absolute;left:72px;top:452px;font-family:'Newsreader',Georgia,serif;font-size:30px;line-height:1.3;color:#B9BCC4}
.domain{position:absolute;left:72px;bottom:46px;font-weight:500;font-size:17px;letter-spacing:.14em;text-transform:uppercase;color:#8A8F9C}
.bar{position:absolute;right:96px;bottom:${(630 - H) / 2}px;width:116px;display:flex;flex-direction:column-reverse}
.seg{position:relative;width:116px;flex-shrink:0}
.lab{position:absolute;right:136px;top:50%;transform:translateY(-50%);white-space:nowrap;font-size:19px;color:#B9BCC4}
.seg:nth-child(3) .lab{color:#E8E6E1;font-weight:500}
</style>
<div class="brand"><svg width="18" height="34" viewBox="0 0 13 24"><rect x="0" y="0" width="13" height="2.5" fill="#86603E"/><rect x="0" y="2.5" width="13" height="3.5" fill="#A87A43"/><rect x="0" y="6" width="13" height="12" fill="#D99A3F"/><rect x="0" y="18" width="13" height="6" fill="#F0C98D"/></svg>The Whole Bill</div>
<div class="year">Plan year 2027</div>
<h1>What does your healthcare <em>actually</em> cost?</h1>
<p class="sub">Not the number on your paystub.<br>The whole number.</p>
<div class="domain">thewholebill.org</div>
<div class="bar">${segs}</div>`;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await p.setContent(html); await p.waitForTimeout(1500); await p.evaluate(() => document.fonts.ready);
const loaded = await p.evaluate(() => [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family));
if (!loaded.some(f => /Newsreader/.test(f)) || !loaded.some(f => /Inter/.test(f))) throw new Error('build-card: fonts did not load: ' + loaded.join(', '));
await p.screenshot({ path: out, type: 'png' });
await b.close();
console.log('wrote src/card.png with', [...new Set(loaded)].join(', '));
