<#
  Phase 7C — Live chat verification (REST surface). Drives a visitor + agent
  conversation and confirms the transcript becomes a ticket. The SignalR
  real-time layer (presence/typing/push) needs a browser and is not scripted.

  Prereqs:
    docker compose up -d
    dotnet run --project src/Trackly.Api --urls http://localhost:5210
  Then:
    powershell -File .\scripts\verify-phase7c-chat.ps1 -AdminEmail you@example.com

  Written for Windows PowerShell 5.1.
#>
param(
    [string]$BaseUrl = "http://localhost:5210",
    [Parameter(Mandatory = $true)][string]$AdminEmail,
    [string]$WorkspaceName = "Phase7C Chat QA"
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

# Agent (session-scoped) and visitor (anonymous) callers.
function Agent($method, $path, $body) {
    if ($null -ne $body) {
        return Invoke-RestMethod -Uri "$BaseUrl$path" -Method $method -ContentType "application/json" -Body (Body $body) -WebSession $session
    }
    return Invoke-RestMethod -Uri "$BaseUrl$path" -Method $method -WebSession $session
}
function Visitor($method, $path, $body) {
    if ($null -ne $body) {
        return Invoke-RestMethod -Uri "$BaseUrl$path" -Method $method -ContentType "application/json" -Body (Body $body)
    }
    return Invoke-RestMethod -Uri "$BaseUrl$path" -Method $method
}

# ---- Visitor starts a chat --------------------------------------------------
$start = Visitor Post "/api/public/chat/start" @{ workspaceSlug = $slug; name = "Dana Visitor"; email = "dana@example.com" }
Check "Visitor start returns sessionId + token" ($start.sessionId -and $start.token)
$sid = $start.sessionId
$tok = $start.token

Visitor Post "/api/public/chat/$sid/messages?token=$tok" @{ body = "Hi, I need help with billing" } | Out-Null

# ---- Agent sees the active session and replies ------------------------------
$sessions = Agent Get "/api/chat/sessions"
Check "Agent sees the active session" (($sessions | Where-Object { $_.id -eq $sid }).Count -eq 1)
Agent Post "/api/chat/sessions/$sid/messages" @{ body = "Hi Dana, happy to help!" } | Out-Null

# First agent reply claims the session.
$sessions2 = Agent Get "/api/chat/sessions"
$claimed = $sessions2 | Where-Object { $_.id -eq $sid }
Check "First agent reply claims the session" ($claimed.agentId -eq $me.id)

# ---- Both sides see the full thread -----------------------------------------
$vThread = Visitor Get "/api/public/chat/$sid/messages?token=$tok"
$visitorMsgs = @($vThread.messages | Where-Object { $_.sender -ne 'system' })
Check "Visitor sees both messages in the thread" ($visitorMsgs.Count -ge 2)
Check "Message carries its sessionId (client routing)" ($vThread.messages[0].sessionId -eq $sid)

# ---- End the chat => ticket with the transcript -----------------------------
$end = Agent Post "/api/chat/sessions/$sid/end" $null
Check "Ending the chat files a ticket" ($null -ne $end.ticketId)
$ticketId = $end.ticketId

$ticket = Agent Get "/api/tickets/$ticketId"
Check "Ticket channel is 'chat'" ($ticket.channel -eq "chat")
$comments = Agent Get "/api/tickets/$ticketId/comments"
Check "Transcript replayed as comments (>= 2)" (@($comments).Count -ge 2)

# Ended session leaves the active list.
$after = Agent Get "/api/chat/sessions"
Check "Ended session is no longer active" (($after | Where-Object { $_.id -eq $sid }).Count -eq 0)

# Posting after end is rejected.
$rejected = $false
try { Visitor Post "/api/public/chat/$sid/messages?token=$tok" @{ body = "still there?" } | Out-Null }
catch { $rejected = ($_.Exception.Response.StatusCode.value__ -eq 404) }
Check "Posting to an ended chat is rejected" $rejected

# ---- Summary ----------------------------------------------------------------
Write-Host "`n----------------------------------------" -ForegroundColor Cyan
$color = if ($script:fail -eq 0) { "Green" } else { "Red" }
Write-Host " Phase 7C Live-chat verification: $script:pass passed, $script:fail failed" -ForegroundColor $color
if ($script:fail -gt 0) { exit 1 }
