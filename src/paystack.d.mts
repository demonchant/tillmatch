export class PaystackError extends Error { code: string; status?: number }
export type Settlement = { id: string; currency: string; amountMinor: number; settlementDate: string; status: string; source: "paystack_api"; environment: "test" | "live" };
export function readPaystackConfig(env?: Record<string, string | undefined>): { configured: false; environment: null } | { configured: true; environment: "test" | "live"; secretKey: string };
export function listSettlements(options?: { from?: string; to?: string; env?: Record<string, string | undefined>; fetchImpl?: typeof fetch; timeoutMs?: number }): Promise<{ settlements: Settlement[]; environment: "test" | "live"; retrievedAt: string; pages: number; source: string }>;
