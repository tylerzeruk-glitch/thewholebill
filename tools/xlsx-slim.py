#!/usr/bin/env python3
# Extract a slim CSV from the QHP landscape xlsx using only the stdlib.
# Emits: state,fips,county,ratingArea,metal,planId,prem21
import zipfile, xml.etree.ElementTree as ET, sys, csv, re

SRC = sys.argv[1]
OUT = sys.argv[2]
NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'

z = zipfile.ZipFile(SRC)
# shared strings
shared = []
with z.open('xl/sharedStrings.xml') as f:
    for ev, el in ET.iterparse(f):
        if el.tag == NS + 'si':
            shared.append(''.join(t.text or '' for t in el.iter(NS + 't')))
            el.clear()

# find the data sheet: workbook.xml lists sheets in order; take the one named Individual_Market_Medical
wb = ET.fromstring(z.read('xl/workbook.xml'))
rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
RNS = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
relmap = {r.get('Id'): r.get('Target') for r in rels}
target = None
for sh in wb.iter(NS + 'sheet'):
    if sh.get('name') == 'Individual_Market_Medical':
        target = relmap[sh.get(RNS + 'id')]
if target is None:
    sys.exit('sheet not found')
if not target.startswith('xl/'): target = 'xl/' + target

def colidx(ref):
    s = 0
    for ch in ref:
        if ch.isalpha(): s = s * 26 + (ord(ch.upper()) - 64)
        else: break
    return s - 1

want = ['State Code', 'FIPS County Code', 'County Name', 'Metal Level',
        'Plan ID (Standard Component)', 'Rating Area', 'Premium Adult Individual Age 21']
wanted = {}   # colidx -> output position
header_row = None
n = 0
with z.open(target) as f, open(OUT, 'w', newline='') as out:
    w = csv.writer(out)
    w.writerow(['state', 'fips', 'county', 'ratingArea', 'metal', 'planId', 'prem21'])
    rownum = 0
    for ev, el in ET.iterparse(f):
        if el.tag != NS + 'row': continue
        rownum += 1
        cells = {}
        for c in el.iter(NS + 'c'):
            ref = c.get('r') or ''
            v = c.find(NS + 'v')
            if v is None:
                t = c.find(NS + 'is')
                val = ''.join(x.text or '' for x in t.iter(NS + 't')) if t is not None else ''
            else:
                val = v.text or ''
                if c.get('t') == 's': val = shared[int(val)]
            cells[colidx(ref)] = val
        el.clear()
        if header_row is None:
            # row 1 is a junk filter row; the real header is the row containing 'State Code'
            vals = {k: (v or '').strip() for k, v in cells.items()}
            if 'State Code' in vals.values():
                for k, v in vals.items():
                    if v in want: wanted[k] = want.index(v)
                header_row = rownum
                if len(wanted) != len(want):
                    sys.exit('missing headers: ' + str([c for c in want if want.index(c) not in wanted.values()]))
            continue
        row = [''] * len(want)
        for k, pos in wanted.items():
            row[pos] = (cells.get(k) or '').strip()
        if not row[0]: continue
        w.writerow(row)
        n += 1
print('rows:', n, 'header at', header_row)
