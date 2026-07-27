<#
  Phase 7B verification suite — AI copilot (availability gating + guardrails,
  and, when Ai:ApiKey is configured, the live draft/summary/triage/kb-draft ops).

  Prereqs:
    docker compose up -d
    dotnet run --project src/Trackly.Api --urls http://localhost:5210
  Then:
    powershell -File .\scripts\verify-phase7b.ps1 -AdminEmail you@example.com

  The gating checks pass with or without an API key. The live-model checks run
  only when the deployment reports configured=true (Ai:ApiKey set) and make real
  Anthropic calls, so run them knowingly.

  Written for Windows PowerShell 5.1.
#>
param(
    [string]$BaseUrl = "http://localhost:5210",
    [Parameter(Mandatory = $true)][string]$AdminEmail,
    [string]$WorkspaceName = "Phase7B QA",
    [string]$WorkspaceSlug = ""
)

$ErrorActionPreference = "Stop"
if (-not $WorkspaceSlug) { $WorkspaceSlug = "phase7b-" + (Get-Random -Maximum 99999) }
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

# Returns the HTTP status code of a call expected to fail (0 if it unexpectedly succeeds).
function StatusOf($method, $path, $body) {
    try { Api $method $path $body | Out-Null; return 0 }
    catch { return $_.Exception.Response.StatusCode.value__ }
}

$ticket = Api Post "/api/tickets" @{ subject = "Login loops back to sign-in"; description = "After I click the magic link nothing happens and I land back on the login page."; priority = "medium" }

# ---- Settings + configured flag ---------------------------------------------
$settings = Api Get "/api/admin/ai"
$configured = [bool]$settings.configured
Check "Admin AI settings expose enabled + configured" ($null -ne $settings.enabled -and $null -ne $settings.configured)
Write-Host "    (deployment Ai:ApiKey configured = $configured)" -ForegroundColor DarkGray

# ---- Toggle OFF => copilot unavailable, every AI op 409 ----------------------
Api Put "/api/admin/ai" @{ enabled = $false } | Out-Null
$availOff = Api Get "/api/ai/available"
Check "available=false when workspace toggle is off" ($availOff.available -eq $false)
Check "draft-reply 409 when AI disabled" ((StatusOf Post "/api/tickets/$($ticket.id)/ai/draft-reply" @{}) -eq 409)
Check "triage 409 when AI disabled" ((StatusOf Post "/api/tickets/$($ticket.id)/ai/triage" @{}) -eq 409)

# ---- Toggle ON => availability tracks the deployment key --------------------
$after = Api Put "/api/admin/ai" @{ enabled = $true }
Check "Toggle persists enabled=true" ($after.enabled -eq $true)
$availOn = Api Get "/api/ai/available"
Check "available mirrors deployment key when toggle on" ($availOn.available -eq $configured)

if (-not $configured) {
    Check "No key => AI ops still 409 even with toggle on" ((StatusOf Post "/api/tickets/$($ticket.id)/ai/summary" @{}) -eq 409)
    Write-Host "    Skipping live-model checks (set Ai:ApiKey to run them)." -ForegroundColor Yellow
}
else {
    Write-Host "`n  Running live Anthropic calls..." -ForegroundColor Cyan
    $draft = Api Post "/api/tickets/$($ticket.id)/ai/draft-reply" @{}
    Check "draft-reply returns a non-empty draft" (-not [string]::IsNullOrWhiteSpace($draft.draft))
    $summary = Api Post "/api/tickets/$($ticket.id)/ai/summary" @{}
    Check "summary returns non-empty text" (-not [string]::IsNullOrWhiteSpace($summary.summary))
    $triage = Api Post "/api/tickets/$($ticket.id)/ai/triage" @{}
    Check "triage returns a known priority" (@("low", "medium", "high", "urgent") -contains $triage.priority)
    Check "triage returns a sentiment" (-not [string]::IsNullOrWhiteSpace($triage.sentiment))
    $kb = Api Post "/api/tickets/$($ticket.id)/ai/kb-draft" @{}
    Check "kb-draft returns title + body" (-not [string]::IsNullOrWhiteSpace($kb.title) -and -not [string]::IsNullOrWhiteSpace($kb.body))
}

# ---- Summary ----------------------------------------------------------------
Write-Host "`n----------------------------------------" -ForegroundColor Cyan
$color = if ($script:fail -eq 0) { "Green" } else { "Red" }
Write-Host " Phase 7B verification: $script:pass passed, $script:fail failed" -ForegroundColor $color
if ($script:fail -gt 0) { exit 1 }
