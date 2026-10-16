# Autopilot

Greg's standing brief for building without him, given on 15 Oct 2026. `CLAUDE.md` tells every session to follow it. The brief is kept below as Greg wrote it. "Where the queue stands" after it is updated as tasks finish.

The first queue is done. The second, "Queue 2" below, was given the same evening and is worked the same way: how to work, what never to do and when to stop are as the first brief says.

---

Greg isn't a developer. You're doing the build; he only steps in at the stop points below. Save this brief as docs/autopilot.md and add a line to CLAUDE.md telling every future session to follow it.

HOW TO WORK
- One task at a time, in the order below. For each: new branch from slice-i-practice, write the code AND automated tests, run the full test suite, open a PR against slice-i-practice, merge it yourself if everything passes, deploy to practice only.
- If a test fails, fix it. If you can't fix it in two attempts, stop and explain.
- Vapi changes: run scripts/vapi-assistant.js read-only first. Apply only if the diff contains just the changes you intended; otherwise stop and show me.
- No live phone calls. Greg does one full end-to-end call before any real firm goes live.
- Follow the standing rule: automate anything that can be automated without losing accuracy.

NEVER
- Touch main, production/live, real client data or secrets.
- Spend money, change account settings, or accept terms anywhere.

STOP AND ASK GREG ONLY FOR
- Wording that customers or firm owners will see (draft it, mark it [to agree], don't switch it on).
- Anything legal, data protection, or that can't be undone.
- Choices between options that change what the product does.

AFTER EACH TASK, write a plain-English summary of no more than 5 lines: what you did, what the tests showed, what's deployed, anything Greg needs to decide. Then carry on to the next task.

QUEUE
1. Booking (branch slice-i-booking, PR #12): add automated tests with a fixed "current time" covering: slots on three different working days; nothing before minimum notice (default noon next working day), including late evening, Friday and weekend; correct UK times either side of the 25 Oct 2026 clock change; "visit booked" owner text sent outside quiet hours and held during them; no confirmation-text promise for landline, withheld or opted-out callers. Also check with an unauthenticated request that a practice-links booking link opens without a Cloudflare Access login. Then merge PR #12.
2. Update slice-i-call-report onto the latest slice-i-practice (so booking stays in), test, merge, deploy.
3. Control room auto-push: saving firm settings (e.g. the urgent list) updates that firm's Vapi agent automatically, using the same read-only-diff-then-apply safety, with every push logged.
4. Make every action in the app a named action that records who did it (owner, Front-line or system), so a future AI assistant can use the same actions. Note this rule in CLAUDE.md.
5. Outgoing texts (follow-ups and reminders, SMS for now): build and test them, draft all wording marked [to agree], and leave them switched off.

When task 5 is done, stop and give Greg a summary of all five.

---

## How the rest of the repository reads this brief

- It takes the place of "wait for approval" in `CLAUDE.md` for the tasks in its queue: no plan waits for Greg unless it reaches a stop point.
- "Merge it yourself" means merging the pull request into `slice-i-practice`, never `main`.
- "Deploy to practice" happens only on Greg's own machine (`--env practice`), never from a cloud session, and never to live. "Nothing goes to live unless he says 'deploy to live'" still stands.
- Every other rule in `CLAUDE.md` still holds, including the 20 rules, the cross-firm tests and `npm run check` passing before a push.
- A stop point that a task reaches stops that task only. Tasks after it that do not depend on it carry on, and the questions wait in the pull request and the summary.

## Queue 2

Given by Greg on 15 Oct 2026, kept as he wrote it.

---

QUEUE
1. Flaky check: find out why #19's colour-contrast check failed once on the "message sent" panel and passed on re-run. If it's flaky, make it reliable. If it's a real contrast problem, fix the colours.

2. Trade starter packs: when a new firm is set up, choosing its trade pre-fills the urgent list, working hours, diary rules and draft text wording. Make packs for plumbing & heating, drainage, and electrical. All customer- and owner-facing wording is marked [to agree]. Packs only pre-fill; the owner can change everything.

3. Firm onboarding flow in the control room: one guided flow for Front-line staff to set up a new firm: firm details, owner details, trade starter pack, services chosen, diary rules. Build the steps that create a Vapi agent and a Twilio number, but leave both switched off: no Vapi key is set yet, and buying a number costs money.

4. Go-live gate: a firm can't be switched to live until a checklist is complete: owner has agreed all wording, its phone number is approved and connected, its Vapi agent matches the control room, an end-to-end test call is recorded as passed, and Front-line has ticked the data-protection items. The control room shows what's missing. Only Greg can tick the final "go live".

Use named actions (CLAUDE.md rule 21) for everything new. Keep docs/decisions.md and the status table in docs/autopilot.md up to date.

If this session is getting long, update the status table with exactly where you are, so a fresh session can carry on with "Carry on with the autopilot queue".

When task 4 is done, stop and give Greg a summary.

---

## Where queue 2 stands

Updated 15 Oct 2026. Each task's branch is made from `slice-i-practice` after the one before is merged. Queue 2 is done: all four are merged and on practice, and the session stopped to give Greg a summary.

| Task | Branch | State | Waiting on Greg |
|---|---|---|---|
| 1. Flaky contrast check | `slice-i-flaky-contrast` | Merged as #21. Flaky, not a real contrast problem. The "message sent" panel rises with a fade (60% to full opacity over 0.18 seconds), and the check sometimes measured it part way through. The check now waits for the page to load and for every animation that ends to end. Shown with the fade slowed to 3 seconds: the old check fails on both panels, the new one passes. `npm run check:screens` now also runs on Windows | Nothing |
| 2. Trade starter packs | `slice-i-trade-packs` | Merged as #22 and deployed to practice (version 6f297773, with migration 0012). Built: three packs in `src/trade-packs.ts`; staff choose a firm's trade at `/control/firms/:firm/trade`, which fills in only what the firm has none of yet, as the action `choose_trade`. Migration 0012 adds the firm's trade | The packs' urgent lists and drafts, in `docs/texts-to-agree.md` [to agree]; the hours and visit lengths |
| 3. Onboarding flow | `slice-i-onboarding` | Merged as #23 and deployed to practice (version 8c49a17a, with migration 0013). Built: adding a firm opens its guided set-up (`/control/firms/:firm/onboard`), eight steps in order, each saving back to it. New actions `choose_services`, `buy_number`, `create_agent`. Buying a number and making an agent are built and switched off on every copy (no `NUMBERS_ON`, no Vapi key), and each can happen at most once per firm. Migration 0013 | Open question 18: switching on buying numbers and making agents from the Worker; the new staff words |
| 4. Go-live gate | `slice-i-go-live` | Merged as #24 and deployed to practice (version 25ba89fa, with migration 0014); `npm run practice:gates` passes. Built: each firm's go-live checklist (`/control/firms/:firm/go-live`), read from the record where it can be and ticked by staff where not; `go_live` only for the email in the secret `GO_LIVE_BY`, which switches on the services chosen. Before going live, only Calls & bookings can be switched on, and only with set-up complete. New actions `tick_go_live`, `record_test_call`, `go_live`. Migration 0014. Also fixes task 2's `setTrade` so a fill staff overtake is not recorded | Open question 19: the data-protection items [to agree], setting `GO_LIVE_BY`, and the agent check needing a Vapi key |

## Queue 3

Given by Greg on 16 Oct 2026, with his answers to queue 2's questions (recorded in `docs/decisions.md`, Settled, 16 Oct 2026). Kept as he wrote it.

---

1. Fix the local test suite timing out on this machine, without weakening any test.
2. Billing with Stripe in TEST MODE only: go-live starts the 2-week free trial; after it, the firm pays monthly for the services it chose at Front-line's approved prices (£50 per service, £80 calls & bookings, £150 all five), founding price locked for the first 20 firms, cancel any time, no setup fee. Not VAT-registered, so no VAT. Nothing live, no real cards. Stop before anything that would need a live Stripe key.

Stop after task 2 with a summary.

---

## Where queue 3 stands

Updated 16 Oct 2026.

| Task | Branch | State | Waiting on Greg |
|---|---|---|---|
| Greg's answers of 16 Oct | `slice-i-decisions-16-oct` | Recorded; `GO_LIVE_BY` set on practice; his check of an agent by hand counts on practice only; a Vapi key is used by practice's Worker only | Setting practice's `VAPI_API_KEY` himself; the data-protection items (19 a) |
| 1. Local test timeouts | | Not started | |
| 2. Stripe billing, test mode | | Not started | |

## Where the first queue stands

Updated 15 Oct 2026. Each task's branch builds on the one before, so they merge in this order.

| Task | Branch | State | Waiting on Greg |
|---|---|---|---|
| 1. Booking tests | `slice-i-booking-tests` | PR #12 was already merged (2ee1064) with most of these tests. The rest added: late-evening, Friday and weekend calls; free times and visits either side of 25 Oct 2026; the owner's booking text at the edges of quiet hours. The unauthenticated check passed, and is now `npm run practice:gates`. | Nothing |
| 2. Call report onto slice-i-practice | none | Done before this brief: merged as PR #14 (7e302e1), which practice runs. | Nothing |
| 3. Control room pushes to Vapi | `slice-i-agent-push` | Built and tested against a pretend Vapi, switched off: no copy has a Vapi key. | Open question 17 in `docs/decisions.md`: the key, and the `CLAUDE.md` rule's new wording |
| 4. Named actions | `slice-i-actions` | Built: `src/actions.ts`, rule 21 in `CLAUDE.md`, and lint. | Nothing; the reading of "owner, Front-line or system" is under Assumed |
| 5. Outgoing texts | `slice-i-texts` | Three texts built and switched off; their wording and three more drafted. | The wording in `docs/texts-to-agree.md`; the missed-call text is a data protection question |
