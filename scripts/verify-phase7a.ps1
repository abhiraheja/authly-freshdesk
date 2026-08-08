<#
  Phase 7A verification suite — tags, teams, SLA, KB, canned responses, automation.

  Prereqs:
    docker compose up -d
    dotnet run --project src/Trackly.Api --urls http://localhost:5210
  Then:
    powershell -File .\scripts\verify-phase7a.ps1 -AdminEmail you@example.com

  Written for Windows PowerShell 5.1.
#>
param(
    [string]$BaseUrl = "http://localhost:5210",
    [Parameter(Mandatory = $true)][string]$AdminEmail,
    [string]$WorkspaceName = "Phase7A QA"
)

$ErrorActionPreference = "Stop"
$script:pass = 0
$script:fail = 0

function Check([string]$name, [bool]$ok, [string]$detail = "") {
    if ($ok) { Write-Host "  PASS  $name" -ForegroundColor Green; $script:pass++ }
    else { Write-Host "  FAIL  $name  $detail" -ForegroundColor Red; $script:fail++ }
}

function Body([hashtable]$h) { $h | ConvertTo-Json -Depth 6 }

# ---- Sign in ----------------------------------------------------------------
# Trackly is self-hosted: an empty installation is claimed once by POST /api/setup,
# which creates the workspace and signs its first admin straight in - there is no
# code to paste and no SMTP yet. Afterwards this is the ordinary magic-link flow.
Write-Host "`nSigning in as $AdminEmail ..." -ForegroundColor Cyan
if ((Invoke-RestMethod -Uri "$BaseUrl/api/setup/status").needsSetup) {
    Write-Host "Empty installation - running first-run setup as '$WorkspaceName'" -ForegroundColor Cyan
    Invoke-WebRequest -Uri "$BaseUrl/api/setup" -Method Post -ContentType "application/json" `
        -Body (Body @{ organisationName = $WorkspaceName; email = $AdminEmail; name = "QA Admin" }) `
        -SessionVariable session -UseBasicParsing | Out-Null
}
else {
    Invoke-RestMethod -Uri "$BaseUrl/api/auth/magic-link/send" -Method Post -ContentType "application/json" `
        -Body (Body @{ email = $AdminEmail }) | Out-Null
    $code = Read-Host "Paste the 6-digit code from the API console"
    Invoke-WebRequest -Uri "$BaseUrl/api/auth/magic-link/verify" -Method Post -ContentType "application/json" `
        -Body (Body @{ email = $AdminEmail; code = $code }) -SessionVariable session -UseBasicParsing | Out-Null
}
$me = Invoke-RestMethod -Uri "$BaseUrl/api/users/me" -WebSession $session
$slug = $me.workspace.slug
Check "Authenticated as admin" ($me.role -eq "admin")

function Api($method, $path, $body) {
    if ($null -ne $body) {
        return Invoke-RestMethod -Uri "$BaseUrl$path" -Method $method -ContentType "application/json" -Body (Body $body) -WebSession $session
    }
    return Invoke-RestMethod -Uri "$BaseUrl$path" -Method $method -WebSession $session
}

# ---- Tags -------------------------------------------------------------------
$ticket = Api Post "/api/tickets" @{ subject = "Tag me"; description = "please"; priority = "high" }
Api Put "/api/tickets/$($ticket.id)/tags" @{ tags = @("vip", "billing") } | Out-Null
$detail = Api Get "/api/tickets/$($ticket.id)"
Check "Ticket tags set + returned to agent" ($detail.tags.Count -eq 2)
$tags = Api Get "/api/tags"
Check "Workspace tag list populated" (($tags | Where-Object { $_.name -eq "vip" }).Count -eq 1)

# ---- Teams ------------------------------------------------------------------
$team = Api Post "/api/teams" @{ name = "Billing team" }
Api Post "/api/teams/$($team.id)/members" @{ userId = $me.id } | Out-Null
Api Patch "/api/tickets/$($ticket.id)" @{ teamId = $team.id } | Out-Null
$routed = Api Get "/api/tickets/$($ticket.id)"
Check "Ticket routed to team + round-robin assigned within it" ($routed.teamId -eq $team.id -and $routed.assignee.id -eq $me.id)

# ---- SLA --------------------------------------------------------------------
Api Put "/api/admin/sla" @{ priority = "high"; firstResponseMinutes = 60; resolveMinutes = 240 } | Out-Null
$slaTicket = Api Post "/api/tickets" @{ subject = "SLA ticket"; description = "x"; priority = "high" }
Check "SLA due dates stamped on create" ($null -ne $slaTicket.firstResponseDueAt -and $null -ne $slaTicket.resolveDueAt)
Api Post "/api/tickets/$($slaTicket.id)/comments" @{ body = "on it"; isInternal = $false } | Out-Null
$afterReply = Api Get "/api/tickets/$($slaTicket.id)"
Check "First agent reply stamps first_response_at" ($null -ne $afterReply.firstResponseAt)

# ---- Knowledge base ---------------------------------------------------------
$draft = Api Post "/api/kb/articles" @{ title = "Reset your password"; body = "Click forgot password."; status = "draft" }
$pubEmpty = Api Get "/api/public/workspaces/$slug/kb"
Check "Draft article is NOT public" (($pubEmpty | Where-Object { $_.id -eq $draft.id }).Count -eq 0)
Api Put "/api/kb/articles/$($draft.id)" @{ title = "Reset your password"; body = "Click forgot password."; status = "published" } | Out-Null
$pub = Api Get "/api/public/workspaces/$slug/kb"
Check "Published article appears on public KB" (($pub | Where-Object { $_.id -eq $draft.id }).Count -eq 1)
$suggest = Api Get "/api/public/workspaces/$slug/kb/suggest?q=password"
Check "KB suggest matches published title" (($suggest | Where-Object { $_.id -eq $draft.id }).Count -eq 1)

# ---- Canned responses -------------------------------------------------------
$canned = Api Post "/api/canned-responses" @{ title = "Thanks"; body = "Thanks for reaching out!" }
$cannedList = Api Get "/api/canned-responses"
Check "Canned response saved + listed" (($cannedList | Where-Object { $_.id -eq $canned.id }).Count -eq 1)

# ---- Automation -------------------------------------------------------------
Api Post "/api/automation-rules" @{
    name       = "Tag urgent"
    trigger    = "on_create"
    conditions = @(@{ field = "priority"; op = "equals"; value = "urgent" })
    actions    = @(@{ type = "add_tag"; value = "sev1" })
    enabled    = $true
    sortOrder  = 0
} | Out-Null
$autoTicket = Api Post "/api/tickets" @{ subject = "Everything is down"; description = "help"; priority = "urgent" }
$autoDetail = Api Get "/api/tickets/$($autoTicket.id)"
Check "Automation applied add_tag on matching create" (($autoDetail.tags | Where-Object { $_.name -eq "sev1" }).Count -eq 1)

$noMatch = Api Post "/api/tickets" @{ subject = "minor thing"; description = "x"; priority = "low" }
$noMatchDetail = Api Get "/api/tickets/$($noMatch.id)"
Check "Automation does NOT fire when conditions don't match" (($noMatchDetail.tags | Where-Object { $_.name -eq "sev1" }).Count -eq 0)

$badRule = $null
try { Api Post "/api/automation-rules" @{ name = "bad"; trigger = "nope"; conditions = @(); actions = @(); enabled = $true; sortOrder = 0 } }
catch { $badRule = $_.Exception.Response.StatusCode.value__ }
Check "Invalid automation trigger rejected (400)" ($badRule -eq 400)

# ---- Summary ----------------------------------------------------------------
Write-Host "`n----------------------------------------" -ForegroundColor Cyan
$color = if ($script:fail -eq 0) { "Green" } else { "Red" }
Write-Host " Phase 7A verification: $script:pass passed, $script:fail failed" -ForegroundColor $color
if ($script:fail -gt 0) { exit 1 }
