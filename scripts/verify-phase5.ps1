<#
  Phase 5 (SSO) verification suite - run against a live API.

  Prereqs:
    docker compose up -d
    dotnet run --project src/Trackly.Api --urls http://localhost:5210
  Then, in a separate terminal:
    powershell -File .\scripts\verify-phase5.ps1 -AdminEmail you@example.com

  Covers the HTTP-testable SSO surface: admin connection CRUD (secret never
  returned), domain add/verify/discovery, and the SSO start redirect. The actual
  OIDC/SAML login round-trip requires a real IdP and is not automated here.
  Written for Windows PowerShell 5.1.
#>
param(
    [string]$BaseUrl = "http://localhost:5210",
    [Parameter(Mandatory = $true)][string]$AdminEmail,
    [string]$WorkspaceName = "Phase5 QA",
    [string]$WorkspaceSlug = ""
)

$ErrorActionPreference = "Stop"
if (-not $WorkspaceSlug) { $WorkspaceSlug = "phase5-" + (Get-Random -Maximum 99999) }
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

# Captures a 302 without following it, returning status + Location.
function Get-Redirect([string]$url, $session) {
    try {
        $resp = Invoke-WebRequest -Uri $url -MaximumRedirection 0 -WebSession $session -UseBasicParsing
        return [pscustomobject]@{ Status = [int]$resp.StatusCode; Location = $resp.Headers.Location }
    }
    catch {
        $r = $_.Exception.Response
        return [pscustomobject]@{ Status = [int]$r.StatusCode; Location = $r.Headers["Location"] }
    }
}

# ---- Sign in (magic link + pasted code, signing up if new) ------------------
Write-Host "`nSigning in as $AdminEmail ..." -ForegroundColor Cyan
Invoke-RestMethod -Uri "$BaseUrl/api/auth/magic-link/send" -Method Post -ContentType "application/json" `
    -Body (@{ email = $AdminEmail } | ConvertTo-Json) | Out-Null
$code = Read-Host "Paste the 6-digit code from the API console"

$verify = Invoke-WebRequest -Uri "$BaseUrl/api/auth/magic-link/verify" -Method Post -ContentType "application/json" `
    -Body (@{ email = $AdminEmail; code = $code } | ConvertTo-Json) -SessionVariable session -UseBasicParsing
if (($verify.Content | ConvertFrom-Json).status -eq "signup_required") {
    $signupBody = @{ email = $AdminEmail; code = $code; workspaceName = $WorkspaceName; workspaceSlug = $WorkspaceSlug; name = "QA Admin" } | ConvertTo-Json
    Invoke-WebRequest -Uri "$BaseUrl/api/signup" -Method Post -ContentType "application/json" `
        -Body $signupBody -WebSession $session -UseBasicParsing | Out-Null
}
$me = Invoke-RestMethod -Uri "$BaseUrl/api/users/me" -WebSession $session
$slug = $me.workspace.slug
Check "Authenticated as admin" ($me.role -eq "admin") "role=$($me.role)"

# ---- SSO connection CRUD ----------------------------------------------------
$sso = @{
    providerName      = "Authly"
    protocol          = "oidc"
    discoveryEndpoint = "https://idp.example.com/.well-known/openid-configuration"
    clientId          = "trackly-client"
    clientSecret      = "super-secret-value"
    groupMappings     = @(@{ groupName = "support-agents"; tracklyRole = "agent" }, @{ groupName = "it-admins"; tracklyRole = "admin" })
}
$saved = Invoke-RestMethod -Uri "$BaseUrl/api/admin/sso" -Method Put -ContentType "application/json" `
    -Body ($sso | ConvertTo-Json) -WebSession $session
Check "SSO saved (oidc, Authly)" ($saved.protocol -eq "oidc" -and $saved.providerName -eq "Authly")
Check "Client secret not returned, only hasClientSecret" `
    ($saved.hasClientSecret -eq $true -and ($saved.PSObject.Properties.Name -notcontains "clientSecret"))
Check "Group mappings round-trip" ($saved.groupMappings.Count -eq 2)

$badRole = Send-Api "Put" "$BaseUrl/api/admin/sso" (@{ providerName = "X"; protocol = "oidc"; discoveryEndpoint = "https://x/y"; clientId = "c"; groupMappings = @(@{ groupName = "g"; tracklyRole = "superuser" }) } | ConvertTo-Json) $session
Check "Invalid mapping role rejected (400)" ($badRole.Status -eq 400)

$got = Invoke-RestMethod -Uri "$BaseUrl/api/admin/sso" -WebSession $session
Check "GET sso returns saved connection without secret" `
    ($got.hasClientSecret -eq $true -and ($got.PSObject.Properties.Name -notcontains "clientSecret"))

# ---- SSO start redirect (discovery fetch fails -> bounce to login) ----------
$start = Get-Redirect "$BaseUrl/api/auth/sso?workspace=$slug" $session
Check "SSO start returns a redirect" ($start.Status -ge 300 -and $start.Status -lt 400) "status=$($start.Status)"
Check "Unreachable IdP bounces to login with sso_error" ($start.Location -like "*sso_error*")

# ---- Domains ----------------------------------------------------------------
$domain = "qa-$((Get-Random -Maximum 99999)).example"
$added = Invoke-RestMethod -Uri "$BaseUrl/api/admin/domains" -Method Post -ContentType "application/json" `
    -Body (@{ domain = $domain } | ConvertTo-Json) -WebSession $session
Check "Domain added, unverified, TXT token issued" `
    ($added.verified -eq $false -and $added.txtRecordValue -like "trackly-verification=*")

$dupe = Send-Api "Post" "$BaseUrl/api/admin/domains" (@{ domain = $domain } | ConvertTo-Json) $session
Check "Duplicate domain rejected (409)" ($dupe.Status -eq 409)

$verifyDom = Invoke-RestMethod -Uri "$BaseUrl/api/admin/domains/$($added.id)/verify" -Method Post -WebSession $session
Check "Verify fails without the DNS TXT record" ($verifyDom.verified -eq $false)

# Discovery must NOT route an unverified domain to SSO (API replies 204).
$disc = Send-Api "Get" "$BaseUrl/api/public/sso/discover?email=someone@$domain" $null $session
Check "Discovery returns 204 for unverified domain" ($disc.Status -eq 204)

# ---- Disable SSO ------------------------------------------------------------
Invoke-WebRequest -Uri "$BaseUrl/api/admin/sso" -Method Delete -WebSession $session -UseBasicParsing | Out-Null
$afterDelete = Send-Api "Get" "$BaseUrl/api/admin/sso" $null $session
Check "After delete, GET sso is empty" ($afterDelete.Status -eq 200 -and [string]::IsNullOrWhiteSpace($afterDelete.Body))

# ---- Summary ----------------------------------------------------------------
Write-Host "`n----------------------------------------" -ForegroundColor Cyan
$color = if ($script:fail -eq 0) { "Green" } else { "Red" }
Write-Host " Phase 5 verification: $script:pass passed, $script:fail failed" -ForegroundColor $color
Write-Host " (OIDC/SAML login round-trip needs a real IdP - test manually.)" -ForegroundColor DarkGray
if ($script:fail -gt 0) { exit 1 }
