-- Existing cached decisions must be revalidated after this migration.
ALTER TABLE entitlements ADD COLUMN scope TEXT;
