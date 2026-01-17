#!/bin/bash

set -euo pipefail

readonly HYPANEL_VERSION="${HYPANEL_VERSION:-latest}"
readonly HYPANEL_USER="hypanel"
readonly HYPANEL_HOME="/home/${HYPANEL_USER}"
readonly HYPANEL_INSTALL_DIR="/opt/hypanel"
readonly HYPANEL_CONFIG_DIR="/etc/hypanel"
readonly HYPANEL_LOG_DIR="/var/log/hypanel"
readonly HYPANEL_SERVERS_DIR="${HYPANEL_HOME}/hytale"
readonly HYPANEL_SERVICE_FILE="/etc/systemd/system/hypanel.service"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] $*"
}

error() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [ERROR] $*" >&2
    exit 1
}

warning() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [WARNING] $*"
}

check_root() {
    if [[ $EUID -ne 0 ]]; then
        error "This script must be run as root. Please use 'sudo $0'"
    fi
}

detect_os() {
    if [[ -f /etc/os-release ]]; then
        . /etc/os-release
        OS="$ID"
        OS_VERSION="$VERSION_ID"
    else
        error "Cannot detect operating system. /etc/os-release not found."
    fi

    case "$OS" in
        ubuntu)
            if [[ "${OS_VERSION%%.*}" -lt 24 ]]; then
                error "Ubuntu 24.04 or later is required. Found: $PRETTY_NAME"
            fi
            ;;
        debian)
            if [[ "${OS_VERSION%%.*}" -lt 12 ]]; then
                error "Debian 12 or later is required. Found: $PRETTY_NAME"
            fi
            ;;
        *)
            error "Unsupported operating system: $OS. Only Ubuntu 24.04+ and Debian 12+ are supported."
            ;;
    esac

    log "Detected OS: $PRETTY_NAME"
}

create_user() {
    if ! id "$HYPANEL_USER" &>/dev/null; then
        log "Creating user: $HYPANEL_USER"
        useradd --system --home "$HYPANEL_HOME" --shell /bin/bash "$HYPANEL_USER"
        log "Created user $HYPANEL_USER with home directory $HYPANEL_HOME"
    else
        log "User $HYPANEL_USER already exists"
    fi

    if [[ ! -d "$HYPANEL_HOME" ]]; then
        mkdir -p "$HYPANEL_HOME"
        chown "$HYPANEL_USER:$HYPANEL_USER" "$HYPANEL_HOME"
        chmod 755 "$HYPANEL_HOME"
    fi
}

prompt_password() {
    log "Setting password for $HYPANEL_USER user"
    log "You will be prompted to enter a password for the $HYPANEL_USER user."
    log "This password is used for system access, not for the hypanel application."
    log "Press Ctrl+C to skip if you prefer to set it manually later."
    
    if passwd "$HYPANEL_USER"; then
        log "Password set successfully for $HYPANEL_USER"
    else
        warning "Failed to set password. You can set it manually later with: passwd $HYPANEL_USER"
    fi
}

install_packages() {
    log "Updating package lists"
    apt-get update -qq

    local packages=(
        "curl"
        "ca-certificates"
        "unzip"
        "tar"
        "jq"
    )

    local missing_packages=()
    for package in "${packages[@]}"; do
        if ! dpkg -l | grep -q "^ii  $package "; then
            missing_packages+=("$package")
        fi
    done

    if [[ ${#missing_packages[@]} -gt 0 ]]; then
        log "Installing missing packages: ${missing_packages[*]}"
        apt-get install -y "${missing_packages[@]}"
    else
        log "All required base packages are already installed"
    fi
}

install_java() {
    log "Checking Java installation"
    
    if command -v java &> /dev/null; then
        local java_version
        java_version=$(java -version 2>&1 | head -n1 | cut -d'"' -f2 | cut -d'.' -f1)
        if [[ "$java_version" -ge 25 ]]; then
            log "Java $java_version is already installed"
            return
        else
            warning "Java $java_version found, but Java 25+ is required"
        fi
    fi

    log "Installing Java 25 (OpenJDK)"
    case "$OS" in
        ubuntu)
            apt-get install -y openjdk-25-jdk
            ;;
        debian)
            apt-get install -y openjdk-25-jdk
            ;;
    esac

    if java -version 2>&1 | head -n1 | grep -q "openjdk 25"; then
        log "Java 25 installed successfully"
    else
        error "Java 25 installation failed"
    fi
}

install_nodejs() {
    log "Checking Node.js installation"
    
    if command -v node &> /dev/null; then
        local node_version
        node_version=$(node --version | sed 's/v//' | cut -d'.' -f1)
        if [[ "$node_version" -ge 20 ]]; then
            log "Node.js $(node --version) is already installed"
            return
        else
            warning "Node.js $(node --version) found, but Node.js 20+ is required"
        fi
    fi

    log "Installing Node.js 20 LTS from NodeSource repository"
    
    local nodescript="/tmp/setup_nodejs.sh"
    curl -fsSL https://deb.nodesource.com/setup_20.x -o "$nodescript"
    chmod +x "$nodescript"
    bash "$nodescript"
    rm -f "$nodescript"

    apt-get install -y nodejs

    if node --version | grep -q "v20"; then
        log "Node.js $(node --version) installed successfully"
    else
        error "Node.js 20 installation failed"
    fi
}

create_directories() {
    log "Creating hypanel directories"
    
    local directories=(
        "$HYPANEL_INSTALL_DIR"
        "$HYPANEL_CONFIG_DIR"
        "$HYPANEL_LOG_DIR"
        "$HYPANEL_SERVERS_DIR"
    )

    for dir in "${directories[@]}"; do
        if [[ ! -d "$dir" ]]; then
            mkdir -p "$dir"
            log "Created directory: $dir"
        else
            log "Directory already exists: $dir"
        fi
    done

    chown -R "$HYPANEL_USER:$HYPANEL_USER" "$HYPANEL_SERVERS_DIR"
    chmod 755 "$HYPANEL_SERVERS_DIR"

    chown -R "$HYPANEL_USER:$HYPANEL_USER" "$HYPANEL_LOG_DIR"
    chmod 755 "$HYPANEL_LOG_DIR"

    chmod 755 "$HYPANEL_CONFIG_DIR"
    chown root:root "$HYPANEL_CONFIG_DIR"

    chmod 755 "$HYPANEL_INSTALL_DIR"
    chown root:root "$HYPANEL_INSTALL_DIR"
}

download_and_install_hypanel() {
    log "Downloading and installing hypanel $HYPANEL_VERSION"
    
    local temp_download="/tmp/hypanel-${HYPANEL_VERSION}.tar.gz"
    
    if [[ "$HYPANEL_VERSION" == "latest" ]]; then
        local download_url
        download_url=$(curl -s https://api.github.com/repos/hypanel/hypanel/releases/latest | grep "tarball_url" | cut -d '"' -f4)
        if [[ -z "$download_url" ]]; then
            error "Failed to fetch latest release URL from GitHub API"
        fi
        log "Downloading latest release from: $download_url"
    else
        local download_url="https://github.com/hypanel/hypanel/archive/refs/tags/v${HYPANEL_VERSION}.tar.gz"
        log "Downloading version $HYPANEL_VERSION from: $download_url"
    fi

    curl -fsSL "$download_url" -o "$temp_download"
    
    if [[ ! -f "$temp_download" ]]; then
        error "Failed to download hypanel"
    fi

    local temp_extract="/tmp/hypanel-extract"
    rm -rf "$temp_extract"
    mkdir -p "$temp_extract"
    
    tar -xzf "$temp_download" -C "$temp_extract" --strip-components=1
    
    rsync -a "$temp_extract/" "$HYPANEL_INSTALL_DIR/"
    
    rm -rf "$temp_extract"
    rm -f "$temp_download"

    log "Building backend and webpanel..."
    
    # Build backend
    cd "$HYPANEL_INSTALL_DIR/apps/backend"
    if ! npm install --production=false; then
        error "Failed to install backend dependencies"
    fi
    
    if ! npm run build; then
        error "Failed to build backend"
    fi
    
    # Build webpanel
    cd "$HYPANEL_INSTALL_DIR/apps/webpanel"
    if ! npm install --production=false; then
        error "Failed to install webpanel dependencies"
    fi
    
    if ! npm run build; then
        error "Failed to build webpanel"
    fi
    
    cd "$HYPANEL_INSTALL_DIR"
    
    # Set proper permissions
    chmod -R 644 "$HYPANEL_INSTALL_DIR"/*
    find "$HYPANEL_INSTALL_DIR" -type d -exec chmod 755 {} \;
    chmod +x "$HYPANEL_INSTALL_DIR"/apps/backend/dist/index.js 2>/dev/null || true

    chown -R root:root "$HYPANEL_INSTALL_DIR"
    
    log "hypanel installed and built successfully to $HYPANEL_INSTALL_DIR"
    log "Webpanel will be served by the Node daemon at http://$(hostname -I | awk '{print $1}'):3000"
}

create_config_files() {
    log "Creating configuration files"
    
    local env_file="$HYPANEL_CONFIG_DIR/hypanel.env"
    if [[ ! -f "$env_file" ]]; then
        cat > "$env_file" << EOF
# hypanel Environment Configuration
NODE_ENV=production
PORT=3000
HYPANEL_LOG_DIR=$HYPANEL_LOG_DIR
HYPANEL_SERVERS_DIR=$HYPANEL_SERVERS_DIR
EOF
        chmod 640 "$env_file"
        chown root:root "$env_file"
        log "Created environment file: $env_file"
    else
        log "Environment file already exists: $env_file"
    fi
}

create_systemd_service() {
    log "Creating systemd service"
    
    cat > "$HYPANEL_SERVICE_FILE" << EOF
[Unit]
Description=hypanel - Hytale Server Management Panel
After=network.target

[Service]
Type=simple
User=$HYPANEL_USER
Group=$HYPANEL_USER
WorkingDirectory=$HYPANEL_INSTALL_DIR
EnvironmentFile=$HYPANEL_CONFIG_DIR/hypanel.env
ExecStart=/usr/bin/node $HYPANEL_INSTALL_DIR/apps/backend/dist/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=hypanel

# Security settings
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$HYPANEL_SERVERS_DIR $HYPANEL_LOG_DIR

[Install]
WantedBy=multi-user.target
EOF

    chmod 644 "$HYPANEL_SERVICE_FILE"
    chown root:root "$HYPANEL_SERVICE_FILE"
    
    systemctl daemon-reload
    systemctl enable hypanel
    
    log "systemd service created and enabled"
}

start_service() {
    log "Starting hypanel service"
    
    if systemctl is-active --quiet hypanel; then
        log "hypanel service is already running"
        systemctl restart hypanel
    else
        systemctl start hypanel
    fi

    sleep 3
    
    if systemctl is-active --quiet hypanel; then
        log "hypanel service started successfully"
        log "Service status: $(systemctl is-active hypanel)"
    else
        error "Failed to start hypanel service"
    fi
}

show_completion_info() {
    log "Installation completed successfully!"
    echo
    echo "=== hypanel Installation Complete ==="
    echo
    echo "Service Status:"
    echo "  systemctl status hypanel"
    echo
    echo "View Logs:"
    echo "  journalctl -u hypanel -f"
    echo
    echo "Service Commands:"
    echo "  Start:   systemctl start hypanel"
    echo "  Stop:    systemctl stop hypanel"
    echo "  Restart: systemctl restart hypanel"
    echo
    echo "Configuration:"
    echo "  Environment: $HYPANEL_CONFIG_DIR/hypanel.env"
    echo "  Servers Directory: $HYPANEL_SERVERS_DIR"
    echo "  Logs: $HYPANEL_LOG_DIR"
    echo
    echo "Web Panel:"
    echo "  URL: http://$(hostname -I | awk '{print $1}'):3000"
    echo "  Port: 3000"
    echo
    echo "User Account:"
    echo "  System user: $HYPANEL_USER"
    echo "  Home directory: $HYPANEL_HOME"
    echo "  Set/change password: passwd $HYPANEL_USER"
    echo
}

main() {
    log "Starting hypanel installation script"
    log "Version: $HYPANEL_VERSION"
    
    check_root
    detect_os
    create_user
    prompt_password
    install_packages
    install_java
    install_nodejs
    create_directories
    download_and_install_hypanel
    create_config_files
    create_systemd_service
    start_service
    show_completion_info
    
    log "hypanel installation script completed successfully"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi