# Domain, DNS and email (Cloudflare)

*What Cloudflare does for Learnstation, every DNS record and why it is there, and the settings that look harmless but are not. Set up on 2026-10-30 and verified that day with `dig @1.1.1.1` and the dashboard. The domain move itself (A/www records, TLS, CORS, Auth URLs, old-host redirects) is logged in `docs/ops/2026-10-30-learnstation-app-move.md`.*

## The account

- One Cloudflare account holds the domain (registrar), DNS, Email Routing and the R2 backup bucket. Whoever controls it can take the domain and read the encrypted backup files, so it is protected like the server.
- It was created through **Sign in with GitHub**, so it had no Cloudflare password. Abi set one (forgot-password flow) and turned on **two-factor login with an authenticator app** on 2026-10-30. Backup codes and the password live in Abi's password manager. The GitHub account is a second way in and must keep 2FA on.
- **Billing:** the account has a payment method on file because R2 needs one. A budget alert ("Any Cloudflare spend (should stay $0)") e-mails the account address at **$1**. Everything here runs on free tiers.

## DNS records for learnstation.app

All records are **DNS only** (grey cloud). The server terminates TLS itself; see "Do not" below.

| Name | Type | Points to | Why |
|---|---|---|---|
| `learnstation.app` | A | `195.201.221.137` | The app (nginx on the Hetzner box) |
| `www` | CNAME | `learnstation.app` | Redirected to the apex by nginx |
| `status` | CNAME | `statuspage.betteruptime.com` | Public status page (Better Stack issues its own certificate) |
| `learnstation.app` | MX ×3 | `route1/2/3.mx.cloudflare.net` | Email Routing: receives mail for our addresses |
| `learnstation.app` | TXT | `v=spf1 include:_spf.mx.cloudflare.net ~all` | Email Routing SPF |
| `cf2024-1._domainkey` | TXT | DKIM key | Email Routing DKIM |
| `send`, `rsend` | CNAME | Resend (`*.rmta.net`) | Resend sends the account emails (sign-up, password reset) |
| `resend._domainkey` | TXT | DKIM key | Resend DKIM |
| `_dmarc` | TXT | `v=DMARC1; p=none;` | DMARC, monitoring only for now |

Sending (Resend) and receiving (Cloudflare) use different names, so changing one never breaks the other. `learnstation.duckdns.org` is a separate DuckDNS record, still pointing at the server so its 301 to the apex keeps working.

## Email

- **Receiving:** Cloudflare Email Routing forwards `hello@learnstation.app` and `privacy@learnstation.app` to the operator's private inbox (the Cloudflare account's address, verified as the destination). The catch-all rule is off, so mail to any other address is rejected. Add an address under Email → Email Routing → Routing rules; the destination must be a verified address.
- **Where they are used:** the Impressum names `hello@`, the privacy policy names `privacy@` (PR #159), and the status page's "Get in touch" button opens `hello@`.
- **Sending:** Supabase Auth sends through Resend's SMTP (custom SMTP in the Supabase dashboard). Nothing in the app sends from `hello@`; replies go out from the private inbox.
- **Test after any change:** send one message to each address from an outside account, and trigger one password reset to yourself.

## Other Cloudflare services in use

- **R2 bucket `learnstation-backups`:** encrypted nightly database copies. Details, the free-tier guards and the restore steps are in `docs/runbooks/monitoring-and-backups.md`.
- The privacy policy names Cloudflare as a processor for mail forwarding and the encrypted backups (PR #159). Add any new Cloudflare service that touches personal data there too.

## Do not

- **Do not switch `learnstation.app` or `www` to Proxied (orange cloud)** without a plan. On the free plan Cloudflare cuts uploads above 100 MB and requests above 100 s (long AI work). Every visitor would also arrive from a Cloudflare IP, which breaks the per-IP rate limits until nginx reads `CF-Connecting-IP` from Cloudflare's ranges. The TLS mode would have to be Full (strict). Worth revisiting only with real traffic.
- **Do not proxy `status`.** Better Stack must see the request to issue and renew its certificate.
- **Do not add an R2 bucket lock from the dashboard as offered.** Its retention defaults to *Indefinite*, which blocks every delete, so the 30-day lifecycle stops working and storage grows past the free tier.
- **Do not remove the MX, SPF or `cf2024-1` records** while Email Routing is on: mail to our addresses would bounce, and the legal pages point at them.
- **Do not change the `send`/`rsend`/`resend._domainkey` records** without re-verifying the domain in Resend; sign-up and reset emails stop otherwise.

## Later, when real students arrive

- Cloudflare Web Analytics (cookieless) to see whether visitors reach the landing page. Needs a line in the privacy policy.
- Turnstile on sign-up (Supabase Auth supports it) to stop bot accounts.
- DMARC reports, then a stricter policy (`p=quarantine`) once they show only Resend and Cloudflare sending for the domain.
