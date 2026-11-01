# SlabSplit — Requirements Compliance

Maps each item in *DBMS Level 3 Project — Project Requirements* to the artifact in this
repository that satisfies it, so a reviewer can verify the claim instead of taking it on trust.

**Legend:** ✅ implemented and verifiable in the repo · 👥 depends on the team, not the code

| # | Requirement | Status | Where |
|---|-------------|:------:|-------|
| 1 | Unique title, real-world problem, **not simple CRUD** | ✅ | Slab tariff tiers, day-weighted proration for mid-cycle move-ins, and minimum-transfer settlement are real computation — `lib/calculation.js`, `lib/logic.js` |
| 2 | 2-member team with defined responsibilities | ✅ | `docs/CONTRIBUTIONS.md` — responsibilities per member, each spanning database **and** application work, with commit hashes as evidence |
| 3 | **SQL + a second paradigm** (min 2) | ✅ | PostgreSQL (relational core) + **pgvector** (`doc_embedding`, HNSW cosine index). Justified in `README.md` → *Stack and database choice* |
| 4 | ER diagram, relational schema, PK/FK/relationships/constraints; vector data model | ✅ | ER: `docs/PROJECT.md` (Mermaid). Relational schema: `docs/diagrams/slabsplit_relational.svg`. Vector model: `README.md` + `doc_embedding` |
| 5 | **DDL**: CREATE, ALTER, DROP, keys, constraints, indexes, views | ✅ | `database/schema.sql` (17 tables, 26 FKs, 22 indexes, 2 views); `database/ddl_demo.sql` demonstrates reversible ALTER/DROP |
| 6 | **DML** + JOIN, GROUP BY, HAVING, ORDER BY, aggregates, subqueries | ✅ | `database/queries.sql`; the same operations run live in the **Reports** tab (`lib/logic.js` → `snapshot`) |
| 7 | **≥ 4 advanced features** | ✅ | **7 present:** transactions (`lib/db.js`), views (`v_bill_summary`, `v_cycle_member_balance`), functions (`occupancy_days`), triggers (5, incl. audit + overlap rejection), indexing (22), full-text search (GIN `description_tsv`), vector similarity (pgvector HNSW) |
| 8 | Vector / semantic search | ✅ | `app/api/search/route.js`, `embedding-service/` (all-MiniLM-L6-v2, 384-d, cosine) |
| 9 | **Next.js** interface with forms, tables, search, dashboards | ✅ | `app/page.jsx`, `app/layout.jsx`, `app/styles.css` |
| 10 | API layer; **no hard-coded credentials**; env vars | ✅ | Route Handlers in `app/api/*`; config via `DATABASE_URL`, `SESSION_SECRET`, `EMBEDDING_SERVICE_URL`; `.env.example` holds no secrets and `.env.local` is git-ignored |
| 11 | Auth + authorization, **≥ 2 roles** | ✅ | `role` + `app_user` tables; **admin** and **member**; checks in `lib/auth.js`, `lib/logic.js` (`performAction`, `householdAccess`) and every route |
| 12 | **DB-level validation and integrity** | ✅ | CHECK constraints on every money/date/reading column, UNIQUE keys, FKs with explicit ON DELETE, generated columns, and a trigger rejecting overlapping occupancy |
| 13 | Security; no plaintext passwords or credentials | ✅ | Salted **scrypt** hashes (`lib/auth.js`), `timingSafeEqual` comparison, HMAC-signed httpOnly cookie, `chk_user_hash_not_plain`, parameterised SQL everywhere |
| 14 | Documentation set | ✅ | `README.md`, `docs/PROJECT.md`, `docs/SlabSplit Implementation Documentation.docx`, this file. *Add screenshots + test results from your own run before submitting.* |
| 15 | Git/GitHub, README, **per-member commits** | 👥 | README present; commit history currently has one commit from one author — see below |
| 16 | Demonstration coverage | ✅ | `README.md` → *Demo walkthrough* (6 steps, with the exact ₹1,220 figures to expect) |
| 17 | Originality | ✅ | Original domain and schema; slab-tariff pro-rata settlement is not a standard tutorial project |
| 18 | Level 3: beyond CRUD, justified DB choice | ✅ | Computation-first design; the SQL-vs-vector split is argued from the nature of the data, not for demo value |

## Verification shortcuts for a reviewer

```sql
-- object counts behind requirements 4, 5 and 7
SELECT
  (SELECT count(*) FROM information_schema.tables
     WHERE table_schema='public' AND table_type='BASE TABLE')                AS tables,
  (SELECT count(*) FROM information_schema.table_constraints
     WHERE table_schema='public' AND constraint_type='FOREIGN KEY')          AS foreign_keys,
  (SELECT count(*) FROM information_schema.table_constraints
     WHERE table_schema='public' AND constraint_type='CHECK')                AS check_constraints,
  (SELECT count(*) FROM pg_indexes WHERE schemaname='public')                AS indexes,
  (SELECT count(*) FROM information_schema.views WHERE table_schema='public') AS views,
  (SELECT count(*) FROM information_schema.triggers WHERE trigger_schema='public') AS triggers;
```

Expected: **17 tables, 26 foreign keys, 2 views, 5 triggers.** The unit tests
(`npm test`) cover the slab tiers, the exact-rupee allocation, and the
minimum-transfer search.

## Two items only the team can close

**Requirement 2 and 15** are about people, not code. The history currently holds a
single commit, `Initial SlabSplit project`, authored by one account — so the
repository does not yet show "individual contributions of team members", which
requirement 15 asks for by name. Fix it going forward: each member commits their own
work from their own `git config user.email`, in small scoped commits. Do not rewrite
history to fabricate contributions.

**Requirement 14** asks for application screenshots and testing results. Capture those
from your own running instance following the README walkthrough.
