#!/usr/bin/env bash
set -e

# colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # no color

# installation directory
INSTALL_DIR="$HOME/.formulary"

echo -e "${BLUE}Formulary Update${NC}"
echo ""

# function to print status messages
print_status() {
    echo -e "${BLUE}==>${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

# check if Formulary is installed
check_installation() {
    print_status "Checking for existing installation..."
    
    if [ ! -d "$INSTALL_DIR/repo" ]; then
        print_error "Formulary is not installed at $INSTALL_DIR/repo"
        echo "Please run install.sh first"
        exit 1
    fi
    
    print_success "Found existing installation"
}

# get current version/commit
get_current_version() {
    cd "$INSTALL_DIR/repo"
    CURRENT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
    print_status "Current version: $CURRENT_COMMIT"
}

# pull latest changes
update_repository() {
    print_status "Fetching latest updates..."
    
    cd "$INSTALL_DIR/repo"
    
    # stash any local changes
    if ! git diff-index --quiet HEAD --; then
        print_warning "You have local changes. Stashing them..."
        git stash push -m "Auto-stash before update $(date +%Y%m%d_%H%M%S)"
    fi
    
    # pull latest changes
    git fetch origin || {
        print_error "Failed to fetch updates from remote"
        exit 1
    }
    
    # check if there are updates
    LOCAL=$(git rev-parse HEAD)
    REMOTE=$(git rev-parse origin/main)
    
    if [ "$LOCAL" = "$REMOTE" ]; then
        print_success "Already up to date!"
        return 0
    fi
    
    print_status "New updates available. Updating..."
    git pull origin main || {
        print_error "Failed to pull updates"
        exit 1
    }
    
    NEW_COMMIT=$(git rev-parse --short HEAD)
    print_success "Updated to version: $NEW_COMMIT"
}

# update dependencies
update_dependencies() {
    print_status "Updating dependencies..."
    
    cd "$INSTALL_DIR/repo"
    uv sync || {
        print_error "Failed to update dependencies"
        exit 1
    }
    
    print_success "Dependencies updated successfully"
}

# update Playwright browsers if needed
update_playwright() {
    print_status "Checking Playwright browsers..."
    
    read -p "Do you want to update Playwright browsers? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        cd "$INSTALL_DIR/repo"
        uv run playwright install || {
            print_warning "Failed to update Playwright browsers"
            print_warning "You can update them later by running 'formulary-install-browsers'"
            return
        }
        print_success "Playwright browsers updated"
    else
        print_status "Skipping Playwright browser update"
    fi
}

# show changelog if available
show_changelog() {
    print_status "Recent changes:"
    echo ""
    
    cd "$INSTALL_DIR/repo"
    git log --oneline --decorate --graph -10 || true
    echo ""
}

# main update flow
main() {
    check_installation
    get_current_version
    update_repository
    update_dependencies
    update_playwright
    
    echo ""
    echo -e "${GREEN}Update Complete!${NC}"
    echo ""
    print_success "Formulary has been updated successfully!"
    echo ""
    
    show_changelog
}

main
