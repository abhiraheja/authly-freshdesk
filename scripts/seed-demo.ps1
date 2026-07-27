<#
  Seeds the signed-in admin's workspace with demo data (Development only).

  Prereqs: API running, and you've already created your workspace/admin.
    powershell -File .\scripts\seed-demo.ps1 -AdminEmail you@example.com

  Or, if you're already signed in to the app in your browser, just run this in
  the devtools console (same-origin, uses your session cookie):
    fetch('/api/dev/seed', { method: 'POST' }).then(r => r.json()).then(console.log)
#>
param(
    [string]$BaseUrl = "http://localhost:5210",
    [Parameter(Mandatory = $true)][string]$AdminEmail
)

$ErrorActionPreference = "Stop"

Write-Host "Sending sign-in code to $AdminEmail ..." -ForegroundColor Cyan
Invoke-RestMethod -Uri "$BaseUrl/api/auth/magic-link/send" -Method Post -ContentType "application/json" `
    -Body (@{ email = $AdminEmail } | ConvertTo-Json) | Out-Null
$code = Read-Host "Paste the 6-digit code from the API console"

Invoke-WebRequest -Uri "$BaseUrl/api/auth/magic-link/verify" -Method Post -ContentType "application/json" `
    -Body (@{ email = $AdminEmail; code = $code } | ConvertTo-Json) -SessionVariable session -UseBasicParsing | Out-Null

$me = Invoke-RestMethod -Uri "$BaseUrl/api/users/me" -WebSession $session
if ($me.role -ne "admin") { Write-Host "You must be a workspace admin to seed." -ForegroundColor Red; exit 1 }

Write-Host "Seeding workspace '$($me.workspace.slug)' ..." -ForegroundColor Cyan
try {
    $result = Invoke-RestMethod -Uri "$BaseUrl/api/dev/seed" -Method Post -WebSession $session
    $result | ConvertTo-Json -Depth 5 | Write-Host
    Write-Host "`nDone. Refresh the app to see tickets, KB, SLA countdowns, etc." -ForegroundColor Green
}
catch {
    $r = $_.Exception.Response
    if ($null -ne $r -and [int]$r.StatusCode -eq 404) {
        Write-Host "Seed endpoint is Development-only (got 404). Run the API with ASPNETCORE_ENVIRONMENT=Development." -ForegroundColor Red
    }
    else { throw }
}
