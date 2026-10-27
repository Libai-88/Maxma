> ## ⛔ 本文件已废弃（2026-08 基线，勿据以操作）
>
> **本文所有事实基线属于上一代引擎。** 引擎已于 2026-09-30 从 `@oh-my-pi/*`（代号 OMP）整体换成 `@earendil-works/*`（代号 pi）：包名、版本体系、上游仓库、耦合面全变。正文保留仅作**历史演练记录**（§0「类型全绿而运行时炸」这条教训今天仍然有效）。下列条目按 2026-10-27 复验：
>
> | 文中说法 | 今天的事实 |
> |---|---|
> | 适用对象 `@oh-my-pi/pi-coding-agent`（:4） | 现为 `@earendil-works/{pi-coding-agent,pi-agent-core,pi-ai}`，**两处 workspace 各锁一份**：`bun-backend/package.json:16-18`、`bun-sidecar/package.json:11-13` |
> | 基线 16.5.2 / 对照 17.2.12（§0） | 现锁 **0.99.0**（2026-09-29）；上游 latest **1.4.0**（2026-10-21），0.99.0 之后已发 **11 个版本**并跨过 1.0 大版本 |
> | 「minor 带 Breaking，semver 不可信」（§0/:15） | **结论仍成立且已再次应验**：0.99.0 之后的 11 个版本中 **1.0.3 与 1.2.0 自带 `### Breaking Changes`**（源：上游包内 CHANGELOG）。1.0.3 把 Azure provider 由 `azure-openai-responses` 改名 `azure`，直接命中 `bun-sidecar/src/kernel/model.ts:48` 的硬编码白名单；1.2.0 改 `before_agent_start` 与 busy/isIdle 语义，与 Maxma 押 `agent_settled` 作终态判据相邻 |
> | 「已有防御：`omp-compat.ts` 窄接口隔离层」（§0/:26、§5/:140） | **该文件不存在**（全仓 find 零命中）。新架构直 import pi 公开 API；隔离职责改由 `bun-sidecar/src/kernel/` + `kernel/pi-contract.ts`（消费面单源清单）承担 |
> | 「32 处 import」（§0/:21） | 数字作废（2026-10-27 实测）：`bun-sidecar/src` 有 **16** 个文件 import `@earendil-works/*`（集中在 `kernel/` 接缝内），`bun-backend/src` 另有 **4** 个文件绕开 kernel 直接 import（`settings-global.ts`、`plugins/dsh/pi-bridge.ts`、`plugins/dsh/pi-providers.ts`、`plugins/task-brief/index.ts`；行号随改动漂移，此处只记文件名） |
> | 「138 用例」（§0/:33、§3） | 实测 2026-10-27（守卫落地后）：`bun-sidecar` **106 pass / tsc 0 error**、`bun-backend` **236 pass**、`web` **509 pass**，均 0 fail |
> | 「pi-natives 运行时阻断」（§0/:35、§1/:59） | 上下文已消失：两把 `bun.lock` 闭包里**没有 `pi-natives`**（grep 命中 0）。该阻断属 oh-my-pi 17.x，不迁移到当前引擎 |
> | 报 issue 地址 `github.com/can1357/oh-my-pi`（§1/:59） | 现上游为 **`github.com/earendil-works/pi`**（据安装包 `package.json` 的 `repository` 字段，`directory: packages/coding-agent`） |
> | §4 工具 `scripts/upgrade-omp.mjs` | **已删除**（原实测崩溃：`--check` 报「当前锁定: undefined / npm latest: 18.13.1」后抛 `TypeError`；三处致命错误——读旧 scope 依赖键、查的是**仍在发版的旧引擎**、只 bump `bun-sidecar` 一个 workspace）。替代者：**`scripts/upgrade-pi.mjs`**——两个 workspace 一起 bump（含家族包 overrides）、打印 current→target 之间的 `### Breaking Changes`、跑 tsc + 两份守卫测试 + 两侧 `bun test`、复查两把锁是否一致，**任一步失败即非零退出并回滚 package.json** |
> | §4 工具 `scripts/verify-omp-settings.mjs` | **已删除**（原为双重失效**且假通过**：报「找不到 settings-schema.d.ts」却以退出码 0 结束；其检测对象 `const globalPaths = [...]` 已从源码消失）。替代者不是同名脚本：settings 键归属登记在 `pi-contract.ts` 的 `MAXMA_SETTINGS_KEYS`，由 `bun-sidecar/tests/pi-contract.test.ts` 与**已安装引擎**的 `settings-manager.d.ts` 做 `engineReal` 双向差集，面板侧键由 `engine-boundary.test.ts` 校验「面板每个键都已登记、登记为 none 的不许出现在面板上」 |
> | §2「bun.lock 已锁，可复现」（:73） | 原判断**只对 3 个直接包成立**：pi-coding-agent 0.99.0 对家族包声明 `^0.99.0`，实测曾漂出两套版本（backend 的 chord/pi-codemode/pi-mcp/pi-telemetry/pi-tui = 0.99.1，sidecar 同一批 = 0.99.0），且 `bun-backend/bun.lock` 被 `.gitignore` 的 `*.lock` 吞掉未入库（CI 的 `--frozen-lockfile` 无锁可冻）。**现已修**：两处 `package.json` 的 `overrides` 把 8 个 `@earendil-works/*` 钉成同版本、backend 锁收编入库、`engine-boundary.test.ts` 断言「两 workspace 直接依赖同版本 + 两把锁解析版本逐包相等 + 两把锁都被跟踪」 |
>
> **当前有效入口**：策略与风险读 `docs/00-当前架构.md` §2.3 与 `HANDOFF.md`；引擎消费面单一数据源读 `bun-sidecar/src/kernel/pi-contract.ts`；RPC/事件契约读 `docs/contracts/agent-rpc.md`、`docs/contracts/ws-events.md`；升级执行入口 `node scripts/upgrade-pi.mjs --check`。
> ✅ §3「受控升级流程」的三个自动化缺口**已补齐**（2026-10-27）：`.github/workflows/sidecar.yml` 加了 `bun x tsc --noEmit`（引擎边界硬门槛，0 error）并把 `bun install` 改为 `--frozen-lockfile`、同时修正了覆盖率名单（旧 `CORE` 里的 `approval.ts`/`state.ts` 已不存在，真正的接缝 `bridge-pi/plan/goal/pi-session` 从没被守过）；`bun-backend.yml` 加了类型债棘轮 `scripts/check-type-budget.mjs`（sidecar 基线 0、backend 基线 86，只准减）；两 workspace 版本一致性与事件生产者对账由上述两个守卫测试承载。**仍未自动化的是运行时冒烟**——本文件 §0 那条"类型全绿而运行时炸"的教训不因有了 tsc 而失效。

---

# OMP 版本更新方案（对齐颗粒度指南）

> 更新日期：2026-08-10
> 适用对象：MaxmaHere 的 Agent 引擎（@oh-my-pi/pi-coding-agent）
> ⚠️ **以上为历史基线，已不适用于当前引擎**——见文件顶部废弃告示块。


---

## 0. 现状诊断（探索结论）

### OMP 的发布特性（决定对齐策略的关键事实）

| 事实 | 影响 |
|---|---|
| 发布极频繁：**几乎每天发版**（579 个版本，16.4.2→17.2.12 仅 4 天） | 不能盲目跟随 latest |
| **minor 版本就带 Breaking Changes**（16.5.2 移除 read/grep 的 selector 参数） | semver 不严格，minor 升级也需验证 |
| 所有 `@oh-my-pi/*` 包同步版本号（16.5.2 全家桶） | 升级必须 4 个包一起升 |
| npm `latest` = 17.2.12（2026-08-09）；Maxma 锁 16.5.2（07-14） | **已落后一个大版本** |

### Maxma 的耦合面（升级时哪些会受影响）

- **代码导入**：`src/` 共 32 处 `@oh-my-pi/pi-coding-agent` + 2 处 pi-ai + 2 处 pi-catalog
- **敏感子路径**（OMP 内部结构变化即断）：`/mcp`、`/task`、`/extensibility/plugins`、`/config`、`/utils`、`/src`
- **事件映射**：`events.ts` 16 个 case 把 OMP 事件映射为 Maxma 事件（版本敏感）
- **settings 路径**：`session-bridge.ts` globalPaths 读取 30+ 个配置路径（如 `tools.approvalMode`、`compaction.enabled`、`thinkingBudgets.*`）
- **编译打包**：`bun build --compile` 打包 OMP 成单文件 maxma-engine.exe（外部化 fastembed/onnxruntime）
- **已有防御**：`omp-compat.ts` 窄接口隔离层 + 动态 import 兜底 + CI（bun test + 65% 覆盖率门槛）

### 升级演练结果（16.5.2 → 17.2.12，本次实测）

| 验证项 | 结果 |
|---|---|
| `bunx tsc --noEmit` | ✅ 零错误（兼容层生效） |
| `bun test`（138 用例） | ✅ 全过 |
| `bun build --compile` | ✅ 成功（2819 模块） |
| **运行时（bun run 模式）** | ❌ `pi-natives` 原生模块加载失败——OMP 17.x 的 natives 加载器在 bun 缓存布局下误判 workspace 模式，跳过 win32-x64 leaf 包解析（**OMP×bun 兼容缺陷，非 Maxma 代码问题**） |
| **运行时（编译模式）** | ⚠️ 绕过 natives 问题，但会话 prompt 后无事件输出（需进一步调查，疑似 natives 缺失导致能力降级阻塞） |
| settings 路径 | ⚠️ 1 个路径失效（静默跳过）：`tools.discoveryMode`（17.x 调整了工具发现配置） |

**结论：代码层兼容性极好（tsc/测试/编译全过），但 17.x 在 Windows + bun 环境的运行时阻断点需要先解决才能升级。16.x 系列内滚动升级风险很低（且 16.5.2 已是 16.x 最新）。**

---

## 1. 推荐方案：分层升级策略

### 第一层：日常维护（同 minor 内滚动，低风险）

- **节奏**：每 1–2 周检查一次 OMP 新版本（或遇到影响性修复时）
- **动作**：在 16.5.x 系列内 bump（如 16.5.2 → 16.5.5），跑完整验证（见 §3）
- **理由**：16.x 内无大结构变化，tsc + 138 测试 + 冒烟足够覆盖

### 第二层：大版本升级（16 → 17，受控流程）

触发条件（满足其一）：
1. 16.x 系列停止维护（OMP 不再发 16.x 补丁）
2. 17.x 有 Maxma 需要的功能/修复
3. 用户主动要求跟进新特性

前置门槛（升级前必须解决）：
- ⛔ **pi-natives 运行时问题**：向 OMP 仓库（github.com/can1357/oh-my-pi）报 issue 或确认修复版本；或评估 `PI_NATIVE_VARIANT=baseline` / 升级 Bun 版本 / `bun install` 重装 natives 是否可解
- ✅ settings 路径迁移：`globalPaths` 中 4 个失效路径按 17.x modes 子系统迁移

### 第三层：自动化（可选增强）

- **方案 A（推荐）**：`scripts/upgrade-omp.mjs` 一键脚本（已提供，见 §4）
- **方案 B**：GitHub Actions 每周检查 npm latest → 生成升级建议 issue（类似 dependabot，带 CHANGELOG 摘要）

---

## 2. 版本对齐的颗粒度选择

| 策略 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 精确锁定（现状） | 可复现、稳定 | 落后时升级成本累积 | ✅ 保持（bun.lock 已锁） |
| `^` 范围跟随 | 自动拿补丁 | OMP minor 带 breaking，自动升级会炸 | ❌ 不可取 |
| 跟随 latest | 最新功能 | 每天发版 + minor breaking，无法验证 | ❌ 不可取 |
| **精确锁定 + 定期受控升级** | 稳定 + 可控前进 | 需要升级流程 | ✅ **采用** |

---

## 3. 受控升级流程（每次升级执行）

```text
[1] 变更评估
    - 对比 CHANGELOG：npm view @oh-my-pi/pi-coding-agent time / GitHub releases
    - 检查 Breaking Changes 是否触及 Maxma 使用面（事件/session/approval/mcp/tools/settings）

[2] 备份与 bump
    - 备份 package.json + bun.lock
    - package.json 4 个 @oh-my-pi/* 包统一 bump → bun install

[3] 自动验证（脚本自动执行）
    - bunx tsc --noEmit -p .            （类型断裂面）
    - bun test                           （138 用例 + 覆盖率）
    - settings 路径可用性检查            （verify-omp.mjs：globalPaths 全量校验）

[4] 运行时冒烟（真实链路）
    - RPC 冒烟：create_session → prompt → 收到 answer/done（session-bridge 完整链路）
    - 或启动 dev 后端 + 浏览器仿真：聊天/工具调用/审批流/记忆

[5] 构建与交付
    - bun build --compile（sidecar 单文件）
    - 便携版构建 + 冒烟

[6] 回滚兜底
    - git checkout package.json bun.lock && bun install --frozen-lockfile
```

---

## 4. 落地工具

### `scripts/upgrade-omp.mjs`（已提供）

一键完成：检查 npm 最新版 → 展示 CHANGELOG 摘要 → bump 4 个包 → install → tsc → bun test → settings 路径校验 → 输出升级报告。失败即停（不产生半成品状态）。

### `scripts/verify-omp-settings.mjs`（已提供）

独立校验脚本：读取 `session-bridge.ts` 的 globalPaths + 硬编码 settings 路径，对照已安装 OMP 的 settings-schema，输出失效路径清单（升级后运行）。

### 手动验证清单（浏览器仿真，升级后的最终 gate）

- [ ] 发送消息 → 流式回复完整
- [ ] 工具调用（bash/read/write 任一）→ 结果气泡
- [ ] 审批流（权限模式 ask 下写工具弹确认）
- [ ] 记忆（用户说"记住…" → remember_memory 写入）
- [ ] MCP 服务器连接（如有配置）
- [ ] 模型切换 + 思考强度（thinkingLevel）
- [ ] 便携版构建 + 启动冒烟

---

## 5. 风险与缓解

| 风险 | 缓解 |
|---|---|
| OMP minor 带 breaking | 每次升级都跑完整验证；CHANGELOG 前置评估 |
| 17.x natives 运行时问题 | 升级 17.x 前必须解决（报 issue / 变通方案）；16.x 内不受影响 |
| settings 路径漂移 | verify-omp-settings.mjs 自动检测；失效路径静默跳过不崩溃（兼容层设计） |
| 升级后回归 | bun.lock 可复现 + 回滚命令一行；便携版构建作为最终 gate |
| OMP 停止维护 | 耦合面集中在 sidecar 单层，若需替换引擎，omp-compat.ts 是天然隔离点 |

---

## 6. 本次演练的可复用发现

1. **兼容层设计有效**：16→17 跨大版本，tsc 零错误 + 138 测试全过——`omp-compat.ts` 窄接口 + 动态 import 兜底发挥了作用
2. **真正的风险在运行时而非类型**：natives 加载（bun 环境）与 settings 路径漂移是两次升级的共性风险点，升级脚本必须覆盖
3. **升级时机建议**：17.x 运行时问题解决前，停留在 16.x 最新补丁；问题解决后按 §1 第二层流程升级
