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

Only these: Vapi's id for the call, the number rung, the caller's number, the start and end times, the fields above, and the transcript (`artifact.transcript`). The rest of the report is not stored or logged: it can hold the caller's details and parts of Vapi's set-up. The recording (`artifact.recordingUrl`) is not copied yet. That comes with slice H.
