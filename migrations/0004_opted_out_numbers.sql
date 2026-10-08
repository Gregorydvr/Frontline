-- Numbers opted out of every text from a firm (Greg's answer to open question
-- 2: a customer's STOP stops every text from the firm to that number). A STOP
-- also opts out each customer on the number, for their job pages; this keeps
-- the number itself, so a customer made later on the same mobile, or one made
-- after a STOP from a number nobody had yet, gets no text either. START, or
-- UNSTOP, takes the number off.
CREATE TABLE opted_out_numbers (
  firm_id TEXT NOT NULL REFERENCES firms (id),
  mobile TEXT NOT NULL
    CHECK (mobile GLOB '+447[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'),
  at INTEGER NOT NULL,
  PRIMARY KEY (firm_id, mobile)
);
