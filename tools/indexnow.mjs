// Tell IndexNow (Bing, and the engines that share it) that the site changed.
//   node tools/indexnow.mjs
// Keyless in the secret sense: the key is a public file at the site root that
// proves the request comes from the host. Nothing else is needed, no account.
// Run after a deploy; the GitHub workflow does it on every push to main.
import { readdirSync, readFileSync } from 'node:fs';
const key = readdirSync(new URL('../src/', import.meta.url)).find(f => /^[0-9a-f]{32}\.txt$/.test(f)).replace(/\.txt$/, '');
const host = 'thewholebill.org';
const urlList = readFileSync(new URL('../src/sitemap.txt', import.meta.url), 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
const r = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host, key, keyLocation: `https://${host}/${key}.txt`, urlList })
});
console.log('IndexNow', r.status, urlList.length + ' urls');
if (r.status >= 400) { console.log(await r.text()); process.exit(1); }
