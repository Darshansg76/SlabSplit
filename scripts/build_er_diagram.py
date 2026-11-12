# -*- coding: utf-8 -*-
"""SlabSplit ER diagram (crow's-foot notation), parsed from database/schema.sql so the
entities and relationships always match the DDL.

    python scripts/build_er_diagram.py database/schema.sql docs/diagrams/slabsplit_er.svg
"""
import re, html, sys

SCHEMA, OUT = sys.argv[1], sys.argv[2]
src = re.sub(r'--[^\n]*', '', open(SCHEMA, encoding='utf-8').read())

def split_top(body):
    out, depth, cur = [], 0, ''
    for ch in body:
        if ch == '(': depth += 1
        if ch == ')': depth -= 1
        if ch == ',' and depth == 0: out.append(cur.strip()); cur = ''
        else: cur += ch
    if cur.strip(): out.append(cur.strip())
    return out

TABLES, FKS = [], []          # FKS: (parent, child, column, not_null, unique)
for name, body in re.findall(r'CREATE TABLE (\w+)\s*\((.*?)\n\);', src, re.S):
    TABLES.append(name)
    for item in split_top(body):
        item = ' '.join(item.split())
        ref = re.search(r'\bREFERENCES\s+(\w+)', item, re.I)
        if ref and item.split()[0].upper() not in ('CONSTRAINT', 'FOREIGN'):
            FKS.append((ref.group(1), name, item.split()[0],
                        bool(re.search(r'\bNOT NULL\b', item, re.I)),
                        bool(re.search(r'\bUNIQUE\b', item, re.I))))

VERB = {
    ('household', 'occupancy'): 'contains', ('occupant', 'occupancy'): 'stays',
    ('household', 'bill_cycle'): 'has', ('household', 'slab_rate'): 'sets',
    ('household', 'expense'): 'incurs', ('bill_cycle', 'bill'): 'contains',
    ('bill_cycle', 'expense'): 'groups', ('bill_cycle', 'settlement'): 'settles',
    ('bill', 'bill_slab_breakdown'): 'split into', ('slab_rate', 'bill_slab_breakdown'): 'prices',
    ('bill', 'bill_share'): 'allocates', ('occupant', 'bill_share'): 'owes',
    ('expense', 'expense_share'): 'allocates', ('occupant', 'expense_share'): 'owes',
    ('occupant', 'expense'): 'fronts', ('bill', 'payment'): 'pays',
    ('expense', 'payment'): 'reimburses', ('occupant', 'payment'): 'makes',
    ('role', 'app_user'): 'grants', ('occupant', 'app_user'): 'logs in as',
    ('bill', 'receipt'): 'proves', ('expense', 'receipt'): 'proves',
    ('app_user', 'receipt'): 'uploads', ('app_user', 'audit_log'): 'acts',
}
def verb(p, c, col):
    if (p, c) == ('occupant', 'settlement'):
        return 'payer' if col.startswith('payer') else 'payee'
    return VERB.get((p, c), '')

# ---- lanes: every relationship runs from a parent (left) to a child (right) ----
lane = {t: 0 for t in TABLES}
for _ in range(20):
    moved = False
    for p, c, *_ in FKS:
        if p != c and lane[c] <= lane[p]: lane[c] = lane[p] + 1; moved = True
    if not moved: break
ORDER = {}
for t in TABLES: ORDER.setdefault(lane[t], []).append(t)

BW, PITCH, X0, TOP, VGAP, PORT = 300, 660, 100, 200, 56, 30
n_in = {t: sum(1 for f in FKS if f[1] == t) for t in TABLES}
n_out = {t: sum(1 for f in FKS if f[0] == t) for t in TABLES}
def bh(t): return max(70, 40 + max(n_in[t], n_out[t]) * PORT)

lane_h = {l: sum(bh(t) for t in ts) + VGAP * (len(ts) - 1) for l, ts in ORDER.items()}
Hc = max(lane_h.values())
POS = {}
for l, ts in ORDER.items():
    y = TOP + (Hc - lane_h[l]) / 2
    for t in ts: POS[t] = (X0 + l * PITCH, y); y += bh(t) + VGAP
def cy_of(t): return POS[t][1] + bh(t) / 2

# ---- ports, ordered to keep lines from crossing near the boxes ----
out_port, in_port = {}, {}
for t in TABLES:
    outs = sorted([f for f in FKS if f[0] == t], key=lambda f: (cy_of(f[1]), f[2]))
    ins = sorted([f for f in FKS if f[1] == t], key=lambda f: (cy_of(f[0]), f[2]))
    for k, f in enumerate(outs): out_port[f] = POS[t][1] + bh(t) * (k + 1) / (len(outs) + 1)
    for k, f in enumerate(ins): in_port[f] = POS[t][1] + bh(t) * (k + 1) / (len(ins) + 1)

# ---- channel slots in each gap (left part of the gap; labels use the right part) ----
slot_n = {}
def slot(gap):
    k = slot_n.get(gap, 0); slot_n[gap] = k + 1
    return X0 + gap * PITCH + BW + 28 + k * 13

NAVY, INK, LINE, FILL, MUTED = '#1e3a5f', '#111827', '#374151', '#eef2f7', '#4b5563'
s, labels = [], []
def ln(x1, y1, x2, y2, w=2.0):
    s.append(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="{LINE}" stroke-width="{w}" stroke-linecap="round"/>')
def poly(pts):
    s.append('<polyline points="' + ' '.join(f'{x:.1f},{y:.1f}' for x, y in pts) +
             f'" fill="none" stroke="{LINE}" stroke-width="2" stroke-linejoin="round"/>')
def circle(x, y): s.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="6" fill="#ffffff" stroke="{LINE}" stroke-width="2"/>')

def parent_end(x, y, mandatory):
    """Line leaves the parent to the right. Max one (bar), min one (bar) or zero (circle)."""
    ln(x + 9, y - 10, x + 9, y + 10, 2.2)
    if mandatory: ln(x + 17, y - 10, x + 17, y + 10, 2.2)
    else: circle(x + 24, y)

def child_end(x, y, unique):
    """Line enters the child from the left. Crow's foot = many: prongs touch the entity."""
    if unique:
        ln(x - 9, y - 10, x - 9, y + 10, 2.2); circle(x - 22, y)
    else:
        ln(x - 20, y, x, y - 11); ln(x - 20, y, x, y); ln(x - 20, y, x, y + 11)
        circle(x - 30, y)

hw_k = 0
long_edges = [f for f in FKS if lane[f[1]] - lane[f[0]] > 1]
HW_TOP = TOP + Hc + 50
for f in sorted(FKS, key=lambda f: (lane[f[0]], out_port[f])):
    p, c, col, not_null, unique = f
    px, py = POS[p][0] + BW, out_port[f]
    cx, cyy = POS[c][0], in_port[f]
    gap_out, gap_in = lane[p], lane[c] - 1
    if lane[c] - lane[p] == 1:
        mx = slot(gap_out)
        poly([(px + 2, py), (mx, py), (mx, cyy), (cx - 2, cyy)])
    else:
        xb, xc = slot(gap_out), slot(gap_in)
        yh = HW_TOP + hw_k * 22; hw_k += 1
        poly([(px + 2, py), (xb, py), (xb, yh), (xc, yh), (xc, cyy), (cx - 2, cyy)])
    parent_end(px, py, not_null)
    child_end(cx, cyy, unique)
    labels.append(f'<text x="{cx - 40:.1f}" y="{cyy - 8:.1f}" class="rel" text-anchor="end">{html.escape(verb(p, c, col))}</text>')

for t in TABLES:
    x, y = POS[t]; h = bh(t)
    s.append(f'<rect x="{x}" y="{y:.1f}" width="{BW}" height="{h}" rx="10" fill="{FILL}" stroke="{NAVY}" stroke-width="2.6"/>')
    if t == 'doc_embedding':
        s.append(f'<text x="{x + BW / 2}" y="{y + h / 2 - 4:.1f}" class="ent" text-anchor="middle">{t}</text>')
        s.append(f'<text x="{x + BW / 2}" y="{y + h / 2 + 20:.1f}" class="note" text-anchor="middle">polymorphic link, no FK</text>')
    else:
        s.append(f'<text x="{x + BW / 2}" y="{y + h / 2 + 8:.1f}" class="ent" text-anchor="middle">{t}</text>')

W = X0 + max(ORDER) * PITCH + BW + 110
H = HW_TOP + hw_k * 22 + 70
style = ('<style>'
         f'.ent{{font-size:23px;font-weight:700;fill:{NAVY}}}'
         f'.rel{{font-size:16px;fill:{MUTED};font-style:italic}}'
         f'.note{{font-size:15px;fill:{MUTED};font-style:italic}}'
         f'.head{{font-size:46px;font-weight:700;fill:{INK}}}.sub{{font-size:22px;fill:{MUTED}}}'
         '</style>')
svg = (f'<svg viewBox="0 0 {W:.0f} {H:.0f}" xmlns="http://www.w3.org/2000/svg" '
       f'font-family="Segoe UI, Calibri, Arial, sans-serif">{style}'
       f'<rect width="{W:.0f}" height="{H:.0f}" fill="#ffffff"/>'
       f'<text x="{X0}" y="76" class="head">SlabSplit &#8212; ER Diagram</text>'
       f'<text x="{X0 + 2}" y="116" class="sub">{len(TABLES)} entities &#183; {len(FKS)} relationships &#183; '
       'crow&#8217;s foot = many &#183; bar = one &#183; circle = optional</text>'
       + ''.join(s) + ''.join(labels) + '</svg>')
open(OUT, 'w', encoding='utf-8').write(svg)
print(f'entities={len(TABLES)} relationships={len(FKS)} long_routes={len(long_edges)} canvas={W:.0f}x{H:.0f}')
