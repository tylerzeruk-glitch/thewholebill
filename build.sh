#!/bin/sh
# src/page.html + src/calc.js + src/benchmarks.js + src/reps.js  ->  dist/
#   dist/artifact.html            page content only, hash-routed methodology
#                                 (the Artifact host serves ONE document and
#                                 supplies the skeleton)
#   dist/index.html               the calculator, standalone; methodology
#                                 stripped, links point at /methodology, and
#                                 old #/methodology links redirect there
#   dist/methodology/index.html   the methodology as its own document: the
#                                 METH block unhidden plus the footer, no
#                                 scripts (the page is fully static)
#   dist/logo.svg                 the mark the Access login page loads via its
#                                 one-path bypass (see docs/DEPLOY.md)
# The source template is never modified.
set -e
cd "$(dirname "$0")"
mkdir -p dist dist/methodology
python3 - <<'PY'
import io
calc = io.open('src/calc.js', encoding='utf-8').read()
reps = io.open('src/reps.js', encoding='utf-8').read()
bench = io.open('src/benchmarks.js', encoding='utf-8').read()
page = io.open('src/page.html', encoding='utf-8').read()
for marker in ('/*__CALC__*/', '/*__REPS__*/', '/*__BENCH__*/',
               '<!-- METH:START', '<!-- METH:END -->',
               '<title>The Whole Bill</title>'):
    if marker not in page:
        raise SystemExit('build: ' + marker + ' marker missing from src/page.html')
out = page.replace('/*__BENCH__*/', '\n' + bench + '\n', 1)
out = out.replace('/*__CALC__*/', '\n' + calc + '\n', 1)
out = out.replace('/*__REPS__*/', '\n' + reps + '\n', 1)

# --- artifact: the whole document, hash-routed, unchanged shape -------------
io.open('dist/artifact.html', 'w', encoding='utf-8').write(out)

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
meth = out[ms:me]
meth = meth.replace('<div id="methBack" hidden ', '<div id="methBack" ', 1)
meth = meth.replace('<section class="paper view" id="methodology" hidden>',
                    '<section class="paper view" id="methodology">', 1)
foot = out[out.index('\n<footer>'):out.index('</footer>') + len('</footer>')]
body = meth + '\n' + foot
body = body.replace('href="#/methodology"', 'href="/methodology"')
body = body.replace('href="#"', 'href="/"')
if '<script' in body:
    raise SystemExit('build: a script leaked into the methodology document')
io.open('dist/methodology/index.html', 'w', encoding='utf-8').write(
    head + meth_head + '\n</head>\n<body>\n' + body + '\n</body>\n</html>\n')
PY
cp src/logo.svg dist/logo.svg
echo "built dist/index.html, dist/methodology/index.html, dist/artifact.html and dist/logo.svg"
