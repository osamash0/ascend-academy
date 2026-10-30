#!/usr/bin/env bash
# Install the R2 off-site backup on the prod server. Run as root ON THE SERVER.
# Asks for the R2 access key (typed here, stored mode 600, never echoed back),
# creates a fresh age key pair, shows the PRIVATE key once for the password
# manager and keeps only the public half here. Then proves the whole chain:
# upload -> download -> decrypt -> pg_restore --list.
set -euo pipefail
cd "$(dirname "$0")"

ENDPOINT=https://0258eeb3a472c5f1d2b9c790252691f1.eu.r2.cloudflarestorage.com

echo "--- installing age + rclone"
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq age rclone >/dev/null
rclone version | head -1

read -rp  "R2 Access Key ID:     " key_id
read -rsp "R2 Secret Access Key: " secret; echo
[ -n "$key_id" ] && [ -n "$secret" ] || { echo "empty key"; exit 1; }

echo "--- creating the encryption key"
# age-keygen refuses to write into an existing file, so give it a fresh path in a private dir.
keydir=$(mktemp -d /root/age-key.XXXXXX); keyfile="$keydir/key.txt"
trap 'shred -u "$keyfile" 2>/dev/null; rm -rf "$keydir"' EXIT
age-keygen -o "$keyfile"
recipient=$(age-keygen -y "$keyfile")

umask 077
cat > /etc/offsite-backup.conf <<EOF
R2_ACCESS_KEY_ID=$key_id
R2_SECRET_ACCESS_KEY=$secret
R2_ENDPOINT=$ENDPOINT
AGE_RECIPIENT=$recipient
EOF
chmod 600 /etc/offsite-backup.conf

install -m 755 offsite-backup.sh /usr/local/bin/offsite-backup.sh

echo "--- first upload"
/usr/local/bin/offsite-backup.sh

echo "--- restore test: download, decrypt, read"
. /etc/offsite-backup.conf
export RCLONE_CONFIG_R2_TYPE=s3 RCLONE_CONFIG_R2_PROVIDER=Cloudflare RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true
export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" RCLONE_CONFIG_R2_ENDPOINT="$R2_ENDPOINT"
latest=$(rclone lsf r2:learnstation-backups/db | sort | tail -1)
work=$(mktemp -d); rclone copyto "r2:learnstation-backups/db/$latest" "$work/x.age"
age -d -i "$keyfile" -o "$work/x.dump" "$work/x.age"
tables=$(docker run --rm -i postgres:latest pg_restore --list < "$work/x.dump" | grep -c "TABLE DATA")
rm -rf "$work"
echo "restore test: $latest decrypts and holds $tables tables"
[ "$tables" -ge 50 ] || { echo "RESTORE TEST FAILED"; exit 1; }

echo "--- hooking it into the nightly backup"
install -d /etc/systemd/system/db-backup.service.d
install -m 644 05-offsite.conf /etc/systemd/system/db-backup.service.d/05-offsite.conf
systemctl daemon-reload

cat <<EOF

==================================================================
 SAVE THIS PRIVATE KEY IN YOUR PASSWORD MANAGER NOW
 ("Learnstation backup encryption key"). It is NOT kept on the
 server. Without it the R2 backups can never be read again.
==================================================================
$(grep '^AGE-SECRET-KEY-' "$keyfile")
==================================================================
EOF
read -rp "Type SAVED once it is in your password manager: " ok
[ "$ok" = SAVED ] || echo "(not confirmed - run 'age-keygen' again later if it was lost)"
echo "done. The key file is now shredded from the server."
