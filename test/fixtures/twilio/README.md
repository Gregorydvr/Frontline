# Example requests from Twilio

The fields Twilio posts to `/twilio/texts` when a text comes in to a firm's number (`text-in.json`), and to `/twilio/status` as a text it sent is delivered or not (`delivered.json`, `undelivered.json`). The people and numbers are invented; the numbers are from the range Ofcom keeps for drama.

These are written from what Twilio is known to send, not captured from Twilio: its documentation website could not be opened from the cloud session that wrote them. Front-line reads only `To`, `From`, `Body`, `MessageSid`, `MessageStatus` and `ErrorCode`. `AccountSid` is a placeholder that cannot be mistaken for a real account's id. They are to be checked against one real incoming text and one real delivery report captured on practice, with the real numbers replaced (see `docs/twilio.md`).

The tests sign each request the way Twilio does, with the auth token they make up for each run.
