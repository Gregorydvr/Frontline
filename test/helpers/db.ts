// The one place a test reads the database directly. Application code reaches
// the database only through src/record/ (rule 8 in CLAUDE.md).

export async function appliedMigrations(db: D1Database): Promise<string[]> {
  const { results } = await db
    .prepare('SELECT name FROM d1_migrations ORDER BY id')
    .all<{ name: string }>();
  return results.map((row) => row.name);
}

export async function tableNames(db: D1Database): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all<{ name: string }>();
  return results.map((row) => row.name);
}

/** The tables Front-line made, leaving out SQLite's, D1's and the migrations list. */
export async function recordTables(db: D1Database): Promise<string[]> {
  const names = await tableNames(db);
  return names.filter((name) => !/^(sqlite_|_cf_|d1_migrations$)/.test(name));
}

export interface Column {
  name: string;
  notnull: number;
}

export async function tableColumns(db: D1Database, table: string): Promise<Column[]> {
  const { results } = await db.prepare('SELECT name, "notnull" FROM pragma_table_info(?)').bind(table).all<Column>();
  return results;
}

/**
 * Every row that belongs to a firm, in every table, so a test can show that
 * something done as another firm left this one exactly as it was.
 */
export async function firmRows(db: D1Database, firm: string): Promise<Record<string, unknown[]>> {
  const rows: Record<string, unknown[]> = {};
  for (const table of await recordTables(db)) {
    const column = table === 'firms' ? 'id' : 'firm_id';
    // Staff belong to no firm.
    if (!(await tableColumns(db, table)).some((one) => one.name === column)) continue;
    // Table names come from the database itself, not from a caller.
    const { results } = await db
      .prepare(`SELECT * FROM "${table}" WHERE ${column} = ? ORDER BY rowid`)
      .bind(firm)
      .all();
    rows[table] = results;
  }
  return rows;
}

/** Tries to change a history entry, which the database must refuse. */
export async function tryToEditHistory(db: D1Database, id: string): Promise<void> {
  await db.prepare("UPDATE history SET kind = 'stop_on' WHERE id = ?").bind(id).run();
}

/** Writes a job straight into the database, past the record layer, to show the database's own wall. */
export async function insertJobPastTheRecord(
  db: D1Database,
  job: { id: string; firm: string; customer: string },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO jobs (id, firm_id, customer_id, about, place, urgent, created_at)
       VALUES (?, ?, ?, 'Leak under the sink', '6 Bridge Street', 0, 0)`,
    )
    .bind(job.id, job.firm, job.customer)
    .run();
}

/**
 * Writes a version of the words for a reminder straight into the database,
 * past the record layer, naming an owner as agreeing them, or none, to show
 * the database's own check of rule 2.
 */
export async function insertWordingPastTheRecord(
  db: D1Database,
  wording: { id: string; firm: string; agreedBy: string | null },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO wording (id, firm_id, key, words, at, seq, actor, agreed_owner_id, agreed_at, agreed_how)
       VALUES (?1, ?2, 'text:visit_reminder', 'Reminder: {time}.', 0, (SELECT IFNULL(MAX(seq), 0) + 1 FROM wording), 'frontline', ?3,
               CASE WHEN ?3 IS NULL THEN NULL ELSE 0 END, CASE WHEN ?3 IS NULL THEN NULL ELSE 'phone' END)`,
    )
    .bind(wording.id, wording.firm, wording.agreedBy)
    .run();
}

/** How many firms the record holds. */
export async function countFirms(db: D1Database): Promise<number> {
  return (await db.prepare('SELECT COUNT(*) AS n FROM firms').first<{ n: number }>())?.n ?? 0;
}

/** How many history entries of each kind a firm has. */
export async function historyKinds(db: D1Database, firm: string): Promise<Record<string, number>> {
  const { results } = await db
    .prepare('SELECT kind, COUNT(*) AS n FROM history WHERE firm_id = ? GROUP BY kind ORDER BY kind')
    .bind(firm)
    .all<{ kind: string; n: number }>();
  return Object.fromEntries(results.map((row) => [row.kind, row.n]));
}

/** Writes a call straight into the database, past the record layer, to show the database's own wall. */
export async function insertCallPastTheRecord(
  db: D1Database,
  call: { id: string; firm: string; customer: string | null; job: string | null; providerCallId: string },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO calls (id, firm_id, provider, provider_call_id, started_at, customer_id, job_id, outcome, created_at)
       VALUES (?, ?, 'vapi', ?, 0, ?, ?, 'message', 0)`,
    )
    .bind(call.id, call.firm, call.providerCallId, call.customer, call.job)
    .run();
}

/** Writes a history entry naming a call straight into the database, past the record layer. */
export async function insertCallEntryPastTheRecord(
  db: D1Database,
  entry: { id: string; firm: string; call: string; customer: string | null; job: string | null },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO history (id, firm_id, at, seq, actor, kind, customer_id, job_id, call_id)
       VALUES (?, ?, 0, (SELECT IFNULL(MAX(seq), 0) + 1 FROM history), 'frontline', 'call_answered', ?, ?, ?)`,
    )
    .bind(entry.id, entry.firm, entry.customer, entry.job, entry.call)
    .run();
}

/** The kinds of text a customer is opted out of by their own STOP, which a START undoes. */
export async function optOutsMadeByStop(db: D1Database, customer: string): Promise<string[]> {
  const { results } = await db
    .prepare('SELECT kind FROM opt_outs WHERE customer_id = ? AND by_stop = 1 ORDER BY kind')
    .bind(customer)
    .all<{ kind: string }>();
  return results.map((row) => row.kind);
}

/** Every row of the staff log, oldest first. */
export async function staffLogRows(db: D1Database): Promise<Record<string, unknown>[]> {
  const { results } = await db.prepare('SELECT * FROM staff_log ORDER BY seq').all();
  return results;
}

/**
 * Every row, in every table, that holds any of the markers: an id, a name, a
 * number, words. A table added later is read too. Rows of the firm only,
 * where the table has a firm; a table with no firm, such as staff, is read
 * whole.
 */
export async function rowsHolding(
  db: D1Database,
  firm: string,
  markers: readonly string[],
): Promise<{ table: string; row: Record<string, unknown> }[]> {
  const found: { table: string; row: Record<string, unknown> }[] = [];
  for (const table of await recordTables(db)) {
    const columns = (await tableColumns(db, table)).map((column) => column.name);
    const column = table === 'firms' ? 'id' : columns.includes('firm_id') ? 'firm_id' : null;
    // Table names come from the database itself, not from a caller.
    const { results } = await (column === null
      ? db.prepare(`SELECT * FROM "${table}"`)
      : db.prepare(`SELECT * FROM "${table}" WHERE ${column} = ?`).bind(firm)
    ).all();
    for (const row of results) {
      const cells = Object.values(row).filter((cell): cell is string => typeof cell === 'string');
      if (markers.some((marker) => cells.some((cell) => cell.includes(marker)))) {
        found.push({ table, row });
      }
    }
  }
  return found;
}

/** Tries to change and to delete rows the database must keep: a history entry, and a row of the staff log. */
export async function tryToDeleteHistory(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM history WHERE id = ?').bind(id).run();
}

export async function tryToEditStaffLog(db: D1Database, id: string): Promise<void> {
  await db.prepare("UPDATE staff_log SET what = 'viewed_firm' WHERE id = ?").bind(id).run();
}

export async function tryToDeleteStaffLog(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM staff_log WHERE id = ?').bind(id).run();
}

/** Tries to move a firm's clock past the record layer, which the database refuses for a firm that is not an example. */
export async function tryToMoveClock(db: D1Database, firm: string): Promise<void> {
  await db.prepare('UPDATE firms SET clock_ahead = 86400000 WHERE id = ?').bind(firm).run();
}

/** The firm's rows in the due list that do one thing, such as its daily sweep, oldest first. */
export async function dueRowsFor(db: D1Database, firm: string, action: string): Promise<Record<string, unknown>[]> {
  const { results } = await db.prepare('SELECT * FROM due WHERE firm_id = ? AND action = ? ORDER BY created_at, rowid').bind(firm, action).all();
  return results;
}

/** Writes a second waiting sweep for a firm straight into the database, which must refuse it. */
export async function insertSweepPastTheRecord(db: D1Database, firm: string, id: string): Promise<void> {
  await db
    .prepare(`INSERT INTO due (id, firm_id, action, run_at, latest_at, state, created_at) VALUES (?, ?, 'sweep', 0, 0, 'waiting', 0)`)
    .bind(id, firm)
    .run();
}

/** Tries to delete a row of the list of deleted firms, which the database must refuse. */
export async function tryToDeleteDeletedFirm(db: D1Database, firm: string): Promise<void> {
  await db.prepare('DELETE FROM deleted_firms WHERE firm_id = ?').bind(firm).run();
}

/**
 * Writes many calls from people who were not customers straight into the
 * database, a hundred at a time, as a year of a busy firm's calls: each
 * with a transcript, from `from` on, an hour apart.
 */
export async function insertManyCallsPastTheRecord(db: D1Database, firm: string, count: number, from: number, transcript: string): Promise<void> {
  for (let start = 0; start < count; start += 100) {
    const statements: D1PreparedStatement[] = [];
    for (let at = start; at < Math.min(count, start + 100); at += 1) {
      statements.push(
        db
          .prepare(
            `INSERT INTO calls (id, firm_id, provider, provider_call_id, started_at, ended_at, from_number, outcome, caller, summary, transcript, created_at)
             VALUES (?1, ?2, 'vapi', ?1, ?3, ?3, '+447700900300', 'message', 'a supplier', 'Your order is ready to collect.', ?4, ?3)`,
          )
          .bind(`year-${firm}-${String(at).padStart(5, '0')}`, firm, from + at * 3_600_000, transcript),
      );
    }
    await db.batch(statements);
  }
}

/**
 * Puts a firm's rows back as they were when `snapshot` was taken by
 * firmRows(), as a restore of the database to that point does: rows deleted
 * since are written again, and a call's recording is as it was then. Rows
 * still there are left. Tables are written in the order their links need.
 */
export async function putBackAsARestore(db: D1Database, snapshot: Record<string, unknown[]>): Promise<void> {
  const order = ['firms', 'owners', 'wording', 'customers', 'jobs', 'visits', 'calls', 'holds', 'opt_outs', 'opted_out_numbers', 'texts_in', 'due', 'links', 'login_links', 'sessions', 'messages', 'owner_messages', 'firm_exports', 'history'];
  for (const table of order) {
    for (const row of (snapshot[table] ?? []) as Record<string, unknown>[]) {
      const columns = Object.keys(row);
      // Table and column names come from the database itself, not from a caller.
      await db
        .prepare(`INSERT OR IGNORE INTO "${table}" (${columns.map((column) => `"${column}"`).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
        .bind(...columns.map((column) => row[column] ?? null))
        .run();
    }
  }
  for (const row of (snapshot.calls ?? []) as Record<string, unknown>[]) {
    await db
      .prepare('UPDATE calls SET recording_state = ?, recording_key = ?, recording_from = ?, recording_gone_at = ? WHERE id = ?')
      .bind(row.recording_state ?? 'none', row.recording_key ?? null, row.recording_from ?? null, row.recording_gone_at ?? null, row.id)
      .run();
  }
}
