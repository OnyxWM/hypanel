# Multi-stage Dockerfile for Hypanel
# Build stage: compile TypeScript and build frontend
FROM ubuntu:24.04 AS builder

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install build dependencies
# Note: libpam0g-dev not needed since we skip optional dependencies (authenticate-pam) in Docker
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 24 LTS (pinned version)
ARG NODE_VERSION=v24.13.0
ARG NODE_ARCH=x64
# Detect architecture at build time
# Default to amd64 for compatibility with older Docker versions
# Docker buildx automatically sets this when --platform is specified
ARG TARGETARCH=amd64

# Set architecture for Node.js download and verify checksum
RUN if [ "$TARGETARCH" = "arm64" ]; then NODE_ARCH=arm64; else NODE_ARCH=x64; fi && \
    NODE_TARBALL="node-${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" && \
    curl -fsSL "https://nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt" -o /tmp/SHASUMS256.txt && \
    curl -fsSL "https://nodejs.org/dist/${NODE_VERSION}/${NODE_TARBALL}" -o "/tmp/${NODE_TARBALL}" && \
    ( cd /tmp && grep "${NODE_TARBALL}" SHASUMS256.txt | sha256sum -c - ) && \
    mkdir -p /opt/node && \
    tar -xJf "/tmp/${NODE_TARBALL}" -C /opt/node --strip-components=1 && \
    rm -f /tmp/node-* /tmp/SHASUMS256.txt && \
    ln -sf /opt/node/bin/node /usr/local/bin/node && \
    ln -sf /opt/node/bin/npm /usr/local/bin/npm && \
    ln -sf /opt/node/bin/npx /usr/local/bin/npx

# Set working directory
WORKDIR /build

# Copy package files
COPY package.json package-lock.json* ./
COPY apps/backend/package.json apps/backend/
COPY apps/webpanel/package.json apps/webpanel/

# Install dependencies
# Skip optional dependencies (like authenticate-pam) since Docker uses ENV auth by default
RUN npm install && \
    cd apps/backend && npm install --no-optional && \
    cd ../webpanel && npm install && \
    cd ../..

# Copy source files
COPY apps/backend apps/backend/
COPY apps/webpanel apps/webpanel/

# Sync backend deps from lock file and build native modules (better-sqlite3) in builder
RUN cd apps/backend && npm ci --omit=optional

# Build backend TypeScript
RUN cd apps/backend && npm run build

# Keep only production backend deps for runtime copy (no devDependencies)
RUN cd apps/backend && npm prune --production

# Build frontend
RUN cd apps/webpanel && npm run build

# Runtime stage: minimal image with only runtime dependencies
FROM ubuntu:24.04

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Architecture (Docker buildx sets when --platform is specified)
ARG TARGETARCH=amd64

# OCI image labels (set VCS_REF/IMAGE_SOURCE in CI if desired)
ARG VERSION=0.3.5
ARG VCS_REF
ARG IMAGE_SOURCE=https://github.com/your-org/hypanel
LABEL org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.source="${IMAGE_SOURCE}" \
      org.opencontainers.image.revision="${VCS_REF}"

# Install runtime dependencies
# Note: libpam0g-dev not needed since authenticate-pam is optional and skipped
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    unzip \
    tar \
    xz-utils \
    jq \
    python3 \
    rsync \
    sudo \
    tini \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 24 LTS (pinned version, runtime only) with checksum verification
ARG NODE_VERSION=v24.13.0
ARG NODE_ARCH=x64

RUN if [ "$TARGETARCH" = "arm64" ]; then NODE_ARCH=arm64; else NODE_ARCH=x64; fi && \
    NODE_TARBALL="node-${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" && \
    curl -fsSL "https://nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt" -o /tmp/SHASUMS256.txt && \
    curl -fsSL "https://nodejs.org/dist/${NODE_VERSION}/${NODE_TARBALL}" -o "/tmp/${NODE_TARBALL}" && \
    ( cd /tmp && grep "${NODE_TARBALL}" SHASUMS256.txt | sha256sum -c - ) && \
    mkdir -p /opt/node && \
    tar -xJf "/tmp/${NODE_TARBALL}" -C /opt/node --strip-components=1 && \
    rm -f /tmp/node-* /tmp/SHASUMS256.txt && \
    ln -sf /opt/node/bin/node /usr/local/bin/node && \
    ln -sf /opt/node/bin/npm /usr/local/bin/npm && \
    ln -sf /opt/node/bin/npx /usr/local/bin/npx

# Install Java 25 (Temurin) with pinned version and checksum verification
ARG JAVA_VERSION=25.0.1+8

# Set architecture for Java download
# Note: The + in version must be URL-encoded as %2B in the GitHub URL path
# But the filename uses underscore (_) instead of plus (+)
RUN if [ "$TARGETARCH" = "arm64" ]; then \
        JAVA_ARCH=aarch64; \
    else \
        JAVA_ARCH=x64; \
    fi && \
    # URL-encode the + sign in version for GitHub URL path
    JAVA_VERSION_ENCODED=$(echo "${JAVA_VERSION}" | sed 's/+/%2B/g') && \
    # Convert + to _ for filename (matches install.sh format)
    JAVA_VERSION_FILENAME=$(echo "${JAVA_VERSION}" | sed 's/+/_/g') && \
    JAVA_URL="https://github.com/adoptium/temurin25-binaries/releases/download/jdk-${JAVA_VERSION_ENCODED}/OpenJDK25U-jdk_${JAVA_ARCH}_linux_hotspot_${JAVA_VERSION_FILENAME}.tar.gz" && \
    JAVA_TAR="/tmp/jdk-25.tar.gz" && \
    curl -fsSL "$JAVA_URL" -o "$JAVA_TAR" && \
    curl -fsSL "${JAVA_URL}.sha256.txt" -o "${JAVA_TAR}.sha256.txt" && \
    ( cd /tmp && awk '{print $1"  jdk-25.tar.gz"}' jdk-25.tar.gz.sha256.txt > jdk-25.sha256 && sha256sum -c jdk-25.sha256 ) && \
    mkdir -p /opt/jdk-25 && \
    tar -xzf "$JAVA_TAR" -C /opt/jdk-25 --strip-components=1 && \
    rm -f "$JAVA_TAR" "${JAVA_TAR}.sha256.txt" && \
    ln -sf /opt/jdk-25/bin/java /usr/local/bin/java && \
    ln -sf /opt/jdk-25/bin/javac /usr/local/bin/javac

# Install hytale-downloader binary (no published checksum; image pins URL)
RUN DOWNLOADER_DIR="/opt/hytale-downloader" && \
    DOWNLOADER_BIN="$DOWNLOADER_DIR/hytale-downloader" && \
    TEMP_ZIP="/tmp/hytale-downloader.zip" && \
    mkdir -p "$DOWNLOADER_DIR" && \
    curl -fsSL "https://downloader.hytale.com/hytale-downloader.zip" -o "$TEMP_ZIP" && \
    unzip -o "$TEMP_ZIP" -d "$DOWNLOADER_DIR" && \
    rm -f "$TEMP_ZIP" && \
    if [ "$TARGETARCH" = "arm64" ]; then \
        if [ -f "$DOWNLOADER_DIR/hytale-downloader-linux-arm64" ]; then \
            mv "$DOWNLOADER_DIR/hytale-downloader-linux-arm64" "$DOWNLOADER_BIN"; \
        fi; \
    else \
        if [ -f "$DOWNLOADER_DIR/hytale-downloader-linux-amd64" ]; then \
            mv "$DOWNLOADER_DIR/hytale-downloader-linux-amd64" "$DOWNLOADER_BIN"; \
        fi; \
    fi && \
    chmod +x "$DOWNLOADER_BIN" && \
    ln -sf "$DOWNLOADER_BIN" /usr/local/bin/hytale-downloader && \
    chown root:root "$DOWNLOADER_BIN"

# Create hypanel user (UID 1000, GID 1000)
# Handle case where GID/UID 1000 might already exist
RUN if getent group 1000 > /dev/null 2>&1; then \
        # GID 1000 exists, check if it's hypanel
        EXISTING_GROUP=$(getent group 1000 | cut -d: -f1) && \
        if [ "$EXISTING_GROUP" != "hypanel" ]; then \
            # Different group owns GID 1000, create hypanel without specifying GID
            groupadd hypanel || true; \
        fi; \
    else \
        # GID 1000 doesn't exist, create hypanel with GID 1000
        groupadd -g 1000 hypanel; \
    fi && \
    if getent passwd 1000 > /dev/null 2>&1; then \
        # UID 1000 exists, check if it's hypanel
        EXISTING_USER=$(getent passwd 1000 | cut -d: -f1) && \
        if [ "$EXISTING_USER" != "hypanel" ]; then \
            # Different user owns UID 1000, create hypanel without specifying UID
            useradd -g hypanel -m -s /bin/bash hypanel || true; \
        else \
            # hypanel already exists with UID 1000, ensure it's in correct group
            usermod -g hypanel -s /bin/bash hypanel 2>/dev/null || true; \
        fi; \
    else \
        # UID 1000 doesn't exist, create hypanel with UID 1000
        useradd -u 1000 -g hypanel -m -s /bin/bash hypanel; \
    fi

# Docker image uses ENV auth only; PAM is not installed (authenticate-pam skipped in build).

# Copy only runtime artifacts (node_modules built in builder so no compile in runtime)
COPY --from=builder /build/apps/backend/package.json /build/apps/backend/package-lock.json /opt/hypanel/apps/backend/
COPY --from=builder /build/apps/backend/node_modules /opt/hypanel/apps/backend/node_modules
COPY --from=builder /build/apps/backend/dist /opt/hypanel/apps/backend/dist
COPY --from=builder /build/apps/webpanel/dist /opt/hypanel/apps/webpanel/dist

WORKDIR /opt/hypanel

# Create directories for persistent data and set ownership
RUN mkdir -p apps/backend/data \
    apps/backend/servers \
    apps/backend/logs \
    apps/backend/backup && \
    chown -R hypanel:hypanel /opt/hypanel

# Expose ports
EXPOSE 3000 3001 5520/udp

# Switch to hypanel user
USER hypanel

# Use tini as entrypoint for proper signal handling
ENTRYPOINT ["/usr/bin/tini", "--"]

# Default command: start backend
CMD ["node", "apps/backend/dist/index.js"]
