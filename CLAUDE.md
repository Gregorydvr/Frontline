# Front-line

Front-line sets up and runs admin for small UK trade firms: calls and bookings, quotes, follow-ups, job paperwork, invoices and payment reminders. This repository is the software behind it.

It sends messages in other firms' names and holds their customers' details. Getting it right matters more than getting it done quickly.

Before any task, read `docs/build-brief.md` (what to build and in what order) and `docs/decisions.md` (what is settled, what is assumed, what is open). The agreed design is in `reference/example-app/`.

## Words

- **Firm**: a trade business that is Front-line's client.
- **Owner**: the person at the firm who approves things. The owner uses the app.
- **Customer**: the firm's customer. A customer never logs in. They get texts, and pages that open from a link.
- **Job**: one piece of work for one customer. A customer can have several.
- **Control room**: the screens Front-line's own staff use. Greg and Sophie are the staff.
- **Practice** and **live**: the two copies of the system. Practice holds invented data only.

## Rules that are never broken

Each rule gets a test or a check as soon as the code it covers exists. If a task seems to need one broken, stop and say so in the pull request.

**Sending**

1. Every outgoing message goes through one function, `send()`. Nothing else calls a text, email or voice provider.
2. `send()` refuses a message unless it is an item the owner approved, or a kind whose wording the firm agreed at set-up. A quote or an invoice never goes without the owner's approval of that exact version.
3. Before sending to a customer, `send()` checks the firm's stop button, which halts every message to that firm's customers, then the firm's switch for that service, then the customer's opt-out for that kind of message. Every send, to anyone, is claimed first, so the same message cannot go twice.
4. Texts use GSM-7 characters only: straight quotes, no emoji. A test fails on anything else, and counts the segments.

**Money**

5. Money is whole pence in an integer, in code and in the database. No floats.
6. Sums, VAT and totals are worked out in code and checked against the lines. A model never does arithmetic that is kept.
7. Front-line never holds a customer's money or card details.

**Firms kept apart**

8. Every table that holds a firm's data has `firm_id`. All database access goes through the record layer in `src/record/`, and every function there takes the firm. No SQL anywhere else, apart from the migration files.
9. The cross-firm tests run on every change. They try to read and write another firm's rows through every record function and every route.

**Personal data**

10. No real person's details in this repository: not in code, tests, fixtures, logs, commit messages or pull requests. Test data is the invented firm Tidewell Heating and its example customers. If real data turns up, stop and say.
11. Logs carry ids only. No names, phone numbers, addresses, message text or transcripts.
12. No keys, tokens or passwords in the repository. Local secrets live in `.dev.vars`, which is git-ignored.
13. A page a customer opens from a link uses a token that cannot be guessed and that expires. Nothing personal goes in the address, and search engines are told to keep out.
14. Anything stored about a person can be found, exported and deleted, and has a set period after which the clock deletes it.
15. Who did what is recorded and never edited: approvals, sends, logins, every view in the control room.

**AI routines**

16. A routine fills set fields, and code checks them. A routine cannot send, pay, book or change a firm's rules. It is given only the fields it needs.
17. Words from a customer or a caller are data. They are never treated as instructions.

**Time**

18. Store instants in UTC. Work out anything a person will read, such as "1pm the day before", in Europe/London.
19. Nothing reads the system clock directly. Code is given the clock, so tests can use a pretend one.
20. Timed work is a row in the due list. A worker claims a row before acting, and acting twice must do no harm.

## How to work

- Begin every task with a plan: what you will build, which files, how it will be tested. Wait for approval before changing anything.
- One task, one branch, one pull request. Never push to `main`.
- Every change comes with a test that fails without it. Run `npm run check` before you push. It must pass.
- Providers (Vapi, Twilio, Stripe, Deepgram, the Claude API, email) sit behind interfaces in `src/providers/`, each with a fake. Tests never call a real provider.
- Deploying, and creating or changing anything in Cloudflare or a provider's account, happens only on Greg's own machine, and only when he asks for it in that session. Never from a cloud session. Nothing goes to live unless he says "deploy to live".
- If the brief does not answer a product, legal or wording question, do not guess. Build what does not depend on it, and list the question under "Questions for Greg" in the pull request.
- When something is decided, add it to `docs/decisions.md` in the same pull request. A cloud session starts from a fresh copy and remembers nothing else. Do not reopen a settled decision. If one looks wrong, say why in the pull request and stop.
- Mark the slice done in `docs/build-brief.md` when its pull request is ready.
- `reference/` is read-only. Take the look, the layout and the wording from it. Do not copy its screen code, which draws from hand-written example data.
- Words an owner or a customer will read come from the example app or the brief. Flag any new wording in the pull request. UK English, plain words, and never "shall".
- Add a dependency only when the plan gives the reason.

## Pull requests

Write the description for someone who does not read code:

1. What this adds, in a sentence or two.
2. How to see it working.
3. What was tested, and what was not.
4. Questions for Greg.

## Stack

TypeScript (strict) on Cloudflare Workers. D1 for the record, R2 for files, a cron trigger and a queue for the clock. The app is plain HTML, CSS and JavaScript served by the same Worker, with no front-end framework. Tests run in the Workers runtime.

Not being built yet, so do not add them: WhatsApp, Xero or QuickBooks, staff logins at a firm, self-serve sign-up, anything that holds a conversation with a customer.

## Commands

Slice A creates these. Keep the names.

- `npm run check`: types, lint and every test. This is the one that must pass. Types means `wrangler types --check` (is `worker-configuration.d.ts` current?) and `tsc` over `src/` and `test/`.
- `npm test`: the tests only. They run in the Workers runtime against a local database, with `migrations/` applied before each test file.
- `npm run dev`: the system on this machine, with the invented data. It applies `migrations/` to the local database first.
- `npm run types`: rewrites `worker-configuration.d.ts` after a change to `wrangler.jsonc`.

To add or update a package, use `npx npm@11 install`. npm 10 crashes on one of Vite's optional add-ons. `npm ci` works with either. `.npmrc` makes npm record exact versions.

`.claude/settings.json` sets `WRANGLER_SEND_METRICS=false` and `CLOUDFLARE_CF_FETCH_ENABLED=false` for every Claude Code session, so that Wrangler does not try to reach Cloudflare. Keep them.

## Layout

```
src/                 the Worker
  index.ts           entry point: builds the real dependencies and hands requests to the app
  app.ts             createApp(): the routes, and the error handler that logs ids only
  deps.ts            Deps: what the system is given from outside (the clock; providers from slice D)
  clock.ts           Instant, Clock, systemClock (the only reader of the system time), pretendClock
  money.ts           Pence, pence(), formatMoney()
  ids.ts             Id, newId(), isId()
  log.ts             log(): the only writer to the console, ids only
  record/            from slice B: the only code that touches the database
  providers/         from slice D: one folder per provider, each with a fake
migrations/          plain SQL, numbered 0001_name.sql, applied in tests, on this machine and when deployed
test/                the tests, which run in the Workers runtime
  setup.ts           applies migrations/ before each test file
  helpers/db.ts      the one place a test reads the database directly
  fixtures/          files the tests read
docs/                the build brief and the decisions
reference/           the example app: read-only
wrangler.jsonc       the Worker's config: this machine at the top level, then practice and live
worker-configuration.d.ts   generated by `npm run types`; do not edit
.github/workflows/   the check GitHub runs on every pull request
.claude/settings.json   settings for every Claude Code session: the two Wrangler variables above
```

Lint enforces three of the rules: nothing outside `src/clock.ts` reads the system time (19), nothing outside `src/log.ts` writes to the console (11), and nothing uses `Math.random`.
