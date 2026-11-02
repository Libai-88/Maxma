/**
 * tests/shipped-skills-packaging.test.ts — 「随包技能根」一致性回归锁。
 *
 * 背景（HANDOFF 遗留问题 #5）：上一代引擎把技能放在 `.omp/skills/`，引擎换代到
 * pi 后，`maxmaSkillPaths()` 只加载 `.agents/skills`（工作区 + 用户）与
 * `.maxma/skills`（随包），`.omp/skills` 再没有任何读取方——但两种便携包脚本
 * （build-portable.bat、build-desktop-portable.ps1）仍在拷贝它，`health.ts` 还在
 * 把它计成 `anthropic_skills_count` 给前端一个显示错误数字的死组件。
 *
 * 本锁用源码文本（先剥注释）对账两件事，任一条被破坏都会变红：
 *   (a) 引擎实际加载的技能根 == 打包脚本真正暂存的技能根，且二者都只认
 *       随包目录 `.maxma/skills`，不再出现已删除的 `.omp/skills`。
 *   (b) `bun-backend/src` 与 `bun-sidecar/src` 里没有任何文件还把 `.omp` 当作
 *       运行期读取路径（`.omprc` / `.omprc.json` 是合法的同级行，不算）。
 *
 * 判据都是"读真实代码文本"而非跑起来：注释里提一句 `.omp/skills` 骗不过测试，
 * 因为断言前统一剥注释。风格对齐 engine-boundary.test.ts / agentTasksGating.spec.ts。
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO = path.resolve(import.meta.dir, "../..");
const read = (rel: string): string => fs.readFileSync(path.join(REPO, rel), "utf8");

/** 剥块注释、整行 `//` 注释、整行 `#` 注释、整行 `REM` 注释。 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/^[ \t]*#.*$/gm, "")
    .replace(/^[ \t]*REM\b.*$/gim, "");
}

/** 递归收集某目录下的 .ts 文件（相对仓库根；跳过 node_modules / dist / .git）。 */
function tsFiles(dirRel: string): string[] {
  const abs = path.join(REPO, dirRel);
  const out: string[] = [];
  if (!fs.existsSync(abs)) return out;
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (["node_modules", "dist", ".git"].includes(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.ts$/.test(e.name)) out.push(p);
    }
  };
  walk(abs);
  return out;
}

/**
 * 从 skills.ts 源码里抽出引擎加载的技能根，形如 `.maxma/skills`、`.agents/skills`。
 * 兼容两种写法：`path.join(base, ".maxma", "skills")` 两段字面量、
 * 以及 `path.join(base, ".maxma/skills")` 单段带斜杠字面量。
 */
function engineSkillRoots(): Set<string> {
  const src = stripComments(read("bun-sidecar/src/kernel/skills.ts"));
  const roots = new Set<string>();
  // 形式一：path.join(base, ".maxma", "skills") —— 当前实现用两段字面量。
  const joinRe = /["']\.([A-Za-z0-9][A-Za-z0-9_-]*)["']\s*,\s*["']skills["']/g;
  for (const m of src.matchAll(joinRe)) {
    const name = m[1];
    if (name) roots.add(`.${name}/skills`);
  }
  // 形式二：path.join(base, ".maxma/skills") —— 单段带斜杠字面量（防御性兼容）。
  for (const r of packagedSkillRoots(src)) roots.add(r);
  return roots;
}

/**
 * 从打包脚本源码里抽出它真正暂存的技能根（`.maxma\skills`、`.omp/skills` 都能识别）。
 */
function packagedSkillRoots(src: string): Set<string> {
  const roots = new Set<string>();
  const re = /\.([A-Za-z0-9][A-Za-z0-9_-]*)[\\/]+skills\b/g;
  for (const m of src.matchAll(re)) {
    const name = m[1];
    if (name) roots.add(`.${name}/skills`);
  }
  return roots;
}

const PACKAGING_SCRIPTS = ["build-portable.bat", "build-desktop-portable.ps1"] as const;
const BUNDLE_SKILL_DIR = ".maxma/skills";
const DEAD_SKILL_DIR = ".omp/skills";

describe("随包技能根：引擎加载的 == 打包暂存的，且只有 .maxma/skills", () => {
  const engineRoots = engineSkillRoots();

  test("引擎确实加载 .maxma/skills（随包），不再加载 .omp/skills", () => {
    expect(engineRoots.has(BUNDLE_SKILL_DIR), "skills.ts 不再把 .maxma/skills 交给引擎加载").toBe(true);
    expect(engineRoots.has(DEAD_SKILL_DIR), "skills.ts 又加载了已被删除的 .omp/skills").toBe(false);
  });

  test("打包脚本暂存的技能根与引擎加载的随包根一致，且不复活 .omp/skills", () => {
    for (const rel of PACKAGING_SCRIPTS) {
      const src = stripComments(read(rel));
      const roots = packagedSkillRoots(src);
      // 引擎加载的随包目录必须被打包带上（否则便携包里技能缺失）。
      expect(roots.has(BUNDLE_SKILL_DIR), `${rel} 不再暂存随包技能 ${BUNDLE_SKILL_DIR}`).toBe(true);
      // 打包不得暂存任何引擎不加载的技能目录——原始缺陷就是多拷了 .omp/skills。
      const orphans = [...roots].filter((r) => !engineRoots.has(r));
      expect(orphans, `${rel} 暂存了引擎不加载的技能目录：${orphans.join(", ")}`).toEqual([]);
      // 直接钉死：脚本里不该再出现 `.omp/skills` 这种斜杠形式（注释已剥）。
      expect(/\.omp[\\/]+skills/.test(src), `${rel} 仍引用已删除的 .omp/skills`).toBe(false);
    }
  });

  test("`.omp/` 目录已从仓库消失", () => {
    expect(fs.existsSync(path.join(REPO, ".omp")), "仓库根又出现了 .omp/ 目录").toBe(false);
  });
});

describe("运行期不再把 .omp 当作读取路径", () => {
  test("bun-backend/src 与 bun-sidecar/src 无源码（剥注释后）以 .omp 目录为读取目标", () => {
    // 判据：`.omp` 后不接 `rc`——放过合法的 .omprc / .omprc.json 同级配置行，
    // 卡住把 `.omp` 当目录（path.join(home, ".omp")、path.join(_, ".omp", "skills")）
    // 或写 `.omp/skills` 字面量路径的死读取（正是 health.ts / capabilities.ts 曾犯的）。
    const re = /\.omp(?!rc)/;
    const offenders: string[] = [];
    for (const dirRel of ["bun-backend/src", "bun-sidecar/src"]) {
      for (const file of tsFiles(dirRel)) {
        if (re.test(stripComments(fs.readFileSync(file, "utf8")))) {
          offenders.push(path.relative(REPO, file).replace(/\\/g, "/"));
        }
      }
    }
    expect(offenders, "以下源码仍把 .omp 当运行期读取路径：\n" + offenders.join("\n")).toEqual([]);
  });
});
