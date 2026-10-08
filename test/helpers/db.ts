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
