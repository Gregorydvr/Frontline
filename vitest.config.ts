import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Tests run inside workerd, the Workers runtime, with the bindings from the top
// level of wrangler.jsonc: a local D1 database, file store and queue. Storage
// is kept apart between test files.
//
// Vapi's secret is made up afresh for each run, so no secret is written down
// anywhere in the repository (rule 12 in CLAUDE.md).
const testSecret = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
  byte.toString(16).padStart(2, '0'),
).join('');

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          // The same files `wrangler d1 migrations apply` reads. test/setup.ts
          // applies them before each test file.
          TEST_MIGRATIONS: await readD1Migrations('migrations'),
          // Only for the test that the way migrations are applied works.
          TEST_FIXTURE_MIGRATIONS: await readD1Migrations('test/fixtures/migrations'),
          VAPI_SECRET: testSecret,
        },
      },
    })),
  ],
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
  },
});
