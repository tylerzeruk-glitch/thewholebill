#!/usr/bin/env python3
# Print one sheet of an .xlsx/.xlsm as JSON rows, standard library only.
#   xlsx-rows.py <file> <sheet name or 0-based index>
#   xlsx-rows.py <file> --list          sheet names
# Cells come back as numbers or strings; empty cells as null, so column
# positions are kept.
import zipfile, xml.etree.ElementTree as ET, sys, json, re

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
RNS = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
z = zipfile.ZipFile(sys.argv[1])

wb = ET.fromstring(z.read('xl/workbook.xml'))
sheets = [(s.get('name'), s.get(RNS + 'id')) for s in wb.iter(NS + 'sheet')]
if sys.argv[2] == '--list':
    print(json.dumps([n for n, _ in sheets])); sys.exit(0)

rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
target = {r.get('Id'): r.get('Target') for r in rels}
want = sys.argv[2]
pick = sheets[int(want)] if want.isdigit() else next(s for s in sheets if s[0] == want)
path = target[pick[1]].lstrip('/')
if not path.startswith('xl/'): path = 'xl/' + path

shared = []
if 'xl/sharedStrings.xml' in z.namelist():
    with z.open('xl/sharedStrings.xml') as f:
        for ev, el in ET.iterparse(f):
            if el.tag == NS + 'si':
                shared.append(''.join(t.text or '' for t in el.iter(NS + 't'))); el.clear()

def colnum(ref):
    n = 0
    for ch in re.match(r'[A-Z]+', ref).group(0): n = n * 26 + ord(ch) - 64
    return n - 1

rows = []
with z.open(path) as f:
    for ev, el in ET.iterparse(f):
        if el.tag != NS + 'row': continue
        r = int(el.get('r')) - 1
        while len(rows) < r: rows.append([])
        cells = []
        for c in el.iter(NS + 'c'):
            i = colnum(c.get('r')); t = c.get('t'); v = c.find(NS + 'v')
            if t == 'inlineStr':
                val = ''.join(x.text or '' for x in c.iter(NS + 't'))
            elif v is None: val = None
            elif t == 's': val = shared[int(v.text)]
            elif t in ('str', 'e'): val = v.text
            elif t == 'b': val = v.text == '1'
            else:
                try:
                    val = float(v.text); val = int(val) if val.is_integer() else val
                except ValueError: val = v.text
            while len(cells) < i: cells.append(None)
            cells.append(val)
        rows.append(cells); el.clear()
print(json.dumps(rows))
