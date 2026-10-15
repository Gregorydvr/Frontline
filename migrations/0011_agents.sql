-- Each firm's voice agent in Vapi, and every time Front-line put the record's
-- settings on it or checked it (task 3 of docs/autopilot.md, the control room
-- updates the agent; plan J2 in docs/plan-automation.md). Ids, names of
-- settings and states only: no words from the agent's settings, and nothing
-- about a caller.

-- Which agent in Vapi is the firm's, and where it stands. One agent per
-- firm, and no agent is two firms': a push to the wrong agent would answer
-- one firm's calls in another firm's name.
CREATE TABLE agents (
  firm_id TEXT PRIMARY KEY NOT NULL REFERENCES firms (id),
  assistant_id TEXT NOT NULL UNIQUE,
  -- From the list in src/record/types.ts: not checked yet, in step with the
  -- record, behind it (a change waits to go), different from what Front-line
  -- last confirmed (someone changed it in Vapi), or not reachable as set up.
  state TEXT NOT NULL,
  -- A fingerprint of the settings Vapi held the last time a read-back
  -- matched the record, so a change made in Vapi since can be told apart.
  confirmed TEXT,
  checked_at INTEGER,
  -- The names of the settings that differ, as a JSON list, when it is not in step.
  differing TEXT NOT NULL DEFAULT '[]',
  set_at INTEGER NOT NULL
);

-- Every push and every check, never edited. Deleted only with the firm.
CREATE TABLE agent_pushes (
  id TEXT PRIMARY KEY NOT NULL,
  firm_id TEXT NOT NULL REFERENCES firms (id),
  assistant_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  -- Who: Front-line's clock, after a change was saved, or a member of staff.
  by_kind TEXT NOT NULL CHECK (by_kind IN ('frontline', 'staff')),
  staff_id TEXT REFERENCES staff (id),
  -- The row in the due list it ran from, if it did.
  due_id TEXT,
  -- What came of it, from the list in src/record/types.ts.
  outcome TEXT NOT NULL,
  -- The names of the settings sent, or found to differ, as a JSON list.
  settings TEXT NOT NULL DEFAULT '[]',
  CHECK ((by_kind = 'staff') = (staff_id IS NOT NULL))
);

CREATE INDEX agent_pushes_by_firm ON agent_pushes (firm_id, at);

CREATE TRIGGER agent_pushes_are_never_edited BEFORE UPDATE ON agent_pushes
BEGIN
  SELECT RAISE(ABORT, 'The agent''s pushes are never edited');
END;

CREATE TRIGGER agent_pushes_are_deleted_only_with_the_firm BEFORE DELETE ON agent_pushes
WHEN NOT EXISTS (SELECT 1 FROM erasing WHERE erasing.firm_id = OLD.firm_id)
BEGIN
  SELECT RAISE(ABORT, 'The agent''s pushes are deleted only with the firm');
END;
