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

## What happened

| | |
|---|---|
| Date | 13 October 2026, slice I |
| Who ran it | Greg made the call. Claude Code, on his machine, set the agent and ran the checks he agreed |
| The agent | The practice agent, set from `vapi/practice-assistant.json` on 12 October 2026: greeting, instructions, `serverMessages` `end-of-call-report`, `structuredDataPlan` on. Vapi took every field; read back, it matched the file |
| The call | A web call, 09:48:47Z to 09:50:08Z, ended by the caller. Vapi's id `01a134aa-206b-7000-8d82-815b22ee7e39` |
| The Worker's log | **Pass.** `POST /vapi/server - Ok` at 09:50:14Z, logging `call_for_unknown_number`. No `call_report_refused` |
| Where Vapi put the recording | **Pass.** `artifact.recordingUrl` at the account's EU R2 address, `/firms/6g9dmtzcgtcwqa867j1hb6szc3/01a134aa-…-mono.mp3`. Every recording address on the call was there; none was Vapi's own storage. That is all Vapi's API shows: whether it keeps a copy out of sight cannot be checked |
| The file in the inbox | **Pass.** Read from `frontline-practice-calls-in` (EU) by its name: 343,076 bytes, an MP3. Not saved. `r2 bucket info` still said 1 file of 69 bytes: its count lags |
| The move into `frontline-practice-files` | **Not tried.** A web call finds no firm, so nothing is kept and nothing moves. Waits for a call to the practice firm's Twilio number |
| The structured data | **Pass, for a caller who is not a customer.** `callerType` `other`, `whoRang` "someone trying to get a cupcake recipe", and a one-sentence `summary`. No `urgentMatch`, and no field held "null". The caller asked for a recipe and the agent took a message instead. The customer's fields were not tried |
| What Vapi keeps | The transcript (1,083 characters), the conversation as 16 messages, the structured data, the times and costs, and the addresses of the recordings in our inbox. No summary |
| What surprised us | Vapi wrote four recordings, not one: the call, a stereo copy, the agent alone and the caller alone, all under the firm's path; Front-line moves only the first, and the inbox's rule deletes the rest after a day. Vapi's own call log went to the top of the inbox. The call held signed links to each file in the inbox, good until 10:22Z, about half an hour after the call. The call was handled in Vapi's US region (control address in AWS `us-west-2`): a blocker for live, under open question 10. The recording addresses name no bucket, which does not matter, since Front-line reads only the path. The first tail failed to log in to Cloudflare until IPv4 was preferred, and later ones dropped out overnight |
