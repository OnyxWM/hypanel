#!/bin/bash

set -euo pipefail

readonly HYPANEL_VERSION="${HYPANEL_VERSION:-latest}"
readonly CHANNEL="${CHANNEL:-}"
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

run_as_hypanel() {
    local cmd="$*"
    if [[ $EUID -eq 0 ]]; then
        sudo -u "$HYPANEL_USER" bash -c "$cmd"
    else
        bash -c "$cmd"
    fi
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
        OS_VERSION="${VERSION_ID:-}"
    else
        error "Cannot detect operating system. /etc/os-release not found."
    fi

    case "$OS" in
        ubuntu)
            if [[ -z "$OS_VERSION" ]] || [[ "${OS_VERSION%%.*}" -lt 22 ]]; then
                warning "Ubuntu 22.04 or later is recommended. Found: $PRETTY_NAME"
            else
                log "Detected OS: $PRETTY_NAME (fully supported)"
            fi
            ;;
        debian)
            if [[ -z "$OS_VERSION" ]] || [[ "${OS_VERSION%%.*}" -lt 12 ]]; then
                warning "Debian 12 or later is recommended. Found: $PRETTY_NAME"
            else
                log "Detected OS: $PRETTY_NAME (fully supported)"
            fi
            ;;
        *)
            warning "Detected OS: $PRETTY_NAME"
            warning "hypanel is recommended for Debian 12+ or Ubuntu 22.04+"
            warning "Core functionality should work, but some features may require manual setup"
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
    fi
    # Always ensure correct ownership and permissions for home directory
    chown "$HYPANEL_USER:$HYPANEL_USER" "$HYPANEL_HOME"
    chmod 755 "$HYPANEL_HOME"
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
    log "Checking required packages"

    case "$OS" in
        ubuntu|debian)
            ;;
        *)
            warning "Package installation skipped on $OS"
            warning "Please install the following packages manually:"
            warning "  curl ca-certificates unzip tar jq rsync sudo libpam0g-dev"
            return 0
            ;;
    esac

    log "Updating package lists"
    apt-get update -qq

    local packages=(
        "curl"
        "ca-certificates"
        "unzip"
        "tar"
        "jq"
        "build-essential"
        "python3"
        "rsync"
        "sudo"
        "libpam0g-dev"
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

    log "Installing Java 25 (Temurin)"
    
    local java_dir="/opt/jdk-25"
    local temp_java="/tmp/jdk-25.tar.gz"
    
    log "Downloading Temurin 25 x64 from Adoptium"
    curl -fsSL "https://github.com/adoptium/temurin25-binaries/releases/download/jdk-25.0.1%2B8/OpenJDK25U-jdk_x64_linux_hotspot_25.0.1_8.tar.gz" -o "$temp_java"
    
    log "Extracting Java to $java_dir"
    mkdir -p "$java_dir"
    tar -xzf "$temp_java" -C "$java_dir" --strip-components=1
    
    rm -f "$temp_java"
    
    # Create symlinks
    ln -sf "$java_dir/bin/java" /usr/local/bin/java
    ln -sf "$java_dir/bin/javac" /usr/local/bin/javac
    
    log "Java 25 installed to $java_dir"

    # Verify Java 25 installation by checking version number
    local java_version_check
    java_version_check=$(java -version 2>&1 | head -n1 | cut -d'"' -f2 | cut -d'.' -f1)
    if [[ -n "$java_version_check" ]] && [[ "$java_version_check" -ge 25 ]]; then
        log "Java $java_version_check installed successfully"
    else
        error "Java 25 installation failed. Detected version: ${java_version_check:-unknown}"
    fi
}

install_nodejs() {
    log "Checking Node.js installation"

    # Find Node.js 24+ (current LTS is 24)
    find_node_for_build() {
        # Prefer Node.js 24 from /opt
        if [[ -f "/opt/nodejs-24/bin/node" ]]; then
            echo "/opt/nodejs-24/bin/node"
        # Check nvm for Node.js 24
        elif [[ -f "/home/${SUDO_USER:-$(whoami)}/.nvm/versions/node/v24.13.0/bin/node" ]]; then
            echo "/home/${SUDO_USER:-$(whoami)}/.nvm/versions/node/v24.13.0/bin/node"
        # Check system Node.js for version 24+
        elif command -v node &> /dev/null; then
            local version=$(node --version 2>/dev/null | sed 's/v//' | cut -d'.' -f1)
            if [[ "$version" -ge 24 ]]; then
                echo "$(command -v node)"
            else
                echo ""
            fi
        else
            echo ""
        fi
    }

    local node_path=$(find_node_for_build)

    if [[ -n "$node_path" ]]; then
        log "Node.js $( "$node_path" --version ) found (compatible version)"
    else
        log "Installing Node.js 24 LTS"

        local node_dir="/opt/nodejs-24"
        local temp_node="/tmp/nodejs-24.tar.xz"
        local node_arch="x64"

        # Detect architecture
        case "$(uname -m)" in
            x86_64) node_arch="x64" ;;
            aarch64|arm64) node_arch="arm64" ;;
        esac

        log "Downloading Node.js 24 LTS for $node_arch"

        # Download Node.js 24 LTS binary from official source
        curl -fsSL "https://nodejs.org/dist/v24.13.0/node-v24.13.0-linux-${node_arch}.tar.xz" -o "$temp_node"

        log "Extracting Node.js to $node_dir"
        mkdir -p "$node_dir"
        tar -xJf "$temp_node" -C "$node_dir" --strip-components=1

        rm -f "$temp_node"

        # Create symlinks
        ln -sf "$node_dir/bin/node" /usr/local/bin/node
        ln -sf "$node_dir/bin/npm" /usr/local/bin/npm
        ln -sf "$node_dir/bin/npx" /usr/local/bin/npx

        log "Node.js 24 LTS installed successfully"
    fi
}

create_directories() {
    log "Creating hypanel directories"
    
    local directories=(
        "$HYPANEL_INSTALL_DIR"
        "$HYPANEL_CONFIG_DIR"
        "$HYPANEL_LOG_DIR"
        "$HYPANEL_SERVERS_DIR"
        "$HYPANEL_INSTALL_DIR/data"
        "$HYPANEL_INSTALL_DIR/apps/backend/data"
        "$HYPANEL_HOME/backup"
    )

    for dir in "${directories[@]}"; do
        if [[ ! -d "$dir" ]]; then
            mkdir -p "$dir"
            log "Created directory: $dir"
        else
            log "Directory already exists: $dir"
        fi
    done

    # Set ownership for writable directories
    chown -R "$HYPANEL_USER:$HYPANEL_USER" "$HYPANEL_SERVERS_DIR"
    chmod 755 "$HYPANEL_SERVERS_DIR"

    chown -R "$HYPANEL_USER:$HYPANEL_USER" "$HYPANEL_LOG_DIR"
    chmod 755 "$HYPANEL_LOG_DIR"

    chown -R "$HYPANEL_USER:$HYPANEL_USER" "$HYPANEL_INSTALL_DIR/data"
    chmod 755 "$HYPANEL_INSTALL_DIR/data"

    chown -R "$HYPANEL_USER:$HYPANEL_USER" "$HYPANEL_INSTALL_DIR/apps/backend/data"
    chmod 755 "$HYPANEL_INSTALL_DIR/apps/backend/data"

    chown -R "$HYPANEL_USER:$HYPANEL_USER" "$HYPANEL_HOME/backup"
    chmod 755 "$HYPANEL_HOME/backup"

    # Set ownership for config directory (root-owned, readable by hypanel)
    chmod 755 "$HYPANEL_CONFIG_DIR"
    chown root:root "$HYPANEL_CONFIG_DIR"

    # Set ownership for install directory (root-owned, readable)
    chmod 755 "$HYPANEL_INSTALL_DIR"
    chown root:root "$HYPANEL_INSTALL_DIR"
}

download_and_install_hypanel() {
    log "Installing hypanel $HYPANEL_VERSION"

    # Find node and npm - prefer Node.js 24 for native module compatibility
    find_node() {
        # Prefer Node.js 24 from /opt
        if [[ -f "/opt/nodejs-24/bin/node" ]]; then
            echo "/opt/nodejs-24/bin/node"
        # Check nvm for Node.js 24
        elif [[ -f "/home/${SUDO_USER:-$(whoami)}/.nvm/versions/node/v24.13.0/bin/node" ]]; then
            echo "/home/${SUDO_USER:-$(whoami)}/.nvm/versions/node/v24.13.0/bin/node"
        # Check system Node.js for version 24+
        elif command -v node &> /dev/null; then
            local version=$(node --version 2>/dev/null | sed 's/v//' | cut -d'.' -f1)
            if [[ "$version" -ge 24 ]]; then
                echo "$(command -v node)"
            else
                echo ""
            fi
        else
            echo ""
        fi
    }

    find_npm() {
        # Prefer Node.js 24 npm
        if [[ -f "/opt/nodejs-24/bin/npm" ]]; then
            echo "/opt/nodejs-24/bin/npm"
        elif [[ -f "/home/${SUDO_USER:-$(whoami)}/.nvm/versions/node/v24.13.0/bin/npm" ]]; then
            echo "/home/${SUDO_USER:-$(whoami)}/.nvm/versions/node/v24.13.0/bin/npm"
        elif command -v npm &> /dev/null; then
            echo "$(command -v npm)"
        else
            local node_path=$(find_node)
            if [[ -n "$node_path" ]]; then
                echo "${node_path%/node}/npm"
            else
                echo ""
            fi
        fi
    }

    local node_path=$(find_node)
    local npm_path=$(find_npm)

    if [[ -z "$node_path" ]] || [[ ! -f "$node_path" ]]; then
        error "Node.js 24+ not found. Please install Node.js 24 LTS first."
    fi

    log "Using Node.js: $node_path"

    # Determine download URL for pre-built release
    local download_url
    if [[ "$HYPANEL_VERSION" == "latest" ]]; then
        # Determine which API endpoint to use based on channel
        local api_endpoint
        if [[ "$CHANNEL" == "staging" ]]; then
            log "Fetching staging release from GitHub..."
            api_endpoint="https://api.github.com/repos/OnyxWm/hypanel/releases/tags/staging"
        else
            log "Fetching latest release from GitHub..."
            api_endpoint="https://api.github.com/repos/OnyxWm/hypanel/releases/latest"
        fi
        
        # Use GitHub API to find the release and get the .tar.gz asset
        local release_info
        release_info=$(curl -s "$api_endpoint")
        
        if [[ -z "$release_info" ]]; then
            error "Failed to fetch release info from GitHub API. Repository may not be published yet."
        fi

        # Extract the .tar.gz asset URL
        download_url=$(echo "$release_info" | jq -r '.assets[] | select(.name | endswith(".tar.gz")) | .browser_download_url' | head -n1)
        
        if [[ -z "$download_url" ]] || [[ "$download_url" == "null" ]]; then
            if [[ "$CHANNEL" == "staging" ]]; then
                error "Failed to find .tar.gz asset in staging release. Please ensure a release with tag 'staging' and a .tar.gz asset exists."
            else
                error "Failed to find .tar.gz asset in latest release. Please ensure a release with a .tar.gz asset exists."
            fi
        fi
        
        if [[ "$CHANNEL" == "staging" ]]; then
            log "Downloading staging release from: $download_url"
        else
            log "Downloading latest release from: $download_url"
        fi
    else
        # Remove 'v' prefix if present
        local version_clean="${HYPANEL_VERSION#v}"
        download_url="https://github.com/OnyxWm/hypanel/releases/download/v${version_clean}/hypanel-v${version_clean}.tar.gz"
        log "Downloading version $HYPANEL_VERSION from: $download_url"
    fi

    local temp_download="/tmp/hypanel-${HYPANEL_VERSION}.tar.gz"
    log "Downloading pre-built release..."
    if ! curl -fsSL "$download_url" -o "$temp_download"; then
        error "Failed to download hypanel release from $download_url"
    fi

    if [[ ! -f "$temp_download" ]]; then
        error "Failed to download hypanel release"
    fi

    # Extract to temporary location
    local temp_extract="/tmp/hypanel-extract"
    rm -rf "$temp_extract"
    mkdir -p "$temp_extract"

    log "Extracting release package..."
    tar -xzf "$temp_download" -C "$temp_extract"

    # Copy to install directory (preserve apps/ structure)
    log "Installing to $HYPANEL_INSTALL_DIR..."
    rsync -a "$temp_extract/" "$HYPANEL_INSTALL_DIR/"

    # Clean up temp files
    rm -rf "$temp_extract"
    rm -f "$temp_download"

    # Verify backend dist exists
    if [[ ! -d "$HYPANEL_INSTALL_DIR/apps/backend/dist" ]]; then
        error "Backend dist directory not found in release package"
    fi

    # Verify webpanel dist exists
    if [[ ! -d "$HYPANEL_INSTALL_DIR/apps/webpanel/dist" ]]; then
        error "Webpanel dist directory not found in release package"
    fi

    # Install/verify production dependencies for backend
    cd "$HYPANEL_INSTALL_DIR/apps/backend"
    
    # Check if node_modules exists, if not install production dependencies
    if [[ ! -d "node_modules" ]]; then
        log "Installing backend production dependencies..."
        if ! "$npm_path" install --omit=dev; then
            error "Failed to install backend production dependencies"
        fi
    else
        log "Backend node_modules found, ensuring dependencies are up to date..."
        if ! "$npm_path" install --omit=dev; then
            warning "Failed to update backend dependencies, continuing with existing..."
        fi
    fi

    # Rebuild native modules (better-sqlite3 and authenticate-pam) for the current Node.js version
    # This is necessary because native modules are platform/Node version specific
    log "Rebuilding native modules for Node.js $( "$node_path" --version )..."
    
    # Rebuild better-sqlite3
    if ! "$npm_path" rebuild better-sqlite3; then
        warning "Failed to rebuild better-sqlite3, trying clean install..."
        rm -rf node_modules/better-sqlite3
        if ! "$npm_path" install better-sqlite3 --build-from-source --force --omit=dev; then
            warning "Failed to rebuild better-sqlite3. The application may not work correctly."
        fi
    fi
    
    # Rebuild authenticate-pam
    if ! "$npm_path" rebuild authenticate-pam; then
        warning "Failed to rebuild authenticate-pam, trying clean install..."
        rm -rf node_modules/authenticate-pam
        if ! "$npm_path" install authenticate-pam --build-from-source --force --omit=dev; then
            warning "Failed to rebuild authenticate-pam. PAM authentication may not work correctly."
        fi
    fi

    cd "$HYPANEL_INSTALL_DIR"

    # Set proper permissions
    chmod -R 644 "$HYPANEL_INSTALL_DIR"/*
    find "$HYPANEL_INSTALL_DIR" -type d -exec chmod 755 {} \;
    chmod +x "$HYPANEL_INSTALL_DIR"/apps/backend/dist/index.js 2>/dev/null || true

    mkdir -p "$HYPANEL_INSTALL_DIR/data"

    # Set ownership: root for install dir, hypanel for data/writable dirs
    chown -R root:root "$HYPANEL_INSTALL_DIR"
    chown -R "$HYPANEL_USER:$HYPANEL_USER" "$HYPANEL_INSTALL_DIR/data"
    chown -R "$HYPANEL_USER:$HYPANEL_USER" "$HYPANEL_INSTALL_DIR/apps/backend/dist/data" 2>/dev/null || true

    # Get IP address (fallback to localhost if unavailable)
    local ip_address="localhost"
    if command -v hostname &> /dev/null; then
        if hostname --all-ip-addresses &>/dev/null; then
            ip_address=$(hostname --all-ip-addresses | awk '{print $1}')
        elif hostname -I &>/dev/null; then
            ip_address=$(hostname -I | awk '{print $1}')
        fi
    fi

    log "hypanel installed successfully to $HYPANEL_INSTALL_DIR"
    log "Webpanel will be served at http://${ip_address}:3000"
}

install_hytale_downloader() {
    log "Installing hytale-downloader"

    local downloader_dir="/opt/hytale-downloader"
    local downloader_bin="$downloader_dir/hytale-downloader"
    local temp_zip="/tmp/hytale-downloader.zip"
    
    # Check if already installed
    if [[ -f "$downloader_bin" ]]; then
        log "hytale-downloader already installed at $downloader_bin"
        return 0
    fi
    
    # Create directory
    mkdir -p "$downloader_dir"
    
    # Detect architecture
    local arch
    case "$(uname -m)" in
        x86_64) arch="x86_64" ;;
        aarch64|arm64) arch="aarch64" ;;
        *) error "Unsupported architecture: $(uname -m). Only x86_64 and aarch64 are supported." ;;
    esac
    
    log "Downloading hytale-downloader for $arch"
    
    # Download from Hytale's official downloader service (Linux agnostic)
    local download_url="https://downloader.hytale.com/hytale-downloader.zip"
    
    # Download the zip file
    if ! curl -fsSL "$download_url" -o "$temp_zip"; then
        error "Failed to download hytale-downloader from $download_url"
    fi
    
    # Extract the binary from zip
    unzip -o "$temp_zip" -d "$downloader_dir" 2>/dev/null || {
        error "Failed to extract hytale-downloader zip"
    }
    
    # Clean up zip
    rm -f "$temp_zip"

    # Find and rename the correct binary
    local extracted_binary=""
    if [[ -f "$downloader_dir/hytale-downloader-linux-amd64" ]]; then
        extracted_binary="$downloader_dir/hytale-downloader-linux-amd64"
    elif [[ -f "$downloader_dir/hytale-downloader-linux-arm64" ]]; then
        extracted_binary="$downloader_dir/hytale-downloader-linux-arm64"
    fi

    if [[ -z "$extracted_binary" ]]; then
        error "Could not find hytale-downloader binary in extracted zip"
    fi

    mv "$extracted_binary" "$downloader_bin"

    # Ensure binary is executable
    chmod +x "$downloader_bin"
    
    # Create symlink in PATH
    ln -sf "$downloader_bin" "/usr/local/bin/hytale-downloader"
    
    # Set ownership
    chown root:root "$downloader_bin"
    chmod 755 "$downloader_bin"
    
    log "hytale-downloader installed successfully to $downloader_bin"
    
    # Test the downloader
    if "$downloader_bin" --version >/dev/null 2>&1; then
        log "hytale-downloader test successful"
    else
        warning "hytale-downloader test failed, but installation completed"
    fi
}

create_config_files() {
    log "Creating configuration files"
    
    local env_file="$HYPANEL_CONFIG_DIR/hypanel.env"
    if [[ ! -f "$env_file" ]]; then
        cat > "$env_file" << EOF
# hypanel Environment Configuration
NODE_ENV=production
PORT=3000
LOGS_DIR=$HYPANEL_LOG_DIR
SERVERS_DIR=$HYPANEL_SERVERS_DIR
DATABASE_PATH=$HYPANEL_INSTALL_DIR/data/hypanel.db
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
    
    # Build ReadWritePaths dynamically, only including paths that exist
    local read_write_paths=(
        "$HYPANEL_SERVERS_DIR"
        "$HYPANEL_LOG_DIR"
        "$HYPANEL_INSTALL_DIR/data"
        "$HYPANEL_INSTALL_DIR/apps/backend/data"
    )
    
    # Add faillock paths only if they exist (for PAM authentication failure tracking)
    local faillock_paths=(
        "/run/faillock"
        "/var/run/faillock"
        "/var/lib/faillock"
    )
    
    for path in "${faillock_paths[@]}"; do
        if [[ -d "$path" ]] || [[ -e "$path" ]]; then
            read_write_paths+=("$path")
        fi
    done
    
    # Join paths with spaces
    local read_write_paths_str="${read_write_paths[*]}"
    
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
ExecStart=/usr/local/bin/node $HYPANEL_INSTALL_DIR/apps/backend/dist/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=hypanel

# Security settings
# NOTE: OS-password login via PAM requires setuid helpers (unix_chkpwd); NoNewPrivileges must be disabled.
NoNewPrivileges=false
PrivateTmp=true
ProtectSystem=strict
ProtectHome=false
ReadWritePaths=$read_write_paths_str

[Install]
WantedBy=multi-user.target
EOF

    chmod 644 "$HYPANEL_SERVICE_FILE"
    chown root:root "$HYPANEL_SERVICE_FILE"
    
    systemctl daemon-reload
    systemctl enable hypanel
    
    log "systemd service created and enabled"
}

configure_systemd_integration_permissions() {
    log "Configuring permissions for systemd integration"

    # Allow hypanel user to read systemd journals (for Settings -> systemd logs)
    if getent group systemd-journal >/dev/null 2>&1; then
        usermod -aG systemd-journal "$HYPANEL_USER" || warning "Failed to add $HYPANEL_USER to systemd-journal group"
    else
        warning "Group 'systemd-journal' not found; journal access may require manual setup"
    fi

    # Allow hypanel daemon to restart its own systemd unit without password.
    # Also allow file operations needed for updates (rsync, cp, chmod, chown, find).
    # This is intentionally locked down to specific commands only.
    local sudoers_file="/etc/sudoers.d/hypanel-systemctl"
    local sudoers_dir="/etc/sudoers.d"
    
    # Ensure sudoers.d directory exists
    if [[ ! -d "$sudoers_dir" ]]; then
        log "Creating $sudoers_dir directory"
        mkdir -p "$sudoers_dir" || error "Failed to create $sudoers_dir directory"
    fi
    
    cat > "$sudoers_file" << EOF
# Managed by hypanel install.sh
# Allow the hypanel service user to restart/check the hypanel systemd unit without a password.
${HYPANEL_USER} ALL=(root) NOPASSWD: /usr/bin/systemctl restart hypanel, /usr/bin/systemctl is-active hypanel
# Allow file operations for updates (rsync, cp, chmod, chown, find, touch, rm, mount)
# These commands are used by the update endpoint to install updates to /opt/hypanel
# Note: mount is allowed for remounting filesystems during updates
${HYPANEL_USER} ALL=(root) NOPASSWD: /usr/bin/rsync, /usr/bin/cp, /usr/bin/chmod, /usr/bin/chown, /usr/bin/find, /usr/bin/touch, /usr/bin/rm, /usr/bin/mount
EOF

    chmod 440 "$sudoers_file"
    chown root:root "$sudoers_file"

    if command -v visudo >/dev/null 2>&1; then
        if ! visudo -cf "$sudoers_file" >/dev/null 2>&1; then
            warning "sudoers validation failed for $sudoers_file (daemon restart may not work)"
        fi
    fi

    # Allow hypanel user to restart the hypanel systemd unit via polkit (preferred over sudo under NoNewPrivileges=true)
    local polkit_rules_dir="/etc/polkit-1/rules.d"
    local polkit_rule_file="$polkit_rules_dir/49-hypanel.rules"
    if [[ -d "$polkit_rules_dir" ]]; then
        cat > "$polkit_rule_file" << EOF
// Managed by hypanel install.sh
// Allow the hypanel service user to manage only hypanel.service without interactive auth.
polkit.addRule(function(action, subject) {
  if (subject.user === "${HYPANEL_USER}" && action.id === "org.freedesktop.systemd1.manage-units") {
    var unit = action.lookup("unit");
    var verb = action.lookup("verb");
    if (unit === "hypanel.service" && (verb === "restart" || verb === "start" || verb === "stop")) {
      return polkit.Result.YES;
    }
  }
});
EOF
        chmod 644 "$polkit_rule_file"
        chown root:root "$polkit_rule_file"
    else
        warning "polkit rules directory not found at $polkit_rules_dir; daemon restart may require manual polkit setup"
    fi
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
    if [[ -n "$CHANNEL" ]]; then
        log "Channel: $CHANNEL"
    fi
    
    check_root
    detect_os
    create_user
    prompt_password
    install_packages
    install_java
    install_nodejs
    create_directories
    download_and_install_hypanel
    install_hytale_downloader
    create_config_files
    create_systemd_service
    configure_systemd_integration_permissions
    start_service
    show_completion_info
    
    log "hypanel installation script completed successfully"
}

if [[ "${BASH_SOURCE[0]:-${0}}" == "${0}" ]]; then
    main "$@"
fi