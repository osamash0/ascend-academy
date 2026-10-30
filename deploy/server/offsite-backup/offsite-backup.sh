#!/usr/bin/env bash
# Off-site copy of the newest database dump -> Cloudflare R2 (free tier).
#
# Runs right after db-backup.sh (ExecStartPost in db-backup.service.d/05-offsite.conf),
# so it only ever sees a dump that already passed db-backup's own checks.
#
# - Encrypted with age before it leaves the box: Cloudflare only stores ciphertext.
#   The private key is NOT on this server (it lives in Abi's password manager).
# - Free-tier guards (R2 free = 10 GB Standard storage):
#     1. deletes our copies older than KEEP_DAYS here,
#     2. the bucket's own lifecycle rule deletes anything older than 30 days,
#     3. refuses to upload once the bucket holds MAX_BUCKET_GB,
#     4. STANDARD storage class only (the only class the free tier covers).
# - Exit != 0 makes db-backup.service fail -> no heartbeat ping -> Better Stack alerts.
#
# Config: /etc/offsite-backup.conf (mode 600): R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
#         R2_ENDPOINT, AGE_RECIPIENT
set -euo pipefail

CONF=/etc/offsite-backup.conf
SRC=/var/backups/learnstation/db
BUCKET=learnstation-backups
PREFIX=db
KEEP_DAYS=14
MAX_BUCKET_GB=2

. "$CONF"
export RCLONE_CONFIG_R2_TYPE=s3
export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export RCLONE_CONFIG_R2_ENDPOINT="$R2_ENDPOINT"
export RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true   # the token may not create buckets, and needn't
dest="r2:$BUCKET/$PREFIX"

newest=$(ls -1t "$SRC"/supabase-*.dump 2>/dev/null | head -1)
[ -n "$newest" ] || { echo "no dump in $SRC"; exit 1; }

# Guard 3: never grow the bucket past MAX_BUCKET_GB.
used=$(rclone size --json "$dest" | python3 -c 'import json,sys; print(json.load(sys.stdin)["bytes"])')
cap=$(( MAX_BUCKET_GB * 1024 * 1024 * 1024 ))
if [ "$used" -ge "$cap" ]; then
  echo "REFUSED: bucket already holds $used bytes (cap ${MAX_BUCKET_GB} GB) - check the lifecycle rule"
  exit 1
fi

tmp=$(mktemp /tmp/offsite.XXXXXX); trap 'rm -f "$tmp"' EXIT
age -r "$AGE_RECIPIENT" -o "$tmp" "$newest"
name="$(basename "$newest").age"
rclone copyto "$tmp" "$dest/$name" --s3-storage-class STANDARD

# Guard 1: our own retention.
rclone delete "$dest" --min-age "${KEEP_DAYS}d"

count=$(rclone lsf "$dest" | wc -l)
logger -t offsite-backup "OK $name bucket_bytes_before=$used objects=$count"
echo "offsite OK: $name (objects in bucket: $count)"
