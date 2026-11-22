# Maxma 任务护照

> 每个交付，都有一张护照。

Maxma 任务护照（Maxma Passport）是 Cowork 任务完成后的本地凭证。它把散落在任务事件、审批记录和产物元数据里的关键事实收成一张可读、可下载、可核验的卡片：

- 任务目标、状态、权限与数据策略；
- 本次实际使用的模型路由：提供商、模型、本机/云端、成本与回退原因；
- 审批记录：计划、工具、导出、删除分别批了什么、拒了什么；
- 交付物：文件名、版本、大小、SHA-256；
- 来源：项目与资产路径；
- 护照指纹：对护照正文做 SHA-256；对象键递归排序后再序列化，避免 JSON 美化或键顺序变化导致验不过。

## 为什么它是差异点

多数 Agent 只交结果文件；Maxma 把“结果是怎么来的”一起交付。任务护照不是日志导出，而是面向交付的凭证：用户不需要读完整事件流，就能判断这次任务花了多少钱、走了哪个模型、经过了哪些审批、产物有没有被替换。

它是 Maxma 本地优先路线的品牌签名：交付物、审批和数据边界在同一个本地界面里闭环，不依赖云端控制台。

## 使用方式

### 任务详情

交付物生成后，任务详情会出现「Maxma 任务护照」卡片：

- `查看护照`：打开完整 Markdown 凭证；
- `JSON`：下载结构化护照；
- 弹窗内可 `复制指纹`、`核验指纹`（浏览器本地重算，不依赖服务器）、下载 `Markdown` / `JSON`。

### 交付包

`交付包` ZIP 会自动包含：

```text
MAXMA-PASSPORT.json   # 结构化凭证
MAXMA-PASSPORT.md     # 可读版
MAXMA-PASSPORT-VERIFY.mjs  # 零依赖核验脚本
sources.json
README.md
artifacts/...
```

### API

```http
GET /api/cowork/tasks/:id/passport
```

返回：

```json
{
  "passport": { "schema": "maxma.cowork.passport/v1", "passport_id": "maxma-…", "integrity": { "algorithm": "sha256", "digest": "…" } },
  "markdown": "# Maxma 任务护照…",
  "filenames": { "json": "任务-Maxma-Passport.json", "markdown": "任务-Maxma-Passport.md" }
}
```

## 如何核验指纹

指纹覆盖的正文是：从护照顶层删除 `passport_id` 与 `integrity` 两个字段后剩下的对象。

1. 读取 `MAXMA-PASSPORT.json`，删除顶层 `passport_id` 与 `integrity`，数组顺序保持不变。
2. 对对象键递归按字典序排序，序列化成无空白的 JSON（`integrity.canonicalization = json-sort-keys/v1`）。
3. 对上面的字符串做 SHA-256，得到 `digest`；`passport_id` 应等于 `maxma-` 加上 `digest` 前 12 位。
4. 产物文件的 SHA-256 单独放在 `artifacts[].sha256`，可以拿交付包里的原文件重新计算比对。

这样即使把 JSON 重新格式化、调整键顺序，指纹仍然一致；改动任何任务事实、路由、审批或产物摘要都会换指纹。

交付包还带 `MAXMA-PASSPORT-VERIFY.mjs`，解压后在本目录运行 `node MAXMA-PASSPORT-VERIFY.mjs`，会逐项检查护照指纹、编号、产物 SHA-256 与数量；全通过退出码为 0。

## 边界与诚实标注

- 护照记录的是 **Maxma 侧**的任务状态、模型路由选择、审批决定与产物指纹。
- 指纹是 SHA-256 内容摘要，不是第三方签名证书；它证明文件内容与记录一致，不证明上游服务行为。
- “本机路由”只说明 Maxma 选择了本机地址，不等于对本地网关之后是否转发的强证明。需要强证明时，使用本地桩任务与网络请求日志。
- 护照不直接收录凭据字段：`route.fallback` 与 `task.model_policy` 只取白名单字段；所有进入护照的文本会把疑似 API Key / token 替换成 `[redacted]`。护照不包含模型原始输出或审批 payload 全文。
- 打包接口在护照不可用时仍可生成产物包；护照是增强项，不阻断旧交付路径。

## 代码落点

- 后端组装：`bun-backend/src/services/cowork-passport.ts`
- 交付包接入：`bun-backend/src/services/cowork-package.ts`
- 交付包核验脚本：`bun-backend/src/services/cowork-passport-verifier.ts`
- REST：`bun-backend/src/routes/cowork.ts`
- 前端卡片：`web/src/components/cowork/TaskPassportCard.tsx`
- 前端本地核验：`web/src/lib/passport.ts`
- 测试：`bun-backend/tests/cowork-passport.test.ts`、`bun-backend/tests/cowork-m4.test.ts`、`bun-backend/tests/cowork-m4-routes.test.ts`、`web/tests/passport.test.ts`
