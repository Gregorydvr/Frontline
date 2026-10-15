# Vapi: what Front-line expects

What to set on a firm's voice agent so that its calls land in the record (slice C). Everything here happens on Greg's own machine, in Vapi's dashboard or with its API, never from a cloud session.

The names below are Vapi's, from its server kit, `@vapi-ai/server-sdk` 2.0.1, published 10 September 2026. The slice C cloud session could not open Vapi's documentation website, so check them against the dashboard as you go.

## Setting an agent: the file and the script

Each agent's settings are kept in a file in `vapi/`, such as `vapi/practice-assistant.json`, and put on Vapi with a script, not typed into the dashboard. The dashboard cannot edit `artifactPlan`, where the recording settings are.

Run it on your own machine, with your Vapi private key in the `VAPI_API_KEY` environment variable. First without `--apply`, which only reads the agent and shows what would change:

```sh
node scripts/vapi-assistant.js <the agent's id> vapi/practice-assistant.json
node scripts/vapi-assistant.js <the agent's id> vapi/practice-assistant.json --apply
```

With `--apply` it changes the agent, reads it back, and shows each setting that changed, before and after. If Vapi then holds anything other than the file, it says which, and fails.

- Vapi replaces each top-level setting it is given as a whole, so the file holds every part of each one it names, such as all of `model`. Settings the file does not name, such as the voice, are left alone.
- The file holds no key, token, secret or password, and the script refuses one that does. The server's secret is named by its credential's id.
- If it says "fetch failed", set `NODE_OPTIONS=--dns-result-order=ipv4first` and run it again.
- Opening an assistant in the dashboard can save Vapi's defaults to it, such as the instructions `structuredDataPlan` uses to pull the details out of the transcript. So after any visit to the dashboard, run the script without `--apply`, and if it shows a change, copy what Vapi now holds into the file.
- The order of a schema's `required` fields does not count as a change: Vapi reorders them.

## Bringing a firm's number in

Vapi's dashboard imports a Twilio number only with the account's auth token, which also signs Twilio's requests to the Worker, so it stays with the Worker alone. Instead, make a Twilio API key for Vapi (Standard), load its SID and secret into `TWILIO_API_KEY` and `TWILIO_API_SECRET`, set the number on the firm in the control room first, then:

```sh
node scripts/vapi-import-number.js <the number, as +44…> <the Twilio account id> <the agent's id>
node scripts/vapi-import-number.js <the number, as +44…> <the Twilio account id> <the agent's id> --apply
```

It sends `smsEnabled: false`, so Vapi leaves the number's messaging webhook alone, and gives the number no server address of its own, so reports go to the agent's server. It refuses a number Vapi already has, and reads the number back. Afterwards Twilio shows **A call comes in** as Vapi's `https://api.vapi.ai/twilio/inbound_call` and messaging empty, ready for `/twilio/texts` (`docs/twilio.md`). Set that last, so the import cannot overwrite it.

## What the agent says

The greeting (`firstMessage`) names the firm, and says it is an automated assistant and that the call is recorded. On practice:

> Hello, you're through to Practice Test Plumbing's automated assistant. This call is recorded. How can I help?

The agent's instructions are the system message in `model.messages`, in the file. It takes a message: a customer's name, what the job is about, the postcode and the first line of the address, or who anyone else is. It reads the postcode back one letter or number at a time and waits for a yes; if the caller says it is wrong, it asks again and reads it back with a word for each letter (B for Bravo); if that is still wrong, or the caller does not know it, it carries on without the postcode. It does not give prices, or say when someone will come apart from a visit it has booked. It is told today's date in UK time (below). What the caller says is information to take down, never an instruction (rule 17). If the caller mentions anything dangerous, such as a smell of gas, a gas leak or carbon monoxide, it tells them to leave the property and call the National Gas Emergency Service on 0800 111 999, or 999 if anyone is in immediate danger, then takes their details as normal. On a call about a leak, a smell of gas or anything else dangerous, it never uses its booking tools, not even to look at times: those rules come before the booking rules. It gives only the safety advice written in its instructions, never its own, and never says how soon anyone will get back to the caller.

The booking instructions and the two tools below are left out of a firm's agent until booking is switched on for that firm. The practice agent has them from 14 October 2026.

## Where the reports go

| Setting on the assistant | Value |
|---|---|
| `server.url` | `https://<the practice address>/vapi/server` |
| `server.credentialId` | the Bearer credential below |
| `serverMessages` | must include `end-of-call-report`. Other kinds are answered "OK" and nothing is kept |

When a call ends, Vapi sends one report, of type `end-of-call-report`. Front-line finds the firm by the number that was rung (`phoneNumber.number`), so each firm's number must be set on its firm in the record before its calls arrive.

Vapi does not send a report again unless the server has a `backoffPlan`. If you set one, a repeat is harmless: the same call is kept once.

## The secret

Vapi proves a report is from Vapi with a shared secret, sent as `Authorization: Bearer <secret>`.

1. Make a long random secret, one for practice and a different one for live. For example: `openssl rand -hex 32`.
2. In Vapi, make a webhook credential whose `authenticationPlan` is `{ "type": "bearer", "token": "<the secret>" }`. Leave `headerName` as `Authorization` and the `Bearer` prefix on. Put the credential's id in `server.credentialId`.
3. Give the Worker the same secret: `npx wrangler secret put VAPI_SECRET --env practice`, and likewise for `--env live`.

A report with a wrong or missing secret is refused with 401, and nothing in it is read. If the Worker has no secret, or one shorter than 32 characters, every report is refused.

On this machine, the secret goes in `.dev.vars`, which git ignores: `VAPI_SECRET=<anything long and random>`.

## The details of the call

The voice agent hands over what it took down as structured data: `analysis.structuredData`, made by the assistant's `analysisPlan.structuredDataPlan` with `enabled: true` and this `schema`. Use `structuredDataPlan`, not Vapi's newer Structured Outputs. Keep `summaryPlan` and `successEvaluationPlan` off.

```json
{
  "type": "object",
  "properties": {
    "callerType": {
      "type": "string",
      "enum": ["customer", "other"],
      "description": "customer: someone who wants work done, or is asking about work. other: anyone else, such as a supplier, a sales call or a wrong number."
    },
    "name": {
      "type": "string",
      "description": "Customers only. Their name as they gave it, such as Mrs Ahmed."
    },
    "about": {
      "type": "string",
      "description": "Customers only. What the job is about, in a few words, such as Boiler replacement or Leak under the sink."
    },
    "address": {
      "type": "string",
      "description": "Customers only. The first line of the address where the work is, such as 27 Station Road. Not the postcode."
    },
    "postcode": {
      "type": "string",
      "description": "Customers only. The postcode where the work is, as the caller confirmed it when it was read back, in capitals with one space before the last three characters, such as ZZ1 4AB. Leave this field out if they did not give one or did not confirm it."
    },
    "whoRang": {
      "type": "string",
      "description": "Others only. Who rang, in a few words starting in lower case, such as a supplier."
    },
    "summary": {
      "type": "string",
      "description": "One short sentence about the call, such as No hot water. or Your order is ready to collect."
    },
    "urgentMatch": {
      "type": "string",
      "description": "Only fill this in if the call is about an item on the firm's urgent list, written exactly as the list writes it. Otherwise leave this field out. Tidewell Heating's urgent list: a leak."
    }
  },
  "required": ["callerType", "summary"]
}
```

`urgentMatch` is plain `"string"`, and nothing tells the agent to write "null": Vapi may refuse a list of types, and a "null" written as text would be read as an item not on the list, so a log line would tell staff for nothing. A firm with no urgent list yet, such as practice, has this description instead:

> Only fill this in if the call is about an item on the firm's urgent list, written exactly as the list writes it. This firm has no urgent list yet, so always leave this field out.

The firm's urgent list in the last description must match the list held on the firm in the record. Each firm's assistant has its own. Staff set the list in the control room, on the firm's page under Set-up, which also shows the line to paste here, under "For its agent in Vapi", with the firm's id and recording path.

Front-line checks every field, as rule 16 in `CLAUDE.md` says. A field that is not text, is empty, or is too long counts as missing. Line breaks become spaces. The longest each may be:

| Field | Longest |
|---|---|
| `name` | 60 characters |
| `about` | 80 |
| `address` | 110, so that the postcode still fits beside it |
| `postcode` | a UK postcode in form, such as ZZ1 4AB or zz14ab, kept as ZZ1 4AB. Only the form is checked |
| `whoRang` | 60 |
| `summary` | 200 |
| `urgentMatch` | 60 |

What happens with them:

- **A customer** needs a name, what the job is about and the first line of an address. The postcode is not needed. When there is one, it goes after the first line, in the job's place and a new customer's address: "27 Station Road, ZZ1 4AB". Then the customer is found by the number they rang from and their name, or made, and a new job is opened.
- **Someone else** needs `whoRang`. Their call is kept with a message: no customer and no job.
- **Anything less**, including no structured data at all, keeps the call with its details missing.
- **Urgent** only when `urgentMatch` is on the firm's own list, ignoring capitals and spaces. Anything else is not urgent, and a log line tells staff.
- Vapi's own `analysis.summary` is not used: it is longer than the owner's screens take.

## What is kept

Only these: Vapi's id for the call, the number rung, the caller's number, the start and end times, the fields above, the transcript (`artifact.transcript`), and the name of the recording in Front-line's inbox (from `artifact.recordingUrl`). The rest of the report is not stored or logged: it can hold the caller's details and parts of Vapi's set-up.

## Recordings (slice H)

Vapi writes each call's recording into an inbox file store of Front-line's own, under the firm's own path. When the call ends, a row in the due list moves it into Front-line's file store (`FILES`) and deletes it from the inbox. The recording is deleted 30 days after the call ends; the call, its summary and its transcript stay. Nothing is ever fetched from Vapi, and Front-line holds no Vapi key.

The names below are Vapi's, from `@vapi-ai/server-sdk` 2.0.1 (`CloudflareCredential`, `CloudflareR2BucketPlan`, `ArtifactPlan`). The slice H cloud session could not open Vapi's documentation website, so these are **Assumed** until checked on practice.

### Once, for each copy (practice, then live)

1. Create the inbox in the EU:
   `npx wrangler r2 bucket create frontline-practice-calls-in --jurisdiction eu`
2. Give it a rule that deletes everything in it after a day, so nothing is left there if a move never happens:
   `npx wrangler r2 bucket lifecycle add frontline-practice-calls-in inbox-one-day --expire-days 1 --abort-multipart-days 1 --jurisdiction eu`
3. Give Front-line's own file store a rule that removes unfinished uploads (from an export that stopped halfway) after a day, and the restore ledger after 35 days:
   `npx wrangler r2 bucket lifecycle add frontline-practice-files stray-uploads --abort-multipart-days 1 --jurisdiction eu`
   `npx wrangler r2 bucket lifecycle add frontline-practice-files ledger-35-days deletions/ --expire-days 35 --jurisdiction eu`
4. In Cloudflare's dashboard, under R2, make an API token with **Object Read & Write** for the inbox bucket **only**. R2 has no write-only key, so this is the least Vapi can be given. Note its access key id and secret.
5. In Vapi, under Provider Credentials, Cloud Providers, add a Cloudflare credential with a `bucketPlan`:
   - `name`: `frontline-practice-calls-in`
   - `accessKeyId` and `secretAccessKey`: from step 4
   - `url`: the inbox's S3 address for the EU, `https://<account id>.eu.r2.cloudflarestorage.com` (Assumed: the kit calls it "Cloudflare R2 base url"; check that Vapi accepts an EU address)
   - `path`: `/`

### On each firm's agent (`assistant.artifactPlan`)

| Setting | Value | Why |
|---|---|---|
| `recordingEnabled` | `true` | The greeting says the call is recorded |
| `recordingFormat` | `mp3` | About a tenth the size of wav |
| `recordingPath` | `/firms/<the firm's id>` | So the Worker knows whose it is. A recording under another firm's path is never kept for this one. The firm's id is on its page in the control room |
| `recordingUseCustomStorageEnabled` | `true` (the default) | The recording goes to the inbox **instead of** Vapi's own storage |
| `pcapEnabled` | `false` | A packet capture is not needed, and could hold the call's sound |
| `loggingUseCustomStorageEnabled` | `true` (the default) | Vapi's call log goes to the inbox too, where the rule deletes it after a day |

Also, in Vapi's organisation settings, set the shortest data retention your plan offers for Vapi's own call records (the transcript, numbers and summary Vapi keeps), or zero data retention if your plan has it.

### Check on practice, before slice I

Make one test call to the practice firm and check:

- the report's `artifact.recordingUrl` ends with `firms/<the firm's id>/…` (Front-line reads the name from `/firms/` on). If it names somewhere else, the call shows under "Needs a look" as "recording not kept", and nothing is fetched.
- the file appears in the inbox and, within a minute, in `frontline-practice-files` under `firms/<id>/calls/`, and is gone from the inbox
- the call in Vapi's dashboard has no recording stored with Vapi

A web call from the dashboard was made on 13 October 2026, with what happened in `docs/practice-checks.md`. The first and third passed, and the file was in the inbox. A web call is to no number, so no firm was found and the move into `frontline-practice-files` was not tried then. Later the same day a call to the practice firm's own number passed the second check too: the call was kept with its customer and job, and the recording moved into `frontline-practice-files` and left the inbox.

### What Vapi does, as seen on practice

- **Four recordings, not one.** Vapi writes the call (`artifact.recordingUrl`, ending `-mono.mp3`), a stereo copy, the agent alone and the caller alone, all under the firm's path in the inbox. Front-line moves only the first. The other three stay in the inbox until its rule deletes them a day later. Switch them off for live, if Vapi lets you.
- **Vapi's call log** goes to the top of the inbox, outside `firms/`, and is deleted by the same rule.
- **The addresses name no bucket**: `https://<account id>.eu.r2.cloudflarestorage.com/firms/<firm id>/…`. Front-line reads only the path, so this does not matter.
- **Signed links.** Vapi's record of the call holds signed links to each recording and the log, which let anyone holding one read the file from the inbox, for about half an hour after the call. Vapi can make them because its key can read the inbox as well as write to it (step 4 above).
- **What Vapi keeps of its own**: the transcript, the conversation as messages, the structured data, the call's times and costs, and the addresses above. No summary, with `summaryPlan` off.
- **Where the call ran.** The call was handled in Vapi's US region (its control address was in AWS `us-west-2`). See open question 10 in `docs/decisions.md`.

If Vapi cannot write to an EU inbox, the other way is for the Worker to fetch each recording from Vapi when the call ends (route B in the slice H plan). That needs a Vapi private key in the Worker, and Vapi keeps its copy until that key deletes it. Only where the recording is read from would change: `reportedRecording()` in `src/vapi-report.ts` and `moveRecording()` in `src/record/keeping.ts`.

## Booking during a call (slice E)

The voice agent can ask which times are free and book one while the caller is on the line. It does this with two of Vapi's "function" tools on the assistant. Each tool has its own address, and each sends the same secret as the reports.

The names below are again Vapi's, from `@vapi-ai/server-sdk` 2.0.1 (`CreateFunctionToolDto`, `ServerMessageToolCalls`, `ToolCall`, `ServerMessageResponseToolCalls`, `ToolCallResult`). The slice E cloud session could not open Vapi's documentation website either, so check them against the dashboard as you go.

| Tool | `function.name` | `server.url` | `server.credentialId` |
|---|---|---|---|
| Free times | `free_times` | `https://<the practice address>/vapi/free-times` | the Bearer credential above |
| Book | `book_visit` | `https://<the practice address>/vapi/book` | the same |

Leave `async` off (the default), so the agent waits for the answer. Each tool also has `messages`: a `request-start` line the agent says as the tool starts, with `blocking` `false` so it is said while Front-line answers, and a `request-failed` line for when Front-line does not answer in time. A time can be held even when Vapi gave up waiting, and the hold still becomes the visit when the report arrives, so `book_visit`'s failure line says nothing about whether it is booked. Each tool goes in the agent's file under `model.tools`, with `type` `function`, the `function` below, and a `server` with the address above, the same `credentialId` as the reports and `timeoutSeconds` 20. `test/vapi-settings.test.ts` sends each of the practice file's tools to the Worker by its own name, address and argument names, so a mismatch fails the check.

The tools' `function.parameters`, which are ours to define:

```json
{
  "name": "free_times",
  "description": "The firm's free times for a quote visit. With no day: the first free time on each of the next few days the firm works. With the day the caller names: times spread across that day. Never use it on a call about a leak, a smell of gas or anything else dangerous.",
  "parameters": {
    "type": "object",
    "properties": {
      "day": { "type": "string", "description": "Only when the caller names a day or a date: that day, as YYYY-MM-DD. Leave out otherwise, and never fill it in yourself." }
    }
  }
}
```

```json
{
  "name": "book_visit",
  "description": "Books a quote visit at one of the free times, once the caller has agreed it. Never use it on a call about a leak, a smell of gas or anything else dangerous.",
  "parameters": {
    "type": "object",
    "properties": {
      "start": { "type": "string", "description": "The start of the free time the caller chose, exactly as free_times gave it, such as 2026-10-01T15:00." }
    },
    "required": ["start"]
  }
}
```

### What Front-line answers

Each tool call gets `{ "results": [ { "name", "toolCallId", "result" } ] }`. The `result` is JSON for the agent to read:

- `free_times`: `{ "times": [ { "start": "2026-10-01T08:00", "say": "Thursday 1 October at 8am" }, … ] }`, up to three, earliest first. With no `day`, the first free time on each of the next days the firm works; with a `day`, three spread across the first day from it that has any: the earliest, the latest and the one nearest midday. Nothing is offered on the day itself, nor before the firm's notice time on the next day it works (noon unless its rules say otherwise). An empty list means nothing is free then, or the firm takes no bookings.
- `book_visit`: `{ "booked": true, "start": "2026-10-01T15:00", "say": "Thursday 1 October at 3pm", "text": true }`, or `{ "booked": false, "why": "taken" }` (someone else has just taken it), `"not_offered"` (outside the firm's hours, today, before its notice time on the next working day, more than two weeks ahead, or not a start the firm offers) or `"unreadable"`.

The times are UK time. Only quote visits are booked this way.

### What to tell the agent, in its prompt

- Ask `free_times` before offering any time, and read out the `say` words. Never make up a time.
- Give `day` only when the caller names a day or a date. Never fill it in, not even with tomorrow: without it, the caller is offered a choice of days.
- Book with `book_visit` only once the caller has agreed a time, with its `start` exactly as `free_times` gave it.
- If the caller changes their mind on the same call, book the new time. The first one is let go: one call holds one time.
- Never use either tool on an urgent or dangerous call, not even to look at times, and do not talk about times on one. The rules on danger come before the booking rules in the instructions, so the agent settles that first, and each tool's description says the same. If danger comes up after times were offered, neither tool is used again; a visit already booked on a call about something not on the firm's list stays booked, while one on a call that matched the list is let go when the call is kept (`src/land-call.ts`). On an urgent call, say it will be passed to the firm as soon as the call ends: the owner's alert goes seconds after the report arrives, at any hour, since quiet hours, the stop button and the service switches do not hold it. A call about something dangerous that is not on the firm's list gets no alert, so for it the agent says only that the firm will get back to them.
- Tell the caller they will get a text to confirm it only when `book_visit` says `"text": true`. That is the same checks `send()` makes before a confirmation goes, taken on the safe side while the call is on: a UK mobile to text, the stop button off, no STOP from the number and no opt-out from a confirmation by anyone on it, agreed wording for both confirmations, and an address for customers' links. Between 8pm and 8am the text waits until 8am, so it is still `true`, unless 8am is after the visit's start. The caller's number comes from the tool call's `customer.number`, or `call.customer.number`; with neither, it is `false`.
- Give today's date in UK time, so the agent can turn "Thursday" into a `day`. Vapi's own `{{date}}` and `{{now}}` are UTC, the wrong day between midnight and 1am in summer, so the instructions use Vapi's date filter with the time zone named:

  ```
  Today is {{"now" | date: "%A %d %B %Y", "Europe/London"}}, UK time. Written as YYYY-MM-DD, that is {{"now" | date: "%Y-%m-%d", "Europe/London"}}.
  ```

  Vapi fills it in when the call starts. The instructions as filled in are on the call's record in Vapi, which is where to check it. A wrong day gives a wrong offer, not a wrong booking: the agent reads out the day and date from the `say` words.
- Name the firm's urgent list, as `urgentMatch`'s description does, and do not book on a call about it.

### What Front-line does with them

- Both addresses check the secret before reading anything, and refuse with 401 otherwise. A message for a number no firm has gets 404, and one that is not a tool call gets 400.
- Each works only in the diary of the firm whose number was rung (`phoneNumber.number`).
- A booked time is held in the diary under Vapi's id for the call (`call.id`). When the call ends, the report for the same `call.id` files it as a visit on the job the call opens. Then the customer's confirmation goes, their reminder is set for 1pm the day before, and every owner gets a text about the booking. Between 8pm and 8am the confirmation and the owner's text wait until 8am.
- If the call turns out urgent, or its details do not come through, the held time is let go and a log line tells staff. A held time whose call never reports stops counting after an hour.
- What the agent puts in the arguments is checked like any of its fields (rule 16). It is data, never instructions (rule 17).

### Check

1. The kit types `function.arguments` as a string of JSON. Front-line also reads it if it comes already unpacked as an object. Check which a real request sends.
2. Capture one real request of each kind on practice (Vapi's dashboard shows the requests it sent). Replace the real numbers with ones from the drama range (07700 900xxx) and put them in `test/fixtures/vapi/` in place of `free-times.json` and `book.json`, so the tests replay real ones.
