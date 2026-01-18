#!/bin/bash

set -euo pipefail

# Get version from argument or package.json
VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
    if [[ -f "package.json" ]]; then
        VERSION=$(grep -o '"version": "[^"]*"' package.json | cut -d'"' -f4)
    fi
    if [[ -z "$VERSION" ]]; then
        echo "Error: Version not specified and could not be determined from package.json"
        echo "Usage: $0 [VERSION]"
        exit 1
    fi
fi

# Remove 'v' prefix if present
VERSION="${VERSION#v}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELEASE_DIR="$SCRIPT_DIR/release"
TARBALL_NAME="hypanel-v${VERSION}.tar.gz"
TARBALL_PATH="$SCRIPT_DIR/$TARBALL_NAME"

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

log "Building hypanel release v${VERSION}"

# Check for Node.js
if ! command -v node &> /dev/null; then
    error "Node.js is required but not found. Please install Node.js 24+ first."
fi

NODE_VERSION=$(node --version | sed 's/v//' | cut -d'.' -f1)
if [[ "$NODE_VERSION" -lt 24 ]]; then
    warning "Node.js version is less than 24. Recommended: Node.js 24 LTS"
fi

log "Using Node.js: $(node --version)"

# Clean previous builds
log "Cleaning previous builds..."
rm -rf "$RELEASE_DIR"
rm -f "$TARBALL_PATH"
rm -rf "$SCRIPT_DIR/apps/backend/dist"
rm -rf "$SCRIPT_DIR/apps/webpanel/dist"
rm -rf "$SCRIPT_DIR/apps/webpanel/dist-ssr"

# Create release directory structure
log "Creating release directory structure..."
mkdir -p "$RELEASE_DIR/apps/backend"
mkdir -p "$RELEASE_DIR/apps/webpanel"

# Build backend
log "Building backend..."
cd "$SCRIPT_DIR/apps/backend"

if [[ ! -f "package.json" ]]; then
    error "Backend package.json not found"
fi

# Install all dependencies first (needed for build)
log "Installing backend dependencies..."
if ! npm install; then
    error "Failed to install backend dependencies"
fi

# Build TypeScript
log "Compiling backend TypeScript..."
if ! npm run build; then
    error "Failed to build backend"
fi

# Verify dist directory exists
if [[ ! -d "dist" ]]; then
    error "Backend build failed: dist directory not found"
fi

log "Backend built successfully"

# Build webpanel
log "Building webpanel..."
cd "$SCRIPT_DIR/apps/webpanel"

if [[ ! -f "package.json" ]]; then
    error "Webpanel package.json not found"
fi

# Install all dependencies first (needed for build)
log "Installing webpanel dependencies..."
if ! npm install; then
    error "Failed to install webpanel dependencies"
fi

# Build webpanel (TypeScript + Vite)
log "Building webpanel (TypeScript + Vite)..."
if ! npm run build; then
    error "Failed to build webpanel"
fi

# Verify dist directory exists
if [[ ! -d "dist" ]]; then
    error "Webpanel build failed: dist directory not found"
fi

log "Webpanel built successfully"

# Copy backend to release directory
log "Copying backend to release directory..."
cp -r "$SCRIPT_DIR/apps/backend/dist" "$RELEASE_DIR/apps/backend/"
cp "$SCRIPT_DIR/apps/backend/package.json" "$RELEASE_DIR/apps/backend/"

# Copy webpanel dist to release directory
log "Copying webpanel to release directory..."
cp -r "$SCRIPT_DIR/apps/webpanel/dist" "$RELEASE_DIR/apps/webpanel/"

# Install production dependencies for backend only
log "Installing production dependencies for backend..."
cd "$RELEASE_DIR/apps/backend"

# Remove dev dependencies and reinstall only production
rm -rf node_modules
if ! npm install --omit=dev; then
    error "Failed to install production dependencies for backend"
fi

# Copy root package.json if it exists (optional, for reference)
if [[ -f "$SCRIPT_DIR/package.json" ]]; then
    cp "$SCRIPT_DIR/package.json" "$RELEASE_DIR/"
fi

# Create tarball
log "Creating tarball: $TARBALL_NAME"
cd "$SCRIPT_DIR"
tar -czf "$TARBALL_PATH" -C "$RELEASE_DIR" .

# Verify tarball was created
if [[ ! -f "$TARBALL_PATH" ]]; then
    error "Failed to create tarball"
fi

TARBALL_SIZE=$(du -h "$TARBALL_PATH" | cut -f1)
log "Tarball created successfully: $TARBALL_NAME ($TARBALL_SIZE)"

log "Release build complete!"
log "Tarball location: $TARBALL_PATH"
log "Release directory: $RELEASE_DIR"
log ""
log "To test the release, extract it and verify the structure:"
log "  tar -xzf $TARBALL_NAME"
log "  ls -la release/apps/backend/dist"
log "  ls -la release/apps/webpanel/dist"
