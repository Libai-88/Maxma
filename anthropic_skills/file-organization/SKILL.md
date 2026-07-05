---
name: file-organization
description: 文件整理工作流——把混乱的目录（下载/桌面/文档）按规则归类、去重、重命名，让文件系统清爽可检索。当用户说"整理下载文件夹"、"桌面太乱了"、"帮我把这些文件归类"时使用。
---

# 文件整理工作流

把混乱的目录整理成结构清晰、命名规范、无重复的文件系统。**整理前先列计划让用户确认，不要直接动文件**。

## 适用场景

- 用户的下载文件夹 / 桌面堆满了文件
- 用户想给项目目录"大扫除"
- 用户有大量照片 / 文档需要按规则归类

## 工作流程

### 1. 扫描现状

- 用 `ask_user_qa` 确认要整理的目录（绝对路径）
- 用 `file_search` 递归列出所有文件，统计：

```
扫描结果：
  - 总文件数：342
  - 总大小：1.2 GB
  - 按类型：
    - 图片（.jpg/.png）：89 个
    - 文档（.pdf/.docx/.md）：56 个
    - 安装包（.exe/.msi）：23 个
    - 压缩包（.zip/.rar）：15 个
    - 代码（.py/.js/.ts）：12 个
    - 其他：147 个
  - 按时间：
    - 近 7 天：45 个
    - 近 30 天：120 个
    - 半年前：177 个
```

### 2. 制定整理方案

**不要直接动手**，先把方案列给用户确认：

```
## 整理方案

### 目录结构
Download/
├── 文档/           ← .pdf .docx .md .txt
├── 图片/           ← .jpg .png .gif .webp
├── 安装包/         ← .exe .msi .dmg
├── 压缩包/         ← .zip .rar .7z
├── 代码/           ← .py .js .ts .zip(代码相关)
├── 视频/           ← .mp4 .mov .avi
└── 其他/           ← 无法归类的

### 重命名规则
- 去掉广告性前缀："【免费下载】" "高清版_"
- 统一日期前缀：YYYY-MM-DD_原文件名
- 截断过长文件名（>80 字符）

### 去重策略
- 按 MD5 哈希检测完全相同的文件
- 保留最早的一份，删除后续重复
- 列出重复清单让用户确认后再删

### 待确认
1. 是否删除明显可弃的文件？（.tmp、.crdownload、0 字节文件）
2. 半年以上的安装包是否归档到 Archive/？
3. 是否要建立 README.md 说明各目录用途？
```

用 `ask_user_qa` 让用户确认或调整方案。

### 3. 执行整理

用户确认后，用 `run_python` 批量操作：

```python
import os
import shutil
from pathlib import Path
from datetime import datetime

SOURCE = Path(r"D:\Users\<user>\Downloads")
RULES = {
    "文档": [".pdf", ".docx", ".doc", ".md", ".txt", ".xlsx"],
    "图片": [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"],
    "安装包": [".exe", ".msi", ".dmg", ".app"],
    "压缩包": [".zip", ".rar", ".7z", ".tar", ".gz"],
    "视频": [".mp4", ".mov", ".avi", ".mkv"],
    "代码": [".py", ".js", ".ts", ".html", ".css"],
}

def classify(ext):
    for category, exts in RULES.items():
        if ext.lower() in exts:
            return category
    return "其他"

# 1. 创建目录
for cat in RULES.keys() | {"其他"}:
    (SOURCE / cat).mkdir(exist_ok=True)

# 2. 移动文件
moved = 0
for f in SOURCE.iterdir():
    if f.is_file():
        cat = classify(f.suffix)
        target = SOURCE / cat / f.name
        if target.exists():
            # 重名加序号
            target = SOURCE / cat / f"{f.stem}_{moved}{f.suffix}"
        shutil.move(str(f), str(target))
        moved += 1

print(f"已移动 {moved} 个文件")
```

### 4. 去重

```python
import hashlib

def file_md5(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()

# 收集所有文件
all_files = []
for f in SOURCE.rglob("*"):
    if f.is_file():
        all_files.append((file_md5(f), f))

# 按哈希分组
from collections import defaultdict
groups = defaultdict(list)
for md5, path in all_files:
    groups[md5].append(path)

# 列出重复
duplicates = {md5: paths for md5, paths in groups.items() if len(paths) > 1}
print(f"发现 {len(duplicates)} 组重复文件")
for md5, paths in duplicates.items():
    print(f"\nMD5: {md5}")
    for p in paths:
        print(f"  {p}")
```

**重复文件不要自动删**，列出来让用户确认保留哪份。

### 5. 生成整理报告

```markdown
# 整理报告：{目录路径}

## 整理前
- 文件数：342
- 大小：1.2 GB
- 重复文件：12 组

## 整理后
- 文件数：330（删了 12 个重复）
- 大小：987 MB
- 目录结构：
  - 文档/：56 个
  - 图片/：89 个
  - ……

## 重命名
- 共重命名 23 个文件（去掉广告前缀 / 加日期）

## 待用户处理
- 12 组重复文件，请确认保留哪份
- 5 个 .tmp 文件建议删除
```

## 注意事项

- **先列方案再动手**：整理是不可逆操作（尤其删除），必须让用户确认。
- **不要碰系统目录**：`C:\Windows` / `C:\Program Files` 一律不动。
- **不要碰 .git 目录**：版本库内部文件不能移动。
- **大文件谨慎移动**：>500MB 的文件移动慢，考虑用快捷方式。
- **保留原路径记录**：整理前用 `file_write` 生成一份原始文件清单，万一要恢复。
- **中文文件名**：Windows 中文文件名可能乱码，用 `pathlib.Path` 处理更稳。
- **不要删除用户没确认的文件**：哪怕是 .tmp，也要问一下。

## 常见整理场景

| 场景 | 策略 |
|------|------|
| 下载文件夹 | 按类型归类，半年以上的移到 Archive/ |
| 桌面 | 按项目归类，临时文件移到 Temp/ |
| 照片 | 按"年/月"分目录，按 EXIF 日期重命名 |
| 项目目录 | 按 src/docs/tests/dist 归类，删 node_modules/.venv |
| 文档库 | 按主题归类，统一日期前缀 |

## 推荐工具组合

| 阶段 | 主用工具 |
|------|---------|
| 扫描 | `file_search`（递归列表） |
| 确认方案 | `ask_user_qa` |
| 批量移动 | `run_python`（shutil） |
| 去重 | `run_python`（hashlib） |
| 报告 | `file_write` |
