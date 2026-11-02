# Schema-preserving repair verification

Work performed on 2 November 2026. The original PDF, `database/schema.sql`,
`database/queries.sql`, and `database/ddl_demo.sql` are byte-for-byte unchanged.
See `PDF_DATABASE_CONTRACT.md` for the comparison completed before editing.

## Implemented behavior

- Allocation uses integer-ratio largest remainders, zero-weight exclusion and
  stable identity ties. Monetary input rejects unsupported decimal precision.
- New application SELECTs retain the existing balance view and add settled
  outgoing/incoming totals. Original due stays visible; outstanding reaches zero
  after completion without counting reimbursements twice.
- All application mutations cooperate through a transaction advisory lock.
  Financial source changes cancel pending suggestions. Completed transfers are
  immutable and freeze financial sources; remaining current pending transfers
  can still be completed. Closed cycles refuse financial writes.
- Occupancy edits that would change saved allocations are refused. Tariff edits
  are checked for overlapping bands/periods and protected financial cycles.
- Reimbursed expense deletion is refused with an explanation and retains payments.
- Audit display resolves household/cycle context from existing before/after JSON,
  including deleted bill/expense records, payment events and settlement events.
- Self-registration remains available. Claiming an existing occupant requires a
  signed admin invitation bound to occupant/email, expiring in 24 hours. Linking
  and uniqueness are checked in the same serialized transaction. No invitation
  table or schema field is added. Knowing an email alone cannot claim membership.
- New receipts are stored privately and validated by signature. App startup moves
  legacy public receipts into private storage, preserving file bytes and standard
  URLs. A dedicated route checks login, every referenced household and existing
  metadata before sending bytes with private/no-store and nosniff headers.
- MiniLM and vector(384) remain unchanged. Indexing rechecks source existence in
  the mutation lock after inference, preventing a concurrent deletion from
  creating a new orphan. App deletions clean the related embedding rows.
- `npm.cmd run demo` finds Docker, starts its engine and services, warms MiniLM,
  skips seeding when records exist, and runs one Next.js process on localhost.

## Test method

`npm.cmd test` runs the original calculation cases plus boundary/property-style
allocation checks, money precision, invitation binding/expiry/tampering, receipt
validation and SHA-256 preservation checks. It requires no running database.

`npm.cmd run test:integration` creates a randomly named `slabsplit_verify_*`
database in the same local PostgreSQL server, applies the unchanged main schema,
seeds only that disposable database, and starts a separate Next.js process with
isolated build output and receipt storage. It uses actual HTTP requests and
PostgreSQL results; the embedding model is real, not mocked. Cleanup removes only
that test database and its owned public-file fixture. The main application
database is never reset, re-seeded or used as a test fixture.

Every row in all 17 existing application tables is fingerprinted before/after.
All fingerprints match. A logical backup of the application database was also
saved under ignored `tmp/slabsplit-repair/slabsplit-before-repair.dump` before
integration verification. It is private verification material, not a submission
artifact. Existing private receipt data is not a test fixture.

## Observed results

- Unit and fixed-command contract tests: **12 passed, 0 failed**.
- Integration scenarios: **12 passed, 0 failed** (Node reports 13 tests including
  the enclosing workflow test).

| Scenario | Observed assertion |
| --- | --- |
| Roles and dates | Admin/member login succeeds; members cannot perform admin actions; October 1–31 and occupancy 31/31/16 remain exact |
| Bill lifecycle | 220 units persists INR 1,220 and shares 484.87/484.87/250.26; deletion removes shares/breakdown; 200 units regenerates INR 1,060 and 421.28/421.28/217.44 |
| Provider payments | Partial payments leave the correct unpaid amount; unpaid settlement generation and overpayments fail; failed writes leave row counts unchanged |
| Suggestion invalidation | Expense/payment changes cancel suggestions; stale IDs cannot be settled; failed source edits roll back cancellation |
| Closed/allocated periods | Financial writes in closed cycles fail; retroactive occupancy edits do not silently change stored shares |
| Reimbursements | A 15-rupee reimbursement reduces the debtor's original due by exactly 15 and reduces the payer's credit by exactly 15; deleting the expense fails and keeps both records |
| Settlement completion | Partial completion changes only the appropriate outstanding balances; final completion yields zero for all three members; source mutations and reversal/replacement fail |
| Registration | New registration stays member despite a requested admin role; email-only claims fail; valid invitations link the original occupant once; wrong-email/replayed claims fail; concurrent claims produce one account |
| Password flow | Password changes require the current password; sign-out clears the browser cookie; old password fails and the new password signs in |
| Receipt access | Anonymous requests fail, foreign-household members fail, permitted members receive identical bytes; forged MIME content fails; imported legacy file bytes remain identical |
| Encoded receipt paths | An encoded-prefix static-file bypass was reproduced during verification, then closed by importing files into private storage; alternate anonymous URLs no longer return file bytes |
| Concurrency | Competing payments cannot overpay; competing occupancy inserts cannot overlap; racing source edit/settlement completion allows one and rejects the conflicting operation |
| Tiny allocations | A three-paise expense among six people commits as three one-paise and three zero-paise shares under the existing checks |
| Audit history | Deleted bill/expense events and payment/settlement events remain visible for the selected household/cycle |

The real semantic-search fixture contains three distinct expense descriptions and
one receipt text, indexed into four actual `vector(384)` rows labelled
`all-MiniLM-L6-v2`:

| Query | First result | Cosine similarity |
| --- | --- | ---: |
| plumbing repair for a leaking faucet | Plumber repaired a leaking kitchen tap and water pipe | 0.683 |
| electrician replacing a broken circuit breaker | Electrician replaced failed circuit breaker panel (receipt) | 0.850 |

The plumbing result ranked above broadband (0.106) and groceries (0.031). Keyword
search for `plumber` found the correct expense. A member outside the household
could not run its search. Indexed source deletion removed its embedding row.
These are fixture observations, not a general search-quality benchmark. No claim
is made that HNSW accelerates this tiny collection or was chosen by the planner.
MiniLM truncates long inputs; this verification uses short entered text, not OCR.

Detailed local evidence and server output are in ignored `tmp/slabsplit-repair`.
The integration suite also caught an enum/text parameter-inference error in the
existing settlement-update query; explicit enum casts fixed it without changing
the enum or schema.

## Limits and approval boundaries

The PDF's named bill-check discrepancy and all other pre-existing additions remain
as documented. No ALTER, replacement trigger/view, new column, exclusion
constraint, enum change, or alternate database was introduced.

Application advisory locks protect cooperating app/API writes, not arbitrary SQL
clients. Database-level exclusion and cross-household constraints, or a different
audit trigger/schema, need explicit approval. If historical JSON and surviving
parents cannot identify a deleted record's household, the missing context cannot
be reconstructed honestly. Existing malformed legacy receipt relationships are
not silently repaired; downloads require access to every referenced household.

Invitations provide local admin-approved linking, not email delivery/verification.
They expire and become unusable after a claim; individual token revocation before
claiming is not persisted. The exact transfer algorithm, CPU-only PyTorch and
calendar-date parser remain in place.

Desktop UI automation was unavailable because its sandbox helper failed. HTTP,
database-state, byte-content and retrieval assertions were executed; visual UI
confirmation should not be inferred from them.

## Build and Windows startup results

- `npm.cmd run build` passed on the final application code, including the new
  download route and private-storage import configuration.
- With Docker Desktop, both containers and the website stopped,
  `npm.cmd run demo` started Docker, both services, warmed MiniLM and served a
  ready app at `http://127.0.0.1:3000`. A real admin login then succeeded.
- Running the command again detected the existing instance and did not start a
  second website. No existing data was seeded again and no image was rebuilt on
  the unchanged-source restart.
- Ctrl+C stopped the website and released the startup lock. Windows may ask
  `Terminate batch job (Y/N)?`; answering Y finishes the npm command. Containers
  remain available until `docker compose stop` is used.
- The final cold-start check again compared all 17 table fingerprints and the raw
  PDF/SQL hashes with the pre-change baselines. All matched; no verification
  databases remained after cleanup.

The website and this project's Docker services were stopped after verification,
preserving the named database volume. The exact next startup command, from the
project folder, is:

```powershell
npm.cmd run demo
```

## Subsequent report screenshot run

On 2 November 2026, the requested application views were captured and visually
reviewed using an isolated headless Chrome session after the native desktop
capture helper remained unavailable. This later run verifies the presentation of
the listed views, including real admin/member browser sign-in, the bill and
shares, settlement completion and zero outstanding balances, both search modes,
reports and audit history. It does not replace the separate registration and
password API/integration tests with a claim about unperformed browser workflows.

The [screenshot index](screenshots/README.md) records captions, capture provenance,
the separate report household, and preservation of the earlier records. The
test-output image is explicitly a rendering of actual command output, and its raw
transcript is included. The original PDF and database command files are unchanged.
See also [viva notes on the lock and receipt storage](VIVA_LOCKS_AND_RECEIPTS.md).
