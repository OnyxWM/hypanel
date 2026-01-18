#!/bin/bash

set -euo pipefail

readonly HYPANEL_SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly HYPANEL_INSTALL_DIR="/opt/hypanel"
readonly HYPANEL_USER="hypanel"
readonly HYPANEL_SERVICE_FILE="/etc/systemd/system/hypanel.service"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [DEV] $*"
}

error() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [ERROR] $*" >&2
    exit 1
}

run_as_source_user() {
    # When invoked via sudo, keep build artifacts owned by the invoking user
    if [[ ${EUID:-$(id -u)} -eq 0 ]] && [[ -n "${SUDO_USER:-}" ]]; then
        sudo -u "$SUDO_USER" -H bash -c "$*"
    else
        bash -c "$*"
    fi
}

find_node() {
    if [[ -f "/opt/nodejs-24/bin/node" ]]; then
        echo "/opt/nodejs-24/bin/node"
    elif [[ -f "/home/${SUDO_USER:-$(whoami)}/.nvm/versions/node/v24.13.0/bin/node" ]]; then
        echo "/home/${SUDO_USER:-$(whoami)}/.nvm/versions/node/v24.13.0/bin/node"
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
    local node_path="$1"
    if [[ -f "/opt/nodejs-24/bin/npm" ]]; then
        echo "/opt/nodejs-24/bin/npm"
    elif [[ -f "/home/${SUDO_USER:-$(whoami)}/.nvm/versions/node/v24.13.0/bin/npm" ]]; then
        echo "/home/${SUDO_USER:-$(whoami)}/.nvm/versions/node/v24.13.0/bin/npm"
    elif command -v npm &> /dev/null; then
        echo "$(command -v npm)"
    elif [[ -n "$node_path" ]]; then
        echo "${node_path%/node}/npm"
    else
        echo ""
    fi
}

build_backend() {
    log "Building backend..."

    cd "$HYPANEL_SOURCE_DIR/apps/backend"

    local node_path=$(find_node)
    local npm_path=$(find_npm "$node_path")

    if [[ -z "$node_path" ]] || [[ ! -f "$node_path" ]]; then
        error "Node.js 24+ not found. Run install.sh first to install dependencies."
    fi

    log "Using Node.js: $node_path"

    # If dist is root-owned (common when previously built via sudo), clean it as root first
    if [[ -d "$HYPANEL_SOURCE_DIR/apps/backend/dist" ]]; then
        sudo rm -rf "$HYPANEL_SOURCE_DIR/apps/backend/dist" || true
    fi

    if ! run_as_source_user "cd \"$HYPANEL_SOURCE_DIR/apps/backend\" && \"$npm_path\" run build"; then
        error "Failed to build backend"
    fi

    log "Backend built successfully"
}

build_webpanel() {
    log "Building webpanel..."

    cd "$HYPANEL_SOURCE_DIR/apps/webpanel"

    local node_path=$(find_node)
    local npm_path=$(find_npm "$node_path")

    # Clean dist to avoid permission issues from previous builds
    if [[ -d "$HYPANEL_SOURCE_DIR/apps/webpanel/dist" ]]; then
        sudo rm -rf "$HYPANEL_SOURCE_DIR/apps/webpanel/dist" || true
    fi

    if ! run_as_source_user "cd \"$HYPANEL_SOURCE_DIR/apps/webpanel\" && \"$npm_path\" run build"; then
        error "Failed to build webpanel"
    fi

    log "Webpanel built successfully"
}

install_backend_runtime_deps_in_opt() {
    log "Installing backend runtime dependencies in $HYPANEL_INSTALL_DIR..."

    local backend_dir="$HYPANEL_INSTALL_DIR/apps/backend"
    if [[ ! -d "$backend_dir" ]]; then
        error "Backend directory not found at $backend_dir (deployment may have failed)"
    fi

    # Use whatever npm is available on the host; keep it simple and avoid nuking node_modules.
    # This will add new runtime deps (e.g. multer) without requiring a full reinstall.
    if ! command -v npm &>/dev/null; then
        error "npm not found on system PATH. Please install Node.js + npm, or run install.sh."
    fi

    sudo bash -c "cd \"$backend_dir\" && npm install --omit=dev --no-audit --no-fund"
    log "Backend dependencies installed/updated"
}

deploy_to_opt() {
    log "Deploying to $HYPANEL_INSTALL_DIR..."

    # Preserve server directories before rsync
    local servers_dir="$HYPANEL_INSTALL_DIR/apps/backend/servers"
    local servers_backup=""
    if [[ -d "$servers_dir" ]] && [[ -n "$(sudo ls -A "$servers_dir" 2>/dev/null)" ]]; then
        log "Backing up existing server configurations..."
        servers_backup=$(mktemp -d)
        if sudo cp -a "$servers_dir" "$servers_backup/" 2>/dev/null; then
            log "Server configurations backed up successfully"
        else
            log "Warning: Failed to backup server configurations, but continuing..."
            servers_backup=""
        fi
    fi

    # Ensure server directories exist before rsync (rsync --exclude should preserve them, but we ensure they exist)
    sudo mkdir -p "$servers_dir"
    sudo chown -R "$HYPANEL_USER:$HYPANEL_USER" "$servers_dir" 2>/dev/null || true

    # Deploy application code, excluding server data and configs
    # Note: --exclude prevents syncing, and with --delete, excluded dirs are preserved
    sudo rsync -a --delete \
        --exclude='node_modules' \
        --exclude='.git' \
        --exclude='*~' \
        --exclude='data/' \
        --exclude='apps/backend/data/' \
        --exclude='apps/backend/servers/' \
        "$HYPANEL_SOURCE_DIR/" "$HYPANEL_INSTALL_DIR/"

    # Restore server directories if they were backed up and are now missing/empty
    if [[ -n "$servers_backup" ]] && [[ -d "$servers_backup/servers" ]]; then
        # Check if servers directory is empty or missing after rsync
        if [[ ! -d "$servers_dir" ]] || [[ -z "$(sudo ls -A "$servers_dir" 2>/dev/null)" ]]; then
            log "Restoring server configurations from backup..."
            sudo mkdir -p "$servers_dir"
            if sudo cp -a "$servers_backup/servers/"* "$servers_dir/" 2>/dev/null; then
                log "Server configurations restored successfully"
            else
                log "Warning: Failed to restore server configurations from backup"
            fi
        else
            log "Server configurations preserved by rsync exclusion, backup not needed"
        fi
        rm -rf "$servers_backup"
    fi

    log "Setting permissions..."
    # Set permissions for application code (root-owned)
    sudo chmod -R 644 "$HYPANEL_INSTALL_DIR"/* 2>/dev/null || true
    sudo find "$HYPANEL_INSTALL_DIR" -type d -exec chmod 755 {} \;

    # Set ownership to root for application code
    sudo chown -R root:root "$HYPANEL_INSTALL_DIR"

    # Create and set ownership for data directories (hypanel user-owned)
    sudo mkdir -p "$HYPANEL_INSTALL_DIR/data"
    sudo chown -R "$HYPANEL_USER:$HYPANEL_USER" "$HYPANEL_INSTALL_DIR/data"

    sudo mkdir -p "$HYPANEL_INSTALL_DIR/apps/backend/data"
    sudo chown -R "$HYPANEL_USER:$HYPANEL_USER" "$HYPANEL_INSTALL_DIR/apps/backend/data"

    # Ensure server directories exist and are owned by hypanel user
    sudo mkdir -p "$servers_dir"
    sudo chown -R "$HYPANEL_USER:$HYPANEL_USER" "$servers_dir"
    sudo chmod 755 "$servers_dir"
    sudo find "$servers_dir" -type d -exec chmod 755 {} \; 2>/dev/null || true
    sudo find "$servers_dir" -type f -exec chmod 644 {} \; 2>/dev/null || true

    log "Deployed successfully to $HYPANEL_INSTALL_DIR"
}

configure_systemd_integration_permissions() {
    log "Configuring permissions for systemd integration"

    # Allow hypanel user to read systemd journals (for Settings -> systemd logs)
    if getent group systemd-journal >/dev/null 2>&1; then
        sudo usermod -aG systemd-journal "$HYPANEL_USER" || log "Warning: failed to add $HYPANEL_USER to systemd-journal group"
    else
        log "Warning: group 'systemd-journal' not found; journal access may require manual setup"
    fi

    # Allow hypanel daemon to restart its own systemd unit without password (locked down).
    local sudoers_file="/etc/sudoers.d/hypanel-systemctl"
    sudo bash -c "cat > \"$sudoers_file\" << 'EOF'
# Managed by hypanel install-dev.sh
# Allow the hypanel service user to restart/check the hypanel systemd unit without a password.
${HYPANEL_USER} ALL=(root) NOPASSWD: /usr/bin/systemctl restart hypanel, /usr/bin/systemctl is-active hypanel
EOF"

    sudo chmod 440 "$sudoers_file"
    sudo chown root:root "$sudoers_file"

    if command -v visudo >/dev/null 2>&1; then
        if ! sudo visudo -cf "$sudoers_file" >/dev/null 2>&1; then
            log "Warning: sudoers validation failed for $sudoers_file (daemon restart may not work)"
        fi
    fi

    # Allow hypanel user to restart the hypanel systemd unit via polkit (preferred over sudo under NoNewPrivileges=true)
    local polkit_rules_dir="/etc/polkit-1/rules.d"
    local polkit_rule_file="$polkit_rules_dir/49-hypanel.rules"
    if [[ -d "$polkit_rules_dir" ]]; then
        sudo bash -c "cat > \"$polkit_rule_file\" << 'EOF'
// Managed by hypanel install-dev.sh
// Allow the hypanel service user to manage only hypanel.service without interactive auth.
polkit.addRule(function(action, subject) {
  if (subject.user === \"${HYPANEL_USER}\" && action.id === \"org.freedesktop.systemd1.manage-units\") {
    var unit = action.lookup(\"unit\");
    var verb = action.lookup(\"verb\");
    if (unit === \"hypanel.service\" && (verb === \"restart\" || verb === \"start\" || verb === \"stop\")) {
      return polkit.Result.YES;
    }
  }
});
EOF"
        sudo chmod 644 "$polkit_rule_file"
        sudo chown root:root "$polkit_rule_file"
    else
        log "Warning: polkit rules directory not found at $polkit_rules_dir; daemon restart may require manual polkit setup"
    fi
}

ensure_systemd_service_auth_compat() {
    # OS-password login via PAM requires setuid helpers (unix_chkpwd) and may write faillock state.
    # NoNewPrivileges=true breaks this; ProtectSystem=strict requires explicit ReadWritePaths.
    log "Ensuring systemd unit allows PAM authentication..."

    # Ensure faillock directory exists on distros that use it
    sudo mkdir -p /run/faillock || true

    # Use a node binary that actually exists on the host.
    local node_bin="/usr/bin/node"
    if [[ -x "/opt/nodejs-24/bin/node" ]]; then
        node_bin="/opt/nodejs-24/bin/node"
    elif [[ -x "/usr/local/bin/node" ]]; then
        node_bin="/usr/local/bin/node"
    elif [[ -x "/usr/bin/node" ]]; then
        node_bin="/usr/bin/node"
    fi

    sudo bash -c "cat > \"$HYPANEL_SERVICE_FILE\" << EOF
[Unit]
Description=hypanel - Hytale Server Management Panel
After=network.target

[Service]
Type=simple
User=hypanel
Group=hypanel
WorkingDirectory=/opt/hypanel
EnvironmentFile=/etc/hypanel/hypanel.env
ExecStart=${node_bin} /opt/hypanel/apps/backend/dist/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=hypanel

# Security settings
# NOTE: PAM auth for OS passwords requires setuid helpers (unix_chkpwd); NoNewPrivileges must be disabled.
NoNewPrivileges=false
PrivateTmp=true
ProtectSystem=strict
ProtectHome=false
ReadWritePaths=/home/hypanel /home/hypanel/hytale /var/log/hypanel /opt/hypanel/data /opt/hypanel/apps/backend/data /run/faillock

[Install]
WantedBy=multi-user.target
EOF"

    sudo chmod 644 "$HYPANEL_SERVICE_FILE"
    sudo chown root:root "$HYPANEL_SERVICE_FILE"
    sudo systemctl daemon-reload
}

restart_service() {
    log "Preparing to restart hypanel service..."

    # Check if service is running and warn about servers being stopped
    if sudo systemctl is-active --quiet hypanel; then
        log "Service is currently running - this will stop all running servers temporarily"
        log "Servers will be restored from database after service restart"
        
        # Try to check if there are any servers (optional, non-blocking)
        if command -v sqlite3 &> /dev/null; then
            local db_path="/opt/hypanel/data/hypanel.db"
            if [[ -f "$db_path" ]]; then
                local server_count=$(sudo sqlite3 "$db_path" "SELECT COUNT(*) FROM servers WHERE status = 'online';" 2>/dev/null || echo "0")
                if [[ "$server_count" -gt 0 ]]; then
                    log "Warning: $server_count server(s) are currently online and will be stopped"
                fi
            fi
        fi
    fi

    log "Restarting hypanel service..."

    if sudo systemctl is-active --quiet hypanel; then
        sudo systemctl restart hypanel
        sleep 2
        if sudo systemctl is-active --quiet hypanel; then
            log "Service restarted successfully"
            log "Note: Servers will need to be manually started if they were running before"
        else
            error "Failed to restart hypanel service"
        fi
    else
        log "hypanel service not running, starting..."
        sudo systemctl start hypanel
        sleep 2
        if sudo systemctl is-active --quiet hypanel; then
            log "Service started successfully"
        else
            error "Failed to start hypanel service"
        fi
    fi
}

show_status() {
    log "=== Development Deployment Complete ==="
    echo
    echo "Web Panel: http://localhost:3000"
    echo "Service Status:"
    sudo systemctl status hypanel --no-pager
    echo
    echo "View Logs:"
    echo "  journalctl -u hypanel -f"
}

main() {
    log "Starting development deployment..."
    log "Source: $HYPANEL_SOURCE_DIR"
    log "Target: $HYPANEL_INSTALL_DIR"

    build_backend
    build_webpanel
    deploy_to_opt
    install_backend_runtime_deps_in_opt
    configure_systemd_integration_permissions
    ensure_systemd_service_auth_compat
    restart_service
    show_status

    log "Development deployment complete!"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
