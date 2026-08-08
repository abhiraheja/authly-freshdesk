<#
  Phase 4 (Email) verification suite - run against a live API.

  Prereqs:
    docker compose up -d
    dotnet run --project src/Trackly.Api --urls http://localhost:5210
  Then, in a separate terminal:
    powershell -File .\scripts\verify-phase4.ps1 -AdminEmail you@example.com

  The API prints magic-link codes to its console (no SMTP configured), so this
  script pauses for you to paste the 6-digit code. Everything else is automated.

  It exercises the security-critical inbound pipeline over HTTP: HMAC auth,
  exactly-once dedup, participant enforcement, threading fallback, the
  new-ticket-via-email toggle, and that secrets are never returned. Written for
  Windows PowerShell 5.1.
#>
param(
    [string]$BaseUrl = "http://localhost:5210",
    [Parameter(Mandatory = $true)][string]$AdminEmail,
    [string]$WorkspaceName = "Phase4 QA"
)

$ErrorActionPreference = "Stop"
$script:pass = 0
$script:fail = 0

function Check([string]$name, [bool]$ok, [string]$detail = "") {
    if ($ok) {
        Write-Host "  PASS  $name" -ForegroundColor Green
        $script:pass++
    }
    else {
        Write-Host "  FAIL  $name  $detail" -ForegroundColor Red
        $script:fail++
    }
}

function HmacHex([string]$secret, [string]$body) {
    $mac = New-Object System.Security.Cryptography.HMACSHA256
    $mac.Key = [Text.Encoding]::UTF8.GetBytes($secret)
    $bytes = $mac.ComputeHash([Text.Encoding]::UTF8.GetBytes($body))
    ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
}

# Cross-status HTTP call: returns @{ Status; Body } instead of throwing on 4xx/5xx.
function Send-Api([string]$method, [string]$url, [string]$body, $headers, $session) {
    try {
        $resp = Invoke-WebRequest -Uri $url -Method $method -ContentType "application/json" `
            -Body $body -Headers $headers -WebSession $session -UseBasicParsing
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

# ---- Configure email: parse webhook, two-way, known secret ------------------
$secret = "whsec_" + [Guid]::NewGuid().ToString("N")
$replyDomain = "tickets.$slug.local"
$cfg = @{
    useSharedSmtp      = $true
    smtpUseStartTls    = $true
    fromName           = "QA Support"
    fromEmail          = "support@$slug.local"
    emailMode          = "two_way"
    newTicketViaEmail  = $false
    inboundConnector   = "parse_webhook"
    inboundProvider    = "mailgun"
    inboundReplyDomain = $replyDomain
    inboundWebhookSecret = $secret
}
$saved = Invoke-RestMethod -Uri "$BaseUrl/api/admin/settings/email" -Method Put -ContentType "application/json" `
    -Body ($cfg | ConvertTo-Json) -WebSession $session
Check "Email config saved two_way parse_webhook" ($saved.emailMode -eq "two_way" -and $saved.inboundConnector -eq "parse_webhook")
Check "Secret not returned, only hasInboundWebhookSecret" `
    ($saved.hasInboundWebhookSecret -eq $true -and ($saved.PSObject.Properties.Name -notcontains "inboundWebhookSecret"))

# ---- Create a ticket to reply to --------------------------------------------
$ticket = Invoke-RestMethod -Uri "$BaseUrl/api/tickets" -Method Post -ContentType "application/json" `
    -Body (@{ subject = "Printer offline"; description = "It will not print." } | ConvertTo-Json) -WebSession $session
$tid = $ticket.id
$tidN = ([Guid]$tid).ToString("N")

function PostWebhook($payloadObj, [string]$secretForSig) {
    $raw = $payloadObj | ConvertTo-Json -Compress
    $sig = HmacHex $secretForSig $raw
    return Send-Api "Post" "$BaseUrl/api/email/inbound/$slug" $raw @{ "X-Trackly-Signature" = $sig } $session
}
function CommentCount() {
    return (Invoke-RestMethod -Uri "$BaseUrl/api/tickets/$tid/comments" -WebSession $session).Count
}

# ---- Signed inbound reply from the requester -> comment ---------------------
$msgId = "reply-1-" + [Guid]::NewGuid().ToString("N") + "@mail.local"
$reply = @{
    messageId = $msgId
    from      = $AdminEmail
    fromName  = "QA Admin"
    to        = "reply+$tidN@$replyDomain"
    subject   = "Re: Printer offline"
    text      = "Still broken today.`nOn Mon, Support wrote:`n> have you tried restarting?"
}
$r1 = PostWebhook $reply $secret
$r1b = $r1.Body | ConvertFrom-Json
Check "Signed reply accepted -> comment" ($r1.Status -eq 200 -and $r1b.outcome -eq "comment")

$comments = Invoke-RestMethod -Uri "$BaseUrl/api/tickets/$tid/comments" -WebSession $session
Check "Comment appears, source=email" (($comments | Where-Object { $_.source -eq "email" }).Count -ge 1)
Check "Quoted history stripped" (($comments | Where-Object { $_.body -like "*Still broken*" -and $_.body -notlike "*have you tried*" }).Count -ge 1)

# ---- Exactly-once: same Message-ID again -> ignored -------------------------
$before = CommentCount
$r2 = (PostWebhook $reply $secret).Body | ConvertFrom-Json
$after = CommentCount
Check "Duplicate Message-ID ignored (exactly-once)" ($r2.outcome -eq "ignored" -and $after -eq $before)

# ---- Invalid signature -> 401 ----------------------------------------------
$bad = PostWebhook @{ messageId = "x@mail.local"; from = $AdminEmail; to = "reply+$tidN@$replyDomain"; subject = "x"; text = "x" } "wrong-secret"
Check "Invalid HMAC rejected (401)" ($bad.Status -eq 401)

# ---- Non-participant sender -> rejected, no comment ------------------------
$before = CommentCount
$intruder = @{ messageId = "intru-" + [Guid]::NewGuid().ToString("N") + "@mail.local"; from = "stranger@evil.example"; to = "reply+$tidN@$replyDomain"; subject = "Re: Printer"; text = "injecting" }
$r3 = (PostWebhook $intruder $secret).Body | ConvertFrom-Json
$after = CommentCount
Check "Non-participant reply rejected, no comment" ($r3.outcome -eq "rejected" -and $after -eq $before)

# ---- Threading fallback: mangled To, References carries our Message-ID -----
$agentReply = Invoke-RestMethod -Uri "$BaseUrl/api/tickets/$tid/comments" -Method Post -ContentType "application/json" `
    -Body (@{ body = "We are looking into it." } | ConvertTo-Json) -WebSession $session
$refId = "$tidN." + ($agentReply.id.ToString().Replace("-", "")) + "@trackly"
$fallback = @{
    messageId  = "fb-" + [Guid]::NewGuid().ToString("N") + "@mail.local"
    from       = $AdminEmail
    to         = "support@$replyDomain"
    subject    = "Re: Printer offline"
    text       = "Thanks for the update."
    references = @("<$refId>")
}
$r4 = (PostWebhook $fallback $secret).Body | ConvertFrom-Json
Check "Threading fallback via References resolves ticket" ($r4.outcome -eq "comment" -and $r4.ticketId -eq $tid)

# ---- new_ticket_via_email toggle -------------------------------------------
$cfg.newTicketViaEmail = $false
Invoke-RestMethod -Uri "$BaseUrl/api/admin/settings/email" -Method Put -ContentType "application/json" `
    -Body ($cfg | ConvertTo-Json) -WebSession $session | Out-Null
$cold = @{ messageId = "cold-" + [Guid]::NewGuid().ToString("N") + "@mail.local"; from = "newcustomer@example.com"; to = "support@$replyDomain"; subject = "Need help"; text = "brand new issue" }
$r5 = (PostWebhook $cold $secret).Body | ConvertFrom-Json
Check "Cold email ignored when toggle off" ($r5.outcome -eq "ignored")

$cfg.newTicketViaEmail = $true
Invoke-RestMethod -Uri "$BaseUrl/api/admin/settings/email" -Method Put -ContentType "application/json" `
    -Body ($cfg | ConvertTo-Json) -WebSession $session | Out-Null
$cold.messageId = "cold2-" + [Guid]::NewGuid().ToString("N") + "@mail.local"
$r6 = (PostWebhook $cold $secret).Body | ConvertFrom-Json
Check "Cold email creates ticket when toggle on" ($r6.outcome -eq "new_ticket" -and $null -ne $r6.ticketId)
if ($r6.ticketId) {
    $newTicket = Invoke-RestMethod -Uri "$BaseUrl/api/tickets/$($r6.ticketId)" -WebSession $session
    Check "New email ticket has channel=email + guest requester" `
        ($newTicket.channel -eq "email" -and $newTicket.guestEmail -eq "newcustomer@example.com")
}

# ---- Summary ----------------------------------------------------------------
Write-Host "`n----------------------------------------" -ForegroundColor Cyan
$color = if ($script:fail -eq 0) { "Green" } else { "Red" }
Write-Host " Phase 4 verification: $script:pass passed, $script:fail failed" -ForegroundColor $color
if ($script:fail -gt 0) { exit 1 }
