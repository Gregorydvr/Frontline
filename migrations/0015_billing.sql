-- Billing a firm through Stripe, in test mode only (task 2 of queue 3 in
-- docs/autopilot.md). Going live starts a 14-day free trial; after it the
-- firm pays monthly for the services it chose. Card details never reach
-- Front-line: Stripe's own pages take them (rule 7). Ids, states, times and
-- whole pence only.

-- One row for each firm billed, written before Stripe is asked, so the same
-- firm is never subscribed twice.
CREATE TABLE billing (
  firm_id TEXT PRIMARY KEY NOT NULL REFERENCES firms (id),
  -- From BILLING_STATES in src/record/types.ts.
  state TEXT NOT NULL,
  -- The services billed, as a JSON list, and what they cost a month, in
  -- whole pence, worked out in code (src/billing.ts).
  services TEXT NOT NULL,
  monthly_pence INTEGER NOT NULL CHECK (monthly_pence >= 0),
  -- Which price list it was priced from, and, for the first 20 firms billed,
  -- its place among them: their price is locked.
  price_list TEXT NOT NULL,
  founding_number INTEGER UNIQUE CHECK (founding_number IS NULL OR founding_number BETWEEN 1 AND 20),
  trial_ends_at INTEGER NOT NULL,
  -- Stripe's ids for the customer and the subscription, once made.
  stripe_customer TEXT UNIQUE,
  stripe_subscription TEXT UNIQUE,
  -- Whether Stripe holds a card to charge. Only Stripe holds the card.
  card_on_file INTEGER NOT NULL DEFAULT 0 CHECK (card_on_file IN (0, 1)),
  -- When the paid month ends, once Stripe says.
  period_ends_at INTEGER,
  -- The time of the newest Stripe event applied, so an older one arriving
  -- late changes nothing.
  stripe_as_of INTEGER,
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Each Stripe event taken, by Stripe's id for it, so the same event is
-- acted on once however often Stripe sends it.
CREATE TABLE billing_events (
  id TEXT PRIMARY KEY NOT NULL,
  firm_id TEXT NOT NULL REFERENCES firms (id),
  type TEXT NOT NULL,
  at INTEGER NOT NULL
);

CREATE INDEX billing_events_by_firm ON billing_events (firm_id, at);
