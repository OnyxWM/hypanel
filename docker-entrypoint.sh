#!/bin/bash
set -e
# When running as root (default with named volumes), ensure volume mount points
# are owned by hypanel so the app can write. Then drop to hypanel and run the app.
if [ "$(id -u)" = "0" ]; then
  chown -R hypanel:hypanel /opt/hypanel/apps/backend/data \
    /opt/hypanel/apps/backend/servers \
    /opt/hypanel/apps/backend/logs \
    /opt/hypanel/apps/backend/backup 2>/dev/null || true
  exec gosu hypanel /usr/bin/tini -- "$@"
else
  exec /usr/bin/tini -- "$@"
fi
