import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { useMemo, useState } from "react";
import { matchSettlements } from "../../src/matcher.mjs";
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
  const [simulationMode, setSimulationMode] = useState(false);
  if (simulationMode) return <SimulationWorkflow onBack={() => setSimulationMode(false)} />;
  return <RealDashboard onOpenSimulation={() => setSimulationMode(true)} />;
}

function RealDashboard({ onOpenSimulation }: { onOpenSimulation: () => void }) {
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
        <button className="tm-demo-link" type="button" onClick={onOpenSimulation}>Try simulation <span aria-hidden="true">(fictional)</span></button>
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

const simulatedSettlements = [
  { id: "SIM-PS-001", settlementDate: "2026-10-26", amountMinor: 3_425_000, currency: "NGN", status: "success" },
  { id: "SIM-PS-002", settlementDate: "2026-10-27", amountMinor: 1_890_050, currency: "NGN", status: "success" },
  { id: "SIM-PS-003", settlementDate: "2026-10-26", amountMinor: 960_000, currency: "NGN", status: "success" },
];
const simulatedBankCredits = [
  { id: "SIM-BANK-001", postedOn: "2026-10-27", amountMinor: 3_425_000, currency: "NGN" },
  { id: "SIM-BANK-002", postedOn: "2026-10-29", amountMinor: 1_890_050, currency: "NGN" },
  { id: "SIM-BANK-003", postedOn: "2026-10-26", amountMinor: 480_000, currency: "NGN" },
  { id: "SIM-BANK-004", postedOn: "2026-11-01", amountMinor: 5_500_000, currency: "NGN" },
];

function SimulationWorkflow({ onBack }: { onBack: () => void }) {
  const [showPreview, setShowPreview] = useState(false);
  const preview = useMemo(() => matchSettlements(simulatedSettlements, simulatedBankCredits, { windowDays: 3 }), []);
  const candidateCount = preview.results.filter((row) => row.status === "matched").length;
  const openSettlementCount = preview.results.filter((row) => row.status !== "matched").length;
  const bankById = new Map(simulatedBankCredits.map((bank) => [bank.id, bank]));
  const settlementById = new Map(simulatedSettlements.map((settlement) => [settlement.id, settlement]));

  return <main className="tillmatch tm-simulation">
    <header className="tm-header">
      <a className="tm-brand" href="/" aria-label="Tillmatch home"><span className="tm-brand-mark">T</span><span>tillmatch</span></a>
      <nav aria-label="Primary"><span>Dashboard</span><span className="tm-sim-nav-active">Simulation preview</span></nav>
      <button className="tm-agent-link tm-back-link" type="button" onClick={onBack}>Back to real closeout</button>
    </header>

    <section className="tm-sim-banner" role="note" aria-label="Simulation only notice">
      <strong>SIMULATION ONLY</strong>
      <p>Fictional example records for explaining the matching rule. Not Paystack data, not a bank statement, and not part of your real closeout.</p>
    </section>

    <section className="tm-hero tm-sim-hero">
      <div><p className="tm-eyebrow">ILLUSTRATIVE WORKFLOW / NO FINANCIAL DATA</p><h1>See how a careful closeout works.</h1><p className="tm-lede">This preview runs Tillmatch's deterministic matcher in your browser using a tiny, fictional set. It cannot read credentials, call a server action, save records, or confirm a match.</p></div>
      <div className="tm-run-card tm-sim-run-card"><span className="tm-sim-number">3</span><span>simulated settlements</span><span className="tm-sim-number">4</span><span>simulated bank credits</span></div>
    </section>

    <section className="tm-sim-data-grid" aria-label="Fictional source records">
      <article className="tm-source-card"><div className="tm-card-heading"><span className="tm-source-num">A</span><div><h2>Simulated settlements</h2><p>Not fetched from Paystack</p></div></div><div className="tm-sim-records">{simulatedSettlements.map((row) => <div className="tm-sim-record" key={row.id}><code>{row.id}</code><span>{row.settlementDate}</span><strong>{money(row.amountMinor, row.currency)}</strong><small>fictional / {row.status}</small></div>)}</div></article>
      <article className="tm-source-card"><div className="tm-card-heading"><span className="tm-source-num">B</span><div><h2>Simulated bank credits</h2><p>Not from a financial institution</p></div></div><div className="tm-sim-records">{simulatedBankCredits.map((row) => <div className="tm-sim-record" key={row.id}><code>{row.id}</code><span>{row.postedOn}</span><strong>{money(row.amountMinor, row.currency)}</strong><small>fictional / credit</small></div>)}</div></article>
    </section>

    <section className="tm-sim-rule"><span className="tm-eyebrow">THE PREVIEW RULE</span><p>Exact amount + exact currency + one unique bank credit inside three calendar days. A suggested candidate is not a confirmed match.</p><button className="tm-primary" type="button" onClick={() => setShowPreview(true)}>{showPreview ? "Preview calculated locally" : "Preview simulated closeout"}<span aria-hidden="true">-&gt;</span></button></section>

    {showPreview && <section className="tm-sim-result-section" aria-live="polite">
      <div className="tm-section-heading"><div><p className="tm-eyebrow">SIMULATED RESULT / NOT SAVED</p><h2>Suggestions and open rows</h2></div><p>{candidateCount} candidate suggestions / {openSettlementCount} settlement left open / no confirmation is available here.</p></div>
      <div className="tm-sim-results">{preview.results.map((row) => {
        const settlement = settlementById.get(row.settlementId);
        const bank = row.bankCreditId ? bankById.get(row.bankCreditId) : undefined;
        return <article className="tm-sim-result" key={row.settlementId}>
          <div><span className="tm-sim-label">SIMULATED PAYSTACK ROW</span><strong>{settlement ? money(settlement.amountMinor, settlement.currency) : "Settlement"}</strong><code>{row.settlementId} / {settlement?.settlementDate}</code></div>
          <div><span className="tm-sim-label">SIMULATED BANK ROW</span>{bank ? <><strong>{money(bank.amountMinor, bank.currency)}</strong><code>{bank.id} / {bank.postedOn}</code></> : <span className="tm-muted">No unique exact credit linked</span>}</div>
          <div><span className={`tm-pill ${row.status === "matched" ? "tm-pill-simulated" : "tm-pill-unmatched"}`}>{row.status === "matched" ? "candidate / simulated" : `${row.status} / simulated`}</span><p>{row.reason}</p></div>
        </article>;
      })}{preview.unmatchedBankCreditIds.map((id) => {
        const bank = bankById.get(id);
        return <article className="tm-sim-result" key={id}><div><span className="tm-sim-label">NO UNIQUE SETTLEMENT LINK</span></div><div><strong>{bank ? money(bank.amountMinor, bank.currency) : "Bank credit"}</strong><code>{id} / {bank?.postedOn}</code></div><div><span className="tm-pill tm-pill-unmatched">unmatched bank credit / simulated</span><p>It stays open. No partial, fee, or batch explanation is guessed.</p></div></article>;
      })}</div>
      <p className="tm-sim-no-write"><strong>Nothing was imported, written, or confirmed.</strong> In the real closeout, an authenticated reviewer checks actual source evidence and confirms an eligible candidate.</p>
    </section>}

    <section className="tm-sim-downloads"><div><p className="tm-eyebrow">OPTIONAL EXAMPLE FILES</p><h2>Clearly marked simulation CSVs</h2><p>These carry a <code>SIMULATION_ONLY</code> marker and the real import parsers reject them. They are for inspecting the example format only.</p></div><div><a className="tm-secondary" href="/demo/SIMULATION-ONLY-paystack-settlements.csv" download>Paystack example CSV</a><a className="tm-secondary" href="/demo/SIMULATION-ONLY-bank-credits.csv" download>Bank example CSV</a></div></section>

    <footer className="tm-footer"><a href="/">Tillmatch home</a><span>Fictional values / local-only computation / real data stays separate</span><button type="button" onClick={onBack}>Return to real closeout</button></footer>
  </main>;
}
