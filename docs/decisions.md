# Decisions

Three lists.

- **Settled**: Greg has decided. Do not reopen these.
- **Assumed**: proposed and being built on. Greg has not said yes or no. Build so that changing one is a small job.
- **Open**: nobody has decided. Do not guess. See section 9 of `docs/build-brief.md`.

When something is decided, move it or add it here in the same pull request, with the date and who decided.

## Settled

| When | Decision |
|---|---|
| 8 Oct 2026 | Each history entry is its own line to the owner. Where the example joins a call and its booking in one line ("Answered her call. No hot water since last night. Quote visit booked for Monday, 9am."), the owner sees two, each in the example's words. "Details taken" is not shown to the owner. Greg, answering the slice B pull request |
| 8 Oct 2026 | New words in the owner's lines: "Sent a reminder about the visit." on a job page, "Reminded Mrs Patel about the visit." in Done for you, "Service booked for…" in place of "Booked the service for…", and "midday" for 12 o'clock. A visit's day is written by name within six days ("Monday, 9am") and as a date beyond ("Wednesday 21 October, 2pm"). Greg, answering the slice B pull request |
| 8 Oct 2026 | The second firm in the wall tests is "Second Example Firm", holding the same sixteen invented customers as Tidewell Heating. Greg, answering the slice B pull request |
| 8 Oct 2026 | The demo firm fills in six times the example does not give: Mr Hughes's quote visit Wednesday 7 October 10am, Mr Evans's Monday 12 October 2pm, Mr Khan's Thursday 17 September 2pm, Mr Khan's install Wednesday 30 September 8:30am, Mrs Ahmed's install Thursday 15 October 8:30am, and Mr Davies's service Thursday 15 October 10:30am. Greg, answering the slice B pull request |
| 8 Oct 2026 | A new firm starts with all five services off and the stop button off. Nothing runs for a firm until staff switch it on. Greg, answering the slice B pull request |
| 8 Oct 2026 | A firm's own versions of the owner's lines, stored in the database, come in slice D with the firm's agreed wording for texts. Until then the lines are data in one file, `src/history-lines.ts`. Greg, answering the slice B pull request |
| 8 Oct 2026 | A history entry holds ids, a kind, a time and who did it, never words. The line an owner reads is made from it each time it is shown. The database refuses any edit to an entry. Deleting a person's history when the law requires it comes with slice G. Greg, approving the slice B plan |
| 8 Oct 2026 | A job's state is worked out from its records each time it is shown, not stored: "Passed to you" if it is urgent, then "On today" with a booked visit on today's UK date, then "Booked" with one still to come, otherwise no state yet. States that come from quotes and invoices will be worked out the same way from their records. Greg, approving the slice B plan |
| 8 Oct 2026 | The wall holds in two places. Every record function takes the firm and finds or changes only that firm's rows. And every link between tables carries the firm as well as the id, so the database itself refuses a link across firms. Only `createFirm()` and `exampleFirms()` take no firm. `test/wall.test.ts` has a case for each record function and fails when one is missing. Greg, approving the slice B plan |
| 8 Oct 2026 | Lists that later slices will add to, such as the kinds of history entry and the states of a visit, are checked by the record layer, not by the database, so adding one does not mean rebuilding a table. Greg, approving the slice B plan |
| 8 Oct 2026 | Mobiles are stored in one form, `+447700900001`, however they were written. Greg, approving the slice B plan |
| 8 Oct 2026 | A visit has a start and no end until open question 4 (how long a visit takes) is answered. Greg, approving the slice B plan |
| 8 Oct 2026 | Lines in the app keep the example's curly apostrophe ("Mrs Green’s"). Straight quotes are for texts (rule 4). Greg, approving the slice B plan |
| 8 Oct 2026 | The demo firm holds only what Release 1 can produce: every line in the example that is a call answered, a visit booked, a confirmation, a reminder or an urgent call passed on, a "details taken" entry for each new caller, and every visit the example mentions. Where a line mixes kinds, only the Release 1 part goes in. Jobs whose state in the example comes from a quote or an invoice get it back when their release adds quotes and invoices to the demo. Greg, approving the slice B plan |
| 8 Oct 2026 | `npm run dev` runs `src/local.ts`, which loads the demo firm the first time it is used and shows it at `/local/example`. Practice and live are built from `src/index.ts` and have neither. Putting the demo on practice, and resetting it, come with slice G. Greg, approving the slice B plan |
| 8 Oct 2026 | The GitHub check runs on every pull request and on every push to `main`. Its actions are pinned to exact commits, not tags. `.gitignore` also covers `.env` files, which Wrangler reads for local secrets. Greg, answering the slice A pull request |
| 8 Oct 2026 | Money is shown as "£2,457" for whole pounds and "£8.87" or "£2,457.50" when there are pence, always with two digits of pence. A negative amount starts with the example's minus sign: "−£5". Greg, answering the slice A pull request |
| 8 Oct 2026 | Rule 8's "no SQL anywhere else" covers the application in `src/`. Tests may read the database directly, but only through `test/helpers/db.ts`, for example to prove that a delete left nothing behind. Greg, answering the slice A pull request |
| 8 Oct 2026 | Wrangler runs with `WRANGLER_SEND_METRICS=false` and `CLOUDFLARE_CF_FETCH_ENABLED=false`, so that it sends no usage data and downloads nothing from Cloudflare. `.claude/settings.json` sets them for every Claude Code session, and the GitHub check sets them too. Greg, answering the slice A pull request |
| 8 Oct 2026 | The code lives at the root of the repository. `CLAUDE.md`, `docs/` and `reference/` moved up from `frontline-starter/` unchanged. Greg, answering a question while the slice A plan was made |
| 8 Oct 2026 | Routes use Hono, which is built for Workers and can list every route for the cross-firm tests. Greg, approving the slice A plan |
| 8 Oct 2026 | Queries are plain SQL in D1 prepared statements with bound values, written only in `src/record/`. No query builder or ORM. Greg, approving the slice A plan |
| 8 Oct 2026 | Tests use Vitest 4 with `@cloudflare/vitest-plugin`, running in the Workers runtime against a local D1. Migrations are applied in tests with the plugin's helpers, which use the same table as Wrangler (`d1_migrations`). Greg, approving the slice A plan |
| 8 Oct 2026 | TypeScript 6.0 (strict), linted by ESLint with typescript-eslint. TypeScript 7 waits until typescript-eslint supports it. Versions are pinned exactly. Greg, approving the slice A plan |
| 8 Oct 2026 | The top level of `wrangler.jsonc` is this machine (`npm run dev` and the tests). `practice` and `live` are environments used only for deploys. Greg, approving the slice A plan |
| 8 Oct 2026 | `GET /health` answers with the version in `package.json`. Greg, approving the slice A plan |
| 8 Oct 2026 | Ids are 128 random bits from the cryptographic random source, written as 26 characters of lowercase Crockford base 32. Greg, approving the slice A plan |
| 8 Oct 2026 | Logs go through `log()` in `src/log.ts`, which takes an event from a fixed list and fields that are ids, numbers, true or false, or an error's type. An error's message is never logged. Greg, approving the slice A plan |
| 6 Oct 2026 | Built with Claude Code, as one codebase on Cloudflare: Workers, D1 and R2. TypeScript throughout |
| 5 and 6 Oct 2026 | Customers are messaged by text from an 07 number bought for each firm through Twilio. The same number takes the firm's calls. No WhatsApp at launch. The aim is the least set-up for the firm |
| 3 Oct 2026 | The example app is the working design: its look, its layout and its wording. Greg has asked for no changes to it. Ease of use comes first |
| 3 Oct 2026 | A quote or an invoice never goes out until the owner approves it. Other messages use wording agreed with the firm at set-up |
| 3 Oct 2026 | Money never passes through Front-line. Deposits and payments go straight to the firm's own account |
| 3 Oct 2026 | Front-line prepares paperwork and tracks deadlines. It never signs a certificate. The engineer sends anything official under their own login |
| 3 Oct 2026 | Every customer is asked for a review, with no incentives and no picking |
| 3 Oct 2026 | Firms are owner-run with staff. Front-line is not for sole traders |

## Assumed

From the build and release plan of 6 October 2026 unless it says otherwise.

| Assumption | Affects |
|---|---|
| Four releases in this order: calls and bookings, invoices and reminders, quotes and follow-ups, paperwork and the rest. The second and third swap if HMRC's answer on the invoices service rules it out, or has not come by the time the first is live | What gets built after Release 1 |
| Calls stay on Vapi, where the voice agents already are | Slices C and E |
| Each release goes to one firm first and is watched before the next firm gets it | Slice I |
| Databases and file stores are created in Cloudflare's EU jurisdiction | Greg, when he creates them |
| Call recordings are kept for 30 days, then deleted. Summaries and transcripts stay with the job | Slice H |
| Jobs, messages and photos are kept while the firm is a client. Enquiries that never became a job are kept for 12 months | Slice H |
| When a firm leaves, its records are handed over as a file and deleted within 30 days | Slice H |
| Recordings are held in Front-line's own file store, not left with Vapi | Slice H |
| A reminder goes at 1pm the day before a visit. From the example | Slice E |
| Alerts reach the owner by text, with a link that opens the item | Slices C and D |
| The first text to a new customer carries a line on opting out and a link to confirm their details | Slice E |
| Opt-outs are kept by kind of message | Slice D |
| Front-line's own diary comes first. A link to an owner's Google Calendar is added later, firm by firm | Slice E |
| The demo firm is Tidewell Heating, owner Tom, with the example's sixteen jobs. It books quote visits Monday to Friday, 8am to 4pm, as the example's rules say | Slices B and E |
| An outside developer reviews the payment code, the links and the wall between firms before pay links go live | Release 2 |
| Practice and the control room sit behind Cloudflare Access. Proposed in the build brief, 6 Oct 2026. Not in the plan | Slices C and G |
| Every due row has a latest time, after which it is skipped and not sent late. Proposed in the build brief, 6 Oct 2026 | Slice D |
| History lines on a job page leave out "her" and "his". Proposed in the build brief, 6 Oct 2026 | Slices B and F |

## Open

1. The words for the opt-out line and the confirm-your-details link in the first text. A solicitor is to see the opt-out wording.
2. What a customer's STOP does, given that Twilio's own handling can block every later text from that number.
3. What "passed straight to you" means for an urgent call: the live call put through, a text alert, or both.
4. How long a visit takes, and when no reminder is sent because the visit is too soon.
5. When a second call from the same customer joins their open job, and when it starts a new one.
6. How long an owner stays logged in.
7. The words of the owner's alert for an urgent call.
8. Quiet hours, and whether anything is held back on a Sunday.
9. The web address for the app and for customers' links. It should be kept apart from the addresses used for outreach emails.
10. Whether Vapi moves to its EU region.
