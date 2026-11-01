// These are isolated unit tests using explicit test doubles, not live integration evidence.
import test from "node:test";
import assert from "node:assert/strict";
import { listSettlements, PaystackError, readPaystackConfig } from "../src/paystack.mjs";

test("requires an explicit key and environment; never guesses live/test", () => {
  assert.deepEqual(readPaystackConfig({}), { configured: false, environment: null });
  assert.throws(() => readPaystackConfig({ PAYSTACK_SECRET_KEY: "sk_test_value" }), (error) => error.code === "config_invalid");
  assert.throws(() => readPaystackConfig({ PAYSTACK_SECRET_KEY: "sk_live_value", PAYSTACK_ENVIRONMENT: "test" }), (error) => error.code === "config_environment_mismatch");
});

test("unconfigured product path is an explicit blocker", async () => {
  await assert.rejects(listSettlements({ env: {} }), (error) => error instanceof PaystackError && error.code === "not_configured");
});

test("paginates and normalizes the documented read-only settlements contract", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    const page = new URL(url).searchParams.get("page");
    const data = page === "1"
      ? [{ id: 10001, currency: "NGN", total_amount: 12890, settlement_date: "2026-10-28T00:00:00.000Z", status: "success" }]
      : [{ id: 10002, currency: "GHS", total_amount: 9000, settlement_date: "2026-10-29T00:00:00.000Z", status: "pending" }];
    return new Response(JSON.stringify({ status: true, data, meta: { page: Number(page), pageCount: 2 } }), { status: 200 });
  };
  const result = await listSettlements({
    from: "2026-10-01", to: "2026-10-31",
    env: { PAYSTACK_SECRET_KEY: "sk_test_unit-only", PAYSTACK_ENVIRONMENT: "test" },
    fetchImpl,
  });
  assert.equal(result.settlements.length, 2);
  assert.equal(result.settlements[0].amountMinor, 12890);
  assert.equal(result.environment, "test");
  assert.equal(calls.length, 2);
  assert.equal(new URL(calls[0].url).searchParams.get("from"), "2026-10-01");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.redirect, "error");
});

test("surfaces authentication and invalid response errors without fallback", async () => {
  const env = { PAYSTACK_SECRET_KEY: "sk_test_unit-only", PAYSTACK_ENVIRONMENT: "test" };
  await assert.rejects(listSettlements({ env, fetchImpl: async () => new Response("{}", { status: 401 }) }), (error) => error.code === "auth_error");
  await assert.rejects(listSettlements({ env, fetchImpl: async () => new Response("not-json", { status: 200 }) }), (error) => error.code === "invalid_response");
});
