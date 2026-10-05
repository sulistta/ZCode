/** Frozen additive migration; earlier schema/checksum inputs must remain unchanged. */
export const ACCOUNT_RECIPE_SNAPSHOT_MIGRATION_SQL = `
ALTER TABLE automations ADD COLUMN recipe_snapshot TEXT;
ALTER TABLE automation_runs ADD COLUMN recipe_snapshot TEXT;
`;
