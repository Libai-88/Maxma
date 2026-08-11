# Maxma OMP 升级执行手册（Runbook）

> **给无上下文 Agent 的自包含操作手册**：阅读本文即可独立辅助完成 OMP 升级。
> 配套方案文档：`docs/omp-upgrade-guide.md`（策略与风险评估，本手册直接可执行）。
>
> 更新日期：2026-08-11

---

## 0. 当前基线（本次确认的状态）

| 项 | 值 |
|---|---|
| Maxma 锁定的 OMP 版本 | **16.5.2**（稳定版，`bun-sidecar/package.json` 4 个 `@oh-my-pi/*` 包 + `bun.lock`） |
| npm 上 OMP latest | 17.2.12（2026-08-09）——**当前不升级** |
| 代码 git 状态 | 干净（`git status` 无输出） |
| 测试基线 | `bun test` 138 全过 · `bunx tsc --noEmit` 零错误 · `pytest` 1620 全过 |
| 便携版 | `D:\Maxma\MaxmaHere-Portable` 为稳定版构建（见 §6） |

**重要约束：**
- OMP **几乎每天发版**（579 个版本），且 **minor 版本就带 Breaking Changes**（如 16.5.2 移除 read/grep 的 selector 参数）。
- 因此：**绝不盲目跟随 latest，绝不使用 `^` 范围依赖**。升级必须走本手册流程。
- 16.5.2 已是 16.x 系列最新版；**继续跟进 OMP 意味着面对 17.x**。

---

## 1. 升级前置知识（必须了解）

### 1.1 Maxma 与 OMP 的耦合面（升级时检查这些）

| 耦合点 | 位置 | 升级影响 |
|---|---|---|
| OMP 依赖声明 | `bun-sidecar/package.json`（4 个包必须同版本） | 一起 bump |
| 锁文件 | `bun-sidecar/bun.lock` | `bun install` 更新 |
| 主 API 导入（32 处） | `bun-sidecar/src/*.ts` 的 `@oh-my-pi/pi-coding-agent` | 类型检查可发现断裂 |
| 敏感子路径 | `/mcp`、`/task`、`/extensibility/plugins`、`/config`、`/utils` | OMP 内部结构变化即断 |
| 事件映射 | `bun-sidecar/src/events.ts`（16 个 case） | 新增/改名事件需适配 |
| settings 路径 | `bun-sidecar/src/session-bridge.ts` 的 `globalPaths`（30+ 路径） | 用 `verify-omp-settings.mjs` 检测 |
| 编译打包 | `bun build --compile`（sidecar 单文件） | 每次升级后必须重新编译验证 |
| 兼容层 | `bun-sidecar/src/omp-compat.ts`（窄接口 + 动态 import 兜底） | **已有防御**，升级主要靠它 |

### 1.2 已知坑点（16.5.2 → 17.x 实测）

1. **pi-natives 运行时加载失败（阻断级）**：OMP 17.x 的 `@oh-my-pi/pi-natives` 加载器在 **bun 缓存布局**（`node_modules/@oh-my-pi/pi-natives@17.2.12@@@1/`）下误判 workspace 模式，跳过 win32-x64 leaf 包解析 → `Failed to load pi_natives native addon`。
   - 影响：`bun run` 开发模式直接报错；**编译模式（生产）可绕过**，但会话 prompt 后无事件输出（疑似 natives 缺失导致能力降级阻塞，需进一步调查）。
   - **升级 17.x 前必须解决**：向 `github.com/can1357/oh-my-pi` 报 issue / 等修复 / 评估 `PI_NATIVE_VARIANT=baseline`、升级 Bun 版本。
2. **settings 路径漂移**：17.2.12 下 `tools.discoveryMode` 失效（静默跳过，不崩溃但配置不生效）。升级后用 `verify-omp-settings.mjs` 检测并迁移。
3. **CHANGELOG 必读**：每个版本升级前看 `node_modules/@oh-my-pi/pi-coding-agent/CHANGELOG.md`（安装后）或 GitHub releases，重点看 **Breaking Changes** 是否触及 §1.1 的耦合面。

---

## 2. 升级决策（先判断该不该升）

```bash
cd D:\Maxma\MaxmaHere
bun run scripts/upgrade-omp.mjs --check   # 只检查，不改动
```

输出会告诉你：当前版本 / npm latest / 是否跨大版本 / CHANGELOG 摘要。

**决策规则：**
- 同 major 内（16.5.x → 16.5.y）：低风险，走 §3 完整流程。
- 跨大版本（16 → 17）：**必须满足任一触发条件**——16.x 停止维护 / 17.x 有 Maxma 需要的能力 / 用户明确要求；且 **pi-natives 问题（§1.2-1）已解决**。
- 否则：不升级，保持现状。

---

## 3. 受控升级流程（核心步骤）

### 步骤 0：备份

```bash
cd D:\Maxma\MaxmaHere\bun-sidecar
cp package.json /tmp/package.json.bak
cp bun.lock /tmp/bun.lock.bak
```

### 步骤 1：bump 版本

```bash
# 手动方式（或用升级脚本自动完成）
python -c "
import json
p = json.load(open('package.json', encoding='utf-8'))
for k in list(p['dependencies']):
    if k.startswith('@oh-my-pi/'):
        p['dependencies'][k] = '17.2.12'   # 替换为目标版本
json.dump(p, open('package.json', 'w', encoding='utf-8'), indent=2, ensure_ascii=False)
"
bun install
```

> 或一键执行（自动完成步骤 0-5 + 失败回滚）：
> ```bash
> cd D:\Maxma\MaxmaHere
> bun run scripts/upgrade-omp.mjs <目标版本>   # 例：bun run scripts/upgrade-omp.mjs 17.2.12
> # 跨大版本时会要求输入 y 确认（这是防误操作门槛，正常）
> ```

### 步骤 2：类型检查（API 断裂面）

```bash
cd D:\Maxma\MaxmaHere\bun-sidecar
bun x tsc --noEmit -p .
# 零输出 = 通过。有错误 = OMP API 变了，需要适配 src/ 下的代码
```

### 步骤 3：单元测试

```bash
bun test
# 期望 138 pass / 0 fail
```

### 步骤 4：settings 路径漂移检测

```bash
cd D:\Maxma\MaxmaHere
bun run scripts/verify-omp-settings.mjs
# "全部 settings 路径有效 ✅" = 通过
# "MISSING xxx" = 该路径在新版失效，需在 session-bridge.ts 的 globalPaths 迁移
```

### 步骤 5：运行时冒烟（最关键，类型/测试过不代表运行时可用）

**方法 A — RPC 冒烟**（起真实 sidecar 会话）：

```bash
cd D:\Maxma\MaxmaHere\bun-sidecar
# 编写并运行 rpc-smoke 脚本（create_session → prompt → 期望收到 answer/done 事件）
# 注意：直接用 bun run 会触发 §1.2-1 的 natives 问题（17.x 下会失败，这是已知坑点）
```

**方法 B — 完整链路**（推荐，与生产一致）：

```bash
cd D:\Maxma\MaxmaHere
.venv/Scripts/python.exe -m uvicorn api.server:create_app --host 127.0.0.1 --port 8000 --log-level warning
# 另开终端启动 Vite：cd web && npx vite
# 浏览器打开 http://127.0.0.1:5173 验证：
#   □ 发送消息 → 流式回复完整
#   □ 工具调用（bash/read/write 任一）→ 结果气泡
#   □ 审批流（权限模式 ask 下写工具弹确认）
#   □ 记忆（"记住 XXX" → remember_memory 写入）
#   □ 模型切换 + 思考强度（thinkingLevel 6 档）
```

### 步骤 6：编译验证（sidecar 单文件）

```bash
cd D:\Maxma\MaxmaHere\bun-sidecar
bun run build-compiled.mjs    # 产出 desktop/src-tauri/resources/runtime/maxma-engine.exe
```

### 步骤 7：便携版构建（最终 gate）

```bash
cd D:\Maxma\MaxmaHere
# 先确保 8000/5173 端口无进程（smoke test 需要）
cmd //c build-portable.bat
# 期望 EXIT 0 + "[VERIFY] All critical files present"
```

### 步骤 8：提交

```bash
cd D:\Maxma\MaxmaHere
git add bun-sidecar/package.json bun-sidecar/bun.lock <必要的代码适配>
git commit -m "chore(omp): 升级 OMP 到 <版本> — <适配说明>"
cd D:\Maxma
git add MaxmaHere && git commit -m "chore: 更新 MaxmaHere 子模块 — OMP <版本>"
```

---

## 4. 回滚（升级失败/回归时）

```bash
cd D:\Maxma\MaxmaHere\bun-sidecar
cp /tmp/package.json.bak package.json
cp /tmp/bun.lock.bak bun.lock
bun install
bun x tsc --noEmit -p . && bun test    # 确认回到稳定态
```

> 升级脚本（upgrade-omp.mjs）内置自动回滚：任一步失败即恢复备份并 `bun install`。

---

## 5. 升级工具说明

| 工具 | 用法 | 作用 |
|---|---|---|
| `scripts/upgrade-omp.mjs` | `bun run scripts/upgrade-omp.mjs [版本]` / `--check` | 一键：检查 latest → CHANGELOG 摘要 → 备份 → bump 4 包 → install → tsc（带重试）→ bun test → settings 校验 → 失败自动回滚 |
| `scripts/verify-omp-settings.mjs` | `bun run scripts/verify-omp-settings.mjs` | 对照已装 OMP 的 settings-schema，检测 Maxma 使用的 settings 路径是否有效 |

> 注意：upgrade-omp.mjs 的 tsc 步骤在 bun install 后偶发时序失败，脚本内置 2 次重试；仍失败则视为 API 断裂并回滚。

---

## 6. 便携版（MaxmaHere-Portable）说明

- 位置：`D:\Maxma\MaxmaHere-Portable`（构建脚本自动重建，输出 `maxma-here.exe` + `maxma-server.exe` + `_internal` + `resources/runtime/maxma-engine.exe`）
- **当前便携版 = 稳定版**（构建于 2026-08-11 19:04，当时代码为 a8386c91 = 全部稳定版修复完成时刻，OMP 16.5.2；OMP 升级演练发生在构建之后，未污染便携版）
- **升级 OMP 后必须重建便携版**（步骤 7），否则便携版仍是旧 OMP
- 验证便携版健康：启动后 `curl http://127.0.0.1:8000/api/health` 应返回 `status: ok` + 31 个工具
- 数据隔离：便携版用户数据在 `MaxmaHere-Portable/data/`，重建不影响（构建脚本保留 data/）

---

## 7. 常见问题速查

| 症状 | 原因 | 处理 |
|---|---|---|
| `Failed to load pi_natives native addon`（bun run 模式） | §1.2-1 OMP 17.x × bun 兼容缺陷 | 先解决 natives 问题再升级；16.x 不受影响 |
| tsc 报错指向 `@oh-my-pi/...` 类型 | OMP API 变更 | 按报错适配 src/ 代码（omp-compat.ts 是首选修改点） |
| verify-omp-settings 报 MISSING | settings 路径改名/移除 | 在 session-bridge.ts globalPaths 迁移到新路径 |
| bun test 失败 | 事件映射/行为变更 | 检查 events.ts 映射 + CHANGELOG |
| 便携版构建时 rmdir 失败 | 残留 maxma-here.exe 进程锁文件 | `taskkill //IM maxma-here.exe //F` 后重试 |
| 便携版构建 smoke test 端口冲突 | dev 后端占用 8000 | 先停 dev 进程（`taskkill //PID <pid> //F`） |
| 升级后聊天无回复 | 运行时冒烟（步骤 5）未过 | **不要提交**，按 §4 回滚 |
