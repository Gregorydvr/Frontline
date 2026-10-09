# Vapi: what Front-line expects

What to set on a firm's voice agent so that its calls land in the record (slice C). Everything here happens on Greg's own machine, in Vapi's dashboard or with its API, never from a cloud session.

The names below are Vapi's, from its server kit, `@vapi-ai/server-sdk` 2.0.1, published 10 September 2026. The slice C cloud session could not open Vapi's documentation website, so check them against the dashboard as you go.

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

The voice agent hands over what it took down as structured data: `analysis.structuredData`, made by the assistant's `analysisPlan.structuredDataPlan` with `enabled: true` and this `schema`:

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
      "description": "Customers only. The first line of the address where the work is, such as 27 Station Road."
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
      "type": ["string", "null"],
      "description": "If the call is about something on the firm's urgent list, that item exactly as the list writes it. Otherwise null. Tidewell Heating's urgent list: a leak."
    }
  },
  "required": ["callerType", "summary"]
}
```

The firm's urgent list in the last description must match the list held on the firm in the record. Each firm's assistant has its own.

Front-line checks every field, as rule 16 in `CLAUDE.md` says. A field that is not text, is empty, or is too long counts as missing. Line breaks become spaces. The longest each may be:

| Field | Longest |
|---|---|
| `name` | 60 characters |
| `about` | 80 |
| `address` | 120 |
| `whoRang` | 60 |
| `summary` | 200 |
| `urgentMatch` | 60 |

What happens with them:

- **A customer** needs a name, what the job is about and an address. Then the customer is found by the number they rang from and their name, or made, and a new job is opened.
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

If Vapi cannot write to an EU inbox, the other way is for the Worker to fetch each recording from Vapi when the call ends (route B in the slice H plan). That needs a Vapi private key in the Worker, and Vapi keeps its copy until that key deletes it. Only where the recording is read from would change: `reportedRecording()` in `src/vapi-report.ts` and `moveRecording()` in `src/record/keeping.ts`.

## Booking during a call (slice E)

The voice agent can ask which times are free and book one while the caller is on the line. It does this with two of Vapi's "function" tools on the assistant. Each tool has its own address, and each sends the same secret as the reports.

The names below are again Vapi's, from `@vapi-ai/server-sdk` 2.0.1 (`CreateFunctionToolDto`, `ServerMessageToolCalls`, `ToolCall`, `ServerMessageResponseToolCalls`, `ToolCallResult`). The slice E cloud session could not open Vapi's documentation website either, so check them against the dashboard as you go.

| Tool | `function.name` | `server.url` | `server.credentialId` |
|---|---|---|---|
| Free times | `free_times` | `https://<the practice address>/vapi/free-times` | the Bearer credential above |
| Book | `book_visit` | `https://<the practice address>/vapi/book` | the same |

Leave `async` off (the default), so the agent waits for the answer.

The tools' `function.parameters`, which are ours to define:

```json
{
  "name": "free_times",
  "description": "The firm's free times for a quote visit, from the day the caller asks about, or from tomorrow.",
  "parameters": {
    "type": "object",
    "properties": {
      "day": { "type": "string", "description": "The day the caller asks about, as YYYY-MM-DD. Leave out for the next free times." }
    }
  }
}
```

```json
{
  "name": "book_visit",
  "description": "Books a quote visit at one of the free times, once the caller has agreed it.",
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

- `free_times`: `{ "times": [ { "start": "2026-10-01T08:00", "say": "Thursday 1 October at 8am" }, … ] }`, up to three, earliest first. An empty list means nothing is free then, or the firm takes no bookings.
- `book_visit`: `{ "booked": true, "start": "2026-10-01T15:00", "say": "Thursday 1 October at 3pm" }`, or `{ "booked": false, "why": "taken" }` (someone else has just taken it), `"not_offered"` (outside the firm's hours, today, more than two weeks ahead, or not a start the firm offers) or `"unreadable"`.

The times are UK time. Only quote visits are booked this way.

### What to tell the agent, in its prompt

- Ask `free_times` before offering any time, and read out the `say` words. Never make up a time.
- Book with `book_visit` only once the caller has agreed a time, with its `start` exactly as `free_times` gave it.
- If the caller changes their mind on the same call, book the new time. The first one is let go: one call holds one time.
- Do not book on an urgent call. That is passed to the owner.
- Tell the caller they will get a text to confirm it.

### What Front-line does with them

- Both addresses check the secret before reading anything, and refuse with 401 otherwise. A message for a number no firm has gets 404, and one that is not a tool call gets 400.
- Each works only in the diary of the firm whose number was rung (`phoneNumber.number`).
- A booked time is held in the diary under Vapi's id for the call (`call.id`). When the call ends, the report for the same `call.id` files it as a visit on the job the call opens. Then the customer's confirmation goes, and their reminder is set for 1pm the day before.
- If the call turns out urgent, or its details do not come through, the held time is let go and a log line tells staff. A held time whose call never reports stops counting after an hour.
- What the agent puts in the arguments is checked like any of its fields (rule 16). It is data, never instructions (rule 17).

### Check

1. The kit types `function.arguments` as a string of JSON. Front-line also reads it if it comes already unpacked as an object. Check which a real request sends.
2. Capture one real request of each kind on practice (Vapi's dashboard shows the requests it sent). Replace the real numbers with ones from the drama range (07700 900xxx) and put them in `test/fixtures/vapi/` in place of `free-times.json` and `book.json`, so the tests replay real ones.
