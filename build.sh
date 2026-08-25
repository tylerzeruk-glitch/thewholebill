#!/bin/sh
# src/page.html + src/calc.js  ->  dist/
#   dist/artifact.html   page content only (the Artifact host supplies the skeleton)
#   dist/index.html      full standalone document (deploy / open locally / tests)
# The source template is never modified.
set -e
cd "$(dirname "$0")"
mkdir -p dist
python3 - <<'PY'
import io
calc = io.open('src/calc.js', encoding='utf-8').read()
page = io.open('src/page.html', encoding='utf-8').read()
if '/*__CALC__*/' not in page:
    raise SystemExit('build: /*__CALC__*/ marker missing from src/page.html')
out = page.replace('/*__CALC__*/', '\n' + calc + '\n', 1)
io.open('dist/artifact.html', 'w', encoding='utf-8').write(out)

i = out.index('\n<!-- ============ 01 HERO')
head = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n')
io.open('dist/index.html', 'w', encoding='utf-8').write(
    head + out[:i] + '\n</head>\n<body>\n' + out[i:] + '\n</body>\n</html>\n')
PY
echo "built dist/index.html and dist/artifact.html"
