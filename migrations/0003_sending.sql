-- Sending, and the clock (slice D of docs/build-brief.md): the owner's mobile,
-- each firm's agreed wording, the texts sent, opt-outs, the texts that come
-- in, and the due list.
--
-- Every new table has firm_id, and each link carries the firm as well as the
-- id, so the database itself refuses a link across firms (rule 8). Lists that
-- later slices will add to, such as the kinds of text and the states of a
-- row in the due list, are checked by the record layer, not here.

-- The owner's mobile, for alerts and, from slice F, the login link.
ALTER TABLE owners ADD COLUMN mobile TEXT
  CHECK (mobile IS NULL OR mobile GLOB '+447[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]');

-- The firm's own words: for each kind of text, the wording agreed at set-up,
-- and for any of the owner's lines, the firm's own version. Each change is a
-- new row, never an edit, so who set which words and when is kept (rule 15).
-- The words in use are the newest row for each key.
CREATE TABLE wording (
  id TEXT PRIMARY KEY NOT NULL,
  firm_id TEXT NOT NULL REFERENCES firms (id),
  -- What the words are for, such as "text:visit_reminder" or
  -- "line:visit_booked:job", from the lists in src/record/types.ts.
  key TEXT NOT NULL,
  words TEXT NOT NULL,
  at INTEGER NOT NULL,
  -- The order the rows were written in, so the newest is certain even when
  -- two are written at the same moment.
  seq INTEGER NOT NULL UNIQUE,
  actor TEXT NOT NULL CHECK (actor IN ('frontline', 'owner', 'staff')),
  owner_id TEXT,
  staff_id TEXT,
  CHECK ((actor = 'owner') = (owner_id IS NOT NULL)),
  CHECK ((actor = 'staff') = (staff_id IS NOT NULL)),
  UNIQUE (firm_id, id),
  FOREIGN KEY (firm_id, owner_id) REFERENCES owners (firm_id, id)
);

CREATE INDEX wording_by_key ON wording (firm_id, key, seq);

CREATE TRIGGER wording_is_never_edited BEFORE UPDATE ON wording
BEGIN
  SELECT RAISE(ABORT, 'Wording is never edited');
END;

-- The list of things due to happen. A row says what to do, the earliest time
-- to do it and the latest time it is still worth doing. The clock puts due
-- rows on a queue; a worker claims a row in one step, acts, and marks it done
-- (rule 20).
CREATE TABLE due (
  id TEXT PRIMARY KEY NOT NULL,
  firm_id TEXT NOT NULL REFERENCES firms (id),
  -- What to do, such as "alert_owner", from the list in src/record/types.ts.
  action TEXT NOT NULL,
  -- What it is about.
  call_id TEXT,
  visit_id TEXT,
  run_at INTEGER NOT NULL,
  latest_at INTEGER NOT NULL,
  -- waiting, claimed, done, skipped or cancelled, checked by the record layer.
  state TEXT NOT NULL,
  -- When the clock last put the row on the queue.
  queued_at INTEGER,
  -- A new id each time a worker claims the row, and when it did.
  claim TEXT,
  claimed_at INTEGER,
  finished_at INTEGER,
  -- How it ended, such as "sent" or "too_late", from the list in
  -- src/record/types.ts.
  outcome TEXT,
  created_at INTEGER NOT NULL,
  CHECK (latest_at >= run_at),
  CHECK ((claim IS NULL) = (claimed_at IS NULL)),
  UNIQUE (firm_id, id),
  FOREIGN KEY (firm_id, call_id) REFERENCES calls (firm_id, id),
  FOREIGN KEY (firm_id, visit_id) REFERENCES visits (firm_id, id)
);

CREATE INDEX due_by_time ON due (state, run_at);
CREATE INDEX due_by_call ON due (firm_id, call_id);
CREATE INDEX due_by_visit ON due (firm_id, visit_id);

-- Texts sent, or claimed and not sent. A text is claimed before it goes: its
-- row in the due list and who it is to can be written only once, so the same
-- text cannot go twice (rule 3).
CREATE TABLE messages (
  id TEXT PRIMARY KEY NOT NULL,
  firm_id TEXT NOT NULL REFERENCES firms (id),
  due_id TEXT NOT NULL,
  -- The kind of text, such as "visit_reminder", from the list in
  -- src/record/types.ts.
  kind TEXT NOT NULL,
  -- Who it is to: one of the firm's customers or owners. recipient_id is
  -- whichever of the two it is, for the claim below.
  customer_id TEXT,
  owner_id TEXT,
  recipient_id TEXT NOT NULL,
  -- What it is about.
  job_id TEXT,
  visit_id TEXT,
  call_id TEXT,
  -- The numbers it went to and from, when it went.
  to_number TEXT CHECK (to_number IS NULL OR to_number GLOB '+447[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'),
  from_number TEXT CHECK (from_number IS NULL OR from_number GLOB '+447[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'),
  -- The words, made from the firm's wording (the row it names), and how
  -- many segments they take. Empty when no words could be made.
  words TEXT,
  wording_id TEXT,
  segments INTEGER CHECK (segments IS NULL OR segments > 0),
  -- sending, sent, delivered, failed or not_sent, and why for the last two,
  -- from the lists in src/record/types.ts.
  state TEXT NOT NULL,
  reason TEXT,
  -- Who carried it, such as "twilio", their id for it, and their error code
  -- when it failed.
  provider TEXT,
  provider_id TEXT,
  error_code INTEGER,
  created_at INTEGER NOT NULL,
  sent_at INTEGER,
  updated_at INTEGER NOT NULL,
  CHECK ((customer_id IS NULL) <> (owner_id IS NULL)),
  CHECK (recipient_id = COALESCE(customer_id, owner_id)),
  CHECK ((words IS NULL) = (segments IS NULL)),
  CHECK ((provider_id IS NULL) OR (provider IS NOT NULL)),
  UNIQUE (due_id, recipient_id),
  UNIQUE (provider, provider_id),
  UNIQUE (firm_id, id),
  FOREIGN KEY (firm_id, due_id) REFERENCES due (firm_id, id),
  FOREIGN KEY (firm_id, customer_id) REFERENCES customers (firm_id, id),
  FOREIGN KEY (firm_id, owner_id) REFERENCES owners (firm_id, id),
  FOREIGN KEY (firm_id, job_id) REFERENCES jobs (firm_id, id),
  FOREIGN KEY (firm_id, visit_id) REFERENCES visits (firm_id, id),
  FOREIGN KEY (firm_id, call_id) REFERENCES calls (firm_id, id),
  FOREIGN KEY (firm_id, wording_id) REFERENCES wording (firm_id, id)
);

CREATE INDEX messages_by_time ON messages (firm_id, created_at);
CREATE INDEX messages_by_customer ON messages (firm_id, customer_id, created_at);

-- A customer's opt-outs: one row for each kind of text they have opted out
-- of, or "every" for all of them.
CREATE TABLE opt_outs (
  firm_id TEXT NOT NULL REFERENCES firms (id),
  customer_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (firm_id, customer_id, kind),
  FOREIGN KEY (firm_id, customer_id) REFERENCES customers (firm_id, id)
);

-- Texts that came in to the firm's number. One from a number that is not a
-- customer's is kept with no customer, for staff to see.
CREATE TABLE texts_in (
  id TEXT PRIMARY KEY NOT NULL,
  firm_id TEXT NOT NULL REFERENCES firms (id),
  -- Who carried it, and their id for it. The same text is kept once.
  provider TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  -- The number it came from, as the provider gave it, such as +447700900003.
  from_number TEXT CHECK (from_number IS NULL OR from_number GLOB '+[0-9]*'),
  customer_id TEXT,
  job_id TEXT,
  words TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  CHECK (job_id IS NULL OR customer_id IS NOT NULL),
  UNIQUE (provider, provider_id),
  UNIQUE (firm_id, id),
  FOREIGN KEY (firm_id, customer_id) REFERENCES customers (firm_id, id),
  FOREIGN KEY (firm_id, customer_id, job_id) REFERENCES jobs (firm_id, customer_id, id)
);

CREATE INDEX texts_in_by_time ON texts_in (firm_id, received_at);

-- History can name a text that came in, and the kind of text an opt-out is
-- about.
ALTER TABLE history ADD COLUMN text_in_id TEXT REFERENCES texts_in (id);
ALTER TABLE history ADD COLUMN text_kind TEXT;
CREATE INDEX history_by_text_in ON history (firm_id, text_in_id);

-- As for calls in 0002: the link above holds the text's id but not its firm,
-- so this makes the database itself refuse an entry that names another
-- firm's text, or a text about another customer or job.
CREATE TRIGGER history_names_a_text_of_its_own BEFORE INSERT ON history
WHEN NEW.text_in_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM texts_in
  WHERE texts_in.firm_id = NEW.firm_id
    AND texts_in.id = NEW.text_in_id
    AND texts_in.customer_id IS NEW.customer_id
    AND texts_in.job_id IS NEW.job_id
)
BEGIN
  SELECT RAISE(ABORT, 'History names a text of another firm');
END;
