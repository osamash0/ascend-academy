#!/usr/bin/env bash
# Learnstation heartbeat — runs every 5 min (learnstation-heartbeat.timer).
#
# Dead man's switch: when everything is healthy it pings HEALTH_URL (a Better
# Stack heartbeat). When something is wrong it does NOT send the ok ping and
# reports the reason to HEALTH_URL/fail instead. Either way Better Stack alerts:
# on the /fail at once, or when the pings stop (server dead, timer broken,
# this script broken). Silence is the alarm — nothing here has to "remember"
# to shout.
#
# Config: /etc/learnstation-heartbeat.conf (mode 600), HEALTH_URL=...
set -uo pipefail

CONF=/etc/learnstation-heartbeat.conf
[ -r "$CONF" ] && . "$CONF"
[ -n "${HEALTH_URL:-}" ] || { echo "HEALTH_URL not set in $CONF"; exit 0; }

DISK_MAX=85      # % used on /
MEM_MIN_MB=300   # MemAvailable floor
problems=()

# 1. The API's own dependency check (database, both redis, job worker).
#    /health/ready is not exposed through nginx, so ask from inside the container.
ready=$(timeout 20 docker exec ascend-academy-prod-api-1 python -c \
  'import urllib.request;print(urllib.request.urlopen("http://localhost:8000/health/ready",timeout=10).read().decode())' 2>&1)
case "$ready" in
  *'"status":"ok"'*) ;;
  *) problems+=("api not ready: ${ready:0:200}") ;;
esac

# 2. Every production container is running.
for c in api worker frontend redis redis-queue; do
  s=$(docker inspect -f '{{.State.Status}}' "ascend-academy-prod-$c-1" 2>/dev/null)
  [ "$s" = running ] || problems+=("container $c is ${s:-missing}")
done

# 3. The public site answers through nginx + TLS (same path users take).
code=$(curl -s -o /dev/null -m 15 -w '%{http_code}' https://learnstation.app/ || true)
[ "$code" = 200 ] || problems+=("https://learnstation.app answered $code")

# 4. Room to breathe: disk (the Aug-2026 outage) and memory.
use=$(df --output=pcent / | tail -1 | tr -dc 0-9)
[ "$use" -lt "$DISK_MAX" ] || problems+=("disk / at ${use}%")
avail=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo)
[ "$avail" -ge "$MEM_MIN_MB" ] || problems+=("only ${avail} MB memory available")

# 5. TLS certificate has >= 14 days left. certbot renews at 30, so this only
#    fires when renewal is stuck (Better Stack's own SSL-expiry check is paid).
exp=$(echo | timeout 10 openssl s_client -servername learnstation.app -connect 127.0.0.1:443 2>/dev/null \
  | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
if [ -n "$exp" ]; then
  days=$(( ($(date -d "$exp" +%s) - $(date +%s)) / 86400 ))
  [ "$days" -ge 14 ] || problems+=("TLS cert for learnstation.app expires in ${days} days")
else
  problems+=("could not read the TLS cert for learnstation.app")
fi

if [ ${#problems[@]} -eq 0 ]; then
  curl -fsS -m 10 --retry 3 -o /dev/null "$HEALTH_URL" && echo ok
else
  msg="$(hostname): $(printf '%s; ' "${problems[@]}")"
  logger -t heartbeat -p user.err "$msg"
  echo "FAIL $msg"
  curl -fsS -m 10 --retry 3 -o /dev/null -X POST --data-raw "$msg" "$HEALTH_URL/fail" || true
  exit 1
fi
