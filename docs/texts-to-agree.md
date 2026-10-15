# Texts to agree

New texts to customers from task 5 of `docs/autopilot.md`, with the build's draft wording. Every line here is **[to agree]**: Greg agrees it, then each firm's owner agrees their own version, as for every text (rule 2). Words a customer reads also go to the solicitor with the rest (open question 1).

Nothing here goes to anyone yet. The three texts that are built are switched off on every copy: a copy sends one only when its `TEXTS_ON` setting names it (`wrangler.jsonc`), and that setting is empty everywhere. To switch one on for practice, after the wording is agreed: put its name in practice's `TEXTS_ON`, deploy, and agree the wording for the practice firm in the control room.

Texts use straight quotes and no emoji (rule 4). Each draft below stays within two texts (segments), even with the longest names a call gives; a test checks that.

## Trade starter packs [to agree]

Task 2 of queue 2. Choosing a firm's trade in the control room fills in its urgent list and diary rules, where it has none yet, and starts its wording pages from these drafts. Nothing is agreed or sent by a pack: each owner still agrees their own words (rule 2). The packs are in `src/trade-packs.ts`.

### What counts as urgent [to agree]

The owner reads these in Your rules, and the voice agent marks a call urgent, and alerts the owner, when it matches one.

- **Plumbing & heating:** a leak; a burst pipe; a smell of gas; a carbon monoxide alarm
- **Drainage:** sewage coming up; a drain overflowing; the only toilet blocked
- **Electrical:** no power; a burning smell; sparks from a socket or switch; water near electrics; an electric shock

### The reminder [to agree]

Each trade's reminder adds one line about what the visit needs. The other texts start from the drafts every firm starts from.

> Plumbing & heating: Reminder: {owner}'s visit is tomorrow, {weekday}, at {time}. Please make sure we can get to the boiler and the pipes. See you then.

> Drainage: Reminder: {owner}'s visit is tomorrow, {weekday}, at {time}. Please make sure we can get to the drain covers. See you then.

> Electrical: Reminder: {owner}'s visit is tomorrow, {weekday}, at {time}. Please make sure we can get to the fuse box. See you then.

### Hours and visit lengths (the build's starting points, for Greg to check)

- **Plumbing & heating:** Monday to Friday, 8am to 5pm, on the hour; quote visit 60 minutes, service 60 minutes; up to 14 days ahead; on the next working day, nothing before noon.
- **Drainage:** Monday to Saturday, 8am to 6pm, on the hour; quote visit 45 minutes; up to 7 days ahead; on the next working day, from 8am.
- **Electrical:** Monday to Friday, 8am to 5pm, on the hour; quote visit 60 minutes; up to 14 days ahead; on the next working day, nothing before noon.

### Staff's words (control room only)

"Trade", "Choose its trade", "Plumbing & heating", "Drainage", "Electrical", the hint on the trade page, "Every pack's urgent list and words are drafts, [to agree] with Greg.", "Reminder draft", "Not chosen", "Kept as it is: the firm has its own list.", "Kept as they are: the firm has its own rules.", "Choose a trade." and, on a wording page, "Not agreed yet. These are the draft words from the {trade} starter pack, [to agree] with Greg."

## Built, switched off

### When a visit moves: `visit_moved_notice` [to agree]

> Hi {customer}, it's {firm}. {owner}'s visit has moved to {day} at {time}. Need to change it? Just reply here.

- Goes when a visit moves, with its new day and time, at once (or at 8am, after quiet hours), until the visit's new start.
- Only to a customer whose confirmation went. If their confirmation is still waiting, it gives the new time itself, so this one is not written.
- Two moves close together send one text, with the latest time.
- The owner sees "Told them the visit has moved." on the job, and "Told {customer} their visit has moved." in Done for you. **[to agree]**

### When a visit is cancelled: `visit_cancelled_notice` [to agree]

> Hi {customer}, it's {firm}. Your visit on {day} at {time} is cancelled. Need a new time? Just reply here.

- Goes when a visit is cancelled, with the day and time it was, until it would have started.
- Only to a customer whose confirmation went.
- The owner sees "Told them the visit is cancelled." and "Told {customer} their visit is cancelled." **[to agree]**

### The morning after a quote visit: `visit_followup` [to agree]

> Hi {customer}, thanks for having {owner} round. {firm} will be in touch with the price. Any questions? Just reply here.

- Goes at 10am UK time the day after a quote visit that is still booked, until 8pm that day. **[to agree]**: the time, and whether it should go at all for a visit that did not happen (Front-line cannot tell yet).
- Moves with the visit, and goes with it if it is cancelled.
- The owner sees "Thanked them after the visit." and "Thanked {customer} after the visit." **[to agree]**
- It says the firm "will be in touch with the price". Quotes are not in Release 1, so the owner sends the price themselves. **To decide:** whether that promise is right for every firm.

Staff see each in the control room as "Visit moved text", "Visit cancelled text" and "Text after the visit", and on the wording pages marked "(switched off)".

Before any of these can be switched on, the owner's app needs buttons to move and cancel a visit. Today only the voice agent books, and nothing in the app moves or cancels (Assumed: the buttons wait for these words).

## Drafted only, not built

### After a call with no details: `missed_call` [to agree]

> Hi, it's {firm}. Sorry we didn't get your details when you rang. Reply with your name and what you need, or call us back on {number}.

**Not built: a stop point.** The caller left no name or details, so they are not a customer, and nothing they said asked for a text. Whether a firm may text them back, and with what opt-out, is a data protection and PECR question for the solicitor. It also needs a decision on where their reply goes, since nothing answers texts in Release 1.

### Chasing a quote: `quote_followup` [to agree]

> Hi {customer}, it's {firm}. Just checking you got our quote for {job}. Any questions? Just reply here.

### Reminding about an unpaid invoice: `invoice_reminder` [to agree]

> Hi {customer}, it's {firm}. A reminder that invoice {invoice} for {amount} was due on {date}. You can pay here: {link}

**Not built.** Both need quotes and invoices, which are Releases 2 and 3 in `docs/build-brief.md`, where the brief says not to start on them yet. When their release comes, their timings (how many chasers, how far apart, when to stop) are to decide with them.
