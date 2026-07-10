# MaxmaHere 交接文档

## 任务背景

用户的目标是对自研 Agent 项目 `D:\Maxma\MaxmaHere` 做专业工程评审，并按评审结论持续优化。工作已从“评审发现问题”推进到两轮高优先级修复与长期记忆可靠性建设。

当前没有正在进行的实现任务。下一位接手者应先盘点现有工作区改动，再决定下一项优化；不要假设工作区干净。

## 已完成工作

### 第一轮：安全、兼容性与工程基线

- 路径安全：修复 `tools/path_security.py` 的符号链接 / Windows junction（reparse point）逃逸风险。访问前应按真实路径校验，创建新文件时还需校验其父目录。
- Python 与测试基线：修复 `agent/autonomy/runner.py` 中 Python 3.11 不支持的 f-string 语法；将会遮蔽标准库的本地 `platform` 包迁移为 `maxma_platform`，并扩展 `.github/workflows/pytest.yml` 覆盖 Python 3.11、3.13 与编译/关键静态检查。
- API：`api/middleware/rate_limit.py` 的限流豁免收窄到 `GET` / `HEAD`，写操作重新受保护。
- 聊天上下文：`agent/runtime_context.py` 对 Provider/MCP 配置文字施加数量、单项长度、总量限制，并清洗控制字符和结构分隔符，降低提示词污染与成本失控风险。

### 第二轮：Agent 运行闭环与记忆一致性

- 委派：新增 `tools/sub_agent/delegation_context.py`。子 Agent 会继承父轮已选定的 Provider、模型、工具/路径权限、预算和审批策略；后台任务也走 Provider 故障转移，且不会因父会话后来打开自动审批而被提权。
- Provider 故障转移：`agent/graph.py` 在切换至备用 Provider 后，工具调用后的续答会继续使用备用 Provider，避免跳回已失败的 Provider。
- 记忆投影：`memory/episodic.py` 默认按 session 隔离；失败或取消的模型轮次不再投影到情景/长期记忆。`memory/narrative.py` 按 `(session_id, turn_id)` 持久去重，失败可重试而不会正常重复写入。

### 第三部分：长期记忆事务 outbox

为解决“完成账本无限增长”和“外部 YAML 写入后任务状态未完成导致重试语义重复”的问题，实现了：

- `memory/ltm_outbox.py`：SQLite 事务 outbox、租约、失败退避、取消后的即时重排、持久去重。
- 完成记录按数量/时间保留并压缩归档，且不会删除 `pending` / `claimed` 工作项。
- `memory/narrative.py`：YAML 原子落盘、目标级单写者租约、fencing token。旧 worker 即使失租或被取消，也不能覆盖新 owner 的 YAML、完成任务或影响新 owner。
- 受控 YAML 操作在“YAML 已成功写入、但 outbox 尚未标记完成”后重放时不会重复应用。

关键路径：

- `memory/ltm_outbox.py`
- `memory/memory_manager.py`
- `memory/narrative.py`
- `memory/episodic.py`
- `agent/graph.py`
- `tools/sub_agent/delegation_context.py`

## 已创建提交

唯一由本轮工作创建的提交是：

`0d2764d feat(memory): add durable transactional LTM outbox`

该提交严格只包含以下 5 个文件，不包含任何其他工作区变更：

- `memory/ltm_outbox.py`
- `memory/memory_manager.py`
- `memory/narrative.py`
- `tests/test_memory/test_ltm_outbox.py`
- `tests/test_memory/test_narrative.py`

该提交仅在本地，未推送远端。

## 验证证据

此前两轮完整/关键验证结果：

- 第一轮：后端全量测试 `1255 passed, 9 skipped`；Python 3.11 编译、前端类型检查、关键静态检查和差异格式检查通过。
- 第二轮：后端全量测试 `1288 passed, 9 skipped`；Python 编译、前端类型检查和差异格式检查通过。
- 长期记忆提交：格式化、Ruff、编译、差异检查通过；outbox 测试 17 项及关键 narrative 测试 3 项通过。

注意：在该 Windows 环境中，直接运行某些“全量 `pytest -q`”命令会长时间无输出并超时。验证时曾以按模块/目录分组的方式替代，分组结果通过。下次运行测试时应先使用带进度或超时的命令定位慢组，不能把“无输出超时”简单报告成测试失败，也不要无限等待。

## 工作区状态与提交纪律

工作区仍有大量早于上述提交的既有改动、未跟踪源码和构建产物，它们**不属于** `0d2764d`。此外，`maxma_platform` 重命名相关有 3 个无关的已暂存文件。

因此：

- 不得执行 `git add -A`、`git commit -a` 或任何会把全部暂存区带入提交的命令。
- 新提交必须先审查 `git status` 与 `git diff --cached`，并使用 `git commit --only <精确文件路径...>` 保证提交边界。
- 不要回滚或清理不属于当前任务的改动；先确认其归属和用途。
- 前端 `pnpm` 类型检查曾生成未跟踪文件；运行后必须复查 `git status`，不要误提交生成物。

## 建议的下一步

1. 盘点 `git status`、未跟踪文件与暂存区，将每项归属为用户历史改动、已完成但未提交的修复、生成物或待删除物；在未确认前不批量暂存。
2. 解决全仓 Ruff 遗留问题，并为 API 慢测试建立可见进度、分组或超时诊断，稳定 CI 的全量基线。
3. 在已有 session 隔离与 outbox 基础上，评审下一代“结构化记忆投影”设计：明确事件 schema、幂等键、投影版本、重放/迁移策略及可观测性，再实施。不要直接扩充自由文本记忆逻辑。

## 绝对不要再踩的坑

- Windows 上 SQLite 连接不能只依赖 `with sqlite3.connect(...)`：异常/提前返回路径必须确认连接实际 `close()`，否则会保留文件锁并让后续测试或 worker 卡住。
- 外部 YAML/文件写入是跨系统副作用，不等于跨 SQLite + 文件系统的 ACID 事务；必须通过 outbox、幂等操作和重放语义处理崩溃窗口。
- 仅有 lease 不足以保证正确性：没有 fencing token 的旧 owner 可在租约失效后继续写入，覆盖新 owner 的结果。
- `asyncio.CancelledError` 不应假设会被 `except Exception` 捕获；取消路径必须显式处理并安全释放/重排工作。
- 禁止直接覆盖 YAML：使用原子临时文件替换，并在并发写入下配合目标级单写者控制。
- 不要忽略无 `turn_id` 的旧调用路径：需要保留明确的 legacy 兼容行为，并防止它与新幂等键语义冲突。
- 全量 `pytest -q` 在本环境无输出挂起时，改用带进度的分组执行来定位；不要无限等待或据此误判全部测试失败。
- `pnpm` 类型检查可能产生未跟踪文件，验证后必须检查工作区。
- 提交必须用 `git commit --only` 和精确路径；绝不能 `git add -A`，尤其是在这个长期脏工作区中。
