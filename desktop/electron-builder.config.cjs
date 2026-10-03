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
  ],
  asar: true,
  artifactName: "MaxmaHere-${version}-portable-${arch}.${ext}",
  win: {
    signAndEditExecutable: false,
    target: [{ target: "zip", arch: ["x64"] }],
  },
};
