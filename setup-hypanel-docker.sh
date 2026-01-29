#!/usr/bin/env bash
set -e

# Hypanel Docker setup: create dir, pull image and config, create password hash, start stack
# Usage: ./setup-hypanel-docker.sh

REPO_BASE="${REPO_BASE:-https://raw.githubusercontent.com/OnyxWm/hypanel/main}"
IMAGE="${IMAGE:-ghcr.io/OnyxWM/hypanel:latest}"

echo "==> Creating hypanel directory and entering it"
mkdir -p hypanel
cd hypanel

echo "==> Pulling docker-compose.yml and .env.example from repo"
curl -fsSL "${REPO_BASE}/docker-compose.yml" -o docker-compose.yml
curl -fsSL "${REPO_BASE}/.env.example" -o .env.example

echo "==> Copying .env.example to .env"
cp .env.example .env

echo "==> Pulling Docker image: ${IMAGE}"
docker pull "${IMAGE}"

echo "==> Creating password hash file (you will be prompted for a password)"
mkdir -p secrets
docker run --rm -it --entrypoint "" -v "$(pwd)/secrets:/out" "${IMAGE}" hypanel hash-password --output /out/hypanel_password_hash

echo "==> Starting Hypanel with docker compose"
docker compose up -d

echo "==> Done. Hypanel is running. Log in at http://localhost:3000 (or your host IP)."
