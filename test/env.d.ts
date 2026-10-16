// Bindings that exist only in tests. vitest.config.ts adds them.

declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: import('cloudflare:test').D1Migration[];
    TEST_FIXTURE_MIGRATIONS: import('cloudflare:test').D1Migration[];
    /** Stripe's signing secret, made up afresh for each run. */
    STRIPE_WEBHOOK_SECRET: string;
  }
}
