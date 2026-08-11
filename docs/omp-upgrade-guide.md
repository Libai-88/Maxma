# OMP 版本更新方案（对齐颗粒度指南）

> 更新日期：2026-08-10
> 适用对象：MaxmaHere 的 Agent 引擎（@oh-my-pi/pi-coding-agent）

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
