# Formulary Windows Uninstaller
$ErrorActionPreference = "Stop"

# Colors
$Green = [ConsoleColor]::Green
$Red = [ConsoleColor]::Red
$Yellow = [ConsoleColor]::Yellow
$Blue = [ConsoleColor]::Blue

$InstallDir = "$HOME\.formulary"
$BinDir = "$HOME\.local\bin"

# Parse arguments
$SkipConfirm = $false
foreach ($arg in $args) {
    if ($arg -eq "-y" -or $arg -eq "--yes") {
        $SkipConfirm = $true
    }
}

Write-Host "Formulary Uninstaller" -ForegroundColor $Blue
Write-Host ""

# Confirm uninstall
if (-not $SkipConfirm) {
    Write-Host "This will remove Formulary from your system" -ForegroundColor $Yellow
    $Response = Read-Host "Continue? (y/N)"
    if ($Response -notmatch "^[Yy]$") {
        Write-Host "Cancelled" -ForegroundColor $Yellow
        exit 0
    }
}

# Remove wrappers
Write-Host ""
Write-Host "Removing wrappers..." -ForegroundColor $Blue
if (Test-Path "$BinDir\formulary.cmd") {
    Remove-Item -Force "$BinDir\formulary.cmd"
    Write-Host "  Removed formulary.cmd" -ForegroundColor $Green
}
if (Test-Path "$BinDir\formulary-install-browsers.cmd") {
    Remove-Item -Force "$BinDir\formulary-install-browsers.cmd"
    Write-Host "  Removed formulary-install-browsers.cmd" -ForegroundColor $Green
}

# Remove installation
Write-Host ""
Write-Host "Removing installation..." -ForegroundColor $Blue
if (Test-Path "$InstallDir\repo") {
    Remove-Item -Recurse -Force "$InstallDir\repo"
    Write-Host "  Removed repo" -ForegroundColor $Green
}

# Check for user data
Write-Host ""
$DataExists = $false
if (Test-Path "$InstallDir\config.toml") { $DataExists = $true }
if (Test-Path "$InstallDir\profiles") { $DataExists = $true }
if (Test-Path "$InstallDir\browser_choice") { $DataExists = $true }
if (Test-Path "$InstallDir\cache") { $DataExists = $true }

if ($DataExists) {
    Write-Host "User data exists in $InstallDir" -ForegroundColor $Yellow
    $Response = Read-Host "Remove user data? (y/N)"
    if ($Response -match "^[Yy]$") {
        Remove-Item -Recurse -Force "$InstallDir" -ErrorAction SilentlyContinue
        Write-Host "  Removed user data" -ForegroundColor $Green
    }
}

Write-Host ""
Write-Host "Uninstall complete!" -ForegroundColor $Green
