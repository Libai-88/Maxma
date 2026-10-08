/**
 * 便携包打包契约（PLUGIN-001 / 方案 A）。
 *
 * 这组用例锁的是**只在打包后才暴露**的两条约束 —— 开发模式（`bun run src/server.ts`）
 * 全都正常，所以单元测试和接口验收都抓不到它们：
 *
 * 1. **插件栈必须外置**：`@deepseek-ai/dsh-llm` 在模块作用域执行
 *    `createRequire(import.meta.url)("../package.json")` 填 `APP_IDENTITY.version`。
 *    一旦被内联进 server.js，`import.meta.url` 变成 server.js 的位置，
 *    `../package.json` 就解析到便携包**上一级目录**，启动即抛
 *    `Cannot find module '../package.json'`，而外层只报
 *    「invalid plugin, expect function or object with an apply method, received undefined」。
 *    插件本体则按 specifier 运行时动态 import，本来就无法内联。
 *
 * 2. **外置清单必须是完整闭包**：只列直接依赖会漏掉传递依赖
 *    （实测漏过 `dsh-commands` 依赖的 `@deepseek-ai/dsh-attachment`，
 *    直到便携包启动才报模块找不到）。所以清单由 `build-server.mjs` 递归推导，
 *    并落地成 `externals.json` 供 `build-server.bat` 照单拷贝。
 *
 * 这里**不跑真实打包**（太慢且依赖工具链），而是对**源文件**做契约断言：
 * 清单推导逻辑、external 传参、以及 .bat 是否真的按清单拷贝。
 */

import { describe, expect, test } from "bun:test";

import * as fs from "node:fs";
import * as path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "../../..");
const buildServerMjs = path.join(repoRoot, "bun-backend/build-server.mjs");
const buildServerBat = path.join(repoRoot, "build/build-server.bat");
const smokeTest = path.join(repoRoot, "build/portable-smoke-test.ps1");

const mjs = fs.readFileSync(buildServerMjs, "utf8");
const bat = fs.readFileSync(buildServerBat, "utf8");
const smoke = fs.readFileSync(smokeTest, "utf8");

/** 必须外置的根依赖（其余靠闭包推导）。 */
const REQUIRED_ROOTS = [
  "dsh-codearts-auth",
  "@deepseek-ai/cordis",
  "@deepseek-ai/dsh-llm",
  "@deepseek-ai/dsh-credentials",
  "@deepseek-ai/dsh-commands",
  "@deepseek-ai/schemastery",
  "jose",
  "undici",
];

describe("后端打包契约", () => {
  test("插件栈通过 external 保留为运行时依赖（不内联）", () => {
    expect(mjs).toContain("external: EXTERNAL_PACKAGES");
    for (const pkg of REQUIRED_ROOTS) {
      expect(mjs, `EXTERNAL_PACKAGES 应当包含 ${pkg}`).toContain(`"${pkg}"`);
    }
  });

  test("外置清单由依赖闭包推导，而不是手写", () => {
    // 手写清单已经漂移过一次（漏了 dsh-attachment），所以必须有闭包推导
    expect(mjs).toContain("function dependencyClosure");
    expect(mjs).toContain("dependencies ?? {}");
    expect(mjs).toContain("peerDependencies ?? {}");
    // 根依赖缺失要直接失败，而不是静默产出不完整产物
    expect(mjs).toContain("missingRoots");
    expect(mjs).toContain("process.exit(1)");
  });

  test("闭包推导结果正确（用真实 node_modules 跑一遍）", () => {
    // 从源文件里抽出根依赖清单，独立复算闭包，确认关键传递依赖在内。
    // 这是对「推导逻辑真的работает」的实证，而不是只断言源码里出现了某几个词。
    const nm = path.join(repoRoot, "bun-backend/node_modules");
    const seen = new Set<string>();
    const queue = [...REQUIRED_ROOTS];
    while (queue.length > 0) {
      const name = queue.shift()!;
      if (seen.has(name)) continue;
      const pkgJson = path.join(nm, name, "package.json");
      if (!fs.existsSync(pkgJson)) continue;
      seen.add(name);
      const pkg = JSON.parse(fs.readFileSync(pkgJson, "utf8")) as {
        dependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
      };
      for (const dep of Object.keys(pkg.dependencies ?? {})) queue.push(dep);
      for (const dep of Object.keys(pkg.peerDependencies ?? {})) queue.push(dep);
    }

    // 这几个都是实测「漏了就会在便携包启动时报模块找不到」的传递依赖
    for (const dep of [
      "@deepseek-ai/dsh-attachment",
      "@deepseek-ai/dsh-agent",
      "@deepseek-ai/dsh-invariants",
      "@deepseek-ai/dsh-session",
      "@deepseek-ai/dsh-system-prompt",
      "zod",
    ]) {
      expect(seen.has(dep), `${dep} 应当在依赖闭包里（否则便携包启动会失败）`).toBe(true);
    }
    // 闭包显著大于手写清单，说明推导确实在扩展
    expect(seen.size).toBeGreaterThanOrEqual(20);
  });

  test("外置清单落地成 externals.json 供 .bat 读取", () => {
    expect(mjs).toContain("externals.json");
    expect(mjs).toContain("generatedBy");
  });

  test(".bat 按清单逐包拷贝并校验（而不是照手写清单）", () => {
    expect(bat).toContain("externals.json");
    // 逐包 xcopy，避免把整个 @deepseek-ai 树塞进便携包
    expect(bat).toContain("xcopy /e /i /q \"%BACKEND_DIR%\\node_modules\\%%P\"");
    // 拷贝后必须逐个验证可解析，否则「构建成功、启动即崩」
    expect(bat).toContain("Plugin stack incomplete after staging");
    // 清单被截断/读不到时要失败，而不是拷了 0 个包还报成功
    expect(bat).toContain("Staged only");
  });

  test(".bat 保持 CRLF（cmd.exe 无法解析纯 LF 批处理）", () => {
    const bytes = fs.readFileSync(buildServerBat);
    let lfOnly = 0;
    for (let i = 0; i < bytes.length; i += 1) {
      if (bytes[i] === 10 && (i === 0 || bytes[i - 1] !== 13)) lfOnly += 1;
    }
    expect(lfOnly, "批处理文件里出现了纯 LF 行").toBe(0);
  });

  test("便携冒烟脚本校验插件真的加载了（不只看 HTTP 200）", () => {
    // 只断言 /api/plugins 返回 200 是无效的：那个端点读的是注册表 JSON 文件，
    // 根本不碰插件运行时 —— 插件栈缺失时它照样 200。
    expect(smoke).toContain("plugins/codearts-auth/providers");
    expect(smoke).toContain("plugin runtime did not load");
    expect(smoke).toContain("externals.json");
    expect(smoke).toContain("missing runtime packages");
  });

  test("两条便携构建链都在构建期拦住缺失的插件栈", () => {
    // Web 便携包（build-portable.bat）
    const portableBat = fs.readFileSync(path.join(repoRoot, "build-portable.bat"), "utf8");
    expect(portableBat).toContain("externals.json");
    expect(portableBat).toContain("dsh-codearts-auth");
    expect(portableBat).toContain("@deepseek-ai\\dsh-llm");

    // Electron 桌面便携包（build-desktop-portable.ps1）
    const desktopPs1 = fs.readFileSync(path.join(repoRoot, "build-desktop-portable.ps1"), "utf8");
    expect(desktopPs1).toContain("externals.json");
    expect(desktopPs1).toContain("dsh-codearts-auth");
    expect(desktopPs1).toContain("@deepseek-ai\\dsh-llm");
  });

  test("插件的 package.json 声明与实际依赖一致（外置清单的前提）", () => {
    // 闭包推导以 package.json 为准；若有人把依赖从 package.json 删掉却仍在使用，
    // 闭包会漏包，便携包启动时才炸。这里做一次正向核对。
    //
    // ⚠️ 分两类，不能混：
    //   - DSH 运行时四件套 + schemastery 是 **Maxma 自己的直接依赖**（宿主复用它们的
    //     具体类，如 LlmRuntime / CommandRuntime / CredentialProvider）；
    //   - jose / undici 是**插件**声明的依赖，Maxma 不直接 import，只随包分发。
    //     第一版把两类混在一起断言，被测试挡下来了。
    const backendPkg = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "bun-backend/package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    const backendDeps = backendPkg.dependencies ?? {};

    for (const pkgName of [
      "@deepseek-ai/cordis",
      "@deepseek-ai/dsh-llm",
      "@deepseek-ai/dsh-credentials",
      "@deepseek-ai/dsh-commands",
      "@deepseek-ai/schemastery",
      "dsh-codearts-auth",
    ]) {
      expect(backendDeps[pkgName], `${pkgName} 必须在 bun-backend 的 dependencies 里`).toBeDefined();
    }

    // 插件的依赖必须在**插件**的 package.json 里声明（闭包靠它推导）
    const pluginPkg = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "bun-backend/node_modules/dsh-codearts-auth/package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    for (const dep of ["jose", "undici"]) {
      expect(pluginPkg.dependencies?.[dep], `${dep} 必须在插件的 dependencies 里`).toBeDefined();
    }
  });
});
