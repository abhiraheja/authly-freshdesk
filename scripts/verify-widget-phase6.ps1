<#
  Widget phase 6 - the admin screens.

  Covers docs/widget-plan.md § 10 phase 6, whose done-when is two claims that only
  a rendered page can settle:

    * the widget screen is real, not the ComingSoon placeholder
    * each branding record is editable in exactly ONE place

  The second claim was rewritten by widget-plan 4.2.1. It used to mean "branding
  lives only on the widget screen"; it now means the opposite split - the
  workspace record has its own screen at /admin/settings/branding and its own nav
  row, and the widget's Branding tab writes the widget row alone. The strong form
  is proved at the end: save a colour on a widget, then re-read
  GET /api/admin/branding and assert the payload did not move.

  Also asserted: the secret key is never rendered in plaintext, the live preview
  repaints as the colour is typed (which is the only reason it exists), and the
  Integration tab emits the initChatWidget snippet phase 4 taught the loader.

  Prereqs:
    docker compose up -d
    dotnet run --project src/Trackly.Api --urls http://localhost:5210
    npm start            (from frontend-angular/, on :4200)
    node 20+ and Google Chrome
  Then:
    powershell -File .\scripts\verify-widget-phase6.ps1 -SessionToken <trackly.session>

  See verify-widget-phase1.ps1 for where to get a session cookie.

  Written for Windows PowerShell 5.1.
#>
param(
    [string]$BaseUrl = "http://localhost:5210",
    [string]$AppUrl = "http://localhost:4200",
    [Parameter(Mandatory = $true)][string]$SessionToken,
    [string]$Chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $Chrome)) { throw "Chrome not found at $Chrome. Pass -Chrome." }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "node is not on PATH." }

try { Invoke-WebRequest -Uri $AppUrl -UseBasicParsing -TimeoutSec 5 | Out-Null }
catch { throw "Nothing is serving $AppUrl. Start the SPA (npm start) first." }

# The list screen needs at least one widget to open an editor from.
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$session.Cookies.Add((New-Object System.Net.Cookie("trackly.session", $SessionToken, "/", ([Uri]$BaseUrl).Host)))
$widgets = @(Invoke-RestMethod -Uri "$BaseUrl/api/admin/widgets" -WebSession $session)
if ($widgets.Count -eq 0) {
    Write-Host "No widgets yet - creating one to edit." -ForegroundColor Cyan
    Invoke-RestMethod -Uri "$BaseUrl/api/admin/widgets" -Method Post -ContentType "application/json" `
        -Body '{"name":"Phase6 sample"}' -WebSession $session | Out-Null
}

$env:API = $BaseUrl
$env:APP = $AppUrl
$env:SESSION = $SessionToken
$env:CHROME = $Chrome

$root = Split-Path -Parent $PSScriptRoot
& node "$root\scripts\widget-admin-probe.mjs"
exit $LASTEXITCODE
