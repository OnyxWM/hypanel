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
  exec gosu hypanel /usr/bin/tini -- "$@"
else
  exec /usr/bin/tini -- "$@"
fi
