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
#   dist/logo.svg                 the mark the Access login page loads via its
#                                 one-path bypass (see docs/DEPLOY.md)
#   dist/card.png, 404.html, robots.txt, sitemap.txt, _headers
#                                 launch furniture, copied verbatim from src/
# The source template is never modified.
set -e
cd "$(dirname "$0")"
mkdir -p dist dist/methodology preview
python3 - <<'PY'
import io, json, re, subprocess
calc = io.open('src/calc.js', encoding='utf-8').read()
reps = io.open('src/reps.js', encoding='utf-8').read()
bench = io.open('src/benchmarks.js', encoding='utf-8').read()
page = io.open('src/page.html', encoding='utf-8').read()
for marker in ('/*__CALC__*/', '/*__REPS__*/', '/*__BENCH__*/',
               '<!-- METH:START', '<!-- METH:END -->',
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
web = out[:ms] + out[me:]
web = web.replace('href="#/methodology"', 'href="/methodology"')
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
body = body.replace('href="#/methodology"', 'href="/methodology"')
body = body.replace('href="#"', 'href="/"')
if '<script' in body:
    raise SystemExit('build: a script leaked into the methodology document')
io.open('dist/methodology/index.html', 'w', encoding='utf-8').write(
    head + meth_head + '\n</head>\n<body>\n' + body + '\n</body>\n</html>\n')
PY
cp src/logo.svg dist/logo.svg
cp src/card.png src/404.html src/robots.txt src/sitemap.txt src/_headers dist/
# the artifact moved to preview/; a stale copy in dist would deploy publicly
rm -f dist/artifact.html
echo "built dist/ (index, methodology, 404, launch furniture) and preview/artifact.html; placeholders generated from the default household"
