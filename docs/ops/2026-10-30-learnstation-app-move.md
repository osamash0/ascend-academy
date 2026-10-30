STATUS: IN PROGRESS — step 3

| step | status | before → after | evidence (UTC) | rollback |
| --- | --- | --- | --- | --- |
| 0: recon | done | Server, Cloudflare and Resend baseline verified; Supabase project/org, Auth URLs, SMTP ON and recovery subject/body confirmed. No production setting changed by the agent. | Connector/SSH evidence and Abi readbacks below. Site URL `http://localhost:3000`; email subject/body already match requested values. | No production change to undo. |
| 0a: Cloudflare inventory | done | Four mail records, all `proxied=false` → unchanged. | `GET /zones` and `GET /zones/{zone_id}/dns_records`: success, HTTP 200, total_count=4, one page. | Read-only; none. |
| 0b: Resend baseline | done | Verified EU domain, sending enabled, receiving/open/click tracking disabled → unchanged. | Resend `list_domains` and `get_domain`: verified, eu-west-1, sending enabled, receiving disabled, open_tracking=false, click_tracking=false; DKIM/SPF verified. | Read-only; none. |
| 0c: redirect allow-list readback | done by Abi | `https://learnstation.duckdns.org/**` and `https://195-201-221-137.sslip.io/**` → unchanged. Site URL still unknown. | 2026-10-30T15:07:09Z: Abi pasted the current URL Configuration page text; its Site URL input value was not included. | Read-only; none. |
| 0d: custom SMTP readback | done by Abi | Custom SMTP ON; Learnstation sender, Resend host/port/username confirmed → unchanged. | 2026-10-30T15:09:28Z: Abi explicitly confirmed the switch is on; supplied non-secret SMTP details below. Password not requested/read/changed. | Read-only; none. |
| 0e: recovery body readback | done by Abi | Abi reports the exact requested bilingual body using `{{ .ConfirmationURL }}` → no body edit needed if this is the saved current value. | 2026-10-30T15:10:49Z: full HTML supplied in response to the request for current template content; matches the body preserved below. Subject still unknown. | No body change performed; preserve reported body. |
| 0f: Site URL readback | done by Abi | `http://localhost:3000` → unchanged during recon; planned replacement `https://learnstation.app` after first go. | 2026-10-30T15:11:49Z: Abi explicitly supplied the current Site URL field value. | Read-only; none. |
| 0g: recovery subject readback | done by Abi | `Learnstation: Passwort zurücksetzen · Reset your password` → unchanged; already matches requested value. | 2026-10-30T15:12:34Z: Abi supplied the current subject. | Read-only; none. |
| 1: DNS | done | No apex/www records → A `@` = `195.201.221.137`, CNAME `www` = `learnstation.app`, both DNS only, TTL 300. | 2026-10-30T15:15:21Z: Cloudflare final GET succeeds, six records; original four mail records unchanged. Both `dig @1.1.1.1` and `dig @8.8.8.8` resolve apex A, www CNAME and www A correctly; outputs below. | Delete only A ID `6c96e98ae307209f2e48fa97d2724072` and www CNAME ID `5b8eda11583b8e291ec907145126eb18`; retain all four mail records. |
| 2: TLS/nginx | done | Only old sites/certs → separate apex/www HTTPS site and Let's Encrypt certificate; www and new HTTP hosts 301 to apex, preserving URI. | 2026-10-30T15:19Z–15:23Z: apex 200 with TLS verification 0; www 301 with path/query intact; Let's Encrypt YE1, expires 2027-01-28T14:20:41Z; `nginx -t` passes; all three renewal dry runs succeed; old site files byte-identical. | Disable only new enabled symlink, test nginx and reload; leave original sites/certificates in place. Backups `.bak-20261030-1519` and `.bak-20261030-1521`; details below. |
| 3: CORS | pending | `https://learnstation.duckdns.org,https://195-201-221-137.sslip.io` → append `https://learnstation.app`. | Only the `CORS_ALLOWED_ORIGINS` line was read from `.env`; API healthy. | Restore `.env` backup and recreate only `api`, without building/pulling. |
| 4: Auth URLs | pending | Site URL `http://localhost:3000`; allow list contains DuckDNS and sslip wildcard entries → Site URL `https://learnstation.app`, add `https://learnstation.app/**`, preserve both existing entries. | Abi's URL Configuration readback recorded below. Connector exposes no Auth configuration read/write tools; later dashboard change required. | Restore `http://localhost:3000`; remove only the newly added apex redirect entry, preserving both original entries. |
| 5: recovery email/tracking/test | pending | Reported subject/body already match requested template; open/click tracking OFF → preserve these values; test after new-domain/Auth URL readiness. | Subject/body readback done by Abi; Resend settings verified by connector. No test mail requested/sent. | No template/tracking change needed from current baseline; restore Auth URLs per step 4 if migration is rolled back. |
| 6: old host redirects | pending | DuckDNS serves app on 3000; sslip points at separate gateway on 3001, currently 502 → proposed 301 to apex after second explicit go. | `curl -I`: DuckDNS 200; sslip 502; localhost:3001 connection refused. | Restore both backed-up old site files, run `nginx -t`, reload. Keep their certificates. |
| 7: recovery link code PR | pending | Existing implicit recovery flow → add token-hash verification while retaining implicit flow, separate undeployed branch/PR. | No application source changed or deployed. | Close/revert the separate code PR; no live effect until separately deployed. |
| 8: finish | pending | Deployment/runbook address updates and completed evidence pending. | Ops log branch created from `origin/main` at `e2de2766bad4d2fb88a1eaaf3e80b3813654a9aa`, first commit `08682528` pushed. GitHub create_pull_request rejected with HTTP 403, Resource not accessible by integration; draft PR not created. | Revert documentation-only changes if required. |

## Scope and checkpoints

Owner: Abi. Target: `learnstation.app`, server `195.201.221.137`, Supabase project `lkiiideqjoiksnycgplc`.

This log contains observations from 2026-10-30 in UTC. Handoff assertions are distinguished from freshly verified values. No SMTP password, API key, database URL, service-role key, full `.env`, certificate private key or recovery token is included.

The server remains on `deploy/legal-20261030`. No checkout, image, worker, frontend, database, migration or application deployment changes are authorized by this log. Other PRs are outside scope.

STOP 1: BEFORE-value recon complete at 2026-10-30T15:12:34Z. Abi explicitly replied **“go and do 1 with Cloudflare”** at the 2026-10-30T15:14Z checkpoint. Proceed with **step 1 only** using the connected Cloudflare API; stop after DNS verification/logging. The draft PR remains pending due to connector 403; Abi explicitly requested proceeding with step 1 despite that outstanding documentation item. No approval inferred for the step 6 STOP point.

STOP 2: After Abi tests the new domain, wait for another explicit **go** before redirecting either old hostname. Not received.

2026-10-30T15:18:01Z: Abi said **“continue next”** after step 1; proceeding with **step 2 TLS/nginx only**, then stopping ahead of CORS. This does not authorize the step 6 redirects.

## Read-only recon evidence

### Access and connector coverage

- 2026-10-30T14:57Z: plugin search for `Cloudflare Resend` returned an empty plugin list. Separate searches for `Cloudflare` and `Resend` also returned empty lists. This does not establish that no integration exists outside the surfaced catalog.
- Supabase plugin is installed/enabled. Available tool inventory has project/database/Edge Function operations, but no Auth configuration or email-template read/write operation. No SQL or credential-based workaround attempted.
- Abi connected Cloudflare and Resend after requesting a pause. Both now support the required read-only checks; results are below. No production configuration action is marked **done by Abi** without a report/readback.
- 2026-10-30T15:00Z: GitHub connector `create_pull_request`, base `main`, head `ops/learnstation-app-move`, draft=true, returned HTTP 403: `Resource not accessible by integration`. No PR was created. Per rule 4, no CLI/browser workaround attempted; dashboard draft-creation handoff below.
- 2026-10-30T15:05Z: Supabase `list_projects` on the Learnstation connection confirms **Ascend Academy**, project `lkiiideqjoiksnycgplc`, region `eu-west-1`, status `ACTIVE_HEALTHY`; `get_organization` confirms **osama's org**, organization `kbodqbgqptugjxjpctbt`. Use this connection for the migration. The other connection exposes a different project and is outside scope.

### Cloudflare record inventory (verified)

2026-10-30T15:05Z–15:06Z: `GET /zones?name=learnstation.app` returns one active full zone; `GET /zones/09f8045d57baa5b18239a2168f4a4288/dns_records?per_page=100&page=1` returns success, HTTP 200, exactly four records, one page.

| type | name | content | proxied | TTL |
| --- | --- | --- | --- | --- |
| CNAME | rsend.learnstation.app | rsend-euw1.forge.rmta.net | false | 3600 |
| CNAME | send.learnstation.app | send.forge.rmta.net | false | 3600 |
| TXT | _dmarc.learnstation.app | `v=DMARC1; p=none;` | false | Auto (1) |
| TXT | resend._domainkey.learnstation.app | Public DKIM key omitted | false | 3600 |

No apex A, apex AAAA or www record exists. Preserve all four listed records unchanged.

### Resend baseline (verified)

2026-10-30T15:05Z: `list_domains` and `get_domain` return `learnstation.app`, status **verified**, region **eu-west-1**, sending **enabled**, receiving **disabled**, open tracking **false**, click tracking **false**. DKIM and both SPF CNAME records show **verified**. No configuration change needed for receiving/tracking. No test email sent.

### Supabase Auth dashboard readback

Recorded 2026-10-30T15:07:09Z, **done by Abi** (read-only): Abi supplied URL Configuration page text showing these Redirect URLs:

```text
https://learnstation.duckdns.org/**
https://195-201-221-137.sslip.io/**
```

The initial paste included the Site URL label/help text but omitted the input value; the later explicit readback below resolves this.

Recorded 2026-10-30T15:09:28Z, **done by Abi** (read-only): Abi supplied sender email `noreply@learnstation.app`, sender name `Learnstation`, SMTP host `smtp.resend.com`, port `465`, username `resend`, then explicitly confirmed **Enable custom SMTP is ON**. These values match the handoff. The SMTP password was not requested, read or changed.

Recorded 2026-10-30T15:10:49Z, **done by Abi** (template readback): Abi supplied the full HTML body in response to the request for current template content. It matches the bilingual body preserved below exactly, including both `{{ .ConfirmationURL }}` links. No edit/save was reported, and the connector cannot independently verify the saved value. Do not infer the previous default body or a completed template change from this readback.

Recorded 2026-10-30T15:11:49Z, **done by Abi** (read-only): Abi explicitly reports Site URL **`http://localhost:3000`**. This is the BEFORE value, not a proposed production setting. After first go and once new-domain HTTPS is ready, step 4 replaces it with `https://learnstation.app` while preserving the two existing redirect entries and adding `https://learnstation.app/**`.

Recorded 2026-10-30T15:12:34Z, **done by Abi** (read-only): Abi supplies current recovery subject **`Learnstation: Passwort zurücksetzen · Reset your password`**. It already matches the requested subject. Together with the reported body, no recovery-template edit is needed from this baseline. All step 0 settings now have recorded BEFORE values; the agent has made no production changes.

### Public DNS

Commands, 2026-10-30T14:57Z:

```sh
dig @1.1.1.1 learnstation.app A +noall +answer
dig @8.8.8.8 learnstation.app A +noall +answer
dig @1.1.1.1 www.learnstation.app CNAME +noall +answer
dig @8.8.8.8 www.learnstation.app CNAME +noall +answer
```

All four returned no answer records. This is not a Cloudflare record inventory and does not verify proxy settings.

The later Cloudflare connector inventory above confirms the handoff's four mail records and DNS-only state. Preserve all four exactly.

### nginx and certificates

Commands: `readlink -f /etc/nginx/sites-enabled/ascend-academy`; read both enabled site files; `certbot certificates`; `openssl x509 -in <fullchain.pem> -noout -issuer -dates -ext subjectAltName`; `nginx -t`.

2026-10-30T14:57:57Z observations:

- `/etc/nginx/sites-enabled/ascend-academy` points to `/etc/nginx/sites-available/ascend-academy`.
- DuckDNS HTTPS proxies `/` to `http://127.0.0.1:3000`, uses HTTP/1.1, passes Host/X-Real-IP/X-Forwarded-For/X-Forwarded-Proto, permits 100M bodies and sets a 120s proxy read timeout. HTTP redirects to the same host's HTTPS. TLS uses Certbot's options file and DH parameters.
- `/etc/nginx/sites-enabled/195-201-221-137.sslip.io` points to the corresponding file in sites-available. Its comments identify an anonymization gateway, and HTTPS proxies to `http://127.0.0.1:3001`, passing the same four proxy headers. It listens on IPv4 and IPv6. HTTP redirects to the same host's HTTPS.
- DuckDNS certificate: Let's Encrypt **YE2**, expires **2026-12-08T21:21:53Z**, SAN `learnstation.duckdns.org`.
- sslip certificate: Let's Encrypt **YE1**, expires **2026-12-08T21:21:43Z**, SAN `195-201-221-137.sslip.io`.
- No apex/www certificate was listed.
- `nginx -t`: `syntax is ok`; `test is successful`. No reload/restart performed.

2026-10-30T14:58Z, `curl --max-time 15 -sSI <URL>` from server:

```text
https://learnstation.duckdns.org       HTTP/1.1 200 OK
https://195-201-221-137.sslip.io        HTTP/1.1 502 Bad Gateway
http://127.0.0.1:3000                  HTTP/1.1 200 OK
http://127.0.0.1:3001                  curl (7): connection refused
```

The sslip gateway failure predates this task. Its role must be included in the second checkpoint before replacing its behavior with the requested redirect.

### Server environment and containers

Commands: `git branch --show-current`; `sed -n '/^CORS_ALLOWED_ORIGINS=/p' .env`; `docker compose -f docker-compose.prod.yml ps`, run from `/root/ascend-academy`.

2026-10-30T14:57:28Z:

```text
branch: deploy/legal-20261030
CORS_ALLOWED_ORIGINS="https://learnstation.duckdns.org,https://195-201-221-137.sslip.io"
api          Up 20 hours (healthy)
frontend     Up 3 hours; 127.0.0.1:3000->3000/tcp
redis        Up 2 months (healthy)
redis-queue  Up 2 months (healthy)
worker       Up 20 hours
```

Container names use the `ascend-academy-prod-` prefix. No containers changed.

## Step 1 execution

2026-10-30T15:14Z, BEFORE read: Cloudflare `GET /zones/09f8045d57baa5b18239a2168f4a4288/dns_records?per_page=100&page=1` succeeds (HTTP 200), total_count=4, one page. The four original mail records match the inventory above; all have `proxied=false`. No apex or www records exist. No server changes are part of this step.

Authorized write completed through the Cloudflare connector: created A `learnstation.app` → `195.201.221.137` and CNAME `www.learnstation.app` → `learnstation.app`, each with `proxied=false`, TTL **300 seconds**. A guard re-read confirmed exactly the four baseline mail records before either POST. The immediate post-write readback compared the full original record objects and returned `mail_records_unchanged=true`. No PATCH/PUT/DELETE operation was performed.

2026-10-30T15:15:21Z, AFTER read: Cloudflare `GET /zones/09f8045d57baa5b18239a2168f4a4288/dns_records?per_page=100&page=1` succeeds (HTTP 200), `count=6`, `total_count=6`, one page. The immediate read had transient `count=6`/`total_count=5` metadata; final readback resolves both to six. The original four records retain their IDs, content, TTL and DNS-only state.

| type | name | content | proxied | TTL | new record ID |
| --- | --- | --- | --- | --- | --- |
| A | learnstation.app | 195.201.221.137 | false | 300 | 6c96e98ae307209f2e48fa97d2724072 |
| CNAME | www.learnstation.app | learnstation.app | false | 300 | 5b8eda11583b8e291ec907145126eb18 |

2026-10-30T15:15:21Z, public DNS verification (exit code 0 for every command):

```text
$ dig @1.1.1.1 learnstation.app A +short
195.201.221.137
$ dig @1.1.1.1 www.learnstation.app CNAME +short
learnstation.app.
$ dig @1.1.1.1 www.learnstation.app A +short
learnstation.app.
195.201.221.137
$ dig @8.8.8.8 learnstation.app A +short
195.201.221.137
$ dig @8.8.8.8 www.learnstation.app CNAME +short
learnstation.app.
$ dig @8.8.8.8 www.learnstation.app A +short
learnstation.app.
195.201.221.137
```

Rollback: in this zone, delete only the two new record IDs listed above (Cloudflare → learnstation.app → DNS → Records → apex A / www CNAME → Delete). Re-read the zone to confirm only the four original mail records remain, and verify public DNS after TTL expiration. No mail record or zone setting needs changing.

At the end of step 1, stopped as Abi requested: step 2 had not yet started, and DNS completion alone did not make the new website ready for browser use. Abi subsequently authorized step 2 below. Old-host redirects remain gated on the separate step 6 go.

## Step 2 execution

2026-10-30T15:18:00Z, BEFORE read: `nginx -t` passes and nginx is active. Only the original two enabled sites and original two certificates exist. New `/etc/nginx/sites-available/learnstation.app` and enabled symlink are absent. Both new names resolve on the server to `195.201.221.137`. Certbot version is 2.9.0. Existing certificate expiries and proxy configuration still match recon.

Original site file SHA-256 values (to verify they remain unchanged):

```text
0d25556b8a382fb034db970de91fa7d5d4eadee2038b31df4a33b5f99c623c8b  /etc/nginx/sites-available/ascend-academy
571e8af0a049676fdfc88086151039d55d8d9e5714461d30fc1be8b5fef55eeb  /etc/nginx/sites-available/195-201-221-137.sslip.io
```

2026-10-30T15:19:03Z: copied all 15 existing nginx regular files and `/etc/letsencrypt/options-ssl-nginx.conf` to sibling `.bak-20261030-1519` paths before any mutation. Enabled symlinks were not duplicated into the wildcard-included sites-enabled directory. Created the previously absent `/etc/nginx/sites-available/learnstation.app` and enabled symlink, initially HTTP-only with both new server names. `nginx -t` passed before `systemctl reload nginx`.

2026-10-30T15:19:03Z–15:19:15Z: `certbot certonly --nginx --cert-name learnstation.app -d learnstation.app -d www.learnstation.app --non-interactive` succeeded using the existing ACME account. Certificate: `/etc/letsencrypt/live/learnstation.app/fullchain.pem`. Private key was generated by Certbot on the server and not read or copied into this log.

2026-10-30T15:19:41Z: read the HTTP-only config, then backed it up to `/etc/nginx/sites-available/learnstation.app.bak-20261030-1519` before replacing it with the final config. Apex HTTPS mirrors DuckDNS's complete `location /` proxy block (HTTP/1.1, four proxy headers, 100M limit, 120s timeout), with the new certificate. www HTTPS returns `301 https://learnstation.app$request_uri`; both new HTTP hosts return the same 301 inside `location /`, allowing Certbot's challenge location to take precedence. TLS includes match the old app site. `nginx -t` passed before `systemctl reload nginx`. No restart occurred.

Certificate evidence, `openssl x509 -in /etc/letsencrypt/live/learnstation.app/fullchain.pem -noout -issuer -dates -ext subjectAltName`:

```text
issuer=C = US, O = Let's Encrypt, CN = YE1
notBefore=Oct 30 14:20:42 2026 GMT
notAfter=Jan 28 14:20:41 2027 GMT
DNS:learnstation.app, DNS:www.learnstation.app
```

2026-10-30T15:20Z, external verification with `curl --max-time 20 -sSI <URL>` (TLS verification enabled):

```text
https://learnstation.app/                                      HTTP/1.1 200 OK
https://www.learnstation.app/reset-password?probe=step2         HTTP/1.1 301 Moved Permanently
Location: https://learnstation.app/reset-password?probe=step2
http://learnstation.app/reset-password?probe=step2              HTTP/1.1 301 Moved Permanently
Location: https://learnstation.app/reset-password?probe=step2
http://www.learnstation.app/reset-password?probe=step2          HTTP/1.1 301 Moved Permanently
Location: https://learnstation.app/reset-password?probe=step2
https://learnstation.duckdns.org/                              HTTP/1.1 200 OK
https://195-201-221-137.sslip.io/                               HTTP/1.1 502 Bad Gateway
```

The initial apex-only local DNS lookup failed once (`curl: (6) Could not resolve host`), then the ordinary hostname check succeeded with 200. A separate `curl --resolve learnstation.app:443:195.201.221.137 -sSI https://learnstation.app/` also returned 200 with TLS hostname verification enabled. No DNS changes were made in step 2.

`cmp` confirms both original site files and `/etc/nginx/nginx.conf` are byte-for-byte unchanged from their `.bak-20261030-1519` backups after certificate issuance and final config reload. Their original SHA-256 values above still apply. Container statuses show the same running frontend/worker/API/Redis instances; none recreated. nginx is active. `certbot.timer` is enabled and active.

2026-10-30T15:21:01Z: checked all three renewal configs use the nginx authenticator/installer, with no configured hooks; pre/post/deploy hook directories are empty. Copied all nginx files, TLS options, and the three renewal configs to `.bak-20261030-1521` paths before the renewal test. `nginx -t` passed. Initial `certbot renew --dry-run --non-interactive` inserted a 357-second random scheduling delay before validation. At 15:22:16Z, verified the exact command/PID and interrupted only that sleeping test process, then reran with Certbot's supported `--no-random-sleep-on-renew` flag (also used by the existing timer).

2026-10-30T15:22:28Z–15:23:01Z, `certbot renew --dry-run --non-interactive --no-random-sleep-on-renew` exited **0**:

```text
Congratulations, all simulated renewals succeeded:
  /etc/letsencrypt/live/195-201-221-137.sslip.io/fullchain.pem (success)
  /etc/letsencrypt/live/learnstation.app/fullchain.pem (success)
  /etc/letsencrypt/live/learnstation.duckdns.org/fullchain.pem (success)
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
UNCHANGED /etc/nginx/sites-available/ascend-academy
UNCHANGED /etc/nginx/sites-available/195-201-221-137.sslip.io
UNCHANGED /etc/nginx/nginx.conf
UNCHANGED FINAL APEX CONFIG
active
```

2026-10-30T15:23Z, final post-renewal external checks:

```text
$ curl -sS -I -o /dev/null -w 'apex HTTPS status=%{http_code} ssl_verify_result=%{ssl_verify_result}\n' https://learnstation.app/
apex HTTPS status=200 ssl_verify_result=0
$ curl -sSI 'https://www.learnstation.app/reset-password?probe=step2-final'
HTTP/1.1 301 Moved Permanently
Location: https://learnstation.app/reset-password?probe=step2-final
```

Rollback for step 2: remove only `/etc/nginx/sites-enabled/learnstation.app`, run `nginx -t`, then `systemctl reload nginx`. Keep the issued certificate and its private key on the server; no revocation/deletion is needed to restore old-host service. Original sites and nginx.conf are unchanged and need no restoration. If a later change requires restoring a file, first back up its current version, then restore its recorded backup before testing/reloading. `/etc/nginx/sites-available/learnstation.app.bak-20261030-1519` is the temporary HTTP-only config; the `.bak-20261030-1521` version is the final HTTPS config. Do not confuse the two.

Step 2 complete. Stopped ahead of step 3: no `.env`, CORS, container, server checkout, database or Supabase Auth settings changed during this step.

## Exact proposed changes for first go (steps 1–5)

1. **Cloudflare:** use the connected API to add DNS-only A `@` → `195.201.221.137` and DNS-only CNAME `www` → `learnstation.app`; preserve all mail records. Verify using `dig +short` against both 1.1.1.1 and 8.8.8.8.
2. **Server TLS/nginx:** back up every existing server file before editing it using `.bak-20261030-<HHMM>` in UTC; inventory any new paths as previously absent. Provision a separate HTTP challenge site if needed, issue a certificate with `certbot certonly --nginx -d learnstation.app -d www.learnstation.app`, then configure apex HTTPS with DuckDNS's exact proxy behavior/headers and www HTTPS → `301 https://learnstation.app$request_uri`. HTTP should redirect to apex HTTPS after issuance. Keep both old site files unchanged. Run `nginx -t` before each nginx reload; never restart. Verify certificate issuer/expiry, HTTPS behavior and `certbot renew --dry-run`.
3. **CORS:** back up `/root/ascend-academy/.env`, append `https://learnstation.app` to `CORS_ALLOWED_ORIGINS`, retaining both old origins. Recreate only API with `docker compose -f docker-compose.prod.yml up -d --no-deps --force-recreate api`, without `--build` or pulling images. Verify GET `/api/v1/courses` returns 401 and an OPTIONS preflight allows `Origin: https://learnstation.app`.
4. **Supabase (done by Abi when reached):** Authentication → URL Configuration → change Site URL from `http://localhost:3000` to `https://learnstation.app` → Save changes; Redirect URLs → Add URL → `https://learnstation.app/**` → Save. Preserve both existing DuckDNS and sslip entries. Wait until new-domain HTTPS/API verification succeeds before making this change. Request saved-value readback and record evidence. Leave SMTP settings/password untouched; connector lacks these Auth operations.
5. **Email/Resend/test:** preserve the current subject `Learnstation: Passwort zurücksetzen · Reset your password` and exact bilingual body below, retaining `{{ .ConfirmationURL }}`; Abi's readback already matches. Preserve open/click tracking OFF and receiving OFF. Ask Abi to sign in on the apex, request his own password reset and open a Lesson. Record his report of inbox/spam, link hostname and whether sign-in/reset/Lesson worked, without recording the live link/token. Then STOP before step 6.

### Recovery email body (requested; current body reported by Abi)

```html
<h2>Passwort zurücksetzen</h2>
<p>Hallo,</p>
<p>jemand – hoffentlich du – hat für {{ .Email }} ein neues Passwort bei Learnstation angefordert.</p>
<p><a href="{{ .ConfirmationURL }}">Neues Passwort festlegen</a></p>
<p>Wenn du das nicht warst, ignoriere diese E-Mail einfach. Dein Passwort bleibt, wie es ist.</p>
<hr>
<h2>Reset your password</h2>
<p>Someone – hopefully you – asked for a new Learnstation password for {{ .Email }}.</p>
<p><a href="{{ .ConfirmationURL }}">Choose a new password</a></p>
<p>If this wasn't you, just ignore this email. Your password stays as it is.</p>
<p>Learnstation</p>
```

## Open items

- Recon complete: Cloudflare/Resend connector checks and Supabase Auth dashboard readbacks passed. Later Supabase Auth changes still require Abi's dashboard action; do not scrape dashboards or extract tokens from files.
- Create the single draft ops log PR through an authorized GitHub connector or Abi's dashboard; existing create attempt failed with 403. Record the PR link once created.
- Steps 1–2 complete and verified. Stopped before step 3 CORS/API recreation. Required early draft PR remains pending.
- Complete steps 3–5 and Abi's test; obtain second explicit go before step 6. Moving to the new address signs everyone out once because sessions are stored per site address.
- Create `feat/reset-link-own-domain` from current `origin/main` for the separate, undeployed code PR. Preserve existing implicit recovery, add token-hash verification and meaningful tests; run touched Vitest tests and `npx tsc --noEmit -p tsconfig.app.json`. Rerun the known intermittent deck-measurement timeout once if encountered; do not skip it.
- **Only after the code PR is separately deployed:** change the recovery link to `{{ .SiteURL }}/reset-password?token_hash={{ .TokenHash }}&type=recovery`. Until then retain `{{ .ConfirmationURL }}`.
- Update only deployment/runbook references to the old address, finish evidence, update status and mark ops PR ready at completion.

## Values for Abi

Cloudflare and Resend are now connected and verified. The correct Supabase connection is Learnstation → osama's org → Ascend Academy, but its exposed tools lack Auth settings operations.

**Draft PR handoff (GitHub connector returned 403):** open [the prepared branch comparison](https://github.com/osamash0/ascend-academy/compare/main...ops/learnstation-app-move?expand=1) → Create pull request → title `ops: move the site to learnstation.app (log)` → choose **Create draft pull request** from the button menu. Base: `main`; compare: `ops/learnstation-app-move`. Description: `Records migration recon, BEFORE/AFTER evidence, rollback instructions and Abi's two checkpoints. DNS and TLS/nginx complete; all three renewal simulations pass. CORS/Auth URL changes pending. Mail records preserved.` Return the PR link so its creation can be recorded as **done by Abi**. Do not create a second PR if one already exists.

Current readbacks are complete. After first go, make only the Supabase URL changes when the agent reaches step 4 and confirms HTTPS/API readiness:

- **Cloudflare:** step 1 complete through connector; apex A and www CNAME are DNS only, TTL 300, verified at both public resolvers. No manual DNS change needed.
- **Supabase → project lkiiideqjoiksnycgplc → Authentication → URL Configuration:** readback complete: Site URL `http://localhost:3000`, plus the two old Redirect URLs. After first go and HTTPS readiness: Site URL `https://learnstation.app`; add `https://learnstation.app/**`, retain both existing entries.
- **Supabase → Authentication → Emails → SMTP Settings:** readback complete, custom SMTP ON; leave unchanged. **Emails → Templates → Reset Password:** current subject `Learnstation: Passwort zurücksetzen · Reset your password` and body already match requested values; preserve both and `{{ .ConfirmationURL }}` links.
- **Resend:** baseline read complete through connector; verified, sending enabled, receiving OFF, both tracking switches OFF. Leave these values unchanged.

No dashboard configuration changes have been reported. Site URL, redirect allow-list, SMTP and recovery subject/body readbacks are marked **done by Abi**; this does not imply a settings change.
