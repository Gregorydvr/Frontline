-- The guided set-up of a new firm in the control room (task 3 of queue 2 in
-- docs/autopilot.md).
--
-- Which services the firm chose at set-up, as a JSON list of names from
-- SERVICES in src/record/types.ts. Choosing switches nothing on: every
-- service stays off until it is switched on.
ALTER TABLE firms ADD COLUMN services_chosen TEXT NOT NULL DEFAULT '[]';

-- Each time staff asked for something to be made for the firm in a
-- provider's account: its number bought in Twilio, or its voice agent made in
-- Vapi. The row is written before the provider is asked, so pressing twice,
-- or two members of staff at once, can never buy two numbers or make two
-- agents: while one is asked, made, or not clearly either, no other can be.
-- Only one that clearly failed can be asked again. Who asked is in the staff
-- log. Deleted with the firm.
CREATE TABLE provisioning (
  id TEXT PRIMARY KEY NOT NULL,
  firm_id TEXT NOT NULL REFERENCES firms (id),
  what TEXT NOT NULL CHECK (what IN ('number', 'agent')),
  -- asked: the provider is being asked; done: it was made; failed: it was
  -- clearly not made; unclear: the provider's answer did not say, so staff
  -- check its account by hand before anything is asked again.
  state TEXT NOT NULL CHECK (state IN ('asked', 'done', 'failed', 'unclear')),
  asked_at INTEGER NOT NULL,
  finished_at INTEGER,
  -- What was made: the number bought, or Vapi's id for the agent.
  made TEXT
);

CREATE UNIQUE INDEX provisioning_once ON provisioning (firm_id, what) WHERE state <> 'failed';
