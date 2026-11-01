import { runMigrations } from "@agent-native/core/db";

export default runMigrations([
  {
    version: 1,
    name: "tillmatch-source-and-run-tables",
    sql: `
      CREATE TABLE IF NOT EXISTS tillmatch_settlements (
        id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, environment TEXT NOT NULL,
        source TEXT NOT NULL, source_id TEXT NOT NULL, source_hash TEXT, source_row INTEGER, settlement_date TEXT NOT NULL,
        amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0), currency TEXT NOT NULL,
        status TEXT NOT NULL, observed_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS tillmatch_settlement_owner_env_id_idx
        ON tillmatch_settlements(owner_email, environment, source_id);
      CREATE TABLE IF NOT EXISTS tillmatch_bank_imports (
        id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, file_hash TEXT NOT NULL,
        rows_count INTEGER NOT NULL CHECK (rows_count >= 0), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE UNIQUE INDEX IF NOT EXISTS tillmatch_bank_import_owner_hash_idx
        ON tillmatch_bank_imports(owner_email, file_hash);
      CREATE TABLE IF NOT EXISTS tillmatch_bank_credits (
        id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, import_id TEXT NOT NULL,
        source_row INTEGER NOT NULL, posted_on TEXT NOT NULL,
        amount_minor INTEGER NOT NULL CHECK (amount_minor > 0), currency TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS tillmatch_bank_import_row_idx
        ON tillmatch_bank_credits(import_id, source_row);
      CREATE TABLE IF NOT EXISTS tillmatch_runs (
        id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, environment TEXT NOT NULL,
        input_hash TEXT NOT NULL, window_days INTEGER NOT NULL CHECK (window_days BETWEEN 0 AND 7),
        settlements_count INTEGER NOT NULL, bank_credits_count INTEGER NOT NULL,
        candidate_count INTEGER NOT NULL, exception_count INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE UNIQUE INDEX IF NOT EXISTS tillmatch_run_owner_hash_idx
        ON tillmatch_runs(owner_email, input_hash);
      CREATE TABLE IF NOT EXISTS tillmatch_match_results (
        id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, run_id TEXT NOT NULL,
        settlement_id TEXT NOT NULL, bank_credit_id TEXT, candidate_bank_ids TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL,
        reason TEXT NOT NULL, review_code TEXT, reviewed_by TEXT, reviewed_at TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS tillmatch_result_run_settlement_idx
        ON tillmatch_match_results(run_id, settlement_id);
      CREATE UNIQUE INDEX IF NOT EXISTS tillmatch_result_run_bank_idx
        ON tillmatch_match_results(run_id, bank_credit_id);
      CREATE TABLE IF NOT EXISTS tillmatch_confirmed_matches (
        id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, environment TEXT NOT NULL,
        run_id TEXT NOT NULL, settlement_id TEXT NOT NULL, bank_credit_id TEXT NOT NULL,
        confirmed_by TEXT NOT NULL, confirmed_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS tillmatch_confirmed_settlement_idx
        ON tillmatch_confirmed_matches(owner_email, environment, settlement_id);
      CREATE UNIQUE INDEX IF NOT EXISTS tillmatch_confirmed_bank_idx
        ON tillmatch_confirmed_matches(owner_email, environment, bank_credit_id);
    `,
  },
], { table: "tillmatch_migrations" });
