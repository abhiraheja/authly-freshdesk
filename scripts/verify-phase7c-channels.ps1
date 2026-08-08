<#
  Phase 7C — Connectors verification (Slack/WhatsApp/Teams inbound pipeline).
  Configures a connector, then drives its webhook with correctly-signed payloads:
  new conversation -> ticket, follow-up -> threaded comment, retry -> dedup,
  bad signature -> 401.

  Prereqs:
    docker compose up -d
    dotnet run --project src/Trackly.Api --urls http://localhost:5210
  Then:
    powershell -File .\scripts\verify-phase7c-channels.ps1 -AdminEmail you@example.com

  Written for Windows PowerShell 5.1.
#>
param(
    [string]$BaseUrl = "http://localhost:5210",
    [Parameter(Mandatory = $true)][string]$AdminEmail,
    [string]$WorkspaceName = "Phase7C Channels QA",
    [string]$Provider = "slack",
    [string]$Secret = "connector-signing-secret-123"
)

$ErrorActionPreference = "Stop"
$script:pass = 0
$script:fail = 0

function Check([string]$name, [bool]$ok, [string]$detail = "") {
    if ($ok) { Write-Host "  PASS  $name" -ForegroundColor Green; $script:pass++ }
    else { Write-Host "  FAIL  $name  $detail" -ForegroundColor Red; $script:fail++ }
}
function Body([hashtable]$h) { $h | ConvertTo-Json -Depth 6 }

function HmacHex([string]$secret, [string]$body) {
    $h = New-Object System.Security.Cryptography.HMACSHA256
    $h.Key = [Text.Encoding]::UTF8.GetBytes($secret)
    $bytes = $h.ComputeHash([Text.Encoding]::UTF8.GetBytes($body))
    -join ($bytes | ForEach-Object { $_.ToString('x2') })
}

# Post an exact raw body with a signature header; returns @{ status; json }.
function PostRaw([string]$path, [string]$body, [string]$sig) {
    try {
        $r = Invoke-WebRequest -Uri "$BaseUrl$path" -Method Post -ContentType 'application/json' `
            -Headers @{ 'X-Trackly-Signature' = $sig } -Body $body -UseBasicParsing
        return @{ status = [int]$r.StatusCode; json = ($r.Content | ConvertFrom-Json) }
    }
    catch {
        return @{ status = [int]$_.Exception.Response.StatusCode.value__; json = $null }
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

# ---- Configure the connector ------------------------------------------------
$conn = Api Put "/api/admin/channels/$Provider" @{ enabled = $true; secret = $Secret }
Check "Connector enabled with a stored secret (write-only)" ($conn.enabled -eq $true -and $conn.hasSecret -eq $true)
$list = Api Get "/api/admin/channels"
Check "Connector list never returns the secret" (($list | Where-Object { $_.provider -eq $Provider }).hasSecret -eq $true -and -not ($list | Get-Member -Name secret))

$path = "/api/channels/inbound/$Provider/$slug"
$conv = "C-" + (Get-Random -Maximum 999999)

# ---- New conversation => new ticket -----------------------------------------
$m1 = "m1-" + (Get-Random -Maximum 999999)
$b1 = '{"conversationId":"' + $conv + '","messageId":"' + $m1 + '","senderId":"U777","senderName":"Dana Doe","text":"My order has not arrived"}'
$r1 = PostRaw $path $b1 (HmacHex $Secret $b1)
Check "Signed new message opens a ticket" ($r1.status -eq 200 -and $r1.json.outcome -eq "NewTicket" -and $r1.json.ticketId)
$ticketId = $r1.json.ticketId

if ($ticketId) {
    $t = Api Get "/api/tickets/$ticketId"
    Check "Ticket channel tagged as '$Provider'" ($t.channel -eq $Provider)
    Check "First message became the ticket subject/body" ($t.subject.Length -gt 0)
}

# ---- Follow-up on same conversation => threaded comment ----------------------
$m2 = "m2-" + (Get-Random -Maximum 999999)
$b2 = '{"conversationId":"' + $conv + '","messageId":"' + $m2 + '","senderId":"U777","senderName":"Dana Doe","text":"Any update?"}'
$r2 = PostRaw $path $b2 (HmacHex $Secret $b2)
Check "Follow-up threads into the same ticket as a comment" ($r2.json.outcome -eq "Comment" -and $r2.json.ticketId -eq $ticketId)

# ---- Retry of a delivered message => dedup ----------------------------------
$r2again = PostRaw $path $b2 (HmacHex $Secret $b2)
Check "Redelivered message is deduplicated" ($r2again.json.outcome -eq "Duplicate")

# ---- Bad signature => rejected ----------------------------------------------
$m3 = "m3-" + (Get-Random -Maximum 999999)
$b3 = '{"conversationId":"' + $conv + '","messageId":"' + $m3 + '","senderId":"U777","text":"tampered"}'
$rBad = PostRaw $path $b3 (HmacHex "the-wrong-secret" $b3)
Check "Invalid signature rejected (401)" ($rBad.status -eq 401)

# A different conversation opens a distinct ticket.
$conv2 = "C-" + (Get-Random -Maximum 999999)
$m4 = "m4-" + (Get-Random -Maximum 999999)
$b4 = '{"conversationId":"' + $conv2 + '","messageId":"' + $m4 + '","senderId":"U888","senderName":"Sam","text":"Different issue"}'
$r4 = PostRaw $path $b4 (HmacHex $Secret $b4)
Check "A new conversation opens a separate ticket" ($r4.json.outcome -eq "NewTicket" -and $r4.json.ticketId -ne $ticketId)

# ---- Summary ----------------------------------------------------------------
Write-Host "`n----------------------------------------" -ForegroundColor Cyan
$color = if ($script:fail -eq 0) { "Green" } else { "Red" }
Write-Host " Phase 7C Channels verification: $script:pass passed, $script:fail failed" -ForegroundColor $color
if ($script:fail -gt 0) { exit 1 }
