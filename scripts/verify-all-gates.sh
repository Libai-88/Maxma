#!/usr/bin/env bash
# 交付前全量闸门（一次性复跑，输出每项 PASS/FAIL 与关键数字）。
set -u
cd "$(dirname "$0")/.."
FAILS=0
say() { printf '%-34s %s\n' "$1" "$2"; }

out=$(cd bun-sidecar && bun test 2>&1); rc=$?
say "sidecar bun test" "$([ "$rc" = 0 ] && echo PASS || echo FAIL)  $(echo "$out" | grep -E '^ *[0-9]+ (pass|fail)' | tr '\n' ' ')"
[ "$rc" = 0 ] || FAILS=$((FAILS+1))

n=$(cd bun-sidecar && bun x tsc --noEmit 2>&1 | grep -c "error TS")
[ "$n" = "0" ] && say "sidecar tsc" "PASS  0 error" || { say "sidecar tsc" "FAIL  $n error"; FAILS=$((FAILS+1)); }

out=$(cd bun-backend && bun test 2>&1); rc=$?
say "backend bun test" "$([ "$rc" = 0 ] && echo PASS || echo FAIL)  $(echo "$out" | grep -E '^ *[0-9]+ (pass|fail)' | tr '\n' ' ')"
[ "$rc" = 0 ] || FAILS=$((FAILS+1))

# 前端（React 19 + Tailwind 4 + Solid Glass）：类型 + 生产构建 + 语义色守卫。
# 旧 Vue 组件测试套件随重写退役（组件全部重建，测试断言绑定在已删除的 DOM 上）。
n=$(cd web && npx tsc --noEmit 2>&1 | grep -c "error TS")
[ "$n" = "0" ] && say "web tsc" "PASS  0 error" || { say "web tsc" "FAIL  $n error"; FAILS=$((FAILS+1)); }

out=$(cd web && node scripts/clean-dist.mjs >/dev/null 2>&1 && npx vite build 2>&1); rc=$?
say "web build" "$([ "$rc" = 0 ] && echo PASS || echo FAIL)  $(echo "$out" | grep -E 'built in' | tail -1)"
[ "$rc" = 0 ] || FAILS=$((FAILS+1))

r=$(cd web && npm run lint:colors 2>&1 | grep -E "No hardcoded|violation" | tail -1)
say "color guard" "${r:-$r}"
case "$r" in *"No hardcoded"*) ;; *) FAILS=$((FAILS+1));; esac

# 间距守卫：自绘边框/底色容器的内边距下限（文字不允许贴着边框）。
sp_out=$(cd web && npm run lint:spacing 2>&1); sp_rc=$?
say "spacing guard" "$([ "$sp_rc" = 0 ] && echo PASS || echo FAIL)  $(echo "$sp_out" | grep -E '✓|✗|共' | tail -1)"
[ "$sp_rc" = 0 ] || FAILS=$((FAILS+1))

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

r=$(cd bun-backend && bun run build-server.mjs 2>&1 | grep -E "bundle" | tr '\n' ' ')
case "$r" in *"externals OK"*) say "backend bundle" "PASS  $r";; *) say "backend bundle" "FAIL  $r"; FAILS=$((FAILS+1));; esac

echo
if [ "$FAILS" = "0" ]; then echo "全部闸门通过"; else echo "有 $FAILS 项未通过"; fi
exit "$FAILS"
