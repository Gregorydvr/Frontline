-- The go-live gate (task 4 of queue 2 in docs/autopilot.md): when a firm
-- went live, and who switched it, and what staff ticked on its checklist on
-- the way.

-- When the firm went live, and the member of staff who switched it, by id.
-- Null until then. Only the member of staff the copy names may set it
-- (src/record/go-live.ts), and only once.
ALTER TABLE firms ADD COLUMN live_at INTEGER;
ALTER TABLE firms ADD COLUMN live_by TEXT;

-- Each tick and untick on a firm's go-live checklist, never edited: the
-- newest row for an item is where it stands. An item is one from the list
-- in src/go-live.ts, such as the firm's agreement signed, or the
-- end-to-end test call, which names the firm's own call. Who ticked it is
-- in the staff log. Deleted only with the firm.
CREATE TABLE go_live_ticks (
  id TEXT PRIMARY KEY NOT NULL,
  firm_id TEXT NOT NULL REFERENCES firms (id),
  item TEXT NOT NULL,
  ticked INTEGER NOT NULL CHECK (ticked IN (0, 1)),
  -- For the test call: which of the firm's calls it was. Checked to be the
  -- firm's own when written. Not a link, so the call can still be deleted
  -- with its customer or at the end of its period.
  call_id TEXT,
  at INTEGER NOT NULL
);

CREATE INDEX go_live_ticks_by_firm ON go_live_ticks (firm_id, item, at);

CREATE TRIGGER go_live_ticks_are_never_edited BEFORE UPDATE ON go_live_ticks
BEGIN
  SELECT RAISE(ABORT, 'The go-live checklist is never edited');
END;

CREATE TRIGGER go_live_ticks_are_deleted_only_with_the_firm BEFORE DELETE ON go_live_ticks
WHEN NOT EXISTS (SELECT 1 FROM erasing WHERE erasing.firm_id = OLD.firm_id)
BEGIN
  SELECT RAISE(ABORT, 'The go-live checklist is deleted only with the firm');
END;
