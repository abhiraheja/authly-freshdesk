<#
  Widget phase 1 — schema reshape + admin CRUD + identity secrets.

  Covers docs/widget-plan.md § 10 phase 1: a workspace can run more than one
  widget, each addressed by its own public token; secrets are written encrypted,
  shown once and masked afterwards; the Verify JWT tool accepts a correctly
  signed token and rejects the ways one can be wrong. The last block is the
  "done when" clause the plan asks for — the pre-reshape snippet must still
  render, so the legacy singular endpoint and widget.js are checked unchanged.

  Prereqs:
    docker compose up -d
    dotnet run --project src/Trackly.Api --urls http://localhost:5210
  Then:
    powershell -File .\scripts\verify-widget-phase1.ps1 -AdminEmail you@example.com

  Written for Windows PowerShell 5.1.
#>
param(
    [string]$BaseUrl = "http://localhost:5210",
    [Parameter(Mandatory = $true)][string]$AdminEmail,
    [string]$WorkspaceName = "Widget QA",
    # An existing trackly.session cookie value, for installs whose SMTP actually
    # delivers - the six-digit code lands in a mailbox rather than the API
    # console, so there is nothing to paste. Skips the sign-in block entirely.
    [string]$SessionToken
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
Write-Host "`nSigning in as $AdminEmail ..." -ForegroundColor Cyan
if ($SessionToken) {
    $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    $cookie = New-Object System.Net.Cookie("trackly.session", $SessionToken, "/", ([Uri]$BaseUrl).Host)
    $session.Cookies.Add($cookie)
}
elseif ((Invoke-RestMethod -Uri "$BaseUrl/api/setup/status").needsSetup) {
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

# ---- JWT helpers -------------------------------------------------------------
# The host page's side of identity verification, in the smallest form that
# exercises it: base64url header + payload, HMAC-SHA256 over "header.payload".
function B64Url([byte[]]$bytes) {
    [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}
function MakeJwt([string]$secret, [hashtable]$payload, [string]$alg = "HS256") {
    $h = B64Url ([Text.Encoding]::UTF8.GetBytes((@{ alg = $alg; typ = "JWT" } | ConvertTo-Json -Compress)))
    $p = B64Url ([Text.Encoding]::UTF8.GetBytes(($payload | ConvertTo-Json -Compress)))
    $signing = "$h.$p"
    if ($alg -eq "none") { return "$signing." }
    $hmac = New-Object System.Security.Cryptography.HMACSHA256
    $hmac.Key = [Text.Encoding]::UTF8.GetBytes($secret)
    $sig = B64Url ($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($signing)))
    return "$signing.$sig"
}
function Unix([int]$minutesFromNow) {
    [DateTimeOffset]::UtcNow.AddMinutes($minutesFromNow).ToUnixTimeSeconds()
}

# ---- Two widgets, two tokens -------------------------------------------------
Write-Host "`nCreating widgets ..." -ForegroundColor Cyan

$a = Api Post "/api/admin/widgets" @{ name = "Production"; tagline = "We reply in minutes"; primaryColor = "1c65d4" }
$b = Api Post "/api/admin/widgets" @{ name = "Docs site"; launchWidget = $true; showWidgetForm = $false }

Check "Two widgets coexist in one workspace" ($a.widget.id -ne $b.widget.id)
Check "Each carries its own public token" `
    ($a.widget.publicToken -and $b.widget.publicToken -and $a.widget.publicToken -ne $b.widget.publicToken)
Check "Token is short enough to read out loud" ($a.widget.publicToken.Length -le 16)
Check "Colour normalised to a leading hash" ($a.widget.primaryColor -eq "#1c65d4")
Check "Launch options round-trip" ($b.widget.launchWidget -eq $true -and $b.widget.showWidgetForm -eq $false)
Check "Defaults survive a partial create" ($b.widget.showCloseButton -eq $true -and $b.widget.isActive -eq $true)

$list = Api Get "/api/admin/widgets"
Check "List returns both" (@($list | Where-Object { $_.id -in @($a.widget.id, $b.widget.id) }).Count -eq 2)
Check "List never carries a secret" (-not ($list | Get-Member -Name "secretKey*"))

# ---- Secrets: shown once, masked thereafter ----------------------------------
Write-Host "`nIdentity secrets ..." -ForegroundColor Cyan

$secretA = $a.secretKey
Check "Create returns the plaintext secret once" ($secretA.Length -ge 32)
Check "Create response already masks it on the widget" `
    ($a.widget.secretKeyMasked -ne $secretA -and $a.widget.secretKeyMasked -like "*$($secretA.Substring(0,4))*")

$detail = Api Get "/api/admin/widgets/$($a.widget.id)"
Check "Detail reports a key exists" ($detail.hasSecretKey -eq $true)
Check "Detail never returns the plaintext" (-not ($detail | Get-Member -Name "secretKey") -and $detail.secretKeyMasked -ne $secretA)

$regen = Api Post "/api/admin/widgets/$($a.widget.id)/secret" $null
Check "Regenerate mints a different secret" ($regen.secretKey -ne $secretA -and $regen.secretKey.Length -ge 32)
$secretA = $regen.secretKey

# ---- Verify JWT --------------------------------------------------------------
Write-Host "`nVerify JWT ..." -ForegroundColor Cyan

$good = MakeJwt $secretA @{ unique_id = "alice@acme.com"; exp = (Unix 5) }
$r = Api Post "/api/admin/widgets/$($a.widget.id)/verify-jwt" @{ token = $good }
Check "Correctly signed token is accepted" ($r.valid -eq $true)
Check "  ...and reports who it identifies" ($r.uniqueId -eq "alice@acme.com")

$wrongKey = MakeJwt "not-the-widget-secret-not-the-widget-secret" @{ unique_id = "alice@acme.com"; exp = (Unix 5) }
$r = Api Post "/api/admin/widgets/$($a.widget.id)/verify-jwt" @{ token = $wrongKey }
Check "Token signed with another key is rejected" ($r.valid -eq $false)

# The old secret must stop working the moment it is regenerated - that is the
# entire point of the button.
$stale = MakeJwt $a.secretKey @{ unique_id = "alice@acme.com"; exp = (Unix 5) }
$r = Api Post "/api/admin/widgets/$($a.widget.id)/verify-jwt" @{ token = $stale }
Check "The regenerated-away secret no longer verifies" ($r.valid -eq $false)

$expired = MakeJwt $secretA @{ unique_id = "alice@acme.com"; exp = (Unix -10) }
$r = Api Post "/api/admin/widgets/$($a.widget.id)/verify-jwt" @{ token = $expired }
Check "Expired token is rejected" ($r.valid -eq $false)

$noExp = MakeJwt $secretA @{ unique_id = "alice@acme.com" }
$r = Api Post "/api/admin/widgets/$($a.widget.id)/verify-jwt" @{ token = $noExp }
Check "Token with no exp is rejected" ($r.valid -eq $false)

# alg:none is the classic JWT forgery - an unsigned token that a lax library
# accepts because the header told it not to check.
$none = MakeJwt $secretA @{ unique_id = "alice@acme.com"; exp = (Unix 5) } "none"
$r = Api Post "/api/admin/widgets/$($a.widget.id)/verify-jwt" @{ token = $none }
Check "alg:none is rejected" ($r.valid -eq $false)

$noSubject = MakeJwt $secretA @{ plan = "pro"; exp = (Unix 5) }
$r = Api Post "/api/admin/widgets/$($a.widget.id)/verify-jwt" @{ token = $noSubject }
Check "Signed token with no unique_id is rejected" ($r.valid -eq $false)

$r = Api Post "/api/admin/widgets/$($a.widget.id)/verify-jwt" @{ token = "nonsense" }
Check "Garbage is rejected without throwing" ($r.valid -eq $false -and $r.error)

# The verifier is the other widget's, so the same token must not pass there.
$r = Api Post "/api/admin/widgets/$($b.widget.id)/verify-jwt" @{ token = $good }
Check "A token is bound to the widget it was signed for" ($r.valid -eq $false)

# ---- Update, validation, delete ---------------------------------------------
Write-Host "`nUpdate and delete ..." -ForegroundColor Cyan

$updated = Api Put "/api/admin/widgets/$($a.widget.id)" @{ tagline = "Now with more haste"; identityVerificationEnabled = $true }
Check "Update applies the fields it was given" ($updated.tagline -eq "Now with more haste")
Check "  ...and leaves the rest alone" ($updated.name -eq "Production" -and $updated.primaryColor -eq "#1c65d4")
Check "Identity verification can be enabled once a key exists" ($updated.identityVerificationEnabled -eq $true)

$cleared = Api Put "/api/admin/widgets/$($a.widget.id)" @{ clearPrimaryColor = $true }
Check "Colour clears to inherit the workspace's branding" ($null -eq $cleared.primaryColor)

Check "Bad colour is rejected (400)" ((StatusOf Put "/api/admin/widgets/$($a.widget.id)" @{ primaryColor = "cornflower" }) -eq 400)
Check "Bad origin is rejected (400)" ((StatusOf Put "/api/admin/widgets/$($a.widget.id)" @{ allowedOrigins = @("acme.com") }) -eq 400)
Check "Blank name is rejected (400)" ((StatusOf Put "/api/admin/widgets/$($a.widget.id)" @{ name = "  " }) -eq 400)
Check "Unknown widget is 404" ((StatusOf Get "/api/admin/widgets/$([guid]::NewGuid())" $null) -eq 404)

$origins = Api Put "/api/admin/widgets/$($a.widget.id)" @{ allowedOrigins = @("https://acme.com/support/", "https://acme.com", "http://localhost:5173") }
Check "Origins reduced to scheme+host+port, deduplicated" `
    ($origins.allowedOrigins.Count -eq 2 -and $origins.allowedOrigins[0] -eq "https://acme.com")

Check "Delete removes the widget (204)" ((StatusOf Delete "/api/admin/widgets/$($b.widget.id)" $null) -eq 0)
Check "  ...and it is gone (404)" ((StatusOf Get "/api/admin/widgets/$($b.widget.id)" $null) -eq 404)

# ---- The plan's "done when": the old snippet still renders --------------------
Write-Host "`nBack-compatibility ..." -ForegroundColor Cyan

$legacy = Api Get "/api/admin/widget"
Check "Legacy singular endpoint still answers" ($null -ne $legacy.snippet)
Check "  ...with the pre-reshape response shape" `
    ($null -ne $legacy.embedType -and $null -ne $legacy.theme -and $null -ne $legacy.fields)
Check "Snippet still points at widget.js with data-workspace" `
    ($legacy.snippet -like "*widget.js*" -and $legacy.snippet -like "*data-workspace=*")
Check "Snippet already carries the widget token for the phase-4 loader" ($legacy.snippet -like "*data-widget=*")

$saved = Api Put "/api/admin/widget" @{ embedType = "inline"; theme = "light"; fields = @{ fields = @("name", "email") } }
Check "Legacy save still round-trips" ($saved.embedType -eq "inline")
Api Put "/api/admin/widget" @{ embedType = "floating"; theme = "light"; fields = $saved.fields } | Out-Null

# The slug comes out of the snippet itself - which is also a check that the
# snippet still names a workspace the public endpoint can resolve.
if ($legacy.snippet -match 'data-workspace="([^"]+)"') {
    $slug = $Matches[1]
    $pub = Invoke-RestMethod -Uri "$BaseUrl/api/public/workspaces/$slug/widget"
    Check "Public slug-addressed config still resolves" ($null -ne $pub.embedType)
}
else {
    Check "Snippet names a workspace" $false "no data-workspace in: $($legacy.snippet)"
}

$js = Invoke-WebRequest -Uri "$BaseUrl/widget.js" -UseBasicParsing
Check "widget.js still served (200)" ($js.StatusCode -eq 200)
Check "  ...and still understands data-workspace" ($js.Content -like "*data-workspace*")

# ---- Summary ----------------------------------------------------------------
Write-Host "`n----------------------------------------" -ForegroundColor Cyan
$color = if ($script:fail -eq 0) { "Green" } else { "Red" }
Write-Host " Widget phase 1 verification: $script:pass passed, $script:fail failed" -ForegroundColor $color
if ($script:fail -gt 0) { exit 1 }
