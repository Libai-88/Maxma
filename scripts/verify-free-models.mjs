/**
 * scripts/verify-free-models.mjs — 免费渠道「哪些模型真的能用」的可重复验证。
 *
 * ## 为什么需要它
 *
 * 内置免费渠道的可用模型清单是**硬编码白名单**
 * （`bun-sidecar/src/kernel/opencode-zen.ts` 的 `FREE_LANE_PRIMARY_MODEL_ID` /
 * `FREE_LANE_FALLBACK_MODEL_IDS`），放行哪些是"验证过能经外部兼容身份调用"的结论。
 * 但上游 `GET /zen/v1/models` 随时在变（2026-10-27 实测 84 个模型、8 个 `-free`，
 * 而 Maxma 当时只放行 1 个），于是这份结论会悄悄过期——
 * 而且**没法靠读代码重新得出**，只能重新实测。
 *
 * 这个脚本就是"重新实测"本身：逐个打上游，把结果分成三类
 *
 *   - ✅ 200          ：真的能用 → 可以进白名单
 *   - ⚠️ 429 限流     ：模型存在、身份被接受，但额度耗尽 → **无法判定**，不能凭猜测放行
 *   - ❌ 403 地区受限 ：与本机所在地区无关的模型 → 不该进白名单（放了用户必报错）
 *
 * 所以它是"白名单该不该扩"的判据来源，而不是又一份手抄清单。
 *
 * ## 用法
 *
 *   bun scripts/verify-free-models.mjs              # 全部上游免费模型
 *   bun scripts/verify-free-models.mjs mimo-v2.6-flash-free   # 只测指定的
 *
 * 退出码 0 = 至少完成了一轮探测（不代表"全都能用"）；
 * 输出末尾给出"可进白名单 / 待额度恢复后再测 / 不该放行"三档结论。
 */

const TIMEOUT_MS = 30_000;

/**
 * 端点从**内核单源**取，不在这里再写一份字面量。
 *
 * 上游 2026-10 已把推理/目录端点从 `/zen/v1` 迁到 `/inference/v1`
 * （依据上游仓库 `src/opencode-product.ts` 的 `baseUrl`）。本脚本此前自己写着
 * 旧端点 —— 那会让"验证脚本"去测一个已被废弃的入口，结论自然与实际不符。
 */
const { DEFAULT_BASE_URL: BASE } = await import(
  "../bun-sidecar/src/kernel/opencode-zen.ts"
);

async function upstreamFreeModels() {
  const res = await fetch(`${BASE}/models`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`GET /models HTTP ${res.status}`);
  const data = await res.json();
  const ids = (data?.data ?? data?.models ?? [])
    .map((m) => (typeof m === "string" ? m : m?.id))
    .filter((x) => typeof x === "string");
  return ids.filter((id) => id.endsWith("-free")).sort();
}

/** 探测单个模型；返回 { status, kind, note }。 */
async function probe(model) {
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "reply with: ok" }],
        max_tokens: 8,
        stream: false,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    if (res.ok) {
      let content = "";
      try {
        content = String(JSON.parse(text)?.choices?.[0]?.message?.content ?? "");
      } catch {
        content = "(非 JSON 响应)";
      }
      return { status: res.status, kind: "usable", note: `content=${JSON.stringify(content.slice(0, 40))}` };
    }
    let type = "";
    let message = text;
    try {
      const j = JSON.parse(text);
      type = String(j?.error?.type ?? j?.type ?? "");
      message = String(j?.error?.message ?? j?.message ?? text);
    } catch {
      /* 保留原文 */
    }
    if (res.status === 429 || /FreeUsageLimit/i.test(type)) {
      return { status: res.status, kind: "rate_limited", note: message.slice(0, 90) };
    }
    if (res.status === 403 || /Region/i.test(type)) {
      return { status: res.status, kind: "region_blocked", note: message.slice(0, 90) };
    }
    return { status: res.status, kind: "other", note: `${type} ${message}`.slice(0, 90) };
  } catch (err) {
    return { status: -1, kind: "error", note: String(err?.message ?? err).slice(0, 90) };
  }
}

const explicit = process.argv.slice(2).filter((a) => !a.startsWith("-"));
let targets;
try {
  targets = explicit.length > 0 ? explicit : await upstreamFreeModels();
} catch (err) {
  console.error(`✗ 取不到上游免费模型清单：${err.message}\n  （网络不可用时无法验证，退出码非 0）`);
  process.exit(1);
}

if (targets.length === 0) {
  console.error("✗ 上游返回的免费模型列表为空——无法验证，退出码非 0");
  process.exit(1);
}

console.log(`探测 ${targets.length} 个免费模型（上游 ${BASE}）\n`);
const byKind = { usable: [], rate_limited: [], region_blocked: [], other: [], error: [] };
for (const model of targets) {
  const r = await probe(model);
  const mark = {
    usable: "✅ 可用",
    rate_limited: "⚠️ 限流",
    region_blocked: "❌ 地区受限",
    other: "❓ 其它",
    error: "❓ 请求失败",
  }[r.kind];
  console.log(`${model.padEnd(32)} ${mark}  ${r.note}`);
  byKind[r.kind].push(model);
}

console.log("\n── 结论 ──");
console.log(`✅ 可进白名单（实测出内容）：${byKind.usable.join(", ") || "(无)"}`);
console.log(
  `⚠️ 待额度恢复后再测（模型存在、身份被接受，但 429，**不能凭猜测放行**）：` +
    `${byKind.rate_limited.join(", ") || "(无)"}`,
);
console.log(`❌ 不该放行（地区受限，放了用户必报错）：${byKind.region_blocked.join(", ") || "(无)"}`);
if (byKind.other.length || byKind.error.length) {
  console.log(`❓ 需人工判断：${[...byKind.other, ...byKind.error].join(", ")}`);
}
console.log(
  "\n白名单位置：bun-sidecar/src/kernel/opencode-zen.ts 的 " +
    "FREE_LANE_PRIMARY_MODEL_ID / FREE_LANE_FALLBACK_MODEL_IDS（并把地区受限项记进 " +
    "services/opencode-zen.ts 的 KNOWN_UNUSABLE_FREE_MODELS，避免将来被顺手放行）。",
);
