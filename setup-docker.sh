#!/bin/bash

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() {
    echo -e "${GREEN}[INFO]${NC} $*"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $*"
}

error() {
    echo -e "${RED}[ERROR]${NC} $*" >&2
    exit 1
}

info() {
    echo -e "${BLUE}[INFO]${NC} $*"
}

# Check if .env file exists
if [[ -f .env ]]; then
    warn ".env file already exists. Skipping .env setup."
    warn "If you want to regenerate, delete .env and run this script again."
else
    log "Creating .env file from .env.example..."
    if [[ ! -f .env.example ]]; then
        error ".env.example file not found. Make sure you're in the hypanel directory."
    fi
    cp .env.example .env
    log ".env file created successfully."
fi

# Check if password is already set in .env
if grep -q "^HYPANEL_PASSWORD_HASH=" .env && ! grep -q "^HYPANEL_PASSWORD_HASH=$" .env && ! grep -q "^# HYPANEL_PASSWORD_HASH=" .env; then
    log "Password hash already configured in .env file."
    SKIP_PASSWORD=true
elif grep -q "^HYPANEL_PASSWORD=" .env && ! grep -q "^HYPANEL_PASSWORD=$" .env && ! grep -q "^# HYPANEL_PASSWORD=" .env; then
    log "Password already configured in .env file."
    SKIP_PASSWORD=true
else
    SKIP_PASSWORD=false
fi

# Prompt for password if not set
if [[ "$SKIP_PASSWORD" == "false" ]]; then
    echo
    info "Password configuration"
    info "You need to set a password for Hypanel authentication."
    echo
    read -p "Would you like to set a password now? (y/n): " -n 1 -r
    echo
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        # Prompt for password
        read -sp "Enter password for Hypanel: " PASSWORD
        echo
        read -sp "Confirm password: " PASSWORD_CONFIRM
        echo
        
        if [[ "$PASSWORD" != "$PASSWORD_CONFIRM" ]]; then
            error "Passwords do not match. Please run the script again."
        fi
        
        if [[ -z "$PASSWORD" ]]; then
            error "Password cannot be empty."
        fi
        
        # Try to generate bcrypt hash
        log "Generating bcrypt hash..."
        
        # Check if Node.js and bcrypt are available
        if command -v node &> /dev/null; then
            # Check if bcrypt is installed locally
            if [[ -f "apps/backend/node_modules/bcrypt/package.json" ]] || \
               ([[ -f "apps/backend/package.json" ]] && node -e "require('bcrypt')" 2>/dev/null); then
                # Generate hash using local Node.js
                HASH=$(node -e "const bcrypt = require('bcrypt'); bcrypt.hash('$PASSWORD', 10).then(h => console.log(h)).catch(() => process.exit(1));" 2>/dev/null)
                
                if [[ -n "$HASH" ]] && [[ "$HASH" =~ ^\$2[aby]\$ ]]; then
                    # Update .env file with hash
                    if grep -q "^# HYPANEL_PASSWORD_HASH=" .env; then
                        # Uncomment and set the hash
                        sed -i.bak "s|^# HYPANEL_PASSWORD_HASH=.*|HYPANEL_PASSWORD_HASH=$HASH|" .env
                        rm -f .env.bak
                    else
                        # Add the hash
                        sed -i.bak "/^HYPANEL_AUTH_METHOD=ENV/a\\
HYPANEL_PASSWORD_HASH=$HASH" .env
                        rm -f .env.bak
                    fi
                    log "Password hash generated and added to .env file."
                else
                    warn "Failed to generate bcrypt hash. Falling back to plaintext password (NOT RECOMMENDED for production)."
                    add_plaintext_password
                fi
            else
                # Try to install bcrypt temporarily
                warn "bcrypt not found. Attempting to install..."
                if cd apps/backend && npm install bcrypt --no-save 2>/dev/null; then
                    HASH=$(node -e "const bcrypt = require('bcrypt'); bcrypt.hash('$PASSWORD', 10).then(h => console.log(h)).catch(() => process.exit(1));" 2>/dev/null)
                    cd ../..
                    
                    if [[ -n "$HASH" ]] && [[ "$HASH" =~ ^\$2[aby]\$ ]]; then
                        if grep -q "^# HYPANEL_PASSWORD_HASH=" .env; then
                            sed -i.bak "s|^# HYPANEL_PASSWORD_HASH=.*|HYPANEL_PASSWORD_HASH=$HASH|" .env
                            rm -f .env.bak
                        else
                            sed -i.bak "/^HYPANEL_AUTH_METHOD=ENV/a\\
HYPANEL_PASSWORD_HASH=$HASH" .env
                            rm -f .env.bak
                        fi
                        log "Password hash generated and added to .env file."
                    else
                        warn "Failed to generate bcrypt hash. Falling back to plaintext password (NOT RECOMMENDED for production)."
                        add_plaintext_password
                    fi
                else
                    warn "Could not install bcrypt. Using plaintext password (NOT RECOMMENDED for production)."
                    warn "You can generate a hash later using:"
                    warn "  node -e \"const bcrypt = require('bcrypt'); bcrypt.hash('your-password', 10).then(h => console.log(h));\""
                    add_plaintext_password
                fi
            fi
        else
            warn "Node.js not found. Cannot generate bcrypt hash."
            warn "Using plaintext password (NOT RECOMMENDED for production)."
            warn "To generate a hash later, install Node.js and run:"
            warn "  node -e \"const bcrypt = require('bcrypt'); bcrypt.hash('your-password', 10).then(h => console.log(h));\""
            add_plaintext_password
        fi
    else
        warn "Password not set. You'll need to edit .env manually and set either:"
        warn "  - HYPANEL_PASSWORD_HASH (recommended)"
        warn "  - HYPANEL_PASSWORD (for testing only)"
        warn "The application will not start without a password configured."
    fi
fi

# Function to add plaintext password
add_plaintext_password() {
    if grep -q "^# HYPANEL_PASSWORD=" .env; then
        sed -i.bak "s|^# HYPANEL_PASSWORD=.*|HYPANEL_PASSWORD=$PASSWORD|" .env
        rm -f .env.bak
    else
        sed -i.bak "/^HYPANEL_AUTH_METHOD=ENV/a\\
HYPANEL_PASSWORD=$PASSWORD" .env
        rm -f .env.bak
    fi
    log "Plaintext password added to .env file (NOT RECOMMENDED for production)."
}

# Create necessary directories
log "Creating data directories..."
mkdir -p data servers logs backup
log "Directories created: data/, servers/, logs/, backup/"

# Set permissions (try to match PUID/PGID if set in .env)
PUID_VAL=1000
PGID_VAL=1000

if [[ -f .env ]]; then
    if grep -q "^PUID=" .env; then
        PUID_VAL=$(grep "^PUID=" .env | cut -d'=' -f2 | tr -d ' ')
    fi
    if grep -q "^PGID=" .env; then
        PGID_VAL=$(grep "^PGID=" .env | cut -d'=' -f2 | tr -d ' ')
    fi
fi

# Try to set ownership (may fail if not running as root, that's okay)
if command -v chown &> /dev/null; then
    chown -R "${PUID_VAL}:${PGID_VAL}" data servers logs backup 2>/dev/null || \
        warn "Could not set directory ownership. You may need to adjust permissions manually."
fi

# Set basic permissions
chmod -R 755 data servers logs backup 2>/dev/null || true

log "Setup complete!"
echo
info "Next steps:"
echo "  1. Review .env file and adjust settings if needed"
echo "  2. Start Hypanel with: docker-compose up -d"
echo "  3. View logs with: docker-compose logs -f"
echo "  4. Access web panel at: http://localhost:3000"
echo
warn "Remember: The .env file contains sensitive information and is gitignored."
warn "Never commit it to version control or share it publicly."
