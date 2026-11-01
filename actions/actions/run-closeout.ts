import { defineAction, fail } from "@agent-native/core/action";
import { and, asc, eq } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb, schema } from "../../server/server/db/index.js";
import { matchSettlements } from "../../src/matcher.mjs";

export default defineAction({
  description: "Compare the current user's real Paystack settlement rows with imported bank credit rows. Persist a replay-safe closeout and exact source-linked candidate matches. Only unique exact currency/amount matches inside the selected date window are suggestions; ambiguous, partial, batch and missing rows stay open. Can be called by the UI or agent.",
  schema: z.object({ environment: z.enum(["test", "live"]), windowDays: z.number().int().min(0).max(7).default(3) }),
  run: async ({ environment, windowDays }, ctx) => {
    if (!ctx?.userEmail) fail("Sign in before reconciling source data.", { errorCode: "authentication_required", statusCode: 401 });
    const db = getDb();
    const settlements = await db.select().from(schema.settlements).where(and(
      eq(schema.settlements.ownerEmail, ctx!.userEmail!), eq(schema.settlements.environment, environment),
    )).orderBy(asc(schema.settlements.settlementDate), asc(schema.settlements.sourceId));
    const bankCredits = await db.select().from(schema.bankCredits).where(eq(schema.bankCredits.ownerEmail, ctx!.userEmail!))
      .orderBy(asc(schema.bankCredits.postedOn), asc(schema.bankCredits.id));
    if (!settlements.length) fail("No Paystack settlements are stored for this environment. Import from the read-only API or an actual settlement export first.", { errorCode: "settlements_empty", statusCode: 409 });
    if (!bankCredits.length) fail("No bank credit rows are stored. Import an actual bank statement CSV first.", { errorCode: "bank_rows_empty", statusCode: 409 });
    const matchInput = settlements.map((row) => ({
      id: row.id, sourceId: row.sourceId, source: row.source, sourceHash: row.sourceHash, sourceRow: row.sourceRow,
      settlementDate: row.settlementDate, amountMinor: row.amountMinor, currency: row.currency, status: row.status,
    }));
    const bankInput = bankCredits.map((row) => ({
      id: row.id, sourceRow: row.sourceRow, importId: row.importId,
      postedOn: row.postedOn, amountMinor: row.amountMinor, currency: row.currency,
    }));
    const inputHash = createHash("sha256").update(JSON.stringify({ environment, windowDays, settlements: matchInput, bankCredits: bankInput })).digest("hex");
    const existing = await db.select().from(schema.reconciliationRuns).where(and(
      eq(schema.reconciliationRuns.ownerEmail, ctx!.userEmail!), eq(schema.reconciliationRuns.inputHash, inputHash),
    ));
    if (existing[0]) return { runId: existing[0].id, environment, inputHash, duplicate: true, candidateCount: existing[0].candidateCount, exceptionCount: existing[0].exceptionCount, message: "These exact source rows and matching rules already have a saved closeout; the previous run was reused." };

    const result = matchSettlements(matchInput.map((row) => ({ id: row.id, settlementDate: row.settlementDate, amountMinor: row.amountMinor, currency: row.currency, status: row.status })), bankInput, { windowDays });
    const runId = randomUUID();
    const candidateCount = result.results.filter((row) => row.status === "matched").length;
    const exceptionCount = result.results.filter((row) => row.status !== "matched").length + result.unmatchedBankCreditIds.length;
    const storedRunId = await db.transaction(async (tx) => {
      const inserted = await tx.insert(schema.reconciliationRuns).values({
        id: runId, ownerEmail: ctx!.userEmail!, environment, inputHash, windowDays,
        settlementsCount: settlements.length, bankCreditsCount: bankCredits.length,
        candidateCount, exceptionCount,
      }).onConflictDoNothing().returning({ id: schema.reconciliationRuns.id });
      if (!inserted[0]) {
        const concurrent = await tx.select({ id: schema.reconciliationRuns.id }).from(schema.reconciliationRuns).where(and(
          eq(schema.reconciliationRuns.ownerEmail, ctx!.userEmail!), eq(schema.reconciliationRuns.inputHash, inputHash),
        ));
        return concurrent[0]?.id ?? null;
      }
      await tx.insert(schema.matchResults).values(result.results.map((row) => ({
        id: randomUUID(), ownerEmail: ctx!.userEmail!, runId,
        settlementId: row.settlementId,
        bankCreditId: row.status === "matched" ? row.bankCreditId : null,
        candidateBankIds: JSON.stringify(row.candidateBankIds ?? []),
        status: row.status === "matched" ? "candidate_match" : row.status,
        reason: row.reason,
      })));
      return runId;
    });
    if (!storedRunId) fail("The run could not be read back after a concurrent retry.", { errorCode: "run_conflict", statusCode: 503 });
    const readback = await db.select().from(schema.matchResults).where(and(
      eq(schema.matchResults.ownerEmail, ctx!.userEmail!), eq(schema.matchResults.runId, storedRunId),
    ));
    if (readback.length !== settlements.length) fail("The closeout was written but result read-back is incomplete.", { errorCode: "readback_incomplete", statusCode: 503 });
    return { runId: storedRunId, environment, inputHash, duplicate: false, settlementsCount: settlements.length, bankCreditsCount: bankCredits.length, candidateCount, exceptionCount, message: `Saved a closeout from ${settlements.length} Paystack rows and ${bankCredits.length} bank credit rows. Exact matches are suggestions until a person confirms them.` };
  },
});
