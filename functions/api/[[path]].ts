// Cloudflare Pages Function – handles /api/* routes
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\//, '');
  const method = request.method;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
  if (method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const json = (data, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders } });

  // ── Auth ──
  const PASSWORD_HASH = "60a5c81ea965803e19147ade4e069294f280fad3b4d17fc392d550af4109f271";
  async function sha256(msg) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(msg));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
  }
  const EXPECTED_COOKIE = await sha256(PASSWORD_HASH + ":photos_v1");
  const AUTH_COOKIE = "photos_auth=" + EXPECTED_COOKIE;

  function isAuthed(req) {
    const c = req.headers.get("Cookie") || "";
    return c.includes(AUTH_COOKIE);
  }

  // Public endpoints: login
  const publicPaths = ["login"];
  if (path.startsWith("img/") && method === "GET") {
    // Image serving - protected too, but let through for now
    const r2Key = path.slice(4);
    const obj = await env.R2.get(r2Key);
    if (!obj) return new Response("Not Found", { status: 404, headers: corsHeaders });
    return new Response(obj.body, { headers: { "Content-Type": obj.httpMetadata?.contentType || "image/jpeg", "Cache-Control": "public, max-age=86400", ...corsHeaders } });
  }

  if (!publicPaths.includes(path) && !isAuthed(request)) {
    return json({ error: "Unauthorized" }, 401);
  }

  try {
    // ── Logout ──
    if (path === "logout" && method === "POST") {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": "photos_auth=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
          ...corsHeaders,
        },
      });
    }

    // ── Login ──
    if (path === "login" && method === "POST") {
      const body = await request.json();
      if (body.hash === PASSWORD_HASH) {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Set-Cookie": AUTH_COOKIE + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000",
            ...corsHeaders,
          },
        });
      }
      return json({ error: "Bad password" }, 401);
    }

    // ── Check auth ──
    if (path === "check-auth" && method === "GET") {
      return json({ authed: true });
    }

    // ── Migration ──
    if (path === 'migrate' && method === 'POST') {
      const body = await request.json();
      if (body.key !== 'photos-migrate-20260626') return json({ error: 'bad key' }, 403);
      const results = [];
      await env.DB.prepare('CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL)').run();
      results.push({ step: 'create-categories' });
      try { await env.DB.prepare("ALTER TABLE images ADD COLUMN category_id TEXT").run(); results.push({ step: 'add-category-id' }); }
      catch (e) { results.push({ step: 'add-category-id', note: e.message }); }
      try { await env.DB.prepare("ALTER TABLE images ADD COLUMN sort_order INTEGER DEFAULT 0").run(); results.push({ step: 'add-sort-order' }); }
      catch (e) { results.push({ step: 'add-sort-order', note: e.message }); }
      try { await env.DB.prepare("ALTER TABLE images ADD COLUMN deleted_at INTEGER").run(); results.push({ step: 'add-deleted-at' }); }
      catch (e) { results.push({ step: 'add-deleted-at', note: e.message }); }
      try { await env.DB.prepare("ALTER TABLE images ADD COLUMN orig_ext TEXT DEFAULT 'jpeg'").run(); results.push({ step: 'add-orig-ext' }); }
      catch (e) { results.push({ step: 'add-orig-ext', note: e.message }); }
      try { await env.DB.prepare("ALTER TABLE images ADD COLUMN exif_date INTEGER").run(); results.push({ step: 'add-exif-date' }); }
      catch (e) { results.push({ step: 'add-exif-date', note: e.message }); }
      try { await env.DB.prepare("ALTER TABLE images ADD COLUMN sha256 TEXT").run(); results.push({ step: 'add-sha256' }); }
      catch (e) { results.push({ step: 'add-sha256', note: e.message }); }
      try { await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_images_sha256 ON images(sha256)").run(); results.push({ step: 'sha256-index' }); }
      catch (e) { results.push({ step: 'sha256-index', note: e.message }); }
      return json({ results });
    }

    // ── Stats ──
    if (path === 'stats' && method === 'GET') {
      const r = await env.DB.prepare("SELECT COUNT(*) as total, COALESCE(SUM(size), 0) as total_bytes FROM images WHERE deleted_at IS NULL").first();
      return json({ total_images: r?.total || 0, total_bytes: parseInt(r?.total_bytes || '0'), free_bytes: 10_737_418_240 });
    }

    // ── Categories (with image count) ──
    if (path === 'categories' && method === 'GET') {
      const { results } = await env.DB.prepare(
        "SELECT c.id, c.name, c.created_at, c.sort_order, COUNT(i.id) as image_count FROM categories c LEFT JOIN images i ON i.category_id = c.id AND i.deleted_at IS NULL GROUP BY c.id ORDER BY c.sort_order ASC, c.created_at ASC"
      ).all();
      const totalResult = await env.DB.prepare("SELECT COUNT(*) as t FROM images WHERE deleted_at IS NULL").first();
      return json({ categories: results, total_images: totalResult?.t || 0 });
    }

    // ── Create category ──
    if (path === 'categories' && method === 'POST') {
      const body = await request.json();
      if (!body.name) return json({ error: 'name required' }, 400);
      const id = crypto.randomUUID();
      await env.DB.prepare('INSERT INTO categories (id, name, created_at, sort_order) VALUES (?, ?, ?, ?)').bind(id, body.name, Date.now(), 999).run();
      return json({ id }, 201);
    }

    // ── Delete category ──
    if (path.startsWith('categories/') && method === 'DELETE') {
      const catId = path.slice(11);
      await env.DB.prepare('UPDATE images SET category_id = NULL WHERE category_id = ?').bind(catId).run();
      await env.DB.prepare('DELETE FROM categories WHERE id = ?').bind(catId).run();
      return json({ success: true });
    }

    // ── Reorder categories ──
    if (path === 'categories/reorder' && method === 'POST') {
      const body = await request.json();
      if (!body.ids?.length) return json({ error: 'no ids' }, 400);
      const st = env.DB.prepare('UPDATE categories SET sort_order = ? WHERE id = ?');
      for (let i = 0; i < body.ids.length; i++) await st.bind(i, body.ids[i]).run();
      return json({ success: true });
    }

    // ── Recycle bin ──
    if (path === 'recycle' && method === 'GET') {
      // Auto-clean expired items (>30 days)
      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const expired = await env.DB.prepare("SELECT id, r2_key FROM images WHERE deleted_at IS NOT NULL AND deleted_at < ?").bind(cutoff).all();
      for (const row of expired.results || []) {
        await env.R2.delete(row.r2_key).catch(() => { });
        await env.R2.delete(row.r2_key.replace('imgs/', 'thumbs/')).catch(() => { });
        await env.R2.delete(row.r2_key.replace('imgs/', 'medium/').replace(/\.[^.]+$/, '.webp')).catch(() => { });
      }
      if (expired.results?.length) {
        await env.DB.prepare("DELETE FROM images WHERE deleted_at IS NOT NULL AND deleted_at < ?").bind(cutoff).run();
      }
      const { results } = await env.DB.prepare("SELECT id, filename, r2_key, size, width, height, mime, uploaded_at, deleted_at FROM images WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC").all();
      return json({ images: results, auto_cleaned: expired.results.length });
    }

    // ── Restore from recycle ──
    if (path === 'recycle/restore' && method === 'POST') {
      const ids = (await request.json()).ids || [];
      if (!ids.length) return json({ error: 'no ids' }, 400);
      const st = env.DB.prepare('UPDATE images SET deleted_at = NULL WHERE id = ?');
      for (const id of ids) await st.bind(id).run();
      return json({ success: true });
    }

    // ── Permanent delete from recycle ──
    if (path === 'recycle/delete' && method === 'POST') {
      const ids = (await request.json()).ids || [];
      if (!ids.length) return json({ error: 'no ids' }, 400);
      for (const id of ids) {
        const row = await env.DB.prepare('SELECT r2_key FROM images WHERE id = ?').bind(id).first();
        if (row) {
          await env.R2.delete(row.r2_key).catch(() => { });
          await env.R2.delete(row.r2_key.replace('imgs/', 'thumbs/')).catch(() => { });
          await env.R2.delete(row.r2_key.replace('imgs/', 'medium/').replace(/\.[^.]+$/, '.webp')).catch(() => { });
        }
        await env.DB.prepare('DELETE FROM images WHERE id = ?').bind(id).run();
      }
      return json({ success: true });
    }

    // ── Empty recycle bin ──
    if (path === 'recycle/empty' && method === 'POST') {
      const { results } = await env.DB.prepare("SELECT r2_key FROM images WHERE deleted_at IS NOT NULL").all();
      for (const row of results) {
        await env.R2.delete(row.r2_key).catch(() => { });
        await env.R2.delete(row.r2_key.replace('imgs/', 'thumbs/')).catch(() => { });
        await env.R2.delete(row.r2_key.replace('imgs/', 'medium/').replace(/\.[^.]+$/, '.webp')).catch(() => { });
      }
      await env.DB.prepare("DELETE FROM images WHERE deleted_at IS NOT NULL").run();
      return json({ success: true });
    }

    // ── Image list (excludes deleted) ──
    if (path === 'list' && method === 'GET') {
      const searchQ = url.searchParams.get('q') || '';
      const catFilter = url.searchParams.get('cat') || '';
      const sort = url.searchParams.get('sort') || 'created_desc';
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '0') || 0, 200);
      const offset = parseInt(url.searchParams.get('offset') || '0') || 0;
      const sortMap = { 'created_desc': 'i.uploaded_at DESC', 'created_asc': 'i.uploaded_at ASC', 'name': 'i.filename ASC', 'name_desc': 'i.filename DESC', 'size': 'i.size DESC', 'size_asc': 'i.size ASC' };
      let where = "WHERE i.deleted_at IS NULL";
      const binds = [];
      if (searchQ) { where += ' AND i.filename LIKE ?'; binds.push('%' + searchQ + '%'); }
      if (catFilter) { where += ' AND i.category_id = ?'; binds.push(catFilter); }
      const total = (await (binds.length ? env.DB.prepare('SELECT COUNT(*) as t FROM images i ' + where).bind(...binds).first() : env.DB.prepare('SELECT COUNT(*) as t FROM images i ' + where).first())).t || 0;
      let sql = 'SELECT i.id, i.filename, i.r2_key, i.exif_date, i.size, i.width, i.height, i.mime, i.uploaded_at, i.uploaded_by, i.category_id, i.orig_ext, c.name as category_name FROM images i LEFT JOIN categories c ON i.category_id = c.id ' + where + ' ORDER BY ' + (sortMap[sort] || 'i.uploaded_at DESC');
      if (limit > 0) sql += ' LIMIT ? OFFSET ?';
      const dataBinds = [...binds];
      if (limit > 0) dataBinds.push(limit, offset);
      const { results } = await (dataBinds.length ? env.DB.prepare(sql).bind(...dataBinds) : env.DB.prepare(sql)).all();
      return json({ images: results, total, limit, offset, sort });
    }

    // ── Image serving (already handled above as public, but keep this for other img paths) ──
    if (path.startsWith('img/') && method === 'GET') {
      const r2Key = path.slice(4);
      const obj = await env.R2.get(r2Key);
      if (!obj) return new Response('Not Found', { status: 404, headers: corsHeaders });
      return new Response(obj.body, { headers: { 'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg', 'Cache-Control': 'public, max-age=86400', ...corsHeaders } });
    }

    // ── Upload ──
    if (path === 'upload' && method === 'POST') {
      let form;
      try { form = await request.formData(); } catch (e) { return json({ error: 'No file or invalid form' }, 400); }
      const file = form.get('file');
      if (!file) return json({ error: 'No file' }, 400);
      const filename = form.get('filename')?.toString() || file.name || 'untitled';
      const ext = filename.split('.').pop()?.toLowerCase() || 'jpg';
      const buf = await file.arrayBuffer();
      const sha256 = form.get('sha256')?.toString() || null;

      // ── Dedup check ──
      if (sha256) {
        const existing = await env.DB.prepare("SELECT id, filename FROM images WHERE sha256 = ? AND deleted_at IS NULL").bind(sha256).first();
        if (existing) {
          return json({ error: "duplicate", existing_id: existing.id, existing_filename: existing.filename }, 409);
        }
      }

      const id = crypto.randomUUID();
      const r2Key = 'imgs/' + id + '.' + ext;
      await env.R2.put(r2Key, buf, { httpMetadata: { contentType: file.type || 'image/jpeg' } });
      let thumbKey = null;
      const thumb = form.get('thumb');
      if (thumb) { thumbKey = 'thumbs/' + id + '.jpeg'; await env.R2.put(thumbKey, await thumb.arrayBuffer(), { httpMetadata: { contentType: 'image/jpeg' } }); }
      let mediumKey = null;
      const medium = form.get('medium');
      if (medium) { mediumKey = 'medium/' + id + '.webp'; await env.R2.put(mediumKey, await medium.arrayBuffer(), { httpMetadata: { contentType: 'image/webp' } }); }
      const w = parseInt(form.get('width')?.toString() || '0');
      const h = parseInt(form.get('height')?.toString() || '0');
      const exifDate = form.get('exif_date') ? parseInt(form.get('exif_date').toString()) : null;
      const catId = form.get('category_id')?.toString() || null;
      await env.DB.prepare('INSERT INTO images (id, filename, r2_key, exif_date, size, width, height, mime, uploaded_at, uploaded_by, category_id, orig_ext, sha256) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, filename, r2Key, exifDate, buf.byteLength, w, h, file.type || 'image/jpeg', Date.now(), 'user@photos', catId, ext, sha256).run();
      return json({ id, r2Key, thumbKey }, 201);
    }

    // ── Rename ──
    if (path.startsWith('rename/') && method === 'POST') {
      const body = await request.json();
      if (!body.filename) return json({ error: 'filename required' }, 400);
      await env.DB.prepare('UPDATE images SET filename = ? WHERE id = ?').bind(body.filename, path.slice(7)).run();
      return json({ success: true });
    }

    // ── Soft delete (recycle) ──
    if (path.startsWith('delete/') && method === 'DELETE') {
      const imgId = path.slice(7);
      await env.DB.prepare('UPDATE images SET deleted_at = ? WHERE id = ?').bind(Date.now(), imgId).run();
      return json({ success: true });
    }

    // ── Batch delete (soft) ──
    if (path === 'batch-delete' && method === 'POST') {
      const ids = (await request.json()).ids || [];
      if (!ids.length) return json({ error: 'no ids' }, 400);
      const st = env.DB.prepare('UPDATE images SET deleted_at = ? WHERE id = ?');
      for (const id of ids) await st.bind(Date.now(), id).run();
      return json({ success: true, deleted: ids.length });
    }

    // ── Move category ──
    if (path === 'move' && method === 'POST') {
      const body = await request.json();
      if (!body.ids?.length) return json({ error: 'no ids' }, 400);
      const st = env.DB.prepare('UPDATE images SET category_id = ? WHERE id = ?');
      for (const id of body.ids) await st.bind(body.category_id || null, id).run();
      return json({ success: true });
    }

    return json({ error: 'Not Found' }, 404);
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
