# Builds Offox on Windows and makes the installer (it asks for a normal or a
# portable install):
#   dist\Offox-<version>-Setup.exe
#
# Run from a normal PowerShell window in the repository folder:
#   powershell -ExecutionPolicy Bypass -File offox\installer\build-windows.ps1
#
# Options:
#   -SkipBootstrap   don't run "mach bootstrap" again (after the first build)
#   -NoInstaller     only build Offox (obj-offox\dist\bin\offox.exe)
#   -ObjDir <path>   put the build output elsewhere (e.g. a bigger disk)
#
# Needs 64-bit Windows 10/11, about 40 GB of free disk and a few hours the
# first time. The script installs MozillaBuild if it is missing; "mach
# bootstrap" downloads the compilers and everything else Firefox needs.
param(
  [switch]$SkipBootstrap,
  [switch]$NoInstaller,
  [string]$ObjDir = ""
)
$ErrorActionPreference = "Stop"

$Repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Offox = Join-Path $Repo "offox"
$Out = Join-Path $Repo "dist"
$MozillaBuild = "C:\mozilla-build"
if (-not $ObjDir) { $ObjDir = Join-Path $Repo "obj-offox" }

function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }

# ---------------------------------------------------------------- checks
if (-not [Environment]::Is64BitOperatingSystem) {
  throw "Offox needs 64-bit Windows."
}
$drive = Get-PSDrive -Name ($ObjDir.Substring(0, 1))
if ($drive.Free -lt 40GB) {
  Write-Warning ("Only {0:N0} GB free on {1}: - the build needs about 40 GB." -f ($drive.Free / 1GB), $drive.Name)
}
if (-not (Test-Path (Join-Path $Repo "mach"))) {
  throw "$Repo does not look like the Offox source (no mach file)."
}
# Shell scripts and patches break if Git turned their line endings into CRLF.
$machText = [IO.File]::ReadAllText((Join-Path $Repo "mach"))
if ($machText.Contains("`r`n")) {
  throw @"
This checkout has Windows (CRLF) line endings, which breaks the Firefox build.
Clone it again with:
  git clone -c core.autocrlf=false -c core.longpaths=true https://github.com/SoulVoid0/Offox
"@
}

# ----------------------------------------------------------- MozillaBuild
if (-not (Test-Path (Join-Path $MozillaBuild "msys2\usr\bin\bash.exe"))) {
  Step "Installing MozillaBuild (Mozilla's build shell)"
  $setup = Join-Path $env:TEMP "MozillaBuildSetup.exe"
  Invoke-WebRequest "https://ftp.mozilla.org/pub/mozilla/libraries/win32/MozillaBuildSetup-Latest.exe" -OutFile $setup
  # The installer asks for administrator rights.
  Start-Process -FilePath $setup -ArgumentList "/S" -Verb RunAs -Wait
  Remove-Item $setup
  if (-not (Test-Path (Join-Path $MozillaBuild "msys2\usr\bin\bash.exe"))) {
    throw "MozillaBuild was not installed to $MozillaBuild."
  }
}

function Invoke-MozillaBuild($command) {
  # Runs a command in the MozillaBuild shell, in the repository folder.
  $env:MOZILLABUILD = "$MozillaBuild\"
  $env:CHERE_INVOKING = "1"
  $env:MOZCONFIG = (Join-Path $Offox "fork\mozconfig.windows")
  $env:OFFOX_OBJDIR = $ObjDir.Replace("\", "/")
  $bash = Join-Path $MozillaBuild "msys2\usr\bin\bash.exe"
  Push-Location $Repo
  try {
    & $bash -l -c "cd `"`$(cygpath -u '$Repo')`" && $command"
    if ($LASTEXITCODE -ne 0) { throw "Failed: $command (exit code $LASTEXITCODE)" }
  } finally {
    Pop-Location
  }
}

# ------------------------------------------------------------------ build
if (-not $SkipBootstrap) {
  Step "Bootstrapping (compilers, Rust, Node, Windows SDK...)"
  Invoke-MozillaBuild "./mach --no-interactive bootstrap --application-choice browser"
}
Step "Building Offox (this takes a while)"
Invoke-MozillaBuild "./mach build"
Step "Packaging"
Invoke-MozillaBuild "./mach package"

$zip = Get-ChildItem (Join-Path $ObjDir "dist") -Filter "offox-*.win64.zip" |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $zip) { throw "mach package did not produce offox-*.win64.zip in $ObjDir\dist" }
New-Item -ItemType Directory -Force $Out | Out-Null
Copy-Item $zip.FullName $Out -Force
if ($NoInstaller) {
  Write-Host "`nDone: $(Join-Path $Out $zip.Name) (run offox\offox.exe inside it)"
  exit 0
}

# -------------------------------------------------------------- installer
Step "Making the installer"
$makensis = @(
  (Get-Command makensis.exe -ErrorAction SilentlyContinue | ForEach-Object Source),
  "${env:ProgramFiles(x86)}\NSIS\makensis.exe",
  "$env:ProgramFiles\NSIS\makensis.exe",
  "$env:USERPROFILE\.mozbuild\nsis\bin\makensis.exe",
  "$MozillaBuild\bin\makensis.exe"
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $makensis) {
  Write-Host "Installing NSIS with winget..."
  winget install --id NSIS.NSIS --silent --accept-package-agreements --accept-source-agreements
  $makensis = "${env:ProgramFiles(x86)}\NSIS\makensis.exe"
  if (-not (Test-Path $makensis)) {
    throw "NSIS (makensis.exe) is needed for the installer: install it from https://nsis.sourceforge.io and run this script again with -SkipBootstrap."
  }
}

$version = [regex]::Match($zip.Name, '^offox-([0-9.]+)').Groups[1].Value.TrimEnd('.')
$stage = Join-Path $env:TEMP ("offox-stage-" + [guid]::NewGuid())
Expand-Archive $zip.FullName -DestinationPath $stage
try {
  $setupExe = Join-Path $Out "Offox-$version-Setup.exe"
  & $makensis -V2 "-DSTAGE=$stage\offox" "-DVERSION=$version" "-DOUTFILE=$setupExe" (Join-Path $Offox "installer\windows\offox.nsi")
  if ($LASTEXITCODE -ne 0) { throw "makensis failed (exit code $LASTEXITCODE)" }
} finally {
  Remove-Item -Recurse -Force $stage
}

Write-Host "`nDone: $setupExe" -ForegroundColor Green
Write-Host "Run it and choose Normal install or Portable install."
