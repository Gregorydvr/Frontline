// Deliberate mistakes, for the check in eslint.config.js that keeps the
// database inside src/record/ (rule 8 in CLAUDE.md). Nothing runs this file:
// lint reads it.
//
// Each mistake carries a comment that turns its rule off for the next line.
// A comment that turns off nothing fails `npm run check`, so if the check
// ever stops catching one of these, the check goes red.

export async function mistakes(db: D1Database, maybe: D1Database | undefined): Promise<unknown[]> {
  // eslint-disable-next-line frontline/database-outside-record, frontline/sql-outside-record -- deliberate
  await db.prepare('SELECT name FROM customers WHERE mobile = ?').bind('+447700900003').all();

  // eslint-disable-next-line frontline/database-outside-record -- deliberate
  await db.batch([]);

  // eslint-disable-next-line frontline/database-outside-record -- deliberate: a session is the database too
  await db.withSession('first-primary').batch([]);

  // eslint-disable-next-line frontline/database-outside-record -- deliberate: so is one that might be missing
  await maybe?.exec('');

  // eslint-disable-next-line frontline/database-outside-record, @typescript-eslint/unbound-method -- deliberate
  const { prepare } = db;

  const table = 'jobs';
  // eslint-disable-next-line frontline/sql-outside-record -- deliberate: SQL waiting to be used
  const sql = `DELETE FROM ${table} WHERE firm_id = ?`;
  // eslint-disable-next-line frontline/sql-outside-record -- deliberate
  const insert = 'INSERT INTO history (id) VALUES (?)';
  // eslint-disable-next-line frontline/sql-outside-record -- deliberate
  const change = 'UPDATE firms SET stopped = 1';
  // eslint-disable-next-line frontline/sql-outside-record -- deliberate
  const make = 'CREATE TABLE notes (id TEXT)';
  return [prepare, sql, insert, change, make];
}

// Not mistakes: these must pass, so the check does not get in the way of
// ordinary words, or of other things called exec.
export function notMistakes(text: string): string[] {
  const words = [
    'Select a time from the list.',
    'Delete them from the control room.',
    'Update the firm’s settings.',
    'Insert into the diary.',
  ];
  const found = /\d+/.exec(text);
  return found === null ? words : [...words, found[0]];
}
