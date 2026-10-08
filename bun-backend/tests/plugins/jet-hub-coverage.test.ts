/**
 * tests/plugins/jet-hub-coverage.test.ts — 「全功能移植」的可核对清单（PLUGIN-001 / P5）。
 *
 * 「全功能移植」不应该是句口号。这个测试把**插件的方法面**与 **Maxma 已接进界面的方法**
 * 做差集，并要求每个差集项在 `NOT_SURFACED` 里有一条写清原因的记录：
 *
 *   - 插件升级后新增了方法 → 差集里冒出新名字 → 测试**红**（提醒去接，或去登记缺口）；
 *   - 某个方法被接上了却忘了从 `NOT_SURFACED` 移除 → 测试**红**（清单不许骗人）。
 *
 * 两边都是**从源码现读**的，不是手抄的名单 —— 手抄的名单会漂移，而漂移的清单比没有清单更坏。
 */

import { describe, expect, test } from "bun:test";

import * as fs from "node:fs";
import * as path from "node:path";

const pluginLibDir = path.resolve(import.meta.dir, "../../node_modules/dsh-codearts-auth/lib");
const webSrcDir = path.resolve(import.meta.dir, "../../../web/src");

/** 方法名必须带命名空间点号 —— 分派器里还有别的 switch，其 case 是单字噪声（buddy/codearts…）。 */
const METHOD_LABEL = /^[a-z][a-z0-9]*\.[a-zA-Z][a-zA-Z0-9]*$/;

function methodsFrom(file: string): string[] {
  const text = fs.readFileSync(path.join(pluginLibDir, file), "utf8");
  const found = new Set<string>();
  for (const match of text.matchAll(/case '([a-z][^']*)':/g)) {
    const name = match[1]!;
    if (METHOD_LABEL.test(name)) found.add(name);
  }
  return [...found].sort();
}

/** 插件暴露的全部 RPC 方法（主分派器 + OpenCode 子分派器）。 */
function pluginMethods(): string[] {
  return [...new Set([...methodsFrom("jet-hub-rpc.js"), ...methodsFrom("opencode-rpc.js")])].sort();
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|vue)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Maxma 前端（Vue/TS）里真正调用过的方法。 */
function surfacedMethods(): Set<string> {
  const called = new Set<string>();
  // ⚠️ 泛型参数可能**嵌套**（`callJetHub<Array<Record<string, unknown>>>('x')`），
  // 用 `[^>]*` 会在第一个 `>` 处截断、匹配不到任何调用，于是覆盖清单变成空转的假通过。
  const CALL = /callJetHub\s*(?:<[\s\S]*?>)?\s*\(\s*'([^']+)'/g;
  for (const file of walk(webSrcDir)) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(CALL)) called.add(match[1]!);
  }
  return called;
}

/**
 * 尚未接进界面的方法 → 原因。
 *
 * 每一项都必须写「为什么没接」，否则它就是一个无人认领的缺口。
 * 接上之后**必须**从这张表里删掉（下面的 stale 断言会拦）。
 */
const NOT_SURFACED: Record<string, string> = {
  // 历史别名：与 credits.permanentLock 同一实现，只是 provider 固定为 loomy。
  // Maxma 走现代端点即可覆盖同一能力，故不单独接。
  "loomy.permanentLock": "历史别名（同一实现、provider 固定 loomy）；Maxma 走 credits.permanentLock { provider } 覆盖",

  // 备用登录路径：Loomy 主路径是微信扫码（已走 account.create），短信是备用
  "login.sendSms": "Loomy 短信登录（备用路径）未做",
  "login.submitSms": "Loomy 短信验证码提交（备用路径）未做",

  // 桌面专用：Maxma 是 Web 形态，没有 <webview> 租约
  "captcha.carrierUrl": "ZCode captcha 内部载体是 desktop-only（依赖 dshDesktop 协议）",
  "captcha.contribute": "同上：载体贡献循环在 Web 形态下是刻意的零动作",
  "captcha.demand": "同上",

  // 宿主策略差异：网关开关改为写插件配置 + 重启，而不是调这个接口
  "gateway.setEnabled":
    "刻意不用：Maxma 把网关开关做成插件配置并在装配时注入 DSH_OPENAI_GATEWAY_ENABLED（见 plugins/dsh/index.ts）",

  // 能力重复：与已接的 credits.balances 重叠
  "credits.status": "积分状态与已接的 credits.balances 重叠，未单独展示",
};

describe("Jet Hub 方法面覆盖（全功能移植的可核对清单）", () => {
  test("插件方法面读得到（防止提取逻辑静默失效）", () => {
    const methods = pluginMethods();
    // 抽到空名单说明提取坏了 —— 后面的覆盖断言会变成永远通过的空转
    expect(methods.length).toBeGreaterThan(40);
    expect(methods).toContain("account.list");
    expect(methods).toContain("opencode.addAccount");
    // 噪声不能混进来（这些是分派器里别的 switch 的单字 case）
    expect(methods).not.toContain("codearts");
    expect(methods).not.toContain("buddy");
  });

  test("每个未接方法都有登记的原因（新增方法会让这条红）", () => {
    const surfaced = surfacedMethods();
    const unaccounted = pluginMethods().filter((m) => !surfaced.has(m) && !(m in NOT_SURFACED));
    expect(unaccounted).toEqual([]);
  });

  test("已接上的方法不得留在未接清单里（清单不许骗人）", () => {
    const surfaced = surfacedMethods();
    const stale = Object.keys(NOT_SURFACED).filter((m) => surfaced.has(m));
    expect(stale).toEqual([]);
  });

  test("核心账号管理闭环已经接通", () => {
    const surfaced = surfacedMethods();
    for (const method of [
      "provider.status",
      "provider.setEnabled",
      "account.list",
      "account.create",
      "account.test",
      "account.refresh",
      "account.delete",
      "account.reset",
      "model.list",
      "model.setDisabled",
      "credits.balances",
      "credits.claimAll",
      "usage.tokenLedger",
      "gateway.getEnabled",
      "backup.status",
      "backup.export",
      "backup.import",
      "login.poll",
    ]) {
      expect(surfaced.has(method), `${method} 应当已接进界面`).toBe(true);
    }
  });

  test("OpenCode 五个专属方法已全部接通", () => {
    // OpenCode 是独立的一类账号（手动 key / 匿名通道 / 出口代理 / 指纹），
    // 不复用渠道面板的浏览器登录路径，故单列一条断言。
    const surfaced = surfacedMethods();
    for (const method of [
      "opencode.addAccount",
      "opencode.addAnonymous",
      "opencode.setProxy",
      "opencode.testProxy",
      "opencode.rotateFingerprint",
    ]) {
      expect(surfaced.has(method), `${method} 应当已接进界面`).toBe(true);
    }
  });

  test("会话内用量徽标已接通（插件 README 的头号卖点）", () => {
    const surfaced = surfacedMethods();
    expect(surfaced.has("usage.badge")).toBe(true);
    expect(surfaced.has("usage.badgePreference")).toBe(true);
  });

  test("批量 / 排序 / 自动化开关已接通", () => {
    const surfaced = surfacedMethods();
    for (const method of [
      "account.retest",
      "account.retestAll",
      "account.resetAll",
      "account.update",
      "account.reorder",
      "model.setAllDisabled",
      "model.setDisabledMany",
      "model.clearDead",
      "provider.getOrder",
      "provider.setOrder",
      "usage.autoCheckin",
    ]) {
      expect(surfaced.has(method), `${method} 应当已接进界面`).toBe(true);
    }
  });

  test("渠道专属面板已接通（Cline 额度/日志、Loomy/Raccoon 新人任务）", () => {
    const surfaced = surfacedMethods();
    for (const method of ["cline.quota", "cline.requestLog", "onboarding.status", "onboarding.claim"]) {
      expect(surfaced.has(method), `${method} 应当已接进界面`).toBe(true);
    }
  });

  test("永久积分锁定已接通", () => {
    const surfaced = surfacedMethods();
    expect(surfaced.has("credits.permanentLock")).toBe(true);
    // `loomy.permanentLock` 是**历史别名**（同一实现、provider 固定 loomy，老客户端在用）：
    // Maxma 走现代端点 `credits.permanentLock { provider: 'loomy' }` 即可覆盖同一能力。
    expect(NOT_SURFACED["loomy.permanentLock"]).toContain("历史别名");
  });

  /**
   * 跨包一致性：Maxma 侧的能力表（决定按钮显不显示）必须与**插件宿主侧**的
   * provider 集合一致。
   *
   * 这条断言比插件仓库里的同名断言更有价值 —— 在那边两者同属一个包，
   * 在这里客户端纯逻辑被搬到了 Maxma、宿主集合还留在 npm 包里，
   * 任何一侧改动而另一侧没跟上，都会在这里红。
   */
  test("锁定积分的客户端能力表与插件侧的 provider 集合一致", () => {
    const hostSource = fs.readFileSync(path.join(pluginLibDir, "jet-hub-rpc.js"), "utf8");
    const marker = "export const PERMANENT_LOCK_PROVIDERS = new Set([";
    const start = hostSource.indexOf(marker);
    expect(start, "插件侧应当有 PERMANENT_LOCK_PROVIDERS").toBeGreaterThan(-1);
    // 插件侧写的是**常量标识符**（`LOOMY.id`）而不是字面量，所以要过一次映射。
    // 这份映射是本测试唯一的假设；它一旦过期会在下面的 count / 集合断言上现形。
    const PRODUCT_CONST_TO_ID: Record<string, string> = {
      LOOMY: "loomy",
      CODEBUDDY: "buddy",
      WORKBUDDY: "workbuddy",
      LOBSTERAI: "lobsterai",
      TRAE: "trae",
    };
    const hostConsts = [
      ...hostSource.slice(start, start + 400).matchAll(/^\s*([A-Z][A-Z0-9_]*)\.id,/gm),
    ].map((m) => m[1]!);
    expect(hostConsts.length, "插件侧锁定的 provider 数量变了，请同步这份映射与客户端能力表").toBe(5);
    const hostProviders = hostConsts.map((name) => {
      const id = PRODUCT_CONST_TO_ID[name];
      expect(id, `未登记的宿主常量 ${name}（插件新增了 provider？）`).toBeDefined();
      return id!;
    });

    const clientSource = fs.readFileSync(
      path.resolve(import.meta.dir, "../../../web/src/utils/jetHub/credits-capabilities.js"),
      "utf8",
    );
    const clientFn = clientSource.match(/export function supportsPermanentLock\(provider\)\s*\{([\s\S]{0,300}?)\n\}/);
    expect(clientFn, "客户端应当有 supportsPermanentLock").not.toBeNull();
    const clientProviders = [...clientFn![1]!.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]!);
    expect(clientProviders.length).toBeGreaterThan(0);

    expect([...clientProviders].sort()).toEqual([...hostProviders].sort());
  });
});
