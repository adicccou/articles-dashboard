# Article Dashboard

Standalone multi-site editorial dashboard built with React, Vite, Cloudflare Workers, D1, and R2.

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

## Project structure

```text
src/
  app/
  components/
  lib/
  pages/
  styles/
worker/
  lib/
migrations/
```

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

3. Update [wrangler.jsonc](/Users/adi/Documents/Blogposter/article-dashboard/wrangler.jsonc) with the returned D1 database ID and bucket name if you change it.

4. Set secrets:

```bash
wrangler secret put ADMIN_PASSWORD
wrangler secret put SESSION_SECRET
```

For local development you can also create `.dev.vars`:

```bash
ADMIN_PASSWORD=changeme
SESSION_SECRET=replace-me
PUBLIC_MEDIA_BASE_URL=http://127.0.0.1:8787/api/media/
```

5. Apply migrations:

```bash
npm run db:migrate:local
```

6. Start development:

```bash
npm run dev
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
