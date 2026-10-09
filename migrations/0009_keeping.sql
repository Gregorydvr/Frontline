-- Keeping and deleting (slice H of docs/build-brief.md): call recordings in
-- Front-line's own file store, the clock deleting what has run past its
-- period, a firm leaving, exporting one firm and deleting it, and the bin of
-- files still to delete once the record has let them go.
--
-- Nothing here rebuilds a table. Each new table has firm_id (rule 8), apart
-- from the staff log's permission slip, which belongs to no firm.

-- A call's recording. Vapi writes it into the inbox file store under the
-- firm's own path (docs/vapi.md); a row in the due list moves it into the
-- file store that keeps it, and another deletes it when its period ends. The
-- call itself, with its summary and transcript, stays.
-- - recording_state: none, waiting, kept, not_kept or deleted, checked by the
--   record layer. Every call from before this slice has none.
-- - recording_from: the inbox's name for it, while it is on its way
-- - recording_key: the kept file's name, while it is kept
-- - recording_until: when it is due to be deleted
-- - recording_gone_at: when it was deleted
ALTER TABLE calls ADD COLUMN recording_state TEXT NOT NULL DEFAULT 'none';
ALTER TABLE calls ADD COLUMN recording_from TEXT;
ALTER TABLE calls ADD COLUMN recording_key TEXT
  CHECK (recording_key IS NULL OR recording_state = 'kept');
ALTER TABLE calls ADD COLUMN recording_until INTEGER;
ALTER TABLE calls ADD COLUMN recording_gone_at INTEGER
  CHECK (recording_gone_at IS NULL OR recording_state = 'deleted');

-- A firm that is leaving: when staff said so, and who. Its records are
-- handed over as a file and deleted within 30 days (docs/decisions.md).
ALTER TABLE firms ADD COLUMN left_at INTEGER;
ALTER TABLE firms ADD COLUMN left_by TEXT
  CHECK ((left_at IS NULL) = (left_by IS NULL));

-- The bin: files the record has let go of and the file store still holds.
-- A file goes in here in the same step as the rows that named it are
-- deleted, so no file is ever left without a note of it. Emptied by the
-- delete that filled it, and by the firm's daily sweep. A name must be under
-- the firm's own path, so the bin of one firm cannot name another's files.
CREATE TABLE files_to_delete (
  firm_id TEXT NOT NULL REFERENCES firms (id),
  -- kept: the file store that keeps recordings and exports. inbox: where
  -- Vapi writes recordings.
  bucket TEXT NOT NULL CHECK (bucket IN ('kept', 'inbox')),
  key TEXT NOT NULL CHECK (substr(key, 1, length(firm_id) + 7) = 'firms/' || firm_id || '/'),
  at INTEGER NOT NULL,
  PRIMARY KEY (firm_id, bucket, key)
);

-- One firm's records as a file, for handing over. Made by a row in the due
-- list, kept at firms/<firm>/exports/<id>.zip, and deleted after 30 days or
-- with the firm.
CREATE TABLE firm_exports (
  id TEXT PRIMARY KEY NOT NULL,
  firm_id TEXT NOT NULL REFERENCES firms (id),
  -- Who asked for it.
  staff_id TEXT NOT NULL REFERENCES staff (id),
  -- asked or ready, checked by the record layer.
  state TEXT NOT NULL,
  size INTEGER,
  asked_at INTEGER NOT NULL,
  ready_at INTEGER,
  -- The last time a member of staff downloaded it.
  downloaded_at INTEGER,
  CHECK ((state = 'ready') = (ready_at IS NOT NULL)),
  UNIQUE (firm_id, id)
);

CREATE INDEX firm_exports_by_time ON firm_exports (firm_id, asked_at);

-- Each firm deleted: when it left, when it went, and whether staff pressed
-- delete or the clock did it at the end of the 30 days. Ids only. It has no
-- link to the firm, so it outlives it, and is never edited or deleted.
CREATE TABLE deleted_firms (
  firm_id TEXT PRIMARY KEY NOT NULL,
  left_at INTEGER NOT NULL,
  deleted_at INTEGER NOT NULL,
  by TEXT NOT NULL CHECK (by IN ('staff', 'clock')),
  staff_id TEXT REFERENCES staff (id),
  CHECK ((by = 'staff') = (staff_id IS NOT NULL))
);

CREATE TRIGGER deleted_firms_are_never_edited BEFORE UPDATE ON deleted_firms
BEGIN
  SELECT RAISE(ABORT, 'The list of deleted firms is never edited');
END;

CREATE TRIGGER deleted_firms_are_never_deleted BEFORE DELETE ON deleted_firms
BEGIN
  SELECT RAISE(ABORT, 'The list of deleted firms is never deleted');
END;

-- Each firm has one daily sweep waiting (or being run) at a time, and one
-- delete of the firm itself. The database holds to it, however many workers
-- try to add another.
CREATE UNIQUE INDEX due_one_sweep ON due (firm_id)
  WHERE action = 'sweep' AND state IN ('waiting', 'claimed');
CREATE UNIQUE INDEX due_one_firm_delete ON due (firm_id)
  WHERE action = 'delete_firm' AND state IN ('waiting', 'claimed');
CREATE INDEX due_by_action ON due (firm_id, action, state);

-- The staff log is never edited. From now on it is deleted only when it has
-- reached the end of its period, by the clock: the step that does it writes
-- a permission slip here naming the cut-off, and takes it away again in the
-- same step. A row written at or after the cut-off cannot be deleted.
CREATE TABLE staff_log_trimming (
  before INTEGER NOT NULL
);

DROP TRIGGER staff_log_is_never_deleted;

CREATE TRIGGER staff_log_is_deleted_only_when_old BEFORE DELETE ON staff_log
WHEN NOT EXISTS (SELECT 1 FROM staff_log_trimming WHERE OLD.at < staff_log_trimming.before)
BEGIN
  SELECT RAISE(ABORT, 'The staff log is never deleted before the end of its period');
END;
