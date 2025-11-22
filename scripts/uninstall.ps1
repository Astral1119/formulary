# Formulary Windows Uninstaller

$ErrorActionPreference = "Stop"

# Colors
$Green = [ConsoleColor]::Green
$Red = [ConsoleColor]::Red
$Yellow = [ConsoleColor]::Yellow
$Blue = [ConsoleColor]::Blue

# Directories
$InstallDir = "$HOME\.formulary"
$BinDir = "$HOME\.local\bin"

# Parse arguments
$SkipConfirm = $false
foreach ($arg in $args) {
    if ($arg -eq "-y" -or $arg -eq "--yes") {
        $SkipConfirm = $true
    }
}

function Print-Status($Message) {
    Write-Host "==> $Message" -ForegroundColor $Blue
}

function Print-Success($Message) {
    Write-Host "✓ $Message" -ForegroundColor $Green
}

function Print-Error($Message) {
    Write-Host "✗ $Message" -ForegroundColor $Red
}

function Print-Warning($Message) {
    Write-Host "⚠ $Message" -ForegroundColor $Yellow
}

Write-Host "Formulary Uninstaller" -ForegroundColor $Blue
Write-Host ""

# Confirm Uninstall
if (-not $SkipConfirm) {
    Print-Warning "Warning: This will remove Formulary from your system."
    Write-Host ""
    $Response = Read-Host "Are you sure you want to uninstall Formulary? (y/N)"
    if ($Response -notmatch "^[Yy]$") {
        Print-Status "Uninstallation cancelled"
        exit 0
    }
}

# Remove Wrappers
Print-Status "Removing command-line wrappers..."

if (Test-Path "$BinDir\formulary.cmd") {
    Remove-Item -Force "$BinDir\formulary.cmd"
    Print-Success "Removed formulary command"
}

if (Test-Path "$BinDir\formulary-install-browsers.cmd") {
    Remove-Item -Force "$BinDir\formulary-install-browsers.cmd"
    Print-Success "Removed formulary-install-browsers command"
}

# Remove Installation
Print-Status "Removing installation files..."

if (Test-Path "$InstallDir\repo") {
    Remove-Item -Recurse -Force "$InstallDir\repo"
    Print-Success "Removed installation directory"
}
else {
    Print-Warning "Installation directory not found"
}

# Remove User Data
Write-Host ""
Print-Warning "The following user data exists:"

$DataExists = $false

if (Test-Path "$InstallDir\config.toml") {
    Write-Host "  • Configuration: $InstallDir\config.toml"
    $DataExists = $true
}

if (Test-Path "$InstallDir\profiles") {
    Write-Host "  • Browser profiles: $InstallDir\profiles"
    $DataExists = $true
}

if (Test-Path "$InstallDir\profiles.json") {
    Write-Host "  • Profile config: $InstallDir\profiles.json"
    $DataExists = $true
}

if (Test-Path "$InstallDir\browser_choice") {
    Write-Host "  • Browser choice: $InstallDir\browser_choice"
    $DataExists = $true
}

if (Test-Path "$InstallDir\cache") {
    Write-Host "  • Package cache: $InstallDir\cache"
    $DataExists = $true
}

if ($DataExists) {
    Write-Host ""
    $Response = Read-Host "Do you want to remove all user data and cache? (y/N)"
    if ($Response -match "^[Yy]$") {
        Print-Status "Removing user data..."
        
        if (Test-Path "$InstallDir\config.toml") { Remove-Item -Force "$InstallDir\config.toml" }
        if (Test-Path "$InstallDir\profiles") { Remove-Item -Recurse -Force "$InstallDir\profiles" }
        if (Test-Path "$InstallDir\profiles.json") { Remove-Item -Force "$InstallDir\profiles.json" }
        if (Test-Path "$InstallDir\browser_choice") { Remove-Item -Force "$InstallDir\browser_choice" }
        if (Test-Path "$InstallDir\cache") { Remove-Item -Recurse -Force "$InstallDir\cache" }
        
        # Remove directory if empty
        if ((Get-ChildItem $InstallDir -ErrorAction SilentlyContinue).Count -eq 0) {
            Remove-Item -Force $InstallDir
        }
        
        Print-Success "User data removed"
    }
    else {
        Print-Status "User data preserved at $InstallDir"
    }
}
else {
    Print-Status "No user data found"
    if (Test-Path $InstallDir -and (Get-ChildItem $InstallDir -ErrorAction SilentlyContinue).Count -eq 0) {
        Remove-Item -Force $InstallDir
    }
}

# Path Cleanup
Write-Host ""
Print-Warning "Manual cleanup required:"
Write-Host "  If you added $BinDir to your PATH, you may want to remove it."
Write-Host ""

Write-Host "Uninstallation Complete!" -ForegroundColor $Green
Write-Host ""
Print-Success "Formulary has been uninstalled"
Write-Host ""
Write-Host "Thank you for using Formulary!"
Write-Host "If you have any feedback, please visit: https://github.com/Astral1119/formulary"
