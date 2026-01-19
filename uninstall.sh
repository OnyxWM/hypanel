#!/bin/bash

set -euo pipefail

readonly HYPANEL_USER="hypanel"
readonly HYPANEL_HOME="/home/${HYPANEL_USER}"
readonly HYPANEL_INSTALL_DIR="/opt/hypanel"
readonly HYPANEL_CONFIG_DIR="/etc/hypanel"
readonly HYPANEL_LOG_DIR="/var/log/hypanel"
readonly HYPANEL_SERVICE_FILE="/etc/systemd/system/hypanel.service"
readonly HYPANEL_SUDOERS_FILE="/etc/sudoers.d/hypanel-systemctl"
readonly HYPANEL_POLKIT_FILE="/etc/polkit-1/rules.d/49-hypanel.rules"
readonly HYTALE_DOWNLOADER_DIR="/opt/hytale-downloader"
readonly HYTALE_DOWNLOADER_SYMLINK="/usr/local/bin/hytale-downloader"

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

confirm_uninstall() {
    echo
    echo "=== hypanel Uninstall ==="
    echo
    echo "This script will completely remove hypanel and all associated files:"
    echo "  - Systemd service: $HYPANEL_SERVICE_FILE"
    echo "  - User account: $HYPANEL_USER"
    echo "  - Installation directory: $HYPANEL_INSTALL_DIR"
    echo "  - Configuration directory: $HYPANEL_CONFIG_DIR"
    echo "  - Log directory: $HYPANEL_LOG_DIR"
    echo "  - User home directory: $HYPANEL_HOME (including all server data)"
    echo "  - Sudoers configuration: $HYPANEL_SUDOERS_FILE"
    echo "  - Polkit rules: $HYPANEL_POLKIT_FILE"
    echo "  - hytale-downloader: $HYTALE_DOWNLOADER_DIR"
    echo
    echo "WARNING: This will permanently delete all hypanel data including:"
    echo "  - All server instances and configurations"
    echo "  - Database files"
    echo "  - Log files"
    echo "  - Backup files"
    echo
    read -p "Are you sure you want to continue? (yes/no): " -r
    echo
    if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
        log "Uninstall cancelled by user"
        exit 0
    fi
}

stop_and_remove_service() {
    log "Stopping and removing systemd service"
    
    if systemctl list-unit-files | grep -q "^hypanel.service"; then
        if systemctl is-active --quiet hypanel 2>/dev/null; then
            log "Stopping hypanel service"
            systemctl stop hypanel || warning "Failed to stop service (may already be stopped)"
        fi
        
        if systemctl is-enabled --quiet hypanel 2>/dev/null; then
            log "Disabling hypanel service"
            systemctl disable hypanel || warning "Failed to disable service"
        fi
    else
        log "Service not found in systemd"
    fi
    
    if [[ -f "$HYPANEL_SERVICE_FILE" ]]; then
        log "Removing service file: $HYPANEL_SERVICE_FILE"
        rm -f "$HYPANEL_SERVICE_FILE"
        systemctl daemon-reload
        log "Service file removed and systemd daemon reloaded"
    else
        log "Service file not found: $HYPANEL_SERVICE_FILE"
    fi
}

remove_config_files() {
    log "Removing configuration files"
    
    if [[ -f "$HYPANEL_SUDOERS_FILE" ]]; then
        log "Removing sudoers file: $HYPANEL_SUDOERS_FILE"
        rm -f "$HYPANEL_SUDOERS_FILE"
        log "Sudoers file removed"
    else
        log "Sudoers file not found: $HYPANEL_SUDOERS_FILE"
    fi
    
    if [[ -f "$HYPANEL_POLKIT_FILE" ]]; then
        log "Removing polkit rules file: $HYPANEL_POLKIT_FILE"
        rm -f "$HYPANEL_POLKIT_FILE"
        log "Polkit rules file removed"
    else
        log "Polkit rules file not found: $HYPANEL_POLKIT_FILE"
    fi
}

remove_directories() {
    log "Removing directories"
    
    if [[ -d "$HYPANEL_INSTALL_DIR" ]]; then
        log "Removing installation directory: $HYPANEL_INSTALL_DIR"
        rm -rf "$HYPANEL_INSTALL_DIR"
        log "Installation directory removed"
    else
        log "Installation directory not found: $HYPANEL_INSTALL_DIR"
    fi
    
    if [[ -d "$HYPANEL_CONFIG_DIR" ]]; then
        log "Removing configuration directory: $HYPANEL_CONFIG_DIR"
        rm -rf "$HYPANEL_CONFIG_DIR"
        log "Configuration directory removed"
    else
        log "Configuration directory not found: $HYPANEL_CONFIG_DIR"
    fi
    
    if [[ -d "$HYPANEL_LOG_DIR" ]]; then
        log "Removing log directory: $HYPANEL_LOG_DIR"
        rm -rf "$HYPANEL_LOG_DIR"
        log "Log directory removed"
    else
        log "Log directory not found: $HYPANEL_LOG_DIR"
    fi
}

remove_hytale_downloader() {
    log "Removing hytale-downloader"
    
    if [[ -L "$HYTALE_DOWNLOADER_SYMLINK" ]] || [[ -f "$HYTALE_DOWNLOADER_SYMLINK" ]]; then
        log "Removing symlink: $HYTALE_DOWNLOADER_SYMLINK"
        rm -f "$HYTALE_DOWNLOADER_SYMLINK"
        log "Symlink removed"
    else
        log "Symlink not found: $HYTALE_DOWNLOADER_SYMLINK"
    fi
    
    if [[ -d "$HYTALE_DOWNLOADER_DIR" ]]; then
        log "Removing hytale-downloader directory: $HYTALE_DOWNLOADER_DIR"
        rm -rf "$HYTALE_DOWNLOADER_DIR"
        log "hytale-downloader directory removed"
    else
        log "hytale-downloader directory not found: $HYTALE_DOWNLOADER_DIR"
    fi
}

remove_user() {
    log "Removing user account"
    
    if id "$HYPANEL_USER" &>/dev/null; then
        log "Removing user: $HYPANEL_USER"
        log "This will also remove the home directory: $HYPANEL_HOME"
        
        # Remove user and their home directory
        userdel -r "$HYPANEL_USER" 2>/dev/null || {
            # If userdel fails, try to remove home directory manually
            warning "userdel failed, attempting manual cleanup"
            if [[ -d "$HYPANEL_HOME" ]]; then
                rm -rf "$HYPANEL_HOME"
            fi
            # Try userdel again without -r flag
            userdel "$HYPANEL_USER" 2>/dev/null || warning "Failed to remove user account completely"
        }
        
        log "User $HYPANEL_USER removed"
    else
        log "User $HYPANEL_USER does not exist"
    fi
}

show_completion_info() {
    log "Uninstallation completed successfully!"
    echo
    echo "=== hypanel Uninstall Complete ==="
    echo
    echo "All hypanel components have been removed:"
    echo "  - Service stopped and removed"
    echo "  - User account deleted"
    echo "  - All directories and files removed"
    echo
    echo "Note: The following were NOT removed (may be used by other applications):"
    echo "  - Java installation: /opt/jdk-25"
    echo "  - Node.js installation: /opt/nodejs-24"
    echo "  - System packages (curl, ca-certificates, etc.)"
    echo
}

main() {
    log "Starting hypanel uninstall script"
    
    check_root
    confirm_uninstall
    
    stop_and_remove_service
    remove_config_files
    remove_directories
    remove_hytale_downloader
    remove_user
    
    show_completion_info
    
    log "hypanel uninstall script completed successfully"
}

if [[ "${BASH_SOURCE[0]:-${0}}" == "${0}" ]]; then
    main "$@"
fi
