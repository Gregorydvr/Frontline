-- A migration used only by test/migrations.test.ts, to show that migrations
-- are applied, recorded and not applied twice. The real ones are in
-- migrations/.
CREATE TABLE example (id TEXT PRIMARY KEY NOT NULL);
