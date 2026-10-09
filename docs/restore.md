# Restoring the practice database

Slice H asks for one restore of the practice database to an earlier point, run on Greg's own machine, with what happened written down below. Slice I asks for it again before the first real firm.

Nothing here runs from a cloud session. Every command acts on Cloudflare, so run it on your own machine, logged in to Wrangler (`npx wrangler login`), from the root of this repository.

Before you start, in the same terminal:

```sh
export WRANGLER_SEND_METRICS=false
```

## What a restore does, and does not

- **D1 Time Travel** takes the whole database back to a point in time: every table, the staff log included. It reaches back 30 days on Cloudflare's paid plan, 7 days on the free one.
- **The file stores are not taken back.** Recordings and exports deleted since that point stay deleted.
- So after a restore, the database can hold **customers and firms deleted since that point**, and **calls that say they keep a recording whose file is gone**. Step 7 puts both right.
- Deletes by the clock (a recording at 30 days, an enquiry at 12 months, and so on) come back too. The next daily sweep, at 3:15am, deletes them again, because each period is worked out from the dates in the record.
- Each customer or firm deleted by staff, or by the clock at the end of a firm's 30 days, is noted in the **restore ledger**, under `deletions/` in the practice file store. A restore does not touch it. It holds ids only, and is deleted after 35 days.

## The steps

### 1. Create the practice database, if it is not there yet

`wrangler.jsonc` still has the placeholder id `00000000-0000-0000-0000-000000000000` under `env.practice`. If so:

```sh
npx wrangler d1 create frontline-practice --jurisdiction eu
```

Put the `database_id` it prints into `wrangler.jsonc`, under `env.practice`, `d1_databases`, in place of the placeholder. Then bring it up to date:

```sh
npx wrangler d1 migrations apply DB --env practice --remote
```

If the practice file stores are not there yet:

```sh
npx wrangler r2 bucket create frontline-practice-files --jurisdiction eu
npx wrangler r2 bucket create frontline-practice-calls-in --jurisdiction eu
```

### 2. Put something in it

If practice is deployed and the control room opens: load the demo firm (**Load the example** on the list of firms).

If it is not deployed yet, add one invented firm directly, so there is something to restore:

```sh
npx wrangler d1 execute frontline-practice --env practice --remote \
  --command "INSERT INTO firms (id, name, is_example, created_at) VALUES ('0000000000000000000000test', 'Restore Test Firm', 1, 0)"
```

### 3. Note the time, and count

Wait a minute, then note the time in UTC, to the second: this is **the restore point**.

```sh
date -u +%Y-%m-%dT%H:%M:%SZ
npx wrangler d1 execute frontline-practice --env practice --remote \
  --command "SELECT (SELECT COUNT(*) FROM firms) AS firms, (SELECT COUNT(*) FROM customers) AS customers, (SELECT COUNT(*) FROM history) AS history, (SELECT COUNT(*) FROM staff_log) AS staff_log"
```

### 4. Change something after it

Wait another minute. Then:

- if the demo firm is loaded: in the control room, find **Mrs Patel**, then **Delete this customer**, typing her name
- if not: `npx wrangler d1 execute frontline-practice --env practice --remote --command "UPDATE firms SET name = 'Changed After The Point' WHERE id = '0000000000000000000000test'"`

Count again, with the same command as in step 3.

### 5. Find the point and restore to it

```sh
npx wrangler d1 time-travel info frontline-practice --env practice --timestamp <the restore point>
```

It prints a bookmark for that time. Then:

```sh
npx wrangler d1 time-travel restore frontline-practice --env practice --bookmark <that bookmark>
```

It asks you to confirm, then prints a **bookmark to undo the restore**. Write it down below: restoring to it puts the database back as it was just before.

### 6. Check

Count again. The counts are those of step 3: the change of step 4 is undone. If you deleted Mrs Patel, she is back.

### 7. Put deletions right

Only if practice is deployed. In the control room, open **After a restore** (the link at the foot of the list of firms). Give the restore point in UK time, press **Find**, then **Delete again**.

It deletes again every customer and firm the ledger noted since that point, as the same member of staff, and marks every call whose recording file is gone. The page says how many of each. Count again: Mrs Patel is gone again. The staff log has a `replayed_deletions` row for each.

## What happened

Fill this in when you do it, and keep it with the pull request that next touches this file.

| | |
|---|---|
| Date | |
| Who ran it | |
| Practice database id | |
| Wrangler version (`npx wrangler --version`) | |
| The restore point (UTC) | |
| Bookmark restored to | |
| Bookmark to undo it | |
| Counts at the restore point (firms, customers, history, staff log) | |
| Counts after the change | |
| Counts after the restore | |
| Counts after "Delete again" | |
| How long the restore took | |
| Did anything stop working afterwards? | |
| What surprised you | |
