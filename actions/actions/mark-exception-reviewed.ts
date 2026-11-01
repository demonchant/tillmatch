import { defineAction, fail } from "@agent-native/core/action";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description: "Tag an open reconciliation exception as reviewed with a fixed follow-up category. This never closes or resolves it. UI-only; agents cannot make a review assertion for the person.",
  agentTool: false,
  schema: z.object({
    matchResultId: z.string().min(1),
    reviewCode: z.enum(["waiting_for_bank_post", "partial_or_batched", "provider_record_check", "needs_bookkeeper_followup"]),
  }),
  run: async ({ matchResultId, reviewCode }, ctx) => {
    if (!ctx.userEmail) fail("Sign in before reviewing an exception.", { errorCode: "authentication_required", statusCode: 401 });
    const db = getDb();
    const reviewedAt = new Date().toISOString();
    const [row] = await db.update(schema.matchResults).set({ reviewCode, reviewedBy: ctx.userEmail, reviewedAt })
      .where(and(eq(schema.matchResults.id, matchResultId), eq(schema.matchResults.ownerEmail, ctx.userEmail), inArray(schema.matchResults.status, ["unmatched", "ambiguous", "not_settled", "invalid_source"])))
      .returning({ id: schema.matchResults.id, status: schema.matchResults.status, reviewCode: schema.matchResults.reviewCode });
    if (!row) fail("Only an open exception can receive a review tag.", { errorCode: "exception_unavailable", statusCode: 409 });
    const [readback] = await db.select().from(schema.matchResults).where(and(
      eq(schema.matchResults.id, matchResultId), eq(schema.matchResults.ownerEmail, ctx.userEmail),
    ));
    if (readback?.reviewCode !== reviewCode) fail("Review tag could not be read back.", { errorCode: "readback_incomplete", statusCode: 503 });
    return { id: row.id, status: row.status, reviewCode, reviewedAt, message: "Review tag recorded. Exception remains open until new evidence supports a match." };
  },
});
