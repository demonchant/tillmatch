import { sql } from "drizzle-orm";
import { integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

export const settlements = pgTable("tillmatch_settlements", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  environment: text("environment").notNull(),
  source: text("source").notNull(),
  sourceId: text("source_id").notNull(),
  sourceHash: text("source_hash"),
  sourceRow: integer("source_row"),
  settlementDate: text("settlement_date").notNull(),
  amountMinor: integer("amount_minor").notNull(),
  currency: text("currency").notNull(),
  status: text("status").notNull(),
  observedAt: text("observed_at").notNull(),
}, (table) => [uniqueIndex("tillmatch_settlement_owner_env_id_idx").on(table.ownerEmail, table.environment, table.sourceId)]);

export const bankImports = pgTable("tillmatch_bank_imports", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  fileHash: text("file_hash").notNull(),
  rowsCount: integer("rows_count").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("tillmatch_bank_import_owner_hash_idx").on(table.ownerEmail, table.fileHash)]);

export const bankCredits = pgTable("tillmatch_bank_credits", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  importId: text("import_id").notNull(),
  sourceRow: integer("source_row").notNull(),
  postedOn: text("posted_on").notNull(),
  amountMinor: integer("amount_minor").notNull(),
  currency: text("currency").notNull(),
}, (table) => [uniqueIndex("tillmatch_bank_import_row_idx").on(table.importId, table.sourceRow)]);

export const reconciliationRuns = pgTable("tillmatch_runs", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  environment: text("environment").notNull(),
  inputHash: text("input_hash").notNull(),
  windowDays: integer("window_days").notNull(),
  settlementsCount: integer("settlements_count").notNull(),
  bankCreditsCount: integer("bank_credits_count").notNull(),
  candidateCount: integer("candidate_count").notNull(),
  exceptionCount: integer("exception_count").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("tillmatch_run_owner_hash_idx").on(table.ownerEmail, table.inputHash)]);

export const matchResults = pgTable("tillmatch_match_results", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  runId: text("run_id").notNull(),
  settlementId: text("settlement_id").notNull(),
  bankCreditId: text("bank_credit_id"),
  candidateBankIds: text("candidate_bank_ids").notNull().default("[]"),
  status: text("status").notNull(),
  reason: text("reason").notNull(),
  reviewCode: text("review_code"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: text("reviewed_at"),
}, (table) => [
  uniqueIndex("tillmatch_result_run_settlement_idx").on(table.runId, table.settlementId),
  uniqueIndex("tillmatch_result_run_bank_idx").on(table.runId, table.bankCreditId),
]);

export const confirmedMatches = pgTable("tillmatch_confirmed_matches", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  environment: text("environment").notNull(),
  runId: text("run_id").notNull(),
  settlementId: text("settlement_id").notNull(),
  bankCreditId: text("bank_credit_id").notNull(),
  confirmedBy: text("confirmed_by").notNull(),
  confirmedAt: text("confirmed_at").notNull(),
}, (table) => [
  uniqueIndex("tillmatch_confirmed_settlement_idx").on(table.ownerEmail, table.environment, table.settlementId),
  uniqueIndex("tillmatch_confirmed_bank_idx").on(table.ownerEmail, table.environment, table.bankCreditId),
]);

export const schema = { settlements, bankImports, bankCredits, reconciliationRuns, matchResults, confirmedMatches };
