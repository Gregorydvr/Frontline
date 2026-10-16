import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Tests run inside workerd, the Workers runtime, with the bindings from the top
// level of wrangler.jsonc: a local D1 database, file store and queue. Storage
// is kept apart between test files.
//
// Vapi's secret and Twilio's account are made up afresh for each run, so no
// secret is written down anywhere in the repository (rule 12 in CLAUDE.md).
const randomHex = (bytes: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('');
const testSecret = randomHex(32);

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
          TWILIO_ACCOUNT_SID: `AC${randomHex(16)}`,
          TWILIO_AUTH_TOKEN: randomHex(16),
          // Stripe's signing secret for the events it sends (task 2 of queue 3).
          STRIPE_WEBHOOK_SECRET: `whsec_${randomHex(24)}`,
        },
      },
    })),
  ],
  test: {
    include: ['test/**/*.test.ts'],
    // At most four test files at once, each in its own Workers runtime with
    // its own local database. Vitest would otherwise run one per processor
    // thread, 19 on Greg's machine, and so many runtimes at once slow every
    // test, the longest past their time limit, without finishing the run any
    // sooner: measured on 16 Oct 2026, from 4 to 20 at once the whole run took
    // about the same time, while the slowest tests took up to three times as
    // long. GitHub's machine has 4 threads, so it runs about as many as before.
    maxWorkers: 4,
    setupFiles: ['./test/setup.ts'],
  },
});
