<#
  Widget phase 3 - conversation list, thread, reply, attachments, unread.

  Covers docs/widget-plan.md § 10 phase 3. Its done-when is one sentence:

      "Two browsers with different visitor tokens cannot see each other's
       conversations - asserted by test."

  So most of this file is that sentence taken apart. The trust rule (§ 3.3) has
  two halves and both are checked: an UNVERIFIED visitor sees only what their own
  browser raised, and a VERIFIED one sees everything belonging to their contact -
  including tickets that never came through a widget at all. Everything else here
  is the machinery around it: private notes staying invisible (invariant 5),
  unread counts that clear and stay cleared, and attachments that only their own
  conversation can fetch.

  Prereqs:
    docker compose up -d
    dotnet run --project src/Trackly.Api --urls http://localhost:5210
  Then:
    powershell -File .\scripts\verify-widget-phase3.ps1 -AdminEmail you@example.com

  Written for Windows PowerShell 5.1.
#>
param(
    [string]$BaseUrl = "http://localhost:5210",
    [Parameter(Mandatory = $true)][string]$AdminEmail,
    [string]$WorkspaceName = "Widget QA",
    # See verify-widget-phase1.ps1: an existing trackly.session cookie, for
    # installs whose SMTP delivers to a real mailbox instead of the console.
    [string]$SessionToken,
    # Used by the one assertion that needs a ticket to be older than it is.
    [string]$PostgresContainer = "trackly-postgres"
)

$ErrorActionPreference = "Stop"
$script:pass = 0
$script:fail = 0

function Check([string]$name, [bool]$ok, [string]$detail = "") {
    if ($ok) { Write-Host "  PASS  $name" -ForegroundColor Green; $script:pass++ }
    else { Write-Host "  FAIL  $name  $detail" -ForegroundColor Red; $script:fail++ }
}
function Body($h) { $h | ConvertTo-Json -Depth 8 }

# ---- Sign in (admin, to play the agent) --------------------------------------
Write-Host "`nSigning in as $AdminEmail ..." -ForegroundColor Cyan
if ($SessionToken) {
    $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    $session.Cookies.Add((New-Object System.Net.Cookie("trackly.session", $SessionToken, "/", ([Uri]$BaseUrl).Host)))
}
elseif ((Invoke-RestMethod -Uri "$BaseUrl/api/setup/status").needsSetup) {
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
Check "Authenticated as admin" ($me.role -eq "admin")

function Api($method, $path, $body) {
    if ($null -ne $body) {
        return Invoke-RestMethod -Uri "$BaseUrl$path" -Method $method -ContentType "application/json" -Body (Body $body) -WebSession $session
    }
    return Invoke-RestMethod -Uri "$BaseUrl$path" -Method $method -WebSession $session
}

# ---- Public (no session) helpers --------------------------------------------
function PubRaw($method, $path, $body, $visitor, $origin) {
    $headers = @{}
    if ($visitor) { $headers["X-Trackly-Visitor"] = $visitor }
    if ($origin) { $headers["Origin"] = $origin }
    $args = @{ Uri = "$BaseUrl$path"; Method = $method; Headers = $headers }
    if ($null -ne $body) { $args["ContentType"] = "application/json"; $args["Body"] = (Body $body) }
    return Invoke-RestMethod @args
}

# Same reasoning as phase 2: the write endpoints carry the "auth" policy at 20
# requests per minute per IP, and this script makes more than a real visitor ever
# would. Wait the window out rather than loosening a limit that is doing its job.
function Pub($method, $path, $body, $visitor, $origin) {
    try { return PubRaw $method $path $body $visitor $origin }
    catch {
        if ($_.Exception.Response.StatusCode.value__ -ne 429) { throw }
        Write-Host "  (rate limited - waiting out the 1-minute window)" -ForegroundColor DarkGray
        Start-Sleep -Seconds 61
        return PubRaw $method $path $body $visitor $origin
    }
}
function PubStatus($method, $path, $body, $visitor, $origin) {
    try { Pub $method $path $body $visitor $origin | Out-Null; return 0 }
    catch { return $_.Exception.Response.StatusCode.value__ }
}

# ---- JWT helpers (the host page's side) --------------------------------------
function B64Url([byte[]]$bytes) {
    [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}
function MakeJwt([string]$secret, [hashtable]$payload) {
    $h = B64Url ([Text.Encoding]::UTF8.GetBytes((@{ alg = "HS256"; typ = "JWT" } | ConvertTo-Json -Compress)))
    $p = B64Url ([Text.Encoding]::UTF8.GetBytes(($payload | ConvertTo-Json -Compress)))
    $hmac = New-Object System.Security.Cryptography.HMACSHA256
    $hmac.Key = [Text.Encoding]::UTF8.GetBytes($secret)
    return "$h.$p." + (B64Url ($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes("$h.$p"))))
}
function Unix([int]$m) { [DateTimeOffset]::UtcNow.AddMinutes($m).ToUnixTimeSeconds() }

# ---- Fixtures ----------------------------------------------------------------
Write-Host "`nSetting up two browsers on one widget ..." -ForegroundColor Cyan
$stamp = (Get-Date).ToString("HHmmss")
$created = Api Post "/api/admin/widgets" @{ name = "Phase3 $stamp"; greeting = "Hi there!" }
$widget = $created.widget
$secret = $created.secretKey
$tok = $widget.publicToken
Check "Widget created" ($null -ne $tok)

# Browser A - anonymous, then names itself. A claim, never a proof.
$a = Pub Post "/api/public/widget/$tok/session" @{} $null $null
$va = $a.visitorToken
Pub Patch "/api/public/widget/$tok/session" @{ name = "Ann Anonymous"; mail = "ann-$stamp@claimed.example" } $va $null | Out-Null

# Browser B - a different browser entirely, claiming the SAME email address.
# This is the attack the trust rule exists for: typing someone's address must not
# open their history.
$b = Pub Post "/api/public/widget/$tok/session" @{} $null $null
$vb = $b.visitorToken
Pub Patch "/api/public/widget/$tok/session" @{ name = "Bob Bystander"; mail = "ann-$stamp@claimed.example" } $vb $null | Out-Null
Check "Two visitors, two tokens" ($a.visitorId -ne $b.visitorId)

$ca = Pub Post "/api/public/widget/$tok/conversations" @{ message = "Browser A: my printer is offline" } $va $null
$cb = Pub Post "/api/public/widget/$tok/conversations" @{ message = "Browser B: the VPN keeps dropping" } $vb $null
Check "Both browsers raised a conversation" ($ca.id -and $cb.id -and $ca.id -ne $cb.id)

# ---- The done-when -----------------------------------------------------------
Write-Host "`nDone-when: two browsers cannot see each other ..." -ForegroundColor Cyan

$listA = @(Pub Get "/api/public/widget/$tok/conversations" $null $va $null)
$listB = @(Pub Get "/api/public/widget/$tok/conversations" $null $vb $null)
Check "Browser A sees exactly its own conversation" ($listA.Count -eq 1 -and $listA[0].id -eq $ca.id)
Check "Browser B sees exactly its own conversation" ($listB.Count -eq 1 -and $listB[0].id -eq $cb.id)
Check "A cannot open B's thread (404)" `
    ((PubStatus Get "/api/public/widget/$tok/conversations/$($cb.id)" $null $va $null) -eq 404)
Check "B cannot open A's thread (404)" `
    ((PubStatus Get "/api/public/widget/$tok/conversations/$($ca.id)" $null $vb $null) -eq 404)
Check "A cannot reply into B's thread (404)" `
    ((PubStatus Post "/api/public/widget/$tok/conversations/$($cb.id)/messages" @{ message = "hello?" } $va $null) -eq 404)
Check "A cannot mark B's thread read (404)" `
    ((PubStatus Post "/api/public/widget/$tok/conversations/$($cb.id)/read" $null $va $null) -eq 404)
Check "A claimed email address buys nothing" `
    ($listB.Count -eq 1) "both browsers claimed ann-$stamp@claimed.example"

Check "No visitor token, no list (404)" `
    ((PubStatus Get "/api/public/widget/$tok/conversations" $null $null $null) -eq 404)
Check "A junk visitor token is not a session (404)" `
    ((PubStatus Get "/api/public/widget/$tok/conversations" $null "not-a-real-visitor-token" $null) -eq 404)

# ---- Cross-widget isolation ---------------------------------------------------
Write-Host "`nCross-widget isolation ..." -ForegroundColor Cyan

$other = (Api Post "/api/admin/widgets" @{ name = "Other $stamp" }).widget
Check "A visitor token from one widget lists nothing on another (404)" `
    ((PubStatus Get "/api/public/widget/$($other.publicToken)/conversations" $null $va $null) -eq 404)
Check "...and cannot open a thread there either (404)" `
    ((PubStatus Get "/api/public/widget/$($other.publicToken)/conversations/$($ca.id)" $null $va $null) -eq 404)

# ---- The thread --------------------------------------------------------------
Write-Host "`nThread ..." -ForegroundColor Cyan

$threadA = Pub Get "/api/public/widget/$tok/conversations/$($ca.id)" $null $va $null
Check "The thread opens" ($threadA.id -eq $ca.id)
Check "The opening message is the first message" `
    ($threadA.messages.Count -ge 1 -and $threadA.messages[0].body -like "Browser A: my printer*")
Check "The opening message is not from an agent" ($threadA.messages[0].fromAgent -eq $false)
Check "It is attributed to the visitor" ($threadA.messages[0].authorName -eq "Ann Anonymous")
Check "The thread carries a reference" ($threadA.reference -like "#*")
Check "A fresh thread has nothing unread" ($threadA.unreadCount -eq 0)

# ---- Private notes never reach the panel (invariant 5) -----------------------
Write-Host "`nPrivate notes ..." -ForegroundColor Cyan

Api Post "/api/tickets/$($ca.id)/comments" @{ body = "Internal: customer is on the free plan, deprioritise"; isInternal = $true } | Out-Null
$threadA = Pub Get "/api/public/widget/$tok/conversations/$($ca.id)" $null $va $null
$leakedNote = @($threadA.messages | Where-Object { $_.body -like "*deprioritise*" })
Check "An internal note never appears in the thread" ($leakedNote.Count -eq 0)
Check "...and does not count as unread" ($threadA.unreadCount -eq 0)

$listA = @(Pub Get "/api/public/widget/$tok/conversations" $null $va $null)
Check "...and never becomes the list preview" ($listA[0].preview -notlike "*deprioritise*")
Check "The message shape has nowhere to put isInternal" `
    (-not ($threadA.messages[0].PSObject.Properties.Name -contains "isInternal"))

# ---- Unread ------------------------------------------------------------------
Write-Host "`nUnread counts ..." -ForegroundColor Cyan

Api Post "/api/tickets/$($ca.id)/comments" @{ body = "<p>We are on it &mdash; can you send a photo of the display?</p>"; isInternal = $false; bodyFormat = "html" } | Out-Null
$listA = @(Pub Get "/api/public/widget/$tok/conversations" $null $va $null)
Check "An agent reply counts as unread" ($listA[0].unreadCount -eq 1)
Check "The row says the agent sent it" ($listA[0].lastFromAgent -eq $true -and $listA[0].lastSenderName)
Check "An HTML reply is flattened for the preview" `
    ($listA[0].preview -like "*send a photo*" -and $listA[0].preview -notlike "*<p>*")

Api Post "/api/tickets/$($ca.id)/comments" @{ body = "Any luck with that photo?"; isInternal = $false } | Out-Null
$listA = @(Pub Get "/api/public/widget/$tok/conversations" $null $va $null)
Check "Two agent replies count as two" ($listA[0].unreadCount -eq 2)

Check "The read receipt is accepted" `
    ((PubStatus Post "/api/public/widget/$tok/conversations/$($ca.id)/read" $null $va $null) -eq 0)
$listA = @(Pub Get "/api/public/widget/$tok/conversations" $null $va $null)
Check "Reading the thread clears the badge" ($listA[0].unreadCount -eq 0)

$listB = @(Pub Get "/api/public/widget/$tok/conversations" $null $vb $null)
Check "One browser's read receipt does not clear another's" ($listB[0].unreadCount -eq 0) "B has its own thread"

# ---- Replying ----------------------------------------------------------------
Write-Host "`nReplying ..." -ForegroundColor Cyan

Check "An empty reply is refused (400)" `
    ((PubStatus Post "/api/public/widget/$tok/conversations/$($ca.id)/messages" @{ message = "   " } $va $null) -eq 400)

$reply = Pub Post "/api/public/widget/$tok/conversations/$($ca.id)/messages" @{ message = "Here is the photo you asked for" } $va $null
Check "The reply is created" ($null -ne $reply.id)
Check "...attributed to the visitor, not an agent" ($reply.fromAgent -eq $false -and $reply.authorName -eq "Ann Anonymous")
Check "...and is plain text whatever was sent" ($reply.bodyFormat -eq "text")

$agentView = Api Get "/api/tickets/$($ca.id)/comments"
$onTicket = @($agentView | Where-Object { $_.body -like "*photo you asked for*" })
Check "The agent sees the widget reply on the ticket" ($onTicket.Count -eq 1)
Check "...as a public comment" ($onTicket[0].isInternal -eq $false)

$listA = @(Pub Get "/api/public/widget/$tok/conversations" $null $va $null)
Check "Your own reply does not make your own thread unread" ($listA[0].unreadCount -eq 0)
Check "The row preview follows the last message" ($listA[0].preview -like "*photo you asked for*")
Check "...and says it was you" ($listA[0].lastFromAgent -eq $false)

# Markup from an anonymous caller is never stored as markup: the widget would
# otherwise be the softest way into every agent's screen.
$xss = Pub Post "/api/public/widget/$tok/conversations/$($ca.id)/messages" @{ message = "<img src=x onerror=alert(1)>" } $va $null
Check "Markup from the panel stays plain text" ($xss.bodyFormat -eq "text" -and $xss.body -like "*<img*")

# ---- Attachments -------------------------------------------------------------
Write-Host "`nAttachments ..." -ForegroundColor Cyan

$tmp = Join-Path $env:TEMP "widget-phase3-$stamp.txt"
"printer display reads E-04" | Out-File -FilePath $tmp -Encoding ascii

function UploadFile($path, $conversationId, $visitorToken) {
    # PS 5.1 has no -Form, so the multipart body is assembled by hand.
    $boundary = [Guid]::NewGuid().ToString()
    $bytes = [IO.File]::ReadAllBytes($path)
    $content = [Text.Encoding]::GetEncoding("iso-8859-1").GetString($bytes)
    $lf = "`r`n"
    $body = "--$boundary$lf" +
            "Content-Disposition: form-data; name=`"file`"; filename=`"$(Split-Path $path -Leaf)`"$lf" +
            "Content-Type: text/plain$lf$lf" +
            "$content$lf--$boundary--$lf"
    return Invoke-RestMethod -Uri "$BaseUrl/api/public/widget/$tok/conversations/$conversationId/attachments" `
        -Method Post -ContentType "multipart/form-data; boundary=$boundary" `
        -Headers @{ "X-Trackly-Visitor" = $visitorToken } -Body $body
}

$att = UploadFile $tmp $ca.id $va
Check "A file uploads onto the conversation" ($null -ne $att.id -and $att.fileName -like "widget-phase3-*")

$threadA = Pub Get "/api/public/widget/$tok/conversations/$($ca.id)" $null $va $null
$withFile = @($threadA.messages | Where-Object { $_.attachments.Count -gt 0 })
Check "The attachment comes back on the thread" ($withFile.Count -ge 1)

$dl = "/api/public/widget/$tok/conversations/$($ca.id)/attachments/$($att.id)"
Check "The owner can download it" ((PubStatus Get $dl $null $va $null) -eq 0)
Check "Another browser cannot (404)" ((PubStatus Get $dl $null $vb $null) -eq 404)
Check "Nor can an anonymous caller (404)" ((PubStatus Get $dl $null $null $null) -eq 404)
Remove-Item $tmp -Force -ErrorAction SilentlyContinue

# ---- Verified: the wider half of the trust rule ------------------------------
Write-Host "`nVerified visitors see the whole contact ..." -ForegroundColor Cyan

$proofEmail = "vera-$stamp@acme-customer.example"
$jwt = MakeJwt $secret @{ unique_id = $proofEmail; email = $proofEmail; name = "Vera Verified"; exp = (Unix 10) }
$v = Pub Post "/api/public/widget/$tok/session" @{ token = $jwt } $null $null
$vv = $v.visitorToken
Check "A signed token verifies the visitor" ($v.isVerified -eq $true)

$contact = @((Api Get "/api/users?role=customer") | Where-Object { $_.email -eq $proofEmail })
$contactId = $contact[0].id

# A ticket that never touched the widget. A verified visitor must see it: that is
# what "everything belonging to that contact" means.
$emailTicket = Api Post "/api/tickets" @{
    subject = "Raised by phone, logged by an agent"
    description = "Vera called about her invoice"
    requesterId = $contactId
}
$cv = Pub Post "/api/public/widget/$tok/conversations" @{ message = "And my laptop will not charge" } $vv $null

$listV = @(Pub Get "/api/public/widget/$tok/conversations" $null $vv $null)
$ids = @($listV | ForEach-Object { $_.id })
Check "A verified visitor sees their widget conversation" ($ids -contains $cv.id)
Check "...and a ticket raised on another channel entirely" ($ids -contains $emailTicket.id)
Check "...and still nothing belonging to anyone else" (-not ($ids -contains $ca.id))
Check "The agent-logged ticket opens in the panel" `
    ((PubStatus Get "/api/public/widget/$tok/conversations/$($emailTicket.id)" $null $vv $null) -eq 0)

# A second browser for the same proven person - the laptop and the phone.
$jwt2 = MakeJwt $secret @{ unique_id = $proofEmail; email = $proofEmail; name = "Vera Verified"; exp = (Unix 10) }
$v2 = Pub Post "/api/public/widget/$tok/session" @{ token = $jwt2 } $null $null
$vv2 = $v2.visitorToken
Check "The same person on a second device is a second visitor" ($v2.visitorId -ne $v.visitorId)
$listV2 = @(Pub Get "/api/public/widget/$tok/conversations" $null $vv2 $null)
Check "...who sees the same conversations" (@($listV2 | ForEach-Object { $_.id }) -contains $cv.id)

Api Post "/api/tickets/$($cv.id)/comments" @{ body = "Try a different charger and let us know"; isInternal = $false } | Out-Null
Pub Post "/api/public/widget/$tok/conversations/$($cv.id)/read" $null $vv $null | Out-Null
$rowOnDevice1 = @(@(Pub Get "/api/public/widget/$tok/conversations" $null $vv $null) | Where-Object { $_.id -eq $cv.id })
$rowOnDevice2 = @(@(Pub Get "/api/public/widget/$tok/conversations" $null $vv2 $null) | Where-Object { $_.id -eq $cv.id })
Check "Reading on one device clears that device" `
    ($rowOnDevice1.Count -eq 1 -and $rowOnDevice1[0].unreadCount -eq 0) "got $($rowOnDevice1.Count) row(s)"
Check "...and leaves the other device's badge alone" `
    ($rowOnDevice2.Count -eq 1 -and $rowOnDevice2[0].unreadCount -eq 1) "unread=$($rowOnDevice2[0].unreadCount)"

# ---- The 30-day window -------------------------------------------------------
Write-Host "`nClosed conversations drop off after 30 days ..." -ForegroundColor Cyan

$statuses = Api Get "/api/ticket-statuses"
$resolved = @($statuses | Where-Object { $_.category -eq "resolved" -and $_.isActive })[0]
$resolvedOk = $false
if ($resolved) {
    # The workflow may refuse the transition (TicketResolveGuard, blocking tasks).
    # That is a different feature's business, so it downgrades to a skip here.
    # The resolution note is not optional (TicketResolveGuard) - resolving without
    # saying what was fixed is refused, which is a different feature working.
    try {
        Api Patch "/api/tickets/$($emailTicket.id)" `
            @{ status = $resolved.value; resolutionNote = "Replaced the charger" } | Out-Null
        $resolvedOk = $true
    }
    catch { Write-Host "  (could not resolve the ticket: $($_.Exception.Message))" -ForegroundColor Yellow }
}
if ($resolvedOk) {
    $row = @(@(Pub Get "/api/public/widget/$tok/conversations" $null $vv $null) | Where-Object { $_.id -eq $emailTicket.id })
    Check "A just-resolved conversation is still listed" ($row.Count -eq 1)
    Check "...and reports its category, not just its status" ($row.Count -eq 1 -and $row[0].statusCategory -eq "resolved")

    # The only way to test "older than 30 days" without waiting 30 days.
    $sql = "UPDATE tickets SET updated_at = now() - interval '40 days' WHERE id = '$($emailTicket.id)';"
    docker exec $PostgresContainer psql -U trackly -d trackly -c $sql | Out-Null
    if ($LASTEXITCODE -eq 0) {
        $listV = @(Pub Get "/api/public/widget/$tok/conversations" $null $vv $null)
        $ids = @($listV | ForEach-Object { $_.id })
        Check "A resolved conversation older than 30 days drops off" (-not ($ids -contains $emailTicket.id))
        Check "...while open ones stay whatever their age" ($ids -contains $cv.id)

        # An open ticket must never fall out of the list on age alone.
        docker exec $PostgresContainer psql -U trackly -d trackly `
            -c "UPDATE tickets SET updated_at = now() - interval '400 days' WHERE id = '$($cv.id)';" | Out-Null
        $ids = @((Pub Get "/api/public/widget/$tok/conversations" $null $vv $null) | ForEach-Object { $_.id })
        Check "A year-old OPEN conversation is still listed" ($ids -contains $cv.id)
    }
    else {
        Write-Host "  (skipped the 30-day window - no $PostgresContainer container)" -ForegroundColor Yellow
    }
}
else {
    Write-Host "  (skipped the 30-day window - could not resolve a ticket)" -ForegroundColor Yellow
}

# ---- Realtime ----------------------------------------------------------------
Write-Host "`nRealtime hub ..." -ForegroundColor Cyan

# The panel polls as well, so this is a latency feature, not a correctness one.
# What is asserted is that the endpoint exists and refuses a plain GET the way a
# SignalR endpoint does - a full socket handshake is beyond PS 5.1.
$negotiate = try {
    (Invoke-WebRequest -Uri "$BaseUrl/hubs/widget/negotiate?negotiateVersion=1&widget=$tok&visitorToken=$va" `
        -Method Post -UseBasicParsing).StatusCode
}
catch { $_.Exception.Response.StatusCode.value__ }
Check "The widget hub is mapped and negotiates" ($negotiate -eq 200)

# ---- Summary -----------------------------------------------------------------
Write-Host "`n----------------------------------------" -ForegroundColor Cyan
$color = if ($script:fail -eq 0) { "Green" } else { "Red" }
Write-Host " Widget phase 3 verification: $script:pass passed, $script:fail failed" -ForegroundColor $color
Write-Host " Clean up with: DELETE /api/admin/widgets/$($widget.id) and /$($other.id)" -ForegroundColor DarkGray
if ($script:fail -gt 0) { exit 1 }
