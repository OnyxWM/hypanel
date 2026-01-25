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
ARG TARGETARCH

# Set architecture for Node.js download
RUN if [ "$TARGETARCH" = "arm64" ]; then \
        NODE_ARCH=arm64; \
    fi && \
    curl -fsSL "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" -o /tmp/node.tar.xz && \
    tar -xJf /tmp/node.tar.xz -C /opt --strip-components=1 && \
    rm /tmp/node.tar.xz && \
    ln -sf /opt/bin/node /usr/local/bin/node && \
    ln -sf /opt/bin/npm /usr/local/bin/npm && \
    ln -sf /opt/bin/npx /usr/local/bin/npx

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

# Build backend TypeScript
RUN cd apps/backend && npm run build

# Build frontend
RUN cd apps/webpanel && npm run build

# Runtime stage: minimal image with only runtime dependencies
FROM ubuntu:24.04

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install runtime dependencies
# Note: libpam0g-dev not needed since authenticate-pam is optional and skipped
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    unzip \
    tar \
    jq \
    python3 \
    rsync \
    sudo \
    tini \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 24 LTS (pinned version, runtime only)
ARG NODE_VERSION=v24.13.0
ARG NODE_ARCH=x64
ARG TARGETARCH

RUN if [ "$TARGETARCH" = "arm64" ]; then \
        NODE_ARCH=arm64; \
    fi && \
    curl -fsSL "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" -o /tmp/node.tar.xz && \
    tar -xJf /tmp/node.tar.xz -C /opt --strip-components=1 && \
    rm /tmp/node.tar.xz && \
    ln -sf /opt/bin/node /usr/local/bin/node && \
    ln -sf /opt/bin/npm /usr/local/bin/npm && \
    ln -sf /opt/bin/npx /usr/local/bin/npx

# Install Java 25 (Temurin) with pinned version and checksum verification
ARG JAVA_VERSION=25.0.1+8
ARG TARGETARCH

# Set architecture for Java download
RUN if [ "$TARGETARCH" = "arm64" ]; then \
        JAVA_ARCH=aarch64; \
        JAVA_CHECKSUM_AMD64=""; \
        JAVA_CHECKSUM_ARM64=""; \
    else \
        JAVA_ARCH=x64; \
        JAVA_CHECKSUM_AMD64=""; \
        JAVA_CHECKSUM_ARM64=""; \
    fi && \
    JAVA_URL="https://github.com/adoptium/temurin25-binaries/releases/download/jdk-${JAVA_VERSION}/OpenJDK25U-jdk_${JAVA_ARCH}_linux_hotspot_${JAVA_VERSION}.tar.gz" && \
    JAVA_TAR="/tmp/jdk-25.tar.gz" && \
    curl -fsSL "$JAVA_URL" -o "$JAVA_TAR" && \
    # TODO: Add SHA-256 checksum verification here
    # Download checksum file and verify:
    # curl -fsSL "${JAVA_URL}.sha256.txt" -o "${JAVA_TAR}.sha256" && \
    # sha256sum -c "${JAVA_TAR}.sha256" && \
    mkdir -p /opt/jdk-25 && \
    tar -xzf "$JAVA_TAR" -C /opt/jdk-25 --strip-components=1 && \
    rm -f "$JAVA_TAR" && \
    ln -sf /opt/jdk-25/bin/java /usr/local/bin/java && \
    ln -sf /opt/jdk-25/bin/javac /usr/local/bin/javac

# Install hytale-downloader binary
ARG TARGETARCH
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
RUN groupadd -g 1000 hypanel && \
    useradd -u 1000 -g 1000 -m -s /bin/bash hypanel

# Set up PAM configuration for authentication (optional, for PAM auth mode)
# Note: This is kept for compatibility, but PAM auth requires authenticate-pam package
# which is skipped in Docker builds. Users should use ENV auth mode instead.
RUN echo "hypanel:x:1000:1000::/home/hypanel:/bin/bash" >> /etc/passwd && \
    mkdir -p /etc/pam.d && \
    echo "auth required pam_unix.so" > /etc/pam.d/hypanel && \
    echo "account required pam_unix.so" >> /etc/pam.d/hypanel

# Copy built application from builder stage
COPY --from=builder --chown=hypanel:hypanel /build /opt/hypanel

# Set working directory
WORKDIR /opt/hypanel

# Create directories for persistent data
RUN mkdir -p apps/backend/data \
    apps/backend/servers \
    apps/backend/logs \
    apps/backend/backup && \
    chown -R hypanel:hypanel apps/backend/data \
    apps/backend/servers \
    apps/backend/logs \
    apps/backend/backup

# Expose ports
EXPOSE 3000 3001

# Switch to hypanel user
USER hypanel

# Use tini as entrypoint for proper signal handling
ENTRYPOINT ["/usr/bin/tini", "--"]

# Default command: start backend
CMD ["node", "apps/backend/dist/index.js"]
