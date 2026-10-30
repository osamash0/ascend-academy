#!/usr/bin/env bash
# Install the Learnstation heartbeat on the prod server. Run as root ON THE SERVER
# from the folder holding these files. Asks for the two Better Stack heartbeat
# URLs (they are secrets: typed here, stored mode 600, never echoed).
set -euo pipefail
cd "$(dirname "$0")"

read -rp "Better Stack heartbeat URL for 'learnstation-health': " health
read -rp "Better Stack heartbeat URL for 'db-backup':           " backup
case "$health$backup" in *' '*|'') echo "empty or invalid URL"; exit 1 ;; esac

umask 077
printf 'HEALTH_URL=%s\nBACKUP_URL=%s\n' "$health" "$backup" > /etc/learnstation-heartbeat.conf
chmod 600 /etc/learnstation-heartbeat.conf

install -m 755 learnstation-heartbeat.sh /usr/local/bin/learnstation-heartbeat.sh
install -m 644 learnstation-heartbeat.service learnstation-heartbeat.timer /etc/systemd/system/
install -d /etc/systemd/system/db-backup.service.d
install -m 644 db-backup-heartbeat.conf /etc/systemd/system/db-backup.service.d/heartbeat.conf

systemctl daemon-reload
systemctl enable --now learnstation-heartbeat.timer

echo "--- first heartbeat:"
/usr/local/bin/learnstation-heartbeat.sh
echo "--- backup ping test:"
. /etc/learnstation-heartbeat.conf && curl -fsS -m 10 -o /dev/null -w "%{http_code}\n" "$BACKUP_URL"
echo "--- timer:"
systemctl list-timers learnstation-heartbeat.timer --no-pager | head -2
