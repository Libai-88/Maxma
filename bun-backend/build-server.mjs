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

const result = await Bun.build({
  entrypoints: [path.join(root, "src", "server.ts")],
  target: "bun",
  minify: false,
  throw: false,
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
