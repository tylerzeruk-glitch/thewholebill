// Renders src/card.png, the 1200x630 share image, from the same faces the site
// uses (Archivo for the headline and labels, Newsreader for the wordmark), so the
// card never drifts from the page when the typography changes. Needs playwright
// (npm run setup) and network for fonts.
//   node tools/build-card.mjs
// Public Notice (2026-10-09): the site's own hero in miniature. The amber notice
// strip, the condensed headline on paper, and the whole bill's four columns at the
// example household's proportions ($6,850, $20,143, $3,800, $1,378).
import { chromium } from 'playwright';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../src/card.png');
const H = 360, parts = [6850, 20143, 3800, 1378], whole = parts.reduce((a, b) => a + b, 0);
const tones = ['#F0C98D', '#D99A3F', '#A87A43', '#86603E'];
const cols = parts.map((_, i) => '<div class="col">' + parts.slice(0, i + 1).map((v, j) =>
  `<div class="b" style="height:${(v / whole * H).toFixed(1)}px;background:${tones[j]}"></div>`).join('') + '</div>').join('');
const html = `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..100,400..900&family=Newsreader:wght@400..500&display=swap">
<style>
*{margin:0;box-sizing:border-box}
body{width:1200px;height:630px;background:#FAF7F2;color:#1A1815;font-family:'Archivo',sans-serif;position:relative;overflow:hidden}
.strip{position:absolute;left:0;right:0;top:0;height:46px;background:#D99A3F;color:#1E1509;display:flex;align-items:center;justify-content:space-between;padding:0 72px;font-stretch:80%;font-weight:700;font-size:17px;letter-spacing:.14em;text-transform:uppercase}
.brand{position:absolute;left:72px;bottom:62px;display:flex;align-items:center;gap:14px;font-family:'Newsreader',Georgia,serif;font-size:30px;letter-spacing:-.012em}
h1{position:absolute;left:72px;top:104px;width:700px;font-stretch:62%;font-weight:850;text-transform:uppercase;font-size:108px;line-height:.86;letter-spacing:-.004em}
h1 em{font-style:normal;color:#8E6018}
.domain{position:absolute;right:72px;bottom:66px;font-stretch:85%;font-weight:700;font-size:21px;letter-spacing:.16em;text-transform:uppercase;color:#6B6459}
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
if (!loaded.some(f => /Newsreader/.test(f)) || !loaded.some(f => /Archivo/.test(f))) throw new Error('build-card: fonts did not load: ' + loaded.join(', '));
await p.screenshot({ path: out, type: 'png' });
await b.close();
console.log('wrote src/card.png with', [...new Set(loaded)].join(', '));
