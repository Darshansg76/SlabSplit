# Report screenshots

Captured on **2 November 2026** from the real local SlabSplit application at
`http://127.0.0.1:3000`, running source commit **916e79e** through `npm.cmd run demo`.
The command reused the already running instance. Application views were captured
in an isolated headless Chrome browser and visually reviewed. No displayed data
was edited or composited into the application screenshots.

| File | Suggested report caption |
| --- | --- |
| [01-login-page.png](01-login-page.png) | SlabSplit sign-in page with self-registration entry point. |
| [02-admin-overview.png](02-admin-overview.png) | Admin dashboard showing the selected household, cycle totals and completed-settlement balances. The sidebar identifies the admin role. |
| [03-member-overview.png](03-member-overview.png) | Asha signed in as a member, viewing her authorized household and its balances. |
| [04-bill-breakdown-and-shares.png](04-bill-breakdown-and-shares.png) | Electricity consumption of 220 units: INR 400 + 600 + 160 + 60 fixed charge = INR 1,220. Occupancy-weighted shares are 484.87, 484.87 and 250.26. |
| [05-settled-transfers-and-payments.png](05-settled-transfers-and-payments.png) | Recorded provider payment and completed transfers. Transfers net the utility bill together with the three shared expenses. |
| [06-search-full-text.png](06-search-full-text.png) | PostgreSQL full-text search for `plumber` retrieves the matching expense description. |
| [07-search-semantic.png](07-search-semantic.png) | MiniLM/pgvector search for `plumbing repair for a leaking faucet` ranks the relevant expense first with cosine similarity 0.683, above unrelated broadband and groceries. |
| [08-reports.png](08-reports.png) | Grouped category totals, inclusive occupancy days 31/31/16, and the above-average expense report. |
| [09-audit-log.png](09-audit-log.png) | Stored bill, payment, expense and settlement events, with actor identity and before/after detail controls. |
| [10-npm-test-output.png](10-npm-test-output.png) | Actual `npm.cmd test` output: 12 passed, zero failed, exit code 0. |

The test-output image is a readable rendering of the actual captured command
transcript, **not a screenshot of a desktop terminal window**. The full unchanged
transcript is included as [npm-test-output.txt](npm-test-output.txt). The native
desktop capture helper was unavailable; this distinction is also stated in the
image itself.

## Demonstration data and preservation

The original `Demo Flat` household still contains the earlier INR 1,060 test bill.
It was not deleted or rewritten for these screenshots. A separate **Report Demo
Flat** household was added, reusing the same Asha, Dev and Mira occupant rows
through new occupancy records. It has an October 1–31, 2026 cycle and the same
electricity tariff and move-in dates as the documented example.

For useful report/search content, the report household includes:

- INR 90 plumbing repair, shared on October 31;
- INR 60 groceries, shared on October 31;
- INR 300 recurring broadband, shared by occupied days.

These three expenses total INR 450. Asha paid the INR 1,220 provider bill and all
three expenses. The completed net transfers are Dev to Asha **INR 654.10** and Mira
to Asha **INR 361.80**. All three displayed outstanding balances are zero after
completion. These are entered demo records, not bank-verified or real transfers.

Actual browser sign-in was performed separately as `admin` and `asha`. UI values,
the relevant search ranking and zero final outstanding balances were asserted
during capture; no browser page errors occurred. Every pre-existing database row
was fingerprinted before/after and remained unchanged. Only the separate report
dataset was added and completed. No schema, PDF or database command file changed.

The screenshots contain demonstration records and no login passwords, session
secrets, database credentials, or private browser profile data. The local report
dataset remains available for reproducing the screenshots and viva rehearsal.
