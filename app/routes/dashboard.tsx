import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { useMemo, useState } from "react";
import "./closeout.css";

type CsvPreview = { headers: string[]; rowCount: number };
type Upload = { csvText: string; preview: CsvPreview; mapping: Record<string, string> };
type PaystackMapping = { id: string; date: string; amount: string; currency: string; status: string };
type BankMapping = { date: string; amount: string; currency: string };
type ReviewCode = "waiting_for_bank_post" | "partial_or_batched" | "provider_record_check" | "needs_bookkeeper_followup";
type BankCredit = { id: string; importId: string; sourceRow: number; postedOn: string; amountMinor: number; currency: string; sourceHash: string | null };
type MatchRow = {
  id: string; status: string; reason: string; reviewCode?: string | null; reviewedAt?: string | null;
  settlement: null | { id: string; sourceId: string; source: string; sourceHash?: string | null; sourceRow?: number | null; settlementDate: string; amountMinor: number; currency: string; providerStatus: string };
  bankCredit: BankCredit | null;
  candidateBankCredits: BankCredit[];
};
type Closeout = {
  state: "empty" | "available";
  run?: { id: string; environment: "test" | "live"; createdAt: string; windowDays: number; settlementsCount: number; bankCreditsCount: number; candidateCount: number; exceptionCount: number };
  results?: MatchRow[];
  unmatchedBankCredits?: BankCredit[];
  message: string;
};

const settlementFields = [["id", "Settlement ID"], ["date", "Settlement date"], ["amount", "Net payout amount"], ["currency", "Currency"], ["status", "Payout status"]] as const;
const bankFields = [["date", "Credit date"], ["amount", "Credit amount"], ["currency", "Currency"]] as const;
const reviewTags = [["waiting_for_bank_post", "Wait for bank posting"], ["partial_or_batched", "Check partial or batched deposit"], ["provider_record_check", "Check provider record"], ["needs_bookkeeper_followup", "Follow up with bookkeeper"]] as const;

function money(minor: number, currency: string) {
  const places = currency === "XOF" ? 0 : 2;
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency, minimumFractionDigits: places, maximumFractionDigits: places }).format(minor / (10 ** places)); }
  catch { return `${currency} ${(minor / (10 ** places)).toFixed(places)}`; }
}
function cell(value: unknown) { return `"${String(value ?? "").replace(/"/g, '""')}"`; }
function sourceLabel(hash?: string | null) { return hash ? `SHA-256 ${hash.slice(0, 12)}...` : "Paystack API"; }
function errorText(error: unknown) { return error instanceof Error ? error.message : "The action failed. No success was recorded."; }

export function meta() { return [{ title: "Tillmatch dashboard - Payout closeout" }, { name: "description", content: "Compare Paystack settlements with bank statement credits and review source-linked exceptions." }]; }

export default function DashboardRoute() {
  const [environment, setEnvironment] = useState<"" | "test" | "live">("");
  const [paystackFile, setPaystackFile] = useState<Upload | null>(null);
  const [bankFile, setBankFile] = useState<Upload | null>(null);
  const [amountUnit, setAmountUnit] = useState<"" | "major" | "minor">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [notice, setNotice] = useState("");
  const query = useActionQuery<Closeout>("get-closeout", environment ? { environment } : {});
  const preview = useActionMutation("preview-csv");
  const sync = useActionMutation("sync-paystack-settlements");
  const importPaystack = useActionMutation("import-paystack-csv");
  const importBank = useActionMutation("import-bank-statement");
  const reconcile = useActionMutation("run-closeout");
  const confirmMatch = useActionMutation("confirm-match");
  const reviewException = useActionMutation("mark-exception-reviewed");
  const report = environment ? query.data : undefined;
  const rows = report?.results ?? [];
  const candidates = useMemo(() => rows.filter((row) => row.status === "candidate_match"), [rows]);
  const openRows = useMemo(() => rows.filter((row) => row.status !== "candidate_match" && row.status !== "confirmed"), [rows]);
  const pending = [sync, importPaystack, importBank, reconcile, confirmMatch, reviewException].some((action) => action.isPending);

  async function chooseFile(file: File | undefined, source: "paystack" | "bank") {
    setNotice("");
    if (!file) return;
    if (file.size > 2_000_000) { setNotice("CSV is larger than 2 MB. Export a smaller date range and try again."); return; }
    if (!file.name.toLowerCase().endsWith(".csv") && file.type !== "text/csv") { setNotice("Choose a CSV export."); return; }
    try {
      const csvText = await file.text();
      const result = await preview.mutateAsync({ csvText }) as CsvPreview;
      const mapping: Record<string, string> = {};
      if (source === "paystack") setPaystackFile({ csvText, preview: result, mapping });
      else setBankFile({ csvText, preview: result, mapping });
      setNotice(`Read ${result.rowCount} rows. Map each required source column before import.`);
    } catch (error) { setNotice(errorText(error)); }
  }

  function setColumn(source: "paystack" | "bank", key: string, value: string) {
    const setter = source === "paystack" ? setPaystackFile : setBankFile;
    setter((current) => current ? { ...current, mapping: { ...current.mapping, [key]: value } } : current);
  }

  async function readPaystack() {
    if (!environment) { setNotice("Select test or live before reading Paystack."); return; }
    setNotice("");
    try {
      const result = await sync.mutateAsync({ expectedEnvironment: environment, from: from || undefined, to: to || undefined }) as { storedCount: number; environment: string; retrievedAt: string };
      setNotice(`Read and stored ${result.storedCount} Paystack settlement rows from ${result.environment} at ${new Date(result.retrievedAt).toLocaleString()}.`);
      await query.refetch();
    } catch (error) { setNotice(errorText(error)); }
  }

  async function savePaystack() {
    if (!paystackFile || !environment || !amountUnit) { setNotice("Select a Paystack CSV, test/live environment, and amount unit."); return; }
    try {
      const result = await importPaystack.mutateAsync({ csvText: paystackFile.csvText, environment, mapping: paystackFile.mapping as PaystackMapping, amountUnit }) as { importedCount: number; fileHash: string };
      setNotice(`Imported ${result.importedCount} settlement rows. Source SHA-256 ${result.fileHash.slice(0, 12)}...`);
      setPaystackFile(null); setAmountUnit(""); await query.refetch();
    } catch (error) { setNotice(errorText(error)); }
  }

  async function saveBank() {
    if (!bankFile) { setNotice("Select a bank statement CSV first."); return; }
    try {
      const result = await importBank.mutateAsync({ csvText: bankFile.csvText, mapping: bankFile.mapping as BankMapping }) as { importedCount: number; duplicate: boolean; fileHash: string };
      setNotice(`${result.duplicate ? "Reused" : "Imported"} ${result.importedCount} positive bank credits. Source SHA-256 ${result.fileHash.slice(0, 12)}...`);
      setBankFile(null); await query.refetch();
    } catch (error) { setNotice(errorText(error)); }
  }

  async function runCloseout() {
    if (!environment) { setNotice("Select test or live before running a closeout."); return; }
    try {
      const result = await reconcile.mutateAsync({ environment, windowDays: 3 }) as { runId: string; candidateCount: number; exceptionCount: number };
      setNotice(`Saved closeout ${result.runId}: ${result.candidateCount} exact candidates; ${result.exceptionCount} source rows remain open.`);
      await query.refetch();
    } catch (error) { setNotice(errorText(error)); }
  }

  async function confirm(row: MatchRow) {
    if (!row.settlement || !row.bankCredit) return;
    const approved = window.confirm(`Confirm this exact source match?\n\nPaystack settlement ${row.settlement.sourceId}: ${money(row.settlement.amountMinor, row.settlement.currency)} on ${row.settlement.settlementDate}\nBank statement row ${row.bankCredit.sourceRow}: ${money(row.bankCredit.amountMinor, row.bankCredit.currency)} on ${row.bankCredit.postedOn}\n\nThis records a person-confirmed match.`);
    if (!approved) return;
    try { await confirmMatch.mutateAsync({ matchResultId: row.id }); setNotice("Person-confirmed match was persisted and read back."); await query.refetch(); }
    catch (error) { setNotice(errorText(error)); }
  }

  async function tagException(row: MatchRow, reviewCode: ReviewCode) {
    try { await reviewException.mutateAsync({ matchResultId: row.id, reviewCode }); setNotice("Follow-up tag saved. The exception remains open."); await query.refetch(); }
    catch (error) { setNotice(errorText(error)); }
  }

  function download() {
    if (!report?.run) return;
    const header = ["result_status", "settlement_id", "settlement_date", "settlement_minor", "settlement_currency", "settlement_source", "settlement_hash", "settlement_row", "bank_row", "bank_date", "bank_minor", "bank_currency", "bank_hash", "reason", "review_code"];
    const lines = rows.map((row) => [row.status, row.settlement?.sourceId, row.settlement?.settlementDate, row.settlement?.amountMinor, row.settlement?.currency, row.settlement?.source, row.settlement?.sourceHash, row.settlement?.sourceRow, row.bankCredit?.sourceRow, row.bankCredit?.postedOn, row.bankCredit?.amountMinor, row.bankCredit?.currency, row.bankCredit?.sourceHash, row.reason, row.reviewCode].map(cell).join(","));
    for (const bank of report.unmatchedBankCredits ?? []) lines.push(["unmatched_bank_credit", "", "", "", "", "", "", "", bank.sourceRow, bank.postedOn, bank.amountMinor, bank.currency, bank.sourceHash, "No unique Paystack settlement linked to this credit.", ""].map(cell).join(","));
    const blob = new Blob([[header.map(cell).join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `tillmatch-${report.run.environment}-${report.run.id}.csv`; anchor.click(); URL.revokeObjectURL(url);
  }

  function mappings(source: "paystack" | "bank", upload: Upload, fields: ReadonlyArray<readonly [string, string]>) {
    return <div className="tm-mapping"><p>{upload.preview.rowCount} rows / choose the source column for every field</p><div className="tm-map-grid">{fields.map(([key, label]) => <label key={key}>{label}<select value={upload.mapping[key] ?? ""} onChange={(event) => setColumn(source, key, event.target.value)}><option value="">Choose column</option>{upload.preview.headers.map((header) => <option key={header} value={header}>{header}</option>)}</select></label>)}</div></div>;
  }

  return (
    <main className="tillmatch">
      <header className="tm-header">
        <a className="tm-brand" href="/" aria-label="Tillmatch home"><span className="tm-brand-mark">T</span><span>tillmatch</span></a>
        <nav aria-label="Primary"><a className="active" href="/dashboard">Dashboard</a><a href="#sources">Sources</a><a href="#exceptions">Exceptions</a></nav>
        <a className="tm-agent-link" href="/chat">Ask the agent <span aria-hidden="true">-&gt;</span></a>
      </header>

      <section className="tm-hero">
        <div><p className="tm-eyebrow">SETTLEMENT DESK / PAYSTACK + BANK</p><h1>Close the loop<br />on every payout.</h1><p className="tm-lede">Compare the Paystack payout record with the credit that reached your bank. Exact matches are suggestions; uncertain rows stay open for a person.</p></div>
        <div className="tm-run-card"><label htmlFor="environment">Paystack environment</label><select id="environment" value={environment} onChange={(event) => setEnvironment(event.target.value as "" | "test" | "live")}><option value="">Choose test or live</option><option value="test">Test account</option><option value="live">Live account</option></select><p>{environment ? `Showing only ${environment} settlement closeouts.` : "Select an environment to view its saved closeout."}</p><button className="tm-primary" type="button" onClick={() => void runCloseout()} disabled={pending || !environment}>{reconcile.isPending ? "Checking source rows..." : "Run closeout"}<span aria-hidden="true">-&gt;</span></button></div>
      </section>

      <section className="tm-source-strip" aria-label="Closeout state"><div><span className="tm-dot" data-state={report?.state === "available" ? "ready" : "empty"} aria-hidden="true" /><span>{query.isLoading ? "Reading saved closeout..." : report?.state === "available" ? "Persisted closeout loaded" : environment ? "Waiting for source data" : "Choose an environment"}</span></div>{report?.run && <div className="tm-source-meta"><span>{report.run.environment.toUpperCase()}</span><time dateTime={report.run.createdAt}>{new Date(report.run.createdAt).toLocaleString()}</time></div>}</section>
      {notice && <p className="tm-feedback" role="status" aria-live="polite">{notice}</p>}
      {query.error && <p className="tm-error" role="alert">Saved closeout could not be read: {query.error.message}</p>}

      {report?.run ? <section className="tm-summary" aria-label="Closeout summary"><article><span>Settlements</span><strong>{report.run.settlementsCount}</strong><small>source records</small></article><article className="candidate-summary"><span>Exact candidates</span><strong>{candidates.length + rows.filter((row) => row.status === "confirmed").length}</strong><small>human confirmation required</small></article><article className="exception-summary"><span>Open exceptions</span><strong>{openRows.length + (report.unmatchedBankCredits?.length ?? 0)}</strong><small>unmatched or ambiguous</small></article><button className="tm-secondary" type="button" onClick={download}>Download source-linked CSV</button></section> : <section className="tm-empty"><span className="tm-empty-index">01 / START HERE</span><div><h2>{environment ? "No closeout saved yet." : "Choose a source environment."}</h2><p>{environment ? "Import actual Paystack and bank records below, then run a closeout. No sample transactions are loaded." : "Select test or live above. Tillmatch keeps those Paystack environments separate."}</p></div><a href="#sources">Connect sources -&gt;</a></section>}

      <section className="tm-section-heading" id="sources"><div><p className="tm-eyebrow">01 / SOURCE RECORDS</p><h2>Bring both sides of the deposit.</h2></div><p>The raw CSV is read for import and then discarded. Stored rows contain only needed financial fields, source row numbers and file hashes.</p></section>
      <section className="tm-source-grid">
        <article className="tm-source-card"><div className="tm-card-heading"><span className="tm-source-num">A</span><div><h3>Paystack settlements</h3><p>Read-only API or your Dashboard payout export</p></div></div><div className="tm-date-range"><label>From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>To<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label></div><button className="tm-secondary tm-wide" type="button" onClick={() => void readPaystack()} disabled={pending || !environment}>{sync.isPending ? "Reading Paystack..." : "Read Paystack API"}</button><div className="tm-divider"><span>OR IMPORT A REAL EXPORT</span></div><label className="tm-file-button">Choose Paystack CSV<input type="file" accept=".csv,text/csv" onChange={(event) => void chooseFile(event.currentTarget.files?.[0], "paystack")} /></label>{paystackFile && <>{mappings("paystack", paystackFile, settlementFields)}<label className="tm-map-unit">Amount unit<select value={amountUnit} onChange={(event) => setAmountUnit(event.target.value as "" | "major" | "minor")}><option value="">Choose units</option><option value="major">Major units (e.g. 12.50)</option><option value="minor">Minor units (e.g. 1250)</option></select></label><button className="tm-primary tm-wide" type="button" onClick={() => void savePaystack()} disabled={pending || !environment || !amountUnit || settlementFields.some(([key]) => !paystackFile.mapping[key])}>{importPaystack.isPending ? "Importing..." : "Import settlement rows"}</button></>}</article>
        <article className="tm-source-card"><div className="tm-card-heading"><span className="tm-source-num">B</span><div><h3>Bank statement credits</h3><p>CSV from the account that receives your payouts</p></div></div><label className="tm-file-button tm-bank-file">Choose bank statement CSV<input type="file" accept=".csv,text/csv" onChange={(event) => void chooseFile(event.currentTarget.files?.[0], "bank")} /></label>{bankFile && <>{mappings("bank", bankFile, bankFields)}<button className="tm-primary tm-wide" type="button" onClick={() => void saveBank()} disabled={pending || bankFields.some(([key]) => !bankFile.mapping[key])}>{importBank.isPending ? "Importing..." : "Import positive credits"}</button></>}</article>
      </section>

      <section className="tm-section-heading" id="exceptions"><div><p className="tm-eyebrow">02 / REVIEW</p><h2>What landed, and what needs a person?</h2></div><p>Only one-to-one exact amount and currency matches inside three days are suggested. No partial or batched payout is inferred.</p></section>
      <section className="tm-results" aria-label="Settlement match results"><div className="tm-results-head"><span>PAYSTACK SOURCE</span><span>BANK SOURCE</span><span>REVIEW STATUS</span></div>{rows.map((row) => <article className="tm-result-row" key={row.id}>
        <div className="tm-settlement-cell"><strong>{row.settlement ? money(row.settlement.amountMinor, row.settlement.currency) : "Settlement unavailable"}</strong><span>{row.settlement?.sourceId ?? "Source row unavailable"} / {row.settlement?.settlementDate ?? "-"}</span><small>{row.settlement?.source === "paystack_api" ? "Paystack API" : `Paystack CSV row ${row.settlement?.sourceRow ?? "-"}`} / {sourceLabel(row.settlement?.sourceHash)}</small></div>
        <div className="tm-bank-cell">{row.bankCredit ? <><strong>{money(row.bankCredit.amountMinor, row.bankCredit.currency)}</strong><span>Statement row {row.bankCredit.sourceRow} / {row.bankCredit.postedOn}</span><small>{sourceLabel(row.bankCredit.sourceHash)}</small></> : row.candidateBankCredits.length ? row.candidateBankCredits.map((bank) => <span key={bank.id}><strong>{money(bank.amountMinor, bank.currency)}</strong> / row {bank.sourceRow} / {bank.postedOn}</span>) : <span className="tm-muted">No unique bank row linked</span>}</div>
        <div className="tm-review-cell"><span className={`tm-pill tm-pill-${row.status}`}>{row.status.replace(/_/g, " ")}</span><p>{row.reason}</p>{row.status === "candidate_match" && row.bankCredit && <button className="tm-confirm" type="button" onClick={() => void confirm(row)} disabled={pending}>Confirm exact source match</button>}{row.status === "confirmed" && <small>Confirmed by a signed-in reviewer / {row.reviewedAt ? new Date(row.reviewedAt).toLocaleString() : "time unavailable"}</small>}{row.status !== "candidate_match" && row.status !== "confirmed" && <label className="tm-review-select">Add follow-up tag<select aria-label={`Follow-up tag for settlement ${row.settlement?.sourceId ?? "unknown"}`} value={row.reviewCode ?? ""} onChange={(event) => event.target.value && void tagException(row, event.target.value as ReviewCode)}><option value="">Choose a tag</option>{reviewTags.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}</div>
      </article>)}{(report?.unmatchedBankCredits ?? []).map((bank) => <article className="tm-result-row tm-orphan-row" key={`bank-${bank.id}`}><div className="tm-muted">No unique Paystack settlement links to this credit.</div><div className="tm-bank-cell"><strong>{money(bank.amountMinor, bank.currency)}</strong><span>Statement row {bank.sourceRow} / {bank.postedOn}</span><small>{sourceLabel(bank.sourceHash)}</small></div><div className="tm-review-cell"><span className="tm-pill tm-pill-unmatched">unmatched bank credit</span><p>Keep open. Do not infer a fee, duplicate or missing payout from amount alone.</p></div></article>)}{report?.state === "available" && !rows.length && <p className="tm-empty-results">This closeout has no settlement results.</p>}{!environment && <p className="tm-empty-results">Choose a Paystack environment to see saved closeout evidence.</p>}</section>
      {report?.run && <p className="tm-agent-hint">Ask the agent to inspect closeout <code>{report.run.id}</code>. It can explain stored source facts; a person confirms any match.</p>}
      <footer className="tm-footer"><a href="/">Tillmatch home</a><span>Read-only Paystack / no money movement / unresolved stays unresolved</span><a href="/chat">Agent workspace -&gt;</a></footer>
    </main>
  );
}
