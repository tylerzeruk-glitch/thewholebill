// Renders src/updates.js three ways, for build.sh:
//   box    the hero's "What changed" entries (pins, then newest, three in all)
//   list   every entry, for the /updates page
//   rss    /updates.xml
//   count  how many entries, so the build can refuse an empty log
//
//   node tools/build-updates.mjs      prints {"box":"...","list":"...","rss":"...","count":9}
//
// Hrefs are written the src way (#/methodology/<id>, #/updates/<id>) and
// build.sh rewrites them per document, exactly as it does for the page.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const U = require('../src/updates.js');

const SITE = 'https://thewholebill.org';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const long = iso => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
const kindWord = k => k === 'world' ? 'World' : 'Site';
const strip = s => s.replace(/<[^>]+>/g, '').replace(/&rsquo;/g, '’').replace(/&amp;/g, '&');
const xml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const entries = U.slice().sort((a, b) => b.date.localeCompare(a.date));
const pins = entries.filter(e => e.pin);
const box = pins.concat(entries.filter(e => !e.pin)).slice(0, 3).sort((a, b) => b.date.localeCompare(a.date));

const boxHtml = box.map(e =>
  `<p><a class="upd-when" href="#/updates/u-${e.id}">${long(e.date)} &middot; ${kindWord(e.kind)}</a>${e.title}</p>`).join('\n        ');

const listHtml = entries.map(e => {
  const src = e.source ? `Source: <a class="srclink" href="${e.source.url}" rel="noopener">${e.source.title}</a>.` : '';
  const see = e.see ? `Explained under <a class="term" href="#/methodology/${e.see.id}">${e.see.text}</a>.` : '';
  return `<article class="upd" id="u-${e.id}">
        <div class="upd-h"><span class="tag ${e.kind}">${kindWord(e.kind)}</span><a href="#/updates/u-${e.id}"><time datetime="${e.date}">${long(e.date)}</time></a></div>
        <h3>${e.title}</h3>
        <p class="body">${e.body}</p>
        ${src || see ? `<p class="note">${[src, see].filter(Boolean).join(' ')}</p>` : ''}
      </article>`;
}).join('\n      ');

const rfc822 = iso => new Date(iso + 'T12:00:00Z').toUTCString();
const items = entries.map(e => {
  const link = `${SITE}/updates/#u-${e.id}`;
  const desc = `<p>${e.body}</p>` + (e.source ? `<p>Source: <a href="${e.source.url}">${e.source.title}</a></p>` : '')
             + (e.see ? `<p>Explained under <a href="${SITE}/methodology/#${e.see.id}">${e.see.text}</a></p>` : '');
  return `    <item>
      <title>${xml(strip(e.title))}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <pubDate>${rfc822(e.date)}</pubDate>
      <category>${kindWord(e.kind)}</category>
      <description>${xml(desc)}</description>
    </item>`;
}).join('\n');
const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>The Whole Bill: what changed</title>
    <link>${SITE}/updates/</link>
    <atom:link href="${SITE}/updates.xml" rel="self" type="application/rss+xml"/>
    <description>A dated log of what moved: the law and the data the calculator rests on, and the site itself.</description>
    <language>en-us</language>
    <lastBuildDate>${rfc822(entries[0].date)}</lastBuildDate>
${items}
  </channel>
</rss>
`;
process.stdout.write(JSON.stringify({ box: boxHtml, list: listHtml, rss, count: entries.length }) + '\n');
