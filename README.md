# 📸 Cloudflare Photos

> A lightweight, self-hosted image gallery built on Cloudflare's free tier — **Pages + R2 + D1 + Workers**.

No server, no database, no monthly fees. Just your Cloudflare account.

![screenshot](https://photos.wangchangyi.win/api/img/thumbs/0c325d89-da02-4dba-9470-1a3de21cb7e0.jpeg)

---

## Features

| Category | Features |
|----------|----------|
| **Upload** | Drag & drop, file picker, mobile camera capture, batch upload |
| **Browse** | Masonry waterfall layout, grid mode, month timeline, infinite scroll |
| **Lightbox** | Zoom (scroll wheel + pinch), pan, info panel, keyboard navigation |
| **Manage** | Rename, soft delete (recycle), permanent delete, 30-day auto cleanup |
| **Batch** | Select mode, batch download (ZIP), batch delete, batch move |
| **Organize** | Categories/folders, move between categories, reorder categories |
| **Search** | Real-time filename search |
| **Sort** | Newest, oldest, A–Z, Z–A, largest, smallest |
| **Download** | Single image download, batch ZIP download |
| **Dedup** | SHA-256 hash check before upload, auto-skip duplicates |
| **Auth** | Password login, logout, cookie-based session (30 days) |
| **Theme** | Dark mode (system-aware + manual toggle) |
| **UX** | Scroll progress bar with month markers, back-to-top button, stats bar |
| **Responsive** | Desktop (4-column) → tablet (3-column) → mobile (2-column) |
| **Recycle Bin** | Table view, thumbnails, countdown, restore, permanent delete, empty all |

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                   Browser                        │
│  ┌───────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ Upload    │  │ Browse   │  │ Lightbox     │  │
│  │ (Canvas   │  │ (Grid /  │  │ (Zoom / Pan  │  │
│  │  resize)  │  │ Masonry) │  │  Download)   │  │
│  └───────────┘  └──────────┘  └──────────────┘  │
└──────────────────┬──────────────────────────────┘
                   │
            HTTP API (same origin)
                   │
┌──────────────────▼──────────────────────────────┐
│          Cloudflare Pages Functions              │
│  ┌──────────┬──────────┬──────────┬──────────┐  │
│  │ Upload   │ List     │ Login    │ Recycle  │  │
│  │ Rename   │ Delete   │ Stats    │ Move     │  │
│  └────┬─────┴────┬─────┴────┬─────┴────┬─────┘  │
│       │          │          │          │        │
│  ┌────▼────┐┌───▼────┐┌───▼────┐┌───▼──────┐  │
│  │  R2     ││  D1    ││ R2     ││  R2 + D1 │  │
│  │ (imgs)  ││(meta)  ││(thumbs)││ (medium) │  │
│  └─────────┘└────────┘└────────┘└──────────┘  │
└─────────────────────────────────────────────────┘
```

### Cloudflare Services Used

| Service | Purpose | Free Tier |
|---------|---------|-----------|
| **Pages** | Static hosting + serverless Functions | 100K requests/day |
| **R2** | Image storage (original / thumb / medium) | 10 GB storage |
| **D1** | Metadata database (images, categories) | 5 GB storage |
| **Workers** | Pages Functions runtime | Included with Pages |

### Key Design Decisions

- **Client-side image processing** — thumbnails (300px JPEG) and medium versions (1200px WebP) are generated in the browser via Canvas API before upload. This avoids the 10ms CPU limit of Cloudflare Workers.
- **Direct R2 serving** — images are served directly from R2 through Pages Functions, with `Cache-Control: max-age=86400, immutable` for thumbs/medium.
- **SHA-256 dedup** — computed client-side before upload, checked against D1 to prevent duplicates.
- **Aspect-ratio placeholders** — each image container reserves space using `padding-bottom` based on known dimensions, preventing layout shift during lazy loading.
- **No frameworks** — vanilla HTML/CSS/JS. No React, no build step, no npm.

---

## Deployment

### Prerequisites

1. A Cloudflare account
2. `npm` or `npx` (for wrangler CLI)
3. A Cloudflare API token with `Pages:Edit`, `R2:ReadWrite`, `D1:Edit` permissions

### Setup

```bash
# 1. Clone the repo
git clone https://github.com/wcy7902898/photos.git
cd photos

# 2. Install wrangler
npm install -g wrangler

# 3. Create R2 bucket
npx wrangler r2 bucket create photos-imgs

# 4. Create D1 database
npx wrangler d1 create photos-meta

# 5. Create the images table
npx wrangler d1 execute photos-meta --command=\`
CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  exif_date INTEGER,
  size INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  mime TEXT,
  uploaded_at INTEGER NOT NULL,
  uploaded_by TEXT,
  category_id TEXT,
  orig_ext TEXT DEFAULT 'jpeg',
  sha256 TEXT UNIQUE,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_images_sha256 ON images(sha256);
\`

# 6. Create categories table
npx wrangler d1 execute photos-meta --command=\`
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  sort_order INTEGER DEFAULT 999
);
\`

# 7. Deploy
npx wrangler pages deploy . --project-name photos --branch main
```

> **Note:** The R2 and D1 bindings (`R2`, `DB`) must be configured in your Pages project settings (Cloudflare Dashboard → your project → Settings → Bindings).

### Custom Domain

In Cloudflare Dashboard:
1. Pages → your project → Custom domains → Add `photos.yourdomain.com`
2. Update `_headers` if needed for your domain

---

## API Endpoints

All endpoints are under `/api/` and handled by the Pages Function (`functions/api/[[path]].ts`).

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/login` | No | Login with password hash |
| POST | `/api/logout` | No | Clear auth cookie |
| GET | `/api/check-auth` | No | Check if authenticated |
| GET | `/api/list` | Yes | List images (paginated, sortable, searchable) |
| POST | `/api/upload` | Yes | Upload image (multipart with file, thumb, medium) |
| POST | `/api/rename/:id` | Yes | Rename image |
| DELETE | `/api/delete/:id` | Yes | Soft-delete to recycle bin |
| POST | `/api/batch-delete` | Yes | Batch soft-delete |
| GET | `/api/stats` | Yes | Image count and storage usage |
| GET | `/api/categories` | Yes | List categories |
| POST | `/api/categories` | Yes | Create category |
| DELETE | `/api/categories/:id` | Yes | Delete category |
| POST | `/api/categories/reorder` | Yes | Reorder categories |
| POST | `/api/move` | Yes | Move images to category |
| GET | `/api/recycle` | Yes | List recycle bin |
| POST | `/api/recycle/restore` | Yes | Restore from recycle |
| POST | `/api/recycle/delete` | Yes | Permanently delete |
| POST | `/api/recycle/empty` | Yes | Empty recycle bin |
| GET | `/api/img/*` | No | Serve images (originals, thumbs, medium) |

---

## Development History & Debugging Notes

### Phase 1 — MVP (Worker-based)
The first version used a Cloudflare Worker for the API backend and a separate static site. Images were stored in R2, metadata in D1. No thumbnails, no categories, bare-bones UI.

### Phase 2 — Pages Functions Migration
Rewrote the backend as a Pages Function (`functions/api/[[path]].ts`) for simpler deployment (single project, no separate Worker). Added:
- Client-side thumbnail + medium generation on upload
- Categories, search, sort
- Recycle bin with 30-day auto-cleanup
- Dark mode
- Batch operations
- SHA-256 dedup
- Password authentication + logout

### Phase 3 — UX Polish
- **Infinite scroll** — replaced manual "load more" button with scroll-based auto-loading (`requestAnimationFrame`-throttled)
- **Scroll position preservation** — when loading more images, scroll ratio is saved before fetch and restored after render to prevent "jumping back to top"
- **Scroll progress bar** — right-side progress indicator with clickable month-marker dots and a back-to-top button
- **Layout shift fix** — removed `title` attributes from thumbnails (caused flickering native tooltips in masonry layout). Added `padding-bottom` aspect-ratio placeholders so image containers reserve space before loading

### Phase 4 — Cleanup & Bug Fixes

#### 🐛 Missing Thumbnails (404 errors)
**Problem:** Images uploaded before the thumbnail feature was added had no `thumbs/{id}.jpeg` or `medium/{id}.webp` in R2. The `onerror` fallback loaded full-size originals, causing severe layout reflow.

**Fix:** Backfilled all missing thumbnails and mediums via a Python script using the Cloudflare R2 API:
```python
# For each image in D1, check R2 for thumb/medium
# If missing: download original → Pillow resize → PUT back to R2
```
Result: 0/57 images now show 404 for thumbnails.

#### 🐛 Orphaned D1 Records
**Problem:** 10 D1 records had no corresponding R2 objects (files were uploaded but never persisted, or deleted separately). These caused perpetual 404s.

**Fix:** Identified orphaned IDs by comparing R2 object listing against D1 records, then deleted them via the batch-delete API.

#### 🐛 401 on Image Serving (False Alarm)
`HEAD` requests to `/api/img/*` returned 401 because the Function handler only implements `GET` for that path. The actual `GET` requests work fine — this was a browser DevTools display issue, not a real bug.

#### 🐛 Custom Domain Edge Cache
After deploying to `main`, the custom domain took several minutes to update. Cloudflare's edge CDN caches static HTML aggressively. The `_headers` file sets `Cache-Control: max-age=0, must-revalidate`, but CF edge nodes may still serve stale content for a short period. Workaround: deploy a small change (e.g., update a meta tag) to force cache invalidation.

---

## License

MIT
<!-- test auto-deploy 2026-06-29T05:04:05Z -->
