#!/usr/bin/env bash
set -euo pipefail

# Change Hypanel Docker login password (updates secret file or .env, then optionally restarts).
# Run from the directory that contains docker-compose.yml and .env (repo root or hypanel/).
#
# Usage:
#   ./change-password-docker.sh                    # prompt for new password
#   ./change-password-docker.sh --password 'pass'   # non-interactive
#   ./change-password-docker.sh --restart           # also run docker compose restart
#
# Options:
#   --password 'pass'   use this password (no prompt)
#   --restart           run docker compose restart after updating
#   --env-only          update only .env (HYPANEL_PASSWORD_HASH), not the secret file
#   --secret-only       update only ./secrets/hypanel_password_hash, not .env

IMAGE="${IMAGE:-ghcr.io/onyxwm/hypanel:latest}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PASSWORD=""
DO_RESTART=false
MODE=""   # "" = auto, "env", "secret"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --password)
      if [[ -z "${2:-}" ]]; then
        echo "Error: --password requires a value." >&2
        exit 1
      fi
      PASSWORD="$2"
      shift 2
      ;;
    --restart)
      DO_RESTART=true
      shift
      ;;
    --env-only)
      MODE="env"
      shift
      ;;
    --secret-only)
      MODE="secret"
      shift
      ;;
    -h|--help)
      head -20 "$(dirname "${BASH_SOURCE[0]}")/change-password-docker.sh" | sed 's/^# \?//'
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

# Ensure we're in a directory with docker-compose
if [[ ! -f docker-compose.yml ]]; then
  echo "Error: docker-compose.yml not found in $SCRIPT_DIR. Run this script from the directory that contains docker-compose.yml." >&2
  exit 1
fi

# Resolve target: secret file vs .env
SECRET_FILE=""
if [[ -f ./secrets/hypanel_password_hash ]]; then
  SECRET_FILE="./secrets/hypanel_password_hash"
fi
ENV_FILE=""
if [[ -f .env ]]; then
  ENV_FILE=".env"
fi

use_secret() {
  if [[ -n "$SECRET_FILE" ]]; then return 0; fi
  return 1
}
use_env() {
  if [[ -n "$ENV_FILE" ]]; then return 0; fi
  return 1
}

case "$MODE" in
  secret)
    if ! use_secret; then
      mkdir -p secrets
      SECRET_FILE="./secrets/hypanel_password_hash"
    fi
    TARGET="secret"
    ;;
  env)
    if ! use_env; then
      echo "Error: .env not found. Create it from .env.example first." >&2
      exit 1
    fi
    TARGET="env"
    ;;
  *)
    if use_secret; then
      TARGET="secret"
    elif use_env; then
      TARGET="env"
    else
      echo "Error: No password configuration found. Create .env (from .env.example) or ./secrets/hypanel_password_hash first." >&2
      exit 1
    fi
    ;;
esac

# Get new password
if [[ -z "$PASSWORD" ]]; then
  read -rsp "New Hypanel password: " PASSWORD
  echo
  read -rsp "Confirm password: " PASSWORD_CONFIRM
  echo
  if [[ "$PASSWORD" != "$PASSWORD_CONFIRM" ]]; then
    echo "Error: Passwords do not match." >&2
    exit 1
  fi
fi
if [[ -z "$PASSWORD" ]]; then
  echo "Error: Password cannot be empty." >&2
  exit 1
fi

# Generate hash using the Hypanel image (no local Node required)
get_hash() {
  docker run --rm "${IMAGE}" hypanel hash-password --password "$1"
}

# Strip optional "HYPANEL_PASSWORD_HASH=" prefix if present
normalize_hash_line() {
  local line="$1"
  if [[ "$line" =~ ^HYPANEL_PASSWORD_HASH=(.*)$ ]]; then
    echo "${BASH_REMATCH[1]}"
  else
    echo "$line"
  fi
}

echo "==> Generating bcrypt hash..."
HASH_LINE="$(get_hash "$PASSWORD")"
HASH="$(normalize_hash_line "$HASH_LINE")"

if [[ -z "$HASH" || ! "$HASH" =~ ^\$2[aby] ]]; then
  echo "Error: Failed to generate valid bcrypt hash." >&2
  exit 1
fi

if [[ "$TARGET" == "secret" ]]; then
  echo "==> Updating $SECRET_FILE"
  mkdir -p "$(dirname "$SECRET_FILE")"
  printf '%s\n' "$HASH" > "$SECRET_FILE"
  chmod 600 "$SECRET_FILE"
  echo "Password updated in secret file."
else
  echo "==> Updating .env"
  if grep -q '^HYPANEL_PASSWORD_HASH=' "$ENV_FILE" 2>/dev/null; then
    # Replace existing HYPANEL_PASSWORD_HASH (sed portable: no -i in POSIX, use temp)
    if sed "s|^HYPANEL_PASSWORD_HASH=.*|HYPANEL_PASSWORD_HASH=$HASH|" "$ENV_FILE" > "${ENV_FILE}.tmp"; then
      mv "${ENV_FILE}.tmp" "$ENV_FILE"
    else
      echo "Error: Failed to update .env" >&2
      exit 1
    fi
  elif grep -q '^# HYPANEL_PASSWORD_HASH=' "$ENV_FILE" 2>/dev/null; then
    sed "s|^# HYPANEL_PASSWORD_HASH=.*|HYPANEL_PASSWORD_HASH=$HASH|" "$ENV_FILE" > "${ENV_FILE}.tmp" && mv "${ENV_FILE}.tmp" "$ENV_FILE"
  else
    # Ensure HYPANEL_AUTH_METHOD=ENV exists and add hash after it
    if grep -q '^HYPANEL_AUTH_METHOD=' "$ENV_FILE" 2>/dev/null; then
      sed "/^HYPANEL_AUTH_METHOD=/a\\
HYPANEL_PASSWORD_HASH=$HASH" "$ENV_FILE" > "${ENV_FILE}.tmp" && mv "${ENV_FILE}.tmp" "$ENV_FILE"
    else
      echo "HYPANEL_AUTH_METHOD=ENV" >> "$ENV_FILE"
      echo "HYPANEL_PASSWORD_HASH=$HASH" >> "$ENV_FILE"
    fi
  fi
  # Remove plaintext password if present (prefer hash)
  if grep -q '^HYPANEL_PASSWORD=' "$ENV_FILE" 2>/dev/null; then
    sed '/^HYPANEL_PASSWORD=/d' "$ENV_FILE" > "${ENV_FILE}.tmp" && mv "${ENV_FILE}.tmp" "$ENV_FILE"
  fi
  echo "Password updated in .env (HYPANEL_PASSWORD_HASH)."
fi

echo ""
echo "Done. Restart the stack for the new password to take effect:"
echo "  docker compose restart"
if [[ "$DO_RESTART" == true ]]; then
  echo "==> Running: docker compose restart"
  docker compose restart
fi
