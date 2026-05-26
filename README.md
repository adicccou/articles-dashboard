# Oilor Studio Dashboards

React, Vite, Cloudflare Workers, D1, and R2 dashboard workspace split into two deployable projects:

- `marketing-dashboard`: articles, replies, Studio, planner, statistics, and social configuration.
- `trading-dashboard`: trading workers, ML trading, runtime diagnostics, trading settings, and agent sync.

## MVP included

- Admin login with a simple cookie session
- Site management
- Article list
- Create and edit article flow
- Multi-site assignment
- Draft and publish states
- SEO metadata
- Image upload to R2
- Public article API by site

## Local projects

Both projects share the same codebase and D1/R2 bindings, but they are pinned by build mode and Worker config so the UI and API surface cannot flip between dashboards by query string.

```bash
npm run dev:marketing  # http://localhost:5190
npm run dev:trading    # http://localhost:5191

npm run build:marketing
npm run build:trading

npm run deploy:marketing
npm run deploy:trading
```

Project configs:

- `wrangler.marketing.jsonc` deploys `marketing-dashboard`
- `wrangler.trading.jsonc` deploys `trading-dashboard`
- `.env.marketing` pins the frontend to marketing
- `.env.trading` pins the frontend to trading

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Create Cloudflare resources:

```bash
wrangler d1 create article_dashboard
wrangler r2 bucket create article-dashboard-media
```

3. Update the Wrangler config for the project you are deploying if you change the D1 database ID or bucket name.

4. Set secrets:

```bash
wrangler secret put ADMIN_PASSWORD
wrangler secret put SESSION_SECRET
```

For local development you can also create `.dev.vars`:

```bash
ADMIN_PASSWORD=<long-random-local-password>
SESSION_SECRET=<long-random-local-session-secret>
PUBLIC_MEDIA_BASE_URL=http://127.0.0.1:8787/api/media/
```

5. Apply migrations:

```bash
npm run db:migrate:local
```

6. Start development:

```bash
npm run dev:marketing
npm run dev:trading
```

## Public API

Published articles for one site:

```bash
GET /api/public/articles?site=journl
```

Single published article by slug:

```bash
GET /api/public/articles/my-article-slug?site=journl
```

## Notes

- The editor is markdown-first for faster MVP delivery.
- Auth is intentionally simple for V1 and should be upgraded before broader team usage.
- `PUBLIC_MEDIA_BASE_URL` can point at a CDN or custom domain later.
