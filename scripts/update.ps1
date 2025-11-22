# Formulary Windows Updater
$ErrorActionPreference = "Stop"

# Colors
$Green = [ConsoleColor]::Green
$Red = [ConsoleColor]::Red
$Blue = [ConsoleColor]::Blue

$InstallDir = "$HOME\.formulary"

Write-Host "Formulary Update" -ForegroundColor $Blue
Write-Host ""

# Check installation exists
if (-not (Test-Path "$InstallDir\repo")) {
    Write-Host "ERROR: Formulary not installed" -ForegroundColor $Red
    exit 1
}

# Update repository
Write-Host "Updating repository..." -ForegroundColor $Blue
Set-Location "$InstallDir\repo"

$CurrentCommit = git rev-parse --short HEAD
Write-Host "Current: $CurrentCommit"

git fetch origin
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to fetch updates" -ForegroundColor $Red
    exit 1
}

$Local = git rev-parse HEAD
$Remote = git rev-parse origin/main

if ($Local -eq $Remote) {
    Write-Host "Already up to date" -ForegroundColor $Green
}
else {
    git reset --hard origin/main
    $NewCommit = git rev-parse --short HEAD
    Write-Host "Updated to: $NewCommit" -ForegroundColor $Green
}

# Update dependencies
Write-Host ""
Write-Host "Updating dependencies..." -ForegroundColor $Blue
uv sync

Write-Host ""
Write-Host "Update complete!" -ForegroundColor $Green
