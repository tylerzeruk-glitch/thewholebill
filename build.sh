#!/bin/sh
# src/page.html + src/calc.js + src/benchmarks.js + src/reps.js  ->  dist/
#   preview/artifact.html         page content only, hash-routed methodology
#                                 (the Artifact host serves ONE document and
#                                 supplies the skeleton). OUTSIDE dist on
#                                 purpose: dist deploys wholesale, and the
#                                 public site should not carry a bare duplicate
#                                 of itself at /artifact
#   dist/index.html               the calculator, standalone; methodology
#                                 stripped, links point at /methodology, and
#                                 old #/methodology links redirect there
#   dist/methodology/index.html   the methodology as its own document: the
#                                 METH block unhidden plus the footer, no
#                                 scripts (the page is fully static)
#   dist/updates/index.html       the dated log, the same way from the UPD
#                                 block; dist/updates.xml is its RSS feed.
#                                 Both, and the hero's What changed box, are
#                                 rendered from src/updates.js
#   dist/logo.svg                 the mark the Access login page loads via its
#                                 one-path bypass (see docs/DEPLOY.md)
#   dist/card.png, 404.html, robots.txt, sitemap.txt, _headers
#                                 launch furniture, copied verbatim from src/
#   dist/mark.png                 the logo.svg glyph as a 120px PNG, for email
#                                 signatures (mail clients do not render SVG)
# The source template is never modified.
set -e
cd "$(dirname "$0")"
mkdir -p dist dist/methodology dist/updates preview
python3 - <<'PY'
import io, json, re, subprocess
calc = io.open('src/calc.js', encoding='utf-8').read()
reps = io.open('src/reps.js', encoding='utf-8').read()
bench = io.open('src/benchmarks.js', encoding='utf-8').read()
page = io.open('src/page.html', encoding='utf-8').read()
for marker in ('/*__CALC__*/', '/*__REPS__*/', '/*__BENCH__*/',
               '<!-- METH:START', '<!-- METH:END -->',
               '<!-- UPD:START', '<!-- UPD:END -->',
               '<!-- UPDATES:BOX -->', '<!-- UPDATES:LIST -->', '<!-- JSONLD -->',
               '<title>The Whole Bill</title>'):
    if marker not in page:
        raise SystemExit('build: ' + marker + ' marker missing from src/page.html')
# --- placeholders: every static figure is generated from the default state ---
# The HTML shows figures before JavaScript runs (crawlers, reader mode, the
# share unfurl). They used to be typed by hand and drifted from what the code
# painted a second later. Now tools/default-figures.mjs computes them from the
# same arithmetic and they are written into each data-fig element here.
figs = json.loads(subprocess.check_output(['node', 'tools/default-figures.mjs']))
missing = []
def fill(mo):
    key = mo.group(2)
    if key not in figs:
        missing.append(key)
        return mo.group(0)
    return mo.group(1) + figs[key] + mo.group(3)
page, nfilled = re.subn(r'(<[^>]*\bdata-fig="([^"]+)"[^>]*>)\$[0-9,]+(<)', fill, page)
if missing:
    raise SystemExit('build: no default figure for data-fig ' + ', '.join(sorted(set(missing))))
if nfilled < 10:
    raise SystemExit('build: only %d placeholder figures filled; the markup changed shape' % nfilled)
# --- what changed: the hero box, the /updates list and the feed, one log ---
upd = json.loads(subprocess.check_output(['node', 'tools/build-updates.mjs']))
if upd['count'] < 1:
    raise SystemExit('build: src/updates.js is empty')
page = page.replace('<!-- UPDATES:BOX -->', upd['box'], 1)
page = page.replace('<!-- UPDATES:LIST -->', upd['list'], 1)
io.open('dist/updates.xml', 'w', encoding='utf-8').write(upd['rss'])
out = page.replace('/*__BENCH__*/', '\n' + bench + '\n', 1)
out = out.replace('/*__CALC__*/', '\n' + calc + '\n', 1)
out = out.replace('/*__REPS__*/', '\n' + reps + '\n', 1)

# --- artifact: the whole document, hash-routed, outside the deploy ----------
io.open('preview/artifact.html', 'w', encoding='utf-8').write(out.replace('<!-- JSONLD -->', '', 1))

HERO = '\n<!-- ============ 01 HERO'
head = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n')

# --- index: the calculator without the methodology block --------------------
ms = out.index('<!-- METH:START')
me = out.index('<!-- METH:END -->') + len('<!-- METH:END -->')
us = out.index('<!-- UPD:START')
ue = out.index('<!-- UPD:END -->') + len('<!-- UPD:END -->')
if not ms < me <= us < ue:
    raise SystemExit('build: the METH and UPD blocks are out of order')
web = out[:ms] + out[me:us] + out[ue:]
def public_links(s):
    # deep links land on a section of the real page; plain view links on the page
    s = s.replace('href="#/methodology/', 'href="/methodology/#')
    s = s.replace('href="#/methodology"', 'href="/methodology"')
    s = s.replace('href="#/updates/', 'href="/updates/#')
    s = s.replace('href="#/updates"', 'href="/updates"')
    return s
web = public_links(web)

# --- search and assistants: titles that say what the page is, structured data ----
# The <title> in src stays "The Whole Bill" (the artifact's router sets titles at
# runtime); each public document gets a title with the words people search for,
# a description of its own, and JSON-LD. The FAQ block is read from the
# objections section so it cannot drift from the cards.
SITE = 'https://thewholebill.org'
KEYWORDS = ['Medicare for All', 'universal healthcare', 'single-payer', 'healthcare cost calculator',
            'health insurance cost', 'employer health insurance', 'ACA marketplace premiums',
            'premium tax credit', 'subsidy cliff', 'COBRA cost']
ABOUT = [{'@type': 'Thing', 'name': n} for n in ['Medicare for All', 'Universal healthcare', 'Single-payer healthcare',
         'Health insurance costs in the United States', 'Affordable Care Act premium tax credit']]
INDEX_DESC = re.search(r'<meta name="description" content="([^"]+)">', page).group(1)
METH_DESC = 'Every number on the healthcare cost calculator traced to its source: the premium tax credit, the subsidy cliff, employer premiums, six Medicare for All models.'
UPD_DESC = 'A dated log of the law and data behind the healthcare cost calculator, from the premium tax credit to Medicare for All financing models, and the site itself.'
def text_of(html):
    t = re.sub(r'<[^>]+>', '', html)
    t = t.replace('&rsquo;', '\u2019').replace('&lsquo;', '\u2018').replace('&ldquo;', '\u201c').replace('&rdquo;', '\u201d')
    t = t.replace('&amp;', '&').replace('&times;', '\u00d7').replace('&asymp;', '\u2248').replace('&middot;', '\u00b7').replace('&nbsp;', ' ')
    return re.sub(r'\s+', ' ', t).strip()
obj = page[page.index('id="objections"'):]
obj = obj[:obj.index('</section>')]
faq = []
for card in re.findall(r'<div class="card-p">([\s\S]*?)</div>\s*(?=<div class="card-p">|</div>)', obj):
    q = re.search(r'<div class="quote">([\s\S]*?)</div>', card)
    a = re.search(r'<p class="body">([\s\S]*?)</p>', card)
    if q and a:
        faq.append({'@type': 'Question', 'name': text_of(q.group(1)).strip('\u201c\u201d'),
                    'acceptedAnswer': {'@type': 'Answer', 'text': text_of(a.group(1))}})
if len(faq) < 4:
    raise SystemExit('build: found only %d objections for the FAQ block; the markup changed shape' % len(faq))
def ld(objs):
    return '<script type="application/ld+json">' + json.dumps(objs, ensure_ascii=False) + '</script>'
site_ld = {'@type': 'WebSite', 'name': 'The Whole Bill', 'url': SITE + '/', 'description': INDEX_DESC, 'inLanguage': 'en-US', 'keywords': KEYWORDS}
index_ld = ld({'@context': 'https://schema.org', '@graph': [
    site_ld,
    {'@type': 'WebApplication', 'name': 'The Whole Bill healthcare cost calculator', 'url': SITE + '/',
     'description': INDEX_DESC, 'applicationCategory': 'FinanceApplication', 'operatingSystem': 'Any',
     'browserRequirements': 'Requires JavaScript', 'isAccessibleForFree': True,
     'offers': {'@type': 'Offer', 'price': '0', 'priceCurrency': 'USD'}, 'about': ABOUT, 'keywords': KEYWORDS},
    {'@type': 'FAQPage', 'name': 'The objections, taken seriously', 'url': SITE + '/#objections', 'mainEntity': faq}]})
meth_ld = ld({'@context': 'https://schema.org', '@type': 'WebPage', 'name': 'Methodology', 'url': SITE + '/methodology',
              'description': METH_DESC, 'isPartOf': site_ld, 'about': ABOUT, 'inLanguage': 'en-US'})
upd_ld = ld({'@context': 'https://schema.org', '@type': 'WebPage', 'name': 'What changed', 'url': SITE + '/updates',
             'description': UPD_DESC, 'isPartOf': site_ld, 'about': ABOUT, 'inLanguage': 'en-US'})
web = web.replace('<title>The Whole Bill</title>', '<title>What your healthcare actually costs \u00b7 The Whole Bill</title>', 1)
web = web.replace('<meta property="og:title" content="The Whole Bill">', '<meta property="og:title" content="What your healthcare actually costs \u00b7 The Whole Bill">', 1)
web = web.replace('<!-- JSONLD -->', index_ld, 1)
i = web.index(HERO)
io.open('dist/index.html', 'w', encoding='utf-8').write(
    head + web[:i] + '\n</head>\n<body>\n' + web[i:] + '\n</body>\n</html>\n')

# --- /methodology: the block unhidden, plus the footer, no scripts ----------
meth_head = out[:out.index(HERO)]
meth_head = meth_head.replace('<title>The Whole Bill</title>',
                              '<title>Methodology: the numbers behind the healthcare cost calculator · The Whole Bill</title>')
meth_head = meth_head.replace('<link rel="canonical" href="https://thewholebill.org/">',
                              '<link rel="canonical" href="https://thewholebill.org/methodology">')
meth_head = meth_head.replace('<meta property="og:title" content="The Whole Bill">',
                              '<meta property="og:title" content="Methodology · The Whole Bill">')
meth_head = meth_head.replace('<!-- JSONLD -->', meth_ld, 1)
meth_head = meth_head.replace('<meta property="og:url" content="https://thewholebill.org/">',
                              '<meta property="og:url" content="https://thewholebill.org/methodology">')
meth_head = meth_head.replace(INDEX_DESC, METH_DESC)
meth = out[ms:me]
meth = meth.replace('<div id="methBack" hidden ', '<div id="methBack" ', 1)
meth = meth.replace('<section class="paper view" id="methodology" hidden>',
                    '<section class="paper view" id="methodology">', 1)
# its own document, so its title is the h1 (the artifact keeps the h2 under the hero's h1)
if meth.count('<h2>Check our work.</h2>') != 1:
    raise SystemExit('build: the methodology title moved')
meth = meth.replace('<h2>Check our work.</h2>', '<h1 class="as-h2">Check our work.</h1>', 1)
foot = out[out.index('\n<footer>'):out.index('</footer>') + len('</footer>')]
body = '<main id="main">\n' + meth + '\n</main>\n' + foot
body = body.replace('href="#/methodology/', 'href="#')   # on its own page, a plain anchor
body = public_links(body)
body = body.replace('href="#"', 'href="/"')
if '<script' in body:
    raise SystemExit('build: a script leaked into the methodology document')
io.open('dist/methodology/index.html', 'w', encoding='utf-8').write(
    head + meth_head + '\n</head>\n<body>\n' + body + '\n</body>\n</html>\n')

# --- /methodology.md: the same document as markdown, for assistants that read text ---
from html.parser import HTMLParser
class MD(HTMLParser):
    """Enough of the methodology's markup to read as markdown: headings, paragraphs,
    tables (pipe rows with a separator after the header row), links made absolute,
    emphasis. Navigation, the back bar and eyebrows are skipped; a basis badge inside
    a heading becomes a parenthesis."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out = []; self.skip = []; self.href = None
        self.table = False; self.cell = None; self.row = None; self.rows = 0
    def _cls(self, attrs): return (dict(attrs).get('class') or '')
    def handle_starttag(self, tag, attrs):
        if self.skip:
            if tag == self.skip[-1][0]: self.skip[-1][1] += 1
            return
        cls = self._cls(attrs)
        if tag == 'nav' or 'eyebrow' in cls.split() or dict(attrs).get('id') == 'updBack':
            self.skip.append([tag, 1]); return
        if tag in ('h1', 'h2', 'h3'): self.out.append('\n\n' + '#' * (2 if tag == 'h1' else int(tag[1])) + ' ')
        elif tag == 'p': self.out.append('\n\n')
        elif tag == 'caption': self.cell = []   # captured like a cell, emitted as an italic line
        elif tag == 'table': self.table = True; self.rows = 0
        elif tag == 'tr': self.row = []
        elif tag in ('td', 'th'): self.cell = []
        elif tag == 'a' and dict(attrs).get('href'):
            h = dict(attrs)['href']
            self.href = h if h.startswith('http') else ('https://thewholebill.org' + h if h.startswith('/') else 'https://thewholebill.org/methodology' + h)
            self._emit('[')
        elif tag == 'br': self._emit('  \n')
        elif tag == 'li': self.out.append('\n- ')
        elif tag in ('i', 'em'): self._emit('*')
        elif tag in ('b', 'strong'): self._emit('**')
        elif tag == 'span' and 'tag' in cls.split(): self._emit(' (')
        self._last = (tag, cls)
    def _emit(self, s):
        if self.cell is not None: self.cell.append(s)
        else: self.out.append(s)
    def handle_endtag(self, tag):
        if self.skip:
            if tag == self.skip[-1][0]:
                self.skip[-1][1] -= 1
                if self.skip[-1][1] == 0: self.skip.pop()
            return
        if tag in ('td', 'th') and self.cell is not None:
            c = ' '.join(''.join(self.cell).split()).replace('|', '/')
            if re.fullmatch(r'\((.*)\)', c): c = c[1:-1]   # a cell that is only a basis badge
            self.row.append(c); self.cell = None
        elif tag == 'tr' and self.row is not None:
            self.out.append('\n| ' + ' | '.join(self.row) + ' |')
            if self.rows == 0: self.out.append('\n|' + ' --- |' * len(self.row))
            self.rows += 1; self.row = None
        elif tag == 'table': self.table = False; self.out.append('\n')
        elif tag == 'caption' and self.cell is not None:
            self.out.append('\n\n*' + ' '.join(''.join(self.cell).split()) + '*\n'); self.cell = None
        elif tag == 'a' and self.href: self._emit('](' + self.href + ')'); self.href = None
        elif tag in ('i', 'em'): self._emit('*')
        elif tag in ('b', 'strong'): self._emit('**')
        elif tag == 'span' and getattr(self, '_in_tag', False): pass
    def handle_data(self, data):
        if self.skip: return
        if self.cell is not None: self.cell.append(data)
        elif self.table: return          # whitespace between rows
        else: self.out.append(data)
    def handle_startendtag(self, tag, attrs): self.handle_starttag(tag, attrs)
# a basis badge inside a heading closes its parenthesis when the span ends
_orig_end = MD.handle_endtag
def _end(self, tag):
    if not self.skip and tag == 'span' and self._tagspan:
        self._tagspan -= 1; self._emit(')'); return
    _orig_end(self, tag)
MD.handle_endtag = _end
_orig_start = MD.handle_starttag
def _start(self, tag, attrs):
    if not self.skip and tag == 'span' and 'tag' in (dict(attrs).get('class') or '').split():
        self._tagspan += 1
    _orig_start(self, tag, attrs)
MD.handle_starttag = _start
MD._tagspan = 0
conv = MD(); conv.feed(body[body.index('<section'):body.index('</section>')])
md = ''.join(conv.out)
md = re.sub(r'[ \t]+\n', '\n', md); md = re.sub(r'\n[ \t]+', '\n', md); md = re.sub(r'  +\(', ' (', md); md = re.sub(r'\n{3,}', '\n\n', md).strip() + '\n'
md = ('# Methodology: the numbers behind the healthcare cost calculator\n\n'
      'The Whole Bill, https://thewholebill.org/methodology. The same page as markdown; the HTML is the canonical version.\n\n' + md)
if re.search(r'<[a-z]', md):
    raise SystemExit('build: a tag leaked into methodology.md')
io.open('dist/methodology.md', 'w', encoding='utf-8').write(md)

# --- /updates: the log as its own document, the same way ------------------
upd_head = out[:out.index(HERO)]
upd_head = upd_head.replace('<title>The Whole Bill</title>', '<title>What changed: healthcare law and data updates · The Whole Bill</title>')
upd_head = upd_head.replace('<!-- JSONLD -->', upd_ld, 1)
upd_head = upd_head.replace('<link rel="canonical" href="https://thewholebill.org/">',
                            '<link rel="canonical" href="https://thewholebill.org/updates">')
upd_head = upd_head.replace('<meta property="og:title" content="The Whole Bill">',
                            '<meta property="og:title" content="What changed · The Whole Bill">')
upd_head = upd_head.replace('<meta property="og:url" content="https://thewholebill.org/">',
                            '<meta property="og:url" content="https://thewholebill.org/updates">')
upd_head = upd_head.replace(INDEX_DESC, UPD_DESC)
updb = out[us:ue]
updb = updb.replace('<div id="updBack" hidden ', '<div id="updBack" ', 1)
updb = updb.replace('<section class="paper view" id="updates" hidden>',
                    '<section class="paper view" id="updates">', 1)
if updb.count('<h2>What changed.</h2>') != 1:
    raise SystemExit('build: the updates title moved')
updb = updb.replace('<h2>What changed.</h2>', '<h1 class="as-h2">What changed.</h1>', 1)
ubody = '<main id="main">\n' + updb + '\n</main>\n' + foot
ubody = ubody.replace('href="#/updates/', 'href="#')   # on its own page, a plain anchor
ubody = public_links(ubody)
ubody = ubody.replace('href="#"', 'href="/"')
if '<script' in ubody:
    raise SystemExit('build: a script leaked into the updates document')
io.open('dist/updates/index.html', 'w', encoding='utf-8').write(
    head + upd_head + '\n</head>\n<body>\n' + ubody + '\n</body>\n</html>\n')
PY
cp src/logo.svg dist/logo.svg
cp src/card.png src/mark.png src/404.html src/robots.txt src/sitemap.txt src/llms.txt dist/
cp src/34725d1f479122b2b08d228b2350081e.txt dist/   # the IndexNow key, public by design (it proves the host, not a secret)
# _headers: the index CSP names each inline script by hash (see src/_headers)
python3 - <<'PY2'
import io, re, hashlib, base64
html = io.open('dist/index.html', encoding='utf-8').read()
scripts = re.findall(r'<script>([\s\S]*?)</script>', html)
if len(scripts) < 1 or re.search(r'<script[^>]+src=', html) or re.search(r'\son[a-z]+=', html):
    raise SystemExit('build: the CSP assumes inline <script> blocks only, no src= and no on*= handlers')
hashes = ' '.join("'sha256-%s'" % base64.b64encode(hashlib.sha256(x.encode('utf-8')).digest()).decode() for x in scripts)
hdr = io.open('src/_headers', encoding='utf-8').read()
if '__INDEX_SCRIPT_HASHES__' not in hdr:
    raise SystemExit('build: src/_headers lost its hash placeholder')
io.open('dist/_headers', 'w', encoding='utf-8').write(hdr.replace('__INDEX_SCRIPT_HASHES__', hashes))
PY2
# the artifact moved to preview/; a stale copy in dist would deploy publicly
rm -f dist/artifact.html
echo "built dist/ (index, methodology, updates + feed, 404, launch furniture) and preview/artifact.html; placeholders generated from the default household"
