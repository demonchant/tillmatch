import { defineAction, fail } from "@agent-native/core/action";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description: "Read a closeout or the latest closeout for the current user. Returns settlement IDs, bank import row numbers, source hashes, amounts, currencies, dates and review status without customer names, narration, account numbers or raw CSV. Use this to answer questions about visible reconciliation evidence; distinguish a candidate match from a human-confirmed match.",
  http: { method: "GET" },
  schema: z.object({ runId: z.string().optional(), environment: z.enum(["test", "live"]).optional() }),
  run: async ({ runId, environment }, ctx) => {
    if (!ctx.userEmail) fail("Sign in to view your closeout.", { errorCode: "authentication_required", statusCode: 401 });
    const db = getDb();
    const filters = [eq(schema.reconciliationRuns.ownerEmail, ctx.userEmail)];
    if (runId) filters.push(eq(schema.reconciliationRuns.id, runId));
    if (environment) filters.push(eq(schema.reconciliationRuns.environment, environment));
    const runs = await db.select().from(schema.reconciliationRuns).where(and(...filters)).orderBy(desc(schema.reconciliationRuns.createdAt)).limit(1);
    const run = runs[0];
    if (!run) return { state: "empty", message: "No closeout exists yet for this user and environment. Import real source data, then run a closeout." };
    const results = await db.select().from(schema.matchResults).where(and(
      eq(schema.matchResults.ownerEmail, ctx.userEmail), eq(schema.matchResults.runId, run.id),
    ));
    const settlementIds = [...new Set(results.map((row) => row.settlementId))];
    const bankIds = [...new Set(results.flatMap((row) => [row.bankCreditId, ...JSON.parse(row.candidateBankIds || "[]")]).filter(Boolean))];
    const settlementRows = settlementIds.length ? await db.select().from(schema.settlements).where(and(
      eq(schema.settlements.ownerEmail, ctx.userEmail), eq(schema.settlements.environment, run.environment), inArray(schema.settlements.id, settlementIds),
    )) : [];
    const bankRows = bankIds.length ? await db.select().from(schema.bankCredits).where(and(
      eq(schema.bankCredits.ownerEmail, ctx.userEmail), inArray(schema.bankCredits.id, bankIds),
    )) : [];
    const imports = await db.select().from(schema.bankImports).where(eq(schema.bankImports.ownerEmail, ctx.userEmail));
    const settlementMap = new Map(settlementRows.filter((row) => settlementIds.includes(row.id)).map((row) => [row.id, row]));
    const bankMap = new Map(bankRows.filter((row) => bankIds.includes(row.id)).map((row) => [row.id, row]));
    const importMap = new Map(imports.map((row) => [row.id, row]));
    const referencedBankIds = new Set(results.flatMap((row) => [row.bankCreditId, ...JSON.parse(row.candidateBankIds || "[]")]).filter(Boolean));
    const unmatchedBankCredits = await db.select().from(schema.bankCredits).where(eq(schema.bankCredits.ownerEmail, ctx.userEmail));
    return {
      state: "available",
      run: {
        id: run.id, environment: run.environment, createdAt: run.createdAt,
        windowDays: run.windowDays, settlementsCount: run.settlementsCount,
        bankCreditsCount: run.bankCreditsCount, candidateCount: run.candidateCount,
        exceptionCount: run.exceptionCount,
      },
      results: results.map((item) => {
        const settlement = settlementMap.get(item.settlementId);
        const bank = item.bankCreditId ? bankMap.get(item.bankCreditId) : undefined;
        return {
          id: item.id, status: item.status, reason: item.reason, reviewCode: item.reviewCode,
          candidateBankCredits: JSON.parse(item.candidateBankIds || "[]").map((id: string) => bankMap.get(id)).filter(Boolean).map((row) => ({
            id: row.id, importId: row.importId, sourceRow: row.sourceRow, postedOn: row.postedOn, amountMinor: row.amountMinor, currency: row.currency,
            sourceHash: importMap.get(row.importId)?.fileHash ?? null,
          })),
          reviewedAt: item.reviewedAt,
          settlement: settlement ? {
            id: settlement.id, sourceId: settlement.sourceId, source: settlement.source,
            sourceHash: settlement.sourceHash, sourceRow: settlement.sourceRow,
            settlementDate: settlement.settlementDate, amountMinor: settlement.amountMinor,
            currency: settlement.currency, providerStatus: settlement.status,
          } : null,
          bankCredit: bank ? {
            id: bank.id, importId: bank.importId, sourceRow: bank.sourceRow,
            postedOn: bank.postedOn, amountMinor: bank.amountMinor, currency: bank.currency,
            sourceHash: importMap.get(bank.importId)?.fileHash ?? null,
          } : null,
          reviewedBy: item.reviewedBy ? "A signed-in reviewer" : null,
        };
      }),
      unmatchedBankCredits: unmatchedBankCredits.filter((row) => !referencedBankIds.has(row.id)).map((row) => ({
        id: row.id, importId: row.importId, sourceRow: row.sourceRow, postedOn: row.postedOn,
        amountMinor: row.amountMinor, currency: row.currency, sourceHash: importMap.get(row.importId)?.fileHash ?? null,
      })),
      message: `Read ${results.length} persisted settlement results from closeout ${run.id}. Candidate matches are not confirmed until a person records confirmation.`,
    };
  },
});
