# Checks on practice

Checks that can only be made against the real providers, on practice, with what happened written down. Slice I asks for them before the first real firm. The restore of the practice database has its own page, `docs/restore.md`.

Nothing here runs from a cloud session. Run it on your own machine, logged in to Wrangler (`npx wrangler login`), from the root of this repository, with your Vapi private key in the `VAPI_API_KEY` environment variable. Never print the key or write it to a file.

If Wrangler or the script says "fetch failed", run this in the same terminal first, then the command again:

```powershell
$env:NODE_OPTIONS="--dns-result-order=ipv4first"
```

## A call's recording reaches the inbox

What it shows: Vapi accepts the agent's settings, sends its report with the right secret, and writes the recording into Front-line's own inbox in the EU, under the firm's path, with no copy of its own.

### 1. Set the agent

Set the practice agent from its file, as `docs/vapi.md` says: once without `--apply`, to see what would change, then with it.

```sh
node scripts/vapi-assistant.js <the practice agent's id> vapi/practice-assistant.json --apply
```

### 2. Watch the Worker

```sh
npx wrangler tail --env practice --format pretty
```

Wait until it shows the clock's line, `"* * * * *" @ … - Ok`, once a minute. A tail lasts a few hours and can drop out, so start it just before the call.

### 3. Make a web call

In Vapi's dashboard: **Assistants**, then the practice agent, then **Talk to Assistant**. Allow the microphone. Use invented details only, such as Mrs Ahmed, 27 Station Road, a boiler that keeps cutting out. Then **End Call**.

A web call is to no number, so Front-line finds no firm for it. That is expected: it shows the secret was accepted, without keeping anything.

### 4. Check

- **The Worker's log**: a `POST …/vapi/server - Ok` with `call_for_unknown_number`. `call_report_refused` means the secret is wrong: stop.
- **The call in Vapi** (`GET https://api.vapi.ai/call?assistantId=<id>`, then the call by its id): `artifact.recordingUrl` is at the account's EU R2 address, under `firms/<the firm's id>/`, and no address in the call is Vapi's own storage.
- **The file in the inbox.** Wrangler cannot list a bucket's files, and `r2 bucket info` lags, so read the file by its name, counting its bytes without saving it:

  ```sh
  npx wrangler r2 object get "frontline-practice-calls-in/firms/<firm id>/<file name>" --jurisdiction eu --remote --pipe | wc -c
  ```

- **The structured data** (`analysis.structuredData`): the fields of the schema in `docs/vapi.md`, and no `urgentMatch` while the firm has no urgent list.
- **What Vapi keeps**: which of the transcript, messages and summary are on the call.

## What happened: the web call

| | |
|---|---|
| Date | 13 October 2026, slice I |
| Who ran it | Greg made the call. Claude Code, on his machine, set the agent and ran the checks he agreed |
| The agent | The practice agent, set from `vapi/practice-assistant.json` on 12 October 2026: greeting, instructions, `serverMessages` `end-of-call-report`, `structuredDataPlan` on. Vapi took every field; read back, it matched the file |
| The call | A web call, 09:48:47Z to 09:50:08Z, ended by the caller. Vapi's id `01a134aa-206b-7000-8d82-815b22ee7e39` |
| The Worker's log | **Pass.** `POST /vapi/server - Ok` at 09:50:14Z, logging `call_for_unknown_number`. No `call_report_refused` |
| Where Vapi put the recording | **Pass.** `artifact.recordingUrl` at the account's EU R2 address, `/firms/6g9dmtzcgtcwqa867j1hb6szc3/01a134aa-…-mono.mp3`. Every recording address on the call was there; none was Vapi's own storage. That is all Vapi's API shows: whether it keeps a copy out of sight cannot be checked |
| The file in the inbox | **Pass.** Read from `frontline-practice-calls-in` (EU) by its name: 343,076 bytes, an MP3. Not saved. `r2 bucket info` still said 1 file of 69 bytes: its count lags |
| The move into `frontline-practice-files` | **Not tried.** A web call finds no firm, so nothing is kept and nothing moves. Done later the same day, with a call to the practice number: see below |
| The structured data | **Pass, for a caller who is not a customer.** `callerType` `other`, `whoRang` "someone trying to get a cupcake recipe", and a one-sentence `summary`. No `urgentMatch`, and no field held "null". The caller asked for a recipe and the agent took a message instead. The customer's fields were not tried |
| What Vapi keeps | The transcript (1,083 characters), the conversation as 16 messages, the structured data, the times and costs, and the addresses of the recordings in our inbox. No summary |
| What surprised us | Vapi wrote four recordings, not one: the call, a stereo copy, the agent alone and the caller alone, all under the firm's path; Front-line moves only the first, and the inbox's rule deletes the rest after a day. Vapi's own call log went to the top of the inbox. The call held signed links to each file in the inbox, good until 10:22Z, about half an hour after the call. The call was handled in Vapi's US region (control address in AWS `us-west-2`): a blocker for live, under open question 10. The recording addresses name no bucket, which does not matter, since Front-line reads only the path. The first tail failed to log in to Cloudflare until IPv4 was preferred, and later ones dropped out overnight |

## A text and a call to the firm's number

What it shows: the firm's own number reaches Front-line by both routes. A text comes in through Twilio, signed with the account's auth token, and is kept for the firm. A call comes in through Vapi, is kept for the firm with its customer and job, and its recording moves from the inbox into Front-line's file store.

### 1. Join the number up, in this order

1. **The record.** In the control room, the firm's page, Set-up, Number: the 07 number. First, so nothing that arrives is for an unknown number.
2. **Vapi.** `scripts/vapi-import-number.js`, with a Twilio API key for Vapi, as `docs/vapi.md` says. It leaves the messaging webhook alone.
3. **Twilio.** The number's messaging webhook: `POST https://<the copy's address>/twilio/texts`. Last, so the import cannot overwrite it.

Practice's `TWILIO_AUTH_TOKEN` and `TWILIO_ACCOUNT_SID` must be the **live** credentials of the account that holds the number. Anything else shows as `twilio_refused` on every text.

### 2. Watch the Worker, then text and ring

Start the tail as above. Text the number something plain, not STOP or START. Then ring it as an invented customer: a name, what the job is about, and the address.

### 3. Check

- **The text**: `POST …/twilio/texts - Ok` with `text_in_stored`, naming the firm.
- **The call**: `POST …/vapi/server - Ok` with `call_stored`, naming the firm. With Calls & bookings off there is also `call_while_calls_off`: the call is still kept.
- **In the record**, by the call's Vapi id (ids and states only): the call's customer and job, both the firm's, and their history.
- **The recording**: `recording_moved` in the log within a minute or so; the call's recording state `kept`; the file in `frontline-practice-files` under `firms/<firm id>/calls/<call id>.mp3`; and gone from the inbox.

## What happened: the practice number

| | |
|---|---|
| Date | 13 October 2026, slice I |
| Who ran it | Greg set the number on the firm, set Twilio's messaging webhook, reset the Twilio secrets, and made the texts and calls. Claude Code, on his machine, brought the number into Vapi and ran the checks he agreed, read only |
| The number in Vapi | **Pass.** Brought in with `scripts/vapi-import-number.js` at 17:02:59Z, as Vapi's `b65a8462-f7bb-427e-a46c-6a02eed51711`: answered by the practice agent, `smsEnabled` false, no server address of its own, status active |
| The number in Twilio | **Pass.** Read from Twilio's API: a call comes in to `https://api.vapi.ai/twilio/inbound_call` (POST); a message comes in to exactly `https://practice-app.vanrooyenenterprises.com/twilio/texts` (POST), no fallbacks. Voice and SMS on, its regulatory bundle present |
| The first text | **Fail, then put right.** 17:14:59Z: `twilio_refused`, a 401. Practice's Twilio secrets were not the live credentials of the account holding the number. Greg set `TWILIO_AUTH_TOKEN` and `TWILIO_ACCOUNT_SID` again, from that account's live credentials |
| The second text | **Pass.** 17:26:10Z: `text_in_stored`, for firm `6g9dmtzcgtcwqa867j1hb6szc3`, as Front-line's text `2b95zas7sdc7ybd1661yb99kqr` |
| Three short calls | Greg hung up on purpose during the greeting, at 17:15Z, 17:24Z and 17:26Z (Vapi's `01a13642-…`, `01a1364b-…`, `01a1364c-…`). Each was kept for the firm as a message with its details missing, no customer and no job (Front-line's `73fqk2rykqxbtvak8at52y57qm`, `07vypma8zzjwnjf672emf4jg38`, `7d8ejax871caf10cyanvfsjefr`), and each recording moved |
| The full call | Vapi's `01a13650-91e4-7ff0-b726-362d81ee3e42`, 17:30:12Z to 17:31:28Z, ended by the caller. The report came at 17:31:34Z: `call_stored` and `call_while_calls_off`, for the firm, as Front-line's call `6afc5906cs4jdqr12qavpcy4wa` |
| The customer and job | **Pass.** A new customer, `1rfww3jctxn6qh7rdw2p87venh`, and a new job for them, `1anfa8bemjv3ah27yx3r854fr4`, both the firm's. History: `call_answered` on the job; `call_answered` and `details_taken` on the customer. The outcome is a message: booking is left out for now. Not urgent: the firm has no urgent list |
| The structured data | **Pass.** `callerType` `customer`, with `name`, `about`, `address` and `summary` all text, within their lengths, with no line breaks. No other fields, and no `urgentMatch`. The address came out as a misheard postcode: the caller gave a postcode, and the agent asks for the first line |
| The recording | **Pass.** `recording_moved`; state `kept`; in `frontline-practice-files` at `firms/6g9dmtzcgtcwqa867j1hb6szc3/calls/6afc5906cs4jdqr12qavpcy4wa.mp3`, 444,284 bytes, read without saving; gone from the inbox; due to be deleted on 12 November 2026 |
| Not tried | A text going out, and its delivery report: none is sent while booking is left out and Calls & bookings is off. STOP and START. Capturing one real request of each kind for `test/fixtures/` (`docs/twilio.md`, `docs/vapi.md`) |
| What surprised us | Twilio's secrets on practice were not the number's account's live ones, which only a real text showed. The tail stopped receiving without saying so, at about 17:14Z, and missed one report: the record showed the call was kept. The calls were handled in Vapi's US region again. The caller's real first name and part of a postcode are on practice and in Vapi's record of the full call, as the brief allows for Greg's own test calls; they are not written here |

## What happened: the postcode call

What it shows: the agent's new instructions and schema (postcode and first line asked for apart, the postcode read back) and the Worker that joins the two, together on practice.

| | |
|---|---|
| Date | 14 October 2026, slice I (`slice-i-address`, pull request 10) |
| Who ran it | Greg made the call. Claude Code, on his machine, deployed the branch to practice (version `a41028dd-af02-4f1e-80b2-06b4084da5ee`), set the agent from its file with his go-ahead, and ran the checks he agreed, read only |
| The agent | Set from `vapi/practice-assistant.json` at commit `0d394db`: only `model` and `analysisPlan` changed. Read back, it matched the file |
| The call | Vapi's `01a13abe-c4d3-7336-95e7-8badadfe2e0e`, 14:09:03Z to 14:10:26Z, to the practice number, ended by the caller (`customer-ended-call`). Kept as Front-line's call `1xjczgwrmvkt7hyenswqqwye01`, a message, for firm `6g9dmtzcgtcwqa867j1hb6szc3` |
| The structured data | **Pass.** `callerType` `customer`, with `name`, `about`, `address` "6 Bridge Street", `postcode` "ZZ1 4AB" and `summary`. The postcode in its own field and the first line alone in `address`, where the call on 13 October put a misheard postcode. No `urgentMatch` |
| The customer and job | **Pass.** A new customer, `6fpwtytgbn00mg46cwqegm967y`, with the address "6 Bridge Street, ZZ1 4AB", and a new job, `7w5swk4bk4xqrtc7rzf6x6yn99`, with the place "6 Bridge Street, ZZ1 4AB". History: `call_answered` on the job; `call_answered` and `details_taken` on the customer |
| The recording | **Pass.** State `kept`; in `frontline-practice-files` at `firms/6g9dmtzcgtcwqa867j1hb6szc3/calls/1xjczgwrmvkt7hyenswqqwye01.mp3`, 476,360 bytes, read without saving; gone from the inbox; due to be deleted on 13 November 2026 |
| The first line read back | **Pass.** The agent heard "66 Ridge Street", read it back, and took the caller's correction, "6 Bridge Street" |
| The postcode read back | **Known issue.** The agent read it back in chunks, "ZZ1. 4AB", not one letter or number at a time as its instructions say. That is the agent's own words in Vapi's record of the call, not only how they were heard. It did wait for a yes before going on |
| The second try, with a word for each letter | **Not tested.** The caller said yes the first time |
| The end of the call | **Known issue.** The agent said goodbye, then went on answering the caller's goodbyes, and did not end the call; the caller did |
| What surprised us | The call was handled in Vapi's US region again (control address in AWS `us-west-2`). The caller's real first name is on practice and in Vapi's record of the call, as the brief allows for Greg's own test calls; it is not written here. The two known issues are to be fixed on Vapi's OpenAI realtime model, not on this one: see open questions 12 to 14 in `docs/decisions.md` |

## Checking a call in one go

After a test call, one command shows what happened on it, from both sides, and checks they agree:

```sh
npm run practice:last-call
npm run practice:last-call -- --call <Vapi's id for the call>
npm run practice:last-call -- --transcript
```

Run it on your own machine, with your Vapi private key in `VAPI_API_KEY`. It uses `cloudflared` to reach the control room as you: the first time, your browser opens for you to log in to Cloudflare Access. Neither the key nor the token is printed.

What it shows, for the newest call to the practice agent, or the one named:

- **From Vapi:** when the call ran and how it ended; the date line as Vapi filled it in; each tool the agent used, with its arguments (and whether they came as text or an object) and what Front-line answered, `text` included; whether the caller's number came through, as "mobile", "landline" or "withheld"; and which details the agent took down, by name only, with the caller type and the urgent item.
- **From Front-line** (the control room's report, `GET /control/firms/<firm>/calls/vapi/<Vapi id>`): the call's outcome and recording; the customer, new or known; the job; the visit; the time held and what became of it; every row in the due list for the call and its visit, with UK times; and every text, the owner's urgent alert among them, with its state.
- **Booking:** each time the agent asked for free times, with the `day` it gave or "no day", and the times it was given; each time it booked, with the start it gave and what it was told: booked, with whether a text was promised, or why not (taken, not offered, or could not be read); and, from Front-line, whether the customer's confirmation and the owner's text about the booking were sent, are held for quiet hours (with when they go), are waiting, or did not go and why. "None due" means the call booked no visit.
- **Checks:** whether the two agree. For example: the agent was told a time was booked but no visit was filed; a confirmation was promised but did not go; the visit is not at the time booked; the agent marked a call urgent for something not on the firm's list; the agent used `free_times` or `book_visit` on a call it marked urgent, which its instructions forbid (this one needs only Vapi's side, so it is checked even when Front-line has no report); or the caller's number reads differently on each side. It ends with a failure when any check does not agree.

No name, number, address or words from the call are printed, unless you add `--transcript`, which shows the conversation on screen and saves nothing.

It changes nothing. It asks Vapi and the control room with GET only, and a test fails if it tries anything else; it does not reach Twilio at all, whose delivery reports are already in the record. Opening the report is a view in the control room, so the staff log records it, naming you (rule 15). That is the one row it adds.

## What happened: the first booking call

What it shows: the agent booking a quote visit on a real call to the practice number for the first time, and the confirmation held by quiet hours.

| | |
|---|---|
| Date | 14 October 2026, slice I (`slice-i-booking`, pull request 12) |
| Who ran it | Greg made the call and checked Front-line's side by hand in the control room. Claude Code ran `npm run practice:last-call` from `slice-i-call-report` on 15 October, read only, for Vapi's side |
| The Worker and the agent | Practice ran `f2b4a3c`, and the agent was set from its file at `4d1dd25`, before the times were spread across days and before the next-day notice (open questions 15 and 16) |
| The call | Vapi's `01a13bda-fc28-7886-ab7b-3ea369a83fc5`, 19:19:30Z to 19:20:48Z, ended by the caller. The date line read "Wednesday 14 October 2026", as it should |
| The tools | `free_times` with `day` `2026-10-15`, 43.0s in, given Thursday 15 October at 8am, 9am and 10am. `book_visit` with `2026-10-15T09:00`, 61.6s in: booked, `text` true. The arguments came as text |
| The visit | **Pass.** Booked for Thursday 15 October at 9am, and filed on the job |
| The confirmation | **Pass.** Held overnight by quiet hours, and arrived at 8am on 15 October |

## What happened: the booking calls

What it shows: the agent booking a quote visit on a real call to the practice number, with the times spread across days, the notice on the next working day, a day named by the caller, a change of mind on the same call, a visit after the clocks go back, and both texts that follow a booking. Also an urgent call, which books nothing.

| | |
|---|---|
| Date | 15 October 2026, slice I (`slice-i-booking`, pull request 12) |
| Who ran it | Greg made the calls and checked Front-line's side by hand in the control room. Claude Code, on his machine, set the agent from its file with his go-ahead and ran `npm run practice:last-call` from `slice-i-call-report`, read only |
| The Worker and the agent | Practice runs `2934c9e` (version `b6a8db29-2538-4f4f-9b4b-10c0949c34d9`). The agent was set from `vapi/practice-assistant.json` at the same commit: only `model` changed (the wording on when to give a `day`). Read back, it matched the file, and a second read-only run found nothing to change |
| Front-line's side of the report | **Missing.** Practice does not yet run `slice-i-call-report`, so the control room's report on a call is not there, and `npm run practice:last-call` says "Front-line: no call with this id" and ends with a failure. Vapi's side was read from the report; Front-line's side (the visit, the texts, the alert) was checked by hand in the control room |
| 1. No day named | Vapi's `01a13f89-16b8-700f-aa69-1065bc6c57e6`, 12:28:31Z to 12:30:08Z, ended by the caller. `free_times` called once, with no day, and given Friday 16 October at midday, Monday 19 October at 8am and Tuesday 20 October at 8am: the first time on each of the next three working days, with Friday from noon (the next-day notice) and the weekend left out. `book_visit` with `2026-10-19T08:00`: booked, `text` true |
| What followed | **Pass.** The customer's confirmation and the owner's text about the booking both arrived. The confirmation's link opened without a Cloudflare login. The control room showed the visit on the job |
| 2. An urgent leak | Vapi's `01a14009-3bf3-7993-aba5-878252a0fb27`, 14:48:29Z to 14:49:59Z, ended by the caller. `urgentMatch` "a leak", `callerType` `customer`. `book_visit` not called |
| The alert, and nothing booked | **Pass.** Nothing was booked, and the owner's alert arrived |
| Free times on the urgent call | **Fail: a bug, since fixed.** The agent called `free_times` with `day` `2026-10-16`, 41.7s in, and was given Friday 16 October at midday, at 1pm and at 3pm. Its instructions say not to book a visit when the call is about a leak, so it had no reason to ask. Greg heard no times offered; whether the agent said them is in the conversation, which the report shows only with `--transcript`, and was not looked at. Its rules on danger came after the booking rules and said only "do not book". Fixed on `slice-i-urgent-no-times` (`77ee413`): the rules on danger come first and forbid both tools, and each tool's description says the same. Applied to the practice agent the same day; see call 5 |
| The end of the urgent call | **Known issue.** The agent did not end the call after its goodbye, as on the postcode call |
| 3. A day named, then a change of mind | Vapi's `01a1400c-6180-7773-b506-82c890f80b55`, 14:51:56Z to 14:53:27Z, ended by the caller. `free_times` first with no day, given Friday 16 October at midday, Monday 19 October at 9am and Tuesday 20 October at 8am; Monday's 8am was the visit booked on call 1. Then `free_times` with `day` `2026-10-21`, given Wednesday 21 October at 8am, at midday and at 3pm: the earliest, the one nearest midday and the latest. `book_visit` with `2026-10-21T08:00`: booked, `text` true. Then `book_visit` with `2026-10-21T12:00`: booked, `text` true, moving the time held on the call |
| What followed | **Pass.** Greg checked it all worked as expected |
| 4. The clocks going back | Vapi's `01a14014-91ca-7993-ac65-0b2156452d6d`, 15:00:52Z to 15:02:18Z, ended by the caller. `free_times` first with no day, given Friday 16 October at midday, Monday 19 October at 9am and Tuesday 20 October at 8am. Then with `day` `2026-10-26`, the first working day after the clocks go back on Sunday 25 October, given Monday 26 October at 8am, at midday and at 3pm. `book_visit` with `2026-10-26T08:00`: booked, `text` true |
| The visit and its confirmation | **Pass.** The control room and the confirmation both show 8am |
| The reminder | **Pending, until Greg checks it.** Due on Sunday 25 October at 13:00 UK time, which is 13:00 UTC once the clocks have gone back |
| 5. An urgent leak, after the fix | Vapi's `01a14032-5634-7550-bc89-0867ba755d3d`, 15:33:23Z to 15:34:40Z, ended by the caller, with the agent set from its file at `77ee413`. `urgentMatch` "a leak", `callerType` `customer`. The caller asked for someone to come tomorrow, and what times there were. Read with `npm run practice:last-call -- --transcript`, on screen only |
| The tools | **Pass.** Neither `free_times` nor `book_visit` was used and no time was offered. The agent said it could not book a visit as the call was about a leak, and that it would pass the details to the firm as soon as the call ended. The report's new check, a booking tool used on a call marked urgent, found nothing |
| The safety advice | **Fail.** The agent made up its own: to be careful, and if there were "any signs of electrical issues" or it became unsafe, to leave and call 999 if anyone was in immediate danger. Its instructions give safety advice only for gas and carbon monoxide |
| How soon | **Fail.** After saying it would pass the details on as soon as the call ended, the agent added "Someone will get back to you as soon as possible", which its instructions do not say for an urgent call |
| Put right | Two lines added beside the rules on danger, in Greg's wording, for practice only: "Give only the safety advice written in these instructions. Never add your own." and "Don't say how soon anyone will get back to them." Not yet tried on a call |
| Known issues, again | The agent read the postcode back in one piece, not a letter or number at a time. The caller ended the call straight after the agent's goodbye, so whether the agent would have ended it was not seen |
| What surprised us | The tools' arguments came as text, as on 14 October. The callers' real details are on practice and in Vapi's record of each call, as the brief allows for Greg's own test calls; they are not written here |
