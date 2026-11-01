import { defineAction, fail } from "@agent-native/core/action";
import { and, eq, inArray } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb, schema } from "../../server/server/db/index.js";
import { makePaystackSettlementRows, CsvInputError } from "../../src/csv.mjs";

const mappingSchema = z.object({ id: z.string().min(1).max(100), date: z.string().min(1).max(100), amount: z.string().min(1).max(100), currency: z.string().min(1).max(100), status: z.string().min(1).max(100) });

export default defineAction({
  description: "Import a user-owned Paystack settlement CSV after the person explicitly maps ID, date, net amount, currency and status columns and selects whether amounts are major or minor currency units. The raw CSV is not stored or sent to the agent. Never infer a column or amount unit.",
  agentTool: false,
  audit: { recordInputs: false },
  schema: z.object({ csvText: z.string().min(1).max(2_000_000), environment: z.enum(["test", "live"]), mapping: mappingSchema, amountUnit: z.enum(["major", "minor"]) }),
  run: async ({ csvText, environment, mapping, amountUnit }, ctx) => {
    if (!ctx?.userEmail) fail("Sign in before importing settlement data.", { errorCode: "authentication_required", statusCode: 401 });
    let rows;
    try { rows = makePaystackSettlementRows(csvText, mapping, amountUnit); }
    catch (error) { if (error instanceof CsvInputError) fail(error.message, { errorCode: "csv_invalid", statusCode: 400 }); throw error; }
    const observedAt = new Date().toISOString();
    const db = getDb();
    const source = "paystack_csv";
    const fileHash = createHash("sha256").update(csvText).digest("hex");
    await db.transaction(async (tx) => {
      for (const [index, row] of rows.entries()) {
        const current = await tx.select().from(schema.settlements).where(and(
          eq(schema.settlements.ownerEmail, ctx!.userEmail!),
          eq(schema.settlements.environment, environment),
          eq(schema.settlements.sourceId, row.sourceId),
        ));
        if (current[0]) {
          if (current[0].amountMinor !== row.amountMinor || current[0].currency !== row.currency || current[0].settlementDate !== row.settlementDate || current[0].status !== row.status) {
            fail(`Settlement ${row.sourceId} conflicts with an already stored source row. Refresh the API data or inspect both exports before reconciling.`, { errorCode: "source_conflict", statusCode: 409 });
          }
          continue;
        }
        await tx.insert(schema.settlements).values({
          id: randomUUID(), ownerEmail: ctx!.userEmail!, environment, source, sourceId: row.sourceId,
          sourceHash: fileHash, sourceRow: index + 2, settlementDate: row.settlementDate,
          amountMinor: row.amountMinor, currency: row.currency, status: row.status, observedAt,
        });
      }
    });
    const readback = await db.select({ sourceId: schema.settlements.sourceId }).from(schema.settlements)
      .where(and(eq(schema.settlements.ownerEmail, ctx!.userEmail!), eq(schema.settlements.environment, environment), inArray(schema.settlements.sourceId, rows.map((row) => row.sourceId))));
    if (readback.length !== rows.length) fail("CSV rows were parsed but settlement read-back is incomplete.", { errorCode: "readback_incomplete", statusCode: 503 });
    return { source, environment, fileHash, importedCount: rows.length, storedCount: rows.length, observedAt, message: `Imported ${rows.length} rows from the selected Paystack export. Raw CSV was not stored.` };
  },
});
