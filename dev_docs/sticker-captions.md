# 内置表情语义 caption（328 张）

`config/stickers/captions.json` 是随包的**离线静态标注**：key 是内置图库的相对路径，
value 是 `{caption, keywords}`。`bun-backend/src/stickers/build.ts` 在生成
`config/stickers/index.db` 时读取它，覆盖原来的 `分类 + 文件名` caption，并把
`captioned_at` 标成生成时间。

## 它是什么，不是什么

- 是：对 328 张内置图的画面/文字/情绪的离线人工+视觉检查结果，用于
  `[表情: 描述]`、图库搜索和模型候选描述。
- 不是：运行时视觉模型。Maxma 启动、发送表情或 `learn_meme` 时不会调用任何
  OCR/多模态 API；`learn_meme` 仍要求调用方传 `caption/keywords`。
- 不是：版权级人工审核。描述只求“人看得懂、搜得到”，不判断素材来源合法性。

## 生成方式

1. 把 328 张图按 5×5 拼成 14 张 contact sheet（最后一张 3 张），每格带全局
   `#001..#328` 标签；同时输出 `sheet-XX.json`（`index/rel/category`）作为
   路径映射。
2. 人工逐张读图，写 328 条按索引排序的描述；描述只记录可观察内容，不臆造
   画面外的品牌、人物身份或版权结论。
3. 合并脚本按 `rel` 生成 `captions.json`，caption 前加分类前缀（如
   `委屈：棕熊趴在桌上低头委屈`），keywords 用 `分类 + 描述` 以支持中文子串搜索。
4. 运行 `bun run scripts/build-sticker-pack.ts` 重建 `index.db`；`builtinIndexIsCurrent()`
   会比较 `captions.json` 与 `index.db` 的 mtime，标注比索引新时自动重建。

contact sheet 是过程材料，不随仓库提交；`captions.json` 是唯一运行时输入。

## 覆盖与校验

- 328/328 条均有 caption，`index.db` 中 `captioned_at is not null` = 328。
- `bun-backend/tests/stickers-captions.test.ts` 覆盖：标注覆盖、缺失标注回退、
  标注比索引新时索引失效。
- `send_meme` 的 query 会搜 caption/keywords/file_name/tag；例如 `棕熊` 应命中
  `委屈/01184322e9563bc7e6a302d97ce25c96_gif.webp`。
- 本数据不含运行时外部依赖；即使标注文件损坏，构建器也会静默回退到
  `分类 + 文件名`，不阻断图库启动。
