# Texts to agree

New texts to customers from task 5 of `docs/autopilot.md`, with the build's draft wording. Every line here is **[to agree]**: Greg agrees it, then each firm's owner agrees their own version, as for every text (rule 2). Words a customer reads also go to the solicitor with the rest (open question 1).

Nothing here goes to anyone yet. The three texts that are built are switched off on every copy: a copy sends one only when its `TEXTS_ON` setting names it (`wrangler.jsonc`), and that setting is empty everywhere. To switch one on for practice, after the wording is agreed: put its name in practice's `TEXTS_ON`, deploy, and agree the wording for the practice firm in the control room.

Texts use straight quotes and no emoji (rule 4). Each draft below stays within two texts (segments), even with the longest names a call gives; a test checks that.

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
