# SlabSplit

SlabSplit calculates fair utility and shared expense shares for flatmates who may move in or out during a billing cycle. It is a two-role Next.js and PostgreSQL project based on the supplied mini-project design. The base demo supports the complete calculation path and keeps the PDF's original entities, with one additional `bill_share` table to record utility allocations.

The Word guide at `docs/SlabSplit Implementation Documentation.docx` explains the requirements mapping, database tables, calculations, interface, setup and verified test results in student-friendly language.

## Stack and database choice

- **Next.js** provides the web interface and Route Handler API.
- **PostgreSQL** stores households, occupants, occupancy periods, tariffs, cycles, bills, expenses, payments, receipts, roles, and audit records in related tables with constraints and transactions.
- **pgvector** stores 384-dimensional embeddings for expense descriptions and receipt text. A small local Python service uses `all-MiniLM-L6-v2` to produce normalized vectors; cosine distance (`<=>`) retrieves similar records. This is useful for searching loosely worded receipts and descriptions, while PostgreSQL full-text search handles exact terms.
- The database uses a trigger, a function, views, indexes, GIN full-text search, an HNSW vector index, and transactions. Passwords use salted scrypt hashes; the session cookie is signed and HTTP-only.

## Setup

One-time setup: install Node.js (verified with Node 24) and Docker Desktop with
Compose, and complete Docker Desktop's initial setup. In PowerShell from the
project folder, run:

```powershell
if (!(Test-Path .env.local)) { Copy-Item .env.example .env.local }
npm.cmd ci
```

Edit `.env.local`: choose a random `SESSION_SECRET` of at least 32 characters,
set both demo passwords to at least eight characters, and keep the database URL
on the Compose host port `55432`. Set `EMBEDDING_SERVICE_URL=http://127.0.0.1:8001`.
Preserve existing local configuration and passwords.

**Start everything, including after a Windows restart, with one command:**

```powershell
npm.cmd run demo
```

The command finds Docker even when an old VS Code terminal has a stale PATH,
starts Docker Desktop if needed, starts the PostgreSQL/pgvector and Python
containers, waits for the database, warms the existing MiniLM model, and starts
Next.js at **http://127.0.0.1:3000**. It builds the embedding image only when its
source fingerprint changes or no container image is available. Initial image and
model downloads require internet. Existing containers keep their model cache;
recreating the embedding container may require another download.

Demo records are seeded **only when both households and user accounts are empty**.
An existing database is preserved and skipped; do not run the seed repeatedly.
The startup lock and app health check avoid duplicate website processes. A port
already used by another application is reported instead of silently starting on
another port. Keep the terminal open. Ctrl+C stops the website (answer Y if Windows
asks to terminate the npm batch job); `docker compose
stop` stops this project's containers while preserving the database volume.

Sign in as `admin` or `asha` with the passwords already configured in `.env.local`.
To start just the supporting services for verification, use
`npm.cmd run demo -- --services-only`.

The Compose database password remains an existing local-demo value. Ports `55432`
and `8001` are published on the host without an explicit localhost bind in the
existing Compose file; use this setup only on a trusted development laptop.

The Compose database initializes `database/schema.sql` only when its data volume is new. For an existing local database, run the schema with `psql -f database/schema.sql` on an empty database. `database/queries.sql` contains showcase queries, and `database/ddl_demo.sql` demonstrates reversible ALTER and DROP commands.

On a Windows machine where the native Next.js SWC compiler cannot load, set `NEXT_TEST_WASM_DIR` to the absolute path of `node_modules/@next/swc-wasm-nodejs` and set `NEXT_IGNORE_INCORRECT_LOCKFILE=1` before `npm run build`. This project includes the WebAssembly package for that fallback.

## Demo walkthrough

The seed has an October 2026 cycle, three occupants (Mira moves in on October 16), and electricity slabs of 0–100 units at ₹4, 100–200 at ₹6, and above 200 at ₹8, plus a ₹60 fixed charge.

1. In **Bills & rates**, generate an electricity bill with previous reading `1000` and current reading `1220`. It should charge ₹400 + ₹600 + ₹160 + ₹60 = **₹1,220**. The shares use 31, 31, and 16 occupied days, so Asha and Dev each owe ₹484.87 and Mira owes ₹250.26.
2. Record one or more bill payments totaling ₹1,220. Payments cannot exceed the unpaid bill balance.
3. In **Expenses & receipts**, add a shared expense and choose its payer. A one-off expense splits among people present on its date. A recurring expense uses occupied days across the cycle; rent additionally uses `rent_weight`.
   An occupant may record a reimbursement to the original payer; it reduces their outstanding share and the payer's credit.
4. In **Settlements**, generate suggested transfers. The app nets allocations and payments into transfers between debtors and creditors. It requires full bill payment first. Mark transfers settled when paid.
5. Upload a receipt PDF or image (up to 5 MB), optionally enter its text, and index it. Index expenses too. Compare full-text and semantic search in **Search & audit**.
6. Open **Reports** to demonstrate grouped expense totals, occupied days, and expenses above the average. These show JOIN, GROUP BY, HAVING, ORDER BY, aggregates, and a subquery in the running interface.

## Database and domain rules

- Occupancy periods for the same occupant and household cannot overlap. A cycle uses inclusive start and end dates.
- Slab rates must start at unit 0, cover all consumed units without gaps, and be effective for the entire cycle. `fixed_charge` is taken from the first slab only.
- Bill and expense shares use integer paise. Fractional remainders are ranked and leftover paise are assigned with a stable identity tie-break, so shares stay nonnegative and sum exactly to the source amount.
- Bill payments credit the occupant who paid the provider. Expenses credit the occupant who paid upfront. Settlements are generated only when bills are fully paid, so cycle balances net to zero. Groups with up to 12 nonzero balances use an exact minimum-transfer search; larger groups use a fast greedy pairing and are labelled accordingly.
- Admins can manage records and generate settlements. Members can view households where they have occupancy, record only their own bill payments, mark transfers where they are the payer as settled, and change their own password.
- **Accounts.** Anyone can self-register as a `member`; the request cannot choose an admin role. If an admin already added an occupant with that email, the admin creates an invitation under **Household & people → Invite an existing occupant** and privately gives the code to that person. Registering with the same email and that valid 24-hour code links the existing row without duplication. Knowing an email alone is insufficient. A successful link prevents invitation replay. No extra database table or column is used. Admin-created accounts and deactivation remain available. A new member needs an occupancy assignment before seeing a household.
- A bill can be deleted by an admin while its cycle is not closed, removing its shares, slab breakdown and recorded provider payments. Pending suggestions are marked `cancelled` and remain visible as history. If any transfer is settled, financial source changes are refused. Deleting the last bill returns the cycle to `open`.
- Reimbursed expenses cannot be deleted; their payment history is retained. Occupancy changes affecting saved allocations are refused rather than silently rewriting shares. Invalid input or failed operations roll back the entire transaction, including suggestion cancellation.
- The overview shows original due and outstanding after completed outgoing/incoming transfers. Reimbursements are counted only through the existing payment view. Allocation uses integer-ratio largest remainders with a stable identity tie-break, preserving nonnegative shares and exact totals.
- Receipt uploads are checked by file signatures and stored outside the public directory in `storage/receipts`. On startup, existing files are moved from `public/uploads` into private storage without overwriting or changing their bytes. Standard `/uploads/<filename>` URLs remain valid through authenticated, household-authorized downloads. Nonstandard legacy entries are preserved in a private import folder for review. Back up receipts separately from PostgreSQL.
- The audit screen includes bills, expenses, payments, settlements and deleted records when existing JSONB history and parent records identify their household/cycle. It does not change the audit trigger or invent missing historical context.
- Application mutations take a shared transaction advisory lock. It serializes competing API payments, occupancy inserts, settlement completion and source edits. Direct SQL clients can bypass this protocol; stronger database constraints require approval under the fixed PDF requirements.
- Sensitive values are read from environment variables. Password hashes, not plaintext passwords, are stored in the database.

## Schema and deliverables

The 16 entities in the PDF are `household`, `occupant`, `occupancy`, `bill_cycle`, `slab_rate`, `bill`, `bill_slab_breakdown`, `expense`, `expense_share`, `payment`, `settlement`, `role`, `app_user`, `receipt`, `doc_embedding`, and `audit_log`. The PDF's `CREATE EXTENSION vector` is retained, and `bill_share` is added for persisted utility allocation. Primary and foreign keys, checks, unique constraints, and indexes are in `database/schema.sql`.

### Diagrams

- **Relational schema:** `docs/diagrams/slabsplit_relational.svg` (and `.png`) — all 17 tables and 26 foreign keys in crow's-foot notation, including `bill_share`. It is generated by `scripts/build_schema_diagram.py` directly from `database/schema.sql`, so the picture cannot drift from the DDL. Regenerate after any schema change:
  ```
  python scripts/build_schema_diagram.py database/schema.sql docs/diagrams/slabsplit_relational.svg
  ```
- **ER diagram:** the Mermaid diagram in `docs/PROJECT.md`, which GitHub renders inline and which already includes `bill_share`.

`docs/REQUIREMENTS_COMPLIANCE.md` maps every numbered course requirement to the file that satisfies it, with SQL a reviewer can run to verify the object counts. `docs/CONTRIBUTIONS.md` records which teammate did what, with commit hashes.

This repository contains the application and database implementation. For the final course submission, add screenshots captured from a running instance and your manual test results — those cannot be honestly invented here. Commit each teammate's work under their own Git identity so the history shows individual contributions.

## Fixed database commands and verification

The original PDF and every existing `database/*.sql` file remain unchanged.
[PDF comparison and existing differences](docs/PDF_DATABASE_CONTRACT.md) records
the added table/constraints/objects and the pre-existing named bill-check mismatch.
The old `.local-postgres` fallback is not the supported vector configuration.

Verification commands:

```powershell
npm.cmd test
npm.cmd run test:integration
npm.cmd run build
```

Unit/contract tests need no database. Integration tests require the Docker
services and create an isolated, randomly named verification database using the
unchanged schema. They exercise real API workflows, inspect committed database
results, compare downloaded receipt bytes, and rank actual indexed MiniLM
documents. Every existing application table is fingerprinted before/after, and
only the disposable test database is removed. Start the app once before testing
if old public receipt files need importing. See
[observed results and remaining limitations](docs/REPAIR_VERIFICATION.md).

## Suggested next increments

Consider receipt OCR, password reset and exportable statements after the verified
demo is reviewed. Changes to database definitions need explicit PDF-contract
approval; application changes should continue to preserve the fixed commands.
