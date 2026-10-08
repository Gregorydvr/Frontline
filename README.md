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

```sh
npm run dev
```

This brings the local database up to date with `migrations/`, then starts the system at http://localhost:8787. Open http://localhost:8787/health to see the version. Everything runs on this machine, and no account at Cloudflare or any provider is touched.

Wrangler does contact Cloudflare in two small ways unless told not to:

- It sends usage data. `wrangler.jsonc` turns most of it off; `WRANGLER_SEND_METRICS=false` in your environment turns off the rest.
- It downloads a public file of example request details, at most once every 30 days. `CLOUDFLARE_CF_FETCH_ENABLED=false` stops that.

`.claude/settings.json` sets both for every Claude Code session, cloud or local, because a cloud session must not try to reach Cloudflare. The GitHub check sets both too.

## Check it

```sh
npm run check   # types, lint and every test: this must pass before a push
npm test        # the tests only
```

The tests run inside the Workers runtime against a local database. GitHub runs `npm run check` on every pull request.

## Changing the database

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

Wrangler 4 creates a missing file store or queue by itself during a deploy. Until step 1 is done, deploy with `--x-provision=false` so nothing is created by accident.
