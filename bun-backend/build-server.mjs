// 打包 Bun 后端为可分发的 server.js（bundle 路线）。
//
// 为什么不用 `bun build --compile`：sharp（贴纸上传的图片转换）依赖 libvips
// 原生 DLL + 平台包动态 require，编译产物的虚拟 FS 无法解析 → 启动即崩。
// bundle 路线：`--target bun` 产出普通 JS，原生件保留为运行时 require，
// 随包携带 node_modules（sharp 及其原生依赖）即可正常工作。
//
//   bun run build-server.mjs
//
// 产物：dist/bun-server/server.js（入口）；调用方负责把 bun.exe 与
// node_modules 子集放到同一目录（见 build-server.bat）。

import * as fs from "node:fs";
import * as path from "node:path";

const root = import.meta.dir;
const outDir = path.resolve(root, "..", "dist", "bun-server");
const outfile = path.join(outDir, "server.js");

fs.mkdirSync(outDir, { recursive: true });
if (fs.existsSync(outfile)) fs.rmSync(outfile, { force: true });

/**
 * 必须**保留为运行时依赖**（不打进 server.js）的包。
 *
 * 这是插件子系统（PLUGIN-001）带来的硬约束，实测踩到才明白：
 *
 * 1. **`@deepseek-ai/dsh-llm`**：它在模块作用域执行
 *    `createRequire(import.meta.url)("../package.json")` 来填 `APP_IDENTITY.version`。
 *    一旦被内联进 server.js，`import.meta.url` 变成 server.js 的位置，
 *    `../package.json` 就解析到**便携包上一级目录**，启动即抛
 *    `Cannot find module '../package.json'` —— 而外层表现为
 *    「invalid plugin, expect function or object with an apply method, received undefined」，
 *    完全看不出是版本号读取引起的。保留在 node_modules 里，路径就自然成立。
 *
 * 2. **插件本体（`dsh-codearts-auth`）**：它按 specifier 在运行时动态 import
 *    （见 plugins/dsh/host.ts 的 loadModule），且带 646 个文件、含运行时读取的
 *    `.wasm` 与 locale JSON —— 内联既做不到也不该做。
 *
 * 3. **整条传递依赖闭包**：这些 DSH 包彼此引用、且都按包内相对路径读资源。
 *    只外置直接依赖会漏掉传递依赖（实测：手写 14 个包，漏了 dsh-commands 依赖的
 *    `@deepseek-ai/dsh-attachment`，启动时才报模块找不到）。
 *    所以这里**从 package.json 递归求闭包**，不手写清单。
 *
 * ⚠️ 外置的代价是 `build-server.bat` 必须把这些包拷进产物 node_modules，
 *    且两边清单必须一致 —— 因此闭包会**写进一个清单文件**供 .bat 读取，
 *    避免「.mjs 里改了、.bat 没跟上」这种只在打包后才暴露的漂移。
 */
const PLUGIN_ROOTS = [
  // 插件本体（运行时按 specifier 动态 import）
  "dsh-codearts-auth",
  // DSH 运行时四件套（插件的 import 依赖 + 宿主复用它们的具体类）
  "@deepseek-ai/cordis",
  "@deepseek-ai/dsh-llm",
  "@deepseek-ai/dsh-credentials",
  "@deepseek-ai/dsh-commands",
  "@deepseek-ai/schemastery",
  // 插件声明的直接依赖
  "jose",
  "undici",
];

/** 递归求依赖闭包（dependencies + peerDependencies）。 */
function dependencyClosure(roots, nodeModulesDir) {
  const seen = new Set();
  const missing = [];
  const queue = [...roots];
  while (queue.length > 0) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    const pkgJson = path.join(nodeModulesDir, name, "package.json");
    if (!fs.existsSync(pkgJson)) {
      // peerDependencies 里可能有本仓未安装的包（如 cordis-plugin-loader），
      // 它们不是运行时必需，记为 missing 由调用方决定是否致命。
      if (roots.includes(name)) missing.push(name);
      continue;
    }
    seen.add(name);
    const pkg = JSON.parse(fs.readFileSync(pkgJson, "utf8"));
    for (const dep of Object.keys(pkg.dependencies ?? {})) queue.push(dep);
    for (const dep of Object.keys(pkg.peerDependencies ?? {})) queue.push(dep);
  }
  return { packages: [...seen].sort(), missingRoots: missing };
}

const { packages: EXTERNAL_PACKAGES, missingRoots } = dependencyClosure(
  PLUGIN_ROOTS,
  path.join(root, "node_modules"),
);
if (missingRoots.length > 0) {
  console.error(
    `[bundle] ERROR: 插件栈的根依赖未安装：${missingRoots.join(", ")}\n` +
      "  请先执行：cd bun-backend && bun install",
  );
  process.exit(1);
}

const result = await Bun.build({
  entrypoints: [path.join(root, "src", "server.ts")],
  target: "bun",
  minify: false,
  throw: false,
  external: EXTERNAL_PACKAGES,
});

if (!result.success) {
  console.error(
    "bun server bundle failed:\n" + (result.logs || []).map((l) => l.message).join("\n"),
  );
  process.exit(1);
}

// Bun.build() does not write to disk; persist each output explicitly.
// output.path is a relative name (e.g. "./server.js"); basename it into outDir.
for (const output of result.outputs) {
  const dest = path.join(outDir, path.basename(output.path));
  await Bun.write(dest, output);
}

const bytes = fs.statSync(outfile).size;
console.log(`[bundle] server.js ${(bytes / 1024 / 1024).toFixed(1)}MB -> ${outfile}`);

// 自检：外置包必须**没有**被内联。若哪天有人手滑把某个包从 external 里删掉，
// 这里会立刻报出来，而不是等到便携包启动时才炸。
//
// ⚠️ 标记词必须是**包内独有且只出现在实现里**的片段。第一版用了 `ProxyAgent`
// 去查 undici，结果误报 —— 那个词在别的库的**错误提示文案**里出现了 24 次
//（「pass the fetch implementation from the same undici package…」）。
// 挑标记词时先在产物里数一遍命中上下文，别用会出现在文案里的名字。
const bundled = fs.readFileSync(outfile, "utf8");
const INLINE_MARKERS = {
  "dsh-codearts-auth": "PERMANENT_LOCK_PROVIDERS",
  "@deepseek-ai/dsh-llm": "AGENT_LOOP_REQUESTS",
  "@deepseek-ai/cordis": "reflect.provide",
  "@deepseek-ai/dsh-credentials": "credentialKeyScope",
  "@deepseek-ai/dsh-commands": "CommandDefinitionId",
  "@deepseek-ai/schemastery": "Schema.object",
  jose: "FlattenedSign",
  undici: "kInterceptors",
  "@deepseek-ai/cosmokit": "cosmokit",
  "@deepseek-ai/dsh-timeout": "dsh-timeout",
  "@deepseek-ai/dsh-util-values": "dsh-util-values",
  "@deepseek-ai/dsh-typert-protocol": "dsh-typert-protocol",
  "@deepseek-ai/dsh-brand": "dsh-brand",
  "@deepseek-ai/dsh-util-crypto": "dsh-util-crypto",
};
const leaked = EXTERNAL_PACKAGES.filter((pkg) => {
  const marker = INLINE_MARKERS[pkg];
  return typeof marker === "string" && bundled.includes(marker);
});
if (leaked.length > 0) {
  console.error(
    `[bundle] ERROR: 下列包本应外置却被内联进 server.js：${leaked.join(", ")}\n` +
      "  它们依赖包内相对路径（如 dsh-llm 读 ../package.json），内联后会在启动时崩。\n" +
      "  请检查 EXTERNAL_PACKAGES 是否被改动。",
  );
  process.exit(1);
}
console.log(`[bundle] externals OK (${EXTERNAL_PACKAGES.length} 个包保留为运行时依赖)`);

/**
 * 把外置清单写到产物目录，供 `build-server.bat` 读取。
 *
 * 为什么要落地成文件：`.bat` 需要逐包 xcopy，而包清单由这里的依赖闭包推导 ——
 * 两边各写一份必然漂移（实测就漏过 `@deepseek-ai/dsh-attachment`）。
 * 写成清单后，`.bat` 只负责「照着拷 + 拷完验」，清单的唯一来源是这里。
 */
const manifestPath = path.join(outDir, "externals.json");
await Bun.write(
  manifestPath,
  JSON.stringify(
    { generatedBy: "bun-backend/build-server.mjs", packages: EXTERNAL_PACKAGES },
    null,
    2,
  ) + "\n",
);
console.log(`[bundle] externals manifest -> ${manifestPath}`);
