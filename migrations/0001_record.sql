-- The record: firms, their owners, customers, jobs, visits and the history of
-- who did what (slice B of docs/build-brief.md).
--
-- Every table but firms has firm_id (rule 8 in CLAUDE.md). Each link from one
-- table to another carries the firm as well as the id, so the database itself
-- refuses a job that points at another firm's customer, and so on down.
--
-- Instants are whole milliseconds since 1970, UTC (rule 18). True and false
-- are 1 and 0. Lists that later slices will add to, such as the kinds of
-- history entry, are checked by the record layer rather than here, so adding
-- one does not mean rebuilding a table.

CREATE TABLE firms (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  is_example INTEGER NOT NULL CHECK (is_example IN (0, 1)),
  -- A switch for each of the five services. A new firm starts with all off.
  calls_on INTEGER NOT NULL DEFAULT 0 CHECK (calls_on IN (0, 1)),
  quotes_on INTEGER NOT NULL DEFAULT 0 CHECK (quotes_on IN (0, 1)),
  followups_on INTEGER NOT NULL DEFAULT 0 CHECK (followups_on IN (0, 1)),
  paperwork_on INTEGER NOT NULL DEFAULT 0 CHECK (paperwork_on IN (0, 1)),
  invoices_on INTEGER NOT NULL DEFAULT 0 CHECK (invoices_on IN (0, 1)),
  -- The stop button: when on, nothing goes to this firm's customers.
  stopped INTEGER NOT NULL DEFAULT 0 CHECK (stopped IN (0, 1)),
  created_at INTEGER NOT NULL
);

CREATE INDEX firms_by_example ON firms (is_example);

CREATE TABLE owners (
  id TEXT PRIMARY KEY NOT NULL,
  firm_id TEXT NOT NULL REFERENCES firms (id),
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (firm_id, id)
);

CREATE TABLE customers (
  id TEXT PRIMARY KEY NOT NULL,
  firm_id TEXT NOT NULL REFERENCES firms (id),
  -- The name as given, such as "Mrs Green".
  name TEXT NOT NULL,
  -- A UK mobile written as +447700900001, or nothing when there is none.
  mobile TEXT CHECK (mobile IS NULL OR mobile GLOB '+447[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'),
  created_at INTEGER NOT NULL,
  UNIQUE (firm_id, id)
);

CREATE INDEX customers_by_mobile ON customers (firm_id, mobile);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY NOT NULL,
  firm_id TEXT NOT NULL REFERENCES firms (id),
  customer_id TEXT NOT NULL,
  -- What it is about, such as "No hot water".
  about TEXT NOT NULL,
  -- Where, such as "24 Beech Avenue".
  place TEXT NOT NULL,
  urgent INTEGER NOT NULL DEFAULT 0 CHECK (urgent IN (0, 1)),
  created_at INTEGER NOT NULL,
  UNIQUE (firm_id, id),
  UNIQUE (firm_id, customer_id, id),
  FOREIGN KEY (firm_id, customer_id) REFERENCES customers (firm_id, id)
);

CREATE INDEX jobs_by_customer ON jobs (firm_id, customer_id);

CREATE TABLE visits (
  id TEXT PRIMARY KEY NOT NULL,
  firm_id TEXT NOT NULL REFERENCES firms (id),
  job_id TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('quote_visit', 'install', 'service')),
  -- booked or cancelled, checked by the record layer.
  state TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (firm_id, id),
  UNIQUE (firm_id, job_id, id),
  FOREIGN KEY (firm_id, job_id) REFERENCES jobs (firm_id, id)
);

CREATE INDEX visits_by_job ON visits (firm_id, job_id, starts_at);
CREATE INDEX visits_by_start ON visits (firm_id, starts_at);

-- Who did what, and when. An entry holds ids, a kind and a time, never words:
-- the line an owner reads is made from it when it is shown. Never edited.
CREATE TABLE history (
  id TEXT PRIMARY KEY NOT NULL,
  firm_id TEXT NOT NULL REFERENCES firms (id),
  at INTEGER NOT NULL,
  -- The order the entries were written in, so that several things done at
  -- the same moment read back in the order they happened.
  seq INTEGER NOT NULL UNIQUE,
  -- Who did it. An owner or a member of staff is named by their id; a
  -- customer is the customer the entry is about.
  actor TEXT NOT NULL CHECK (actor IN ('frontline', 'owner', 'customer', 'staff')),
  owner_id TEXT,
  -- Staff are not part of any firm. Their table comes with the control room.
  staff_id TEXT,
  -- What happened, from the list in src/record/history.ts.
  kind TEXT NOT NULL,
  -- What it was about. A visit's entry also names its job and customer, and
  -- a job's entry its customer. The links below make sure they agree.
  customer_id TEXT,
  job_id TEXT,
  visit_id TEXT,
  -- For a service switched on or off: which one.
  service TEXT CHECK (service IS NULL OR service IN ('calls', 'quotes', 'followups', 'paperwork', 'invoices')),
  CHECK ((actor = 'owner') = (owner_id IS NOT NULL)),
  CHECK ((actor = 'staff') = (staff_id IS NOT NULL)),
  CHECK (actor <> 'customer' OR customer_id IS NOT NULL),
  CHECK (job_id IS NULL OR customer_id IS NOT NULL),
  CHECK (visit_id IS NULL OR job_id IS NOT NULL),
  FOREIGN KEY (firm_id, owner_id) REFERENCES owners (firm_id, id),
  FOREIGN KEY (firm_id, customer_id) REFERENCES customers (firm_id, id),
  FOREIGN KEY (firm_id, customer_id, job_id) REFERENCES jobs (firm_id, customer_id, id),
  FOREIGN KEY (firm_id, job_id, visit_id) REFERENCES visits (firm_id, job_id, id)
);

CREATE INDEX history_by_time ON history (firm_id, at, seq);
CREATE INDEX history_by_customer ON history (firm_id, customer_id, at, seq);
CREATE INDEX history_by_job ON history (firm_id, job_id, at, seq);
CREATE INDEX history_by_visit ON history (firm_id, visit_id);

-- Rule 15: who did what is recorded and never edited.
CREATE TRIGGER history_is_never_edited BEFORE UPDATE ON history
BEGIN
  SELECT RAISE(ABORT, 'History is never edited');
END;
