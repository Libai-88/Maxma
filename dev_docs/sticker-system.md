# Maxma 表情系统（dsh-meme 源码移植，v2.7.0）

> 基座：`yyh-001/dsh-meme` 0.1.85（MIT）。本仓为 **vendored source port**，不是 npm 依赖；
> `bun-shared/dsh-meme/memes.ts` 保留上游核心逻辑，DSH 宿主绑定改为 Maxma adapter。

## 1. 存储模型

一个图库（pack）= 一个目录：

```text
<pack>/
  index.db       # SQLite：path/tag/file_name/caption/keywords/mtime/captioned_at
  manifest.json  # id/name/description/version/count/license/source/...
  memes/<tag>/<file>.{webp,png,jpg,jpeg,gif}
  .dsh-remote.json  # 仅市场安装的 pack：archiveUrl/sha256/lastSync
```

没有全局 `stickers.db`，没有内容寻址 blob。图片原始字节落盘；GIF 不转帧。

| pack id | 位置 | 说明 |
|---|---|---|
| `maxma_builtin` | `<bundle>/config/stickers` | 旧中文分类目录原地转为 pack；图片不移动，`path` 仍是 `开心/a.webp` |
| `dsh-meme-user` | `<data>/stickers/packs/dsh-meme-user` | 上传/学图/收藏；市场更新不会碰它 |
| `maxma_legacy_custom` | `<data>/stickers/packs/maxma_legacy_custom` | 旧 `data/config/stickers/custom` 的副本，`path=custom/<file>` |
| 市场 pack | `<data>/stickers/packs/<id>` | 带 `.dsh-remote.json`，可整目录删除/更新 |

内置索引由 `scripts/build-sticker-pack.ts` 生成：`bun run scripts/build-sticker-pack.ts`。构建器读取 `config/stickers/captions.json` 的 328 条离线语义标注；`captions.json` 比 `index.db` 新时自动重建。便携构建在复制 `config/stickers` 前强制重建，避免旧 `index.db` 进包。索引已存在时构建器在同一个 SQLite 文件里 `DELETE + INSERT` 复用文件，避免 Windows 上 `close()` 后立即 `rm` 的 `EBUSY`；只有文件缺失/损坏才删除重建。

## 2. HTTP 路由

### 新接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/stickers/index?packId=all&tag=&q=&limit=` | 聚合索引；默认 limit 2000 |
| GET | `/api/stickers/file/:packId/*` | 图片；`ETag` + 24h 缓存；必须命中索引。相对路径从已解码的 `c.req.path` 截取（Hono 不暴露 `*` 参数），中文目录才能命中 |
| GET | `/api/stickers/packs` | 图库列表 + 启用/当前 |
| GET/POST | `/api/stickers/settings` | 设置；白名单字段 |
| PATCH | `/api/stickers/packs/:id` | `{enabled:boolean}` |
| POST | `/api/stickers/packs/:id/activate` | 设为当前 |
| POST | `/api/stickers/packs/:id/scan` | 扫描新增/清理失效 |
| POST | `/api/stickers/upload` | multipart：`file/tag/caption/keywords` |
| POST | `/api/stickers/memes/update` | 改 tag/caption/keywords，只改索引 |
| DELETE | `/api/stickers/memes?packId=&path=` | 删单图 + 索引行 |
| GET | `/api/stickers/market?refresh=1` | 市场目录 + 安装状态 |
| POST | `/api/stickers/market/install` | `{id}`（或手填 `archiveUrl/sha256`） |
| POST | `/api/stickers/market/update` | 同上，用于已安装条目 |
| POST | `/api/stickers/packs/install` | 兼容入口，语义同上 |
| POST | `/api/stickers/packs/import` | multipart ZIP 导入 |
| GET | `/api/stickers/packs/:id/export` | ZIP 下载；保留 index/manifest/图片 |
| DELETE | `/api/stickers/packs/:id` | 只删带 `.dsh-remote.json` 的市场 pack |
| POST | `/api/stickers/packs/:id/delete` | 同上（旧客户端别名） |
| GET | `/api/stickers/health` | pack 计数 + migration 状态 |

### 旧兼容

`/api/stickers`（categories + packs）、`/legacy/index`、`/random/:category`、`/:category/:filename`、
`/favorites`、`/recent`、`/custom`、`/usage`、`/skip`、`/recommendations` 保留。
旧图片 URL 解析为 `maxma_builtin/<category>/<file>` 或 `maxma_legacy_custom/custom/<file>`。

管理接口必须 Token；`GET/HEAD` 图片和 `random/:category` 才免 Token。旧两段路由用保留前缀集合防止把 `packs/settings/market` 当分类泄露。

## 3. Agent 工具与协议

- `send_meme`：`tag/query/limit`，返回候选 `[表情: 描述]` 与 `details.hits`（绝对路径、pack、tag、caption）。无命中返回 `ok:false + tags`，不随机塞图。
- `learn_meme`：`attachmentId/imageUrl/sourcePath`，≤8MB，魔数嗅探 jpg/png/gif/webp，写 `dsh-meme-user`；未给 tag 默认 `daily` 并提示改分类。语义描述由调用方通过 `caption/keywords` 提供；不内置视觉模型，避免未配置时偷偷调用外部服务。
- `meme_list`：只读清单，`q/tag/packId/limit`。
- `meme_update`：`path/tag/caption/keywords`；内置 pack 拒绝编辑；只改 `index.db`。
- `get_sticker`：保留旧分类语义，仅扫描旧 `config/stickers`；不再进系统提示词。

提示词由 `persona-prompt.ts` 的 `stickerPrompt` 动态注入：从 `data/stickers/settings.json` 读 `promptEnabled/enabledPacks/sendGear`，协议为半角 `[表情: 描述]`，并列出启用图库的真实 tag。

前端渲染：`StickerRichText` 把正文按 `[表情: ...]` / `<sticker:...>` 切分；`stickerUtils` 先 caption 精确、再 tag/中文映射、再 keywords、最后 caption 子串；未命中保留原文。旧 `<sticker:...>` 与旧 `[表情包:分类]` 双读。

## 4. 市场与 ZIP

默认目录源（`auto`）：

```text
https://raw.githubusercontent.com/yyh-001/dsh-meme-packs/main/catalog.json
https://cdn.jsdelivr.net/gh/yyh-001/dsh-meme-packs@main/catalog.json
https://raw.githubusercontent.com/yyh-001/dsh-meme/main/docs/remote-packs.json
https://cdn.jsdelivr.net/gh/yyh-001/dsh-meme@main/docs/remote-packs.json
```

`official` = GitHub raw；`mirror` = `ghfast.top/gh-proxy.com/ghproxy.net`；自定义 = HTTPS URL。
不接 Giphy/Tenor、不需要 Key、**不会自动安装**，必须用户点安装。

默认目录源的 `docs/remote-packs.json` 是空占位，`fetchMarketCatalog` 会把空目录当作失败而不是成功候选；否则竞速会先返回 `packs=0`，掩盖有内容的 catalog。当前实测默认目录最终命中 jsDelivr 的 `dsh-meme-packs`，20 个带 64 位 SHA-256 的包。目录条目透传 `license/homepage`，市场行显示许可证；缺失时显示「许可证未声明」，不把它当成已审核。有 `homepage` 的条目显示可点击「来源」，缺来源的条目明确显示「来源未提供」；`openExternal` 只放行 http/https/mailto 等安全协议。市场行下方固定提示：许可证与来源由目录声明，安装前请自行核对授权范围，应用不会执行图库内脚本。

许可证/来源审计：

```powershell
bun scripts/audit-sticker-licenses.ts           # 只报告
bun scripts/audit-sticker-licenses.ts --strict  # 缺 license/重复 id/坏 sha256 时 exit 1
bun scripts/audit-sticker-licenses.ts --json
```

审计只证明字段存在、格式合法、id 不重复，**不能证明第三方授权真实有效**；真正的版权审核仍需项目 owner 人工确认。2026-11-19 实测：20 个包，license 全部非空，6 个缺 homepage（只警告，不阻断安装），strict 通过。

安装流程：ZIP → SHA-256（必填）→ 解压校验 → stage/bak → rename → 写 `.dsh-remote.json` → 启用 pack。
失败时旧 pack 不动；Windows SQLite 句柄用 50ms×100 重试 rename/remove；校验 index.db 时复制到系统临时目录，避免 stage 内句柄导致 `EPERM`。

ZIP 边界：≤200MB、解压≤300MB、条目≤5000、压缩比≤100、拒绝加密/符号链接/重复条目/路径越界/非图片扩展名。
归档主机白名单：GitHub raw/release、jsDelivr 家族、jsdmirror、三个镜像前缀；只 HTTPS、443、拒绝 IP/私网/回环；手动重定向最多 5 跳，每跳重新校验。

## 5. 迁移与回滚

`runStickerMigration()` 在首次 init 时执行（幂等，marker：`<data>/stickers/migration.json`）：

1. 备份旧 custom 与三个 YAML 到 `<data>/stickers/backup/<timestamp>/`。
2. 旧 custom → `maxma_legacy_custom`（复制，不删原文件）。
3. 旧 favorites YAML → `dsh-meme-user` 图片 + 索引行。
4. 旧 recent YAML → `recent.json`（仅当新文件不存在）。
5. 对账：内置/custom 行数 vs 图片数，旧 URL 抽样 200。
6. 失败只写 `errors`，旧 YAML/custom 原文件保留；不阻断启动。

回滚开关：`MAXMA_STICKER_ENGINE=legacy`。此时 server 挂载旧 YAML/custom 路由 + 旧 `index/random/图片` shim，不加载新 `createStickerRoutes()`。默认为 dsh（未设置即新系统）。回滚不需要删除任何新 pack；旧数据从未被移动。

## 6. 边界与已知限制

- 内置 328 张图已全部写入离线语义 caption（`config/stickers/captions.json`，328/328），
  `[表情: 描述]`、关键词搜图和 `send_meme` 候选描述使用这些数据。生成与校验见
  `dev_docs/sticker-captions.md`；这是离线人工+视觉标注，不是运行时视觉模型。
- `learn_meme` 不内置视觉识图；Maxma 当前输入以文本 + 文件路径为主，不能假设所有
  模型支持图片。需要语义 captions 时由调用方传 `caption/keywords`；新增内置图不会自动
  获得语义描述。
- 市场包是第三方内容；市场行显示目录的 `license`/`homepage`，图库行显示 manifest
  的 `license`，缺失时明确写「许可证未声明/来源未提供」；页面提示授权需自行核对。
  `scripts/audit-sticker-licenses.ts --strict` 只做字段级审计，不替代版权审核。
  `personal`/`noncommercial-fan` 是否可用于你的场景需 owner 自行判断，安装器不替用户
  做法律结论。
- `packId=all` 全量返回，未做分页；默认 limit 2000。
- P6 基线（临时用户图库 5000 行 + 内置 328 行，Windows/Bun 1.3.14）：`indexPayload limit=500` 56.6ms、`limit=2000` 53.7ms、`limit=5000` 54.1ms（单次冷/热未区分；只测响应构造，不含网络）。
- 真实 UI e2e 已覆盖：焦点进入搜索框、Tab 不逃逸、Escape 关闭并归还焦点、CDP 单点触控、键盘 Enter、CDP 双指捏合、Chromium IME 组合输入、管理面板真实可见、桌面深/浅色 + 768px 窄窗共 6 张像素基线（`dev_docs/visual/sticker-baseline/`，2% 阈值）。仍不覆盖真机触屏硬件、系统级中文输入法候选窗、跨平台字体差异。
- 视觉基线是**产品回归基线**，不是设计稿验收；仓库没有外部设计稿，当前 UI 作为
  设计基线。最低支持窗口宽度 768px；390px 手机宽度不属于当前桌面应用的支持范围。
- 离线：市场目录不可达时返回 `ok:false + warning`，不抛异常；本地内置/用户图库索引仍可读（`tests/stickers-market.test.ts`）。
- 已做桌面便携 smoke 和 Web 便携包 smoke；`MAXMA_STICKER_ENGINE=legacy` 的完整 `createApp()` 服务装配由 `tests/stickers-legacy-server.test.ts` 覆盖。

## 7. 测试入口

```powershell
cd bun-backend; bun test
cd bun-sidecar; bun test; bun x tsc --noEmit
cd web; bun run typecheck; bun test; bun run build; bun run lint:colors; bun run lint:spacing
cd ..; bun run scripts/build-sticker-pack.ts
bun scripts/audit-sticker-licenses.ts --strict
bun scripts/verify-ui-stickers.mjs
cmd /c build-portable.bat
.\build\portable-smoke-test.ps1 -PortableDir '..\MaxmaHere-Portable' -SeedDefaults -Port 8012
.\build\portable-smoke-test.ps1 -PortableDir 'dist\electron-portable\win-unpacked\resources\maxma' -SeedDefaults -Port 8011
```

当前实测（2026-11-19，本轮改动后）：backend 331 pass / 0 fail（51 files，2183 expect）；
sidecar 234 pass / 0 fail + `tsc --noEmit` 通过；web 52 pass / 0 fail + typecheck + build +
两道 lint 通过；UI 表情 e2e 三个场景（深色桌面/浅色桌面/768px 窄窗）全通过，console
warning/error 为 0；市场 strict 审计 20 包、0 fatal、6 个 homepage 警告。桌面与 Web
便携 smoke 见下方最终产物。

最终产物（2026-11-19 重建，含本轮 caption/UI/测试改动）：

- 桌面：`dist/electron-portable/MaxmaHere-2.7.0-portable-x64.zip`，252,201,690 bytes，SHA-256
  `6988917631426c2190a8e1ac5561273ffe31fedf2f8434b584a6e1ed33e6f840`。
- Web：`dist/web-portable/MaxmaHere-Portable-2.7.0.zip`，83,265,091 bytes，SHA-256
  `1ca40874e3fc87ad25f2209b230b42b8ff948392ef39ecc5400cc3b421399718`；包内
  `config/stickers/index.db` 实测 328 行、`captioned_at` 328，且包含 `bun.exe`、`web/dist`。
- 两个 zip 内均为最新前端 `web/dist/assets/ChatView-Dnuefhr4.js`；桌面包内资源路径带
  `resources/maxma/` 前缀。桌面与 Web 便携 smoke 均通过（328 张内置图、图片 200、
  管理路由无 Token 401、插件运行时 23 个外部包 0 缺失）。
