import test from "node:test";
import assert from "node:assert/strict";
import { matchSettlements } from "../src/matcher.mjs";

const payout = (id, date = "2026-10-28", amount = 12890, status = "success", currency = "NGN") => ({ id, settlementDate: date, amountMinor: amount, status, currency });
const credit = (id, date = "2026-10-29", amount = 12890, currency = "NGN") => ({ id, postedOn: date, amountMinor: amount, currency });

test("exact unique amount/currency within date window matches", () => {
  const result = matchSettlements([payout("p1")], [credit("b1")]);
  assert.deepEqual(result.results[0], { settlementId: "p1", bankCreditId: "b1", status: "matched", reason: "Exact NGN amount; posted 1 day(s) from settlement date (window 3)." });
  assert.deepEqual(result.unmatchedBankCreditIds, []);
});

test("same payout with multiple bank candidates stays ambiguous", () => {
  const result = matchSettlements([payout("p1")], [credit("b1"), credit("b2", "2026-10-28")]);
  assert.equal(result.results[0].status, "ambiguous");
  assert.deepEqual(result.results[0].candidateBankIds, ["b1", "b2"]);
  assert.deepEqual(result.unmatchedBankCreditIds, ["b1", "b2"]);
});

test("one bank credit competing for two settlements marks both ambiguous, independent of order", () => {
  for (const rows of [[payout("p1"), payout("p2")], [payout("p2"), payout("p1")]]) {
    const result = matchSettlements(rows, [credit("b1")]);
    assert.deepEqual(result.results.map((row) => row.status), ["ambiguous", "ambiguous"]);
    assert.deepEqual(result.unmatchedBankCreditIds, ["b1"]);
  }
});

test("does not match cross-currency, partial, outside-window or unsettled items", () => {
  const result = matchSettlements(
    [payout("p1"), payout("p2", "2026-10-28", 12889), payout("p3", "2026-10-28", 12890, "pending"), payout("p4", "2026-10-28", 500)],
    [credit("b1", "2026-10-29", 12890, "GHS"), credit("b2", "2026-11-03", 12890)],
  );
  assert.deepEqual(result.results.map((row) => row.status), ["unmatched", "unmatched", "not_settled", "unmatched"]);
  assert.ok(result.results[0].reason.includes("outside the date window"));
  assert.ok(result.results[3].reason.includes("partial or batched"));
});

test("invalid date and amount fail closed; date window is bounded", () => {
  assert.equal(matchSettlements([payout("p1", "2026-02-30")], []).results[0].status, "invalid_source");
  assert.equal(matchSettlements([payout("p1", "2026-10-28", 1.5)], []).results[0].status, "invalid_source");
  assert.throws(() => matchSettlements([], [], { windowDays: 8 }), /0 to 7/);
});
