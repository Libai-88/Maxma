---
name: git-workflow
description: Git 工作流——日常提交、分支管理、PR 创建、冲突解决、历史整理的标准操作流程。当用户说"提交代码"、"建分支"、"发 PR"、"解决冲突"时使用。
---

# Git 工作流

Maxma 内置了完整的 git 工具链。这个 skill 规定什么时候用哪个工具、按什么顺序操作，避免误操作丢代码。

## 适用场景

- 日常提交：改完代码要 commit
- 分支管理：建分支 / 切分支 / 合并
- 发 PR：把分支推上去创建 Pull Request
- 冲突解决：merge / rebase 冲突
- 历史整理：交互式 rebase 压缩提交

## 工作流程 A：日常提交（最常用）

```
1. git_status       → 看改了哪些文件
2. git_diff         → 看具体改了什么（staged + unstaged）
3. [可选] git_log   → 看最近提交风格，保持一致
4. git_commit       → 暂存 + 提交（一次只做一个逻辑变更）
5. git_status       → 确认提交成功，工作区干净
```

### 提交信息规范

用 Conventional Commits：

```
<type>(<scope>): <subject>

<body>
```

type 选其一：
- `feat`：新功能
- `fix`：修 bug
- `refactor`：重构（不改行为）
- `docs`：文档
- `test`：测试
- `chore`：杂项（依赖升级、配置）
- `perf`：性能优化
- `style`：格式（不改逻辑）

**示例**：

```
feat(kb): 支持 PDF 文档索引

- 新增 PyPDF2 依赖
- document_loader.py 添加 PDF 加载逻辑
- indexer.py 对 PDF 文本按页分块

Closes #42
```

### 暂存策略

- **不要 `git add -A`**：会把无关文件（.env、临时文件）也加进去
- **按文件 add**：`git_commit` 时明确指定要提交的文件
- **一次只提交一个逻辑变更**：修 bug + 重构 + 改格式应该分 3 次提交
- **敏感文件不提交**：`.env` / `credentials.json` / `*.key` 一律不进版本库

## 工作流程 B：分支管理

### 新建功能分支

```
1. git_status           → 确认工作区干净
2. git_branch create    → 从 main 创建新分支：feat/xxx
3. [开发...]
4. git_commit           → 在新分支上提交
5. git_push             → 推到远程（首次推 -u 设置上游）
```

### 合并分支

```
1. git_status           → 确认工作区干净
2. git_branch switch main → 切回主分支
3. git_branch merge feat/xxx → 合并
4. [如有冲突] → 见工作流程 D
5. git_push             → 推送
6. git_branch delete feat/xxx → 删除本地分支
```

## 工作流程 C：发 PR

```
1. 确认分支已推到远程（git_push）
2. git_pr create        → 创建 PR
   - title：简明描述
   - body：包含 What/Why/How/Test checklist
3. 把 PR 链接给用户
```

PR 模板：

```markdown
## What
[一句话说明做了什么]

## Why
[为什么需要这个变更]

## How
[实现思路，关键决策]

## Test
- [ ] 单元测试通过
- [ ] 手动验证场景 A
- [ ] 手动验证场景 B

## Risk
[可能的影响范围，需要 reviewer 重点关注]
```

## 工作流程 D：冲突解决

```
1. merge/rebase 失败，看到冲突提示
2. git_status           → 看哪些文件冲突（Both modified）
3. git_diff             → 看冲突标记（<<<<<<< ======= >>>>>>>）
4. file_read            → 读冲突文件的完整上下文
5. file_edit            → 手动解决冲突（删掉标记，保留正确内容）
6. git_commit           → 标记已解决并继续 merge
   或 git rebase --continue（如果是 rebase）
```

### 冲突解决原则

- **理解两边意图**：不要无脑选 "ours" 或 "theirs"
- **保留功能**：两边都加的功能要都保留
- **删掉标记**：`<<<<<<<` / `=======` / `>>>>>>>` 必须删干净
- **测试**：解决后跑一遍测试，确认没改坏

## 危险操作清单

以下操作**必须先问用户确认**，不能自动执行：

- `git push --force` / `--force-with-lease`
- `git reset --hard`
- `git checkout .` / `git restore .` / `git clean -f`
- `git branch -D`（强制删未合并分支）
- `git rebase` 已推送的分支
- 任何改写历史的操作

## 注意事项

- **提交前必看 diff**：不要"改完就 commit"，先 `git_diff` 确认改动符合预期。
- **一次一个逻辑**：不要把"修 bug + 加功能 + 改格式"塞进一个 commit。
- **分支名规范**：`feat/xxx` / `fix/xxx` / `refactor/xxx` / `docs/xxx`
- **不要提交大文件**：>1MB 的二进制文件用 LFS 或不进版本库
- **.gitignore 要维护**：发现临时文件混进来就补 .gitignore
- **push 前先 pull**：避免不必要的 merge commit

## 推荐工具组合

| 操作 | 工具 |
|------|------|
| 看状态 | `git_status` |
| 看差异 | `git_diff` |
| 看历史 | `git_log` |
| 提交 | `git_commit` |
| 推送 | `git_push` |
| 分支 | `git_branch` |
| PR | `git_pr` |
| 解决冲突 | `file_read` + `file_edit` |
