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
#   5. 名单是一条**手工维护**的正则，于是 kernel 下新写的模块天然不受约束——
#      `session-catalog.ts`（169 行、19 处分叉）行覆盖 11%，却从未进过名单，
#      闸门一路绿灯。现在每个模块都必须被分类（见 CORE / DEBT），
#      新增文件不分类就红，这就是"名单漂移"的守卫。
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
below() { awk -v c="$1" -v t="$2" 'BEGIN{ exit ((c+0) < (t+0)) ? 0 : 1 }'; }

if ! below "51.15" "$THRESHOLD"; then
  echo "::error::覆盖率判据自检失败：51.15% 未被判为低于 ${THRESHOLD}%（闸门形同虚设）"
  exit 1
fi
if below "90" "$THRESHOLD"; then
  echo "::error::覆盖率判据自检失败：90% 被判为低于 ${THRESHOLD}%（闸门误伤）"
  exit 1
fi
if below "100.00" "$THRESHOLD"; then
  echo "::error::覆盖率判据自检失败：100.00% 被判为低于 ${THRESHOLD}%（字符串比较未数值化）"
  exit 1
fi

# 分级名单。名字一律取 kernel 树下的**文件名去掉 .ts**（`extensions/` 子目录同样按文件名）：
#   CORE —— 引擎边界上"改错了会静默出错"的模块，行覆盖必须 ≥ THRESHOLD。
#   DEBT —— 同样重要、但现在还没测到位。**各自带着只准升不准降的下限**，
#           写死在下面，任何一处覆盖率下滑都会立刻红（而不是"没进名单 = 免检"）。
#
# 2026-11-18 补：subagent（并发上限/超时/取消此前零测试，"超时"只写在描述里、代码不计时）、
# extensions（扩展过滤直接决定审批扩展是否被误伤）、session-catalog（会话目录的状态机）。
CORE_NAMES="events approval-gate mcp model bridge-pi plan goal pi-session pi-contract skills tools
prompt request-telemetry project-paths subagent extensions maxma-approval maxma-blocker
extension-ui opencode-zen persona-prompt shell-health session-catalog extension-template
path-policy command-policy agent-audit maxma-path-policy maxma-audit"

# 2026-11-18 补：session-catalog 从 DEBT 升进 CORE。它此前是 DEBT（下限 11%），
# 而"重启后会话名还在吗"这条路径只能靠回读会话文件验证——补上
# `tests/session-catalog.test.ts` 后行覆盖 100%，没有理由继续留在债务名单里。
DEBT="engine-info=34 kilo-free=44 plugin-models=57 session-catalog-rpc=7"

# 纯类型模块：没有可执行语句，bun 的覆盖率表根本不会列出它。
# 一旦它长出了运行时代码，就说明它该升到 CORE（脚本会在不同分支上报错）。
EXCLUDED="types permission-decision"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KERNEL_DIR="$REPO_ROOT/bun-sidecar/src/kernel"

TABLE=$(mktemp)
trap 'rm -f "$TABLE"' EXIT

# 覆盖率表的列序是 File | % Funcs | % Lines，第 3 列才是行覆盖。
# 文件名同时兼容 \ 与 /（CI 是 ubuntu，本地是 Windows）。
grep -E 'src[\\/]kernel[\\/]' "$COV_FILE" | grep -vE 'tests[\\/]' \
  | awk -F'|' '{
      n=$1; gsub(/^.*[\\/]/,"",n); gsub(/ /,"",n); sub(/\.ts$/,"",n);
      c=$3; gsub(/ /,"",c);
      if (n!="" && c!="") print n, c
    }' > "$TABLE"

cov_of() { awk -v k="$1" '$1==k{print $2; found=1} END{if(!found) exit 1}' "$TABLE"; }

FAIL=0

for name in $CORE_NAMES; do
  if ! cov=$(cov_of "$name"); then
    echo "::error::CORE 名单里的 ${name}.ts 未出现在覆盖率表（文件名漂移或已被删除）"
    FAIL=1
    continue
  fi
  echo "${name}.ts line coverage: ${cov}%"
  if below "$cov" "$THRESHOLD"; then
    echo "::error::${name}.ts coverage ${cov}% is below the ${THRESHOLD}% threshold"
    FAIL=1
  fi
done

for entry in $DEBT; do
  name="${entry%%=*}"
  floor="${entry#*=}"
  if ! cov=$(cov_of "$name"); then
    echo "::error::DEBT 名单里的 ${name}.ts 未出现在覆盖率表（文件名漂移或已被删除）"
    FAIL=1
    continue
  fi
  echo "${name}.ts line coverage: ${cov}%（DEBT 下限 ${floor}%）"
  if below "$cov" "$floor"; then
    echo "::error::${name}.ts coverage ${cov}% 低于既有下限 ${floor}%（覆盖率不得倒退）"
    FAIL=1
  fi
done

# types.ts 被列为"纯类型"：它若出现在覆盖率表里，说明长出了可执行代码，归类就错了。
if cov_of "types" >/dev/null; then
  echo "::error::types.ts 出现在覆盖率表里（已含可执行代码），应归入 CORE 而不是 EXCLUDED"
  FAIL=1
fi

# 漂移守卫：kernel 树下每个 .ts 都必须落在 CORE、DEBT 或 EXCLUDED 里。
# 没有这一条，新写的模块就是"免检"——历史第 5 条缺陷正是这样漏进来的。
ALL_NAMES=" $(printf '%s %s %s' "$CORE_NAMES" "$(printf '%s' "$DEBT" | sed 's/=[0-9]*//g')" "$EXCLUDED" | tr '\n' ' ') "
UNCLASSIFIED=""
for f in "$KERNEL_DIR"/*.ts "$KERNEL_DIR"/*/*.ts; do
  [ -e "$f" ] || continue
  n=$(basename "$f" .ts)
  case "$ALL_NAMES" in
    *" $n "*) ;;
    *) UNCLASSIFIED="$UNCLASSIFIED ${n}.ts" ;;
  esac
done
if [ -n "$UNCLASSIFIED" ]; then
  echo "::error::kernel 下有未分类模块:${UNCLASSIFIED}"
  echo "::error::请把它们加入 CORE（行覆盖 ≥ ${THRESHOLD}%）或 DEBT（写死当前下限），不要留成免检"
  FAIL=1
fi

if [ "$FAIL" = "0" ]; then
  echo "CORE 名单 $(echo $CORE_NAMES | wc -w | tr -d ' ') 项全部 ≥ ${THRESHOLD}%，DEBT $(echo $DEBT | wc -w | tr -d ' ') 项不低于各自下限，kernel 无未分类模块"
fi
exit "$FAIL"
