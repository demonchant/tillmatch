import { defineAction, fail } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb, schema } from "../../server/server/db/index.js";
import { matchSettlements } from "../../src/matcher.mjs";

export default defineAction({
  description: "Confirm one exact, unique Paystack settlement-to-bank-credit candidate after a person has inspected both source rows. UI-only: agents may read and explain evidence but cannot confirm a financial closeout. Revalidates current source state and prevents a settlement or bank credit from being confirmed twice.",
  agentTool: false,
  schema: z.object({ matchResultId: z.string().min(1) }),
  run: async ({ matchResultId }, ctx) => {
    if (!ctx?.userEmail) fail("Sign in before confirming a match.", { errorCode: "authentication_required", statusCode: 401 });
    const db = getDb();
    const [match] = await db.select().from(schema.matchResults).where(and(
      eq(schema.matchResults.id, matchResultId), eq(schema.matchResults.ownerEmail, ctx!.userEmail!),
    ));
    if (!match || match.status !== "candidate_match" || !match.bankCreditId) {
      fail("Only an unconfirmed exact-match candidate can be confirmed.", { errorCode: "candidate_unavailable", statusCode: 409 });
    }
    const [run] = await db.select().from(schema.reconciliationRuns).where(and(
      eq(schema.reconciliationRuns.id, match.runId), eq(schema.reconciliationRuns.ownerEmail, ctx!.userEmail!),
    ));
    if (!run) fail("The closeout no longer exists.", { errorCode: "run_not_found", statusCode: 404 });
    const settlements = await db.select().from(schema.settlements).where(and(
      eq(schema.settlements.ownerEmail, ctx!.userEmail!), eq(schema.settlements.environment, run.environment),
    ));
    const bankCredits = await db.select().from(schema.bankCredits).where(eq(schema.bankCredits.ownerEmail, ctx!.userEmail!));
    const revalidated = matchSettlements(
      settlements.map((row) => ({ id: row.id, settlementDate: row.settlementDate, amountMinor: row.amountMinor, currency: row.currency, status: row.status })),
      bankCredits.map((row) => ({ id: row.id, postedOn: row.postedOn, amountMinor: row.amountMinor, currency: row.currency })),
      { windowDays: run.windowDays },
    ).results.find((row) => row.settlementId === match.settlementId);
    if (revalidated?.status !== "matched" || revalidated.bankCreditId !== match.bankCreditId) {
      fail("The source rows changed or the match is no longer unique. Run a fresh closeout and review again.", { errorCode: "stale_candidate", statusCode: 409 });
    }
    const bankCreditId = match.bankCreditId!;
    const confirmedAt = new Date().toISOString();
    await db.transaction(async (tx) => {
      const inserted = await tx.insert(schema.confirmedMatches).values({
        id: randomUUID(), ownerEmail: ctx!.userEmail!, environment: run.environment, runId: run.id,
        settlementId: match.settlementId, bankCreditId,
        confirmedBy: ctx!.userEmail!, confirmedAt,
      }).onConflictDoNothing().returning({ id: schema.confirmedMatches.id });
      if (!inserted[0]) fail("This settlement or bank row was already confirmed in another closeout.", { errorCode: "already_confirmed", statusCode: 409 });
      const updated = await tx.update(schema.matchResults).set({ status: "confirmed", reviewedBy: ctx!.userEmail!, reviewedAt: confirmedAt })
        .where(and(eq(schema.matchResults.id, match.id), eq(schema.matchResults.ownerEmail, ctx!.userEmail!), eq(schema.matchResults.status, "candidate_match")))
        .returning({ id: schema.matchResults.id });
      if (!updated[0]) fail("The candidate changed while it was being confirmed.", { errorCode: "stale_candidate", statusCode: 409 });
    });
    const [readback] = await db.select().from(schema.confirmedMatches).where(and(
      eq(schema.confirmedMatches.ownerEmail, ctx!.userEmail!), eq(schema.confirmedMatches.runId, run.id),
      eq(schema.confirmedMatches.settlementId, match.settlementId), eq(schema.confirmedMatches.bankCreditId, bankCreditId),
    ));
    if (!readback) fail("Confirmation was written but could not be independently read back.", { errorCode: "readback_incomplete", statusCode: 503 });
    return { id: match.id, status: "confirmed", confirmedAt, message: "Person-confirmed exact match; persisted confirmation was read back." };
  },
});
