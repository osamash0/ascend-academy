# Production Infrastructure Best Practices

This document outlines the infrastructure and deployment best practices for the Ascend Academy platform to ensure maximum uptime, resilience under load, and proper monitoring.

## 1. High Availability & Scaling
- **Load Balancing**: Use an external load balancer (e.g., AWS ALB, Nginx) to distribute traffic across multiple API instances.
- **Auto-Scaling**: Configure auto-scaling groups based on CPU and memory utilization thresholds. The backend API is stateless and scales horizontally.
- **Database Connection Pooling**: Ensure `pgbouncer` or Supabase's built-in connection pooling is used for high concurrency. Fast-firing queries (e.g., learning events) will exhaust connection limits quickly without pooling.
- **Frontend CDN**: Deploy the Vite static bundle to a CDN (e.g., Vercel, Cloudflare, Cloudfront) for fast delivery globally.

## 2. CI/CD & Testing
- **E2E Testing Gating**: Every PR to `main` must pass Playwright E2E tests (`.github/workflows/ci.yml`). This prevents regressions in critical user flows (Sign In, Dashboard, Lecture View).
- **Automated Rollbacks**: Ensure your deployment platform supports one-click rollbacks for both the frontend static site and the backend API.
- **Database Migrations**: Run Supabase migrations in CI before deploying the backend. Do not apply manual schema changes in production.

## 3. Monitoring & Error Tracking
- **Sentry Integration**: The application uses Sentry for crash reporting and distributed tracing. 
  - Ensure `VITE_SENTRY_DSN` is populated in the frontend build step.
  - Ensure `SENTRY_DSN` is set in the backend environment.
- **Health Checks**: Configure the load balancer to hit the `/health` endpoint on the backend. Instances that fail the health check should be automatically cycled.

## 4. Performance & Load Management
- **Rate Limiting**: The backend leverages `slowapi`. Ensure rate limits are appropriately tuned. For production behind a proxy (like Nginx), make sure `X-Forwarded-For` is configured correctly so rate limits apply per-IP and not to the load balancer itself.
- **Load Testing**: We have provided a k6 smoke script at `load-testing/smoke.js`. Run this against staging before any major release to ensure latency remains under 500ms at p95 for 20+ concurrent users.

## 5. Security & Environment configuration
- Never commit `.env` or `.env.production` files.
- Enable RLS (Row Level Security) on all tables inside Supabase. Use service keys strictly for the backend admin client (`supabase_admin`).
- Enable SSL/HTTPS on all endpoints. Set `CORS_ALLOWED_ORIGINS` to the exact frontend domain (e.g., `https://ascend-academy.com`).
