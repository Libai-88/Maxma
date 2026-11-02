const path = require("node:path");
const fs = require("node:fs");

const runtimeDir = process.env.MAXMA_ELECTRON_RUNTIME_DIR;
const outputDir = process.env.MAXMA_ELECTRON_OUTPUT_DIR;
const runtimeModulesDir = path.join(runtimeDir || "", "node_modules");
if (!runtimeDir || !path.isAbsolute(runtimeDir)) {
  throw new Error("MAXMA_ELECTRON_RUNTIME_DIR must be an absolute path on the build drive.");
}
if (!outputDir || !path.isAbsolute(outputDir)) {
  throw new Error("MAXMA_ELECTRON_OUTPUT_DIR must be an absolute path on the build drive.");
}

// These are first-run product defaults, so a desktop build is invalid without both.
const builtInPersonas = ["SOUL.md", "SOUL.饱饱.md"];
for (const filename of builtInPersonas) {
  const personaPath = path.join(runtimeDir, "config", "personas", filename);
  if (!fs.existsSync(personaPath) || !fs.statSync(personaPath).isFile()) {
    throw new Error(`Required built-in persona is missing from the desktop runtime: ${personaPath}`);
  }
}

// 插件栈（PLUGIN-001）：这些包**刻意不打进 server.js**（见 bun-backend/build-server.mjs），
// 必须逐个随包。清单由 build-server.mjs 从 package.json 递归推导并写成 externals.json ——
// 这里读同一份清单，不手写（手写必然漂移）。
//
// ⚠️ 下面 extraResources 的第一条 filter 显式排除了 node_modules（`!node_modules/{**/*}`），
// 所以**只有在这里显式列出的包才会进包**。这里曾经漏掉整个插件栈：
// 产物照常生成，但用户装上后插件静默不工作。
const externalsManifest = path.join(runtimeDir, "externals.json");
if (!fs.existsSync(externalsManifest)) {
  throw new Error(
    `Missing plugin dependency manifest: ${externalsManifest}（bun-backend/build-server.mjs 应当生成它）`,
  );
}
const externalPackages = JSON.parse(fs.readFileSync(externalsManifest, "utf8")).packages;
if (!Array.isArray(externalPackages) || externalPackages.length < 20) {
  throw new Error(
    `Plugin dependency manifest looks truncated (${externalPackages && externalPackages.length} entries): ${externalsManifest}`,
  );
}
for (const name of externalPackages) {
  if (!fs.existsSync(path.join(runtimeModulesDir, name, "package.json"))) {
    throw new Error(`Plugin dependency not staged into the desktop runtime: ${name}`);
  }
}

module.exports = {
  appId: "com.maxmahere.desktop",
  electronDist: path.join(__dirname, "node_modules", "electron", "dist"),
  productName: "MaxmaHere",
  directories: {
    output: outputDir,
    buildResources: "build",
  },
  files: ["electron/**", "package.json"],
  extraResources: [
    {
      from: runtimeDir,
      to: "maxma",
      filter: ["**/*", "!node_modules/{**/*}"],
    },
    // 显式复制 sharp 及其平台原生 libvips，避免便携包构建时被依赖过滤器遗漏。
    ...["sharp", "@img/sharp-win32-x64", "@img/colour", "detect-libc", "semver"]
      .map((name) => ({
        from: path.join(runtimeModulesDir, name),
        to: path.join("maxma", "node_modules", name),
        filter: ["**/*"],
      })),
    // 插件栈：照 externals.json 逐包复制（与 build-server.bat 同一份真源）。
    ...externalPackages.map((name) => ({
      from: path.join(runtimeModulesDir, name),
      to: path.join("maxma", "node_modules", name),
      filter: ["**/*"],
    })),
  ],
  asar: true,
  artifactName: "MaxmaHere-${version}-portable-${arch}.${ext}",
  win: {
    signAndEditExecutable: false,
    target: [{ target: "zip", arch: ["x64"] }],
  },
};
