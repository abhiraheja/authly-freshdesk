<#
  Phase 7C — CSAT verification (survey issuance, gating, single-submission).

  Prereqs:
    docker compose up -d
    dotnet run --project src/Trackly.Api --urls http://localhost:5210
  Then:
    powershell -File .\scripts\verify-phase7c-csat.ps1 -AdminEmail you@example.com

  The happy-path submit needs the rating token, which the resolution email prints
  to the API console (dev uses the logging email sender). Paste it when prompted;
  leave blank to skip the submit checks and run only the observable guardrails.

  Written for Windows PowerShell 5.1.
#>
param(
    [string]$BaseUrl = "http://localhost:5210",
    [Parameter(Mandatory = $true)][string]$AdminEmail,
    [string]$WorkspaceName = "Phase7C QA",
    [string]$WorkspaceSlug = ""
)

$ErrorActionPreference = "Stop"
if (-not $WorkspaceSlug) { $WorkspaceSlug = "phase7c-" + (Get-Random -Maximum 99999) }
$script:pass = 0
$script:fail = 0

function Check([string]$name, [bool]$ok, [string]$detail = "") {
    if ($ok) { Write-Host "  PASS  $name" -ForegroundColor Green; $script:pass++ }
    else { Write-Host "  FAIL  $name  $detail" -ForegroundColor Red; $script:fail++ }
}

function Body([hashtable]$h) { $h | ConvertTo-Json -Depth 6 }

# ---- Sign in (magic link + pasted code, signing up if new) ------------------
Write-Host "`nSigning in as $AdminEmail ..." -ForegroundColor Cyan
Invoke-RestMethod -Uri "$BaseUrl/api/auth/magic-link/send" -Method Post -ContentType "application/json" `
    -Body (Body @{ email = $AdminEmail }) | Out-Null
$code = Read-Host "Paste the 6-digit code from the API console"

$verify = Invoke-WebRequest -Uri "$BaseUrl/api/auth/magic-link/verify" -Method Post -ContentType "application/json" `
    -Body (Body @{ email = $AdminEmail; code = $code }) -SessionVariable session -UseBasicParsing
if (($verify.Content | ConvertFrom-Json).status -eq "signup_required") {
    Invoke-WebRequest -Uri "$BaseUrl/api/signup" -Method Post -ContentType "application/json" `
        -Body (Body @{ email = $AdminEmail; code = $code; workspaceName = $WorkspaceName; workspaceSlug = $WorkspaceSlug; name = "QA Admin" }) `
        -WebSession $session -UseBasicParsing | Out-Null
}
$me = Invoke-RestMethod -Uri "$BaseUrl/api/users/me" -WebSession $session
Check "Authenticated as admin" ($me.role -eq "admin")

function Api($method, $path, $body) {
    if ($null -ne $body) {
        return Invoke-RestMethod -Uri "$BaseUrl$path" -Method $method -ContentType "application/json" -Body (Body $body) -WebSession $session
    }
    return Invoke-RestMethod -Uri "$BaseUrl$path" -Method $method -WebSession $session
}
function StatusOf($method, $path, $body) {
    try { Api $method $path $body | Out-Null; return 0 }
    catch { return $_.Exception.Response.StatusCode.value__ }
}
# Public (no session) POST returning its HTTP status.
function PubStatus($path, $body) {
    try { Invoke-RestMethod -Uri "$BaseUrl$path" -Method Post -ContentType "application/json" -Body (Body $body) | Out-Null; return 0 }
    catch { return $_.Exception.Response.StatusCode.value__ }
}

# Ensure CSAT is enabled, then resolve a self-assigned ticket => survey issued.
$notif = Api Get "/api/admin/settings/notifications"
$notif.csatEnabled = $true
Api Put "/api/admin/settings/notifications" $notif | Out-Null

$ticket = Api Post "/api/tickets" @{ subject = "Printer offline"; description = "It won't connect."; priority = "medium" }
Api Patch "/api/tickets/$($ticket.id)" @{ assigneeId = $me.id } | Out-Null
Api Patch "/api/tickets/$($ticket.id)" @{ status = "resolved" } | Out-Null

$csat = Api Get "/api/tickets/$($ticket.id)/csat"
Check "Survey issued on resolve (agent sees it, unrated)" ($null -ne $csat -and $csat.submitted -eq $false)

# Guardrails that don't need the real token:
Check "Invalid rating rejected (400) regardless of token" ((PubStatus "/api/public/csat/$($ticket.id)?token=whatever" @{ rating = 9 }) -eq 400)
Check "Invalid token rejected (404)" ((PubStatus "/api/public/csat/$($ticket.id)?token=not-a-real-token" @{ rating = 5 }) -eq 404)

# CSAT disabled => no survey issued on resolve.
$notif.csatEnabled = $false
Api Put "/api/admin/settings/notifications" $notif | Out-Null
$t2 = Api Post "/api/tickets" @{ subject = "No survey wanted"; description = "x"; priority = "low" }
Api Patch "/api/tickets/$($t2.id)" @{ status = "resolved" } | Out-Null
$csat2 = $null; try { $csat2 = Api Get "/api/tickets/$($t2.id)/csat" } catch {}   # 204 => $null
Check "No survey issued when CSAT disabled" ($null -eq $csat2)
$notif.csatEnabled = $true
Api Put "/api/admin/settings/notifications" $notif | Out-Null

# ---- Happy path (needs the emailed token) -----------------------------------
Write-Host "`nThe resolution email for ticket '$($ticket.subject)' was logged to the API console." -ForegroundColor Cyan
$raw = Read-Host "Paste its CSAT link or token (blank to skip the submit checks)"
if ($raw) {
    $token = $raw
    if ($raw -match "token=([^&\s]+)") { $token = $Matches[1] }

    $ok = PubStatus "/api/public/csat/$($ticket.id)?token=$token" @{ rating = 5; comment = "Fast and friendly" }
    Check "First submission accepted (204)" ($ok -eq 0)
    $again = PubStatus "/api/public/csat/$($ticket.id)?token=$token" @{ rating = 1 }
    Check "Second submission rejected (409, cannot rate twice)" ($again -eq 409)

    $rated = Api Get "/api/tickets/$($ticket.id)/csat"
    Check "Agent sees the recorded rating" ($rated.submitted -eq $true -and $rated.rating -eq 5)
}
else {
    Write-Host "  (skipped submit checks — no token provided)" -ForegroundColor Yellow
}

# ---- Summary ----------------------------------------------------------------
Write-Host "`n----------------------------------------" -ForegroundColor Cyan
$color = if ($script:fail -eq 0) { "Green" } else { "Red" }
Write-Host " Phase 7C CSAT verification: $script:pass passed, $script:fail failed" -ForegroundColor $color
if ($script:fail -gt 0) { exit 1 }
