# MaxmaHere 开发质量诊断（2026-11-17）

> 本文是入库副本（dev_docs/quality-audit-2026-11-17.md），与诊断当时交付的版本内容一致：
> 前八章是诊断结论，第九章是同日修复的执行记录。

- 诊断对象：`D:\Maxma\MaxmaHere`（v2.6.13，分支 `fix/portable-stop-null-guard`，HEAD `f1094714`）
- 诊断日期：2026-11-17
- 诊断方式：只读。所有结论来自本轮实际执行的命令与 CI 日志，未修改任何代码。

---

## 一、结论摘要

整体工程质量**明显高于同类个人项目**：三侧 TypeScript 严格模式零类型逃逸、零空 catch、零 TODO、591 个 catch 全部带处理；后端 291 + 引擎 163 个用例全绿，行覆盖 81.6% / 84.5%；前后端共享契约用"单源 + 双向对账测试"锁死，而不是靠人肉同步。这套纪律是真实存在的，不是文档宣称。

但有 **3 个高优先级问题**，共同特征是"看起来有保护，实际不保护"：

| # | 问题 | 严重度 | 一句话证据 |
|---|---|---|---|
| 1 | CI 的覆盖率门槛是死检查，永远不会红 | **P0** | CI 日志里 `bridge-pi.ts line coverage: 51.15%`，作业仍 success |
| 2 | 前端 26,842 行、28 条路由，**零自动化测试**；补偿脚本不在任何闸门里 | **P0** | `web` 下 0 个 `.test.ts`；`verify-all-gates.sh` 不含 `verify-ui-*` |
| 3 | 根仓库无法在新机器复现 | **P0** | `MaxmaHere` 是 gitlink，但仓库里没有 `.gitmodules` |

### 分维度评分

| 维度 | 评分 | 依据 |
|---|---|---|
| 类型安全 | A | 三侧 `strict`，` : any` / `as any` 实测 0 处；类型债棘轮 0/0 |
| 后端/引擎测试 | A- | 291 + 163 用例全绿；+81.6% / 84.5% 行覆盖 |
| 前端测试 | **D** | 0 个测试文件；纯函数与 WS 状态机全部裸奔 |
| 契约工程 | A | 单一数据源 + 双侧对账（`pi-contract` / `engine-boundary` / `contract-snapshot`） |
| CI 可信度 | **C** | 覆盖率门槛空转；但 tsc/build/gitleaks/打包冒烟是有效的 |
| 静态检查广度 | C+ | 只有 `tsc` + 两个自研样式守卫；**全仓无 ESLint / 无 lint 规则集** |
| 代码可维护性 | B- | 无类型债、命名清晰，但存在 2842 行单文件 / 971 行单函数 |
| 依赖卫生 | C+ | 9 个已安装但零引用的包；4 个预发布版 `@deepseek-ai/dsh-*` |
| 安全 | B+ | 鉴权/加密/CSP/限流/白名单齐备，但缺文件路径层（项目自己已诚实登记） |
| 文档 | A | 索引/交接/契约/ADR 分层，`.gitignore` 每条都写了为什么 |
| 交付可复现性 | **D+** | 根仓库 gitlink 无 `.gitmodules`；子模块指针落后 1 个提交 |

---

## 二、本轮实测基线（可复现）

| 命令 | 结果 | 耗时 |
|---|---|---|
| `cd bun-backend && bun test` | **291 pass / 0 fail**，1905 expect，42 文件 | 30.5s |
| `cd bun-sidecar && bun test` | **163 pass / 0 fail**，706 expect，25 snapshot，18 文件 | 11.2s |
| `cd bun-sidecar && bun test --coverage` | 行 **84.54%** / 函数 **82.58%** | — |
| `cd bun-backend && bun test --coverage` | 行 **81.62%** / 函数 **81.90%** | — |
| `cd web && npx tsc --noEmit` | **0 error** | — |
| `cd web && npx vite build` | **成功**，9.35s | — |
| `node scripts/check-type-budget.mjs` | `bun-sidecar 0` / `bun-backend 0`（持平基线） | — |

静态指标（排除 `node_modules` / `dist` / `tests`）：

| 模块 | 文件 | 行数 | `: any`/`as any` | TODO/FIXME | 空 catch |
|---|---|---|---|---|---|
| `web/src` | 151 | 26,842 | **0** | **0** | **0** |
| `bun-backend/src` | 70 | 15,005 | **0** | **0** | **0** |
| `bun-sidecar/src` | 37 | 6,883 | **0** | **0** | **0** |
| 合计 | 258 | 48,730 | 0 | 0 | 0 |

测试代码量：后端 6,275 行 / 引擎 4,278 行 → 测试与源码比约 42% 与 62%（前端 0%）。

---

## 三、P0 问题详述

### P0-1｜CI 覆盖率门槛是死检查（会发绿灯的死检查）

**位置**：`.github/workflows/sidecar.yml` 的 `Enforce core module coverage threshold (>= 65% lines)` 步骤。

**机制**（`触发条件 → 实际机制 → 症状`）：

1. bun 的覆盖率表列序是 `File | % Funcs | % Lines | Uncovered`，脚本用 `awk -F'|'` 取第 3 列 — 这一列**是对的**（`% Lines`），门槛本意没写错。
2. 但阈值比较写成了 `if [ -z "$COV" ] || [ "$COV" -lt 65 ]`。`COV` 是 `51.15` 这样的**小数**，bash 的 `[ ... -lt ... ]` 只接受整数，会报 `integer expression expected` 并返回退出码 **2**。
3. 在 `if` 条件下，非 0 退出码按"假"处理 → `::error::` 分支永不执行 → `FAIL` 恒为 0 → 最后 `exit 0`。

**证据**：2026-11-14 侧车作业 `43571147741` 的日志原文

```
src/kernel/bridge-pi.ts line coverage: 51.15%
src/kernel/goal.ts       line coverage: 88.89%
...
```

整段日志中**没有出现任何一行 `::error::`**，作业结论是 `success`。也就是说：引擎最大的接缝（`bridge-pi.ts`，1263 行）只有 **51.15%** 行覆盖，而本该拦住它的门槛一次也没拦住。

**影响**：这正好是 HANDOFF 里反复警告的那类问题——"会发绿灯的死检查"。它比没有门槛更危险，因为它会让人相信 65% 是被守住的。

**修法建议**（按最小改动）：

- 用 awk 做浮点比较：`awk -v c="$COV" 'BEGIN{exit !(c<65)}'`，或 `printf "%.0f" "$COV"` 取整后比较。
- 补一条**自测**：故意让某个已知不达标文件进入名单，断言步骤必须红。（"门槛能拦住已知坏值"本身就是可验证的契约。）
- 顺手把 `bridge-pi.ts` 的覆盖补到 65% 以上再开闸，否则闸一修好 main 立刻就红。这条是真债，不是脚本问题。

### P0-2｜前端零自动化测试，补偿机制不在闸门里

**事实**：

- `web/` 下 `.test.ts` / `.test.tsx` / `.spec.ts` **0 个**。2026-11-11 前端重写时 65 个 Vue 测试随组件退役（`HANDOFF.md` 与 `verify-all-gates.sh` 注释均记录），此后没有等价替代。
- 现在守前端的是：`tsc --noEmit`、`vite build`、`check-hardcoded-colors`、`check-spacing`，加上后端侧的跨侧契约测试（`engine-boundary.test.ts` 对账 `web/src` 里的设置键、工具名、事件登记）。
- 真实界面验证脚本有 6 个（`scripts/verify-ui-*.mjs` + Electron driver），质量不低，但 **`verify-all-gates.sh` 不含它们，CI 也不跑**——只能人工触发。

**风险集中点**（都在无测试区）：

| 文件 | 行数 | 为什么危险 |
|---|---|---|
| `web/src/hooks/useChat.ts` | **2,842** | WS 全链路；其中 `handleEventForChannel` 单函数约 **971 行**（1162–2133） |
| `web/src/views/JetHubView.tsx` | 1,112 | 插件管理主界面 |
| `web/src/stores/jetHub.ts` | 1,331 | 与上面成对，状态逻辑无断言 |
| 28 条路由与能力门控 | — | 退化只靠人工逐页点 |

**修法建议**（成本从低到高）：

1. 先把 `useChat.ts` 里的**纯函数**抽出来并导出（`migrateLegacyTurn`、`backendMessagesToTurns`、`reconcileTurnsWithBackend`、`mapLimit`、`findLastThinking` / `findToolCallByCallId` 一族），用 `bun test` 直接覆盖。这些函数不碰 DOM、不碰 WS，是最容易起步的一层，也是最容易回归的一层（历史缺陷如"删除后重发""思考混进正文"都落在这里）。
2. 把 6 个 `verify-ui-*.mjs` 收进 `verify-all-gates.sh`（可标 `--slow`），或至少挂到 nightly。
3. 再考虑给 2–3 个核心视图上组件测试。

### P0-3｜根仓库在新机器上复现不出来

**事实**：

```
$ git ls-tree HEAD
100644 blob 7af09e8f...   .gitignore
160000 commit ed4d472c... MaxmaHere      ← gitlink
```

但 `D:\Maxma\.gitmodules` **不存在**（历史提交 `b1fbb21` 主动删掉了空的 `.gitmodules`）。

**后果**：别人（或半年后的你）`git clone` 根仓库，只会拿到一个**空的 `MaxmaHere` 目录**，且没有任何线索告诉它该从哪个 remote 拉、该检出哪个 commit。整个主项目等于只存在于这台机器上。

**附带问题**：根仓库指针 `ed4d472c`，而子模块 HEAD 是 `f1094714`（在 `fix/portable-stop-null-guard` 分支上领先 `origin/main` 1 个提交，尚未合入）。所以根仓库长期显示 `M MaxmaHere` 的 dirty 状态——这是一个**慢性 dirty**，会掩盖真正的未提交改动。

**修法建议**：二选一，别继续悬着。

- 若保留子模块：恢复 `.gitmodules` 并写清 `path`/`url`，然后在合并 PR 后同步指针。
- 若不要子模块：把 `MaxmaHere` 从根仓库索引移除（`git rm --cached`），根仓库只做"目录说明 + 忽略规则"，并在 `README` 写明主项目独立仓库地址。

---

## 四、P1 问题

**P1-1｜全仓没有 ESLint（26,842 行 React 无 lint）**
- 证据：`web` / `bun-backend` / `bun-sidecar` / `desktop` 的依赖里 `eslint|prettier|biome` 命中数为 0；只有一个孤立的 `web/.prettierrc`（prettier 本身不是依赖）。
- 最具体的缺口：一个 2,842 行的 hook 文件里没有 `react-hooks/exhaustive-deps` 这类规则在兜底。
- 建议：加 ESLint flat config + `typescript-eslint` + `react-hooks` + `no-floating-promises`，先只对**新增/改动文件**开闸（lint-staged），避免一次性面对 4 万行存量。

**P1-2｜巨型文件**
`useChat.ts` 2,842（单函数 971）、`chat-ws.ts` 1,434、`jetHub.ts` 1,331、`bridge-pi.ts` 1,263、`JetHubView.tsx` 1,112、`api/index.ts` 1,096。除 `pi-contract.ts`（契约表，应当大）之外，其余都建议按"纯映射 / 副作用 / 视图"拆层。优先拆 `handleEventForChannel`——它是所有 WS 事件的唯一入口，拆成"每个事件一族一个 reducer"后再谈测试成本才会降下来。

**P1-3｜9 个装了但零引用的依赖**
`@codemirror/commands`、`@codemirror/lang-markdown`、`@codemirror/language`、`@codemirror/state`、`@codemirror/theme-one-dark`、`@codemirror/view`、`codemirror`、`recharts`、`next-themes`。
- `codemirror` 全家在 `web/src` 里 0 命中（源码里只用 `markdown-it`）。
- `recharts` 只在 `solid-glass.css:1017,1075` 的**选择器**里出现（`.recharts-bar-rectangle` 等），JS 侧 0 import——样式表还在为没装的库写规则。
- `next-themes` 只在 `components/ui/sonner.tsx:4` 的一句注释里（"SPA 不使用 next-themes provider"）。
- 建议：删除依赖 + 清掉 `solid-glass.css` 里的 `.recharts-*` 规则。

**P1-4｜预发布依赖与不锁版本**
- `bun-backend` 4 个 `@deepseek-ai/dsh-*` 钉在 `0.1.7-rc.2`（预发布），另有 `dsh-codearts-auth: 1.0.261007`（日期式版本号）。钉死是对的，但用 rc 版本承担运行时职责，升级窗口不可预测。
- `bun-backend/devDependencies` 的 `@types/bun: "latest"` 是唯一没锁的项，锁文件之外会漂。
- 建议：把 `@types/bun` 钉到 `1.3.14`（与 `bun-sidecar` 一致），并把 dsh 系列升到正式版的计划写进 `dev_docs/adr/`。

---

## 五、P2 问题（不影响正确性，但会持续消耗）

1. **生产代码里的 `console.log`**：`web/src/api/index.ts:112,119`（令牌获取路径）；`bun-backend/src/middleware/request-log.ts:77` 每个请求一条 `console.log`。前端已有 `utils/logger.ts`，应统一走它。
2. **分支卫生**：远端 **36** 个分支，本地还有 4 个已合并未删的（`chore/purge-vue-residue`、`feat/steering-floating-window`、`fix/sticker-render-tags`、`fix/sticker-sizing`）。规范里写了 `--squash --delete-branch`，说明流程在某处被执行漏了。
3. **`HANDOFF.md` 47,738 字符单文件**，混装了当前状态、历史复盘、已知缺陷、闸门基线。交接文档越长越没人读；建议按"当前状态 / 历史归档"拆两份，历史部分只保留带日期的结论。
4. **包体积**：`router-CWysWbvm.js` 517.76 kB（gzip 166 kB）、`markdown-vendor` 637.81 kB（gzip 204 kB）、`ChatView` 183.25 kB。首屏 gzip 约 370 kB 起。若在意首屏，`markdown-vendor` 可以按需加载（只在渲染消息时引入）。
5. **未进入门槛名单的低覆盖模块**（CI 的 CORE 名单之外，无人守）：`kernel/subagent.ts` **0%**、`kernel/session-catalog.ts` **11%**、`kernel/session-catalog-rpc.ts` **0%**、`tools/remember-memory.ts` **26%**、`kernel/plugin-models.ts` **50%**。`subagent.ts` 是子任务能力的主实现，0% 覆盖值得单独排期。

---

## 六、值得保留的做法（不要在这些上"省钱"）

1. **契约单源化 + 双侧对账**。`pi-contract.ts` 是"借用引擎名字"的唯一登记处，`engine-boundary.test.ts` 对账事件生产者、设置键、工具清单、两 workspace 的锁，`contract-snapshot.test.ts` 锁我方映射不回归。这类测试的价值远高于覆盖率数字——它防的是"上游改名导致事件静默全丢"。
2. **`.gitignore` 每条都写原因**，包括自己踩过的坑（`*.lock` 曾误吞 `bun-backend/bun.lock`、`data/` 会匹配任意深度同名目录）。这是少见的、真的能防止二次踩坑的写法。
3. **诚实清单**。`docs/security-contract.md` §3 明写"没有路径白名单层，任何文档/UI 都不得宣称默认拒绝"。把缺口写成契约的一部分，比假装没有强得多。
4. **闸门用退出码判定**，`verify-all-gates.sh` 里专门留了注释反省"第一版按输出字符串匹配导致假绿灯"。这个自我纠错机制应该保留。
5. **安全基座完整**：`timingSafeEqualStr` 常时比较、`envelope` 凭据加密、精确 origin 的 CORS、限流、MCP stdio 命令白名单、云元数据地址拒绝、Electron `contextIsolation + sandbox + nodeIntegration:false`、gitleaks 全历史扫描。

---

## 七、建议的执行顺序

| 顺序 | 动作 | 为什么排这里 |
|---|---|---|
| 1 | 修 CI 覆盖率门槛（浮点比较 + 自测） | 半小时成本，立刻让一个假绿灯变真红灯；先修工具，再谈补测试 |
| 2 | 补 `bridge-pi.ts` 覆盖到 65% | 闸修好后必须马上补，否则 main 一直红 |
| 3 | 处理根仓库 gitlink（恢复 `.gitmodules` 或移除） | 决定"这项目还能不能传下去"，越早越便宜 |
| 4 | 抽 `useChat.ts` 纯函数 + 上第一批单测 | 前端测试的唯一切入点，不做这事后面全是人工点 |
| 5 | 加 ESLint（只对新改动文件开闸） | 4 万行存量一次性开闸不现实，增量才是最省的 |
| 6 | 清 9 个未用依赖 + `.recharts-*` 样式 | 一次性、低风险、纯减负 |
| 7 | 拆 `handleEventForChannel` | 体量最大、收益最长远，但要有 4 打底才安全 |

---

## 八、本次诊断的边界（未验证项）

- **没有启动真实服务**：未跑 `start.bat` / 后端 `:8000` / Electron 桌面包，所以"运行时行为"不在本轮结论内。本轮验证的是**编译、单测、覆盖率、构建**四类离线信号。
- **6 个 `verify-ui-*.mjs` 未执行**：它们需要真实后端 + Electron，本轮按只读原则未启动。
- **`build-verify.yml` 的两个打包作业未本地复跑**：只核对了它们的断言内容（产物文件、指针 watermark、禁用用户数据文件、`ChatView` 资产存在），没有本地重建 zip。
- **CI 结论取自 GitHub Actions 历史日志**（最近一次：2026-11-16 `Build Verify` success；2026-11-14 侧车/后端/前端/安全四项 success），不是本轮重跑。
- **覆盖率数字是本机（Windows / Bun 1.3.14）实测**，与 CI（ubuntu）会有 ±2% 级别的浮动——`bridge-pi` 在 CI 是 51.15%、本机 55.30%，两边都低于 65%，不影响该结论。

---

## 九、修复纪要（同日完成，2026-11-17）

> 本节是本报告交付后按"全部 P0 + P1"执行的修复记录。数字全部来自**修复后**的本机实测；
> 代码改动已按 7 个提交推到 `origin/fix/portable-stop-null-guard`（`313947af`），
> 根仓库 `.gitmodules` 推到 `origin/master`（`411a722`）。提交后复跑闸门仍 13 项全绿。

### 闸门终局（`bash scripts/verify-all-gates.sh` → exit 0，13 项全绿）

| 闸门 | 修复前 | 修复后 |
|---|---|---|
| sidecar `bun test` | 163 pass / 18 文件，行覆盖 84.54% | **194 pass / 0 fail / 25 snapshots**，行覆盖 85.42% |
| 核心模块覆盖率门槛 | **恒 exit 0**（小数比整数，`::error::` 永不打印） | 真判据，14 项全 ≥65%，负例实测会红 |
| `bridge-pi.ts` 行覆盖 | 55.30%（CI 51.15%） | **87.34%** |
| web 测试文件 | **0** | 30 用例 / 682 expect |
| web tsc | 0 error（不含测试） | 0 error（**tests 也纳入类型检查**） |
| web ESLint | 无 | 改动文件 0 error（存量不开闸） |
| web build | 通过 | 通过（删 9 个依赖后仍通过） |
| 体量棘轮 | 无 | 10 个 >800 行文件入基线，只准降 |

### P0

1. **COV-PASS-001（覆盖率死检查）**：判据抽成 `scripts/check-core-coverage.sh`，CI 与本地共用。
   awk 数值比较（`+0` 强制，防 `"100.00" < "65"` 字典序）、三条判据自检、名单漂移守卫。
   验证：真实表 → exit 0；`bridge-pi 51.15` → exit 1 + `::error::`；只留 3 行 → exit 1 报"门槛空转"。
2. **bridge-pi 补测**：新增 31 用例（订阅契约 + 全部 RPC 分支）。踩坑：模块级
   `toolStartTimestamps` 会被同进程其它测试文件的同名 `toolCallId` 污染（快照 `elapsed` 0→8），
   新增 id 统一 `cov-` 前缀；三条断言原本写错实现预期（`thinking_level` 回落、`steer` 空串走
   `sendError`、空闲会话无历史），按实测改断言而不是改实现。
3. **前端从 0 到 30**：`useChat.ts` 的纯函数抽到 `web/src/hooks/chatTurns.ts`（2842 → 2645 行），
   call site 零改动；测试覆盖 HISTORY-REFS-001 / THINK-SPLIT-001 / 审批按 callId 归属 /
   `getReconnectDelay` 边界 / `mapLimit` 并发上界与 reject 传播。已接入本地闸门与 `frontend.yml`。
4. **根仓库 gitlink**：补 `.gitmodules`（url + branch=main）+ 根 `README.md`（`--recurse-submodules`）。
   证据：修复前 `git submodule status` → `fatal: no submodule mapping found`；修复后 →
   `+f1094714… MaxmaHere`。指针仍指 `ed4d472c`（= origin/main 尖端，可克隆）；
   本地 HEAD `f1094714` 未合入 main，故行首为 `+`。

### P1

5. **ESLint**（flat config + typescript-eslint `projectService` + react-hooks），
   只查 `base...HEAD ∪ 工作区 ∪ 未跟踪` 里的 `web/src|tests`（`web/scripts/lint-changed.mjs`）。
6. **体量棘轮**（`scripts/check-file-size-budget.mjs` + `dev_docs/file-size-baseline.json`），
   负例实测：基线 2600 vs 实际 2645 → 报"长了 45 行"并 exit 1。
7. **依赖**：删 9 个未用包；`@types/bun`(`bun-backend`) `latest`(→1.4.2) 钉回 `1.3.14`；
   ADR 0007 记录 `@deepseek-ai/dsh-*` 四个 `0.1.7-rc.2` 的钉死理由。
   **连带发现**：`vite.config.ts` 的 `manualChunks.codemirror` 与 `resolve.dedupe` 仍引用这些包，
   删包后构建直接 `Could not resolve entry module "codemirror"`——纯 `src` 引用检查漏掉了构建配置。

### 顺带修掉的两处同类死检查（本轮新发现）

- `scripts/check-type-budget.mjs`：`bun` 不在 PATH 时 `execFileSync` 抛错 → 输出里 0 个 `error TS`
  → 计成 0 错误 → `✓ bun-backend: 0`。本机 PowerShell 实测复现。现在先解析可执行 bun
  （`BUN_BIN` → PATH → `bun-sidecar/bun.exe`），解析不到直接红；退出非 0 且匹配不到错误行 → 报工具故障；
  `--write` 拒绝把"跑不动的检查"写成 0。
- `scripts/verify-all-gates.sh`：`web tsc` 用 `npx`，Git Bash 里找不到 `.cmd` 包装 → 空输出 →
  grep 计数 0 → PASS。现在全部改 `node <入口>` 并按退出码判定。

### 未做 / 未验证

- 已 commit + push，但**主仓改动尚未合入 `main`**；根仓库指针仍是 `ed4d472c`（origin/main 尖端），
  本地 `MaxmaHere` 检出的 `313947af` 与记录指针不一致（`git submodule status` 行首 `+`，属预期）。
- **新克隆已实测**：`git clone --recurse-submodules --depth 1` 成功（80s，子仓检出 `ed4d472c`、33 个文件）。

- ESLint 未对全量存量开闸；`exhaustive-deps` 为 warn（不计入退出码）。
- CI（ubuntu）已复跑：`cd98eb44` 的 8 个作业（push + pull_request 各 4 个）全部 success，
  且覆盖率门槛、前端单测、ESLint、体量棘轮都以**独立步骤**出现过（不是被跳过）。
- 6 个 `verify-ui-*.mjs` 已全部实跑通过：能力页 / 聊天往返 / 设置页 / 会话树 / 扩展确认 / 思考分离，
  六项 `consoleErrors` 均为空。
- `kernel/events.ts` 的模块级 `toolStartTimestamps` 已修：容量上限 512 + FIFO 淘汰，
  回归测试用可控时钟区分新旧实现（去掉上限那段立刻 `Expected 0 / Received 5`）。
