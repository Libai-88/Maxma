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

out=$(cd web && npx vitest run 2>&1); rc=$?
say "web vitest" "$([ "$rc" = 0 ] && echo PASS || echo FAIL)  $(echo "$out" | grep -E 'Tests +[0-9]' | tail -1)"
[ "$rc" = 0 ] || FAILS=$((FAILS+1))

r=$(cd web && npx vue-tsc --noEmit 2>&1 | tail -2)
[ -z "$r" ] && say "web vue-tsc" "PASS  0 error" || { say "web vue-tsc" "FAIL  $r"; FAILS=$((FAILS+1)); }

r=$(cd web && npm run lint 2>&1 | grep -E "problem" | tail -1)
say "web eslint" "$r"
case "$r" in *"0 errors"*) ;; *) FAILS=$((FAILS+1));; esac

r=$(cd web && npm run lint:colors 2>&1 | grep -E "No hardcoded|violation" | tail -1)
say "color guard" "${r:-$r}"

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
