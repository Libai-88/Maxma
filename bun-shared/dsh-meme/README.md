# dsh-meme vendored core

本目录是 [dsh-meme](https://github.com/yyh-001/dsh-meme) `0.1.85` 的源码级移植（MIT）。

- `memes.ts`：`MemesStore`、pack 扫描、`index.db` 读写、搜索/情绪桶、ZIP 之外的纯逻辑。
- 上游 `node:sqlite` 已换成 `bun:sqlite`（Bun 1.3.14 实测通过）。
- DSH 的 `defineTool`、`ctx.tools.register`、IM 投递未移植；Maxma 在 `bun-sidecar/src/tools/stickers.ts` 里适配。
- 保留上游版权与 MIT LICENSE；派生文件头部注明来源和版本。

上游关键约定：

- 一个图库 = 一个目录，目录里有 `index.db` 才算图库。
- `index.db` 表：`path / tag / file_name / caption / keywords / mtime / captioned_at`。
- 图库 id 以目录名为准；manifest 的 `id` 只用于导入校验。
- tag 建议六情绪桶：`happy / angry / sad / shy / confused / daily`。
