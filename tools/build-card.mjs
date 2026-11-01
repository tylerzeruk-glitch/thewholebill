// Renders src/card.png, the 1200x630 share image, from the same faces the site
// uses (Newsreader for the headline and wordmark, Hanken Grotesk for the labels), so the
// card never drifts from the page when the typography changes. Needs playwright
// (npm run setup) and network for fonts.
//   node tools/build-card.mjs
// Public Notice (2026-10-09): the site's own hero in miniature. The amber notice
// strip, the headline on paper (in the Newsroom type: serif, amber italic) and the
// whole bill's four columns at the example household's proportions
// ($7,471, $20,832, $3,800, $1,378).
import { chromium } from 'playwright';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../src/card.png');
const H = 360, parts = [7471, 20832, 3800, 1378], whole = parts.reduce((a, b) => a + b, 0);
const tones = ['#F0C98D', '#D99A3F', '#A87A43', '#86603E'];
const cols = parts.map((_, i) => '<div class="col">' + parts.slice(0, i + 1).map((v, j) =>
  `<div class="b" style="height:${(v / whole * H).toFixed(1)}px;background:${tones[j]}"></div>`).join('') + '</div>').join('');
const html = `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400..500;1,6..72,400..500&family=Hanken+Grotesk:wght@400..500&display=swap">
<style>
*{margin:0;box-sizing:border-box}
body{width:1200px;height:630px;background:#FAF7F2;color:#1A1815;font-family:'Hanken Grotesk',sans-serif;position:relative;overflow:hidden}
.strip{position:absolute;left:0;right:0;top:0;height:46px;background:#D99A3F;color:#1E1509;display:flex;align-items:center;justify-content:space-between;padding:0 72px;font-weight:500;font-size:17px;letter-spacing:.13em;text-transform:uppercase}
.brand{position:absolute;left:72px;bottom:62px;display:flex;align-items:center;gap:14px;font-family:'Newsreader',Georgia,serif;font-size:30px;letter-spacing:-.012em}
h1{position:absolute;left:72px;top:110px;width:660px;font-family:'Newsreader',Georgia,serif;font-weight:400;font-size:100px;line-height:1;letter-spacing:-.026em}
h1 em{font-style:italic;color:#8E6018}
.domain{position:absolute;right:72px;bottom:66px;font-weight:500;font-size:20px;letter-spacing:.14em;text-transform:uppercase;color:#6B6459}
.bars{position:absolute;right:72px;bottom:118px;display:flex;align-items:flex-end;gap:14px}
.col{width:58px;display:flex;flex-direction:column-reverse}
.b{width:58px}
.total{width:84px;background:linear-gradient(180deg,#E8AC53,#C9832F);margin-left:18px}
</style>
<div class="strip"><span>Public notice</span><span>What healthcare costs your household</span></div>
<h1>What does your healthcare <em>actually</em> cost?</h1>
<div class="bars">${cols}<div class="total" style="height:${H}px"></div></div>
<div class="brand"><svg width="18" height="34" viewBox="0 0 13 24"><rect x="0" y="0" width="13" height="2.5" fill="#86603E"/><rect x="0" y="2.5" width="13" height="3.5" fill="#A87A43"/><rect x="0" y="6" width="13" height="12" fill="#D99A3F"/><rect x="0" y="18" width="13" height="6" fill="#F0C98D"/></svg>The Whole Bill</div>
<div class="domain">thewholebill.org</div>`;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await p.setContent(html); await p.waitForTimeout(1500); await p.evaluate(() => document.fonts.ready);
const loaded = await p.evaluate(() => [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family));
if (!loaded.some(f => /Newsreader/.test(f)) || !loaded.some(f => /Hanken Grotesk/.test(f))) throw new Error('build-card: fonts did not load: ' + loaded.join(', '));
await p.screenshot({ path: out, type: 'png' });
await b.close();
console.log('wrote src/card.png with', [...new Set(loaded)].join(', '));
