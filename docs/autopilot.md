# Autopilot

Greg's standing brief for building without him, given on 15 Oct 2026. `CLAUDE.md` tells every session to follow it. The brief is kept below as Greg wrote it. "Where the queue stands" after it is updated as tasks finish.

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

## Where the queue stands

| Task | State |
|---|---|
| 1. Booking tests | PR #12 was already merged into `slice-i-practice` on 15 Oct 2026 (2ee1064), with most of these tests. The missing ones are added on `slice-i-booking-tests`. |
| 2. Call report onto slice-i-practice | Done before this brief: `slice-i-call-report` was brought up to date (f610aa0) and merged as PR #14 (7e302e1), which practice runs. |
| 3. Control room puts settings on Vapi | Not started. |
| 4. Named actions | Not started. |
| 5. Outgoing texts | Not started. |
