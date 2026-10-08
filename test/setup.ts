// Runs before each test file: brings the test database up to date with
// migrations/, the same way `wrangler d1 migrations apply` does.

import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
