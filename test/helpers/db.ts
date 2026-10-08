// The one place a test reads the database directly. Application code reaches
// the database only through src/record/ (rule 8 in CLAUDE.md, from slice B).

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
