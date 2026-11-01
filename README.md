# Tillmatch

### Close the loop between a Paystack payout and the money credited to the bank.

Tillmatch is a payout closeout workspace for merchants and finance operators. It brings Paystack settlement records and bank statement credits into one review flow, shows the source evidence behind each result, and keeps a person responsible for confirming a match.

**Live app:** [tillmatch.onrender.com](https://tillmatch.onrender.com)

**Deployment status:** The last Render logs supplied for this project showed an SSR runtime error because `yjs` was missing. The current source declares `yjs` as a production dependency, but this workspace has not verified a redeployment. Treat the hosted URL as unverified until the current repository is deployed and its pages and signed-in dashboard are checked again.

**The problem:** payout reconciliation is often a manual comparison between one provider's settlement report and another institution's bank statement. The records use different references and arrive at different times. An exact match is straightforward; a delayed, ambiguous, partial, or batched deposit needs investigation. A spreadsheet can show matching amounts, but it does not by itself preserve why a match was proposed or who accepted it.

**The solution:** Tillmatch imports both sides, applies a conservative deterministic rule, records its source and outcome, and leaves uncertain rows open. It never moves money and never treats an AI response as financial approval.

## How a closeout works

```mermaid
flowchart LR
    P[Paystack settlement API or CSV] --> I[Validate and import]
    B[Receiving bank statement CSV] --> I
    I --> S[(Account-scoped source records)]
    S --> M[Deterministic closeout]
    M --> C[Exact unique candidate]
    M --> E[Open exception]
    C --> H[Person inspects both sources]
    H -->|Confirms| R[(Persisted confirmation)]
    E --> T[Person records follow-up tag]
    S --> A[Agent reads and explains evidence]
    A -. cannot confirm .-> H
    R --> X[Source-linked CSV report]
```

1. **Sign in and select an environment.** The closeout desk is private. Choose the Paystack test or live environment so settlement records remain clearly labeled.
2. **Import the provider side.** Read the merchant's Paystack settlements for a date range using a server-side read-only request, or upload an actual settlement export. CSV columns for settlement ID, date, amount, currency, and status are mapped explicitly; the amount unit is selected explicitly too.
3. **Import the bank side.** Upload the statement from the account that receives the payouts. Map the posted date, credit amount, and currency. The parser accepts positive credits and reports malformed or unsupported values instead of silently guessing.
4. **Run closeout.** Tillmatch compares exact integer minor-unit amounts and currency codes. By default, a bank credit must be within three calendar days of the settlement date. The candidate must be unique in both directions: one settlement to one bank credit.
5. **Inspect the evidence.** The result shows the settlement source ID or source row, bank statement row, dates, amount, currency, status, and the reason for the decision. Ambiguous, invalid, non-settled, unmatched, partial, and many-to-one cases stay open. Fees, splits, and batched deposits are not inferred from amount alone.
6. **Make and preserve the decision.** A signed-in person can confirm an exact candidate after reviewing both sources. Confirmation revalidates the current source rows, prevents reusing a settlement or bank credit, records who confirmed and when, then reads the persisted result back. Open exceptions can receive a follow-up tag without being marked resolved.
7. **Export the closeout.** Download a CSV with source references, source hashes where available, result status, review tag, and reason.

## What makes the workflow careful

- **Evidence before status.** A candidate links to the records that support it; the system does not manufacture a match when evidence is missing.
- **Deterministic matching.** The match rule is inspectable and repeatable: exact currency, exact minor-unit amount, unique one-to-one candidate, and a bounded date window.
- **Human confirmation.** A candidate is only a suggestion. The confirmation action is UI-only, rechecks uniqueness, rejects stale or already-used rows, and persists reviewer identity and time.
- **Account boundaries.** Source rows, closeout runs, and review actions are queried using the signed-in account identity. Unauthenticated requests to protected actions are rejected.
- **Minimal imported data.** CSV files are parsed in memory and not retained as uploaded files. The app stores fields needed for comparison and source provenance, not raw CSV, bank narration, account numbers, or customer names. Paystack credentials remain on the server.
- **Safe failure.** Invalid data, missing configuration, a provider error, duplicate import, stale candidate, or absent source rows is surfaced as an error or open state—not as a success-shaped result.

## Agent-Native and AI

Tillmatch is built with **Agent-Native `@agent-native/core` 0.222.2**. Agent-Native provides the application runtime, authenticated typed actions, and the agent workspace. Tillmatch's product actions connect those capabilities to source import, Paystack reads, closeout, review, and report workflows.

The reconciliation decision itself is deterministic TypeScript logic. The agent's role is to read persisted closeout evidence and explain what it supports. It must distinguish a candidate from a person-confirmed result, and it cannot call the confirmation or exception-review actions. This gives the user a conversational way to inspect the work without handing financial approval to a model.

## Built for the Agent-Native Hackathon

Tillmatch is a functional application built on the Agent-Native framework for the **Agent-Native Hackathon, sponsored by Builder.io**. It applies the hackathon's people-and-agent workflow to a concrete finance task: the app performs the source-grounded comparison, the agent can explain the evidence, and the person owns the consequential decision.

The project-specific implementation includes the public Tillmatch landing page, separate authenticated closeout dashboard, Paystack settlement reader, strict CSV import and explicit field mapping, account-scoped persistence, exact-match engine, exception review, human confirmation, and source-linked export. The app uses the Agent-Native chat template and its framework components alongside Tillmatch-specific routes and actions.

The official hackathon requires a functional Agent-Native app and a **public Clips recording viewable without login**. A public repository and hosted deployment are encouraged. Submission also requires project and creator/team details, eligibility and rules confirmations, and confirmation that the form submission was received. This repository does not claim that the Clip or entry has been submitted.

## Demo

The hosted app is [tillmatch.onrender.com](https://tillmatch.onrender.com). Its public page is `/`; the signed-in closeout desk is `/dashboard`; the agent workspace is `/chat`.

For a full data-backed walkthrough, use authorized Paystack settlement records and the corresponding real bank statement. The flow is: import/read both sources → run closeout → inspect the proposed match and unresolved rows → confirm only after checking the sources → reload and show the saved confirmation → export the report.

The developer currently has access to Paystack test mode only. Paystack test mode does not process settlements, so a test key cannot produce a genuine payout-to-bank reconciliation. Until authorized real settlement and bank records are available, the honest demo is the hosted product, authenticated empty state, and the source review workflow; no live match should be claimed. The real closeout view does not seed merchant transactions. A separate authenticated simulation preview uses three fictional settlement rows and four fictional bank credits only in browser memory; it invokes no server actions and writes nothing. The optional example CSVs are visibly marked and rejected by both import parsers. The small synthetic CSV under `test/fixtures/` remains isolated to parser tests.

### What the current test-mode demo can prove

The current hosted configuration uses a Paystack **test** secret. A successful authenticated request can demonstrate that the server reached Paystack's test environment, but it cannot demonstrate a genuine payout: Paystack does not process settlements in test mode. An empty settlement response is therefore not a reconciliation result. A test key must never be described as a live integration or as evidence that money reached a bank. Paystack explains this limitation in its [test/live authentication guide](https://paystack.com/docs/api/authentication/).

The recording opens with the manual closeout problem, then shows the public Tillmatch page, the signed-in workspace and its source controls, and the agent workspace. Its animated diagrams explain the intended data flow and are explicitly explanatory graphics, not imported transactions or API results. The recording does not show a real settlement, bank credit, saved match, or completed API read. The dashboard's empty state is the truthful state while real source records are absent. The authenticated **Try simulation (fictional)** view is available for a separate, client-only explanation of exact candidates and open rows; it is not a Paystack API or bank-data demonstration.

### What happens with live Paystack data

For a real closeout, a merchant needs all of the following:

1. A Paystack business activated for live use, with a server-side `sk_live_...` key stored in the deployment's secret environment. The key is never entered in the browser, committed to Git, or shown in a recording.
2. Actual successful settlement records for the selected period. Tillmatch's Paystack integration uses the read-only settlements listing endpoint and date filters; it cannot cause a settlement to happen. Paystack describes this endpoint in its [Settlements API documentation](https://paystack.com/docs/api/settlement/).
3. The real bank statement from the account that receives those payouts, uploaded by an authenticated user with the date, credit amount and currency mapped to the correct columns.
4. A review of Tillmatch's source-linked candidate. Only an exact, unique one-to-one amount and currency match inside the configured three-day window is suggested. The person checks the evidence and confirms it; uncertain, late, missing, partial, or batched amounts remain open.

Switching from a test key to a live key does not create a payout, grant bank access, or make a match. The live flow can only compare real records that the merchant is authorized to provide. Tillmatch is a closeout and review tool; it does not initiate transfers or replace the merchant's accounting controls.

### Data and decision boundaries

- The UI keeps test and live closeouts separate. Use the environment selector that matches the credential and source file.
- API access is server-side and read-only. CSV uploads are parsed in memory, validated, mapped explicitly, and not retained as raw files. The stored fields support matching and source traceability; the app does not need bank account numbers or customer names.
- Amounts are normalized to integer minor units before comparison. Currency must match exactly. The matching engine does not infer fees, split payouts, combine credits, or treat date proximity alone as proof.
- A suggested match is not a confirmed match. Confirmation rechecks that the source rows still exist and have not already been used, then persists the signed-in reviewer and time. The agent may explain available evidence but does not receive the confirmation action.
- A provider error, missing credential, empty source set, invalid row, or ambiguous candidate stays an error or open review item. None is translated into a successful match.
- `test/fixtures/paystack-small.csv` is a parser unit-test fixture only. It contains synthetic rows and is never a product seed, demo import, or evidence of a Paystack response.
- The authenticated simulation preview is a separate mode. Its candidate rows are labeled simulated, its controls cannot confirm a result, and leaving it returns to the real-data workspace. The example CSVs in `public/demo/` include a `SIMULATION_ONLY` column; both real-data import paths reject that marker before storage.

### Suggested screen-recording narration

> When a payment provider says a payout was sent, the merchant still needs to answer one practical question: did that money arrive in the bank? Finance teams often compare settlement reports and statements by hand, while different references, delays, combined deposits, and missing credits make the answer hard to prove.
>
> Tillmatch brings both sides into one closeout. An authorized user chooses the Paystack environment, reads settlement records or imports a real provider export, and maps the bank statement from the account that receives payouts. The rule is cautious: exact amount, exact currency, a unique one-to-one pair, and a bounded date window. A candidate is only a suggestion. Uncertain deposits stay open, and a person checks the source evidence before confirming. The agent can explain the evidence but cannot approve the match.
>
> This demonstration uses a Paystack test account. Test mode is a sandbox; Paystack does not process settlements there. This video therefore does not show a genuine payout or bank reconciliation. In live use, an activated merchant configures a live secret key on the server, Tillmatch reads actual settlements, and the merchant supplies the corresponding real bank statement. The application compares those records and still asks a person to confirm. A live key alone does not create a payout or provide bank data.

The longer Ezinne-voiced, captioned edit is produced from the separate workspace screen recording; the recording and generated video are not runtime data for the application. For a live-data walkthrough, replace the empty-state section only after real authorized settlement and corresponding bank records are available. Do not use the test parser fixture as if it were live evidence.

An agent response is optional for the test-only walkthrough; the closeout workflow does not require a model credential. If you choose to show an agent response, configure a supported model provider and show its actual output. A prompt suitable for an empty workspace is:

> Using only the records available in this workspace, tell me whether any Paystack settlement has a matching bank credit. If no records are loaded, say that no conclusion is possible. Do not invent records or confirm a match.

Skip that segment if the model provider is unavailable; the app can be demonstrated without presenting an unverified model response.

## Technology

- Agent-Native `@agent-native/core` 0.222.2 and Agent-Native Toolkit
- React 19 and React Router 8 in framework mode
- TypeScript for typed framework actions; JavaScript modules for CSV, matching, and Paystack client logic
- Drizzle ORM with PostgreSQL for hosted persistence; Agent-Native development storage for local work
- Paystack settlement list API, accessed server-side with read-only `GET` requests
- Node.js `>=22.22.0 <25` and pnpm 10.29.1. Render is pinned to Node.js 24.22.1 to match the Docker image.

## Run locally

```powershell
corepack enable
pnpm install --frozen-lockfile
pnpm dev -- --host 127.0.0.1
```

Open the local URL printed by the development server. Local development storage and local development authentication are for development only; they do not represent a production account or deployment.

To run the local PostgreSQL Compose stack with generated local-only credentials:

```powershell
./scripts/prepare-docker-env.ps1
docker compose --env-file .env.docker up --build
```

The generated `.env.docker` file is local-only and ignored by Git. Do not copy local Compose credentials or data into a hosted deployment.

## Run checks

```powershell
pnpm typecheck
node test/run.mjs
node scripts/verify-http.mjs http://127.0.0.1:3000
```

The isolated tests cover CSV parsing and validation, matching outcomes, Paystack key/environment validation, and the Paystack client request contract. They do not make a real Paystack request or verify a model provider. The HTTP script checks route responses and selected page content; HTTP 200 does not prove browser interaction, signed-in access, or a successful data workflow.

## Deploy to Render

`render.yaml` defines the Node web service and a PostgreSQL database in the **Frankfurt region**, plus the Render Nitro build/start commands and `/dashboard` health check. It pins Node.js 24.22.1 and invokes the repository-pinned pnpm through Corepack without enabling global pnpm symlinks. For a fresh Render setup, create a service using **New > Blueprint** and select this repository. Render provisions the database and injects its private internal connection string into the web service as `DATABASE_URL`; you do not need to create or paste a database URL yourself. The web service and database use the same region, so they can communicate over Render's private network. Render documents Blueprint database references in its [Blueprint specification](https://render.com/docs/blueprint-spec) and database connections in the [Postgres connection guide](https://render.com/docs/postgresql-creating-connecting).

The Blueprint uses Render's Free Postgres plan. Free databases expire 30 days after creation; upgrade the database if you need the hosted data to remain available beyond that period. [Render Free plan limits](https://render.com/docs/free).

Configure these values in Render's service environment:

| Variable | Configuration |
| --- | --- |
| `DATABASE_URL` | Automatically set from the Blueprint-created PostgreSQL database |
| `BETTER_AUTH_SECRET` | Automatically generated by Render and kept stable across deploys |
| `PAYSTACK_SECRET_KEY` | Enter your Paystack `sk_test_...` key when Render prompts for the secret |
| `PAYSTACK_ENVIRONMENT` | Set to `test` by the Blueprint; it matches your current test key |

The Paystack test secret is the only application secret you need to enter for the current build. Keep it in Render's secret settings and out of GitHub, the browser, and screen recordings. The closeout workflow does not require a model-provider credential.

On Render, leave `APP_URL` and `BETTER_AUTH_URL` unset so the public origin can be inferred. Keep production authentication enabled. Never commit secrets or enter them in a browser field, chat prompt, README, or recording. After deploying, check `/`, `/landing`, `/dashboard`, and `/chat`; then sign in and verify the authenticated dashboard and its real data state.

## Project map

| Path | Purpose |
| --- | --- |
| `app/routes/landing.tsx` | Public Tillmatch product page |
| `app/routes/dashboard.tsx` | Authenticated real-data closeout plus a separate client-only simulation preview |
| `actions/actions/` | Authenticated application operations and agent-tool permissions |
| `src/csv.mjs` | Strict CSV parsing and amount/date normalization |
| `src/matcher.mjs` | Deterministic exact, unique one-to-one match logic |
| `src/paystack.mjs` | Read-only Paystack settlement API client |
| `public/demo/` | Fictional example CSVs with a marker rejected by real import parsers |
| `server/server/db/schema.ts` | Persisted source records, runs, results, and confirmations |
| `test/` | Isolated parser, matcher, and Paystack client tests |
| `render.yaml` | Render service configuration |

## References

- [Agent-Native Hackathon official rules](https://www.builder.io/hackathon/rules)
- [Agent-Native documentation](https://www.agent-native.com/docs/)
- [Agent-Native Docker guide](https://www.agent-native.com/docs/docker/)
- [Paystack API authentication and test/live modes](https://paystack.com/docs/api/authentication/)
- [Paystack settlement API](https://paystack.com/docs/api/settlement/)

Check the official rules at submission time for current dates, eligibility, required information, and form instructions. The published deadline is November 9, 2026 at 11:59 PM Pacific Time.
