const API_BASE = "";
let images = [], categories = [], recycledImages = [];
let currentIdx = -1, selectMode = false, selectedIds = new Set();
let currentCategory = "", currentSort = "created_desc";
let zoomLevel = 1, zoomPanX = 0, zoomPanY = 0, isPanning = false;

// ── 分页 ──
const PAGE_SIZE = 50;
let currentPage = 0, totalImages = 0, loading = false, allLoaded = false;
let showRecycle = false;
let isRecyclePreview = false;

// ── 深色模式 ──
let darkMode = localStorage.getItem("photosDarkMode");
if (darkMode === null) darkMode = window.matchMedia("(prefers-color-scheme: dark)").matches ? "1" : "0";
if (darkMode === "1") document.documentElement.setAttribute("data-dark", "1");

function toggleDark() {
  darkMode = darkMode === "1" ? "0" : "1";
  document.documentElement.setAttribute("data-dark", darkMode);
  localStorage.setItem("photosDarkMode", darkMode);
  document.getElementById("darkToggle").textContent = darkMode === "1" ? "☀️" : "🌙";
}

// ── 布局切换 ──
let layoutMode = localStorage.getItem("photosLayout") || "masonry";

function toggleLayout() {
  layoutMode = layoutMode === "masonry" ? "grid" : "masonry";
  localStorage.setItem("photosLayout", layoutMode);
  renderGrid();
  document.getElementById("layoutToggle").textContent = layoutMode === "masonry" ? "⊞" : "⊟";
  document.getElementById("grid").className = "grid " + layoutMode;
}

// ── URL 构建 ──
function thumbUrl(img) { return API_BASE + "/api/img/thumbs/" + img.id + ".jpeg"; }
function origUrl(img) { const e = img.r2_key ? img.r2_key.split('.').pop() : (img.orig_ext || 'jpeg'); return API_BASE + "/api/img/imgs/" + img.id + "." + e; }
function optimizedUrl(img) { return API_BASE + "/api/img/medium/" + img.id + ".webp"; }

function getPool() { return isRecyclePreview ? recycledImages : images; }

// ── 加载列表 ──
function loadList(reset) {
  if (showRecycle) { loadRecycle(); return; }
  if (reset) { currentPage = 0; allLoaded = false; images = []; }
  if (allLoaded || loading) return;
  loading = true;

  // 保存滚动比例（追加模式用）
  const scrollRatio = reset ? null : (window.scrollY / Math.max(1, document.documentElement.scrollHeight - window.innerHeight));

  const params = new URLSearchParams();
  params.set("sort", currentSort);
  params.set("limit", PAGE_SIZE);
  params.set("offset", currentPage * PAGE_SIZE);
  if (currentCategory) params.set("cat", currentCategory);
  const q = document.getElementById("searchInput").value.trim();
  if (q) params.set("q", q);
  fetch(API_BASE + "/api/list?" + params.toString(), { credentials: "include" }).then(r => {
    if (r.status === 401) return;
    return r.json();
  }).then(d => {
    if (!d) return;
    if (reset) images = d.images || [];
    else images = images.concat(d.images || []);
    totalImages = d.total || images.length;
    currentPage++;
    allLoaded = images.length >= totalImages;
    loading = false;
    renderGrid();
    renderLoadMore();
    // 恢复滚动位置（追加模式）
    if (scrollRatio !== null && document.documentElement.scrollHeight > window.innerHeight) {
      window.scrollTo(0, scrollRatio * (document.documentElement.scrollHeight - window.innerHeight));
    }
  }).catch(() => { loading = false; });
}

function renderLoadMore() {
  const bar = document.getElementById("loadMoreBar");
  if (showRecycle || allLoaded || totalImages === 0) { bar.style.display = "none"; return; }
  bar.style.display = "block";
  if (loading) bar.textContent = "⏳ 加载中...";
  else bar.textContent = "↓ 下拉加载更多 (" + images.length + " / " + totalImages + ")";
}

function loadMore() { if (!loading && !allLoaded) loadList(false); }

// ── 瀑布流自动加载 ──
let scrollTicking = false;
document.addEventListener("scroll", () => {
  if (scrollTicking) return;
  scrollTicking = true;
  requestAnimationFrame(() => {
    scrollTicking = false;
    const bar = document.getElementById("loadMoreBar");
    if (!bar || bar.style.display === "none") return;
    const rect = bar.getBoundingClientRect();
    if (rect.top < window.innerHeight + 200) loadMore();
  });
}, { passive: true });

// ── 右侧滚动进度条 ──
function updateScrollProgress() {
  const thumb = document.getElementById("spThumb");
  const track = document.getElementById("spTrack");
  if (!thumb || !track) return;
  const scrollTop = window.scrollY;
  const scrollH = document.documentElement.scrollHeight - window.innerHeight;
  const pct = scrollH > 0 ? Math.min(100, (scrollTop / scrollH) * 100) : 0;
  thumb.style.height = pct + "%";
  // 高亮最近的打点
  document.querySelectorAll(".sp-dot").forEach(d => d.classList.toggle("sp-dot-active", Math.abs(parseFloat(d.dataset.pct) - pct) < 2));
}

function buildScrollDots() {
  const dots = document.getElementById("spDots");
  if (!dots) return;
  dots.innerHTML = "";
  const scrollH = document.documentElement.scrollHeight - window.innerHeight;
  if (scrollH <= 0) return;
  document.querySelectorAll(".month-header").forEach(h => {
    const pct = (h.offsetTop / scrollH) * 100;
    if (pct > 0 && pct < 100) {
      const dot = document.createElement("div");
      dot.className = "sp-dot";
      dot.dataset.pct = pct;
      dot.style.top = pct + "%";
      dot.title = h.textContent.trim();
      dot.addEventListener("click", (e) => {
        e.stopPropagation();
        window.scrollTo({ top: h.offsetTop - 120, behavior: "smooth" });
      });
      dots.appendChild(dot);
    }
  });
}

document.getElementById("spTrack")?.addEventListener("click", (e) => {
  const rect = e.currentTarget.getBoundingClientRect();
  const pct = (e.clientY - rect.top) / rect.height;
  const targetY = pct * (document.documentElement.scrollHeight - window.innerHeight);
  window.scrollTo({ top: targetY, behavior: "smooth" });
});

// 滚轮+加载后更新进度条
let progressTicking = false;
document.addEventListener("scroll", () => {
  if (!progressTicking) {
    progressTicking = true;
    requestAnimationFrame(() => { progressTicking = false; updateScrollProgress(); });
  }
}, { passive: true });

let searchTimer = null;
// ── 搜索 ──
function onSearch(e) {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { selectedIds.clear(); if (selectMode) toggleSelectMode(); loadList(true); }, 300);
}

function renderCategories() {
  const bar = document.getElementById("categoryBar");
  const totalCount = window._totalImages || 0;
  let html = '<span class="cat-chip' + (currentCategory === "" && !showRecycle ? " cat-active" : "") + '" data-cat="" onclick="filterCategory(this)">全部 <span class="cat-count">' + totalCount + '</span></span>';
  categories.forEach((c, idx) => {
    const active = currentCategory === c.id && !showRecycle ? " cat-active" : "";
    const first = idx === 0, last = idx === categories.length - 1;
    html += '<span class="cat-chip cat-with-move' + active + '" data-cat="' + c.id + '">' +
      '<span class="cat-move-group">' +
      '<span class="cat-move' + (first ? ' cat-move-disabled' : '') + '" onclick="event.stopPropagation(); moveCategory(\'' + c.id + '\',-1)">↑</span>' +
      '<span class="cat-move' + (last ? ' cat-move-disabled' : '') + '" onclick="event.stopPropagation(); moveCategory(\'' + c.id + '\',1)">↓</span>' +
      '</span>' +
      '<span onclick="filterCategory(this.parentElement)">' + escapeHtml(c.name) + '</span>' +
      '<span class="cat-count">' + (c.image_count || 0) + '</span>' +
      '<span class="cat-del" onclick="event.stopPropagation(); deleteCategory(\'' + c.id + '\',\'' + escapeAttr(c.name) + '\')">✕</span></span>';
  });
  html += '<span class="cat-chip' + (showRecycle ? ' cat-active' : '') + '" onclick="showRecycleBin()">🗑 <span class="cat-count-recycle" id="recycleCount">0</span></span>';
  html += '<span class="cat-add" onclick="createCategory()">+</span>';
  bar.innerHTML = html;
}

async function loadCategories() {
  const r = await fetch(API_BASE + "/api/categories", { credentials: "include" });
  if (!r.ok) return;
  const d = await r.json();
  categories = d.categories || [];
  window._totalImages = d.total_images || 0;
  renderCategories();
}

function filterCategory(el) {
  showRecycle = false;
  document.getElementById("grid").classList.remove("recycle-mode");
  document.querySelectorAll(".cat-chip").forEach(c => c.classList.remove("cat-active"));
  el.classList.add("cat-active");
  currentCategory = el.dataset.cat;
  selectedIds.clear();
  if (selectMode) toggleSelectMode();
  loadList(true);
}

function setSort(sort) {
  if (sort === currentSort) return;
  currentSort = sort;
  document.querySelectorAll(".sort-option").forEach(el => el.classList.toggle("sort-active", el.dataset.sort === sort));
  selectedIds.clear();
  if (selectMode) toggleSelectMode();
  loadList(true);
}

async function createCategory() {
  const name = prompt("分类名称：");
  if (!name) return;
  await fetch(API_BASE + "/api/categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }), credentials: "include" });
  loadCategories();
}

async function moveCategory(id, dir) {
  const idx = categories.findIndex(c => c.id === id);
  if (idx === -1) return;
  const target = idx + dir;
  if (target < 0 || target >= categories.length) return;
  const newOrder = categories.map(c => c.id);
  [newOrder[idx], newOrder[target]] = [newOrder[target], newOrder[idx]];
  await fetch(API_BASE + "/api/categories/reorder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: newOrder }), credentials: "include" });
  loadCategories();
}

async function deleteCategory(id, name) {
  if (!confirm('确定删除分类 "' + name + '"？\n（该分类下的图片只是变为未分类）')) return;
  await fetch(API_BASE + "/api/categories/" + id, { method: "DELETE", credentials: "include" });
  if (currentCategory === id) currentCategory = "";
  loadCategories();
  loadList(true);
}

// ── 回收站 ──
function previewRecycleImg(id) {
  const idx = recycledImages.findIndex(img => img.id === id);
  if (idx === -1) return;
  isRecyclePreview = true;
  currentIdx = idx;
  resetZoom();
  showLightbox();
}

function showRecycleBin() {
  showRecycle = true;
  currentCategory = "";
  document.querySelectorAll(".cat-chip").forEach(c => c.classList.remove("cat-active"));
  document.getElementById("searchInput").value = "";
  selectedIds.clear();
  if (selectMode) toggleSelectMode();
  document.getElementById("grid").classList.add("recycle-mode");
  loadRecycle();
}

async function loadRecycle() {
  const r = await fetch(API_BASE + "/api/recycle", { credentials: "include" });
  if (!r.ok) return;
  recycledImages = (await r.json()).images || [];
  document.getElementById("grid").innerHTML = recycledImages.length === 0
    ? '<div style="text-align:center;padding:40px;color:#999">回收站为空</div>'
    : '<table class="recycle-table">' +
      '<thead><tr>' +
      (selectMode ? '<th class="rc-cb"><input type="checkbox" onclick="selectAll()" ' + (selectedIds.size === recycledImages.length && recycledImages.length > 0 ? 'checked' : '') + '></th>' : '') +
      '<th class="rc-thumb"></th>' +
      '<th class="rc-name">文件名</th>' +
      '<th class="rc-type">类型</th>' +
      '<th class="rc-size">大小</th>' +
      '<th class="rc-date">上传日期</th>' +
      '<th class="rc-date">删除日期</th>' +
      '<th class="rc-left">倒计时</th>' +
      '<th class="rc-actions">操作</th>' +
      '</tr></thead><tbody>' +
      recycledImages.map(img => {
      const date = img.deleted_at ? new Date(img.deleted_at).toLocaleDateString() : "";
      const checked = selectedIds.has(img.id);
      return '<tr class="' + (checked ? 'rc-selected' : '') + '">' +
        (selectMode ? '<td class="rc-cb"><input type="checkbox" ' + (checked ? 'checked' : '') + ' onclick="toggleSelect(\'' + img.id + '\')"></td>' : '') +
        '<td class="rc-thumb"><img class="rc-thumb-img" src="' + thumbUrl(img) + '" onclick="' + (selectMode ? 'toggleSelect(\'' + img.id + '\')' : 'previewRecycleImg(\'' + img.id + '\')') + '" title="点击预览原图" onerror="this.src=\'' + origUrl(img) + '\'"></td>' +
        '<td class="rc-name" title="' + escapeAttr(img.filename) + '">' + escapeHtml(img.filename) + '</td>' +
        '<td class="rc-type">' + getTypeIcon(img.mime) + getMimeShort(img.mime) + '</td>' +
        '<td class="rc-size">' + formatSize(img.size) + '</td>' +
        '<td class="rc-date">' + (img.uploaded_at ? new Date(img.uploaded_at).toLocaleDateString() : '-') + '</td>' +
        '<td class="rc-date">' + date + '</td>' +
        '<td class="rc-left">' + getCountdown(img.deleted_at) + '</td>' +
        '<td class="rc-actions">' +
        '<button class="rc-restore" onclick="restoreImage(\'' + img.id + '\')">↩</button>' +
        '<button class="rc-delete" onclick="permanentDelete(\'' + img.id + '\',\'' + escapeAttr(img.filename) + '\')">✗</button>' +
        '</td></tr>';
    }).join("") + '</tbody></table>' +
    '<div class="recycle-empty-bar" onclick="emptyRecycle()">🗑 清空回收站</div>';
  document.getElementById("loadMoreBar").style.display = "none";
  const rc = document.getElementById("recycleCount");
  if (rc) rc.textContent = recycledImages.length;
  updateStats();
}

async function restoreImage(id) {
  await fetch(API_BASE + "/api/recycle/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [id] }), credentials: "include" });
  loadRecycle();
  loadStats();
}

async function permanentDelete(id, name) {
  if (!confirm('永久删除 "' + name + '"?\n（不可恢复）')) return;
  await fetch(API_BASE + "/api/recycle/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [id] }), credentials: "include" });
  loadRecycle();
  loadStats();
}

async function emptyRecycle() {
  if (!confirm("清空回收站？\n所有图片将被永久删除，不可恢复！")) return;
  await fetch(API_BASE + "/api/recycle/empty", { method: "POST", credentials: "include" });
  loadRecycle();
  loadStats();
}

// ── 选择模式 ──
function toggleSelectMode() {
  selectMode = !selectMode;
  selectedIds.clear();
  document.getElementById("selectBtn").textContent = selectMode ? "☑ 完成" : (showRecycle ? "☐ 选择" : "☐ 选择");
  document.getElementById("batchBar").style.display = selectMode ? "flex" : "none";
  // Swap batch buttons for recycle vs main view
  document.getElementById("batchDownloadBtn").style.display = (!showRecycle && selectMode) ? "" : "none";
  document.getElementById("batchDeleteBtn").style.display = (!showRecycle && selectMode) ? "" : "none";
  document.getElementById("batchMoveBtn").style.display = (!showRecycle && selectMode) ? "" : "none";
  document.getElementById("recycleBatchRestoreBtn").style.display = (showRecycle && selectMode) ? "" : "none";
  document.getElementById("recycleBatchDeleteBtn").style.display = (showRecycle && selectMode) ? "" : "none";
  document.getElementById("selectedCount").textContent = "已选 0 张";
  if (showRecycle) loadRecycle(); else renderGrid();
}

function toggleSelect(id) {
  if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
  document.getElementById("selectedCount").textContent = "已选 " + selectedIds.size + " 张";
  if (showRecycle) loadRecycle(); else renderGrid();
}

function selectAll() {
  const pool = showRecycle ? recycledImages : images;
  if (selectedIds.size === pool.length) selectedIds.clear();
  else pool.forEach(i => selectedIds.add(i.id));
  document.getElementById("selectedCount").textContent = "已选 " + selectedIds.size + " 张";
  if (showRecycle) loadRecycle(); else renderGrid();
}

async function batchDelete() {
  if (selectedIds.size === 0) return;
  if (!confirm("确定删除选中的 " + selectedIds.size + " 张图片？（可回收）")) return;
  await fetch(API_BASE + "/api/batch-delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [...selectedIds] }), credentials: "include" });
  selectedIds.clear();
  toggleSelectMode();
  loadList(true);
  loadStats();
}

async function batchRestore() {
  if (selectedIds.size === 0) return;
  await fetch(API_BASE + "/api/recycle/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [...selectedIds] }), credentials: "include" });
  selectedIds.clear();
  toggleSelectMode();
  loadRecycle();
  loadStats();
}

async function batchPermanentDelete() {
  if (selectedIds.size === 0) return;
  if (!confirm("永久删除选中的 " + selectedIds.size + " 张？不可恢复！")) return;
  await fetch(API_BASE + "/api/recycle/empty", { method: "POST", credentials: "include" });
  selectedIds.clear();
  toggleSelectMode();
  loadRecycle();
  loadStats();
}

function showMoveDialog() {
  if (selectedIds.size === 0) return;
  const list = document.getElementById("moveCatList");
  list.innerHTML = '<div class="move-cat-item" onclick="moveSelected(null)">📁 不分类</div>';
  categories.forEach(c => { list.innerHTML += '<div class="move-cat-item" onclick="moveSelected(\'' + c.id + '\')">📂 ' + escapeHtml(c.name) + '</div>'; });
  document.getElementById("moveDialog").style.display = "flex";
}
function closeMoveDialog(e) { if (!e || e.target.classList.contains("modal-overlay")) document.getElementById("moveDialog").style.display = "none"; }
async function moveSelected(catId) {
  await fetch(API_BASE + "/api/move", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [...selectedIds], category_id: catId }), credentials: "include" });
  document.getElementById("moveDialog").style.display = "none";
  selectedIds.clear(); toggleSelectMode(); loadList(true);
}

// ── 网格 ──
function renderGrid() {
  const grid = document.getElementById("grid");
  grid.className = "grid " + layoutMode;
  if (images.length === 0 && currentPage <= 1) { grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:#999">暂无图片</div>'; return; }
  let html = "";
  let lastMonth = "";
  const months = ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"];
  images.forEach((img, i) => {
    const date = img.exif_date ? new Date(img.exif_date * 1000) : null;
    const monthKey = date ? date.getFullYear() + "-" + date.getMonth() : null;
    if (monthKey && monthKey !== lastMonth) { lastMonth = monthKey; html += '<div class="month-header">' + date.getFullYear() + " " + months[date.getMonth()] + '</div>'; }
    else if (!date && !lastMonth) lastMonth = "-";
    const checked = selectedIds.has(img.id) ? "checked" : "";
    // Use aspect-ratio placeholder to prevent layout shift
    const ar = img.width && img.height ? (img.height / img.width * 100) : 75;
    html += '<div class="thumb-wrap' + (selectMode ? ' select-mode' : '') + '" style="padding-bottom:' + ar + '%">';
    if (selectMode) html += '<input type="checkbox" class="thumb-cb" ' + checked + ' onclick="event.stopPropagation(); toggleSelect(\'' + img.id + '\')">';
    html += '<img class="thumb" src="' + thumbUrl(img) + '" onclick="' + (selectMode ? 'toggleSelect(\'' + img.id + '\')' : 'openLightbox(' + i + ')') + '" alt="' + escapeAttr(img.filename) + '" loading="lazy" onerror="this.src=\'' + origUrl(img) + '\'"></div>';
    if (selectMode) html += '<div class="thumb-check-overlay ' + (checked ? 'checked' : '') + '" onclick="toggleSelect(\'' + img.id + '\')"></div>';
    html += '</div>';
  });
  if (currentPage <= 1) grid.innerHTML = html; else grid.insertAdjacentHTML("beforeend", html);
  if (selectMode && images.length > 0) grid.insertAdjacentHTML("beforeend", '<div class="select-all-bar" onclick="selectAll()">' + (selectedIds.size === images.length ? '取消全选' : '全选 ' + images.length + ' 张') + '</div>');
  buildScrollDots();
  updateScrollProgress();
}

// ── 灯箱 ──
function openLightbox(idx) { currentIdx = idx; resetZoom(); showLightbox(); preloadAdjacent(); }
function closeLightbox(e) {
  if (!e || e.target.classList.contains("lightbox")) {
    document.getElementById("lightbox").style.display = "none";
    document.getElementById("infoPanel").style.display = "none";
    resetZoom();
    if (isRecyclePreview) {
      isRecyclePreview = false;
      loadRecycle();
    }
  }
}
function showLightbox() {
  const pool = getPool();
  if (currentIdx < 0 || currentIdx >= pool.length) return;
  const img = pool[currentIdx];
  document.getElementById("lbImg").src = optimizedUrl(img);
  document.getElementById("lbImg").dataset.original = "0";
  document.getElementById("lbOriginalBtn").textContent = "🔍 原图";
  document.getElementById("lbCounter").textContent = (currentIdx + 1) + " / " + pool.length;
  document.getElementById("lbFilename").value = img.filename;
  document.getElementById("lbDate").textContent = img.exif_date ? new Date(img.exif_date * 1000).toLocaleString() : "";
  updateInfoPanel(img);
  document.getElementById("lightbox").style.display = "flex";
  document.getElementById("infoPanel").style.display = "none";
  // Double-click to toggle original
  document.getElementById("lbImg").ondblclick = (e) => { e.stopPropagation(); viewOriginal(); };
}
function navLightbox(dir) { const pool = getPool(); currentIdx = (currentIdx + dir + pool.length) % pool.length; showLightbox(); preloadAdjacent(); }

function preloadAdjacent() {
  const pool = getPool();
  const urls = [];
  for (const off of [-2, -1, 1, 2]) {
    const idx = (currentIdx + off + pool.length) % pool.length;
    if (idx !== currentIdx) urls.push(optimizedUrl(pool[idx]));
  }
  const fn = () => urls.forEach(u => { const i = new Image(); i.src = u; });
  if ("requestIdleCallback" in window) requestIdleCallback(fn, { timeout: 2000 }); else setTimeout(fn, 200);
}

function viewOriginal() {
  const pool = getPool();
  const img = pool[currentIdx];
  if (!img) return;
  const lb = document.getElementById("lbImg");
  const isOrig = lb.dataset.original === "1";
  lb.src = isOrig ? optimizedUrl(img) : origUrl(img);
  lb.dataset.original = isOrig ? "0" : "1";
  document.getElementById("lbOriginalBtn").textContent = isOrig ? "🔍 原图" : "🔍 medium";
}

// ── 缩放 ──
const ZOOM_MIN = 0.5, ZOOM_MAX = 8;
function resetZoom() { zoomLevel = 1; zoomPanX = 0; zoomPanY = 0; applyZoom(); }
function applyZoom() {
  const img = document.getElementById("lbImg");
  img.style.transform = "translate(" + zoomPanX + "px," + zoomPanY + "px) scale(" + zoomLevel + ")";
  document.getElementById("zoomHint").style.display = zoomLevel > 1 ? "none" : "block";
}
document.addEventListener("wheel", (e) => {
  const lb = document.getElementById("lightbox");
  if (lb.style.display === "none") return;
  if (e.target.closest(".lb-bar,.info-panel,.lb-nav")) return;
  const d = e.deltaY > 0 ? -0.1 : 0.1;
  const nz = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoomLevel + d));
  if (nz !== zoomLevel) { zoomLevel = nz; applyZoom(); e.preventDefault(); }
}, { passive: false });
document.addEventListener("mousedown", (e) => {
  if (zoomLevel <= 1) return;
  if (e.target.closest(".lb-bar,.info-panel,.lb-nav,.lb-close")) return;
  if (e.target.id === "lbImg" || e.target.closest(".lb-img-wrap")) {
    isPanning = true;
    const sx = e.clientX - zoomPanX, sy = e.clientY - zoomPanY;
    const mv = (ev) => { zoomPanX = ev.clientX - sx; zoomPanY = ev.clientY - sy; applyZoom(); };
    const up = () => { isPanning = false; document.removeEventListener("mousemove", mv); document.removeEventListener("mouseup", up); };
    document.addEventListener("mousemove", mv); document.addEventListener("mouseup", up);
  }
});

// ── 信息面板 ──
function toggleInfo() { const p = document.getElementById("infoPanel"); p.style.display = p.style.display === "none" ? "block" : "none"; }
function updateInfoPanel(img) {
  document.getElementById("infoPanelBody").innerHTML =
    '<div class="info-row"><span class="info-label">文件名</span><span class="info-value">' + escapeHtml(img.filename) + '</span></div>' +
    '<div class="info-row"><span class="info-label">分类</span><span class="info-value">' + (img.category_name ? escapeHtml(img.category_name) : '未分类') + '</span></div>' +
    '<div class="info-row"><span class="info-label">尺寸</span><span class="info-value">' + (img.width && img.height ? img.width + " × " + img.height : "-") + '</span></div>' +
    '<div class="info-row"><span class="info-label">文件大小</span><span class="info-value">' + formatSize(img.size) + '</span></div>' +
    '<div class="info-row"><span class="info-label">拍摄时间</span><span class="info-value">' + (img.exif_date ? new Date(img.exif_date * 1000).toLocaleString() : "-") + '</span></div>' +
    '<div class="info-row"><span class="info-label">上传时间</span><span class="info-value">' + (img.uploaded_at ? new Date(img.uploaded_at).toLocaleString() : "-") + '</span></div>' +
    '<div class="info-row"><span class="info-label">类型</span><span class="info-value">' + (img.mime || "-") + '</span></div>';
}
function formatSize(bytes) { if (!bytes) return "-"; if (bytes < 1024) return bytes + " B"; if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB"; return (bytes / 1048576).toFixed(1) + " MB"; }
function getMimeShort(mime) { if (!mime) return "图片"; if (mime.includes("jpeg")||mime.includes("jpg")) return "JPEG"; if (mime.includes("png")) return "PNG"; if (mime.includes("gif")) return "GIF"; if (mime.includes("webp")) return "WebP"; if (mime.includes("svg")) return "SVG"; if (mime.includes("heic")||mime.includes("heif")) return "HEIC"; return mime.split("/").pop().toUpperCase(); }
function getTypeIcon(mime) { if (!mime) return "🖼"; if (mime.includes("gif")) return "🎞"; if (mime.includes("png")) return "🖼"; if (mime.includes("svg")) return "🔶"; if (mime.includes("webp")) return "🌐"; return "📷"; }
function getCountdown(deletedAt) {
  if (!deletedAt) return "";
  const daysLeft = Math.max(0, Math.floor((30 * 86400000 - (Date.now() - deletedAt)) / 86400000));
  if (daysLeft === 0) return "⚠️今日";
  if (daysLeft <= 3) return "⚠️" + daysLeft + "天";
  return daysLeft + "天";
}

// ── 图片尺寸 ──
function getImageSize(file) {
  return new Promise((resolve) => {
    if (!file.type.startsWith("image/")) { resolve(null); return; }
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); resolve({ width: img.naturalWidth, height: img.naturalHeight }); };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// ── 生成缩略图 ──
function generateThumbnail(file) {
  return new Promise((resolve) => {
    if (!file.type.startsWith("image/") || file.type === "image/gif") { resolve(null); return; }
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX_W = 300, w = Math.min(img.width, MAX_W), h = img.height * (w / img.width);
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      c.toBlob(b => resolve(b), "image/jpeg", 0.7);
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// ── 生成 medium ──
function generateMedium(file) {
  return new Promise((resolve) => {
    if (!file.type.startsWith("image/") || file.type === "image/gif") { resolve(null); return; }
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX_W = 1200, w = Math.min(img.width, MAX_W), h = img.height * (w / img.width);
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      c.toBlob(b => resolve(b), "image/webp", 0.8);
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// ── 上传 ──
async function uploadFiles(files) {
  const progress = document.getElementById("uploadProgress");
  const pFill = document.getElementById("progressFill"), pText = document.getElementById("progressText");
  progress.style.display = "flex";
  let dupes = [];
  for (let i = 0; i < files.length; i++) {
    let ok = false, isDup = false;
    try {
      const [sha256, thumb, medium, size] = await Promise.all([computeFileHash(files[i]), generateThumbnail(files[i]), generateMedium(files[i]), getImageSize(files[i])]);
      const fd = new FormData();
      fd.append("file", files[i]);
      fd.append("filename", files[i].name);
      fd.append("sha256", sha256);
      if (currentCategory) fd.append("category_id", currentCategory);
      if (thumb) fd.append("thumb", thumb, "thumb.jpg");
      if (medium) fd.append("medium", medium, "medium.webp");
      if (size) { fd.append("width", size.width.toString()); fd.append("height", size.height.toString()); }
      const r = await fetch(API_BASE + "/api/upload", { method: "POST", body: fd, credentials: "include" });
      if (r.ok) { ok = true; }
      else if (r.status === 409) { isDup = true; dupes.push(files[i].name); }
    } catch (e) { }
    pFill.style.width = ((i + 1) / files.length * 100) + "%";
    pText.textContent = isDup ? "⏭ " + files[i].name.slice(0, 20) + " 已存在" : (ok ? (i + 1) + " / " + files.length : "✗ " + files[i].name.slice(0, 20) + " 失败");
  }
  progress.style.display = "none";
  if (dupes.length) alert("以下图片已存在，已跳过：\n" + dupes.join("\n"));
  selectedIds.clear();
  loadList(true);
}

document.getElementById("fileInput").addEventListener("change", (e) => { if (e.target.files.length) uploadFiles(Array.from(e.target.files)); e.target.value = ""; });

// ── 拖拽 ──
let dragCnt = 0;
document.addEventListener("dragenter", (e) => { e.preventDefault(); dragCnt++; document.getElementById("dropZone").style.display = "flex"; });
document.addEventListener("dragleave", (e) => { e.preventDefault(); dragCnt--; if (dragCnt <= 0) { dragCnt = 0; document.getElementById("dropZone").style.display = "none"; } });
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => {
  e.preventDefault(); dragCnt = 0; document.getElementById("dropZone").style.display = "none";
  const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("image/"));
  if (files.length) uploadFiles(files);
});

// ── 键盘 ──
document.addEventListener("keydown", (e) => {
  if (document.getElementById("lightbox").style.display === "none") return;
  if (e.key === "Escape") closeLightbox({ target: document.getElementById("lightbox") });
  else if (e.key === "ArrowLeft") navLightbox(-1);
  else if (e.key === "ArrowRight") navLightbox(1);
  else if (e.key === "i" || e.key === "I") toggleInfo();
  else if (e.key === "r" || e.key === "R") resetZoom();
  else if (e.key === "d" || e.key === "D") downloadImage();
  else if (e.key === "o" || e.key === "O") viewOriginal();
});

// ── 下载 ──
async function downloadUrl(url, filename) {
  try {
    const r = await fetch(url, { credentials: "include" });
    if (!r.ok) return;
    const blob = await r.blob(), blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = blobUrl; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
  } catch (e) { alert("下载失败"); }
}
function downloadImage() { const pool = getPool(); const img = pool[currentIdx]; if (img) downloadUrl(origUrl(img), img.filename); }
async function batchDownload() {
  if (selectedIds.size === 0) return;
  if (typeof JSZip === "undefined") { alert("JSZip 加载中，请重试"); return; }
  const batch = images.filter(i => selectedIds.has(i.id));
  if (!confirm("将打包下载 " + batch.length + " 张图片，确定？")) return;
  const el = document.getElementById("selectedCount");
  el.textContent = "⏳ 打包中 0/" + batch.length;
  const zip = new JSZip();
  for (let i = 0; i < batch.length; i++) {
    try { const r = await fetch(origUrl(batch[i]), { credentials: "include" }); if (r.ok) zip.file(batch[i].filename, await r.blob()); } catch (e) { }
    el.textContent = "⏳ 打包中 " + (i + 1) + "/" + batch.length;
  }
  el.textContent = "⏳ 压缩中...";
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  downloadUrl(URL.createObjectURL(blob), "photos-" + new Date().toISOString().slice(0, 10) + ".zip");
  el.textContent = "✅ 完成";
  setTimeout(() => { el.textContent = "已选 " + selectedIds.size + " 张"; }, 3000);
}

// ── 重命名 ──
async function renameImage() {
  const pool = getPool(); const img = pool[currentIdx], n = document.getElementById("lbFilename").value.trim();
  if (!n || n === img.filename) return;
  await fetch(API_BASE + "/api/rename/" + img.id, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: n }), credentials: "include" });
}

// ── 删除（软删到回收站） ──
async function deleteImage() {
  if (!confirm("移到回收站？")) return;
  const pool = getPool(); const img = pool[currentIdx];
  await fetch(API_BASE + "/api/delete/" + img.id, { method: "DELETE", credentials: "include" });
  closeLightbox({ target: document.getElementById("lightbox") });
  loadList(true);
  loadStats();
}

// ── 工具 ──
function escapeHtml(s) { if (!s) return ""; return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function escapeAttr(s) { if (!s) return ""; return s.replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

// ── 统计 ──
async function loadStats() {
  try {
    const r = await fetch(API_BASE + "/api/stats", { credentials: "include" });
    if (!r.ok) return;
    const d = await r.json(), total = d.total_images || 0, used = d.total_bytes || 0, free = d.free_bytes || 10737418240;
    const pct = free > 0 ? (used / free * 100) : 0;
    const usedStr = used < 1048576 ? (used / 1024).toFixed(1) + "KB" : (used / 1048576).toFixed(1) + "MB";
    let txt = '📷 ' + total + ' 张 · 💾 ' + usedStr + ' / 10 GB';
    if (pct > 0) txt += ' (' + pct.toFixed(1) + '%)';
    const el = document.getElementById("statsCompact");
    if (el) el.textContent = txt;
    if (pct > 80) el.style.background = 'rgba(231,76,60,0.15)';
  } catch (e) { }
}
function updateStats() {
  const el = document.getElementById("statsCompact");
  if (showRecycle && el) el.textContent = "🗑 回收站 (" + recycledImages.length + " 张)";
}

// ── 登录 ──
async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}
function computeFileHash(file) {
  return crypto.subtle.digest("SHA-256", file).then(buf =>
    Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("")
  );
}
async function doLogin() {
  const pass = document.getElementById("loginPass").value;
  if (!pass) return;
  const hash = await sha256(pass);
  const r = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hash }), credentials: "include" });
  if (r.ok) {
    document.getElementById("loginOverlay").style.display = "none";
    startApp();
  } else {
    document.getElementById("loginError").style.display = "block";
    document.getElementById("loginPass").value = "";
    document.getElementById("loginPass").focus();
  }
}
async function checkAuth() {
  try {
    const r = await fetch("/api/check-auth", { credentials: "include" });
    if (r.ok) return true;
  } catch (e) {}
  return false;
}
async function startApp() {
  loadCategories();
  loadList(true);
  loadStats();
  document.getElementById("darkToggle").textContent = darkMode === "1" ? "☀️" : "🌙";
  document.getElementById("layoutToggle").textContent = layoutMode === "masonry" ? "⊞" : "⊟";
}
async function doLogout() {
  await fetch("/api/logout", { method: "POST", credentials: "include" });
  localStorage.removeItem("photosDarkMode");
  localStorage.removeItem("photosLayout");
  location.reload();
}
// ── 启动 ──
(async () => {
  const authed = await checkAuth();
  if (!authed) {
    document.getElementById("loginOverlay").style.display = "flex";
    document.getElementById("loginPass").focus();
  } else {
    startApp();
  }
})();
