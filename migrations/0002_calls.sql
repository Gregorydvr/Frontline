-- A call lands in the record (slice C of docs/build-brief.md): the firm's
-- number and urgent list, customers who cannot be reached by text, the calls
-- themselves, and history that names a call.
--
-- Nothing here rebuilds a table. Columns are added to the tables of slice B,
-- and calls is new.

-- The number the firm's customers ring and text: an 07 number bought for the
-- firm (docs/decisions.md). No two firms have the same number.
ALTER TABLE firms ADD COLUMN phone_number TEXT
  CHECK (phone_number IS NULL OR phone_number GLOB '+447[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]');
CREATE UNIQUE INDEX firms_by_number ON firms (phone_number);

-- What counts as urgent for this firm, set at set-up: short words such as
-- "a leak", as a JSON list. The record layer checks it.
ALTER TABLE firms ADD COLUMN urgent_list TEXT NOT NULL DEFAULT '[]';

-- A UK landline the customer rang from, written as +441632960001, so the
-- owner can ring back and the customer is found on their next call: +44,
-- then 1, 2 or 3, then eight or nine more digits. (D1 refuses a GLOB pattern
-- longer than 50 characters, so the digits are checked this way.)
ALTER TABLE customers ADD COLUMN landline TEXT
  CHECK (
    landline IS NULL
    OR (
      landline GLOB '+44[123]*'
      AND length(landline) IN (12, 13)
      AND substr(landline, 2) NOT GLOB '*[^0-9]*'
    )
  );

-- Why no text can reach a customer, such as "withheld" or "landline", from
-- the list in src/record/types.ts. Every customer without a mobile has one.
ALTER TABLE customers ADD COLUMN no_text TEXT
  CHECK ((mobile IS NULL) = (no_text IS NOT NULL));

CREATE INDEX customers_by_landline ON customers (firm_id, landline);

CREATE TABLE calls (
  id TEXT PRIMARY KEY NOT NULL,
  firm_id TEXT NOT NULL REFERENCES firms (id),
  -- Who answered the call, such as "vapi", and their id for it. The same
  -- call is held only once, however many times its report arrives.
  provider TEXT NOT NULL,
  provider_call_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  -- The number the call came from, or nothing when it was withheld.
  from_number TEXT CHECK (from_number IS NULL OR from_number GLOB '+44[0-9]*'),
  -- The customer and the job, or neither: a caller who is not a customer,
  -- or a call whose details are missing.
  customer_id TEXT,
  job_id TEXT,
  -- The visit booked on the call, if one was.
  visit_id TEXT,
  -- booked, urgent or message, from the list in src/record/types.ts.
  outcome TEXT NOT NULL,
  -- The item on the firm's urgent list that the call matched.
  urgent_item TEXT,
  -- Who rang, for a caller who is not a customer, such as "a supplier".
  caller TEXT,
  -- One line about the call, such as "No hot water."
  summary TEXT,
  transcript TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (provider, provider_call_id),
  UNIQUE (firm_id, id),
  CHECK ((customer_id IS NULL) = (job_id IS NULL)),
  CHECK ((outcome = 'booked') = (visit_id IS NOT NULL)),
  CHECK ((outcome = 'urgent') = (urgent_item IS NOT NULL)),
  CHECK (caller IS NULL OR customer_id IS NULL),
  FOREIGN KEY (firm_id, customer_id) REFERENCES customers (firm_id, id),
  FOREIGN KEY (firm_id, customer_id, job_id) REFERENCES jobs (firm_id, customer_id, id),
  FOREIGN KEY (firm_id, job_id, visit_id) REFERENCES visits (firm_id, job_id, id)
);

CREATE INDEX calls_by_time ON calls (firm_id, started_at);
CREATE INDEX calls_by_job ON calls (firm_id, job_id);

-- History can name the call an entry is about.
ALTER TABLE history ADD COLUMN call_id TEXT REFERENCES calls (id);
CREATE INDEX history_by_call ON history (firm_id, call_id);

-- The link above holds the call's id but not its firm, since SQLite cannot
-- add a two-part link to a table that already exists without rebuilding it.
-- This makes the database itself refuse an entry that names another firm's
-- call, or a call about another customer or job.
CREATE TRIGGER history_names_a_call_of_its_own BEFORE INSERT ON history
WHEN NEW.call_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM calls
  WHERE calls.firm_id = NEW.firm_id
    AND calls.id = NEW.call_id
    AND calls.customer_id IS NEW.customer_id
    AND calls.job_id IS NEW.job_id
)
BEGIN
  SELECT RAISE(ABORT, 'History names a call of another firm');
END;
