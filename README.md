# SlabSplit

SlabSplit calculates fair utility and shared expense shares for flatmates who may move in or out during a billing cycle. It is a two-role Next.js and PostgreSQL project based on the supplied mini-project design. The base demo supports the complete calculation path and keeps the PDF's original entities, with one additional `bill_share` table to record utility allocations.

The Word guide at `docs/SlabSplit Implementation Documentation.docx` explains the requirements mapping, database tables, calculations, interface, setup and verified test results in student-friendly language.

## Stack and database choice

- **Next.js** provides the web interface and Route Handler API.
- **PostgreSQL** stores households, occupants, occupancy periods, tariffs, cycles, bills, expenses, payments, receipts, roles, and audit records in related tables with constraints and transactions.
- **pgvector** stores 384-dimensional embeddings for expense descriptions and receipt text. A small local Python service uses `all-MiniLM-L6-v2` to produce normalized vectors; cosine distance (`<=>`) retrieves similar records. This is useful for searching loosely worded receipts and descriptions, while PostgreSQL full-text search handles exact terms.
- The database uses a trigger, a function, views, indexes, GIN full-text search, an HNSW vector index, and transactions. Passwords use salted scrypt hashes; the session cookie is signed and HTTP-only.

## Setup

1. Install Node.js 20.6+ and Docker Desktop with Compose. Start Docker Desktop.
2. In the project folder, copy `.env.example` to `.env.local` (`Copy-Item .env.example .env.local` in PowerShell, or `cp .env.example .env.local` on macOS/Linux). Edit `.env.local`: choose a `SESSION_SECRET` of at least 32 characters and fill in `DEMO_ADMIN_PASSWORD` and `DEMO_MEMBER_PASSWORD` with passwords of at least eight characters. The example database URL already matches Compose. These settings stay on your laptop because `.env.local` is ignored by Git.
3. Run `docker compose up -d --build` to start PostgreSQL with pgvector and the embedding service. The database is exposed only for local development on host port `55432`; the embedding service uses `8001`. The first embedding request may take time while MiniLM downloads its model.
4. Run `npm ci` to install the exact dependency versions in `package-lock.json`.
5. Run `npm run seed` once to create the demo data and the two accounts. It reads `.env.local` automatically. Repeating the seed against the same database intentionally reports that Demo Flat already exists.
6. Run `npm run dev` and open `http://localhost:3000`.
7. Sign in as `admin` or `asha` using the passwords you chose in `.env.local`.

On later starts, run `docker compose up -d` and `npm run dev`; the database data remains in the Compose volume. Docker Desktop and an internet connection are needed for the first image/model download. The Compose database password is a local-demo example; change it together with `DATABASE_URL` before any deployment outside your laptop.

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
- Bill and expense shares are rounded to paise; the last recipient gets the rounding remainder so shares add exactly to the source amount.
- Bill payments credit the occupant who paid the provider. Expenses credit the occupant who paid upfront. Settlements are generated only when bills are fully paid, so cycle balances net to zero. Groups with up to 12 nonzero balances use an exact minimum-transfer search; larger groups use a fast greedy pairing and are labelled accordingly.
- Admins can manage records and generate settlements. Members can view households where they have occupancy, record only their own bill payments, and mark transfers where they are the payer as settled.
- Sensitive values are read from environment variables. Password hashes, not plaintext passwords, are stored in the database.

## Schema and deliverables

The 16 entities in the PDF are `household`, `occupant`, `occupancy`, `bill_cycle`, `slab_rate`, `bill`, `bill_slab_breakdown`, `expense`, `expense_share`, `payment`, `settlement`, `role`, `app_user`, `receipt`, `doc_embedding`, and `audit_log`. The PDF's `CREATE EXTENSION vector` is retained, and `bill_share` is added for persisted utility allocation. Primary and foreign keys, checks, unique constraints, and indexes are in `database/schema.sql`.

This repository contains the application and database implementation. For the final course submission, add screenshots captured from a running instance, manual test results, and a record of each teammate's actual contributions and Git commits. Those cannot be honestly invented in a seed project. The ER diagram and relational schema in the source PDF remain the design reference; update them to include `bill_share` before final submission.

This folder has been initialized as a Git repository. Commit each teammate's actual work under their own identity. No GitHub remote is assumed here.

## Suggested next increments

Add tariff version editing, receipt OCR, account invitation/password reset, automated test fixtures, and exportable statements after the base demo is reviewed.
