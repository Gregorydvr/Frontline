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
- `npm run dev`: the system on this machine, with the invented data. It applies `migrations/` to the local database first, and loads the demo firm the first time it is used. http://localhost:8787/local/example shows the demo firm in plain text.
- `npm run types`: rewrites `worker-configuration.d.ts` after a change to `wrangler.jsonc`.
- `npm run check:screens`: the owner's screens in a real browser at 390 by 844 and 1280 by 800: no sideways scroll, nothing under 44px, nothing cut off, no accessibility failures (axe-core). Saves screenshots in `screens/`, beside the example's. GitHub runs it after `npm run check`.

To add or update a package, use `npx npm@11 install`. npm 10 crashes on one of Vite's optional add-ons. `npm ci` works with either. `.npmrc` makes npm record exact versions.

`.claude/settings.json` sets `WRANGLER_SEND_METRICS=false` and `CLOUDFLARE_CF_FETCH_ENABLED=false` for every Claude Code session, so that Wrangler does not try to reach Cloudflare. Keep them.

## Layout

```
src/                 the Worker
  index.ts           entry point: builds the real dependencies and hands requests to the app
  app.ts             createApp(): the routes, and the error handler that logs ids only
  owner-app.ts       the owner's app: logging in by a link sent by text, and the owner's screens, each taking the firm from the login
  control-room.ts    the control room, for Front-line's staff: at its own address, behind the staff gate, every view and action in the staff log
  deps.ts            Deps: what the system is given from outside: the clock, the texts provider, the due list's queue, the staff gate,
                     which copy this is, the addresses of customers' links, the owner's app and the control room, and the file stores
  clock.ts           Instant, Clock, systemClock (the only reader of the system time), pretendClock, startingAt for this machine,
                     and aheadBy for an example firm's own clock
  money.ts           Pence, pence(), formatMoney()
  ids.ts             Id, newId(), isId()
  log.ts             log(): the only writer to the console, ids only
  london.ts          reads an instant as UK time (Europe/London), and turns a UK date and time into an instant
  phone.ts           UK mobiles and landlines, kept as +447700900001 and +441632960001
  secret.ts          shared secrets, such as the token Vapi sends, compared safely
  vapi-report.ts     reads Vapi's report as a call ends, checking every field
  vapi-tools.ts      reads Vapi's tool calls during a call (free times, book), checking every field
  booking.ts         answers the voice agent's two tools: free times, and holding one for the call
  land-call.ts       a call lands in the record: the firm, the customer, a job, the call and its history
  job-state.ts       a job's state, worked out from its records
  history-lines.ts   the words for each kind of history entry, and the line the owner reads
  words.ts           other labels the owner reads: services, job states, who did it
  gsm.ts             the GSM-7 check for texts, the segment count, and making a caller's words fit for a text
  firm-export.ts     the zip of one firm's records: everything.json, spreadsheets, and the recordings kept
  zip.ts             writing zip files a piece at a time, and CSV rows that never run as a formula
  messages.ts        the draft wording of each kind of text, and making a text from a firm's wording and the facts
  send.ts            send(): the one way a text leaves (rules 1 to 4)
  due.ts             the clock: every minute due rows go on the queue; the worker that claims, acts and marks them done
  diary/             the diary interface, Front-line's own diary behind it, and which times a firm offers (times.ts)
  local.ts           the Worker as `npm run dev` runs it, with the stand-in for texts and a clock that starts at the example's "today": loads the demo firm, adds /local/example, /local/login, /local/texts, /local/book and /local/files, and the stand-in for the staff gate. Never deployed
  record/            the only code that touches the database. index.ts lists every record function. control.ts is the control room's;
                     erase.ts the one list of what each delete removes (a customer, an enquiry, a firm); example.ts moves the demo
                     firm's clock and resets it. files.ts is the only code that touches the file stores (FILES, and the inbox
                     CALLS_IN), with the restore ledger; keeping.ts moves and deletes recordings and runs each firm's daily sweep;
                     periods.ts holds every period; firm-file.ts a firm's export, leaving and delete
  screens/           the owner's screens in the example's look, drawn from the record: shell.ts (the frame and side menu),
                     home, job, jobs, calls, done, rules, message, login; look.ts holds the example's styles and icons;
                     app-script.ts the one small script. details.ts is the customer's confirm-your-details page, opened from their link.
                     control.ts is the control room's screens
  example/           the demo firm, Tidewell Heating, as data, and its loader
  providers/         one folder per provider, each with a fake. texts/: the interface, the stand-in, and Twilio.
                     access/: the staff gate, the check of Cloudflare Access's note, and the stand-in
migrations/          plain SQL, numbered 0001_name.sql, applied in tests, on this machine and when deployed
test/                the tests, which run in the Workers runtime
  setup.ts           applies migrations/ before each test file
  helpers/db.ts      the one place a test reads the database directly
  helpers/vapi.ts    sends the example Vapi reports to the system, as Vapi does
  helpers/twilio.ts  sends the example Twilio requests to the system, signed as Twilio signs them
  helpers/deps.ts    pretend dependencies: the pretend clock, the stand-in for texts, a queue that keeps what it is given
  helpers/owner.ts   logs an owner in, and opens the app's pages as them
  helpers/control.ts opens the control room's pages as the stand-in member of staff
  helpers/files.ts   the local file stores, and a wrapper that makes one step fail on purpose
  wall.test.ts       the cross-firm tests: every record function, tried as another firm
  routes.test.ts     every route, with its cross-firm case or the reason it needs none
  fixtures/          files the tests read
  fixtures/vapi/     example reports from Vapi as a call ends, and tool calls during one, with invented people
  fixtures/twilio/   example requests from Twilio: a text coming in, delivery reports
  fixtures/lint/     deliberate mistakes that show the checks in lint still work
scripts/screens.js   npm run check:screens
docs/                the build brief, the decisions, what to set in Vapi (vapi.md), Twilio (twilio.md) and Cloudflare Access (access.md),
                     the restore steps (restore.md), and when a firm leaves (firm-leaving.md)
docs/screens/        screenshots beside the example's, kept with the pull request that took them
reference/           the example app: read-only
wrangler.jsonc       the Worker's config: this machine at the top level, then practice and live
worker-configuration.d.ts   generated by `npm run types`; do not edit
.github/workflows/   the check GitHub runs on every pull request and every push to main; actions pinned to commits
.claude/settings.json   settings for every Claude Code session: the two Wrangler variables above
```

Lint enforces five of the rules: nothing outside `src/send.ts` and `src/providers/texts/` hands a text to a provider (1), nothing outside `src/clock.ts` reads the system time (19), nothing outside `src/log.ts` (and the `scripts/` run on this machine) writes to the console (11), nothing outside `src/record/` (and `test/helpers/db.ts`) uses the database or holds SQL, and nothing outside `src/record/files.ts` (and `test/helpers/files.ts`) uses a file store (8), and nothing uses `Math.random`.
