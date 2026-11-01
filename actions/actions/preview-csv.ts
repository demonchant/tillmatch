import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";
import { parseCsv, CsvInputError } from "../../src/csv.mjs";

export default defineAction({
  description: "Preview the header names and row count from an uploaded CSV so the signed-in person can explicitly map columns. Never returns row values and does not persist the file.",
  agentTool: false,
  audit: { recordInputs: false },
  schema: z.object({ csvText: z.string().min(1).max(2_000_000) }),
  run: async ({ csvText }) => {
    try {
      const parsed = parseCsv(csvText);
      return { headers: parsed.headers, rowCount: parsed.records.length, message: `Parsed ${parsed.records.length} CSV rows. Select each field mapping before import.` };
    } catch (error) {
      if (error instanceof CsvInputError) fail(error.message, { errorCode: "csv_invalid", statusCode: 400 });
      throw error;
    }
  },
});
