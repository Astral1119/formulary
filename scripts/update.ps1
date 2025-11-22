# Formulary Windows Updater

$ErrorActionPreference = "Stop"

# Colors
$Green = [ConsoleColor]::Green
$Red = [ConsoleColor]::Red
$Yellow = [ConsoleColor]::Yellow
$Blue = [ConsoleColor]::Blue

# Directories
$InstallDir = "$HOME\.formulary"

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

Write-Host "Formulary Update" -ForegroundColor $Blue
Write-Host ""

# Check Installation
Print-Status "Checking for existing installation..."

if (-not (Test-Path "$InstallDir\repo")) {
    Print-Error "Formulary is not installed at $InstallDir\repo"
    Write-Host "Please run install.ps1 first"
    exit 1
}

Print-Success "Found existing installation"

# Get Current Version
Set-Location "$InstallDir\repo"
$CurrentCommit = git rev-parse --short HEAD
Print-Status "Current version: $CurrentCommit"

# Update Repository
Print-Status "Fetching latest updates..."

# Stash local changes
$GitStatus = git diff-index --quiet HEAD --
if ($LASTEXITCODE -ne 0) {
    Print-Warning "You have local changes. Stashing them..."
    $Date = Get-Date -Format "yyyyMMdd_HHmmss"
    git stash push -m "Auto-stash before update $Date"
}

# Fetch
git fetch origin
if ($LASTEXITCODE -ne 0) {
    Print-Error "Failed to fetch updates from remote"
    exit 1
}

# Check for updates
$Local = git rev-parse HEAD
$Remote = git rev-parse origin/main

if ($Local -eq $Remote) {
    Print-Success "Already up to date!"
} else {
    Print-Status "New updates available. Updating..."
    
    # Force update
    git reset --hard origin/main
    if ($LASTEXITCODE -ne 0) {
        Print-Error "Failed to update repository"
        exit 1
    }
    
    $NewCommit = git rev-parse --short HEAD
    Print-Success "Updated to version: $NewCommit"
}

# Update Dependencies
Print-Status "Updating dependencies..."

Set-Location "$InstallDir\repo"
try {
    uv sync
} catch {
    Print-Error "Failed to update dependencies"
    exit 1
}

Print-Success "Dependencies updated successfully"

# Update Playwright
Print-Status "Checking Playwright browsers..."

$Response = Read-Host "Do you want to update Playwright browsers? (y/N)"
if ($Response -match "^[Yy]$") {
    Set-Location "$InstallDir\repo"
    try {
        uv run playwright install
    } catch {
        Print-Warning "Failed to update Playwright browsers"
        Print-Warning "You can update them later by running 'formulary-install-browsers'"
        return
    }
    Print-Success "Playwright browsers updated"
} else {
    Print-Status "Skipping Playwright browser update"
}

Write-Host ""
Write-Host "Update Complete!" -ForegroundColor $Green
Write-Host ""
Print-Success "Formulary has been updated successfully!"
Write-Host ""
