<#
  Widget phase 4 - the loader script.

  Covers docs/widget-plan.md § 10 phase 4, whose done-when is "the snippet in
  § 7.1 works on a plain HTML page". So that is literally what this runs: a plain
  HTML page carrying that snippet, in real Chrome, driven over the DevTools
  protocol.

  A browser rather than PowerShell because none of the claims are HTTP ones -
  whether a launcher appeared, in which colour, whether the iframe is hidden,
  what crossed the postMessage boundary and to which origin. Two Node scripts do
  the work; this file is the wiring:

    scripts/widget-loader-harness.mjs   the embedding site + a panel stub
    scripts/widget-loader-probe.mjs     Chrome, and the assertions

  The panel stub is served on whatever port the widget's own config reports as
  `frameUrl`, so the loader is exercised against the URL it will really use. That
  port is normally the SPA dev server's - stop it first, or point
  App:FrontendBaseUrl somewhere free.

  Prereqs:
    docker compose up -d
    dotnet run --project src/Trackly.Api --urls http://localhost:5210
    node 20+ and Google Chrome
  Then:
    powershell -File .\scripts\verify-widget-phase4.ps1 -AdminEmail you@example.com

  Written for Windows PowerShell 5.1.
#>
param(
    [string]$BaseUrl = "http://localhost:5210",
    [Parameter(Mandatory = $true)][string]$AdminEmail,
    [string]$WorkspaceName = "Widget QA",
    # See verify-widget-phase1.ps1: an existing trackly.session cookie, for
    # installs whose SMTP delivers to a real mailbox instead of the console.
    [string]$SessionToken,
    # Where the fake embedding site listens. Anything free will do.
    [int]$HostPort = 4310,
    [string]$Chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
)

$ErrorActionPreference = "Stop"
function Body($h) { $h | ConvertTo-Json -Depth 8 }

if (-not (Test-Path $Chrome)) { throw "Chrome not found at $Chrome. Pass -Chrome." }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "node is not on PATH." }

# ---- Sign in, and make a widget to embed --------------------------------------
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

$stamp = (Get-Date).ToString("HHmmss")
$created = Invoke-RestMethod -Uri "$BaseUrl/api/admin/widgets" -Method Post -ContentType "application/json" `
    -Body (Body @{ name = "Phase4 $stamp"; tagline = "Ask us anything"; primaryColor = "#16A34A" }) -WebSession $session
$widget = $created.widget
$token = $widget.publicToken
Write-Host "Widget $token created." -ForegroundColor Cyan

# The slug, for the data-workspace back-compatibility page. The link-embed
# snippet is the only place the API hands it to an admin caller.
$legacy = Invoke-RestMethod -Uri "$BaseUrl/api/admin/widget" -Method Put -ContentType "application/json" `
    -Body (Body @{ embedType = "link"; theme = "light"; fields = @{} }) -WebSession $session
$slug = if ($legacy.snippet -match 'workspace=([^&\s"]+)') { $Matches[1] } else { "" }
Invoke-RestMethod -Uri "$BaseUrl/api/admin/widget" -Method Put -ContentType "application/json" `
    -Body (Body @{ embedType = "floating"; theme = "light"; fields = @{} }) -WebSession $session | Out-Null

$config = Invoke-RestMethod -Uri "$BaseUrl/api/public/widget/$token/config"
$frameOrigin = ([Uri]$config.frameUrl).GetLeftPart([System.UriPartial]::Authority)
Write-Host "Panel origin: $frameOrigin" -ForegroundColor Cyan

# ---- Harness + probe -----------------------------------------------------------
$env:API = $BaseUrl
$env:TOKEN = $token
$env:SLUG = $slug
$env:HOST_PORT = $HostPort
$env:FRAME_ORIGIN = $frameOrigin
$env:HARNESS = "http://localhost:$HostPort"
$env:CHROME = $Chrome

$root = Split-Path -Parent $PSScriptRoot
$harness = Start-Process node -ArgumentList "`"$root\scripts\widget-loader-harness.mjs`"" `
    -PassThru -NoNewWindow -RedirectStandardOutput "$env:TEMP\widget-harness-$stamp.log" `
    -RedirectStandardError "$env:TEMP\widget-harness-$stamp.err"
Start-Sleep -Seconds 2

if ($harness.HasExited) {
    Write-Host (Get-Content "$env:TEMP\widget-harness-$stamp.err" -Raw) -ForegroundColor Red
    throw "The harness could not start - see the error above."
}

try {
    & node "$root\scripts\widget-loader-probe.mjs"
    $code = $LASTEXITCODE
}
finally {
    if (-not $harness.HasExited) { Stop-Process -Id $harness.Id -Force }
    Write-Host "`nClean up with: DELETE /api/admin/widgets/$($widget.id)" -ForegroundColor DarkGray
}

exit $code
