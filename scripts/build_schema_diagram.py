# -*- coding: utf-8 -*-
"""SlabSplit relational schema diagram, parsed directly from database/schema.sql
so the picture can never drift from the DDL. Crow's-foot, keys only, no types."""
import re, html, sys, os

SCHEMA = sys.argv[1]
OUT    = sys.argv[2]

src = open(SCHEMA, encoding='utf-8').read()
src = re.sub(r'--[^\n]*', '', src)          # strip comments

def split_top(body):
    out, depth, cur = [], 0, ''
    for ch in body:
        if ch == '(': depth += 1
        if ch == ')': depth -= 1
        if ch == ',' and depth == 0:
            out.append(cur.strip()); cur = ''
        else: cur += ch
    if cur.strip(): out.append(cur.strip())
    return out

TABLES, FKS = {}, []
for name, body in re.findall(r'CREATE TABLE (\w+)\s*\((.*?)\n\);', src, re.S):
    cols, pk = [], set()
    for item in split_top(body):
        item = ' '.join(item.split())
        if not item: continue
        head = item.split()[0].upper()
        if head in ('CONSTRAINT', 'PRIMARY', 'UNIQUE', 'CHECK', 'FOREIGN'):
            m = re.match(r'(?:CONSTRAINT \w+ )?PRIMARY KEY\s*\(([^)]*)\)', item, re.I)
            if m: pk.update(c.strip() for c in m.group(1).split(','))
            continue
        col = item.split()[0]
        flags = set()
        if re.search(r'\bPRIMARY KEY\b', item, re.I): flags.add('P'); pk.add(col)
        if re.search(r'\bUNIQUE\b', item, re.I):      flags.add('U')
        ref = re.search(r'\bREFERENCES\s+(\w+)', item, re.I)
        if ref:
            flags.add('F'); FKS.append((name, col, ref.group(1),
                                        '01' if not re.search(r'\bNOT NULL\b', item, re.I) else '1'))
        cols.append([col, flags])
    for c in cols:
        if c[0] in pk: c[1].add('P')
    TABLES[name] = cols

# ---- layer tables so every FK points right-to-left ----
lane, changed = {t: 0 for t in TABLES}, True
for _ in range(20):
    changed = False
    for child, _c, parent, _o in FKS:
        if child != parent and lane[child] <= lane[parent]:
            lane[child] = lane[parent] + 1; changed = True
    if not changed: break
ORDER = {}
for t in TABLES: ORDER.setdefault(lane[t], []).append(t)
# balance: push dependency-free tables into the shortest lane
free = [t for t in ORDER.get(0, []) if not any(c == t for c, _, _, _ in FKS)]

BG='#ffffff'; BOX='#ffffff'; HDR='#1e3a5f'; HDRT='#ffffff'
LINE='#111827'; TXT='#111827'; MUT='#6b7280'; PKC='#b45309'; FKC='#1d4ed8'
EDGE='#374151'; ALT='#f3f6fa'
TW=430; ROW_H=36; HDR_H=52; LANE_PITCH=600; X0=110; GAP_V=70; TOP=190

def th(t): return HDR_H + len(TABLES[t])*ROW_H
POS={}
lane_h={l: sum(th(t) for t in ts)+GAP_V*(len(ts)-1) for l,ts in ORDER.items()}
Hc=max(lane_h.values())
for l,ts in sorted(ORDER.items()):
    y = TOP + (Hc-lane_h[l])/2
    for t in ts:
        POS[t]=(X0+l*LANE_PITCH, y); y += th(t)+GAP_V
W = X0 + max(ORDER)*LANE_PITCH + TW + 130
HW_TOP = TOP + Hc + 55

def esc(s): return html.escape(str(s))
def row_y(t,col):
    return POS[t][1] + HDR_H + [c for c,_ in TABLES[t]].index(col)*ROW_H + ROW_H/2

s=[]
def line(x1,y1,x2,y2,w=2.0):
    s.append(f'<line x1="{x1:.0f}" y1="{y1:.0f}" x2="{x2:.0f}" y2="{y2:.0f}" stroke="{EDGE}" stroke-width="{w}" stroke-linecap="round"/>')
def poly(pts):
    d=' '.join(f'{x:.0f},{y:.0f}' for x,y in pts)
    s.append(f'<polyline points="{d}" fill="none" stroke="{EDGE}" stroke-width="2" stroke-linejoin="round"/>')
def crowsfoot(x,y):
    L,sp=20,11
    line(x,y,x-L,y-sp); line(x,y,x-L,y); line(x,y,x-L,y+sp)
def onebar(x,y,zero=False):
    line(x+12,y-11,x+12,y+11,2.2)
    if zero: s.append(f'<circle cx="{x+26:.0f}" cy="{y:.0f}" r="7" fill="{BG}" stroke="{EDGE}" stroke-width="2"/>')

short_slot={}; hw_i=0
for ch,col,par,one in FKS:
    cl,pl = lane[ch], lane[par]
    cy = row_y(ch,col); py = row_y(par, TABLES[par][0][0])
    cx = POS[ch][0]; px = POS[par][0]+TW
    if cl-pl==1:
        k=short_slot.get((cl,pl),0); short_slot[(cl,pl)]=k+1
        mid = px + (cx-px)/2 + (k%5-2)*26
        poly([(cx-20,cy),(mid,cy),(mid,py),(px+26,py)])
    else:
        yh = HW_TOP + hw_i*48; hw_i+=1
        xa = cx - 46 - (hw_i%3)*18; xb = px + 60 + (hw_i%3)*18
        poly([(cx-20,cy),(xa,cy),(xa,yh),(xb,yh),(xb,py),(px+26,py)])
    crowsfoot(cx,cy); onebar(px,py,zero=(one=='01'))

for name,cols in TABLES.items():
    x,y=POS[name]; h=th(name)
    s.append(f'<rect x="{x}" y="{y}" width="{TW}" height="{h}" rx="8" fill="{BOX}" stroke="{LINE}" stroke-width="2.6"/>')
    s.append(f'<path d="M{x},{y+18} a18,18 0 0 1 18,-18 h{TW-36} a18,18 0 0 1 18,18 v{HDR_H-18} h-{TW} z" fill="{HDR}"/>')
    s.append(f'<text x="{x+TW/2}" y="{y+35}" class="tt" text-anchor="middle">{esc(name)}</text>')
    for i,(c,fl) in enumerate(cols):
        ry=y+HDR_H+i*ROW_H
        if i%2: s.append(f'<rect x="{x+2}" y="{ry}" width="{TW-4}" height="{ROW_H}" fill="{ALT}"/>')
        s.append(f'<line x1="{x}" y1="{ry}" x2="{x+TW}" y2="{ry}" stroke="#d1d5db" stroke-width="1"/>')
        badge = 'PK' if 'P' in fl else ('FK' if 'F' in fl else '')
        if badge:
            s.append(f'<text x="{x+14}" y="{ry+24}" class="bdg" fill="{PKC if badge=="PK" else FKC}">{badge}</text>')
        s.append(f'<text x="{x+62}" y="{ry+24}" class="{"colpk" if "P" in fl else "col"}">{esc(c)}</text>')
        if 'P' in fl:
            s.append(f'<line x1="{x+62}" y1="{ry+29}" x2="{x+62+len(c)*11.6:.0f}" y2="{ry+29}" stroke="{TXT}" stroke-width="1.8"/>')
        if 'U' in fl and 'P' not in fl:
            s.append(f'<text x="{x+TW-16}" y="{ry+24}" class="uk" text-anchor="end">UK</text>')

H = HW_TOP + hw_i*48 + 90
style=('<style>'
 f'.tt{{font-size:27px;font-weight:700;fill:{HDRT};letter-spacing:.4px}}'
 f'.col{{font-size:23px;fill:{TXT}}}.colpk{{font-size:23px;font-weight:700;fill:{TXT}}}'
 f'.bdg{{font-size:17px;font-weight:700}}.uk{{font-size:17px;font-weight:700;fill:{MUT}}}'
 f'.head{{font-size:50px;font-weight:700;fill:{TXT}}}.sub{{font-size:25px;fill:{MUT}}}'
 '</style>')
svg=(f'<svg viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg" '
 f'font-family="Segoe UI, Calibri, Arial, sans-serif">{style}'
 f'<rect width="{W}" height="{H}" fill="{BG}"/>'
 f'<text x="{X0}" y="76" class="head">SlabSplit &#8212; Relational Schema</text>'
 f'<text x="{X0+2}" y="120" class="sub">{len(TABLES)} tables &#183; {len(FKS)} foreign keys &#183; '
 f'PK = primary key (underlined) &#183; FK = foreign key &#183; UK = unique key</text>'
 + ''.join(s) + '</svg>')
open(OUT,'w',encoding='utf-8').write(svg)
print(f'tables={len(TABLES)} fks={len(FKS)} lanes={ {l:len(v) for l,v in sorted(ORDER.items())} } canvas={W}x{H}')
for l,ts in sorted(ORDER.items()): print(' lane',l,':',', '.join(ts))
