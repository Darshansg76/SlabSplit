# Viva notes: advisory lock and private receipts

## Transaction advisory lock

**Short answer:** We use a PostgreSQL transaction advisory lock to make competing
application changes take turns. It prevents a settlement from being completed at
the same time another request changes the records used to calculate it.

`lib/db.js` begins a transaction and executes:

```sql
SELECT pg_advisory_xact_lock(73781,1);
```

The numbers identify our application's shared lock. They are not a password or
database row ID. Every cooperative application mutation uses the same key, so
only one such transaction can hold it at a time. The lock is released
automatically when the transaction commits or rolls back.

For example, consider a source edit racing with "Mark settled":

1. If the source edit obtains the lock first, it cancels the pending suggestions.
   The later settlement request sees a cancelled suggestion and refuses it.
2. If completion obtains the lock first, it records the completed transfer.
   The later source edit sees completed money and refuses to invalidate it.

The same ordering helps concurrent payments check the latest unpaid amount and
keeps competing occupancy checks from both accepting overlapping periods.
Transactions also make multi-row changes atomic: if any step fails, the changes
and any pending-suggestion cancellation roll back together.

**Why this approach?** The original PDF's database definitions are fixed. This is
an application query using an existing PostgreSQL feature; it does not alter a
table, constraint, enum, trigger or view. It is deliberately simple for a small
household project.

**Limitation:** Advisory locks are cooperative. Someone writing directly through
SQL can bypass the application protocol. A database exclusion constraint or new
integrity constraint would enforce a different boundary, but adding it would
require approval under the fixed PDF contract. One application-wide lock also
serializes unrelated household writes; that throughput tradeoff is acceptable
for this local mini-project and can be revisited if the application grows.

## Private receipt storage

**Short answer:** The database stores receipt metadata and its association with a
bill or expense. The actual PDF/image stays in a private disk directory. A server
route checks the logged-in user's household access before returning its bytes.

New files go into **`storage/receipts`**, outside Next.js's `public` directory.
Upload validation checks the byte signature for PDF, PNG or JPEG, applies the
5 MB limit, and assigns a generated filename. It does not trust only the MIME
label supplied by the browser.

The original `/uploads/<filename>` URLs still work. Startup preserves old public
files by moving them into private storage without overwriting their contents.
Nonstandard legacy entries remain preserved in a private import folder for
review. This move is necessary: testing found that an encoded public URL could
bypass a rewrite-only protection scheme.

Before serving a download, the route:

1. Validates the signed session and active account.
2. Looks up the receipt metadata for that file URL.
3. Resolves the linked bill/expense household and checks the user's access.
   For a legacy record with multiple targets, access is required to every target.
4. Rejects unsafe filenames and paths outside private storage.
5. Sends the file with `private, no-store`, `nosniff` and attachment headers.

Thus, an anonymous visitor or a member of another household cannot download a
receipt merely by learning its URL. Existing legitimate URLs remain usable.

**Backups:** A PostgreSQL dump contains metadata and stored text/embeddings, but
not the actual receipt PDFs/images. Back up the private receipt folder separately.
The PDF's receipt table and foreign keys were preserved; this security change is
in application storage, routing and authorization.
