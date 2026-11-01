# Tillmatch

**Tillmatch helps a merchant close the gap between a Paystack payout and the credit that actually reached the bank.** It brings both sources into one closeout, shows the evidence behind each possible match, and leaves the decision with a person.

Tillmatch is built for operators and finance teams who currently compare payout notices with bank statements by hand. A missing, delayed, partial, or batched credit can be hard to distinguish from a normal payout when the records live in separate systems. Tillmatch makes the comparison traceable without pretending uncertain data is settled.

## End-to-end user workflow

1. **Sign in.** A merchant opens the private closeout dashboard. Settlement and bank records are scoped to the signed-in account.
2. **Choose the Paystack environment.** Test and live records are kept separate. For a real closeout, the selected environment must match the source records.
3. **Bring in the Paystack settlement.** The user can make a server-side, read-only request to Paystack's settlement list for a date range, or import a real settlement CSV and map its ID, date, amount, currency, and status columns. The user explicitly selects whether CSV amounts are major or minor currency units.
4. **Bring in the receiving bank's statement credits.** The user selects the date, amount, and currency columns from a real bank CSV. Only positive credits are accepted.
5. **Run closeout.** Tillmatch compares the selected account's saved records. A settlement is a candidate only when exactly one unclaimed bank credit has the same currency and exact minor-unit amount within the selected date window (three days by default).
6. **Review the evidence.** Each result points to its Paystack source ID or CSV row and bank statement row, along with dates, amount, currency, source hash where available, status, and reason. Ambiguous, invalid, non-settled, unmatched, partial, and many-to-one cases remain open for review; Tillmatch does not infer fees or combine rows.
7. **Confirm deliberately.** A signed-in person inspects both records and confirms an exact candidate. Confirmation is an explicit user action; the agent cannot confirm a financial match.
8. **Check the saved result and export.** The dashboard reads persisted results back after writes and can download a source-linked CSV report for the closeout.

Tillmatch does not move money. It does not fabricate sample merchant data or turn an error into a success state. Raw CSV text is parsed for import and is not stored as a file; the application stores the selected source fields needed for the closeout and source provenance.

## Agent-Native in the product

Tillmatch is built on **Agent-Native `@agent-native/core` 0.222.2**. The framework supplies the application runtime, authenticated actions, and agent workspace. Product actions expose typed operations for reading saved closeouts, importing source rows, fetching Paystack settlements, running reconciliation, reviewing exceptions, and confirming a match. The matching decision is deterministic and source-grounded. An agent may inspect and explain stored evidence, but confirmation remains a human-only action.

The Paystack integration calls the settlement-list API with a backend secret key and makes a `GET` request. The key is not sent to the browser. Test and live credentials are validated against the selected environment. A Paystack test key is useful for testing API configuration, but Paystack does not process settlements in test mode; it cannot provide a genuine settlement-to-bank reconciliation.

## Hackathon submission

This project is submitted for the **Agent-Native Hackathon**, sponsored by Builder.io. Its core idea is a people-and-agent closeout workflow: the application gathers and compares financial source records, the agent can explain what the records support, and a person owns the final match decision.

The submission uses Agent-Native as its application and action framework. The Tillmatch-specific work includes the separate public landing page and authenticated closeout dashboard, Paystack settlement reader, strict CSV parsing and explicit column mapping, source-linked persistence, deterministic one-to-one matching, human confirmation boundary, and closeout export.

The hackathon requires a functional Agent-Native application and a **public Clips demonstration that viewers can watch without signing in**. A public repository and hosted deployment are encouraged. The submission also requires project and creator/team details, required rule and eligibility confirmations, and a submission receipt. These participant-specific details and submission steps must be completed by the entrant; this repository does not claim that the entry has been submitted.

### Demo path

1. Open the public landing page at `/` and follow **Open the closeout desk**.
2. Sign in with the account created for the hosted application.
3. On `/dashboard`, choose **Test account** when using a test key. Show the actual empty state if no source records exist.
4. If a model provider is configured, open **Ask the agent** and ask it to explain only records that are present. Show the real response or skip this part if the provider is unavailable.
5. Explain that the full reconciliation flow requires an authorized Paystack settlement source and its corresponding real bank statement credit. Do not stage invented rows or describe a test-mode response as a live settlement.

With authorized records available, the full product path is: import/read the Paystack source, import the matching bank statement, run closeout, inspect candidate and exception evidence, confirm an exact candidate as a person, reload to verify persistence, and export the report. The repository does not include seeded product transactions. The small synthetic CSV fixture under `test/fixtures/` is only for isolated parser tests.

## Current demo and integration status

- **Local Docker demonstration:** the app and PostgreSQL were reported healthy by the developer, and the HTTP smoke script passed for `/`, `/landing`, `/dashboard`, and `/chat`. These results are recorded from developer-supplied PowerShell output; they are not an independent inspection from this repository session.
- **Hosted Render deployment:** deployment still requires connecting this repository to Render and supplying a persistent PostgreSQL database URL. A hosted sign-in and authenticated dashboard walkthrough must be checked after deployment.
- **Paystack:** only test-mode access is available to the developer. Test mode does not process settlements, so no genuine settlement-to-bank match is claimed.
- **Model:** the chat route is part of the application. A successful hosted model response has not been verified; configure a real provider before including the agent response in a demo.
- **Public Clips and final entry:** not yet recorded/submitted. The public clip must be viewable without login, and submission is complete only after the form confirms receipt.

## Run locally

Requirements: Node.js 22.22 or newer and pnpm 10.29.1 (via Corepack).

```powershell
corepack enable
pnpm install --frozen-lockfile
pnpm dev -- --host 127.0.0.1
```

The public landing page is `/`; the authenticated product workspace is `/dashboard`; the agent workspace is `/chat`. Local development uses Agent-Native's development storage and authentication behavior. A development identity is not a production user identity.

## Verification commands

```powershell
pnpm typecheck
node test/run.mjs
node scripts/verify-http.mjs http://127.0.0.1:3000
```

The unit tests cover CSV validation, matching behavior, Paystack configuration and the API client's request contract. The HTTP script checks route status and selected page content; an HTTP 200 dashboard response does not prove a signed-in session, browser interaction, Paystack request, or model response. Use the URL of the actual running app when invoking the HTTP script.

## Hosted deployment on Render

`render.yaml` describes a Node web service using the `render_com` Nitro preset and `/dashboard` health check. Connect this repository to Render and create/provide a **persistent PostgreSQL database** before deploying; the blueprint prompts for `DATABASE_URL` and does not provision the database itself.

Set these values through Render's environment settings:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Connection URL for the persistent hosted PostgreSQL database |
| `BETTER_AUTH_SECRET` | A fresh, private secret; Render's blueprint is configured to generate it |
| `PAYSTACK_SECRET_KEY` | Optional server-side key; use the matching test or live key only |
| `PAYSTACK_ENVIRONMENT` | `test` for a test key, or `live` for a live key |
| `OPENAI_API_KEY` | Optional; required only if the deployment will use the OpenAI provider for agent responses |

Leave `APP_URL` and `BETTER_AUTH_URL` unset on Render so the public URL can be inferred. Never commit secrets, put them in browser code, or include them in a recording. Keep `AUTH_DISABLED` off in hosted production. After deploy, verify `/`, `/landing`, `/dashboard`, and `/chat`, then sign in and confirm the authenticated dashboard and its actual empty state.

### Local Docker Compose

The application can also be run locally with Docker Desktop and PostgreSQL:

```powershell
./scripts/prepare-docker-env.ps1
docker compose --env-file .env.docker up --build
```

This is a local development stack, not the hosted production database. The generated `.env.docker` file is private local configuration and is ignored by Git.

## Main implementation areas

- `app/routes/landing.tsx` and `app/routes/landing.css` — public product landing page.
- `app/routes/dashboard.tsx` and `app/routes/closeout.css` — authenticated closeout interface and source review.
- `src/csv.mjs` — strict CSV parsing, explicit mappings, and amount/date validation.
- `src/paystack.mjs` — environment-checked, read-only Paystack settlement API client.
- `src/matcher.mjs` — deterministic unique exact-amount, exact-currency matching and safe unresolved outcomes.
- `actions/actions/` — authenticated, typed application operations and the human confirmation boundary.
- `server/server/db/schema.ts` — persisted source, run, and review data.
- `test/` — isolated parser, matcher, and Paystack client tests.

## Hackathon rules and references

- [Agent-Native Hackathon official rules](https://www.builder.io/hackathon/rules)
- [Agent-Native documentation](https://www.agent-native.com/docs/)
- [Agent-Native Docker deployment guide](https://www.agent-native.com/docs/docker/)
- [Paystack authentication and test/live environments](https://paystack.com/docs/api/authentication/)
- [Paystack settlement API](https://paystack.com/docs/api/settlement/)

The official rules and deadline can change; check the linked rules when submitting. As of this README, the published deadline is November 9, 2026 at 11:59 PM Pacific Time. The entrant must verify current rules, eligibility, originality disclosure, team authorization, and final submission receipt.
