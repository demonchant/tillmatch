export type MatchInputSettlement = { id: string; settlementDate: string; amountMinor: number; currency: string; status: string };
export type MatchInputBankCredit = { id: string; postedOn: string; amountMinor: number; currency: string };
export type MatchResult = { settlementId: string; bankCreditId?: string; candidateBankIds?: string[]; status: string; reason: string };
export function matchSettlements(settlements: MatchInputSettlement[], bankCredits: MatchInputBankCredit[], options?: { windowDays?: number }): { windowDays: number; results: MatchResult[]; unmatchedBankCreditIds: string[] };
