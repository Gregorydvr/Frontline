-- Setting up a firm (slice H2 of docs/build-brief.md): who agreed each
-- version of a firm's wording for its texts, and more for the staff log to
-- name.
--
-- Nothing here rebuilds a table.

-- Rule 2: a text goes only in wording the firm agreed. Each version of the
-- words for a text names the owner who agreed them, when, and how (on the
-- phone, in person or in writing, from the list in src/record/types.ts). The
-- words themselves are the row's, never edited; staff_id, as before, names
-- the member of staff who recorded it.
ALTER TABLE wording ADD COLUMN agreed_owner_id TEXT;
ALTER TABLE wording ADD COLUMN agreed_at INTEGER;
ALTER TABLE wording ADD COLUMN agreed_how TEXT;

-- A link across firms cannot be added to an existing table without
-- rebuilding it, so a check stands in for it, as for staff in 0008: the
-- owner who agreed must be one of the same firm's. And every version of the
-- words for a text must say who agreed it, when and how.
CREATE TRIGGER wording_names_the_firms_own_owner BEFORE INSERT ON wording
WHEN NEW.agreed_owner_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM owners WHERE owners.firm_id = NEW.firm_id AND owners.id = NEW.agreed_owner_id)
BEGIN
  SELECT RAISE(ABORT, 'Wording names an owner who is not the firm''s');
END;

CREATE TRIGGER wording_for_a_text_was_agreed BEFORE INSERT ON wording
WHEN NEW.key LIKE 'text:%'
  AND (NEW.agreed_owner_id IS NULL OR NEW.agreed_at IS NULL OR NEW.agreed_how IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'Wording for a text must say who agreed it');
END;

-- The staff log can now name the owner a change was about, such as their
-- mobile, and the kind of text whose wording was viewed or agreed. Ids and
-- names from a fixed list only.
ALTER TABLE staff_log ADD COLUMN owner_id TEXT;
ALTER TABLE staff_log ADD COLUMN message_kind TEXT;
