---
name: data-analysis
description: 数据分析工作流——对 CSV/JSON/Excel 数据做探索性分析：清洗、统计、可视化、洞察提炼。当用户说"分析这份数据"、"看看这个 CSV"、"帮我做数据分析"时使用。
---

# 数据分析工作流

对用户提供的数据文件做完整的探索性分析（EDA），输出统计摘要、可视化图表和业务洞察。

## 适用场景

- 用户给一个 CSV / JSON / Excel 文件，说"分析一下"
- 用户想从数据里发现规律 / 异常 / 趋势
- 用户需要做一份简单的数据报告

## 工作流程

### 1. 加载数据

- 用 `ask_user_qa` 确认文件路径（绝对路径）
- 用 `run_python` 加载数据：

```python
import pandas as pd
df = pd.read_csv(r"<path>")  # 或 read_json / read_excel
print(f"行数: {len(df)}, 列数: {len(df.columns)}")
print(df.dtypes)
print(df.head(10))
```

- 如果文件很大（>100MB），先采样：

```python
df = pd.read_csv(r"<path>", nrows=10000)  # 先看前 1 万行
```

### 2. 数据质量检查

```python
# 缺失值
print(df.isnull().sum())
# 重复行
print(f"重复行: {df.duplicated().sum()}")
# 唯一值
for col in df.columns:
    print(f"{col}: {df[col].nunique()} 唯一值")
```

把发现的问题列给用户：
- 哪些列缺失严重（>30%）？
- 有没有异常类型（数字列变成 object）？
- 有没有完全重复的行？

### 3. 统计摘要

```python
# 数值列
print(df.describe())
# 分类列
for col in df.select_dtypes(include=['object']).columns:
    print(f"\n{col}:")
    print(df[col].value_counts().head(10))
```

### 4. 可视化（关键洞察）

用 matplotlib / seaborn 画图，**每张图回答一个问题**：

```python
import matplotlib.pyplot as plt
import seaborn as sns

# 问题 1：各分布如何？
fig, axes = plt.subplots(2, 2, figsize=(12, 8))
df.hist(bins=30, ax=axes.flatten())
plt.tight_layout()
plt.savefig(r"D:\...\analysis_dist.png", dpi=100)
plt.close()

# 问题 2：相关性如何？
plt.figure(figsize=(10, 8))
sns.heatmap(df.corr(numeric_only=True), annot=True, cmap="coolwarm")
plt.title("Correlation Matrix")
plt.savefig(r"D:\...\analysis_corr.png", dpi=100)
plt.close()
```

把图保存到磁盘，把路径告诉用户。

### 5. 洞察提炼

不要只列统计数字，要提炼**可执行的洞察**：

```
## 数据洞察

1. 【数据质量】X 列缺失 45%，建议：删除 / 填充 / 标记
2. 【分布】销售额右偏严重，80% 的订单 < 100 元，但有少数 > 10000 的异常大单
3. 【相关性】价格与销量负相关 (-0.62)，降价可能提升销量
4. 【分组】A 组用户的复购率 (35%) 显著高于 B 组 (12%)
5. 【趋势】近 3 个月月活持续下降，从 10k → 7k
```

### 6. 输出报告

用 `file_write` 生成 Markdown 报告：

```markdown
# 数据分析报告：{文件名}

## 1. 数据概览
- 行数 / 列数 / 时间范围
- 数据质量评估

## 2. 统计摘要
[表格]

## 3. 可视化
![分布](analysis_dist.png)
![相关性](analysis_corr.png)

## 4. 洞察
[列表]

## 5. 建议
[基于洞察的可执行建议]
```

## 注意事项

- **先看数据再分析**：不要假设数据结构，先 `df.head()` + `df.dtypes`。
- **缺失值不要直接删**：先分析缺失原因（随机缺失 vs 系统性缺失），再决定策略。
- **相关性 ≠ 因果**：报告里必须标注"相关不等于因果"。
- **图表要有标题和坐标轴标签**：裸图无法理解。
- **大数据集要采样**：>10 万行时先采样做 EDA，全量分析留到最后。
- **不要输出原始数据到对话**：数据可能很大，用 `file_write` 落盘，对话里只放摘要。
- **保密**：数据可能含敏感信息（手机号 / 身份证），统计摘要里要脱敏。

## 常见分析模板

| 需求 | 分析方法 |
|------|---------|
| 用户分群 | RFM 分析 / K-means 聚类 |
| 销售趋势 | 时间序列分解 / 同比环比 |
| 异常检测 | IQR / Z-score / 隔离森林 |
| A/B 测试 | 假设检验 / 置信区间 |
| 漏斗分析 | 转化率 / 留存曲线 |

## 推荐工具组合

| 阶段 | 主用工具 |
|------|---------|
| 加载数据 | `run_python`（pandas） |
| 可视化 | `run_python`（matplotlib/seaborn） |
| 写报告 | `file_write` |
| 入库 | `kb_add_document`（可选） |
