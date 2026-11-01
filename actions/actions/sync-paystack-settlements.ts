import { defineAction, fail } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../../server/server/db/index.js";
import { listSettlements, PaystackError } from "../../src/paystack.mjs";

export default defineAction({
  description: "Read actual Paystack settlements for the selected date range and store source IDs and payout amounts for the current user's closeout. This is read-only with Paystack. If not configured, ask the user to import a Paystack settlement CSV; never invent results.",
  schema: z.object({
    expectedEnvironment: z.enum(["test", "live"]),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
  run: async ({ expectedEnvironment, from, to }, ctx) => {
    if (!ctx?.userEmail) fail("Sign in before importing settlement data.", { errorCode: "authentication_required", statusCode: 401 });
    let result;
    try { result = await listSettlements({ ...(from ? { from } : {}), ...(to ? { to } : {}) }); }
    catch (error) {
      if (error instanceof PaystackError) fail(error.message, { errorCode: error.code, statusCode: error.status ?? 503 });
      throw error;
    }
    if (result.environment !== expectedEnvironment) fail(`The configured Paystack key is ${result.environment}, but the page selected ${expectedEnvironment}. No rows were stored.`, { errorCode: "environment_mismatch", statusCode: 409 });
    const db = getDb();
    const source = "paystack_api";
    await db.transaction(async (tx) => {
      for (const row of result.settlements) {
        await tx.insert(schema.settlements).values({
          id: `${ctx!.userEmail!}:${result.environment}:${source}:${row.id}`,
          ownerEmail: ctx!.userEmail!,
          environment: result.environment,
          source,
          sourceId: row.id,
          sourceHash: null,
          sourceRow: null,
          settlementDate: row.settlementDate,
          amountMinor: row.amountMinor,
          currency: row.currency,
          status: row.status,
          observedAt: result.retrievedAt,
        }).onConflictDoUpdate({
          target: [schema.settlements.ownerEmail, schema.settlements.environment, schema.settlements.sourceId],
          set: { source, sourceHash: null, sourceRow: null, settlementDate: row.settlementDate, amountMinor: row.amountMinor, currency: row.currency, status: row.status, observedAt: result.retrievedAt },
        });
      }
    });
    const persisted = await db.select({ sourceId: schema.settlements.sourceId })
      .from(schema.settlements)
      .where(and(eq(schema.settlements.ownerEmail, ctx!.userEmail!), eq(schema.settlements.environment, result.environment)));
    if (persisted.length < result.settlements.length) fail("The source fetch completed but database read-back is incomplete; retry the import.", { errorCode: "readback_incomplete", statusCode: 503 });
    return { source: result.source, environment: result.environment, retrievedAt: result.retrievedAt, fetchedCount: result.settlements.length, storedCount: result.settlements.length, message: `Read ${result.settlements.length} Paystack settlement rows.`, nextRequiredAction: "import-bank-statement" };
  },
});
