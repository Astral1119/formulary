# Formulary Windows Installer

$ErrorActionPreference = "Stop"

# Colors
$Green = [ConsoleColor]::Green
$Red = [ConsoleColor]::Red
$Yellow = [ConsoleColor]::Yellow
$Blue = [ConsoleColor]::Blue
$Reset = [ConsoleColor]::White

# Directories
$InstallDir = "$HOME\.formulary"
$BinDir = "$HOME\.local\bin"

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

# Check Python
function Check-Python {
    Print-Status "Checking Python version..."
    
    if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
        Print-Error "Python is not installed"
        Write-Host "Please install Python 3.12 or higher from https://www.python.org/"
        exit 1
    }
    
    $VersionInfo = python -c "import sys; print('.'.join(map(str, sys.version_info[:2])))"
    $Major, $Minor = $VersionInfo.Split('.')
    
    if ([int]$Major -lt 3 -or ([int]$Major -eq 3 -and [int]$Minor -lt 12)) {
        Print-Error "Python version $VersionInfo is installed, but version 3.12 or higher is required"
        exit 1
    }
    
    Print-Success "Python $VersionInfo detected"
}

# Check Git
function Check-Git {
    Print-Status "Checking for git..."
    
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        Print-Error "git is not installed"
        Write-Host "Please install git to continue."
        exit 1
    }
    Print-Success "git is installed"
}

# Check/Install uv
function Check-Uv {
    Print-Status "Checking for uv package manager..."
    
    if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
        Print-Warning "uv not found. Installing uv..."
        try {
            irm https://astral.sh/uv/install.ps1 | iex
        } catch {
            Print-Error "Failed to install uv"
            exit 1
        }
        
        # Add to PATH for this session
        $Env:PATH += ";$HOME\.cargo\bin"
        
        if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
            Print-Error "Failed to verify uv installation"
            exit 1
        }
        Print-Success "uv installed successfully"
    } else {
        Print-Success "uv is already installed"
    }
}

# Recommend Profile
function Recommend-Profile {
    Write-Host ""
    Print-Warning "IMPORTANT: Google Authentication"
    Write-Host ""
    Write-Host "To keep your Google account credentials isolated, it is recommended to create"
    Write-Host "a separate profile for your projects."
    Write-Host ""
    Write-Host "After installation, run:"
    Write-Host "  formulary profile add <alias>" -ForegroundColor $Green
    Write-Host ""
    Write-Host "This will create a new browser profile for your project."
    Write-Host ""
    Read-Host "Press Enter to continue..."
}

# Install Formulary
function Install-Formulary {
    Print-Status "Installing Formulary..."
    
    if (-not (Test-Path $InstallDir)) {
        New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    }
    
    if (Test-Path "$InstallDir\repo") {
        Print-Warning "Formulary is already installed at $InstallDir\repo"
        $Response = Read-Host "Do you want to reinstall? (y/N)"
        if ($Response -notmatch "^[Yy]$") {
            Print-Status "Installation cancelled"
            exit 0
        }
        Remove-Item -Recurse -Force "$InstallDir\repo"
    }
    
    Print-Status "Cloning repository..."
    try {
        git clone https://github.com/Astral1119/formulary.git "$InstallDir\repo"
    } catch {
        Print-Error "Failed to clone repository"
        exit 1
    }
    
    if (-not (Test-Path "$InstallDir\repo")) {
        Print-Error "Repository directory was not created"
        exit 1
    }
    
    Print-Success "Repository cloned successfully"
}

# Install Dependencies
function Install-Dependencies {
    Print-Status "Installing dependencies..."
    
    Set-Location "$InstallDir\repo"
    try {
        uv sync
    } catch {
        Print-Error "Failed to install dependencies"
        exit 1
    }
    
    Print-Success "Dependencies installed successfully"
}

# Install Playwright
function Install-Playwright {
    Print-Status "Installing Playwright browsers..."
    
    Set-Location "$InstallDir\repo"
    try {
        uv run playwright install
    } catch {
        Print-Warning "Failed to install Playwright browsers automatically"
        Print-Warning "You may need to run 'formulary-install-browsers' later"
        return
    }
    
    Print-Success "Playwright browsers installed successfully"
}

# Create Wrappers
function Create-Wrappers {
    Print-Status "Creating command-line wrappers..."
    
    if (-not (Test-Path $BinDir)) {
        New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
    }
    
    # Create formulary.cmd
    $FormularyCmd = "@echo off`r`n" +
                    "set FORMULARY_DIR=$InstallDir\repo`r`n" +
                    "cd /d %FORMULARY_DIR%`r`n" +
                    "uv run python -m formulary.cli %*"
    
    $FormularyCmd | Out-File -FilePath "$BinDir\formulary.cmd" -Encoding ASCII
    
    # Create formulary-install-browsers.cmd
    $BrowserCmd = "@echo off`r`n" +
                  "set FORMULARY_DIR=$InstallDir\repo`r`n" +
                  "cd /d %FORMULARY_DIR%`r`n" +
                  "uv run playwright install"
                  
    $BrowserCmd | Out-File -FilePath "$BinDir\formulary-install-browsers.cmd" -Encoding ASCII
    
    Print-Success "Command-line wrappers created at $BinDir"
}

# Setup Path
function Setup-Path {
    Print-Status "Checking PATH configuration..."
    
    if ($Env:PATH -notlike "*$BinDir*") {
        Print-Warning "$BinDir is not in your PATH"
        Write-Host ""
        Print-Warning "Please add the following directory to your PATH:"
        Write-Host "$BinDir" -ForegroundColor $Yellow
        Write-Host ""
        Write-Host "You can do this by searching for 'Environment Variables' in Windows Settings."
        Write-Host ""
    } else {
        Print-Success "PATH is already configured"
    }
}

# Main
Check-Python
Check-Git
Check-Uv
Recommend-Profile
Install-Formulary
Install-Dependencies
Install-Playwright
Create-Wrappers
Setup-Path

Write-Host ""
Write-Host "Installation Complete!" -ForegroundColor $Green
Write-Host ""
Print-Success "Formulary has been installed successfully!"
Write-Host ""
Write-Host "Quick start:"
Write-Host "  1. Ensure $BinDir is in your PATH"
Write-Host "  2. Initialize a project: formulary init `"https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/edit`""
Write-Host "  3. Install packages: formulary install hash"
Write-Host ""
Write-Host "For more information, visit: https://github.com/Astral1119/formulary"
