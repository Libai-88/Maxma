# Git 提交与分支命名规范

## 一、Commit Message 规范

采用 **Conventional Commits** 格式：

```
<type>(<scope>): <subject>

<body>

<footer>
```

### 1.1 Type（必填）

| Type       | 说明                                       |
| ---------- | ------------------------------------------ |
| `feat`     | 新功能                                     |
| `fix`      | 修复 bug                                   |
| `docs`     | 仅文档变更                                 |
| `style`    | 代码格式调整（不影响逻辑，如空格、分号等） |
| `refactor` | 重构（既非新功能也非修 bug）               |
| `perf`     | 性能优化                                   |
| `test`     | 添加或修改测试                             |
| `chore`    | 构建、依赖、工具等杂项                     |
| `ci`       | CI/CD 配置变更                             |
| `revert`   | 回滚某次提交                               |

### 1.2 Scope（选填）

英文小写，取实际模块名：`backend`、`sidecar`、`engine`、`zen`、`persona`、`desktop`、
`build`、`ui`、`web`、`tests`、`docs`。

### 1.3 Subject（必填）

- 使用祈使句
- 不加句号
- 不超过 72 个字符
- 用中文

### 1.4 Body（选填）

- 描述 **为什么** 做这个改动，而非做了什么
- 每行不超过 72 字符

### 1.5 Footer（选填）

- 关联 issue：`Closes #123`、`Refs #456`
- Breaking Change：以 `BREAKING CHANGE:` 开头

### 1.6 示例

```
feat(engine): 接入会话级目标模式

Closes #42
```

```
fix(zen): 免费渠道全部候选失败时回放终态帧

此前丢弃所有帧后直接结束流，前端只收到握手帧然后卡到超时，
零报错、无从判断原因。

Refs #58
```

```
chore(build): 把 bun-backend/bun.lock 收编入库
```

```
refactor(settings)!: 设置键改为从登记表取全集

BREAKING CHANGE: consumer="none" 的键 PUT 返回 409，
不再静默接受。
```

> 本仓**没有** commit-msg 钩子或 conventional-commit lint，规范靠人遵守；
> 闸门脚本只查 lint、类型债、硬编码色与测试。

---

## 二、分支命名规范

### 2.1 分支类型前缀

| 前缀        | 用途                     | 示例                        |
| ----------- | ------------------------ | --------------------------- |
| `feat/`     | 新功能开发               | `feat/jet-hub-plugin`       |
| `fix/`      | Bug 修复                 | `fix/bridge-contract`       |
| `hotfix/`   | 生产环境紧急修复         | `hotfix/auth-token-leak`    |
| `refactor/` | 重构                     | `refactor/session-manager`  |
| `perf/`     | 性能优化                 | `perf/ws-backpressure`      |
| `docs/`     | 文档                     | `docs/security-contract`    |
| `chore/`    | 杂项（依赖、工具等）     | `chore/pin-engine-deps`     |
| `test/`     | 测试                     | `test/engine-boundary`      |
| `exp/`      | 实验性分支（可能不合并） | `exp/kep`                   |
| `release/`  | 发布分支                 | `release/v2.7.0`            |

### 2.2 命名规则

- 全小写，单词间用 `-`（短横线）连接
- 简短且语义清晰，控制在 3~5 个单词以内
- 分支名总长度建议不超过 50 字符

### 2.3 示例

```
feat/jet-hub-plugin
fix/persona-first-run-404
test/engine-boundary
chore/pin-engine-deps
release/v2.6.11
```

---

## 三、分支工作流

采用简化版 **Trunk-Based Development**：

```
main
  └── feat/xxx        # 功能分支，从 main 切出，完成后合并回 main
  └── fix/xxx         # 修复分支，同上
  └── hotfix/xxx      # 紧急修复，从 main 切出，合并回 main
  └── release/x.x.x   # 发布分支（仅发布前创建，打 tag 后合并）
```

### 3.1 基本规则

1. `main` 始终保持可发布状态
2. 所有变更走分支 + PR 合并进 `main`
3. 合并前先 rebase 到最新 `main`（保持历史线性）
4. 合并用 `gh pr merge --squash --delete-branch`（本仓实际流程，见
   `scripts/git-pr-flow.sh`）；长期试验分支不加 `--delete-branch`
5. 发布时在 `main` 上打 tag：`v<major>.<minor>.<patch>`

### 3.2 Tag 规范

```
v1.0.0          # 正式发布
v1.0.0-rc1      # 候选发布
v1.0.0-alpha1   # Alpha 预览
```

---

## 四、检查清单

提交前确认：

- [ ] Commit message 符合 Conventional Commits 格式
- [ ] 分支名符合命名规范
- [ ] 代码已自测，无明显的 lint 错误
- [ ] 未包含敏感信息（密钥、token、密码等）
- [ ] 相关测试已更新
