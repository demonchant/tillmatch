import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { CsvInputError, makeBankRows, makePaystackSettlementRows, parseCsv, parseIsoDate, parseMajorToMinor } from "../src/csv.mjs";

test("parses quoted commas, doubled quotes, CRLF and trims header BOM", () => {
  const parsed = parseCsv('\uFEFFdate,amount,currency,memo\r\n2026-10-28,"12,890.50",NGN,"Shop, said ""paid"""\r\n');
  assert.deepEqual(parsed.headers, ["date", "amount", "currency", "memo"]);
  assert.equal(parsed.records[0].memo, 'Shop, said "paid"');
});

test("rejects malformed, duplicate, oversized and incomplete CSV", () => {
  assert.throws(() => parseCsv('a,b\n"broken,1'), CsvInputError);
  assert.throws(() => parseCsv("Date,date\n1,2"), /duplicate column/);
  assert.throws(() => parseCsv("a,b\n1,2", { maxBytes: 3 }), /smaller than/);
  assert.throws(() => parseCsv("a,b\n1,2\n3,4", { maxRows: 1 }), /exceeds/);
  assert.throws(() => parseCsv("a,b\n"), /at least one/);
});

test("converts decimal major units to integer minor units without float arithmetic", () => {
  assert.equal(parseMajorToMinor("1,234.56", "NGN"), 123456);
  assert.equal(parseMajorToMinor("1000", "XOF"), 1000);
  assert.throws(() => parseMajorToMinor("1.001", "NGN"), /Invalid NGN amount/);
  assert.throws(() => parseMajorToMinor("1.1", "XYZ"), /Unsupported/);
});

test("maps actual CSV headers only when explicitly selected and rejects debits", () => {
  const text = "Booked,Value,Ccy,Narration\n2026-10-28,128.90,NGN,SETTLEMENT";
  const rows = makeBankRows(text, { date: "Booked", amount: "Value", currency: "Ccy", reference: "Narration" });
  assert.deepEqual(rows[0], { sourceRow: 2, postedOn: "2026-10-28", amountMinor: 12890, currency: "NGN", reference: "SETTLEMENT" });
  assert.throws(() => makeBankRows(text, { date: "Booked", amount: "Value", currency: "unknown" }), /Choose a CSV column/);
  assert.throws(() => makeBankRows("date,amount,currency\n2026-10-28,-4.00,NGN", { date: "date", amount: "amount", currency: "currency" }), /positive credit/);
});

test("rejects impossible calendar dates", () => {
  assert.throws(() => parseIsoDate("2026-02-30"), /calendar date/);
});

test("maps Paystack export fields explicitly and converts selected major-unit amount", () => {
  const csv = "Settlement,Date,Net,Currency,State\n10001,2026-10-28,128.90,NGN,success";
  const rows = makePaystackSettlementRows(csv, {
    id: "Settlement", date: "Date", amount: "Net", currency: "Currency", status: "State",
  }, "major");
  assert.deepEqual(rows[0], { sourceId: "10001", amountMinor: 12890, currency: "NGN", settlementDate: "2026-10-28", status: "success" });
  assert.throws(() => makePaystackSettlementRows(csv, {
    id: "Settlement", date: "Date", amount: "Net", currency: "Currency", status: "State",
  }, "guess"), /Choose whether/);
  assert.throws(() => makePaystackSettlementRows(`${csv}\n10001,2026-10-29,5,NGN,success`, {
    id: "Settlement", date: "Date", amount: "Net", currency: "Currency", status: "State",
  }, "major"), /Duplicate settlement ID/);
});

test("refuses explicitly marked simulation CSVs at both real import boundaries", () => {
  const simulatedPaystack = "SIMULATION_ONLY,id,date,amount,currency,status\nTRUE,900000001,2026-10-26,34250.00,NGN,success";
  const simulatedBank = "SIMULATION_ONLY,date,amount,currency\nTRUE,2026-10-27,34250.00,NGN";
  assert.throws(() => makePaystackSettlementRows(simulatedPaystack, {
    id: "id", date: "date", amount: "amount", currency: "currency", status: "status",
  }, "major"), /SIMULATION_ONLY.*cannot be imported/);
  assert.throws(() => makeBankRows(simulatedBank, {
    date: "date", amount: "amount", currency: "currency",
  }), /SIMULATION_ONLY.*cannot be imported/);
});

test("unit fixture remains isolated and is not imported by product code", async () => {
  const fixture = await readFile(new URL("./fixtures/paystack-small.csv", import.meta.url), "utf8");
  assert.match(fixture, /^# UNIT TEST FIXTURE ONLY/m);
});
