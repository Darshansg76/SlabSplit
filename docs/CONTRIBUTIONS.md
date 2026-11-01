# Team contributions

Course requirement 2 asks for clearly defined responsibilities, with both members
contributing to **database and application development**. Requirement 15 asks that the
Git history show those contributions. This file records the split; the commit hashes
are the evidence, and `git log` / `git shortlog -sne` confirm them.

| | Member A | Member B |
|---|---|---|
| **Name** | Dhanush S | Darshan Govekar |
| **SRN** | PES1UG24AM360 | PES1UG24AM355 |
| **GitHub** | `dhanushs1912-svg` | `Darshansg76` |

## Member B — Darshan — application and initial database implementation

**Database**
- Designed and wrote `database/schema.sql`: 17 tables, ENUM domain types, primary and
  foreign keys, CHECK and UNIQUE constraints, generated columns (`total_days`,
  `units_consumed`, `description_tsv`).
- Wrote the `occupancy_days` SQL function, the occupancy-overlap rejection trigger, the
  audit trigger across four tables, and the `v_bill_summary` and
  `v_cycle_member_balance` views.
- Chose the pgvector data model (`doc_embedding`, 384-d, HNSW cosine index) and the
  GIN full-text index.
- Wrote `database/queries.sql` and `database/ddl_demo.sql`.

**Application**
- Built the whole Next.js interface (`app/page.jsx`, `app/layout.jsx`, `app/styles.css`)
  with the seven tabs, forms, tables and reports.
- Built the API layer: `app/api/auth`, `data`, `actions`, `upload`, `search`.
- Wrote `lib/calculation.js` (slab tiers, exact-cents allocation, minimum-transfer
  search), `lib/logic.js`, `lib/auth.js` (scrypt hashing, signed sessions), `lib/db.js`.
- Built the Python embedding service and the Docker Compose environment.
- Wrote the unit tests in `tests/calculation.test.mjs` and the initial documentation.

**Commit:** `d9f4d14` — *Initial SlabSplit project*

## Member A — Dhanush — database design artifacts, tuning and account management

**Database**
- Produced the ER diagram and the relational schema, and reconciled them against the
  implemented DDL after `bill_share` was added (17 tables / 26 foreign keys).
- Wrote `scripts/build_schema_diagram.py`, which generates
  `docs/diagrams/slabsplit_relational.svg` **directly from `database/schema.sql`** so the
  diagram cannot drift from the schema.
- Reviewed the schema for unindexed foreign keys and added 14 covering indexes; without
  them the balance view and snapshot joins fall back to sequential scans and deleting a
  parent row scans the child table.
- Wrote `docs/REQUIREMENTS_COMPLIANCE.md`, mapping every course requirement to the file
  that satisfies it with verification SQL.

**Application**
- Implemented account management, which the first build did not have: self-registration
  (`app/api/register/route.js`), admin account creation and deactivation, and password
  change (`lib/logic.js`, `app/page.jsx`).
- Implemented bill deletion, including the ordering needed to avoid violating
  `chk_payment_target`, and the guard that refuses deletion once a cycle has settled
  transfers.
- Hardened `app/api/upload/route.js` so a malformed upload returns JSON instead of an
  HTML 500 page.

**Commits:** `f693f61`, `f878349`, `61cf729`, `1d73432`

## Shared

Problem statement, entity and relationship design, the choice of PostgreSQL + pgvector
and its justification, the demo walkthrough, and final testing were agreed jointly.

> **Before submitting:** add any commits made after this file was written. Keep committing under your own Git identities —
> `git shortlog -sne` is the quickest way for an evaluator to check this, and it should
> show both of you.
