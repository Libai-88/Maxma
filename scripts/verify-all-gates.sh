#!/usr/bin/env bash
# 交付前全量闸门（一次性复跑，输出每项 PASS/FAIL 与关键数字）。
set -u
cd "$(dirname "$0")/.."
FAILS=0
say() { printf '%-34s %s\n' "$1" "$2"; }

# 本机（Windows PowerShell / cmd）PATH 里常常没有 bun，只有 bun-sidecar/bun.exe。
# 不显式定位的话，`bun ...` 会退化成 "bun: command not found"——而下面多处用
# grep 计数判 PASS，输出为空就等于 0 个失败，又是一道发绿灯的死检查。
BUN=""
if [ -n "${BUN_BIN:-}" ] && [ -x "$BUN_BIN" ]; then
  BUN="$BUN_BIN"
elif command -v bun >/dev/null 2>&1; then
  BUN="$(command -v bun)"
elif [ -x "$(pwd)/bun-sidecar/bun.exe" ]; then
  BUN="$(pwd)/bun-sidecar/bun.exe"
elif [ -x "$(pwd)/bun-sidecar/bun" ]; then
  BUN="$(pwd)/bun-sidecar/bun"
fi
if [ -z "$BUN" ]; then
  echo "找不到可执行的 bun（PATH / BUN_BIN / bun-sidecar/bun(.exe) 都试过了）——闸门无法校验"
  exit 1
fi
say "bun" "$BUN"

COV=$(mktemp)
out=$(cd bun-sidecar && "$BUN" test --coverage 2>&1); rc=$?
printf '%s\n' "$out" > "$COV"
say "sidecar bun test" "$([ "$rc" = 0 ] && echo PASS || echo FAIL)  $(echo "$out" | grep -E '^ *[0-9]+ (pass|fail)' | tr '\n' ' ')"
[ "$rc" = 0 ] || FAILS=$((FAILS+1))

# COV-PASS-001：核心模块行覆盖率门槛（与 CI 的 sidecar.yml 调同一个脚本）。
# 这次运行同时产出了覆盖率表，所以不再重复跑一遍 bun test。
cov_out=$(bash scripts/check-core-coverage.sh "$COV" 65 2>&1); cov_rc=$?
say "core coverage >=65%" "$([ "$cov_rc" = 0 ] && echo PASS || echo FAIL)  $(echo "$cov_out" | grep -E '::error|CORE 名单' | head -2 | tr '\n' ' ')"
[ "$cov_rc" = 0 ] || FAILS=$((FAILS+1))
rm -f "$COV"

tsc_out=$(cd bun-sidecar && "$BUN" x tsc --noEmit 2>&1); tsc_rc=$?
n=$(printf '%s\n' "$tsc_out" | grep -c "error TS")
if [ "$tsc_rc" != "0" ] && [ "$n" = "0" ]; then
  say "sidecar tsc" "FAIL  类型检查没跑起来（exit $tsc_rc）：$(printf '%s' "$tsc_out" | head -1)"
  FAILS=$((FAILS+1))
elif [ "$n" = "0" ]; then
  say "sidecar tsc" "PASS  0 error"
else
  say "sidecar tsc" "FAIL  $n error"
  FAILS=$((FAILS+1))
fi

out=$(cd bun-backend && "$BUN" test 2>&1); rc=$?
say "backend bun test" "$([ "$rc" = 0 ] && echo PASS || echo FAIL)  $(echo "$out" | grep -E '^ *[0-9]+ (pass|fail)' | tr '\n' ' ')"
[ "$rc" = 0 ] || FAILS=$((FAILS+1))

# 前端（React 19 + Tailwind 4 + Solid Glass）：类型 + 生产构建 + 语义色守卫。
# 旧 Vue 组件测试套件随重写退役（组件全部重建，测试断言绑定在已删除的 DOM 上）。
web_tsc=$(cd web && node node_modules/typescript/bin/tsc --noEmit 2>&1); web_rc=$?
n=$(printf '%s\n' "$web_tsc" | grep -c "error TS")
if [ "$web_rc" != "0" ] && [ "$n" = "0" ]; then
  say "web tsc" "FAIL  类型检查没跑起来（exit $web_rc）：$(printf '%s' "$web_tsc" | head -1)"
  FAILS=$((FAILS+1))
elif [ "$n" = "0" ]; then
  say "web tsc" "PASS  0 error"
else
  say "web tsc" "FAIL  $n error"
  FAILS=$((FAILS+1))
fi

# P0-2：前端单测（web/tests，目前覆盖 hooks/chatTurns.ts 纯函数层）。
# 此前 web 侧 0 个测试文件，这条闸门是"前端测试"从 0 到 1 的入口。
out=$(cd web && "$BUN" test 2>&1); rc=$?
say "web bun test" "$([ "$rc" = 0 ] && echo PASS || echo FAIL)  $(echo "$out" | grep -E '^ *[0-9]+ (pass|fail)' | tr '\n' ' ')"
[ "$rc" = 0 ] || FAILS=$((FAILS+1))

# P1-1：ESLint 只查本次改动（存量不开闸），详见 web/eslint.config.js 与 web/scripts/lint-changed.mjs。
lint_out=$(cd web && node scripts/lint-changed.mjs 2>&1); lint_rc=$?
say "web eslint (changed)" "$([ "$lint_rc" = 0 ] && echo PASS || echo FAIL)  $(echo "$lint_out" | grep -E '✓|✗|lint 目标|!' | head -2 | tr '\n' ' ')"
[ "$lint_rc" = 0 ] || FAILS=$((FAILS+1))

# 构建/守卫一律走 `node <入口脚本>`，不经 npx / npm：
# Git Bash 里 npm/npx 是 .cmd 包装（bash 找不到无扩展名的 npx），
# 于是 `npx tsc` 会退化成 "command not found"，而下游用 grep 计数又会把它当成 0 错误。
out=$(cd web && node scripts/clean-dist.mjs >/dev/null 2>&1 && node node_modules/vite/bin/vite.js build 2>&1); rc=$?
say "web build" "$([ "$rc" = 0 ] && echo PASS || echo FAIL)  $(echo "$out" | grep -E 'built in' | tail -1)"
[ "$rc" = 0 ] || FAILS=$((FAILS+1))

r=$(cd web && node scripts/check-hardcoded-colors.mjs 2>&1); color_rc=$?
say "color guard" "$([ "$color_rc" = 0 ] && echo PASS || echo FAIL)  $(echo "$r" | grep -E 'No hardcoded|violation|✗' | tail -1)"
[ "$color_rc" = 0 ] || FAILS=$((FAILS+1))

# 间距守卫：自绘边框/底色容器的内边距下限（文字不允许贴着边框）。
sp_out=$(cd web && node scripts/check-spacing.mjs 2>&1); sp_rc=$?
say "spacing guard" "$([ "$sp_rc" = 0 ] && echo PASS || echo FAIL)  $(echo "$sp_out" | grep -E '✓|✗|共' | tail -1)"
[ "$sp_rc" = 0 ] || FAILS=$((FAILS+1))

# 排版守卫：字号必须落在六档阶梯内、动效必须有时长、阴影必须走 elev-1/2/3。
# 存量记在 web/scripts/type-scale-baseline.json（棘轮，只准缩不准涨）。
# 2026-11-18 起因：33 个视图 125 处任意字号、11 个档位（含 10.5/11.5/12.5 三个半像素档）。
ts_out=$(cd web && node scripts/check-type-scale.mjs 2>&1); ts_rc=$?
say "type scale guard" "$([ "$ts_rc" = 0 ] && echo PASS || echo FAIL)  $(echo "$ts_out" | tail -1)"
[ "$ts_rc" = 0 ] || FAILS=$((FAILS+1))

# 玻璃层数守卫：backdrop-filter 生效声明上限（性能与可读性的硬边界）。
gw_out=$(cd web && node scripts/check-css-weight.mjs 2>&1); gw_rc=$?
say "glass weight guard" "$([ "$gw_rc" = 0 ] && echo PASS || echo FAIL)  $(echo "$gw_out" | tail -1)"
[ "$gw_rc" = 0 ] || FAILS=$((FAILS+1))

# 判定优先用**退出码**，不是输出字符串匹配。
# （第一版在这里踩过坑：budget 的 PASS 分支匹配的是"✓ bun-sidecar: 0"，
#   于是 bun-backend 报 ✗ 时整个脚本仍然打「全部闸门通过」——我今天一路在修的
#   那种"会发绿灯的死检查"，我自己刚写了一个。）
budget_out=$(node scripts/check-type-budget.mjs 2>&1); budget_rc=$?
if [ "$budget_rc" = "0" ]; then
  say "type budget ratchet" "PASS  $(echo "$budget_out" | tr '\n' ' ')"
else
  say "type budget ratchet" "FAIL  $(echo "$budget_out" | grep -E '✗|上升' | head -3 | tr '\n' ' ')"
  FAILS=$((FAILS+1))
fi

r=$(cd bun-backend && "$BUN" run build-server.mjs 2>&1 | grep -E "bundle" | tr '\n' ' ')
case "$r" in *"externals OK"*) say "backend bundle" "PASS  $r";; *) say "backend bundle" "FAIL  $r"; FAILS=$((FAILS+1));; esac

# P1-2：巨型文件体量棘轮（存量记账，只准降不准涨）。
size_out=$(node scripts/check-file-size-budget.mjs 2>&1); size_rc=$?
say "file size ratchet" "$([ "$size_rc" = 0 ] && echo PASS || echo FAIL)  $(echo "$size_out" | head -2 | tr '\n' ' ')"
[ "$size_rc" = 0 ] || FAILS=$((FAILS+1))

echo
if [ "$FAILS" = "0" ]; then echo "全部闸门通过"; else echo "有 $FAILS 项未通过"; fi
exit "$FAILS"
