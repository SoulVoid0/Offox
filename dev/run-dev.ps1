# Offox developer mode for Windows: runs Offox inside a stock Firefox ESR
# without compiling anything. The first run downloads Firefox ESR (the only
# time anything touches the internet); after that it works offline.
#
#   powershell -ExecutionPolicy Bypass -File dev\run-dev.ps1 [-Fresh]
param([switch]$Fresh)
$ErrorActionPreference = "Stop"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Repo = Split-Path -Parent $Here
$FF = Join-Path $Here ".firefox"
$App = Join-Path $FF "core"
$Profile = Join-Path $Here ".profile"

if ($Fresh -and (Test-Path $Profile)) { Remove-Item -Recurse -Force $Profile }

if (-not (Test-Path (Join-Path $App "firefox.exe"))) {
  Write-Host "Downloading Firefox ESR (one time)..."
  New-Item -ItemType Directory -Force $FF | Out-Null
  $Setup = Join-Path $FF "setup.exe"
  Invoke-WebRequest "https://download.mozilla.org/?product=firefox-esr-latest-ssl&os=win64&lang=en-US" -OutFile $Setup
  # The full installer can unpack itself without installing anything.
  Start-Process -Wait -FilePath $Setup -ArgumentList "/ExtractDir=$FF"
  Remove-Item $Setup
}

New-Item -ItemType Directory -Force (Join-Path $App "defaults\pref"), (Join-Path $App "distribution"), $Profile | Out-Null
Copy-Item (Join-Path $Here "devmode\autoconfig.js") (Join-Path $App "defaults\pref\autoconfig.js") -Force
Copy-Item (Join-Path $Repo "fork\prefs\offox-prefs.js") (Join-Path $App "defaults\pref\offox-prefs.js") -Force
Copy-Item (Join-Path $Here "devmode\offox.cfg") (Join-Path $App "offox.cfg") -Force
Copy-Item (Join-Path $Here "devmode\policies.json") (Join-Path $App "distribution\policies.json") -Force
$Target = Join-Path $App "offox"
if (Test-Path $Target) { Remove-Item -Recurse -Force $Target }
Copy-Item -Recurse (Join-Path $Repo "src\offox") $Target

Start-Process -FilePath (Join-Path $App "firefox.exe") -ArgumentList "--no-remote", "--profile", "`"$Profile`""
