// Renders src/card.png, the 1200x630 share image, from the same faces the site
// uses (Newsreader, Public Sans), so the card never drifts from the page when the
// typography changes. Needs playwright (npm run setup) and network for fonts.
//   node tools/build-card.mjs
import { chromium } from 'playwright';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../src/card.png');
const html = `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;1,6..72,400&family=Public+Sans:wght@500&display=swap">
<style>
*{margin:0;box-sizing:border-box}
body{width:1200px;height:630px;background:#12141A;color:#E8E6E1;font-family:'Newsreader',Georgia,serif;position:relative;overflow:hidden}
.brand{position:absolute;left:84px;top:72px;display:flex;align-items:center;gap:14px;font-size:27px;letter-spacing:-.012em}
h1{position:absolute;left:84px;top:186px;width:720px;font-weight:400;font-size:84px;line-height:1.0;letter-spacing:-.02em;color:#EDEBE6;text-wrap:balance}
h1 em{font-style:italic;color:#D99A3F}
.domain{position:absolute;left:84px;bottom:72px;font-family:'Public Sans',system-ui,sans-serif;font-weight:500;font-size:22px;letter-spacing:.17em;color:#8A8F9C}
.bars{position:absolute;right:84px;bottom:100px;display:flex;align-items:flex-end;gap:16px}
.col{width:50px;display:flex;flex-direction:column-reverse}
.b{width:50px}
</style>
<div class="brand"><svg width="18" height="34" viewBox="0 0 13 24"><rect x="0" y="0" width="13" height="2.5" fill="#86603E"/><rect x="0" y="2.5" width="13" height="3.5" fill="#A87A43"/><rect x="0" y="6" width="13" height="12" fill="#D99A3F"/><rect x="0" y="18" width="13" height="6" fill="#F0C98D"/></svg>The Whole Bill</div>
<h1>What does your healthcare <em>actually</em> cost?</h1>
<div class="domain">thewholebill.org</div>
<div class="bars">
  <div class="col"><div class="b" style="height:92px;background:#F0C98D"></div></div>
  <div class="col"><div class="b" style="height:92px;background:#F0C98D"></div><div class="b" style="height:282px;background:#D99A3F"></div></div>
  <div class="col"><div class="b" style="height:92px;background:#F0C98D"></div><div class="b" style="height:282px;background:#D99A3F"></div><div class="b" style="height:52px;background:#A87A43"></div></div>
  <div class="col"><div class="b" style="height:92px;background:#F0C98D"></div><div class="b" style="height:282px;background:#D99A3F"></div><div class="b" style="height:52px;background:#A87A43"></div><div class="b" style="height:20px;background:#86603E"></div></div>
</div>`;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await p.setContent(html); await p.waitForTimeout(1500); await p.evaluate(() => document.fonts.ready);
const loaded = await p.evaluate(() => [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family));
if (!loaded.some(f => /Newsreader/.test(f)) || !loaded.some(f => /Public Sans/.test(f))) throw new Error('build-card: fonts did not load: ' + loaded.join(', '));
await p.screenshot({ path: out, type: 'png' });
await b.close();
console.log('wrote src/card.png with', [...new Set(loaded)].join(', '));
