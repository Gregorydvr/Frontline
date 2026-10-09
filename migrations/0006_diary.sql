-- The diary and booking (slice E of docs/build-brief.md): when a firm's
-- visits can be booked, how long a visit takes, holds on times taken during a
-- call, the customer's own details, and the links a customer opens.
--
-- Nothing here rebuilds a table. Columns are added to the tables of slices B
-- to D, and holds and links are new. Each new link carries the firm as well
-- as the id, so the database itself refuses a link across firms (rule 8).

-- When visits can be booked, and how long each kind takes, as JSON. The
-- record layer checks it. Empty means the firm is offered no times.
ALTER TABLE firms ADD COLUMN diary_rules TEXT;

-- When a visit ends. Visits from before slice E have none, and count as an
-- hour long when the diary looks for free times.
ALTER TABLE visits ADD COLUMN ends_at INTEGER CHECK (ends_at IS NULL OR ends_at > starts_at);

-- The customer's own details: the address taken on the call, an email the
-- customer adds, and when they last confirmed them from their link.
ALTER TABLE customers ADD COLUMN address TEXT;
ALTER TABLE customers ADD COLUMN email TEXT;
ALTER TABLE customers ADD COLUMN details_confirmed_at INTEGER;

-- A time held in the diary during a call, before the call ends and its
-- customer and job are filed. The provider's id for the call ties the two:
-- when the report comes, the hold becomes a visit on the job the call opened.
-- One hold for each call; booking again on the same call moves it.
CREATE TABLE holds (
  id TEXT PRIMARY KEY NOT NULL,
  firm_id TEXT NOT NULL REFERENCES firms (id),
  provider TEXT NOT NULL,
  provider_call_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('quote_visit', 'install', 'service')),
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  -- held, filed or released, checked by the record layer.
  state TEXT NOT NULL,
  -- The visit it became, once filed.
  visit_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (ends_at > starts_at),
  CHECK ((state = 'filed') = (visit_id IS NOT NULL)),
  UNIQUE (firm_id, provider, provider_call_id),
  UNIQUE (firm_id, id),
  FOREIGN KEY (firm_id, visit_id) REFERENCES visits (firm_id, id)
);

CREATE INDEX holds_by_start ON holds (firm_id, state, starts_at);

-- A link a customer opens with no login (rule 13): a token that cannot be
-- guessed, for one customer and one job, until it expires. The address holds
-- the token and nothing else.
CREATE TABLE links (
  token TEXT PRIMARY KEY NOT NULL,
  firm_id TEXT NOT NULL REFERENCES firms (id),
  customer_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  -- The row in the due list whose text carries the link, so running that
  -- row again gives the same link.
  due_id TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  CHECK (expires_at > created_at),
  UNIQUE (firm_id, due_id),
  FOREIGN KEY (firm_id, customer_id, job_id) REFERENCES jobs (firm_id, customer_id, id),
  FOREIGN KEY (firm_id, due_id) REFERENCES due (firm_id, id)
);

CREATE INDEX links_by_customer ON links (firm_id, customer_id);
