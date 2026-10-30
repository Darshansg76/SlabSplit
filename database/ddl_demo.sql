-- Run against a disposable/demo database. Shows ALTER and DROP in addition to schema.sql CREATE.
BEGIN;
ALTER TABLE household ADD COLUMN demo_note TEXT;
CREATE INDEX demo_household_city_idx ON household(city);
DROP INDEX demo_household_city_idx;
ALTER TABLE household DROP COLUMN demo_note;
ROLLBACK;
