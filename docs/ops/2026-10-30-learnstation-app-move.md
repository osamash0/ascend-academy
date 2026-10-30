STATUS: BLOCKED — step 0: Supabase Auth BEFORE values and draft PR permission pending

| step | status | before → after | evidence (UTC) | rollback |
| --- | --- | --- | --- | --- |
| 0: recon | pending | Server, Cloudflare and Resend baseline verified; Supabase project/org confirmed; Auth configuration still unknown. No production setting changed. | SSH/DNS evidence below; 2026-10-30T15:05Z–15:06Z connector reads: four DNS-only mail records; Resend verified, receiving/tracking OFF; Ascend Academy ACTIVE_HEALTHY in osama's org. | No production change to undo. |
| 0a: Cloudflare inventory | done | Four mail records, all `proxied=false` → unchanged. | `GET /zones` and `GET /zones/{zone_id}/dns_records`: success, HTTP 200, total_count=4, one page. | Read-only; none. |
| 0b: Resend baseline | done | Verified EU domain, sending enabled, receiving/open/click tracking disabled → unchanged. | Resend `list_domains` and `get_domain`: verified, eu-west-1, sending enabled, receiving disabled, open_tracking=false, click_tracking=false; DKIM/SPF verified. | Read-only; none. |
| 0c: redirect allow-list readback | done by Abi | `https://learnstation.duckdns.org/**` and `https://195-201-221-137.sslip.io/**` → unchanged. Site URL still unknown. | 2026-10-30T15:07:09Z: Abi pasted the current URL Configuration page text; its Site URL input value was not included. | Read-only; none. |
| 1: DNS | pending | Cloudflare has no apex/www records; public resolvers returned no apex A or www CNAME → planned A `@` = `195.201.221.137`, CNAME `www` = `learnstation.app`, both DNS only. | Cloudflare list: exactly four preserved mail records. `dig @1.1.1.1` and `dig @8.8.8.8`: no apex A or www CNAME answers. | Delete only the two newly created records; retain all four mail records. |
| 2: TLS/nginx | pending | Only DuckDNS and sslip certificates/sites observed → planned additional apex/www certificate and site. | Existing certificate issuers/expiries and nginx behavior below; `nginx -t`: syntax OK, test successful. | Restore backed-up nginx files, remove only the new enabled site, test nginx and reload; leave old certificates/sites intact. |
| 3: CORS | pending | `https://learnstation.duckdns.org,https://195-201-221-137.sslip.io` → append `https://learnstation.app`. | Only the `CORS_ALLOWED_ORIGINS` line was read from `.env`; API healthy. | Restore `.env` backup and recreate only `api`, without building/pulling. |
| 4: Auth URLs | pending | Site URL unknown; allow list contains DuckDNS and sslip wildcard entries → Site URL `https://learnstation.app`, add `https://learnstation.app/**`, preserve both existing entries. | Abi's URL Configuration readback recorded below; Site URL input value still required. Connector exposes no Auth configuration read/write tools. | Restore recorded Site URL; remove only the newly added apex redirect entry, preserving both original entries. |
| 5: recovery email/tracking/test | pending | Current subject/body unknown; open/click tracking already OFF → requested bilingual template using `{{ .ConfirmationURL }}`, specified subject; keep tracking/receiving OFF. | Resend settings verified by connector; await Supabase subject/body readback. No test mail requested/sent. | Restore recorded subject/body; keep receiving and tracking OFF. |
| 6: old host redirects | pending | DuckDNS serves app on 3000; sslip points at separate gateway on 3001, currently 502 → proposed 301 to apex after second explicit go. | `curl -I`: DuckDNS 200; sslip 502; localhost:3001 connection refused. | Restore both backed-up old site files, run `nginx -t`, reload. Keep their certificates. |
| 7: recovery link code PR | pending | Existing implicit recovery flow → add token-hash verification while retaining implicit flow, separate undeployed branch/PR. | No application source changed or deployed. | Close/revert the separate code PR; no live effect until separately deployed. |
| 8: finish | pending | Deployment/runbook address updates and completed evidence pending. | Ops log branch created from `origin/main` at `e2de2766bad4d2fb88a1eaaf3e80b3813654a9aa`, first commit `08682528` pushed. GitHub create_pull_request rejected with HTTP 403, Resource not accessible by integration; draft PR not created. | Revert documentation-only changes if required. |

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

The paste includes the Site URL label/help text but omits the input value. This is **unknown**, not evidence that the field is blank. SMTP enabled/disabled and the current recovery email subject/body are still unverified. A follow-up requests those three remaining values without changes or credentials.

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

- Cloudflare/Resend are connected and their baseline checks passed. Supabase Auth settings still require dashboard readback; do not scrape dashboards or extract tokens from files.
- Create the single draft ops log PR through an authorized GitHub connector or Abi's dashboard; existing create attempt failed with 403. Record the PR link once created.
- Complete step 0's missing Supabase Auth BEFORE values (Site URL, SMTP enabled/disabled, recovery subject/body) and obtain first explicit go before production changes. Redirect allow list readback is recorded.
- Complete steps 1–5 and Abi's test; obtain second explicit go before step 6. Moving to the new address signs everyone out once because sessions are stored per site address.
- Create `feat/reset-link-own-domain` from current `origin/main` for the separate, undeployed code PR. Preserve existing implicit recovery, add token-hash verification and meaningful tests; run touched Vitest tests and `npx tsc --noEmit -p tsconfig.app.json`. Rerun the known intermittent deck-measurement timeout once if encountered; do not skip it.
- **Only after the code PR is separately deployed:** change the recovery link to `{{ .SiteURL }}/reset-password?token_hash={{ .TokenHash }}&type=recovery`. Until then retain `{{ .ConfirmationURL }}`.
- Update only deployment/runbook references to the old address, finish evidence, update status and mark ops PR ready at completion.

## Values for Abi

Cloudflare and Resend are now connected and verified. The correct Supabase connection is Learnstation → osama's org → Ascend Academy, but its exposed tools lack Auth settings operations.

**Draft PR handoff (GitHub connector returned 403):** open [the prepared branch comparison](https://github.com/osamash0/ascend-academy/compare/main...ops/learnstation-app-move?expand=1) → Create pull request → title `ops: move the site to learnstation.app (log)` → choose **Create draft pull request** from the button menu. Base: `main`; compare: `ops/learnstation-app-move`. Description: `Records migration recon, BEFORE/AFTER evidence, rollback instructions and Abi's two checkpoints. Step 0 awaits Supabase Auth settings; no production changes made.` Return the PR link so its creation can be recorded as **done by Abi**. Do not create a second PR if one already exists.

If dashboard handoff is needed, read these values first without changing anything:

- **Cloudflare:** baseline read complete through connector; no manual DNS change needed before first go.
- **Supabase → project lkiiideqjoiksnycgplc → Authentication → URL Configuration:** send the value inside the Site URL input, or explicitly say blank. The two Redirect URLs have been recorded from Abi's readback. Later values: Site URL `https://learnstation.app`; add `https://learnstation.app/**`, retain both existing entries.
- **Supabase → Authentication → Emails → SMTP Settings:** enabled/disabled only; do not reveal or change the password. **Emails → Templates → Reset Password:** current subject and HTML body. Later subject/body: exactly as above.
- **Resend:** baseline read complete through connector; verified, sending enabled, receiving OFF, both tracking switches OFF. Leave these values unchanged.

No dashboard configuration changes have been reported. The redirect allow-list readback is marked **done by Abi**; this does not imply a settings change.
