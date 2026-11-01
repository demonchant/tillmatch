$ErrorActionPreference = "Stop"

$appRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $appRoot ".env.docker"
if (Test-Path -LiteralPath $envPath) {
  throw ".env.docker already exists. Keep the current local credentials and edit that file if needed."
}

$postgresPassword = node -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('hex'))"
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($postgresPassword)) {
  throw "Could not generate a PostgreSQL password using Node.js crypto."
}
$authSecret = node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($authSecret)) {
  throw "Could not generate a Better Auth secret using Node.js crypto."
}

$openAiKey = [Environment]::GetEnvironmentVariable("OPENAI_API_KEY")
$lines = @(
  "POSTGRES_DB=tillmatch",
  "POSTGRES_USER=tillmatch",
  "POSTGRES_PASSWORD=$postgresPassword",
  "DATABASE_URL=postgresql://tillmatch:$postgresPassword@postgres:5432/tillmatch",
  "BETTER_AUTH_SECRET=$authSecret",
  "BETTER_AUTH_URL=",
  "APP_URL=",
  "PORT=3000",
  "OPENAI_API_KEY=$openAiKey",
  "PAYSTACK_SECRET_KEY=",
  "PAYSTACK_ENVIRONMENT="
)
Set-Content -LiteralPath $envPath -Value $lines -Encoding ascii

Write-Output "Created ignored local Docker settings at $envPath. Generated secret values were not printed."
Write-Output "This creates a local PostgreSQL database only. Live Paystack reads still require a merchant-issued key and explicit environment."
