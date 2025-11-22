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
BIN_DIR="$HOME/.local/bin"
SKIP_CONFIRM=false

# parse arguments
for arg in "$@"; do
    case $arg in
        -y|--yes)
            SKIP_CONFIRM=true
            shift
            ;;
    esac
done

echo -e "${BLUE}Formulary Uninstaller${NC}"
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

# confirm uninstallation
confirm_uninstall() {
    if [ "$SKIP_CONFIRM" = true ]; then
        return
    fi

    echo -e "${YELLOW}Warning: This will remove Formulary from your system.${NC}"
    echo ""
    read -p "Are you sure you want to uninstall Formulary? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_status "Uninstallation cancelled"
        exit 0
    fi
}

# remove command-line wrappers
remove_wrappers() {
    print_status "Removing command-line wrappers..."
    
    if [ -f "$BIN_DIR/formulary" ]; then
        rm -f "$BIN_DIR/formulary"
        print_success "Removed formulary command"
    fi
    
    if [ -f "$BIN_DIR/formulary-install-browsers" ]; then
        rm -f "$BIN_DIR/formulary-install-browsers"
        print_success "Removed formulary-install-browsers command"
    fi
}

# remove repository and installation files
remove_installation() {
    print_status "Removing installation files..."
    
    if [ -d "$INSTALL_DIR/repo" ]; then
        rm -rf "$INSTALL_DIR/repo"
        print_success "Removed installation directory"
    else
        print_warning "Installation directory not found"
    fi
}

# ask about user data
remove_user_data() {
    echo ""
    print_warning "The following user data exists:"
    
    DATA_EXISTS=false
    
    if [ -f "$INSTALL_DIR/config.toml" ]; then
        echo "  • Configuration: $INSTALL_DIR/config.toml"
        DATA_EXISTS=true
    fi
    
    if [ -d "$INSTALL_DIR/profiles" ]; then
        echo "  • Browser profiles: $INSTALL_DIR/profiles"
        DATA_EXISTS=true
    fi
    
    if [ -f "$INSTALL_DIR/profiles.json" ]; then
        echo "  • Profile config: $INSTALL_DIR/profiles.json"
        DATA_EXISTS=true
    fi
    
    if [ -f "$INSTALL_DIR/browser_choice" ]; then
        echo "  • Browser choice: $INSTALL_DIR/browser_choice"
        DATA_EXISTS=true
    fi
    
    if [ -d "$INSTALL_DIR/cache" ]; then
        CACHE_SIZE=$(du -sh "$INSTALL_DIR/cache" 2>/dev/null | cut -f1 || echo "unknown")
        echo "  • Package cache: $INSTALL_DIR/cache ($CACHE_SIZE)"
        DATA_EXISTS=true
    fi
    
    if [ "$DATA_EXISTS" = true ]; then
        echo ""
        read -p "Do you want to remove all user data and cache? (y/N) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            print_status "Removing user data..."
            
            [ -f "$INSTALL_DIR/config.toml" ] && rm -f "$INSTALL_DIR/config.toml"
            [ -d "$INSTALL_DIR/profiles" ] && rm -rf "$INSTALL_DIR/profiles"
            [ -f "$INSTALL_DIR/profiles.json" ] && rm -f "$INSTALL_DIR/profiles.json"
            [ -f "$INSTALL_DIR/browser_choice" ] && rm -f "$INSTALL_DIR/browser_choice"
            [ -d "$INSTALL_DIR/cache" ] && rm -rf "$INSTALL_DIR/cache"
            
            # remove the entire directory if it's empty
            if [ -d "$INSTALL_DIR" ] && [ -z "$(ls -A "$INSTALL_DIR")" ]; then
                rm -rf "$INSTALL_DIR"
            fi
            
            print_success "User data removed"
        else
            print_status "User data preserved at $INSTALL_DIR"
        fi
    else
        print_status "No user data found"
        # remove the directory if it exists and is empty
        if [ -d "$INSTALL_DIR" ] && [ -z "$(ls -A "$INSTALL_DIR")" ]; then
            rm -rf "$INSTALL_DIR"
        fi
    fi
}

# cleanup PATH instructions
show_path_cleanup() {
    # detect shell
    SHELL_NAME=$(basename "$SHELL")
    case "$SHELL_NAME" in
        bash)
            SHELL_RC="$HOME/.bashrc"
            ;;
        zsh)
            SHELL_RC="$HOME/.zshrc"
            ;;
        fish)
            SHELL_RC="$HOME/.config/fish/config.fish"
            ;;
        *)
            SHELL_RC="$HOME/.profile"
            ;;
    esac
    
    echo ""
    print_warning "Manual cleanup required:"
    echo "  If you added $BIN_DIR to your PATH, you may want to remove it from:"
    echo "  $SHELL_RC"
    echo ""
}

# main uninstall flow
main() {
    confirm_uninstall
    remove_wrappers
    remove_installation
    remove_user_data
    show_path_cleanup
    
    echo ""
    echo -e "${GREEN}Uninstallation Complete!${NC}"
    echo ""
    print_success "Formulary has been uninstalled"
    echo ""
    echo "Thank you for using Formulary!"
    echo "If you have any feedback, please visit: https://github.com/Astral1119/formulary"
}

main
