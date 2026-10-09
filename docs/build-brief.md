# Build brief

Written 6 October 2026, from the build and release plan of the same date.

Nothing in this repository is built yet. Two things exist outside it: the voice agents, which are set up in Vapi, and the example app in `reference/example-app/`.

If this file and `CLAUDE.md` disagree, `CLAUDE.md` wins. If either disagrees with `docs/decisions.md`, stop and ask.

## 1. What is being built

One system with five parts, in one codebase.

1. **The app.** What the owner sees: what needs their OK, what was done for them today, their jobs, their services. The example app is the design.
2. **The record.** One database: firms, customers, jobs, a history of who did what, things waiting for an OK, messages, and a list of things due to happen.
3. **The routines.** One per task (wrap up a call, write a quote from a price list, read a reply). Each fills set fields and code checks the result.
4. **The pipes.** One `send()` function with texts behind it, and email later. Vapi for calls. Stripe for payments, later.
5. **The clock.** The list of things due, checked every minute. A reminder, a deadline and a deletion are all rows in it. Stopping the chasing is cancelling rows.

Around those: a **control room** for Front-line's staff, and a **demo firm** on the practice copy for sales calls.

It goes out in four releases. This brief covers the first. The others get their own briefs when their turn comes.

| Release | What the firm gets |
|---|---|
| 1. Calls and bookings | Calls answered and booked, seen in the app |
| 2. Invoices and reminders | Invoices out the same day and chased until paid |
| 3. Quotes and follow-ups | Quotes out the same day and followed up |
| 4. Paperwork and the rest | Job records, draft reports, review requests, service reminders |

Releases 2 and 3 may swap. See `docs/decisions.md`.

## 2. Release 1: calls and bookings

**In:**

- The record, and the wall between firms
- A call landing in the record, with urgent calls alerting the owner
- The diary, and booking a visit during the call
- A confirmation text, and a reminder the day before, from the firm's own number
- The owner's app on real records, with login by a link
- The control room, first version
- The demo firm
- Keeping and deleting: set periods, export and delete for one customer and for one firm

**Not in Release 1.** Do not start on these: quotes, invoices, payments, voice notes and photos from the owner, email, the iPhone app, a Google Calendar link, any routine that writes a draft.

## 3. The slices

One slice is one task, one branch and one pull request. Do them in order. Do not start a slice until the one before it is merged.

Mark a slice `[x]` in this file when its pull request is ready.

### [x] A. The skeleton and the checks

- One Cloudflare Worker in strict TypeScript. `GET /health` answers with the version.
- Wrangler set up with two environments, `practice` and `live`. Name the bindings for the database, the file store and the queue. Leave their ids as placeholders with a comment: Greg creates the real ones.
- Migrations as plain SQL files, applied the same way in tests, on this machine and when deployed.
- Tests that run in the Workers runtime against a local database.
- Three small foundations, each with tests: the clock (the only place the system time is read), money (whole pence, shown as "£2,457" or "£8.87"), and ids that cannot be guessed.
- `npm run check`, `npm test` and `npm run dev`.
- A GitHub Actions workflow that runs `npm run check` on every pull request.
- `.gitignore` covering `node_modules`, `.wrangler` and `.dev.vars`.
- A README that says how to run it. Fill in Commands and Layout in `CLAUDE.md`.

**Done when:** `npm run check` passes on this machine and on the pull request. A test broken on purpose turns the check red (say that you tried it, then put it back). Nothing has been deployed and no account has been touched.

In the plan for this slice, name the router, the way queries are written and the test set-up you would choose, with one line of reason for each.

### [x] B. The record and the wall

- Tables for firms, customers, jobs and the history. Later slices add the tables they need.
- The record layer in `src/record/`. It is the only code that touches the database, and every function in it takes the firm.
- A check that fails if SQL appears outside `src/record/` and the migration files.
- On the firm: a switch for each of the five services, and the stop button.
- The cross-firm tests. Two firms with data of the same shape. Every record function is tried with the other firm's ids and must return nothing or refuse.
- The demo firm as seed data: Tidewell Heating, owner Tom, and the sixteen customers and jobs in `seed()` in `reference/example-app/src.html`. Store them as records and history, not as sentences. The example's "today" is Thursday 15 October 2026. Mark the firm as an example.
- Seed only what Release 1 can produce: the customers, the jobs, their visits, and history of the kinds Release 1 writes. Quotes and invoices have no tables yet. Say in the plan how you would treat a job whose state in the example depends on a quote or an invoice.
- A function that turns one history entry into the line the owner reads. Cover the kinds Release 1 produces. See section 6 on wording.

**Done when:** the seed loads in `npm run dev`. Step 9 of the acceptance story passes for every record function. Taking the firm out of any one query makes a cross-firm test fail (show that you tried it on one, then put it back).

### [x] C. A call lands in the record

- A route that Vapi calls. It checks a shared secret and refuses anything else.
- When a call ends, Vapi sends a report. From it: find the firm by the number that was rung. Find the customer by the caller's number within that firm, or create one. Open a job. Store the call with its outcome (booked, urgent, or message taken) and write the history.
- The same report arriving twice makes one call.
- A caller who is not a customer, such as a supplier, becomes a call with a message. No customer and no job.
- A withheld number or a landline: the customer is created without a mobile and marked, because no text can reach them.
- What counts as urgent is a list held on the firm, set at set-up. An urgent call is marked urgent on the call and on the job. The alert to the owner comes in slice D, once `send()` exists.
- The Calls & bookings screen, read only, drawn from records in the example's look.
- Fixtures: example reports as files, with invented people. Take the shape of a report from Vapi's current documentation, or from a real report Greg captures from his own test call with his number replaced. Do not write the shape from memory.

**Done when:** tests replay the fixtures and the record and the history match. Steps 5 and 6 of the acceptance story pass, apart from the alert. A wrong secret is refused. The screen shows the new call.

Until slice F there is no owner login, so the app's pages are served only on this machine and behind the practice gate (section 5).

### [x] D. Sending, and the clock

- `send()`, as rules 1 to 4 in `CLAUDE.md` describe. Each message has a kind. A kind either needs the owner's approval or uses wording agreed at set-up.
- A texts interface with a fake, and a Twilio version behind it: sending, delivery reports, and incoming texts with Twilio's signature checked.
- Opt-outs, held for each customer and each kind of message.
- Alerts to the owner are a kind of message, sent to the owner's mobile. An urgent call now alerts the owner at once.
- The due list. Each row has a time to run and a latest time. A cron trigger each minute puts due rows on a queue. The worker claims a row in one database step, acts, and marks it done. A row past its latest time is skipped and that is recorded, so a held reminder never goes out after the visit.
- Incoming texts are stored against the customer and shown in the job's history. Nothing answers them automatically in Release 1.

**Done when:** step 6 of the acceptance story passes in full. Tests show a message cannot go twice, even with two workers running at once. The stop button, the service switch and an opt-out each block a send. A curly apostrophe fails the build. A row set for 1pm UK time on Sunday 18 October 2026 runs at 12:00 UTC, and one set for 1pm on Sunday 25 October, after the clocks go back, runs at 13:00 UTC.

### [x] E. The diary and booking

- On the firm: when visits can be booked, and how long one takes.
- A diary interface, with Front-line's own diary behind it.
- Two routes the voice agent calls during a call: one for free times, one to book. Both work only for the firm whose number was rung. Booking twice with the same details makes one visit.
- When a visit is booked: a confirmation text within a minute, and a reminder at 1pm the day before.
- The first text to a new customer carries a link to confirm their details, and a line saying how to opt out.
- The confirm-your-details page. It opens from the link with no login, shows what was taken on the call, and lets the customer correct their name, address and email. Rule 13 applies.
- Moving or cancelling a visit cancels its due rows and writes new ones.

**Done when:** steps 1 to 4, 7 and 8 of the acceptance story pass with the pretend clock.

### [ ] F. The owner's app on real records

- Login by a link sent by text. Opening the link shows a button, and the tap on the button logs in, so a phone's link preview cannot use the link up.
- These screens, with the example's structure, styles and words, and data from the record: Home, the job page with its history, Calls & bookings, All jobs with the find box, Done for you, Your rules (read only), Message us. Message us stores what the owner wrote and alerts staff.
- A service that is switched off for the firm is not shown.
- Screens the example never needed: loading, nothing here yet, a text that failed to send, a call with details missing.
- The example's checks carried over: no sideways scroll at 390px wide, no button under 44px, no accessibility failures.
- The "Example" badge beside the name of an example firm.

**Done when:** the demo firm's Home and Calls & bookings screens match the example's layout and styles at 390 by 844 and at 1280 by 800, with a screenshot of each beside the example's in the pull request. Blocks for services that are switched off are absent. Everything shown comes from the record.

### [ ] G. The control room

- For Front-line's staff only, behind the practice gate and its equivalent on live.
- A list of firms. For each: the service switches, the stop button, today's calls, texts that failed, texts that came in, and anything the owner sent from Message us.
- Find one customer, export what is held about them, delete them.
- Every view and every action recorded (rule 15).
- On practice only: move the demo firm's clock forward, and reset the example.

**Done when:** tests show a view is recorded, an export holds everything stored about that customer, and after a delete nothing about them is left.

### [ ] H. Keeping and deleting

- Call recordings held in Front-line's own file store, with the reference on the call. Say in the plan how the recording gets there: Vapi writing to the file store itself, or the Worker copying it when the call ends. Check Vapi's current documentation first.
- The periods in `docs/decisions.md` as rows in the due list.
- Export one firm as a file. Delete one firm.
- On Greg's machine: restore the practice database to an earlier point, once, and write down what happened.

**Done when:** with the pretend clock moved 31 days on, a recording is gone and its call remains.

### [ ] I. Before the first real firm

A checklist, not a feature. Greg does most of it.

- The live environment created, with its database and file store in the EU.
- Secrets set for live, different from practice.
- Every check passing. The restore tried.
- The voice agent's greeting says it is an automated assistant and that the call is recorded.
- The firm's number registered in the firm's name.
- The paperwork outside this repository: the agreement, the privacy wording, the ICO fee.

## 4. The record

Design the columns in the slice that needs them. These are the things, and what each must carry.

| Thing | Carries |
|---|---|
| Firm | Name. The number its customers ring and text. A switch for each service. The stop button. What counts as urgent. When visits can be booked. Agreed wording for each kind of message. Whether it is an example |
| Owner | Belongs to a firm. Name. Mobile, for alerts and the login link |
| Staff | Front-line's own people. Not part of any firm |
| Customer | Belongs to a firm. Name as given. Mobile, email, address. Whether they have confirmed their details. Opt-outs by kind |
| Job | Belongs to a firm and a customer. What it is about. Where. Its state |
| History | What happened, to which job or customer, who did it (Front-line, the owner, the customer, staff), and when. Never edited |
| Call | The provider's id for it. Who rang. When. The outcome. A summary. Where the transcript and the recording are kept. When they are due to be deleted |
| Visit | A job, a start, an end, a kind (quote visit, install, service), a state |
| Message | Who to. Its kind. The words. Its state (waiting, sent, delivered, failed). The provider's id. How many segments |
| Due row | What to do. When. The latest time it may still be done. Claimed, done or cancelled |

The job states in the example are: needs your OK, waiting on customer, booked, accepted, on today, sent, overdue, paid, urgent. Release 1 produces booked, on today and urgent.

## 5. Where things run, and who does what

| Copy | What it is | Data |
|---|---|---|
| This machine | `npm run dev`, with a fake behind every provider | Invented |
| Practice | The deployed system with test keys | Invented, plus Greg's own test calls |
| Live | Real firms | Real |

**A cloud session** writes code and tests against the fakes and opens a pull request. It holds no keys. It cannot reach Cloudflare, Vapi or Twilio, and must not try.

**Greg's own machine** is where the real accounts are connected: creating the databases and file stores in the EU, setting secrets, deploying practice, pointing a test number at it.

**Greg** tests each slice on his phone, merges, and decides.

**The practice gate.** Practice has no public pages. Until slice F the owner's pages have no login of their own, and the control room never has a public one. The working assumption is Cloudflare Access in front of practice and in front of the control room, with the Worker checking Access's token. The routes Vapi and Twilio call sit outside the gate and are protected by their own secrets and signatures. Greg has not confirmed this yet. See `docs/decisions.md`.

## 6. Wording

The example app is the source of every word an owner or a customer reads. Build the wording as data, so it can be changed for a firm without a release.

Release 1 sends two texts to customers. The example has them as:

> Hi Mrs Ahmed, it's Tidewell Heating. Tom will be with you on Thursday 1 October at 3pm to look at your boiler and price a new one. Need to change it? Just reply here.

> Reminder: Tom's visit is tomorrow, Thursday, at 3pm. See you then.

Three things change from the example. The second and third are drafts until Greg says yes.

1. **Apostrophes.** The example's texts use curly apostrophes. One of those puts the whole text into a format that holds 70 characters a segment in place of 160. Use straight ones.
2. **The first text to a new customer** also needs a link to confirm their details and a line on opting out. The words for those two additions are not agreed. Leave named gaps for them.
3. **History lines.** The example's job pages say "Sent her a confirmation" and "Answered his call". Real records will not reliably know which to use. Leave the pronoun out on a job page: "Sent a confirmation", "Answered the call". The feed already uses names: "Sent Mrs Ahmed a confirmation."

Two parts of the example are out of date. Flag them when you reach them and do not copy them:

- "Your rules" says messages go from a WhatsApp number. They go by text from the firm's own number.
- The preview of what the customer gets is described as WhatsApp.

There is no agreed wording yet for the alert an owner gets about an urgent call. Use a named gap.

## 7. The acceptance story

Release 1 is right when the real system, with a pretend clock and a fake behind every provider, produces this. It is the start of the example job in `reference/example-app/film.js`, plus three other calls from the example's seed. All times are UK time.

1. **Monday 28 September 2026, 11:15.** A call to Tidewell Heating ends. Mrs Ahmed, 27 Station Road. Her boiler keeps cutting out and she wants a new one priced. A quote visit is agreed for Thursday 1 October at 3pm.
   Expect: one customer, one job, one visit in the diary, and history for the call answered, her details taken and the visit booked.
2. **11:16.** The confirmation text goes to her, once.
3. **Wednesday 30 September, 13:00.** The reminder goes to her, once. Run the worker twice at 13:00 and it still goes once.
4. **Thursday 15 October, 08:10.** Mrs Green rings. No hot water since last night. A quote visit is booked for Monday 19 October at 9am, and her confirmation goes at 08:11. Her reminder goes on Sunday 18 October at 13:00.
5. **08:26.** A supplier rings to say an order is ready to collect. Expect a call with a message, and no customer or job.
6. **11:02.** Mr Price rings about a leak under the kitchen sink. Leaks are on the firm's urgent list. Expect the owner alerted at once, no visit booked, and the job marked urgent.
7. **The clocks.** They go back on Sunday 25 October 2026. A visit on Monday 26 October at 9am gets its reminder on Sunday 25 October at 13:00 UK time, which is 13:00 UTC. The reminder in step 4 went at 12:00 UTC. Also test a visit on Monday 29 March 2027, the day after the clocks go forward.
8. **The stop button.** Turn it on for Tidewell Heating before step 2. Nothing goes. Turn it off after Thursday 1 October. Neither text is sent late: both are skipped, and that is recorded.
9. **The wall.** A second firm with a customer on the same mobile number as Mrs Ahmed. Nothing from one firm appears in the other.

## 8. Built in for data protection

Each of these is needed before a real customer's call is answered.

| What | Slice |
|---|---|
| Firms kept apart, with a test that tries to cross the line on every change | B |
| Stored in the EU. This can only be chosen when a database or a file store is created | Greg, when he creates them |
| Each routine is sent only the fields it needs | From Release 2 |
| A history of who did what, including every control-room view | B, G |
| The clock deletes when a period runs out | D, H |
| One customer found, exported or deleted from the control room | G |
| One firm exported and deleted | H |
| Opt-outs kept for each customer and each kind of message, and checked before every send | D |
| Customer pages on links that cannot be guessed and that expire | E |
| Recordings in Front-line's own store | H |
| Logs that carry ids, not names or message text | A, and every slice |
| A restore tried before the first real firm | H, I |

## 9. Questions the build must not answer for itself

Each is listed in `docs/decisions.md` with what is assumed in the meantime. Where one stops a slice, build what does not depend on it and raise it in the pull request.

1. The words for the opt-out line and the confirm-your-details link in the first text.
2. What a customer's STOP does. Twilio's own handling can block every later text from that number, appointment reminders included. Opt-outs here are by kind of message.
3. What "passed straight to you" means for an urgent call: the live call put through to the owner, a text alert, or both.
4. How long a visit takes, and when no reminder is sent because the visit is too soon.
5. When a second call from the same customer joins their open job, and when it starts a new one.
6. How long an owner stays logged in.
7. The words of the owner's alert for an urgent call.
8. Quiet hours, and whether anything is held back on a Sunday.
9. The web address for the app and for customers' links.
