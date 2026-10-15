# Plan: automating a firm's set-up (slice J)

A plan only. Nothing here is built, and nothing here is decided. Each part ends with the questions Greg needs to answer before it is built. Once he answers, the answers go into `docs/decisions.md` and each part is built as its own branch and pull request.

Written by Claude Code on 15 Oct 2026, from the "Next, after booking is tested" list in `docs/decisions.md` and Greg's standing principle of 14 Oct 2026: automate what we can without losing accuracy, and leave a step manual only when a person's decision is the point. That principle is in `CLAUDE.md` on `slice-i-call-report`, not yet on `main`.

## The four parts, and their order

| Part | What it does | Depends on | Touches a provider's account? |
|---|---|---|---|
| J1 | Calls & bookings cannot be switched on while set-up is incomplete | Nothing | No |
| J2 | The control room puts a firm's agent settings on its agent in Vapi, and checks they arrived | J1, and a change to `CLAUDE.md` | Yes: changes Vapi agents from the deployed Worker |
| J3 | Trade starter packs fill in a new firm's urgent list, diary rules and draft wording | J1 | No, unless a pack also sets the agent's instructions (then J2) |
| J4 | Guided onboarding: a firm's page becomes the steps from added to live, ending in a "Go live" button | J1, J2, J3 | Yes, if it creates agents or sets up numbers |

This is the order in `docs/decisions.md`. J3 does not need J2 and could come before it if the Vapi questions take a while to answer.

What runs through every part:

- Every change is written to the firm's history and the staff log in the same step, as now (rule 15).
- Every new route and record function gets its cross-firm case (rule 9).
- Words that staff, owners or customers read come from the brief or are listed as new wording in the pull request.
- No new dependency. The Worker's own `fetch` reaches Vapi.
- Tests never call a real provider. Each provider sits behind an interface in `src/providers/`, with a fake.

---

## J1. Calls & bookings only with set-up complete

Settled on 14 Oct 2026 (question 2 of the slice H2 plan). Until this is built, staff check by eye that the firm's page shows nothing under "Still missing before Calls & bookings can be switched on".

### What changes

- **The record refuses.** `setService` in `src/record/firms.ts` refuses to switch `calls` on while `callsSetUpGaps` (`src/set-up.ts`) finds anything missing: the number, an owner with a mobile, the urgent list, the diary rules with a quote-visit length, or agreed wording for every kind of text. The record already refuses on the set-up checks, so this follows the same pattern: the check lives in `src/set-up.ts`, and the record and the control room both use it.
- **Switching off is always allowed.** So are the other services and the stop button.
- **The control room says why.** The switch shows what is missing, using the words the firm's page already has. Nothing new is stored.
- **Test helpers.** `tidewell()` in `test/helpers/vapi.ts` switches Calls & bookings on before it adds the owner and the wording. It would set things up first and switch on last. Some tests deliberately leave out a kind of wording (`without`) to check that `send()` refuses. They need a firm that has Calls & bookings on and is missing wording, which the record would no longer allow (see the first question).

### What could go wrong

- **A firm that is complete, with Calls & bookings on, becomes incomplete.** For example, its urgent list is emptied or its owner's mobile is removed. The agent keeps answering, and an urgent call gets no alert. The record could refuse that change while Calls & bookings is on, switch it off, or allow it and show a warning. This is Greg's choice (question 2).
- **Two members of staff at once.** One switches on while the other removes wording. The check and the write are separate steps in D1. The fix is to make the write itself conditional, with an `UPDATE … WHERE` that fails if anything went missing, and a test for it.
- **Practice and live firms already switched on with gaps.** Nothing is switched off when this is deployed. The firm's page shows the gap as a warning, so staff can fix it.
- **What it cannot see.** The agent in Vapi and the number in Twilio are set up outside the record. J1 cannot check them. J2 and J4 close that gap.

### How it is tested

- For each kind of gap, switching on is refused, and nothing changes: not the firm, its history or the staff log, apart from the view.
- With everything in place, switching on works and is recorded.
- Switching off works with gaps.
- A test where two changes race.
- Cross-firm: a complete firm cannot be used to switch on another firm, through the record or the route.
- `test/set-up.test.ts`, the end-to-end set-up, still passes with set-up done first and switching on last.
- The demo firm's loader still loads.

### Questions for Greg

1. Tests that need a firm with Calls & bookings on and some wording missing: may `test/helpers/db.ts` write that firm's switch directly? It is the one place a test touches the database, but today it only reads. The other way is a record function for tests only.
2. When a firm with Calls & bookings on loses something it needs, should the record refuse the change, switch Calls & bookings off and say so, or allow it and warn?
3. Should the same rule cover the other four services when they are built, each with its own list?

---

## J2. The control room puts agent settings on Vapi

Asked for by Greg on 14 Oct 2026. Today, a change saved in the control room, such as the urgent list, reaches the agent only when someone copies it into `vapi/<firm>.json` and runs `scripts/vapi-assistant.js` on Greg's machine. Until then the agent does not know the change, and an urgent call gets no alert.

### What changes

- **The settings are worked out from the record.** A new `src/agent-settings.ts` builds a firm's whole agent from its record and a template held in code:
  - the greeting, with the firm's name
  - the instructions, with the date line and the booking rules
  - the two tools, at this copy's own address, with the server credential named by its id
  - `urgentMatch`'s description, with the firm's urgent list
  - `recordingPath` (`/firms/<firm id>`)
  - the details the agent takes down

  `vapi/practice-assistant.json` then becomes something the code must produce exactly: a test fails if the two drift apart.
- **The record.** A migration adds the firm's Vapi assistant id (unique across firms) and where its agent stands: the settings last confirmed on Vapi (a hash and the time), and one of "in step", "behind", "differs" or "never set".
- **A provider for Vapi.** `src/providers/vapi/` holds the interface (read an agent, change some of its settings), the real one, and a fake. The real one is the only code that reaches `api.vapi.ai`, and lint enforces that, as it does for texts. The comparison in `scripts/vapi-assistant.js` (`same`, which ignores key order and the order of `required`) moves into one shared, tested module that both the script and the Worker use.
- **Pushing is timed work (rule 20).** Saving anything the agent depends on adds a `push_agent` row to the due list. The worker claims the row, then:
  1. Builds the settings from the record as it is at that moment, not as it was when the row was made.
  2. Reads the agent from Vapi and checks it is this firm's agent (next section).
  3. Sends only the settings that differ, in one request.
  4. Reads the agent back and compares.
  5. Records "in step" only if what it read back matches.

  Running a row twice does no harm, because the second run finds nothing to send.
- **The control room.** The firm's page shows where its agent stands, when that was last checked, and which settings differ. It has a button to check now and a button to push now. Each view and action goes in the staff log, and each push goes in the firm's history (new kinds such as `agent_updated`).
- **A daily check.** One row a day per firm reads its agent and compares it with the record, so a change made in Vapi's dashboard shows on the firm's page.
- **`CLAUDE.md` changes.** It currently says that changing anything in a provider's account happens only on Greg's machine, when he asks. Under this plan, the deployed Worker would change a firm's agent whenever staff save. That rule needs rewording by Greg before this is built.

### What could go wrong

- **Changes made in Vapi's dashboard (drift).** Someone edits an agent in the dashboard. Either the next push silently overwrites the edit, or the agent runs on settings the record does not know. The plan:
  - Before each push, compare Vapi with the settings last confirmed, not only with the new ones.
  - If Vapi changed in between, do not overwrite. Mark the agent as "differs", show the difference, and let staff choose to overwrite.
  - The daily check finds drift even when nobody saves anything.
- **A push that only half arrives.** Vapi replaces each top-level setting it is sent as a whole. A request that times out may or may not have been applied. The plan:
  - Each firm's change goes in one request.
  - Nothing counts as done until the read-back matches.
  - A push that fails or does not match leaves the agent "behind" or "differs", and the row tries again until its latest time.
  - The record is always the source, so a retry sends whatever the record holds then.
- **The wrong firm's agent.** A mistyped assistant id would put one firm's urgent list and greeting on another firm's agent, which would answer that firm's calls in the wrong firm's name. The plan:
  - The assistant id is unique across firms.
  - Before changing anything, the push checks that the agent's `recordingPath` is this firm's own.
  - Once the number is imported, it also checks that the agent is attached to this firm's number.
  - Any mismatch refuses the push and is shown.
- **The key reaches too much.** A Vapi private key in the Worker reaches every agent and every call's record, and those records hold transcripts and callers' numbers. Today the Worker holds no Vapi key (Assumed, recordings). The plan:
  - The key lives only as a Worker secret, and only the provider module reads it.
  - Each copy has its own key.
  - Ideally practice and live are in separate Vapi organisations, so practice cannot touch a live agent (question 1).
- **Vapi is down or refuses.** If Vapi errors or rate-limits, the row tries again later. If Vapi refuses the settings themselves, for example because its schema changed, the row stops trying and shows the reason on the firm's page. The logs carry ids only.
- **A change to the template reaches every firm.** One edit to the shared instructions could change every agent. The plan: a template change goes to practice first, and live firms are pushed in a step staff choose (question 5).
- **Secrets in the settings.** The Worker reuses the script's check that no settings hold a key or secret (`scripts/vapi-settings.js`, moved where both can use it).
- **The move to realtime (open question 12).** The model is a setting of each copy, not hard-coded, so the move is one change.

### How it is tested

- The settings built for the practice firm match `vapi/practice-assistant.json` exactly.
- Against the fake Vapi:
  - only settings that changed are sent
  - a read-back that does not match leaves the agent "differs" and tries again
  - a server error leaves it "behind" and tries again
  - a refusal stops and is shown
  - a dashboard change is found and not overwritten
  - an agent whose `recordingPath` is another firm's is never changed
  - running the same row twice sends nothing the second time
- The shared comparison is tested once, for key order and `required` order.
- Lint: nothing outside `src/providers/vapi/` reaches Vapi, with a deliberate mistake in `test/fixtures/lint/`.
- Cross-firm cases for the new routes and record functions. Staff log and history rows for each push and view.
- On practice, on Greg's machine, when he asks: one real push of an urgent-list change, read back, then the script run read-only to confirm nothing is left to change. The result is written up in `docs/practice-checks.md`.

### Questions for Greg

1. Does Vapi offer a key that reaches less than the whole account? If not, should practice and live be separate Vapi organisations, each with its own key?
2. The new wording of the `CLAUDE.md` rule on provider accounts: may the deployed Worker change a firm's agent when staff save, and may it ever create one?
3. When an agent was changed in Vapi's dashboard: should the control room stop and show the difference (proposed), or overwrite, since the control room is meant to be the only place to edit?
4. Which settings does Front-line own? All of them (proposed), or only the greeting, the instructions, the tools, `urgentMatch` and the recording settings?
5. When the shared instructions change: push every firm automatically, or practice first, then each live firm when staff choose (proposed)?
6. What happens to `vapi/` and `scripts/vapi-assistant.js`? Keep the script as a read-only check on Greg's machine and the file as the expected output (proposed), or retire both?
7. Who is told when an agent stays behind, for example after an urgent-list change that did not arrive? No staff mobiles are held (open question 11). For now it would show only on the firm's page.

---

## J3. Trade starter packs

Asked for by Greg on 14 Oct 2026. When a firm is set up, choosing its trade fills in a starting point that staff can change.

### What changes

- **The packs, as data.** A new `src/starter-packs.ts` holds one pack per trade. Each has:
  - an urgent list
  - diary rules: working days, hours, minutes between starts, days ahead, the next-day notice, and visit lengths
  - for each kind of text, the draft wording to start from, in place of `DRAFT_WORDING`

  Each pack has a version. A firm keeps the version it was set up with, so editing a pack later changes no firm.
- **The control room.** "Add a firm" gets a choice of trade. Choosing one fills in the urgent list and diary rules, and puts the pack's words on each wording page as the starting text. A migration adds the firm's trade and pack version. The history gains an entry such as `starter_pack_applied`, by staff.
- **Wording is still agreed one kind at a time.** A pack never marks wording as agreed. Each kind still goes only once the owner has agreed it (rule 2), recorded as now.
- **Fills only what is empty.** Choosing a pack for a firm that already has an urgent list or diary rules leaves those alone, unless staff choose to replace them on a page that shows both.

### What could go wrong

- **Words agreed without being read.** A ready-made set of texts invites a quick yes. The wording page still shows each text, its gaps and its segment count. How the owner agrees stays as it is now.
- **A pack that misses a trade's dangers.** An electrician's urgent list needs different items from a heating engineer's. The agent's safety advice names the gas emergency number, which is wrong for electrical dangers. That advice is in the agent's instructions, so a pack that changes it needs J2, or a by-hand update until J2 exists.
- **A pack that breaks a rule.** Wording that is not GSM-7, uses gaps that kind does not have, or lacks STOP where the first text needs it. Diary rules outside the checks. Every pack is run through the same checks as anything staff type (`src/set-up.ts`).
- **A firm with more than one trade**, such as heating and plumbing. It could pick one pack and add items by hand, or packs could be combined (question 3).

### How it is tested

- Every pack passes every set-up check: each kind's wording through `wordingProblems`, the diary rules through their checks, and the urgent list through its checks.
- A pack leaves every kind of wording unagreed, and `callsSetUpGaps` still lists them.
- A pack fills only empty settings.
- The firm records its pack and version.
- History and staff log rows.
- Cross-firm cases.
- `test/set-up.test.ts` gains a firm set up from a pack.

### Questions for Greg

1. Which trades, to start with?
2. For each trade: the urgent list, the diary rules, and the words of each text. All of these are new wording for Greg to agree, and the customer-facing words go to the solicitor along with the rest (open question 1).
3. A firm with two trades: one pack plus additions by hand, or combined packs?
4. Should a pack also carry the agent's safety advice for its trade? If so, that waits for J2, or is a by-hand change to the agent until then.

---

## J4. Guided onboarding, with a "Go live" button

A firm's page becomes the steps from "added" to "live", each showing done or not done, ending in a "Go live" button. Going live stays a person's decision: the principle names "Greg choosing to go live" as a step that stays manual. What is automated is every check that leads up to it.

### What changes

The firm's page shows these steps in order. Each is checked by code where it can be, with the reason given where it cannot:

1. The firm: its name and trade, with the pack from J3.
2. The owner, with a mobile.
3. The number, set on the firm.
4. The urgent list and diary rules.
5. The wording, each kind agreed by the owner.
6. The agent in Vapi: it exists, belongs to this firm, and is in step (from J2).
7. The number in Vapi: attached to this firm's agent, with texts off on Vapi's side (`smsEnabled` false), as `docs/vapi.md` says.
8. The number in Twilio: its messaging webhook points at this copy. Checking this by reading Twilio needs a read-only Twilio call from the Worker (question 3).
9. A test call: a call to the number since the last change, landed with a customer and job, and with no problems in the call report's checks (`crossCheck`, moved from `scripts/call-report-text.js` into `src/` so the Worker can run it).
10. What stays manual, with the reason: the number registered in the firm's name, the agreement signed, and the privacy wording. These are paperwork outside the repository (section I of the brief). Staff tick each one, and the tick is recorded with who ticked it and when.

"Go live" switches Calls & bookings on. At the moment it is pressed, every check runs again rather than trusting the page as it was drawn. The button refuses while any check fails, and says which. Pressing it is recorded in the history and the staff log. Pressing it twice does nothing the second time. A "Pause" is the existing switch, or the stop button.

The steps can be done in any order. The page shows what is left.

### What could go wrong

- **A check that is out of date when the button is pressed.** For example, the agent drifted since the page was drawn. That is why every check runs again on the press.
- **Going live with an agent that is behind.** That is a failing check, so the button refuses.
- **The Worker creating things in Vapi or Twilio.** Creating a firm's agent or importing its number from the control room would replace `scripts/vapi-import-number.js` and part of `scripts/vapi-assistant.js`. It meets the same `CLAUDE.md` rule as J2, with larger consequences: a wrong import attaches a number to the wrong agent. The proposal is that, at first, the control room only checks these by reading, and creating stays on Greg's machine (question 3).
- **A test call that proves nothing.** If the call was made before the last change, it tested old settings. That is why it must be after the last change, as the history shows.
- **Live versus practice.** On practice, "live" means a practice firm takes calls. On live it means a real firm's customers are answered. Who may press it may differ by copy (question 1).
- **The steps on a phone.** The control room is outside `npm run check:screens`, which covers the owner's screens. Its pages are still checked at both widths by hand, with screenshots in `docs/screens/`.

### How it is tested

- Go live is refused for each failing check, one at a time, with the reason shown, and changes nothing.
- With every check passing against the fakes, it switches Calls & bookings on and records it.
- Checks run again at the press: a fake agent that drifts after the page was drawn makes the press refuse.
- Pressing twice is harmless.
- Manual ticks are recorded with who and when, and are never edited.
- Cross-firm cases for every new route.
- `test/set-up.test.ts` is extended to take a firm from added to live, with fakes for Vapi and Twilio.

### Questions for Greg

1. Who may press "Go live": any member of staff, or Greg only? The same on practice and live?
2. Is a test call required before going live, or can staff skip it with a reason?
3. Which steps may the Worker do in a provider's account: only read and check (proposed for the start), or also create the agent, import the number into Vapi, and set Twilio's webhooks?
4. Does going live text the owner, for example "Your calls are now answered"? That would be a new kind of text, with new wording.
5. Which paperwork items does staff tick on the page: the agreement, the privacy wording, the number registered in the firm's name, anything else?
6. How does an owner agree wording during onboarding: in person as now, or in the owner's app? The app would need new screens and new words.

---

## Not in this plan

Self-serve sign-up, staff logins at a firm, WhatsApp, Xero or QuickBooks, and anything that holds a conversation with a customer: `CLAUDE.md` says not to build these yet. Nothing here deploys, or changes Cloudflare, Vapi or Twilio, until Greg asks on his own machine.
