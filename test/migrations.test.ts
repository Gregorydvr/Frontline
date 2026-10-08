import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { appliedMigrations, tableNames } from './helpers/db';

describe('migrations', () => {
  it('has applied every file in migrations/ before the tests run', async () => {
    const files = env.TEST_MIGRATIONS.map((migration) => migration.name);
    expect(await appliedMigrations(env.DB)).toEqual(files);
  });

  it('applies a new migration once, records it, and skips it the second time', async () => {
    const before = await appliedMigrations(env.DB);

    await applyD1Migrations(env.DB, env.TEST_FIXTURE_MIGRATIONS);
    expect(await appliedMigrations(env.DB)).toEqual([...before, '0001_example.sql']);
    expect(await tableNames(env.DB)).toContain('example');

    await applyD1Migrations(env.DB, env.TEST_FIXTURE_MIGRATIONS);
    expect(await appliedMigrations(env.DB)).toEqual([...before, '0001_example.sql']);
  });
});
