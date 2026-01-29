#!/bin/bash
set -e
# When running as root, ensure volume mount points exist and are owned by hypanel
# so the app can write. Then drop to hypanel and run the app.
if [ "$(id -u)" = "0" ]; then
  for dir in /opt/hypanel/apps/backend/data \
             /opt/hypanel/apps/backend/servers \
             /opt/hypanel/apps/backend/logs \
             /opt/hypanel/apps/backend/backup; do
    [ -d "$dir" ] || mkdir -p "$dir"
    chown -R hypanel:hypanel "$dir" || true
  done
  # Docker secrets are root-only; copy to a file hypanel can read (inherited by child)
  if [ -r /run/secrets/hypanel_password_hash ]; then
    cp /run/secrets/hypanel_password_hash /tmp/hypanel_password_hash
    chown hypanel:hypanel /tmp/hypanel_password_hash
    chmod 600 /tmp/hypanel_password_hash
    export HYPANEL_PASSWORD_HASH_FILE=/tmp/hypanel_password_hash
  fi
  exec gosu hypanel /usr/bin/tini -- "$@"
else
  exec /usr/bin/tini -- "$@"
fi
