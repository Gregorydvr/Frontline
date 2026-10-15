-- Trade starter packs (task 2 of queue 2 in docs/autopilot.md): the trade a
-- firm chose at set-up, such as plumbing and heating. Choosing it fills in
-- the firm's urgent list and diary rules, when it has none yet, and gives
-- the drafts its wording starts from (src/trade-packs.ts).
--
-- The list of trades is checked by the record layer, not here, so adding one
-- does not mean rebuilding the table. Null: no trade chosen.
ALTER TABLE firms ADD COLUMN trade TEXT;
