# Monitoring and off-site backups

*How prod tells you it is unwell, and where the database copies live. Set up and verified on 2026-10-30 (alert test: incident opened, e-mail arrived, closed itself on the next ok ping; backup test: upload, download, decrypt, `pg_restore --list` = 125 tables). Both run on free tiers. Sources: `deploy/server/heartbeat/`, `deploy/server/offsite-backup/`.*

## The idea: silence is the alarm

The server does not shout when something breaks; it checks in when everything is fine. Better Stack alerts when a check-in reports a problem **or stops arriving**, so a dead server, a broken timer and a broken script all page the same way.

| What breaks | Who notices | Within |
|---|---|---|
| Site unreachable from outside | Better Stack monitor on `https://learnstation.app` | 3 min |
| Server dead; api `/health/ready` not ok (database, both redis, worker); a prod container not running; public https not 200; disk ≥ 85 %; MemAvailable < 300 MB; TLS cert < 14 days | `learnstation-health` heartbeat, fed every 5 min by `learnstation-heartbeat.timer` | 5 to 10 min |
| Nightly dump failed, or its off-site copy failed | `db-backup` heartbeat, pinged only after both succeed | by ~05:30 UTC |

Alerts go to Abi by e-mail (Better Stack free plan: push, SMS and SSL/domain-expiry checks are paid, which is why the cert check lives in our script).

## Where things are

| Thing | Where |
|---|---|
| Heartbeat script + timer | `/usr/local/bin/learnstation-heartbeat.sh`, `/etc/systemd/system/learnstation-heartbeat.{service,timer}` |
| Heartbeat URLs (secret) | `/etc/learnstation-heartbeat.conf` (600 root): `HEALTH_URL`, `BACKUP_URL` |
| Nightly dump | `db-backup.timer` 03:30 UTC → `/usr/local/bin/db-backup.sh` → `/var/backups/learnstation/db/` (7 kept) |
| Off-site copy | `/usr/local/bin/offsite-backup.sh`, run by `db-backup.service.d/05-offsite.conf` |
| Backup ping | `db-backup.service.d/heartbeat.conf`; `05-` sorts first, so the ping follows the upload |
| R2 keys + encryption public key (secret) | `/etc/offsite-backup.conf` (600 root) |
| Bucket | Cloudflare R2 `learnstation-backups`, EU jurisdiction, Standard class, private, prefix `db/` |
| **Decryption key** | **Only in Abi's password manager** ("Learnstation backup encryption key"). Never on the server. Lose it and the R2 copies are unreadable. |

## Staying inside the R2 free tier (10 GB)

Four independent guards; any one of them is enough at ~22 MB per dump:

1. `offsite-backup.sh` deletes its own copies older than 14 days.
2. Bucket lifecycle rule `delete-after-30-days` (plus Cloudflare's default 7-day multipart abort).
3. `offsite-backup.sh` refuses to upload once the bucket holds 2 GB, which fails the unit and so alerts.
4. Uploads use the `STANDARD` class, the only one the free tier covers.

Do not add a bucket lock rule from the dashboard without changing its retention: the form defaults to **Indefinite**, which would block every delete and let storage grow without limit.

The R2 token `learnstation-server-backups` is Object Read & Write on that one bucket, IP-limited to the server (`195.201.221.137` and its IPv6 /64). It cannot list or touch other buckets (verified).

## Install or rebuild

Both installers run as root on the server and ask for their secrets at a prompt; never put them on a command line or in chat.

```bash
scp -r deploy/server/heartbeat deploy/server/offsite-backup root@195.201.221.137:/root/
ssh -t root@195.201.221.137 'bash /root/heartbeat/install.sh'        # asks for the two Better Stack heartbeat URLs
ssh -t root@195.201.221.137 'bash /root/offsite-backup/install.sh'   # asks for the R2 key, makes a new age key pair, tests a restore
```

Copy to `/root/` as above. Copying into a folder that already exists nests the new files one level down, and the old installer runs instead (this happened on 2026-10-30).

`offsite-backup/install.sh` prints the new private key once and shreds it. A new key pair means older R2 copies need the **old** key; keep both until those copies age out (30 days).

## Check that it works

```bash
ssh root@195.201.221.137 'systemctl list-timers learnstation-heartbeat.timer db-backup.timer --no-pager; journalctl -u learnstation-heartbeat -n 3 -o cat; journalctl -t offsite-backup -n 3 --no-pager'
```

Safe alert test (sends one fake failure; the next normal check-in closes it):

```bash
ssh root@195.201.221.137 '. /etc/learnstation-heartbeat.conf && curl -fsS -X POST --data-raw "TEST alert - ignore" "$HEALTH_URL/fail"'
```

## Restore from R2

1. Download the object you want: Cloudflare dashboard → R2 → `learnstation-backups` → `db/` → Download. Names are `supabase-<UTC timestamp>.dump.age`.
2. Put the private key from the password manager in a file on a trusted machine, then decrypt: `age -d -i key.txt -o x.dump supabase-….dump.age`. Delete `key.txt` afterwards.
3. Check it: `pg_restore --list x.dump | grep -c "TABLE DATA"` (expect well over 50).
4. Restore with the rules in `CLAUDE.md`: session pooler on port 5432 (never 6543), and create the `extensions` schema first or rows vanish.
