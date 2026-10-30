STATUS: BLOCKED — step 0: connector access and dashboard BEFORE values pending

| step | status | before → after | evidence (UTC) | rollback |
| --- | --- | --- | --- | --- |
| 0: recon | pending | Existing production inspected; no production setting changed. Cloudflare record list, Supabase Auth configuration and Resend configuration still unverified. | 2026-10-30T14:57:28Z–14:58:10Z: SSH inspection, `certbot certificates`, `nginx -t`, Compose status and public DNS results below. | No production change to undo. |
| 1: DNS | pending | Apex A and www CNAME: no answers at either public resolver → planned A `@` = `195.201.221.137`, CNAME `www` = `learnstation.app`, both DNS only. | `dig @1.1.1.1` and `dig @8.8.8.8` returned no apex A or www CNAME answers. Cloudflare inventory/proxy state pending. | Delete only the two newly created records; retain all four mail records. |
| 2: TLS/nginx | pending | Only DuckDNS and sslip certificates/sites observed → planned additional apex/www certificate and site. | Existing certificate issuers/expiries and nginx behavior below; `nginx -t`: syntax OK, test successful. | Restore backed-up nginx files, remove only the new enabled site, test nginx and reload; leave old certificates/sites intact. |
| 3: CORS | pending | `https://learnstation.duckdns.org,https://195-201-221-137.sslip.io` → append `https://learnstation.app`. | Only the `CORS_ALLOWED_ORIGINS` line was read from `.env`; API healthy. | Restore `.env` backup and recreate only `api`, without building/pulling. |
| 4: Auth URLs | pending | Current Site URL and redirect allow list unknown → Site URL `https://learnstation.app`, add `https://learnstation.app/**`, preserve old entries. | Connector exposes no Auth configuration read/write tools; BEFORE values required. | Restore recorded Site URL and redirect allow list. |
| 5: recovery email/tracking/test | pending | Current subject/body and tracking settings unknown → requested bilingual template using `{{ .ConfirmationURL }}`, specified subject, open/click tracking OFF. | Await connector access or Abi dashboard readback. No test mail requested/sent. | Restore recorded subject/body and tracking settings. |
| 6: old host redirects | pending | DuckDNS serves app on 3000; sslip points at separate gateway on 3001, currently 502 → proposed 301 to apex after second explicit go. | `curl -I`: DuckDNS 200; sslip 502; localhost:3001 connection refused. | Restore both backed-up old site files, run `nginx -t`, reload. Keep their certificates. |
| 7: recovery link code PR | pending | Existing implicit recovery flow → add token-hash verification while retaining implicit flow, separate undeployed branch/PR. | No application source changed or deployed. | Close/revert the separate code PR; no live effect until separately deployed. |
| 8: finish | pending | Deployment/runbook address updates and completed evidence pending. | Ops log branch created from `origin/main` at `e2de2766bad4d2fb88a1eaaf3e80b3813654a9aa`. Draft PR pending at initial commit. | Revert documentation-only changes if required. |

## Scope and checkpoints

Owner: Abi. Target: `learnstation.app`, server `195.201.221.137`, Supabase project `lkiiideqjoiksnycgplc`.

This log contains observations from 2026-10-30 in UTC. Handoff assertions are distinguished from freshly verified values. No SMTP password, API key, database URL, service-role key, full `.env`, certificate private key or recovery token is included.

The server remains on `deploy/legal-20261030`. No checkout, image, worker, frontend, database, migration or application deployment changes are authorized by this log. Other PRs are outside scope.

STOP 1: Complete BEFORE-value recon, present steps 1–5, then wait for Abi's explicit **go**. Not received.

STOP 2: After Abi tests the new domain, wait for another explicit **go** before redirecting either old hostname. Not received.

## Read-only recon evidence

### Access and connector coverage

- 2026-10-30T14:57Z: plugin search for `Cloudflare Resend` returned an empty plugin list. Separate searches for `Cloudflare` and `Resend` also returned empty lists. This does not establish that no integration exists outside the surfaced catalog.
- Supabase plugin is installed/enabled. Available tool inventory has project/database/Edge Function operations, but no Auth configuration or email-template read/write operation. No SQL or credential-based workaround attempted.
- Abi requested connecting the missing providers before dashboard handoff. Connection setup pending. No external dashboard action is marked **done by Abi** without a report/readback.

### Public DNS

Commands, 2026-10-30T14:57Z:

```sh
dig @1.1.1.1 learnstation.app A +noall +answer
dig @8.8.8.8 learnstation.app A +noall +answer
dig @1.1.1.1 www.learnstation.app CNAME +noall +answer
dig @8.8.8.8 www.learnstation.app CNAME +noall +answer
```

All four returned no answer records. This is not a Cloudflare record inventory and does not verify proxy settings.

Handoff-only mail inventory, awaiting confirmation: CNAME `rsend` → `rsend-euw1.forge.rmta.net`; CNAME `send` → `send.forge.rmta.net`; TXT `resend._domainkey`; TXT `_dmarc` = `v=DMARC1; p=none;`. Preserve all four exactly. Do not include DKIM key text in readback.

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

## Exact proposed changes for first go (steps 1–5)

1. **Cloudflare:** add DNS-only A `@` → `195.201.221.137` and DNS-only CNAME `www` → `learnstation.app`; preserve all mail records. Verify using `dig +short` against both 1.1.1.1 and 8.8.8.8. If connector access remains unavailable, Abi must make the dashboard changes after the checkpoint and provide readback.
2. **Server TLS/nginx:** back up every existing server file before editing it using `.bak-20261030-<HHMM>` in UTC; inventory any new paths as previously absent. Provision a separate HTTP challenge site if needed, issue a certificate with `certbot certonly --nginx -d learnstation.app -d www.learnstation.app`, then configure apex HTTPS with DuckDNS's exact proxy behavior/headers and www HTTPS → `301 https://learnstation.app$request_uri`. HTTP should redirect to apex HTTPS after issuance. Keep both old site files unchanged. Run `nginx -t` before each nginx reload; never restart. Verify certificate issuer/expiry, HTTPS behavior and `certbot renew --dry-run`.
3. **CORS:** back up `/root/ascend-academy/.env`, append `https://learnstation.app` to `CORS_ALLOWED_ORIGINS`, retaining both old origins. Recreate only API with `docker compose -f docker-compose.prod.yml up -d --no-deps --force-recreate api`, without `--build` or pulling images. Verify GET `/api/v1/courses` returns 401 and an OPTIONS preflight allows `Origin: https://learnstation.app`.
4. **Supabase:** after recording the current values, set Site URL to `https://learnstation.app`, add redirect URL `https://learnstation.app/**`, and retain DuckDNS/other existing allow-list entries. Leave SMTP settings/password untouched. Use connector or Abi dashboard action only.
5. **Email/Resend:** after recording BEFORE values, set subject to `Learnstation: Passwort zurücksetzen · Reset your password`; use the exact body below, retaining `{{ .ConfirmationURL }}`. Set open/click tracking OFF and keep receiving OFF. Ask Abi to sign in on the apex, request his own password reset and open a Lesson. Record his report of inbox/spam and link hostname without recording the live link/token. Then STOP before step 6.

### Requested recovery email body (not yet applied)

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

- Connect Cloudflare/Resend if supported; establish a supported Supabase Auth configuration route. Do not scrape dashboards or extract tokens from files.
- Complete step 0's missing Cloudflare/Supabase/Resend BEFORE values and obtain first explicit go before production changes.
- Complete steps 1–5 and Abi's test; obtain second explicit go before step 6. Moving to the new address signs everyone out once because sessions are stored per site address.
- Create `feat/reset-link-own-domain` from current `origin/main` for the separate, undeployed code PR. Preserve existing implicit recovery, add token-hash verification and meaningful tests; run touched Vitest tests and `npx tsc --noEmit -p tsconfig.app.json`. Rerun the known intermittent deck-measurement timeout once if encountered; do not skip it.
- **Only after the code PR is separately deployed:** change the recovery link to `{{ .SiteURL }}/reset-password?token_hash={{ .TokenHash }}&type=recovery`. Until then retain `{{ .ConfirmationURL }}`.
- Update only deployment/runbook references to the old address, finish evidence, update status and mark ops PR ready at completion.

## Values for Abi

Connection setup requested by Abi; Cloudflare and Resend were not found in the surfaced plugin catalog. Supabase is installed, but its exposed tools lack Auth settings operations.

If dashboard handoff is needed, read these values first without changing anything:

- **Cloudflare → learnstation.app → DNS → Records:** names/types/targets and DNS-only/proxied state; omit DKIM key text. Later changes: A `@` → `195.201.221.137`, CNAME `www` → `learnstation.app`, both grey cloud/DNS only.
- **Supabase → project lkiiideqjoiksnycgplc → Authentication → URL Configuration:** current Site URL and every Redirect URL. Later values: Site URL `https://learnstation.app`; add `https://learnstation.app/**`, retain existing entries.
- **Supabase → Authentication → Emails → SMTP Settings:** enabled/disabled only; do not reveal or change the password. **Emails → Templates → Reset Password:** current subject and HTML body. Later subject/body: exactly as above.
- **Resend → Domains → learnstation.app:** verification, sending and receiving status; **Configuration:** open/click tracking settings. Later target: verified, sending enabled, receiving OFF, both tracking switches OFF.

No dashboard changes have been reported or marked done by Abi yet.
