const API_BASE = "https://api.paystack.co";
const PAGE_SIZE = 100;
const MAX_PAGES = 100;

export class PaystackError extends Error {
  constructor(code, message, status = undefined) {
    super(message);
    this.name = "PaystackError";
    this.code = code;
    this.status = status;
  }
}

export function readPaystackConfig(env = process.env) {
  const secretKey = env.PAYSTACK_SECRET_KEY?.trim() || "";
  const environment = env.PAYSTACK_ENVIRONMENT?.trim() || "";
  if (!secretKey && !environment) return { configured: false, environment: null };
  if (!secretKey || !["test", "live"].includes(environment)) {
    throw new PaystackError("config_invalid", "Set both PAYSTACK_SECRET_KEY and PAYSTACK_ENVIRONMENT=test|live.");
  }
  const expected = environment === "test" ? "sk_test_" : "sk_live_";
  if (!secretKey.startsWith(expected)) {
    throw new PaystackError("config_environment_mismatch", `PAYSTACK_SECRET_KEY prefix does not match PAYSTACK_ENVIRONMENT=${environment}.`);
  }
  return { configured: true, environment, secretKey };
}

async function getJson(path, searchParams, secretKey, fetchImpl, timeoutMs) {
  const url = new URL(path, API_BASE);
  for (const [key, value] of Object.entries(searchParams)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${secretKey}`, Accept: "application/json" },
      redirect: "error",
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw new PaystackError("timeout", "Paystack request timed out.");
    throw new PaystackError("network_error", "Paystack could not be reached.");
  } finally {
    clearTimeout(timer);
  }
  if (response.status === 401 || response.status === 403) throw new PaystackError("auth_error", "Paystack rejected the key or its permissions.", response.status);
  if (response.status === 429) throw new PaystackError("rate_limited", "Paystack rate-limited this read; retry later.", response.status);
  if (!response.ok) throw new PaystackError("provider_error", `Paystack returned HTTP ${response.status}.`, response.status);
  let payload;
  try { payload = await response.json(); }
  catch { throw new PaystackError("invalid_response", "Paystack returned invalid JSON.", response.status); }
  if (payload?.status !== true || !Array.isArray(payload?.data) || !payload?.meta) {
    throw new PaystackError("invalid_response", "Paystack response did not match the documented paginated list shape.", response.status);
  }
  return payload;
}

export async function listSettlements({ from, to, env = process.env, fetchImpl = fetch, timeoutMs = 15_000 } = {}) {
  const config = readPaystackConfig(env);
  if (!config.configured) throw new PaystackError("not_configured", "Connect a merchant-owned Paystack read key or import a Paystack settlement export.");
  if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new PaystackError("input_invalid", "from must be YYYY-MM-DD.");
  if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new PaystackError("input_invalid", "to must be YYYY-MM-DD.");
  if (from && to && from > to) throw new PaystackError("input_invalid", "from must not be after to.");
  const first = await getJson("/settlement", { perPage: PAGE_SIZE, page: 1, from, to }, config.secretKey, fetchImpl, timeoutMs);
  const pageCount = Number(first.meta.pageCount ?? 1);
  if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > MAX_PAGES) {
    throw new PaystackError("too_many_pages", `Paystack reports ${pageCount} pages; reduce the date range (maximum ${MAX_PAGES}).`);
  }
  const data = [...first.data];
  for (let page = 2; page <= pageCount; page += 1) {
    const next = await getJson("/settlement", { perPage: PAGE_SIZE, page, from, to }, config.secretKey, fetchImpl, timeoutMs);
    if (Number(next.meta.page) !== page) throw new PaystackError("pagination_inconsistent", "Paystack page number did not match the requested page.");
    data.push(...next.data);
  }
  const settlements = data.map((row) => {
    const id = String(row.id ?? "");
    const currency = String(row.currency ?? "").toUpperCase();
    const amountMinor = Number(row.total_amount);
    const settlementDate = String(row.settlement_date ?? "").slice(0, 10);
    if (!/^\d+$/.test(id) || !Number.isSafeInteger(amountMinor) || amountMinor < 0 || !/^[A-Z]{3}$/.test(currency) || !/^\d{4}-\d{2}-\d{2}$/.test(settlementDate)) {
      throw new PaystackError("invalid_response", "Paystack settlement row is missing a valid id, total_amount, currency, or settlement_date.");
    }
    return { id, currency, amountMinor, settlementDate, status: String(row.status ?? "unknown"), source: "paystack_api", environment: config.environment };
  });
  return { settlements, environment: config.environment, retrievedAt: new Date().toISOString(), pages: pageCount, source: `${API_BASE}/settlement` };
}
