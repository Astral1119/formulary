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

echo -e "${BLUE}Formulary - Google Sheets Package Manager${NC}"
echo ""

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

# check if Python 3.12+ is installed
check_python() {
    print_status "Checking Python version..."
    
    if ! command -v python3 &> /dev/null; then
        print_error "Python 3 is not installed"
        echo "Please install Python 3.12 or higher from https://www.python.org/"
        exit 1
    fi
    
    PYTHON_VERSION=$(python3 -c 'import sys; print(".".join(map(str, sys.version_info[:2])))')
    REQUIRED_VERSION="3.12"
    
    if [ "$(printf '%s\n' "$REQUIRED_VERSION" "$PYTHON_VERSION" | sort -V | head -n1)" != "$REQUIRED_VERSION" ]; then
        print_error "Python version $PYTHON_VERSION is installed, but version $REQUIRED_VERSION or higher is required"
        exit 1
    fi
    
    print_success "Python $PYTHON_VERSION detected"
}

# check if git is installed
check_git() {
    print_status "Checking for git..."
    
    if ! command -v git &> /dev/null; then
        print_error "git is not installed"
        echo "Please install git to continue."
        exit 1
    fi
    print_success "git is installed"
}

# check if uv is installed, if not install it
check_uv() {
    print_status "Checking for uv package manager..."
    
    if ! command -v uv &> /dev/null; then
        print_warning "uv not found. Installing uv..."
        curl -LsSf https://astral.sh/uv/install.sh | sh
        
        # add uv to path for this session
        export PATH="$HOME/.cargo/bin:$PATH"
        
        if ! command -v uv &> /dev/null; then
            print_error "Failed to install uv"
            exit 1
        fi
        print_success "uv installed successfully"
    else
        print_success "uv is already installed"
    fi
}

# recommend creating a formulary profile
recommend_formulary_profile() {
    echo ""
    print_warning "IMPORTANT: Google Authentication"
    echo ""
    echo "After installation, run:"
    echo -e "  ${GREEN}formulary profile add <alias>${NC}"
    echo ""
    echo "This will create a new browser profile for your project."
    echo ""
    if [ -t 0 ]; then
        read -p "Press Enter to continue..."
    elif [ -c /dev/tty ]; then
        read -p "Press Enter to continue..." < /dev/tty
    fi
}

# clone or update the repository
install_formulary() {
    print_status "Installing Formulary..."
    
    # create installation directory if it doesn't exist
    if ! mkdir -p "$INSTALL_DIR"; then
        print_error "Failed to create directory $INSTALL_DIR"
        exit 1
    fi
    
    # clone the repository
    if [ -d "$INSTALL_DIR/repo" ]; then
        print_warning "Formulary is already installed at $INSTALL_DIR/repo"
        if [ -t 0 ]; then
            read -p "Do you want to reinstall? (y/N) " -n 1 -r
        elif [ -c /dev/tty ]; then
            read -p "Do you want to reinstall? (y/N) " -n 1 -r < /dev/tty
        else
            # non-interactive, assume no
            REPLY="n"
        fi
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            print_status "Installation cancelled"
            exit 0
        fi
        rm -rf "$INSTALL_DIR/repo"
    fi
    
    print_status "Cloning repository..."
    if ! git clone https://github.com/Astral1119/formulary.git "$INSTALL_DIR/repo"; then
        print_error "Failed to clone repository"
        exit 1
    fi

    if [ ! -d "$INSTALL_DIR/repo" ]; then
        print_error "Repository directory was not created at $INSTALL_DIR/repo"
        exit 1
    fi
    
    print_success "Repository cloned successfully"
}

# install dependencies
install_dependencies() {
    print_status "Installing dependencies..."
    
    cd "$INSTALL_DIR/repo"
    uv sync || {
        print_error "Failed to install dependencies"
        exit 1
    }
    
    print_success "Dependencies installed successfully"
}

# install Playwright browsers
install_playwright() {
    print_status "Installing Playwright browsers..."
    
    cd "$INSTALL_DIR/repo"
    uv run playwright install || {
        print_warning "Failed to install Playwright browsers automatically"
        print_warning "You may need to run 'formulary-install-browsers' later"
        return
    }
    
    print_success "Playwright browsers installed successfully"
}

# create executable wrapper scripts
create_wrapper() {
    print_status "Creating command-line wrapper..."
    
    mkdir -p "$BIN_DIR"
    
    # create formulary wrapper
    cat > "$BIN_DIR/formulary" << 'EOF'
#!/usr/bin/env bash
FORMULARY_DIR="$HOME/.formulary/repo"
cd "$FORMULARY_DIR"
uv run python -m formulary.cli "$@"
EOF
    
    chmod +x "$BIN_DIR/formulary"
    
    # create browser install helper
    cat > "$BIN_DIR/formulary-install-browsers" << 'EOF'
#!/usr/bin/env bash
FORMULARY_DIR="$HOME/.formulary/repo"
cd "$FORMULARY_DIR"
uv run playwright install
EOF
    
    chmod +x "$BIN_DIR/formulary-install-browsers"
    
    print_success "Command-line wrapper created at $BIN_DIR/formulary"
}

# add to PATH if needed
setup_path() {
    print_status "Checking PATH configuration..."
    
    if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
        print_warning "$BIN_DIR is not in your PATH"
        
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
        print_warning "Add the following line to your $SHELL_RC:"
        echo -e "${YELLOW}export PATH=\"\$HOME/.local/bin:\$PATH\"${NC}"
        echo ""
        print_warning "Or run: echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> $SHELL_RC"
        echo ""
    else
        print_success "PATH is already configured"
    fi
}

# main installation flow
main() {
    check_python
    check_git
    check_uv
    recommend_formulary_profile
    install_formulary
    install_dependencies
    install_playwright
    create_wrapper
    setup_path
    
    echo ""
    echo -e "${GREEN}Installation Complete!${NC}"
    echo ""
    print_success "Formulary has been installed successfully!"
    echo ""
    echo "Quick start:"
    echo "  1. Restart your shell or run: source ~/.${SHELL##*/}rc"
    echo "  2. Initialize a project: formulary init \"https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/edit\""
    echo "  3. Install packages: formulary install hash"
    echo ""
    echo "For more information, visit: https://github.com/Astral1119/formulary"
}

main
