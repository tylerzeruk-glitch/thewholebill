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
               '<!-- UPDATES:BOX -->', '<!-- UPDATES:LIST -->',
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
io.open('preview/artifact.html', 'w', encoding='utf-8').write(out)

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
i = web.index(HERO)
io.open('dist/index.html', 'w', encoding='utf-8').write(
    head + web[:i] + '\n</head>\n<body>\n' + web[i:] + '\n</body>\n</html>\n')

# --- /methodology: the block unhidden, plus the footer, no scripts ----------
meth_head = out[:out.index(HERO)]
meth_head = meth_head.replace('<title>The Whole Bill</title>',
                              '<title>Methodology · The Whole Bill</title>')
meth_head = meth_head.replace('<link rel="canonical" href="https://thewholebill.org/">',
                              '<link rel="canonical" href="https://thewholebill.org/methodology">')
meth_head = meth_head.replace('<meta property="og:title" content="The Whole Bill">',
                              '<meta property="og:title" content="Methodology · The Whole Bill">')
meth_head = meth_head.replace('<meta property="og:url" content="https://thewholebill.org/">',
                              '<meta property="og:url" content="https://thewholebill.org/methodology">')
meth_head = meth_head.replace(
    "What your household's healthcare actually costs, including the employer share that never touches a paystub, and what universal coverage would cost instead.",
    "Every number on The Whole Bill, traced to its source: the tables, the arithmetic, and what we know is wrong.")
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

# --- /updates: the log as its own document, the same way ------------------
upd_head = out[:out.index(HERO)]
upd_head = upd_head.replace('<title>The Whole Bill</title>', '<title>What changed · The Whole Bill</title>')
upd_head = upd_head.replace('<link rel="canonical" href="https://thewholebill.org/">',
                            '<link rel="canonical" href="https://thewholebill.org/updates">')
upd_head = upd_head.replace('<meta property="og:title" content="The Whole Bill">',
                            '<meta property="og:title" content="What changed · The Whole Bill">')
upd_head = upd_head.replace('<meta property="og:url" content="https://thewholebill.org/">',
                            '<meta property="og:url" content="https://thewholebill.org/updates">')
upd_head = upd_head.replace(
    "What your household's healthcare actually costs, including the employer share that never touches a paystub, and what universal coverage would cost instead.",
    'A dated log of what moved: the law and the data The Whole Bill rests on, and the site itself.')
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
cp src/card.png src/404.html src/robots.txt src/sitemap.txt dist/
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
