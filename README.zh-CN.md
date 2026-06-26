# 📸 Cloudflare Photos

> 基于 Cloudflare 免费套餐的轻量自托管控图库 —— **Pages + R2 + D1 + Workers**。

无需服务器，无需数据库，无需月费。只需要一个 Cloudflare 账号。

---

## 功能特性

| 分类 | 功能 |
|------|------|
| **📤 上传** | 拖拽上传、文件选择器、手机拍照上传、批量上传 |
| **👀 浏览** | 瀑布流布局、时间线排序、无限滚动 |
| **🔍 灯箱** | 缩放（滚轮+捏合）、平移、信息面板、键盘导航 |
| **📋 管理** | 重命名、软删除（回收站）、永久删除、30天自动清理 |
| **📦 批量** | 选择模式、批量下载（ZIP）、批量删除、批量移动 |
| **📁 分类** | 文件夹管理、跨分类移动、分类排序 |
| **🔎 搜索** | 实时文件名搜索 |
| **📊 排序** | 最新、最旧、A–Z、Z–A、最大、最小 |
| **⬇️ 下载** | 单图下载、批量 ZIP 下载 |
| **🔐 去重** | SHA-256 哈希校验，重复图片自动跳过 |
| **🔑 认证** | 密码登录、注销、Cookie 会话（30天有效） |
| **🌙 主题** | 深色模式（跟随系统 + 手动切换） |
| **📈 体验** | 滚动进度条 + 月份标记、回到顶部、统计栏 |
| **📱 响应式** | 桌面（4列）→ 平板（3列）→ 手机（2列） |
| **🗑️ 回收站** | 表格视图、缩略图、恢复倒计时、永久删除、一键清空 |

---

## 系统架构

```
┌─────────────────────────────────────────────────┐
│                   浏览器                           │
│  ┌───────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ 上传      │  │ 浏览     │  │ 灯箱         │  │
│  │ (Canvas   │  │ (网格 /  │  │ (缩放 / 平移 │  │
│  │  缩略图)  │  │ 瀑布流)  │  │  下载)       │  │
│  └───────────┘  └──────────┘  └──────────────┘  │
└──────────────────┬──────────────────────────────┘
                   │
            HTTP API（同源）
                   │
┌──────────────────▼──────────────────────────────┐
│          Cloudflare Pages Functions              │
│  ┌──────────┬──────────┬──────────┬──────────┐  │
│  │ 上传     │ 列表     │ 登录     │ 回收站   │  │
│  │ 重命名   │ 删除     │ 统计     │ 移动     │  │
│  └────┬─────┴────┬─────┴────┬─────┴────┬─────┘  │
│       │          │          │          │        │
│  ┌────▼────┐┌───▼────┐┌───▼────┐┌───▼──────┐  │
│  │  R2     ││  D1    ││ R2     ││  R2 + D1 │  │
│  │ (原图)  ││(元数据)││(缩略图)││ (medium) │  │
│  └─────────┘└────────┘└────────┘└──────────┘  │
└─────────────────────────────────────────────────┘
```

### 使用到的 Cloudflare 服务

| 服务 | 用途 | 免费额度 |
|------|------|---------|
| **Pages** | 静态托管 + 无服务器函数 | 10万次请求/天 |
| **R2** | 图片存储（原图/缩略图/medium） | 10 GB 存储 |
| **D1** | 元数据库（图片、分类） | 5 GB 存储 |
| **Workers** | Pages Functions 运行环境 | 含在 Pages 内 |

### 关键设计决策

- **客户端图片处理** — 缩略图（300px JPEG）和 medium 版（1200px WebP）在上传前由浏览器 Canvas API 生成。避免 Cloudflare Workers 10ms CPU 限制。
- **R2 直出图片** — 图片通过 Pages Functions 直接从 R2 提供，缩略图/medium 设 `Cache-Control: max-age=86400, immutable`。
- **SHA-256 去重** — 上传前在浏览器端计算哈希，查询 D1 避免重复。
- **宽高比占位** — 每个图片容器用 `padding-bottom` 预留空间，防止懒加载时布局偏移。
- **零框架** — 纯 HTML/CSS/JS，无 React、无构建步骤、无 npm。

---

## 部署指南

### 前提条件

1. 一个 Cloudflare 账号
2. `npm` 或 `npx`（用于 wrangler CLI）
3. Cloudflare API Token（需 `Pages:Edit`、`R2:ReadWrite`、`D1:Edit` 权限）

### 部署步骤

```bash
# 1. 克隆仓库
git clone https://github.com/wcy7902898/photos.git
cd photos

# 2. 安装 wrangler
npm install -g wrangler

# 3. 创建 R2 存储桶
npx wrangler r2 bucket create photos-imgs

# 4. 创建 D1 数据库
npx wrangler d1 create photos-meta

# 5. 创建图片表
npx wrangler d1 execute photos-meta --command="
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
"

# 6. 创建分类表
npx wrangler d1 execute photos-meta --command="
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  sort_order INTEGER DEFAULT 999
);
"

# 7. 部署
npx wrangler pages deploy . --project-name photos --branch main
```

> **注意：** R2 和 D1 的绑定（`R2`、`DB`）需要在 Pages 项目设置中配置（Cloudflare 控制台 → 项目 → Settings → Bindings）。

### 配置自定义域名

在 Cloudflare 控制台：
1. Pages → 你的项目 → Custom domains → 添加 `photos.yourdomain.com`
2. 如有需要，更新 `_headers` 文件适配你的域名

---

## API 端点一览

全部端点位于 `/api/` 下，由 Pages Function（`functions/api/[[path]].ts`）处理。

| 方法 | 路径 | 需认证 | 说明 |
|------|------|--------|------|
| POST | `/api/login` | 否 | 密码登录 |
| POST | `/api/logout` | 否 | 注销 |
| GET | `/api/check-auth` | 否 | 检查是否已登录 |
| GET | `/api/list` | 是 | 列出图片（分页、排序、搜索） |
| POST | `/api/upload` | 是 | 上传图片（含原图、缩略图、medium） |
| POST | `/api/rename/:id` | 是 | 重命名图片 |
| DELETE | `/api/delete/:id` | 是 | 软删除到回收站 |
| POST | `/api/batch-delete` | 是 | 批量软删除 |
| GET | `/api/stats` | 是 | 图片数量、存储用量 |
| GET | `/api/categories` | 是 | 列出分类 |
| POST | `/api/categories` | 是 | 创建分类 |
| DELETE | `/api/categories/:id` | 是 | 删除分类 |
| POST | `/api/categories/reorder` | 是 | 重排分类 |
| POST | `/api/move` | 是 | 移动图片到分类 |
| GET | `/api/recycle` | 是 | 列出回收站 |
| POST | `/api/recycle/restore` | 是 | 从回收站恢复 |
| POST | `/api/recycle/delete` | 是 | 永久删除 |
| POST | `/api/recycle/empty` | 是 | 清空回收站 |
| GET | `/api/img/*` | 否 | 提供图片（原图、缩略图、medium） |

---

## 调试过程 & 踩坑记录

### 第一阶段 — MVP（基于 Worker）

第一个版本用独立的 Cloudflare Worker 做 API 后端，另配一个静态站点。图片存 R2，元数据存 D1。没有缩略图、没有分类、界面极简。

### 第二阶段 — 迁移到 Pages Functions

将后端重写为 Pages Function（`functions/api/[[path]].ts`），实现单项目部署（不再需要独立的 Worker）。新增：
- 上传时客户端生成缩略图 + medium
- 分类、搜索、排序
- 回收站（30天自动清理）
- 深色模式
- 批量操作
- SHA-256 去重
- 密码认证 + 注销

### 第三阶段 — 用户体验打磨

- **无限滚动** — 去掉手动的"加载更多"按钮，改为基于滚动的自动加载（用 `requestAnimationFrame` 做节流）
- **滚动位置保持** — 加载更多图片时，在 fetch 前保存滚动比例，渲染后恢复，防止"弹回顶部"
- **滚动进度条** — 右侧滚动指示器，带可点击的月份标记点，以及回到顶部按钮
- **布局偏移修复** — 移除缩略图的 `title` 属性（原生 tooltip 在瀑布流布局中导致闪烁），用 `padding-bottom` 宽高比占位，让图片容器在加载前预留空间

### 第四阶段 — 清理 & Bug 修复

#### 🐛 缺少缩略图（404 错误）

**问题：** 在缩略图功能上线之前上传的图片，R2 中没有 `thumbs/{id}.jpeg` 或 `medium/{id}.webp`。`onerror` 回退加载原图导致严重的布局抖动。

**修复：** 用 Python 脚本通过 Cloudflare R2 API 回填了所有缺失的缩略图和 medium 版：
```python
# 遍历 D1 中所有图片，检查 R2 是否有缩略图/medium
# 缺失则：下载原图 → Pillow 缩放 → PUT 回 R2
```
结果：全部 57 张图片的缩略图不再 404。

#### 🐛 孤立的 D1 记录

**问题：** 10 条 D1 记录没有对应的 R2 文件（图片上传过但未持久化，或已被单独删除）。这些记录持续返回 404。

**修复：** 对比 R2 对象列表和 D1 记录找出孤立 ID，通过批量删除 API 清理。缩略图从 67 张变回 57 张，全部 D1↔R2 一一对应。

#### 🐛 图片服务的 401 误报

`HEAD` 请求到 `/api/img/*` 返回 401，原因是 Pages Function handler 只对该路径实现了 `GET`。实际 `GET` 请求完全正常 —— 这只是浏览器 DevTools 显示问题，不是真正的 bug。

#### 🐛 自定义域名边缘缓存

部署到 `main` 分支后，自定义域名需要几分钟才能更新。Cloudflare 的边缘 CDN 会激进缓存静态 HTML。`_headers` 虽然设置了 `Cache-Control: max-age=0, must-revalidate`，但 CF 边缘节点仍可能在短时间内提供旧内容。解决办法：部署一个小改动（如更新 meta 标签）强制刷新缓存。

#### 🐛 布局闪烁终极修复

**问题：** 缩略图加载完成前容器高度为 0，触发懒加载后图片出现，后续图片被推下，导致反复布局偏移。用 `onerror` 回退加载原图（几 MB）进一步加剧问题。

**修复：** 双重保障：
1. 上传时记录图片宽高到 D1，渲染时用 `padding-bottom: (height/width * 100)%` 占位
2. 缩略图用 `position: absolute` 填充占位容器，加载前后高度不变
3. `img[loading="lazy"]` 依然保留作为辅助

#### 🐛 CF Pages 请求额度超限

**问题：** 调试过程中大量刷新 + 逐张 curl 验证，一天内用完了 10 万次请求额度，线上返回 Error 1027。

**影响：** 仅当天的请求被拒绝，不会扣费。北京时间次日早 8 点自动重置。

**注意：** 这是调试阶段的偶发问题，正常使用（几人的图库）远不会触达限额。

---

## 许可证

MIT
