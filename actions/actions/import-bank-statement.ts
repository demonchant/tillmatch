import { defineAction, fail } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb, schema } from "../../server/server/db/index.js";
import { makeBankRows, CsvInputError } from "../../src/csv.mjs";

const mappingSchema = z.object({ date: z.string().min(1).max(100), amount: z.string().min(1).max(100), currency: z.string().min(1).max(100) });

export default defineAction({
  description: "Import the current user's bank statement CSV after they explicitly map date, positive credit amount and currency columns. The raw CSV, account details, narration and customer data are not persisted or sent to the agent. Does not accept debits or silently discard rows.",
  agentTool: false,
  audit: { recordInputs: false },
  schema: z.object({ csvText: z.string().min(1).max(2_000_000), mapping: mappingSchema }),
  run: async ({ csvText, mapping }, ctx) => {
    if (!ctx?.userEmail) fail("Sign in before importing a bank statement.", { errorCode: "authentication_required", statusCode: 401 });
    let rows;
    try { rows = makeBankRows(csvText, mapping); }
    catch (error) { if (error instanceof CsvInputError) fail(error.message, { errorCode: "csv_invalid", statusCode: 400 }); throw error; }
    const fileHash = createHash("sha256").update(csvText).digest("hex");
    const db = getDb();
    const existing = await db.select().from(schema.bankImports).where(and(eq(schema.bankImports.ownerEmail, ctx!.userEmail!), eq(schema.bankImports.fileHash, fileHash)));
    if (existing[0]) return { importId: existing[0].id, fileHash, importedCount: existing[0].rowsCount, duplicate: true, message: "This exact bank export was already imported; existing rows were reused." };
    const importId = randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert(schema.bankImports).values({ id: importId, ownerEmail: ctx!.userEmail!, fileHash, rowsCount: rows.length });
      await tx.insert(schema.bankCredits).values(rows.map((row) => ({
        id: `${importId}:${row.sourceRow}`,
        ownerEmail: ctx!.userEmail!,
        importId,
        sourceRow: row.sourceRow,
        postedOn: row.postedOn,
        amountMinor: row.amountMinor,
        currency: row.currency,
      })));
    });
    const readback = await db.select({ id: schema.bankCredits.id }).from(schema.bankCredits).where(eq(schema.bankCredits.importId, importId));
    if (readback.length !== rows.length) fail("Bank CSV import read-back count did not match parsed rows.", { errorCode: "readback_incomplete", statusCode: 503 });
    return { importId, fileHash, importedCount: rows.length, duplicate: false, message: `Imported ${rows.length} positive credit rows. Raw CSV and narration were discarded.` };
  },
});
