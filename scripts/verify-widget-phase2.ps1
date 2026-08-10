<#
  Widget phase 2 - public config + visitor sessions + contacts + conversations.

  Covers docs/widget-plan.md § 10 phase 2. The centre of it is the trust rule
  (§ 3.3): a name and an email typed into a form are a CLAIM, and only a JWT
  signed with the widget's secret - or a confirmed email code - turns a visitor
  into a contact. Most of the assertions below exist to prove the claimed path
  never quietly becomes the proven one.

  The "done when" clause is the last block: a widget ticket raised by a verified
  visitor shows up on the Customer Detail screen's ticket counts with no UI
  change.

  Prereqs:
    docker compose up -d
    dotnet run --project src/Trackly.Api --urls http://localhost:5210
  Then:
    powershell -File .\scripts\verify-widget-phase2.ps1 -AdminEmail you@example.com

  Written for Windows PowerShell 5.1.
#>
param(
    [string]$BaseUrl = "http://localhost:5210",
    [Parameter(Mandatory = $true)][string]$AdminEmail,
    [string]$WorkspaceName = "Widget QA",
    # See verify-widget-phase1.ps1: an existing trackly.session cookie, for
    # installs whose SMTP delivers to a real mailbox instead of the console.
    [string]$SessionToken
)

$ErrorActionPreference = "Stop"
$script:pass = 0
$script:fail = 0

function Check([string]$name, [bool]$ok, [string]$detail = "") {
    if ($ok) { Write-Host "  PASS  $name" -ForegroundColor Green; $script:pass++ }
    else { Write-Host "  FAIL  $name  $detail" -ForegroundColor Red; $script:fail++ }
}
function Body($h) { $h | ConvertTo-Json -Depth 8 }

# ---- Sign in (admin, to create the widget under test) ------------------------
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
# The panel talks to the API with no cookie at all: the widget token is in the
# URL and the visitor token rides in a header.
function PubRaw($method, $path, $body, $visitor, $origin) {
    $headers = @{}
    if ($visitor) { $headers["X-Trackly-Visitor"] = $visitor }
    if ($origin) { $headers["Origin"] = $origin }
    $args = @{ Uri = "$BaseUrl$path"; Method = $method; Headers = $headers }
    if ($null -ne $body) { $args["ContentType"] = "application/json"; $args["Body"] = (Body $body) }
    return Invoke-RestMethod @args
}

# The session and conversation endpoints carry the "auth" rate-limit policy - 20
# requests per minute per IP. A real visitor makes three or four of these in a
# sitting; this script makes twenty-odd, so it trips the limiter near the end and
# would report a false failure. Wait out the window and retry once, rather than
# loosening a limit that is doing its job.
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

# ---- The widget under test ---------------------------------------------------
Write-Host "`nCreating the widget under test ..." -ForegroundColor Cyan
$stamp = (Get-Date).ToString("HHmmss")
$created = Api Post "/api/admin/widgets" @{
    name = "Phase2 $stamp"; tagline = "Ask us anything"; greeting = "Hi there!"; primaryColor = "#1c65d4"
}
$widget = $created.widget
$secret = $created.secretKey
$tok = $widget.publicToken
Check "Widget created with a public token" ($tok -and $secret)

# ---- Config ------------------------------------------------------------------
Write-Host "`nPublic config ..." -ForegroundColor Cyan

$cfg = Pub Get "/api/public/widget/$tok/config" $null $null $null
Check "Config resolves by public token, no session" ($cfg.name -eq "Phase2 $stamp")
Check "Widget colour overrides the workspace's" ($cfg.primaryColor -eq "#1c65d4")
Check "Greeting and tagline are returned" ($cfg.greeting -eq "Hi there!" -and $cfg.tagline -eq "Ask us anything")
Check "Launch defaults are returned" ($cfg.showWidgetForm -eq $true -and $cfg.showCloseButton -eq $true)
Check "Config carries no secret" (-not ($cfg | Get-Member -Name "secret*"))
$leaked = @($cfg.PSObject.Properties.Name | Where-Object { $_ -in @("workspaceId", "slug", "teamId") })
Check "Config never echoes a workspace id, slug or team id" ($leaked.Count -eq 0) "leaked: $($leaked -join ', ')"
Check "Unknown token is 404" ((PubStatus Get "/api/public/widget/not-a-real-token/config" $null $null $null) -eq 404)

# An inactive widget is invisible to the public surface, which is what makes the
# admin's Active switch mean anything.
Api Put "/api/admin/widgets/$($widget.id)" @{ isActive = $false } | Out-Null
Check "Deactivated widget is 404 publicly" ((PubStatus Get "/api/public/widget/$tok/config" $null $null $null) -eq 404)
Api Put "/api/admin/widgets/$($widget.id)" @{ isActive = $true } | Out-Null

# ---- Origin allowlist --------------------------------------------------------
Write-Host "`nOrigin allowlist ..." -ForegroundColor Cyan

Check "Any origin allowed while the list is empty" `
    ((PubStatus Get "/api/public/widget/$tok/config" $null $null "https://anyone.example") -eq 0)

Api Put "/api/admin/widgets/$($widget.id)" @{ allowedOrigins = @("https://acme.com") } | Out-Null
Check "Listed origin is allowed" ((PubStatus Get "/api/public/widget/$tok/config" $null $null "https://acme.com") -eq 0)
Check "Unlisted origin is refused (403)" ((PubStatus Get "/api/public/widget/$tok/config" $null $null "https://evil.example") -eq 403)
Check "Session is refused from an unlisted origin too" `
    ((PubStatus Post "/api/public/widget/$tok/session" @{} $null "https://evil.example") -eq 403)
Api Put "/api/admin/widgets/$($widget.id)" @{ allowedOrigins = @() } | Out-Null

# ---- Sessions: anonymous, then claimed ---------------------------------------
Write-Host "`nVisitor sessions ..." -ForegroundColor Cyan

$s1 = Pub Post "/api/public/widget/$tok/session" @{} $null $null
Check "First call mints a visitor token" ($s1.visitorToken -and $s1.visitorId)
Check "A fresh visitor is not verified" ($s1.isVerified -eq $false)
Check "Details form is asked for when nobody is identified" ($s1.showDetailsForm -eq $true)
$v1 = $s1.visitorToken

$resumed = Pub Post "/api/public/widget/$tok/session" @{} $v1 $null
Check "Resuming returns the same visitor" ($resumed.visitorId -eq $s1.visitorId)
Check "Resuming does not mint a second token" ($null -eq $resumed.visitorToken)

# The details form's Submit. This is a claim and nothing more.
$claimed = Pub Patch "/api/public/widget/$tok/session" @{ name = "Clara Claimant"; mail = "clara@claimed.example"; number = "+44 7700 900001" } $v1 $null
Check "Typed details are kept on the session" ($claimed.name -eq "Clara Claimant" -and $claimed.email -eq "clara@claimed.example")
Check "Typed details do NOT verify anybody" ($claimed.isVerified -eq $false)
Check "Details form stops being asked for once filled in" ($claimed.showDetailsForm -eq $false)

$claimedContact = @((Api Get "/api/users?role=customer") | Where-Object { $_.email -eq "clara@claimed.example" })
Check "A claimed email creates NO contact record" ($claimedContact.Count -eq 0)

# ---- Sessions: proven --------------------------------------------------------
Write-Host "`nProven identity ..." -ForegroundColor Cyan

$proofEmail = "verified-$stamp@acme-customer.example"
$jwt = MakeJwt $secret @{ unique_id = $proofEmail; email = $proofEmail; name = "Vera Verified"; exp = (Unix 10) }
$s2 = Pub Post "/api/public/widget/$tok/session" @{ token = $jwt } $null $null
$v2 = $s2.visitorToken
Check "A signed token verifies the visitor" ($s2.isVerified -eq $true)
Check "Claims from the token populate the session" ($s2.email -eq $proofEmail -and $s2.name -eq "Vera Verified")
Check "External id is recorded" ($s2.externalId -eq $proofEmail)

$contact = @((Api Get "/api/users?role=customer") | Where-Object { $_.email -eq $proofEmail })
Check "A proven identity DOES create a contact" ($contact.Count -eq 1)
Check "The contact is a customer, never anything else" ($contact[0].role -eq "customer")
$contactId = $contact[0].id

# A later unsigned payload must not be able to re-point or downgrade a verified
# visitor - a host page that forgets the token on one route would otherwise
# silently unlink the contact.
$downgrade = Pub Patch "/api/public/widget/$tok/session" @{ name = "Mallory"; mail = "mallory@evil.example" } $v2 $null
Check "A verified visitor cannot be downgraded by an unsigned payload" ($downgrade.isVerified -eq $true)
Check "...nor re-pointed at another address" ($downgrade.email -eq $proofEmail)

# A token signed for one person while the config names another is either a bug
# or an attempt to ride a valid signature.
$mismatch = MakeJwt $secret @{ unique_id = "someone-else@example.com"; exp = (Unix 10) }
$s3 = Pub Post "/api/public/widget/$tok/session" @{ token = $mismatch; unique_id = "not-the-same@example.com" } $null $null
Check "unique_id must match the signed token" ($s3.isVerified -eq $false -and $s3.identityError)

$badJwt = MakeJwt "a-completely-different-secret-value-here" @{ unique_id = "x@y.example"; exp = (Unix 10) }
$s4 = Pub Post "/api/public/widget/$tok/session" @{ token = $badJwt } $null $null
Check "A token signed with the wrong key verifies nobody" ($s4.isVerified -eq $false -and $s4.identityError)

# An address that belongs to staff is left alone: role is Trackly's to decide
# (invariant 2), never an embedding page's.
$staffJwt = MakeJwt $secret @{ unique_id = $AdminEmail; email = $AdminEmail; exp = (Unix 10) }
$s5 = Pub Post "/api/public/widget/$tok/session" @{ token = $staffJwt } $null $null
$adminAfter = Api Get "/api/users/$($me.id)"
Check "An agent/admin address is never adopted as a contact" ($adminAfter.role -eq "admin")

# ---- Identity verification enforced ------------------------------------------
Write-Host "`nIdentity verification enforced ..." -ForegroundColor Cyan

Api Put "/api/admin/widgets/$($widget.id)" @{ identityVerificationEnabled = $true } | Out-Null
$unsigned = Pub Post "/api/public/widget/$tok/session" @{ unique_id = "sneaky@example.com"; mail = "sneaky@example.com" } $null $null
Check "Unsigned identity is refused when verification is on" ($unsigned.isVerified -eq $false)
Check "...and says why" ($unsigned.identityError -like "*signed token*")
Api Put "/api/admin/widgets/$($widget.id)" @{ identityVerificationEnabled = $false } | Out-Null

# ---- Conversations -----------------------------------------------------------
Write-Host "`nConversations ..." -ForegroundColor Cyan

Check "A message is required (400)" ((PubStatus Post "/api/public/widget/$tok/conversations" @{ message = "  " } $v1 $null) -eq 400)
Check "No visitor token, no conversation (404)" `
    ((PubStatus Post "/api/public/widget/$tok/conversations" @{ message = "hello" } $null $null) -eq 404)

$c1 = Pub Post "/api/public/widget/$tok/conversations" @{ message = "My printer is offline and I need it today" } $v1 $null
Check "An unverified visitor can still raise a conversation" ($null -ne $c1.id)
Check "Subject is derived from the first message" ($c1.subject -like "My printer is offline*")

$t1 = Api Get "/api/tickets/$($c1.id)"
Check "Ticket channel is widget" ($t1.channel -eq "widget")
Check "An unverified visitor is a GUEST on the ticket, not a requester" `
    ($null -eq $t1.requester -and $t1.guestEmail -eq "clara@claimed.example")
Check "Guest name carries the typed name" ($t1.guestName -eq "Clara Claimant")

$c2 = Pub Post "/api/public/widget/$tok/conversations" @{ message = "The VPN drops every ten minutes" } $v2 $null
$t2 = Api Get "/api/tickets/$($c2.id)"
Check "A verified visitor IS the requester" ($t2.requester -and $t2.requester.id -eq $contactId)
Check "...and no guest columns are used" ($null -eq $t2.guestEmail)

# ---- The plan's "done when" --------------------------------------------------
Write-Host "`nDone-when: the contact screen lights up ..." -ForegroundColor Cyan

$customer = Api Get "/api/users/$contactId"
Check "Widget ticket counts on the Customer Detail screen" ($customer.totalTickets -ge 1)
Check "...and counts as open" ($customer.openTickets -ge 1)

# ---- Email verification ------------------------------------------------------
Write-Host "`nEmail verification ..." -ForegroundColor Cyan

Api Put "/api/admin/widgets/$($widget.id)" @{ requireEmailVerification = $true } | Out-Null
$s6 = Pub Post "/api/public/widget/$tok/session" @{} $null $null
$v6 = $s6.visitorToken
Check "Unverified visitor is blocked when email verification is required (403)" `
    ((PubStatus Post "/api/public/widget/$tok/conversations" @{ message = "let me in" } $v6 $null) -eq 403)
Check "A verified visitor is unaffected by the same setting" `
    ((PubStatus Post "/api/public/widget/$tok/conversations" @{ message = "still fine" } $v2 $null) -eq 0)

Pub Post "/api/public/widget/$tok/session/verify-email" @{ email = "codetest-$stamp@example.com" } $v6 $null | Out-Null
Check "Requesting a code succeeds" $true
Check "A wrong code is rejected (400)" `
    ((PubStatus Post "/api/public/widget/$tok/session/verify-email/confirm" @{ email = "codetest-$stamp@example.com"; code = "000000" } $v6 $null) -eq 400)

Write-Host "  The code for codetest-$stamp@example.com was emailed (or logged to the API console)." -ForegroundColor Cyan
$raw = Read-Host "  Paste it to check the happy path (blank to skip)"
if ($raw) {
    $confirmed = Pub Post "/api/public/widget/$tok/session/verify-email/confirm" @{ email = "codetest-$stamp@example.com"; code = $raw.Trim() } $v6 $null
    Check "A confirmed code verifies the visitor" ($confirmed.isVerified -eq $true)
    Check "...and creates the contact" ($confirmed.email -eq "codetest-$stamp@example.com")
    Check "...which unblocks the conversation" `
        ((PubStatus Post "/api/public/widget/$tok/conversations" @{ message = "now I can write" } $v6 $null) -eq 0)
}
else {
    Write-Host "  (skipped the confirm happy path - no code provided)" -ForegroundColor Yellow
}
Api Put "/api/admin/widgets/$($widget.id)" @{ requireEmailVerification = $false } | Out-Null

# ---- Cross-widget isolation --------------------------------------------------
Write-Host "`nIsolation ..." -ForegroundColor Cyan

$other = (Api Post "/api/admin/widgets" @{ name = "Other $stamp" }).widget
Check "A visitor token from one widget is unusable on another (404)" `
    ((PubStatus Patch "/api/public/widget/$($other.publicToken)/session" @{ name = "nope" } $v1 $null) -eq 404)
Check "...and cannot raise a conversation there either (404)" `
    ((PubStatus Post "/api/public/widget/$($other.publicToken)/conversations" @{ message = "nope" } $v1 $null) -eq 404)

# ---- Summary -----------------------------------------------------------------
Write-Host "`n----------------------------------------" -ForegroundColor Cyan
$color = if ($script:fail -eq 0) { "Green" } else { "Red" }
Write-Host " Widget phase 2 verification: $script:pass passed, $script:fail failed" -ForegroundColor $color
Write-Host " Clean up with: DELETE /api/admin/widgets/$($widget.id) and /$($other.id)" -ForegroundColor DarkGray
if ($script:fail -gt 0) { exit 1 }
