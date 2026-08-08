<#
  Phase 6 verification suite - problems, announcements, widget, dashboard stats.

  Prereqs:
    docker compose up -d
    dotnet run --project src/Trackly.Api --urls http://localhost:5210
  Then:
    powershell -File .\scripts\verify-phase6.ps1 -AdminEmail you@example.com

  With no SMTP configured, announcement sends go to the dev logger and still
  count as delivered. Written for Windows PowerShell 5.1.
#>
param(
    [string]$BaseUrl = "http://localhost:5210",
    [Parameter(Mandatory = $true)][string]$AdminEmail,
    [string]$WorkspaceName = "Phase6 QA"
)

$ErrorActionPreference = "Stop"
$script:pass = 0
$script:fail = 0

function Check([string]$name, [bool]$ok, [string]$detail = "") {
    if ($ok) { Write-Host "  PASS  $name" -ForegroundColor Green; $script:pass++ }
    else { Write-Host "  FAIL  $name  $detail" -ForegroundColor Red; $script:fail++ }
}

function Send-Api([string]$method, [string]$url, [string]$body, $session) {
    try {
        $resp = Invoke-WebRequest -Uri $url -Method $method -ContentType "application/json" `
            -Body $body -WebSession $session -UseBasicParsing
        return [pscustomobject]@{ Status = [int]$resp.StatusCode; Body = $resp.Content }
    }
    catch {
        $r = $_.Exception.Response
        if ($null -ne $r) {
            $sr = New-Object IO.StreamReader($r.GetResponseStream())
            return [pscustomobject]@{ Status = [int]$r.StatusCode; Body = $sr.ReadToEnd() }
        }
        throw
    }
}

# ---- Sign in ----------------------------------------------------------------
# Trackly is self-hosted: an empty installation is claimed once by POST /api/setup,
# which creates the workspace and signs its first admin straight in - there is no
# code to paste and no SMTP yet. Afterwards this is the ordinary magic-link flow.
Write-Host "`nSigning in as $AdminEmail ..." -ForegroundColor Cyan
if ((Invoke-RestMethod -Uri "$BaseUrl/api/setup/status").needsSetup) {
    Write-Host "Empty installation - running first-run setup as '$WorkspaceName'" -ForegroundColor Cyan
    Invoke-WebRequest -Uri "$BaseUrl/api/setup" -Method Post -ContentType "application/json" `
        -Body (@{ organisationName = $WorkspaceName; email = $AdminEmail; name = "QA Admin" } | ConvertTo-Json) `
        -SessionVariable session -UseBasicParsing | Out-Null
}
else {
    Invoke-RestMethod -Uri "$BaseUrl/api/auth/magic-link/send" -Method Post -ContentType "application/json" `
        -Body (@{ email = $AdminEmail } | ConvertTo-Json) | Out-Null
    $code = Read-Host "Paste the 6-digit code from the API console"
    Invoke-WebRequest -Uri "$BaseUrl/api/auth/magic-link/verify" -Method Post -ContentType "application/json" `
        -Body (@{ email = $AdminEmail; code = $code } | ConvertTo-Json) -SessionVariable session -UseBasicParsing | Out-Null
}
$me = Invoke-RestMethod -Uri "$BaseUrl/api/users/me" -WebSession $session
$slug = $me.workspace.slug
Check "Authenticated as admin" ($me.role -eq "admin") "role=$($me.role)"

# ---- Problems ---------------------------------------------------------------
$problem = Invoke-RestMethod -Uri "$BaseUrl/api/problems" -Method Post -ContentType "application/json" `
    -Body (@{ title = "Payment gateway down"; description = "Root cause TBD" } | ConvertTo-Json) -WebSession $session
Check "Problem created (investigating)" ($problem.status -eq "investigating")

$ticket = Invoke-RestMethod -Uri "$BaseUrl/api/tickets" -Method Post -ContentType "application/json" `
    -Body (@{ subject = "Can't pay"; description = "Checkout fails" } | ConvertTo-Json) -WebSession $session
Invoke-WebRequest -Uri "$BaseUrl/api/problems/$($problem.id)/tickets" -Method Post -ContentType "application/json" `
    -Body (@{ ticketId = $ticket.id } | ConvertTo-Json) -WebSession $session -UseBasicParsing | Out-Null
$detail = Invoke-RestMethod -Uri "$BaseUrl/api/problems/$($problem.id)" -WebSession $session
Check "Ticket linked to problem" ($detail.tickets.Count -eq 1 -and $detail.tickets[0].id -eq $ticket.id)

# Ticket detail exposes problemId to the agent.
$ticketDetail = Invoke-RestMethod -Uri "$BaseUrl/api/tickets/$($ticket.id)" -WebSession $session
Check "Agent ticket detail shows problemId" ($ticketDetail.problemId -eq $problem.id)

# Resolve problem + bulk-resolve tickets.
Invoke-WebRequest -Uri "$BaseUrl/api/problems/$($problem.id)/resolve" -Method Post -ContentType "application/json" `
    -Body (@{ bulkResolveTickets = $true } | ConvertTo-Json) -WebSession $session -UseBasicParsing | Out-Null
$resolvedTicket = Invoke-RestMethod -Uri "$BaseUrl/api/tickets/$($ticket.id)" -WebSession $session
Check "Bulk-resolve set linked ticket to resolved" ($resolvedTicket.status -eq "resolved")

# ---- Announcements ----------------------------------------------------------
$ann = Invoke-RestMethod -Uri "$BaseUrl/api/announcements" -Method Post -ContentType "application/json" `
    -Body (@{ type = "unplanned_outage"; subject = "We are investigating"; body = "Payments are degraded." } | ConvertTo-Json) -WebSession $session
Check "Announcement created (draft, not sent)" ($null -eq $ann.sentAt)

$badType = Send-Api "Post" "$BaseUrl/api/announcements" (@{ type = "nope"; subject = "x"; body = "y" } | ConvertTo-Json) $session
Check "Invalid announcement type rejected (400)" ($badType.Status -eq 400)

$sent = Invoke-RestMethod -Uri "$BaseUrl/api/announcements/$($ann.id)/send" -Method Post -WebSession $session
Check "Announcement send stamps sentAt" ($null -ne $sent.sentAt)

$resend = Send-Api "Post" "$BaseUrl/api/announcements/$($ann.id)/send" $null $session
Check "Re-sending an already-sent announcement is rejected (400)" ($resend.Status -eq 400)

# ---- Widget -----------------------------------------------------------------
$widget = Invoke-RestMethod -Uri "$BaseUrl/api/admin/widget" -Method Put -ContentType "application/json" `
    -Body (@{ embedType = "floating"; theme = "light"; fields = @{ fields = @("email", "subject", "description") } } | ConvertTo-Json) -WebSession $session
Check "Widget saved with snippet" ($widget.snippet -like "*widget.js*" -and $widget.embedType -eq "floating")

$pubWidget = Invoke-RestMethod -Uri "$BaseUrl/api/public/workspaces/$slug/widget"
Check "Public widget config is readable" ($pubWidget.embedType -eq "floating")

$js = Invoke-WebRequest -Uri "$BaseUrl/widget.js" -UseBasicParsing
Check "widget.js served as JavaScript" ($js.Headers["Content-Type"] -like "*javascript*" -and $js.Content -like "*data-workspace*")

# ---- Dashboard stats --------------------------------------------------------
$stats = Invoke-RestMethod -Uri "$BaseUrl/api/dashboard/stats" -WebSession $session
Check "Dashboard stats computed server-side" ($stats.total -ge 1 -and $stats.openProblems -ge 0)

# ---- Summary ----------------------------------------------------------------
Write-Host "`n----------------------------------------" -ForegroundColor Cyan
$color = if ($script:fail -eq 0) { "Green" } else { "Red" }
Write-Host " Phase 6 verification: $script:pass passed, $script:fail failed" -ForegroundColor $color
if ($script:fail -gt 0) { exit 1 }
