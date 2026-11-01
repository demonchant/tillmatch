const DAY_MS = 86_400_000;

function dayNumber(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return NaN;
  const value = Date.parse(`${day}T00:00:00.000Z`);
  return Number.isNaN(value) || new Date(value).toISOString().slice(0, 10) !== day ? NaN : value / DAY_MS;
}

/**
 * Matches source records only when exactly one unclaimed bank credit has the
 * exact currency/minor-unit amount inside the caller-visible date window.
 * Amount-only, cross-currency, partial and many-to-one matches stay unresolved.
 */
export function matchSettlements(settlements, bankCredits, { windowDays = 3 } = {}) {
  if (!Number.isInteger(windowDays) || windowDays < 0 || windowDays > 7) {
    throw new RangeError("windowDays must be an integer from 0 to 7.");
  }
  const rows = settlements.map((payout) => {
    if (payout.status !== "success") {
      return { payout, candidates: [], result: { settlementId: payout.id, status: "not_settled", reason: `Paystack status is ${payout.status}.` } };
    }
    const payoutDay = dayNumber(payout.settlementDate);
    if (!Number.isFinite(payoutDay) || !Number.isSafeInteger(payout.amountMinor) || payout.amountMinor < 0) {
      return { payout, candidates: [], result: { settlementId: payout.id, status: "invalid_source", reason: "Settlement date or amount is not valid." } };
    }
    const candidates = bankCredits.filter((credit) => {
      if (credit.currency !== payout.currency || credit.amountMinor !== payout.amountMinor) return false;
      const bankDay = dayNumber(credit.postedOn);
      return Number.isFinite(bankDay) && Math.abs(bankDay - payoutDay) <= windowDays;
    });
    return { payout, candidates, payoutDay };
  });
  const candidateDegree = new Map();
  for (const row of rows) for (const bank of row.candidates) candidateDegree.set(bank.id, (candidateDegree.get(bank.id) ?? 0) + 1);
  const results = rows.map(({ payout, candidates, payoutDay, result }) => {
    if (result) return result;
    if (candidates.length === 1 && candidateDegree.get(candidates[0].id) === 1) {
      const bank = candidates[0];
      return {
        settlementId: payout.id,
        bankCreditId: bank.id,
        status: "matched",
        reason: `Exact ${payout.currency} amount; posted ${Math.abs(dayNumber(bank.postedOn) - payoutDay)} day(s) from settlement date (window ${windowDays}).`,
      };
    }
    if (candidates.length > 0) {
      const competing = candidates.filter((bank) => candidateDegree.get(bank.id) > 1);
      const ids = candidates.map((row) => row.id);
      return { settlementId: payout.id, status: "ambiguous", candidateBankIds: ids, reason: competing.length
        ? "A bank credit could match more than one settlement; all competing rows need review."
        : "More than one bank credit has the exact amount and currency inside the date window." };
    }
    const nearSameAmount = bankCredits.filter((credit) => credit.currency === payout.currency && credit.amountMinor === payout.amountMinor);
    const reason = nearSameAmount.length
      ? "Exact amount exists outside the date window; review manually."
      : "No bank credit has this exact amount and currency; partial or batched deposits are not inferred.";
    return { settlementId: payout.id, status: "unmatched", reason };
  });
  const linked = new Set(results.filter((row) => row.status === "matched").map((row) => row.bankCreditId));
  return {
    windowDays,
    results,
    unmatchedBankCreditIds: bankCredits.filter((credit) => !linked.has(credit.id)).map((credit) => credit.id),
  };
}
