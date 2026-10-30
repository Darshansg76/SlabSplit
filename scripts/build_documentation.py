"""Build the student-facing SlabSplit implementation guide."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "SlabSplit Implementation Documentation.docx"
TMP = ROOT / "tmp" / "docx"
TMP.mkdir(parents=True, exist_ok=True)

NAVY = RGBColor(23, 47, 65)
TEAL = RGBColor(15, 110, 103)
GRAY = RGBColor(90, 105, 116)
LIGHT = "EAF2F3"


def shade(cell, fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:fill"), fill)
    tc_pr.append(shd)


def keep_row(row):
    tr_pr = row._tr.get_or_add_trPr()
    item = OxmlElement("w:cantSplit")
    tr_pr.append(item)


def set_cell_text(cell, value, bold=False, color=None):
    cell.text = ""
    p = cell.paragraphs[0]
    p.paragraph_format.space_after = Pt(0)
    run = p.add_run(str(value))
    run.bold = bold
    run.font.size = Pt(9)
    if color:
        run.font.color.rgb = color
    cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER


def add_table(doc, headers, rows, widths=None):
    table = doc.add_table(rows=1, cols=len(headers))
    table.style = "Table Grid"
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    if widths:
        for i, width in enumerate(widths):
            table.columns[i].width = Inches(width)
    for i, heading in enumerate(headers):
        set_cell_text(table.rows[0].cells[i], heading, True, RGBColor(255, 255, 255))
        shade(table.rows[0].cells[i], "173E50")
    header_prop = OxmlElement("w:tblHeader")
    header_prop.set(qn("w:val"), "true")
    table.rows[0]._tr.get_or_add_trPr().append(header_prop)
    for values in rows:
        row = table.add_row()
        keep_row(row)
        for i, value in enumerate(values):
            set_cell_text(row.cells[i], value)
    doc.add_paragraph().paragraph_format.space_after = Pt(0)
    return table


def add_heading(doc, title, level=1):
    p = doc.add_paragraph(title, style=f"Heading {level}")
    p.paragraph_format.keep_with_next = True
    return p


def add_body(doc, text):
    p = doc.add_paragraph(text)
    p.paragraph_format.space_after = Pt(7)
    p.paragraph_format.keep_together = True
    return p


def add_bullet(doc, text):
    p = doc.add_paragraph(text, style="List Bullet")
    p.paragraph_format.space_after = Pt(3)
    return p


def add_number(doc, text):
    p = doc.add_paragraph(text, style="List Number")
    p.paragraph_format.space_after = Pt(3)
    return p


def add_code(doc, text):
    p = doc.add_paragraph()
    p.style = "Normal"
    p.paragraph_format.left_indent = Inches(0.22)
    p.paragraph_format.space_after = Pt(8)
    p.paragraph_format.line_spacing = 1.0
    for line in text.split("\n"):
        run = p.add_run(line)
        run.font.name = "Consolas"
        run.font.size = Pt(8.5)
        run.font.color.rgb = NAVY
        run.add_break()
    return p


def draw_diagram():
    image = Image.new("RGB", (1440, 740), "white")
    draw = ImageDraw.Draw(image)
    font_path = Path("C:/Windows/Fonts/segoeui.ttf")
    bold_path = Path("C:/Windows/Fonts/segoeuib.ttf")
    font = ImageFont.truetype(str(font_path), 25)
    bold = ImageFont.truetype(str(bold_path), 29)
    small = ImageFont.truetype(str(font_path), 19)

    boxes = {
        "household": (50, 270, 290, 380, "HOUSEHOLD", "household_id"),
        "occupancy": (385, 50, 625, 160, "OCCUPANCY", "household + occupant"),
        "occupant": (730, 50, 970, 160, "OCCUPANT", "occupant_id"),
        "bill_cycle": (385, 265, 625, 375, "BILL CYCLE", "household_id"),
        "bill": (730, 265, 970, 375, "BILL", "cycle_id"),
        "bill_share": (1100, 265, 1370, 375, "BILL SHARE", "bill_id + occupant_id"),
        "slab_rate": (385, 480, 625, 590, "SLAB RATE", "household_id"),
        "breakdown": (730, 480, 1020, 590, "SLAB BREAKDOWN", "bill_id + slab_rate_id"),
    }
    arrows = [
        ((290, 290), (385, 135)), ((625, 105), (730, 105)),
        ((290, 325), (385, 325)), ((625, 320), (730, 320)),
        ((970, 320), (1100, 320)), ((290, 360), (385, 535)),
        ((850, 375), (850, 480)), ((625, 535), (730, 535)),
        ((850, 160), (1235, 265)),
    ]
    for a, b in arrows:
        draw.line((a, b), fill="#90AEB6", width=4)
        import math
        angle = math.atan2(b[1] - a[1], b[0] - a[0])
        length = 16
        left = (b[0] - length * math.cos(angle - 0.45), b[1] - length * math.sin(angle - 0.45))
        right = (b[0] - length * math.cos(angle + 0.45), b[1] - length * math.sin(angle + 0.45))
        draw.polygon([b, left, right], fill="#90AEB6")
    for x1, y1, x2, y2, label, key in boxes.values():
        draw.rounded_rectangle((x1, y1, x2, y2), radius=14, fill="#EAF2F3", outline="#2A7381", width=3)
        draw.text((x1 + 14, y1 + 20), label, font=bold if label == "HOUSEHOLD" else font, fill="#173E50")
        draw.text((x1 + 14, y1 + 65), key, font=small, fill="#526A75")
    draw.text((50, 650), "Core ER flow: arrows point from a parent record to a related record.", font=font, fill="#526A75")
    target = TMP / "core_er.png"
    image.save(target)
    return target


doc = Document()
sec = doc.sections[0]
sec.top_margin = Inches(0.73)
sec.bottom_margin = Inches(0.69)
sec.left_margin = Inches(0.8)
sec.right_margin = Inches(0.8)

styles = doc.styles
styles["Normal"].font.name = "Calibri"
styles["Normal"].font.size = Pt(10)
styles["Normal"].font.color.rgb = NAVY
styles["Normal"].paragraph_format.line_spacing = 1.12
styles["Normal"].paragraph_format.space_after = Pt(5)
styles["Title"].font.name = "Calibri"
styles["Title"].font.size = Pt(24)
styles["Title"].font.bold = True
styles["Title"].font.color.rgb = RGBColor(0, 0, 0)
styles["Title"].paragraph_format.space_after = Pt(15)
title_ppr = styles["Title"]._element.get_or_add_pPr()
for item in list(title_ppr):
    if item.tag == qn("w:pBdr"):
        title_ppr.remove(item)
for name, size, color in [("Heading 1", 15, NAVY), ("Heading 2", 11.5, TEAL)]:
    styles[name].font.name = "Calibri"
    styles[name].font.size = Pt(size)
    styles[name].font.bold = True
    styles[name].font.color.rgb = color
    styles[name].paragraph_format.space_before = Pt(12)
    styles[name].paragraph_format.space_after = Pt(5)

footer = sec.footer.paragraphs[0]
footer.alignment = WD_ALIGN_PARAGRAPH.RIGHT
fld = OxmlElement("w:fldSimple")
fld.set(qn("w:instr"), "PAGE")
footer._p.append(fld)

title = doc.add_paragraph("SlabSplit Implementation Documentation", style="Title")
title.alignment = WD_ALIGN_PARAGRAPH.LEFT
direct_ppr = title._p.get_or_add_pPr()
no_border = OxmlElement("w:pBdr")
bottom = OxmlElement("w:bottom")
bottom.set(qn("w:val"), "nil")
no_border.append(bottom)
direct_ppr.append(no_border)
add_body(doc, "Project implementation guide for the DBMS Level 3 mini project. This document explains the working base demo, maps it to the mandatory course requirements, and records what has actually been verified. The original project PDF and course requirements Word file remain unchanged.")
add_body(doc, "Project team named in the proposal: Dhanush S and Darshan Govekar. Actual individual contributions and Git commits must be recorded by the team before submission.")

add_heading(doc, "1 Problem and objective")
add_body(doc, "A shared flat receives one electricity bill, but occupants may move in or out during the billing period. Equal division can charge someone for days when they did not live there. SlabSplit stores dated occupancy, tariff slabs, bills and shared expenses, calculates each person's fair share, records who paid, and suggests transfers between flatmates.")
add_bullet(doc, "Calculate slab charges from meter readings and the household's effective tariff rates.")
add_bullet(doc, "Allocate utility and recurring expense amounts according to applicable occupancy days. Rent can also use a rent weight.")
add_bullet(doc, "Track provider payments, reimbursements, receipts and settlement status in a database-backed web interface.")

add_heading(doc, "2 Scope and requirements coverage")
add_body(doc, "The base demo uses Next.js for the interface, PostgreSQL for related financial records, and pgvector for similarity search. The vector service uses the MiniLM model named in the project PDF. The SQL database remains the source of truth for money and relationships.")
add_table(doc, ["Course requirement", "Where implemented", "Current state"], [
    ("SQL plus vector paradigm", "PostgreSQL schema, pgvector and embedding service", "SQL demo verified; pgvector run pending"),
    ("ER diagram and relational schema", "Source PDF; diagram and table dictionary in this guide", "Documented"),
    ("CREATE, ALTER, DROP", "database/schema.sql and database/ddl_demo.sql", "Scripts present"),
    ("INSERT, UPDATE, DELETE, SELECT", "Next.js actions and data API", "Implemented"),
    ("JOIN, GROUP BY, HAVING, ORDER BY, aggregate, subquery", "Reports screen and database/queries.sql", "Implemented"),
    ("Four advanced database concepts", "Transactions, views, function, triggers, indexes, search", "Implemented in SQL/code"),
    ("Next.js interface and API", "app/page.jsx, app/api and lib", "Build verified"),
    ("Two roles and secure passwords", "Admin/member accounts, scrypt hashes, signed cookie", "Implemented"),
    ("Documentation, screenshots, test results, Git", "This guide, README, tests and initialized Git", "Screenshots and real commits pending"),
], [1.82, 2.65, 1.95])

add_heading(doc, "3 System architecture")
add_body(doc, "The browser calls Next.js Route Handlers. The handlers check the signed session and role, then call the domain logic. The domain logic uses parameterized SQL through the pg driver and wraps multi-step changes in transactions. The embedding service turns text into a 384-number vector; pgvector stores it and compares cosine distance for semantic search.")
add_code(doc, "Browser (Next.js page) -> API routes -> validation and billing logic -> PostgreSQL\nSearch request -> embedding service -> pgvector similarity query")
add_table(doc, ["Part", "Responsibility", "Main files"], [
    ("Interface", "Forms, tables, dashboard, reports and search", "app/page.jsx; app/styles.css"),
    ("API", "Login, data, changes, search and receipt upload", "app/api/*/route.js"),
    ("Domain logic", "Bill, expense, payment and settlement rules", "lib/logic.js; lib/calculation.js"),
    ("Database", "Tables, keys, checks, views, functions and triggers", "database/schema.sql"),
    ("Vector service", "MiniLM embeddings for document text", "embedding-service/app.py"),
], [1.15, 2.8, 2.47])

add_heading(doc, "4 Database design")
add_body(doc, "The source PDF defines 16 entities. The implementation keeps those entities and adds bill_share so each calculated utility allocation is stored, visible and auditable. The image below shows the main relationships; the table dictionary covers the supporting entities as well.")
diagram = draw_diagram()
p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
p.add_run().add_picture(str(diagram), width=Inches(6.7))
add_body(doc, "In the diagram, a household has occupancy periods, cycles and slab rates. A cycle contains bills. Each bill has slab breakdown rows and occupant bill-share rows. Occupancy connects each occupant to the household and supplies the day count.")
add_heading(doc, "Relational schema and data dictionary", 2)
add_table(doc, ["Table", "Key and relationship", "What it stores"], [
    ("household", "household_id PK", "Flat name, address, city, rooms and currency"),
    ("occupant", "occupant_id PK", "Person, contact and optional UPI details"),
    ("occupancy", "occupancy_id PK; household_id and occupant_id FK", "Move dates, room and rent weight"),
    ("bill_cycle", "cycle_id PK; household_id FK", "Start/end dates, due date and status"),
    ("slab_rate", "slab_rate_id PK; household_id FK", "Utility unit range, rate and effective dates"),
    ("bill", "bill_id PK; cycle_id FK", "Readings, units and calculated charge"),
    ("bill_slab_breakdown", "breakdown_id PK; bill_id and slab_rate_id FK", "Units and cost in each applied slab"),
    ("bill_share", "bill_id + occupant_id PK and FK", "Added stored share and applicable days"),
    ("expense", "expense_id PK; household, cycle, payer FK", "Description, category, amount and date"),
    ("expense_share", "share_id PK; expense_id and occupant_id FK", "Each person's expense portion"),
    ("payment", "payment_id PK; bill or expense, occupant FK", "Amount, payer, date, mode and reference"),
    ("settlement", "settlement_id PK; cycle and two occupants FK", "Suggested transfer and status"),
    ("role", "role_id PK", "Admin and member roles"),
    ("app_user", "user_id PK; role and optional occupant FK", "Login identity and password hash"),
    ("receipt", "receipt_id PK; bill or expense FK", "Uploaded file URL and optional text"),
    ("doc_embedding", "embedding_id PK; source type and ID", "Text and 384-dimensional vector"),
    ("audit_log", "log_id PK; optional app_user_id FK", "Who changed what and when"),
], [1.35, 2.55, 2.52])

add_heading(doc, "5 Calculation rules")
add_body(doc, "Billing uses the difference between current and previous meter readings. Each unit range is charged at its own rate. The fixed charge comes from the first active slab. A bill is generated only when the slabs start at zero and cover all consumed units without a gap. A duplicate utility bill for one cycle is rejected by a unique constraint.")
add_table(doc, ["Electricity example", "Units", "Rate", "Charge"], [
    ("0 to 100", "100", "INR 4", "INR 400"),
    ("100 to 200", "100", "INR 6", "INR 600"),
    ("Above 200", "20", "INR 8", "INR 160"),
    ("Fixed charge", "", "", "INR 60"),
    ("Total for 220 units", "", "", "INR 1,220"),
], [2.5, 0.85, 1.25, 1.82])
add_body(doc, "The seeded October cycle has Asha and Dev for 31 days each and Mira from 16 October for 16 days. Their day weights total 78. The INR 1,220 bill is allocated as INR 484.87, INR 484.87 and INR 250.26. The final share receives any rounding remainder, so the shares always add to the bill amount.")
add_body(doc, "A one-off expense is shared by occupants present on its date. A recurring expense uses occupied days across the cycle. Rent multiplies those days by each occupancy record's rent_weight. Expense reimbursements reduce what the original payer is owed. Settlement generation waits until all utility bills are fully paid, then nets each person's allocations and payments.")

add_heading(doc, "6 Web interface and roles")
add_table(doc, ["Screen", "What the user can do"], [
    ("Overview", "See occupants, cycle totals, bill balance and per-person allocated/paid amounts."),
    ("Household and people", "Create a household, occupants, dated occupancy and billing cycles; view or close cycles."),
    ("Bills and rates", "Enter slabs, calculate a bill, inspect breakdown and shares, and record provider payments."),
    ("Expenses and receipts", "Add shared expenses, view shares, record reimbursements and attach receipts."),
    ("Settlements", "Generate transfer suggestions after bills are paid, then mark or cancel transfers."),
    ("Reports", "Show grouped category totals, occupancy days and expenses above the average."),
    ("Search and audit", "Search descriptions by words or MiniLM similarity and inspect recent changes."),
], [1.75, 4.67])
add_body(doc, "Admin can manage household data and generate settlements. Member can view an associated household, record only their own payments, and mark a transfer where they are the payer as settled. The seed script creates one account of each role. The API checks the role rather than relying only on hidden buttons.")

add_heading(doc, "7 SQL operations and advanced concepts")
add_body(doc, "The course asks for more than CRUD. The app creates and changes records, but the important behavior is the calculated bill, dated sharing, net settlement and searchable documents. The database script defines keys, foreign keys, unique rules, checks and indexes. database/ddl_demo.sql demonstrates ALTER and DROP in a transaction that rolls back so it does not permanently change the project schema.")
add_table(doc, ["Concept", "Simple explanation", "Where to see it"], [
    ("Transaction", "All rows for one bill or settlement save together, or none save.", "lib/db.js and lib/logic.js"),
    ("View", "A saved SELECT presents bill dues and cycle balances.", "v_bill_summary; v_cycle_member_balance"),
    ("Function", "occupancy_days counts overlap between a stay and a cycle.", "database/schema.sql"),
    ("Trigger", "Reject overlapping stays and record bill/expense/payment changes.", "database/schema.sql"),
    ("Index", "Speeds date lookups, text search and vector similarity.", "database/schema.sql"),
    ("Search", "GIN supports word search; pgvector compares embeddings.", "app/api/search/route.js"),
], [1.15, 3.15, 2.12])
add_body(doc, "The Reports screen makes the required query forms visible. The category report uses GROUP BY, COUNT, SUM, AVG, HAVING and ORDER BY. Occupied days join cycles, occupancy and occupants. The above-average report uses an AVG subquery. database/queries.sql contains additional examples that can be run in psql.")
add_code(doc, "SELECT category, COUNT(*) AS expense_count, SUM(amount) AS total\nFROM expense\nGROUP BY category HAVING SUM(amount) > 0\nORDER BY total DESC;")

add_heading(doc, "8 Validation and security")
add_bullet(doc, "Database CHECK constraints reject invalid amounts, meter readings, dates and duplicate cycle or bill combinations. The occupancy trigger rejects overlapping stays.")
add_bullet(doc, "API validation checks required fields, IDs, roles, cycle membership, payment limits and complete slab coverage. SQL values use parameters instead of string concatenation.")
add_bullet(doc, "The database URL and session secret come from environment variables. Passwords are salted scrypt hashes. Sessions use a signed, HTTP-only cookie.")
add_bullet(doc, "Receipt uploads accept only PDF, JPEG or PNG up to 5 MB and use generated filenames. Only admin can upload or index documents.")

add_heading(doc, "9 Setup and demonstration")
add_number(doc, "Install Node.js 20.6 or newer and Docker Desktop with Compose. Copy .env.example to .env.local. Set SESSION_SECRET and the two DEMO passwords in .env.local.")
add_number(doc, "Run docker compose up -d --build. This starts PostgreSQL with pgvector and the MiniLM embedding service. The first model download may take time.")
add_number(doc, "Run npm ci and then npm run seed. The seed reads .env.local and creates a demo flat, three occupants, an October 2026 cycle, electricity slabs and two login roles.")
add_number(doc, "Run npm run dev, open http://localhost:3000 and sign in as admin or asha with the chosen passwords.")
add_number(doc, "Generate the demo electricity bill using readings 1000 and 1220. Show the INR 1,220 breakdown and the 31/31/16-day shares. Record payments totaling INR 1,220.")
add_number(doc, "Add a shared expense, inspect its shares, generate settlements, then open Reports and Search to demonstrate the required SQL queries and search features.")
add_body(doc, "For a fresh database, Compose runs database/schema.sql during initialization. Existing databases require the schema to be applied separately. README.md has the full commands and the Windows WebAssembly compiler workaround used for the build on this machine.")

add_heading(doc, "10 Testing evidence and remaining submission items")
add_table(doc, ["Check", "Observed result"], [
    ("220-unit slab calculation", "Passed: INR 1,220 including the fixed charge."),
    ("31/31/16-day allocation", "Passed: INR 484.87, INR 484.87 and INR 250.26; exact total."),
    ("Gap in tariff slabs", "Passed: calculation rejects the gap."),
    ("Settlement pairing example", "Passed: exact search finds four transfers where simple greedy pairing finds five."),
    ("Next.js production build", "Passed after using the local WebAssembly compiler fallback."),
    ("Local SQL demo", "Passed: PostgreSQL 18 seed, admin/member sign-in and dashboard data loaded."),
    ("pgvector and MiniLM", "Pending: no Docker or pgvector-enabled runtime was available here."),
], [2.3, 4.12])
add_body(doc, "Before the final course submission, the team should run the full Docker and pgvector demo, capture screenshots of the main screens, record manual test results, and show each member's actual Git commits. The local SQL demo did not exercise vector search. The source PDF's ER and relational diagrams should also be updated to show the added bill_share table if the final submission requires one combined diagram.")

add_heading(doc, "11 Contribution record and conclusion")
add_body(doc, "The proposal names Dhanush S and Darshan Govekar. A suitable work split is billing SQL and UI for one member, and expenses, settlement SQL and reports for the other, with both members reviewing and testing both layers. Replace this suggested split with the real work and commit history before submission.")
add_body(doc, "The base project meets the core design goal: dated occupancy is connected to tariff billing, shared expenses and settlements through related SQL tables and a usable Next.js application. Future increments can add automatic receipt OCR, account invitations, tariff editing and more integration tests after the base demo is reviewed.")

doc.save(OUT)
print(OUT)
