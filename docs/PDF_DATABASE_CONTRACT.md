# Fixed PDF database contract

Compared on 2 November 2026 against the original `DBMS Mini Project.pdf`.
The PDF was read and its SQL pages were rendered for inspection. It was not edited.
This comparison was reported before implementation changes began.

## Commands checked

The PDF contains DDL on pages 2–10: `CREATE EXTENSION IF NOT EXISTS vector`, six
`CREATE TYPE ... AS ENUM` statements, and sixteen `CREATE TABLE` statements.
It does not provide a standalone INSERT, UPDATE, DELETE, SELECT, vector-search
query, index definition, trigger, function, or view definition. Expressions inside
the DDL, including generated columns and full-text generation, are part of the
protected definitions.

All six enum names and ordered values were compared:
`utility_type_t`, `cycle_status_t`, `payment_mode_t`, `settlement_status_t`,
`expense_category_t`, and `doc_source_t`.

| PDF table | Definitions compared with the existing main schema |
| --- | --- |
| household | ID, name, address, city, rooms, currency, created/updated dates; PK and room constraint |
| occupant | ID, name, phone, email, UPI ID, active flag, updated timestamp; PK, email uniqueness and both contact checks |
| occupancy | ID, household/occupant FKs, move dates, rent weight and room; PK, FK actions and date/weight checks |
| bill_cycle | ID, household FK, start/end, generated inclusive day count, due date, status, updated timestamp; PK, range and unique-cycle constraints |
| slab_rate | ID, household FK, utility enum, unit bands, rates, fixed charge and effective dates; types, defaults, checks, PK and FK actions |
| bill | ID, cycle FK, utility, readings, generated consumption, charges and generation date; types, PK, FK and unique bill constraint; reading-check difference below |
| bill_slab_breakdown | ID, bill/rate FKs, units and amount; PK, checks, uniqueness and FK actions |
| expense | ID, household/cycle/payer FKs, category, description, amount, date, recurring flag, updated timestamp and generated English tsvector |
| expense_share | ID, expense/occupant FKs, weight, amount and applicable days; types, checks, PK, uniqueness and FK actions |
| payment | ID, bill/expense/occupant FKs, amount, date, mode and reference; PK, FK actions and required-target check |
| settlement | ID, cycle/payer/payee FKs, amount, status, settled date and updated timestamp; PK, FK actions, amount and distinct-person checks |
| role | ID, unique name and description; PK and types |
| app_user | ID, unique occupant FK, role FK, unique username/email, password hash, active flag and created date; PK, FK actions and hash-length check |
| receipt | ID, expense/bill/uploader FKs, file URL, text and upload date; PK, FK actions and required-target check |
| doc_embedding | ID, source enum/ID, content, **vector(384)**, default **all-MiniLM-L6-v2**, creation timestamp and source uniqueness |
| audit_log | ID, user FK, entity name/ID, INSERT/UPDATE/DELETE action enum-like check, JSONB details and timestamp |

## Existing differences, retained rather than silently corrected

1. `bill_share` is an additional table for saved utility allocations. Its two FKs
   bring the main implementation to 17 tables and 26 FKs; the PDF has 16 tables.
2. `occupancy` adds `uq_occupancy`, `slab_rate` adds `uq_slab_start`, and `payment`
   adds `chk_payment_one_target`. These existing additions remain in place.
3. The PDF gives `bill.curr_reading` an inline `CHECK (curr_reading >= 0)` and a
   separate named `chk_bill_reading CHECK (curr_reading >= prev_reading)`. The main
   schema instead puts `CHECK (curr_reading >= prev_reading)` inline and omits that
   named constraint. Together with `prev_reading >= 0`, validation is equivalent,
   but the DDL text and constraint identity differ. This has **not** been changed.
4. FK references use PostgreSQL's primary-key shorthand, such as `REFERENCES
   household`, instead of explicitly writing `household(household_id)`.
5. The PDF writes rent-weight and share-weight defaults as `1.00` and `1.000`;
   the implementation writes `1`. Column types and numeric default values agree.
6. The existing main schema also contains 22 explicit indexes, 3 functions,
   5 triggers, 2 views, and role seed statements that are not SQL commands in the
   PDF. They remain unchanged, including GIN, HNSW and both financial views.
7. `.local-postgres/schema.local.sql` is an old, separate fallback. It substitutes
   a floating-point array for `vector(384)` and omits vector support and later
   indexes. It is not used by the supported Docker setup and was not changed.

No original PDF table, column, type, PK, FK, enum or vector definition was renamed,
removed or replaced during these fixes. The named reading-check discrepancy above
predates them and needs explicit approval before any schema reconciliation.

## Preservation checks

`tests/fixtures/protected-database-hashes.json` records the pre-change SHA-256
hashes of the PDF and all three existing database command files:

- `database/schema.sql`
- `database/queries.sql`
- `database/ddl_demo.sql`

`npm test` verifies the PDF bytes and exact SQL text, allowing only CRLF/LF
checkout conversion for SQL so a fresh Git checkout does not produce a false
failure. Separate raw hashes confirm that this repair left all four current
files byte-for-byte identical. The sample relational/full-text/vector queries
and DDL demonstration are preserved too, although they were additions outside
the PDF.

The application changes add SELECTs, validated DML, and an advisory transaction
lock over the existing schema. They do not run ALTER TABLE, CREATE/DROP INDEX,
replace a view/trigger/function, or add columns or enum values to the application
database. Integration tests apply the unchanged schema only to a newly created,
isolated verification database; that disposable database is removed afterward.

## Changes that still require database approval

- Restoring the PDF's separate named reading constraint or reconciling any other
  existing DDL difference would require approved changes to existing definitions.
- An exclusion constraint for arbitrary concurrent SQL writers, additional
  household-consistency constraints, stronger receipt target checks at DB level,
  or a household column/change to the audit trigger would change protected design.
  They were not implemented.

Application mutations cooperate through `pg_advisory_xact_lock(73781,1)`. This
serializes API writes, including competing payments, occupancy inserts and
settlement completion. Arbitrary direct SQL writers can bypass that protocol.
Audit reconstruction uses existing JSONB before/after values and surviving parent
records; context that was never stored and whose parents were removed cannot be
invented or fully recovered without a design change.
