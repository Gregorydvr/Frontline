# Front-line

The software behind Front-line, which runs admin for small UK trade firms. Read `CLAUDE.md` first, then `docs/build-brief.md` and `docs/decisions.md`. The agreed design is in `reference/example-app/`.

## What you need

- Node 22 or later, which comes with npm.
- To add or update a package, use npm 11: `npx npm@11 install <package>`. npm 10 crashes on one of Vite's optional add-ons. Installing from the lockfile (`npm ci`) works with either. `.npmrc` makes npm record the exact version.

## Set up

```sh
npm ci
```

## Run it on this machine

The first time, make a secret for the address Vapi reports to. It goes in `.dev.vars`, which git ignores:

```sh
echo "VAPI_SECRET=$(openssl rand -hex 32)" > .dev.vars
```

Then:

```sh
npm run dev
```

This brings the local database up to date with `migrations/`, then starts the system at http://localhost:8787. Open http://localhost:8787/health to see the version. Everything runs on this machine, and no account at Cloudflare or any provider is touched.

The first time the system is used, it loads the demo firm: Tidewell Heating, owner Tom, and the example app's sixteen customers and jobs, as records. Open http://localhost:8787/local/example to see it in plain text: each job with its state and its history as the owner would read it, and Done for you on the example's "today", Thursday 15 October 2026. This page and the loading exist only in the version `npm run dev` runs (`src/local.ts`). The deployed copies are built from `src/index.ts` and have neither.

Open http://localhost:8787/local/calls to see the demo firm's Calls & bookings screen on the same day, drawn from the record in the example app's look. Until the owner can log in (slice F), the owner's screens are served only here.

Open http://localhost:8787/local/texts to see the demo firm's texts from the record: what went out, what was not sent and why, and what came in. On this machine no text leaves: a stand-in takes the place of Twilio and sends nothing. `npm run dev` warns that the Twilio secrets are missing; that is expected, since this machine never needs them.

To start again from an empty database, stop `npm run dev`, delete `.wrangler/state`, and run it again. Do this once after an update that changes the demo firm, such as slice C's calls: the demo firm is loaded only into an empty database.

### Watch a call land

While `npm run dev` is running, this sends an example report to the system, the way Vapi does when a call ends. It is a new customer ringing from a landline at 14:47 on the example's "today":

```sh
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:8787/vapi/server \
  -H "Authorization: Bearer $(sed -n 's/^VAPI_SECRET=//p' .dev.vars)" \
  -H "Content-Type: application/json" \
  --data @test/fixtures/vapi/landline-caller.json
```

It prints 200. Refresh http://localhost:8787/local/calls and Mrs Hall's call is at the top. Send it again, and nothing changes: the same report makes one call. Put anything else after `Bearer`, and it prints 401: refused. The other example reports are in `test/fixtures/vapi/`. What to set on a firm's voice agent in Vapi is in `docs/vapi.md`.

### Send an urgent call

Send `test/fixtures/vapi/mr-price-leak.json` the same way. Mr Price rings about a leak, which is on the demo firm's urgent list, so an alert to the owner is made at once. Open http://localhost:8787/local/texts: the alert to Tom is listed as `not_sent (no_wording)`, because the words of the owner's alert are not agreed yet (open question 7 in `docs/decisions.md`), and no text goes without words the firm agreed.

### Run the clock by hand

On a deployed copy the clock runs every minute. On this machine it runs only when asked:

```sh
curl http://localhost:8787/cdn-cgi/local/scheduled
```

It puts the rows of the due list whose time has come on the queue, and the queue's worker runs them. The demo firm has nothing due yet: reminders are written when a visit is booked, which comes with slice E.

Wrangler does contact Cloudflare in two small ways unless told not to:

- It sends usage data. `wrangler.jsonc` turns most of it off; `WRANGLER_SEND_METRICS=false` in your environment turns off the rest.
- It downloads a public file of example request details, at most once every 30 days. `CLOUDFLARE_CF_FETCH_ENABLED=false` stops that.

`.claude/settings.json` sets both for every Claude Code session, cloud or local, because a cloud session must not try to reach Cloudflare. The GitHub check sets both too.

## Check it

```sh
npm run check   # types, lint and every test: this must pass before a push
npm test        # the tests only
```

The tests run inside the Workers runtime against a local database. GitHub runs `npm run check` on every pull request and after every merge to `main`.

## Changing the database

Only `src/record/` talks to the database, and every function there takes the firm. `npm run check` fails if database code or SQL turns up anywhere else, apart from `migrations/` and `test/helpers/db.ts`. A new record function needs its own case in `test/wall.test.ts`, which tries it as another firm; the tests fail until it has one.

Each change is a plain SQL file in `migrations/`, numbered in order. `npx wrangler d1 migrations create DB <name>` makes the next one. The same files are applied in three places:

- in the tests, before each test file
- on this machine, by `npm run dev`
- when deployed, by `npx wrangler d1 migrations apply DB --remote --env practice` (or `--env live`)

## Deploying

Only Greg deploys, from his own machine, and only when he asks. Nothing goes to live unless he says "deploy to live". Before the first deploy of a copy:

1. Create its database, file store and queue, all in the EU:
   - `npx wrangler d1 create frontline-practice --jurisdiction eu`
   - `npx wrangler r2 bucket create frontline-practice-files --jurisdiction eu`
   - `npx wrangler queues create frontline-practice-due --jurisdiction eu`
2. Put the database's id in `wrangler.jsonc`, in place of the zeros under `practice`.
3. Set its secret for Vapi, different for practice and live: `npx wrangler secret put VAPI_SECRET --env practice`. See `docs/vapi.md`.
4. Set its Twilio account and auth token: `npx wrangler secret put TWILIO_ACCOUNT_SID --env practice` and `TWILIO_AUTH_TOKEN` likewise. Put the copy's address in `PUBLIC_ADDRESS` under its environment in `wrangler.jsonc`. See `docs/twilio.md`.

Wrangler 4 creates a missing file store or queue by itself during a deploy. Until step 1 is done, deploy with `--x-provision=false` so nothing is created by accident.

Each copy runs the clock every minute (a cron trigger) and takes its own queue's messages (a queue consumer), both set in `wrangler.jsonc`.
