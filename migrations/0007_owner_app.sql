-- The owner's app (slice F of docs/build-brief.md): logging in by a link sent
-- by text, the logins that follow, and what an owner writes in Message us.
--
-- Nothing here rebuilds a table. Each new link carries the firm as well as
-- the id, so the database itself refuses a link across firms (rule 8).

-- A link that logs an owner in, sent by text to the owner's own mobile. It
-- works once, until it expires. Its token cannot be guessed, and the address
-- holds the token and nothing else.
CREATE TABLE login_links (
  token TEXT PRIMARY KEY NOT NULL,
  firm_id TEXT NOT NULL REFERENCES firms (id),
  owner_id TEXT NOT NULL,
  -- The job to land on once logged in, such as the one an urgent alert's
  -- link opens. Empty for Home.
  job_id TEXT,
  -- The row in the due list whose text carries the link.
  due_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  -- When it was used, and the login it started (the login's own id, never
  -- the token in its cookie). A link is used once.
  used_at INTEGER,
  session_id TEXT,
  created_at INTEGER NOT NULL,
  CHECK (expires_at > created_at),
  CHECK ((used_at IS NULL) = (session_id IS NULL)),
  UNIQUE (firm_id, due_id),
  FOREIGN KEY (firm_id, owner_id) REFERENCES owners (firm_id, id),
  FOREIGN KEY (firm_id, job_id) REFERENCES jobs (firm_id, id),
  FOREIGN KEY (firm_id, due_id) REFERENCES due (firm_id, id)
);

CREATE INDEX login_links_by_owner ON login_links (firm_id, owner_id, created_at);

-- An owner's login: what their browser's cookie stands for. The id is the
-- SHA-256 of the token in the cookie, so the token itself is never stored.
-- It ends when it has not been used for a while, when it reaches its
-- longest, or when the owner logs out.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY NOT NULL,
  firm_id TEXT NOT NULL REFERENCES firms (id),
  owner_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  ended_at INTEGER,
  UNIQUE (firm_id, id),
  FOREIGN KEY (firm_id, owner_id) REFERENCES owners (firm_id, id)
);

CREATE INDEX sessions_by_owner ON sessions (firm_id, owner_id);

-- What an owner wrote in Message us, for Front-line's staff.
CREATE TABLE owner_messages (
  id TEXT PRIMARY KEY NOT NULL,
  firm_id TEXT NOT NULL REFERENCES firms (id),
  owner_id TEXT NOT NULL,
  words TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (firm_id, id),
  FOREIGN KEY (firm_id, owner_id) REFERENCES owners (firm_id, id)
);

CREATE INDEX owner_messages_by_time ON owner_messages (firm_id, created_at);

-- Who did what is never edited (rule 15): what an owner wrote stays as they
-- wrote it.
CREATE TRIGGER owner_messages_are_never_edited BEFORE UPDATE ON owner_messages
BEGIN
  SELECT RAISE(ABORT, 'What an owner wrote is never edited');
END;
