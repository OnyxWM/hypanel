#!/bin/bash

# Helper script for building Docker images with proper buildx support
# This is especially useful for Colima and other Docker setups on macOS

set -euo pipefail

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() {
    echo -e "${GREEN}[INFO]${NC} $*"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $*"
}

# Check if buildx is available
if ! docker buildx version &>/dev/null; then
    warn "Docker buildx not found. Attempting to use regular docker build..."
    warn "For cross-platform builds on macOS, Docker buildx is required."
    docker-compose build "$@"
    exit $?
fi

# Check if using Colima
if docker context ls 2>/dev/null | grep -q colima || docker info 2>/dev/null | grep -q colima; then
    log "Detected Colima. Setting up buildx..."
    
    # Ensure buildx builder exists
    if ! docker buildx ls | grep -q "hypanel-builder"; then
        log "Creating buildx builder 'hypanel-builder'..."
        docker buildx create --name hypanel-builder --use 2>/dev/null || {
            # If creation fails, try to use default
            docker buildx use default 2>/dev/null || true
        }
        docker buildx inspect --bootstrap 2>/dev/null || true
    else
        log "Using existing buildx builder 'hypanel-builder'..."
        docker buildx use hypanel-builder 2>/dev/null || true
    fi
fi

# Use buildx with docker-compose
log "Building with Docker buildx..."
DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 docker-compose build "$@"
