# Twilio: what Front-line expects

What to set in Twilio so that texts go out in a firm's name and come back to the record (slice D). Everything here happens on Greg's own machine, in Twilio's console or with its API, never from a cloud session.

Twilio's documentation website could not be opened from the cloud session that wrote slice D. How a request from Twilio is signed is taken from Twilio's own package, `twilio` 6.1.2 (`lib/webhooks/webhooks.js`, published 28 September 2026), and checked against Twilio's published example. The rest is marked **check** below: check it against the console as you go, and against one real request of each kind (see the end).

## The account

One Twilio account for Front-line, holding every firm's number. Its auth token signs every request Twilio sends us, so one token checks them all. (A sub-account per firm would mean a token per firm; that is not built.)

Give the Worker the account's id and auth token, one pair for practice and one for live:

```sh
npx wrangler secret put TWILIO_ACCOUNT_SID --env practice
npx wrangler secret put TWILIO_AUTH_TOKEN --env practice
```

and likewise with `--env live`. If either is missing, nothing is sent to Twilio: every text is recorded as refused, and every request from Twilio is refused with 401.

This machine (`npm run dev`) and the tests never use Twilio. `npm run dev` warns that the two secrets are missing; that is expected.

## Each firm's number

Each firm has an 07 number bought for it in the account, and the same number is set on the firm in the record (its `phone_number`). Texts go from it, and the firm is found by it.

| Setting on the number | Value |
|---|---|
| Messaging: a message comes in | Webhook, `POST`, `https://<the address of the copy>/twilio/texts` |

Front-line answers a text that comes in with an empty reply, so Twilio sends nothing back. Nothing answers a customer automatically in Release 1.

## Delivery reports

Each text Front-line sends asks Twilio to report on its delivery to `<PUBLIC_ADDRESS>/twilio/status`. `PUBLIC_ADDRESS` is set in `wrangler.jsonc` for each copy, with no slash at the end. It is empty until open question 9 (the web address) is answered; while it is empty, texts go without delivery reports and stay as "sent".

Twilio signs the address exactly as it was given, so `PUBLIC_ADDRESS` must be the address Twilio is told, scheme and all.

## What Front-line reads from Twilio's requests

Both addresses are outside the practice gate. Each checks the `X-Twilio-Signature` header against the auth token before it reads anything, and refuses with 401 otherwise.

| Address | Fields read | **Check** |
|---|---|---|
| `/twilio/texts` | `To` (the firm's number), `From`, `Body`, `MessageSid` | The names |
| `/twilio/status` | `From` (the firm's number), `MessageSid`, `MessageStatus`, `ErrorCode` | The names, and that `MessageStatus` is `delivered`, `undelivered` or `failed` at the end |

When Twilio refuses a text because the customer unsubscribed with Twilio, Front-line expects Twilio's error code 21610. **Check** it.

## STOP

**Check**, in the console:

1. Whether Twilio applies its own STOP handling to texts from a UK 07 number. If it does, a customer who texts STOP gets no more texts from that number, whatever Front-line's record says.
2. Whether Twilio sends its own reply to STOP, and in what words.

What Front-line itself does with a STOP is open question 2 in `docs/decisions.md`. Until it is answered, a STOP is stored and shown on the customer's job like any other text.

## One of each, captured on practice

The example requests in `test/fixtures/twilio/` were written from what Twilio is known to send, not captured. Once practice is set up, capture one real text coming in and one real delivery report (Twilio's console shows each request it sent), replace the real numbers with ones from the drama range (07700 900xxx), and put them in `test/fixtures/twilio/` in place of the examples, so the tests replay real ones.
