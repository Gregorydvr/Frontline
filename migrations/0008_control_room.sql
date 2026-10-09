-- The control room (slice G of docs/build-brief.md): Front-line's staff, the
-- log of everything they view and do, a clock of its own for an example firm,
-- a mark on a call the voice agent thought urgent, and the one way history is
-- ever deleted: with the customer it is about, or with an example firm being
-- reset.
--
-- Nothing here rebuilds a table.

-- Front-line's own people. Not part of any firm. Who counts as staff is
-- decided by Cloudflare Access on practice and live; a member of staff is
-- added here the first time they come, by the email Access vouches for.
CREATE TABLE staff (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

-- History and wording can name a member of staff. Their staff_id columns came
-- before this table, so a check stands in for the link.
CREATE TRIGGER history_names_staff_of_record BEFORE INSERT ON history
WHEN NEW.staff_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM staff WHERE staff.id = NEW.staff_id)
BEGIN
  SELECT RAISE(ABORT, 'History names staff who are not on record');
END;

CREATE TRIGGER wording_names_staff_of_record BEFORE INSERT ON wording
WHEN NEW.staff_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM staff WHERE staff.id = NEW.staff_id)
BEGIN
  SELECT RAISE(ABORT, 'Wording names staff who are not on record');
END;

-- Every view and every action in the control room (rule 15). The firm is
-- empty for a view across firms, such as the list of firms. It holds ids,
-- never names or details, and has no link to the firm or the customer, so it
-- outlives a customer deleted or an example firm reset: the record that it
-- happened stays. Never edited, never deleted.
CREATE TABLE staff_log (
  id TEXT PRIMARY KEY NOT NULL,
  firm_id TEXT,
  staff_id TEXT NOT NULL REFERENCES staff (id),
  at INTEGER NOT NULL,
  -- The order the rows were written in.
  seq INTEGER NOT NULL UNIQUE,
  -- What they viewed or did, from the list in src/record/types.ts.
  what TEXT NOT NULL,
  customer_id TEXT,
  -- For a service switched on or off: which one.
  service TEXT CHECK (service IS NULL OR service IN ('calls', 'quotes', 'followups', 'paperwork', 'invoices'))
);

CREATE INDEX staff_log_by_firm ON staff_log (firm_id, at, seq);
CREATE INDEX staff_log_by_staff ON staff_log (staff_id, at, seq);

CREATE TRIGGER staff_log_is_never_edited BEFORE UPDATE ON staff_log
BEGIN
  SELECT RAISE(ABORT, 'The staff log is never edited');
END;

CREATE TRIGGER staff_log_is_never_deleted BEFORE DELETE ON staff_log
BEGIN
  SELECT RAISE(ABORT, 'The staff log is never deleted');
END;

-- How far ahead of the real time this firm's clock runs, in milliseconds:
-- 0 for every real firm. Only an example firm's clock can be moved, on
-- practice and this machine, so the demo can be shown days on.
ALTER TABLE firms ADD COLUMN clock_ahead INTEGER NOT NULL DEFAULT 0
  CHECK (clock_ahead = 0 OR is_example = 1);

-- The voice agent said the call was urgent, for something not on the firm's
-- urgent list, so it was not treated as urgent. Shown to staff.
ALTER TABLE calls ADD COLUMN urgent_not_on_list INTEGER NOT NULL DEFAULT 0
  CHECK (urgent_not_on_list IN (0, 1));

-- The permission slip for deleting history. History is never edited, and is
-- deleted only inside a customer's delete, or an example firm's reset, made
-- in the control room. That step writes a slip here first and takes it away
-- again at its end, in the same step, so a slip is never left behind. The
-- staff log keeps the lasting record of the delete.
CREATE TABLE erasing (
  firm_id TEXT PRIMARY KEY NOT NULL
);

CREATE TRIGGER history_is_deleted_only_in_an_erasure BEFORE DELETE ON history
WHEN NOT EXISTS (SELECT 1 FROM erasing WHERE erasing.firm_id = OLD.firm_id)
BEGIN
  SELECT RAISE(ABORT, 'History is deleted only with what it is about');
END;
