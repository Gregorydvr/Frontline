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

### Open the owner's app

On this machine the clock starts at the example's "today", Thursday 15 October 2026 at 4pm, when `npm run dev` starts, and runs on from there, so the demo firm looks as it does in the example. Practice and live use the real clock.

Open http://localhost:8787/local/login and press **Send Tom a login link**. It sends Tom, the demo firm's owner, a link by text, the same way the login page does, to the stand-in for texts, then shows you the text and its link. Open the link and press **Log in**. You are on Home.

Or log in the way an owner does: open http://localhost:8787/login, type Tom's mobile, `07700 900101`, and press **Text me a link**. The link is in the text listed at http://localhost:8787/local/texts.

From Home:

| Address | Screen |
|---|---|
| http://localhost:8787/ | Home |
| http://localhost:8787/calls | Calls & bookings |
| http://localhost:8787/jobs | All jobs, with the find box. Any row opens the job's page |
| http://localhost:8787/done | Done for you |
| http://localhost:8787/rules | Your rules |
| http://localhost:8787/message | Message us |

To see the phone size, use your browser's phone view at 390 by 844. From 960px wide the side menu shows, as in the example. A login lasts 30 days unused, and 90 days at most; **Log out** is at the bottom of Home.

Open http://localhost:8787/local/texts to see the demo firm's texts from the record: what went out, what was not sent and why, and what came in. On this machine no text leaves: a stand-in takes the place of Twilio and sends nothing. `npm run dev` warns that the Twilio secrets are missing; that is expected, since this machine never needs them.

To start again from an empty database, stop `npm run dev`, delete `.wrangler/state`, and run it again. Do this once after an update that changes the demo firm, such as slice C's calls or slice F's (only Calls & bookings is switched on, and the alert and login wording): the demo firm is loaded only into an empty database.

### Open the control room

The control room is for Front-line's own staff. On this machine there is no Cloudflare Access: a stand-in treats you as the invented "Example Staff". Open http://localhost:8787/control.

| Screen | How to get there |
|---|---|
| Firms | http://localhost:8787/control: every firm, with its services, stop button, and today's counts |
| One firm | Pick Tidewell Heating: switch services and the stop button, today's calls, texts that failed, texts in, Message us (unread until you open the page), and Needs a look |
| Find a customer | The box at the top of a firm's page: a name, a mobile or a landline |
| A customer | Pick one: what is held about them, **Export what is held** (a zip to your browser, with their recordings) and **Delete this customer** |
| Delete | Shows what goes and what stays. Type their name as shown, then **Delete for good** |
| The firm's records | On a firm's page: **Export this firm** (a zip, made within a minute; **Download** once made), and **This firm is leaving** |
| Leaving | Type the firm's name, then **Mark as leaving**. Its page then counts down the 30 days to its delete, with **Cancel the leaving** and **Delete the firm now**. See `docs/firm-leaving.md` |
| After a restore | The link at the foot of the list of firms: does again each customer and firm deleted since a restore point. See `docs/restore.md` |
| The example's tools | At the bottom of the demo firm's page, on this machine and practice only: move its clock on, and **Reset the example** |

To see Message us arrive, log in as Tom (above), send one, then open the firm's page. Every page you open and every button you press is written to the staff log. On practice and live the control room sits behind Cloudflare Access: see `docs/access.md`.

### Watch a call land

While `npm run dev` is running, this sends an example report to the system, the way Vapi does when a call ends. It is a new customer ringing from a landline at 14:47 on the example's "today":

```sh
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:8787/vapi/server \
  -H "Authorization: Bearer $(sed -n 's/^VAPI_SECRET=//p' .dev.vars)" \
  -H "Content-Type: application/json" \
  --data @test/fixtures/vapi/landline-caller.json
```

It prints 200. Refresh http://localhost:8787/calls and Mrs Hall's call is at the top. Send it again, and nothing changes: the same report makes one call. Put anything else after `Bearer`, and it prints 401: refused. The other example reports are in `test/fixtures/vapi/`. What to set on a firm's voice agent in Vapi is in `docs/vapi.md`.

### Send an urgent call

Send `test/fixtures/vapi/mr-price-leak.json` the same way. Mr Price rings about a leak, which is on the demo firm's urgent list, so Tom is alerted at once. Open http://localhost:8787/local/texts: the alert is listed as sent, with its words: "Front-line: urgent call from Mr Price, 6 Bridge Street. A leak under the kitchen sink. Their number: 07700 900016." and then a link to his job, which opens his job's page once Tom is logged in. It went to the stand-in, not to a phone.

### Book a visit, and open the customer's page

Open http://localhost:8787/local/book and press **Play Mrs Ahmed's call**. It plays a call to the demo firm the way Vapi sends it during and after a call: the voice agent asks for free times, books the first quote visit offered, and the report comes as the call ends. Her confirmation is then sent at once, to the stand-in. (This needs `VAPI_SECRET` in `.dev.vars`, as above.)

The page shows the visit booked, the confirmation's words, and a link to her confirm-your-details page, which is the link the text carries. Open it, correct her name, address or email, and press **Save my details**. http://localhost:8787/local/example then shows the change in her history, and http://localhost:8787/local/texts lists the text.

Each press is Mrs Ahmed on a new mobile, so she is a new customer every time and her confirmation is always her first text, with its link.

Her call comes with a recording, as Vapi writes one into the inbox file store: a few invented bytes, not a real sound. It is moved into Front-line's file store at once. Open http://localhost:8787/local/files to see the demo firm's files. In the control room, move the demo firm's clock on 31 days (**Move on to**): the recording is gone from `/local/files`, and her call is still on Calls & bookings. What to set on each firm's agent for recordings is in `docs/vapi.md`, under "Recordings". Between 8pm and 8am her text waits until 8am (quiet hours), and the page says so.

Links on this machine start `http://localhost:8787`, from `LINK_ADDRESS` (customers' links) and `PUBLIC_ADDRESS` (the owner's app) in `wrangler.jsonc`. On practice and live both are empty until the addresses are chosen (open question 9). Until then no customer's first text and no login text goes out from them, and the urgent alert goes without its link.

What to set on a firm's voice agent so it can book is in `docs/vapi.md`, under "Booking during a call".

### Run the clock by hand

On a deployed copy the clock runs every minute. On this machine it runs only when asked:

```sh
curl http://localhost:8787/cdn-cgi/local/scheduled
```

It puts the rows of the due list whose time has come on the queue, and the queue's worker runs them: confirmations of visits just booked, reminders at 1pm the day before a visit, recordings to move or delete, firm exports, and each firm's daily sweep at 3:15am, which deletes whatever has run past its period (`src/record/periods.ts`). The demo firm's own visits are from the example and have no rows; a visit booked through `/local/book` does.

Wrangler does contact Cloudflare in two small ways unless told not to:

- It sends usage data. `wrangler.jsonc` turns most of it off; `WRANGLER_SEND_METRICS=false` in your environment turns off the rest.
- It downloads a public file of example request details, at most once every 30 days. `CLOUDFLARE_CF_FETCH_ENABLED=false` stops that.

`.claude/settings.json` sets both for every Claude Code session, cloud or local, because a cloud session must not try to reach Cloudflare. The GitHub check sets both too.

## Check it

```sh
npm run check          # types, lint and every test: this must pass before a push
npm test               # the tests only
npm run check:screens  # the owner's screens in a real browser
```

The tests run inside the Workers runtime against a local database. GitHub runs `npm run check` and `npm run check:screens` on every pull request and after every merge to `main`.

`npm run check:screens` starts the system as `npm run dev` does, on port 8799 with a database of its own, logs in as Tom, and opens every owner's screen at 390 by 844 and at 1280 by 800. On each it runs the example app's own checks: no sideways scroll, no button under 44px, no text cut off, and no accessibility failures (axe-core, WCAG 2.2 AA). It saves a screenshot of each in `screens/`, which git ignores, beside the example's Home and Calls & bookings at the same sizes. It needs Playwright's Chromium: `npx playwright install chromium` the first time.

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
