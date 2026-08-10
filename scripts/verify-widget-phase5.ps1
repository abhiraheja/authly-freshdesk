<#
  Widget phase 5 - the customer-facing panel at /widget/:token.

  Covers docs/widget-plan.md § 10 phase 5, whose done-when is "four states each,
  brand-coloured, light". Nothing here is stubbed: the loader is the real
  widget.js, the panel is the real Angular route on the SPA dev server, and the
  API is the real API. A visitor's whole first session is driven through the DOM -
  open, fill the details form, type a message, send - and then an agent replies
  over the API and the panel is checked for what came back.

  Two assertions are the ones that matter:
    * the panel wears the WIDGET's colour and is light, whatever the visitor's
      own preference (invariant 6)
    * an internal note never appears in it (invariant 5)

  Prereqs:
    docker compose up -d
    dotnet run --project src/Trackly.Api --urls http://localhost:5210
    npm start            (from frontend-angular/, on the port App:FrontendBaseUrl names)
    node 20+ and Google Chrome
  Then:
    powershell -File .\scripts\verify-widget-phase5.ps1 -SessionToken <trackly.session>

  The session cookie is needed for the agent half - replying to the ticket the
  panel raises. See verify-widget-phase1.ps1 for where to get one.

  Written for Windows PowerShell 5.1.
#>
param(
    [string]$BaseUrl = "http://localhost:5210",
    [Parameter(Mandatory = $true)][string]$SessionToken,
    # Which widget to embed. Defaults to the workspace's first active one.
    [string]$Token,
    [int]$HostPort = 4310,
    [string]$Chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $Chrome)) { throw "Chrome not found at $Chrome. Pass -Chrome." }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "node is not on PATH." }

$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$session.Cookies.Add((New-Object System.Net.Cookie("trackly.session", $SessionToken, "/", ([Uri]$BaseUrl).Host)))

if (-not $Token) {
    $widgets = Invoke-RestMethod -Uri "$BaseUrl/api/admin/widgets" -WebSession $session
    $first = @($widgets | Where-Object { $_.isActive })[0]
    if (-not $first) { throw "No active widget in this workspace. Create one first." }
    $Token = $first.publicToken
}

$config = Invoke-RestMethod -Uri "$BaseUrl/api/public/widget/$Token/config"
$frameOrigin = ([Uri]$config.frameUrl).GetLeftPart([System.UriPartial]::Authority)
Write-Host "`nWidget  : $Token ($($config.name), $($config.primaryColor))" -ForegroundColor Cyan
Write-Host "Panel   : $($config.frameUrl)" -ForegroundColor Cyan

# The panel has to actually be served, or every assertion below fails for one
# uninteresting reason.
try { Invoke-WebRequest -Uri $frameOrigin -UseBasicParsing -TimeoutSec 5 | Out-Null }
catch { throw "Nothing is serving $frameOrigin. Start the SPA (npm start) on that port first." }

$env:API = $BaseUrl
$env:TOKEN = $Token
$env:HOST_PORT = $HostPort
$env:HOST_PAGE = "http://localhost:$HostPort"
$env:SESSION = $SessionToken
$env:CHROME = $Chrome

$root = Split-Path -Parent $PSScriptRoot
$stamp = (Get-Date).ToString("HHmmss")
$host_ = Start-Process node -ArgumentList "`"$root\scripts\widget-panel-host.mjs`"" `
    -PassThru -NoNewWindow -RedirectStandardOutput "$env:TEMP\widget-host-$stamp.log" `
    -RedirectStandardError "$env:TEMP\widget-host-$stamp.err"
Start-Sleep -Seconds 2

if ($host_.HasExited) {
    Write-Host (Get-Content "$env:TEMP\widget-host-$stamp.err" -Raw) -ForegroundColor Red
    throw "The host page could not start - see the error above."
}

try {
    & node "$root\scripts\widget-panel-probe.mjs"
    $code = $LASTEXITCODE
}
finally {
    if (-not $host_.HasExited) { Stop-Process -Id $host_.Id -Force }
}

exit $code
