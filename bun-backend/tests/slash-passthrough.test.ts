/**
 * tests/slash-passthrough.test.ts — 斜杠命令必须原样到达引擎（SLASH-PASSTHROUGH-001）。
 *
 * ## 事故形状（本轮实测踩到）
 *
 * pi 把「整条消息是 `/name` 或 `/name args`」识别为命令，据此分发
 * `pi.registerCommand()` 注册的扩展命令与 `~/.pi/agent/prompts/*.md` 的模板。
 * 我们在**两个**地方把命令污染了：
 *
 *   1. 前端 `buildFlatMessage` 在消息尾部追加时间戳 →
 *      `/probe-confirm（2026-11-13 Wed 15:20）`
 *   2. 后端 `enrichWithEvolutionContext` 追加行为偏好注入 →
 *      `/probe-confirm\n\n[Maxma 行为偏好…]`
 *
 * 两处都让命令退化成普通文本发给模型。症状极具误导性：界面显示
 * "（发生错误，回复未完成）"，看起来像模型挂了，实际是命令根本没被分发。
 *
 * 本锁只查后端那一半（前端那半在 `web/src/utils/references.ts`，两侧判定必须同源）。
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO = path.resolve(import.meta.dir, "../..");
const chatWs = fs.readFileSync(path.join(REPO, "bun-backend/src/routes/chat-ws.ts"), "utf8");
const refs = fs.readFileSync(path.join(REPO, "web/src/utils/references.ts"), "utf8");

/** 从源码里抽出 `isSlashCommand` / `SLASH_COMMAND_RE` 的正则字面量，两侧逐字对账。 */
function slashRegex(src: string, name: string): string | null {
  const m = src.match(new RegExp(`${name}\\s*=\\s*(\\/[^;\\n]+\\/[a-z]*)`));
  return m ? m[1]!.trim() : null;
}

describe("斜杠命令透传", () => {
  test("后端：命令不做行为偏好富化", () => {
    // 判据是"存在按斜杠分流的代码"，而不是"某个具体变量名"——
    // 变量改名不该让锁失效，但去掉分流必须让它红。
    expect(chatWs).toMatch(/isSlashCommand/);
    expect(chatWs).toMatch(/isSlashCommand\s*\n?\s*\?\s*userMessage/);
    // 富化只能出现在非命令分支
    expect(chatWs).toMatch(/:\s*enrichWithEvolutionContext\(/);
  });

  test("前端：命令不做时间戳/引用拼接（行为断言，不绑写法）", () => {
    // 直接把函数体抽出来求值，验证**行为**而不是源码形状。
    // 第一版按 `if (...) return ...` 的正则匹配，函数一换行就误报——
    // 判据绑在写法上，改实现就失效，那正是"会发绿灯的死检查"的近亲。
    const src = refs.slice(refs.indexOf("export function buildFlatMessage"));
    const body = src.slice(0, src.indexOf("\n}") + 2);
    const reLiteral = refs.match(/SLASH_COMMAND_RE\s*=\s*(\/.+\/[a-z]*)/);
    expect(reLiteral, "找不到 SLASH_COMMAND_RE").not.toBeNull();

    // 用 Bun 的转译器把 TS 函数体变成可执行的 JS——比自己剥类型可靠得多。
    // （第一版手写正则剥注解，`new Function` 直接语法报错：判据本身坏了。）
    const js = new Bun.Transpiler({ loader: "ts" }).transformSync(
      body.replace("export function buildFlatMessage", "globalThis.__buildFlatMessage = function buildFlatMessage"),
    );
    const reSrc = reLiteral![1]!;
    const build = new Function(
      "SLASH_COMMAND_RE",
      "buildRefsBlock",
      `${js}\nreturn globalThis.__buildFlatMessage;`,
    )(
      new RegExp(reSrc.slice(1, reSrc.lastIndexOf("/")), reSrc.slice(reSrc.lastIndexOf("/") + 1)),
      () => "[refs]",
    );

    // 命令：必须原样返回，不带时间戳
    expect(build("/probe-confirm", "（2026-11-13 Wed 15:20）", [])).toBe("/probe-confirm");
    expect(build("/goal 完成周报", "（2026-11-13 Wed 15:20）", [])).toBe("/goal 完成周报");
    // 普通消息：仍要带时间戳（这个能力不能被顺手删掉）
    const plain = build("你好", "（2026-11-13 Wed 15:20）", []);
    expect(plain).toContain("你好");
    expect(plain).toContain("2026-11-13");
  });

  test("两侧的斜杠判定正则必须同源（改一边不改另一边 = 命令时灵时不灵）", () => {
    const backendRe = slashRegex(chatWs, "isSlashCommand");
    const frontendRe = slashRegex(refs, "SLASH_COMMAND_RE");
    expect(backendRe, "后端找不到斜杠判定正则").not.toBeNull();
    expect(frontendRe, "前端找不到斜杠判定正则").not.toBeNull();
    // 允许不同变量名/空白，但字符集与锚点必须一致
    const norm = (s: string) => s.replace(/\s+/g, "");
    expect(norm(frontendRe!), "前后端的斜杠判定正则已经分叉").toBe(norm(backendRe!));
  });

  test("正则行为自检：命令与普通消息分得开", () => {
    // 用后端的字面量构造真正则，验证判定语义（防"正则写反了但两侧一致"）
    const src = slashRegex(chatWs, "isSlashCommand");
    expect(src).not.toBeNull();
    const re = new RegExp(src!.slice(1, src!.lastIndexOf("/")), src!.slice(src!.lastIndexOf("/") + 1));
    expect(re.test("/probe-confirm")).toBe(true);
    expect(re.test("/goal 完成周报")).toBe(true);
    expect(re.test("/compact")).toBe(true);
    expect(re.test("帮我看看这个 /path 是什么")).toBe(false);
    expect(re.test("今天天气怎么样")).toBe(false);
  });
});
