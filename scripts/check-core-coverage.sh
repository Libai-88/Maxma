#!/usr/bin/env bash
# 核心逻辑模块的**行覆盖率**门槛（COV-PASS-001 的可执行版本）。
#
# 为什么单独成脚本：这段判据原来只存在于 `.github/workflows/sidecar.yml` 的一个
# `run: |` 块里，于是本地闸门 `scripts/verify-all-gates.sh` 根本没有覆盖率这一项——
# CI 与本地是两套口径。抽成脚本后两边调同一个实现，也就不会有"改了一处忘另一处"。
#
# 用法: scripts/check-core-coverage.sh <bun test --coverage 的输出文件> [阈值=65]
#
# 历史缺陷（这段判据前后被修过四次，都是"会发绿灯的死检查"）：
#   1. 名单是 OMP 时代的文件名（approval.ts 实名 approval-gate.ts、state.ts 已不存在），
#      grep 落空的项不报错 → 门槛只守住 events/mcp/model 三项。
#   2. `grep -v "tests\\"` 用了 Windows 分隔符，在 ubuntu runner 上什么都没排除。
#   3. 模式没有同时匹配 \ 与 /，换平台整体失效。
#   4. `[ "$COV" -lt 65 ]` 拿小数去比整数：bash 报 "integer expression expected" 并返回
#      **2**，在 if 里非 0 一律按"假"处理 → ::error:: 永不打印、恒 exit 0。
#      证据：run 43571147741 的日志里有 `bridge-pi.ts line coverage: 51.15%`，
#      作业结论却是 success。
#
# 因此本脚本除了判覆盖率，还先**自检判据本身**：判据写错时立刻红，而不是继续发绿灯。
set -u

COV_FILE="${1:-}"
THRESHOLD="${2:-65}"

if [ -z "$COV_FILE" ] || [ ! -f "$COV_FILE" ]; then
  echo "::error::用法: $0 <coverage.txt> [threshold]（未找到覆盖率输出文件: ${COV_FILE:-<空>}）"
  exit 2
fi

# awk 的 -v 传进来是字符串，"100.00" < "65" 会按字典序成立 —— 必须 +0 强制数值。
# 语义：低于阈值时返回 0（可被 if 直接吃），达标返回 1。
below() { awk -v c="$1" -v t="$THRESHOLD" 'BEGIN{ exit ((c+0) < (t+0)) ? 0 : 1 }'; }

if ! below "51.15"; then
  echo "::error::覆盖率判据自检失败：51.15% 未被判为低于 ${THRESHOLD}%（闸门形同虚设）"
  exit 1
fi
if below "90"; then
  echo "::error::覆盖率判据自检失败：90% 被判为低于 ${THRESHOLD}%（闸门误伤）"
  exit 1
fi
if below "100.00"; then
  echo "::error::覆盖率判据自检失败：100.00% 被判为低于 ${THRESHOLD}%（字符串比较未数值化）"
  exit 1
fi

# CORE 名单：引擎边界上"改错了会静默出错"的模块（16 项）。
# subagent 于 2026-11-18 加入：它的并发上限/超时/取消此前无任何测试锁（覆盖率 0），
# 且"超时"曾只写在工具描述里、代码不计时——这类"文案承诺了但没实现"的模块
# 必须进名单，否则会安静地退回去。
# extensions 同批加入：扩展过滤（禁用）直接决定审批/拒止扩展是否被误伤。
CORE="src[\\\\/]kernel[\\\\/](events|approval-gate|mcp|model|bridge-pi|plan|goal|pi-session|pi-contract|skills|tools|prompt|request-telemetry|project-paths|subagent|extensions)\.ts"

ROWS=$(mktemp)
trap 'rm -f "$ROWS"' EXIT

# 覆盖率表的列序是 File | % Funcs | % Lines，第 3 列才是行覆盖。
grep -E "$CORE" "$COV_FILE" | grep -vE 'tests[\\/]' \
  | awk -F'|' '{gsub(/ /,"",$1); gsub(/ /,"",$3); print $1, $3}' > "$ROWS" || true

# 名单本身也要校验：匹配不到行 = 门槛空转（就是上面第 1 条那种形状）。
MATCHED=$(wc -l < "$ROWS" | tr -d ' ')
if [ "${MATCHED:-0}" -lt 10 ]; then
  echo "::error::覆盖率名单只匹配到 ${MATCHED} 行，疑似文件名漂移，门槛空转"
  exit 1
fi

FAIL=0
while read -r NAME COV; do
  echo "${NAME} line coverage: ${COV}%"
  if [ -z "$COV" ] || below "$COV"; then
    echo "::error::${NAME} coverage ${COV}% is below the ${THRESHOLD}% threshold"
    FAIL=1
  fi
done < "$ROWS"

if [ "$FAIL" = "0" ]; then
  echo "CORE 名单 ${MATCHED} 项全部 ≥ ${THRESHOLD}%（行覆盖）"
fi
exit "$FAIL"
