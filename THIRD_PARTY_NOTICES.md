# Third-party notices

## dsh-meme

- Upstream: https://github.com/yyh-001/dsh-meme
- Version ported: 0.1.85
- License: MIT
- Ported files: `bun-shared/dsh-meme/memes.ts` (core pack/index/search logic; `node:sqlite` changed to `bun:sqlite`, DSH tool/IM layers removed)
- Upstream copyright: Copyright (c) 2026 Selfloom contributors

The MIT license text is reproduced in `bun-shared/dsh-meme/LICENSE`.

## Office preview

Workbench 的只读 Office 预览使用以下 npm 包，均为运行时动态加载：

- `docx-preview` 0.4.1 — Apache-2.0，https://github.com/VolodymyrBaydalka/docxjs
- `read-excel-file` 9.3.20 — MIT，https://gitlab.com/catamphetamine/read-excel-file
- `pptx-preview` 1.0.7 — ISC；npm 发布包可免费用于个人与商业项目，上游源码不随包提供。https://www.npmjs.com/package/pptx-preview

`pptx-preview` 自身依赖 `jszip`、`lodash`、`echarts`、`tslib`、`uuid`，其许可证随各自 npm 包分发。

## Office generation

- `pptxgenjs` 4.0.1 — MIT，https://github.com/gitbrent/PptxGenJS
- `fflate` 0.8.3 — MIT，https://github.com/101arrowz/fflate
- 用途：`bun-sidecar/src/tools/pptx.ts` 生成原生可编辑 PPTX（文本框、形状、演讲者备注），不生成图片幻灯片；
  `sanitizePptxPackage` 用 fflate 重打包并移除 `[Content_Types].xml` 中指向缺失部件的 Override。
- 依赖：`jszip`、`image-size`、`https`，许可证随各自 npm 包分发。

