-- Whether an opt-out was made by the customer's STOP (texted to the firm, or
-- to the provider), so a START undoes only what a STOP did: an opt-out that
-- staff set stays (Greg, answering the slice D pull request, 8 Oct 2026).
-- An opt-out staff set over one a STOP made becomes staff's.
ALTER TABLE opt_outs ADD COLUMN by_stop INTEGER NOT NULL DEFAULT 0 CHECK (by_stop IN (0, 1));
