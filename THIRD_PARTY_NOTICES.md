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

