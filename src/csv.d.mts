export class CsvInputError extends Error {}
export type BankRow = { sourceRow: number; postedOn: string; amountMinor: number; currency: string; reference: string };
export type PaystackCsvRow = { sourceId: string; amountMinor: number; currency: string; settlementDate: string; status: string };
export function parseCsv(text: string, options?: { maxBytes?: number; maxRows?: number }): { headers: string[]; records: Array<Record<string, string>> };
export function parseMajorToMinor(value: unknown, currency: string): number;
export function parseIsoDate(value: unknown): string;
export function makeBankRows(text: string, mapping: { date: string; amount: string; currency: string; reference?: string }): BankRow[];
export function makePaystackSettlementRows(text: string, mapping: { id: string; date: string; amount: string; currency: string; status: string }, amountUnit: "minor" | "major"): PaystackCsvRow[];
