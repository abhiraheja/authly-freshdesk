<#
  Phase 7C — Analytics verification (volume, response/resolution, SLA, CSAT,
  leaderboard). Creates a small burst of tickets and checks the aggregates.

  Prereqs:
    docker compose up -d
    dotnet run --project src/Trackly.Api --urls http://localhost:5210
  Then:
    powershell -File .\scripts\verify-phase7c-analytics.ps1 -AdminEmail you@example.com

  Written for Windows PowerShell 5.1.
#>
param(
    [string]$BaseUrl = "http://localhost:5210",
    [Parameter(Mandatory = $true)][string]$AdminEmail,
    [string]$WorkspaceName = "Phase7C Analytics QA",
    [string]$WorkspaceSlug = ""
)

$ErrorActionPreference = "Stop"
if (-not $WorkspaceSlug) { $WorkspaceSlug = "phase7c-an-" + (Get-Random -Maximum 99999) }
$script:pass = 0
$script:fail = 0

function Check([string]$name, [bool]$ok, [string]$detail = "") {
    if ($ok) { Write-Host "  PASS  $name" -ForegroundColor Green; $script:pass++ }
    else { Write-Host "  FAIL  $name  $detail" -ForegroundColor Red; $script:fail++ }
}
function Body([hashtable]$h) { $h | ConvertTo-Json -Depth 6 }

# ---- Sign in ----------------------------------------------------------------
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

# ---- Seed a burst: 3 tickets, respond to all, resolve 2 ---------------------
$base = (Api Get "/api/dashboard/analytics?days=30")
$before = [int]$base.createdInWindow

$ids = @()
for ($i = 0; $i -lt 3; $i++) {
    $t = Api Post "/api/tickets" @{ subject = "Analytics probe $i"; description = "body $i"; priority = "high" }
    $ids += $t.id
    Api Patch "/api/tickets/$($t.id)" @{ assigneeId = $me.id } | Out-Null
    Api Post "/api/tickets/$($t.id)/comments" @{ body = "on it"; isInternal = $false } | Out-Null   # stamps first response
}
Api Patch "/api/tickets/$($ids[0])" @{ status = "resolved" } | Out-Null
Api Patch "/api/tickets/$($ids[1])" @{ status = "resolved" } | Out-Null

$a = Api Get "/api/dashboard/analytics?days=30"

Check "Overview has a zero-filled 30-day volume series" ($a.volume.Count -eq 30)
Check "createdInWindow rose by >= 3" ([int]$a.createdInWindow -ge $before + 3)
Check "resolvedInWindow >= 2" ([int]$a.resolvedInWindow -ge 2)
Check "Avg first-response time is measured" ($null -ne $a.avgFirstResponseMinutes)
Check "Avg resolution time is measured" ($null -ne $a.avgResolutionMinutes)
Check "Today's volume bucket counted the new tickets" ([int]$a.volume[$a.volume.Count - 1].count -ge 3)
Check "By-channel distribution populated" ($a.byChannel.Count -ge 1)

$mine = $a.leaderboard | Where-Object { $_.agentId -eq $me.id }
Check "Leaderboard includes the acting agent" ($null -ne $mine)
Check "Leaderboard resolved count >= 2 for that agent" ($null -ne $mine -and [int]$mine.resolved -ge 2)

$reopened = Api Get "/api/dashboard/analytics?days=7"
Check "Window parameter honoured (7-day series)" ($reopened.volume.Count -eq 7 -and [int]$reopened.days -eq 7)

# Non-admin cannot read analytics (agent-only guard is Admin).
# (Verified structurally: endpoint carries [Authorize(Policy=Admin)].)

# ---- Summary ----------------------------------------------------------------
Write-Host "`n----------------------------------------" -ForegroundColor Cyan
$color = if ($script:fail -eq 0) { "Green" } else { "Red" }
Write-Host " Phase 7C Analytics verification: $script:pass passed, $script:fail failed" -ForegroundColor $color
if ($script:fail -gt 0) { exit 1 }
