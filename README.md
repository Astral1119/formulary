# Formulary - Google Sheets Package Manager

A package manager for Google Sheets that enables you to install, manage, and share reusable named functions across spreadsheets.

## Features

- **Package Installation**: Install named functions from the [Formulary registry](https://github.com/Astral1119/formulary-registry)
- **Multi-Account Support**: Manage multiple Google accounts with profile switching
- **Dependency Resolution**: Automatic dependency resolution
- **Lockfile Management**: Deterministic installations with integrity checks
- **Local Caching**: Artifacts cached locally for faster subsequent installations
- **Version Constraints**: Semantic versioning support with flexible version specifiers
- **Automated Browser Control**: Reliable Playwright-based Google Sheets automation
- **Private Sheets**: Keep your sheets private - authentication is stored in profiles

## Installation

### Prerequisites

- Python 3.12 or higher
- Google account with access to Google Sheets

### Installation

**macOS / Linux:**

```bash
curl -fsSL https://raw.githubusercontent.com/Astral1119/formulary/main/scripts/install.sh | bash
```

**Windows (PowerShell):**

> [!IMPORTANT]
> Windows users must configure PowerShell execution policy before installation.
> Run PowerShell as Administrator and execute:
> ```powershell
> Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
> ```

Then run the installer:

```powershell
irm https://raw.githubusercontent.com/Astral1119/formulary/main/scripts/install.ps1 | iex
```

## Updating

To update Formulary to the latest version:

```bash
formulary self-update
```

Formulary automatically checks for updates periodically and will notify you when a new version is available.

## Uninstalling

To remove Formulary from your system:

```bash
formulary self-uninstall
```

## Quick Start

### 1. Create Authentication Profile

Before using Formulary, create an authentication profile. This will open a browser for you to sign in with Google:

```bash
formulary profile add personal
```

The browser will open and prompt you to authenticate. Once complete, your authentication is saved for future use.

**Managing Profiles:**
```bash
formulary profile list              # List all profiles
formulary profile switch work       # Switch to different profile
formulary profile show              # Show active profile details
```

### 2. Initialize a Project

Link your Google Sheet to Formulary:

```bash
formulary init "https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/edit"
```

### 3. Install Packages

Install one or more packages from the registry:

```bash
formulary install hash
```

Multiple packages:

```bash
formulary install package1 package2 package3
```

### 4. Other Commands

```bash
formulary remove <package>          # Remove installed packages
formulary upgrade                   # Upgrade all packages
formulary upgrade <package>         # Upgrade specific package
formulary publish                   # Publish your package to registry
formulary info <package>            # Show package information
```

## Profile Management

Formulary uses profiles to manage Google authentication securely. This allows you to:
- Keep your sheets private (no need to share publicly)
- Manage multiple Google accounts
- Switch between accounts easily

**Profile Commands:**
```bash
formulary profile add <alias>       # Create new profile (opens browser)
formulary profile remove <alias>    # Remove a profile
formulary profile list              # List all profiles
formulary profile switch <alias>    # Switch active profile
formulary profile show              # Show active profile details
```

All profiles are stored in `~/.formulary/profiles/` with separate authentication data.

## Key Components

- **Profile Manager**: Manages Google authentication and account switching
- **Domain Models**: Core data structures (Package, Dependency, Function, Lockfile)
- **Registry Client**: Fetches package metadata and artifacts from GitHub
- **Dependency Resolver**: Uses `resolvelib` for constraint satisfaction
- **Sheet Client**: Playwright-based automation for Google Sheets manipulation
- **Packager**: Handles `.gspkg` archive creation and extraction
- **Install Service**: Orchestrates the complete installation workflow

## Project Structure

```
src/formulary/
├── cli/              # Command-line interface
├── profiles/         # Profile management and authentication
├── config.py         # Configuration management
├── domain/           # Domain models (Package, Function, etc.)
├── bundling/         # Package format handling (.gspkg)
├── registry/         # Registry client and caching
├── resolution/       # Dependency resolution
├── services/         # Business logic (InstallService, etc.)
├── sheets/           # Google Sheets integration (Playwright)
└── utils/            # Utility functions (hashing)

tests/                # Unit tests
└── test_*.py         # Test suites for each module
```

## Configuration

Formulary stores configuration in `~/.formulary/`:

- `profiles/`: Authentication profiles for different Google accounts
- `cache/`: Downloaded package artifacts
- `config.toml`: Active sheet URL and settings

## Roadmap

- [x] Package removal (`remove` command)
- [x] Package upgrades (`upgrade` command)  
- [x] Package publishing (`publish` command)
- [x] Multi-account support with profiles
- [ ] Project management (switch between sheets easily)
- [ ] Configurable registry URL
- [ ] Private package support
- [ ] Package search functionality
- [ ] Named version-based backups
- [ ] Rich status bars for command progress

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.