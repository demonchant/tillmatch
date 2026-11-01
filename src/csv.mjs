export class CsvInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "CsvInputError";
  }
}

// Strict RFC-4180-style parser for user-owned CSV text; does not infer success.
export function parseCsv(text, { maxBytes = 2_000_000, maxRows = 20_000 } = {}) {
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new CsvInputError(`CSV must be text smaller than ${maxBytes} bytes.`);
  }
  const rows = [];
  let row = [], field = "", quoted = false, afterQuote = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') { quoted = false; afterQuote = true; }
      else field += ch;
      continue;
    }
    if (afterQuote && ch !== "," && ch !== "\r" && ch !== "\n" && ch !== " " && ch !== "\t") {
      throw new CsvInputError("Unexpected character after a quoted CSV field.");
    }
    if (ch === '"') {
      if (field.length !== 0 || afterQuote) throw new CsvInputError("Quote inside an unquoted CSV field.");
      quoted = true;
    } else if (ch === ",") {
      row.push(field); field = ""; afterQuote = false;
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field); field = ""; afterQuote = false;
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
      if (rows.length > maxRows + 1) throw new CsvInputError(`CSV exceeds ${maxRows} data rows.`);
    } else {
      field += ch;
    }
  }
  if (quoted) throw new CsvInputError("CSV ends inside a quoted field.");
  row.push(field);
  if (row.some((cell) => cell !== "")) rows.push(row);
  if (rows.length < 2) throw new CsvInputError("CSV needs a header and at least one data row.");
  if (rows.length - 1 > maxRows) throw new CsvInputError(`CSV exceeds ${maxRows} data rows.`);
  const headers = rows[0].map((value) => value.trim().replace(/^\uFEFF/, ""));
  if (headers.some((header) => !header)) throw new CsvInputError("CSV contains a blank column name.");
  if (new Set(headers.map((h) => h.toLowerCase())).size !== headers.length) {
    throw new CsvInputError("CSV contains duplicate column names.");
  }
  const records = rows.slice(1).map((cells, index) => {
    if (cells.length !== headers.length) throw new CsvInputError(`Row ${index + 2} has ${cells.length} fields; expected ${headers.length}.`);
    return Object.fromEntries(headers.map((header, column) => [header, cells[column].trim()]));
  });
  return { headers, records };
}

const CURRENCY_DECIMALS = Object.freeze({ NGN: 2, GHS: 2, KES: 2, ZAR: 2, XOF: 0 });

export function parseMajorToMinor(value, currency) {
  const code = String(currency ?? "").trim().toUpperCase();
  const decimals = CURRENCY_DECIMALS[code];
  if (decimals === undefined) throw new CsvInputError(`Unsupported or missing currency: ${code || "(blank)"}.`);
  const raw = String(value ?? "").trim().replaceAll(",", "");
  const re = decimals === 0 ? /^-?\d+$/ : new RegExp(`^-?\\d+(?:\\.\\d{1,${decimals}})?$`);
  if (!re.test(raw)) throw new CsvInputError(`Invalid ${code} amount; use a plain decimal without a currency symbol.`);
  const negative = raw.startsWith("-");
  const unsigned = negative ? raw.slice(1) : raw;
  const [whole, fraction = ""] = unsigned.split(".");
  const scale = 10 ** decimals;
  const minor = Number(whole) * scale + Number((fraction + "0".repeat(decimals)).slice(0, decimals) || 0);
  if (!Number.isSafeInteger(minor)) throw new CsvInputError("Amount is outside the safe integer range.");
  return negative ? -minor : minor;
}

export function parseIsoDate(value) {
  const raw = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new CsvInputError(`Invalid date "${raw}"; expected YYYY-MM-DD.`);
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== raw) {
    throw new CsvInputError(`Invalid calendar date "${raw}".`);
  }
  return raw;
}

export function makeBankRows(text, mapping) {
  const { headers, records } = parseCsv(text);
  const required = ["date", "amount", "currency"];
  for (const key of required) {
    if (!mapping?.[key] || !headers.includes(mapping[key])) throw new CsvInputError(`Choose a CSV column for ${key}.`);
  }
  if (mapping.reference && !headers.includes(mapping.reference)) throw new CsvInputError("Selected reference column is not in this CSV.");
  return records.map((record, index) => {
    const currency = String(record[mapping.currency]).toUpperCase();
    const amountMinor = parseMajorToMinor(record[mapping.amount], currency);
    if (amountMinor <= 0) throw new CsvInputError(`Row ${index + 2} is not a positive credit amount.`);
    return {
      sourceRow: index + 2,
      postedOn: parseIsoDate(record[mapping.date]),
      amountMinor,
      currency,
      reference: mapping.reference ? record[mapping.reference].slice(0, 160) : "",
    };
  });
}

export function makePaystackSettlementRows(text, mapping, amountUnit) {
  if (!new Set(["minor", "major"]).has(amountUnit)) {
    throw new CsvInputError("Choose whether the amount column is in minor or major currency units.");
  }
  const { headers, records } = parseCsv(text);
  for (const key of ["id", "date", "amount", "currency", "status"]) {
    if (!mapping?.[key] || !headers.includes(mapping[key])) throw new CsvInputError(`Choose a CSV column for ${key}.`);
  }
  const ids = new Set();
  return records.map((record, index) => {
    const id = String(record[mapping.id] ?? "").trim();
    const currency = String(record[mapping.currency] ?? "").trim().toUpperCase();
    const status = String(record[mapping.status] ?? "").trim().toLowerCase();
    if (!/^\d+$/.test(id)) throw new CsvInputError(`Row ${index + 2} has an invalid settlement ID.`);
    if (ids.has(id)) throw new CsvInputError(`Duplicate settlement ID ${id}.`);
    ids.add(id);
    const amountMinor = amountUnit === "minor" ? Number(record[mapping.amount]) : parseMajorToMinor(record[mapping.amount], currency);
    if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) throw new CsvInputError(`Row ${index + 2} has an invalid settlement amount.`);
    if (!new Set(["success", "processing", "pending", "failed"]).has(status)) {
      throw new CsvInputError(`Row ${index + 2} has unsupported payout status "${status}".`);
    }
    return { sourceId: id, amountMinor, currency, settlementDate: parseIsoDate(record[mapping.date]), status };
  });
}
