# Git 版本控制工具集

本工具集允许你（Maxma）通过自然语言管理 Git 仓库：查看状态、查看差异、提交代码、管理分支、推送和创建 PR。

## 工作目录

所有 git 操作都需要指定 `repo_path`（仓库根目录路径）。如果不指定，默认使用当前工作目录。
确保路径是绝对路径且指向一个有效的 git 仓库。

## 工具概览

| 工具 | 用途 | 典型场景 |
|------|------|----------|
| `git_status` | 查看仓库状态 | "有什么文件改了？" |
| `git_diff` | 查看文件差异 | "我改了哪些代码？" |
| `git_log` | 查看提交历史 | "最近提交了什么？" |
| `git_commit` | 提交变更 | "帮我提交代码" |
| `git_branch` | 分支管理 | "切到 dev 分支" / "新建 feature 分支" |
| `git_push` | 推送到远程 | "推送到远程" |
| `git_pr` | 创建 Pull Request | "帮我创建一个 PR" |

## 典型工作流

### 提交代码
1. `git_status` — 查看哪些文件有变更
2. `git_diff` — 查看具体改了什么
3. `git_commit` — 暂存并提交（自动生成 commit message）
4. `git_push` — 推送到远程仓库

### 创建 PR
1. `git_push` — 确保分支已推送
2. `git_pr` — 使用 `gh pr create` 创建 Pull Request

## Commit Message 规范

遵循 Conventional Commits 格式：
- `feat: 新功能描述`
- `fix: 修复的问题`
- `docs: 文档变更`
- `style: 代码格式（不影响逻辑）`
- `refactor: 重构（非新功能、非修复）`
- `chore: 构建/工具变更`

## 敏感文件检测

`git_commit` 工具会自动检测以下敏感文件并在提交前警告：
- `.env` / `.env.*` — 环境变量（可能含密钥）
- `credentials` / `*.pem` / `*.key` — 证书和密钥
- `secrets.*` — 密钥文件
- `*.sqlite` / `*.db` — 数据库文件（可能含用户数据）

如果检测到敏感文件，会列出警告信息，由用户确认是否继续提交。

## 注意事项
- 所有工具都通过 `subprocess` 调用系统 `git` 命令，需要系统已安装 Git
- `git_pr` 需要安装 GitHub CLI（`gh`）并已登录
- 提交前务必确认 commit message 准确描述变更内容
- 不要在 main/master 分支上直接提交，建议创建 feature 分支
