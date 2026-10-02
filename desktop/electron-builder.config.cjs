const path = require("node:path");

const runtimeDir = process.env.MAXMA_ELECTRON_RUNTIME_DIR;
const outputDir = process.env.MAXMA_ELECTRON_OUTPUT_DIR;
if (!runtimeDir || !path.isAbsolute(runtimeDir)) {
  throw new Error("MAXMA_ELECTRON_RUNTIME_DIR must be an absolute path on the build drive.");
}
if (!outputDir || !path.isAbsolute(outputDir)) {
  throw new Error("MAXMA_ELECTRON_OUTPUT_DIR must be an absolute path on the build drive.");
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
      filter: ["**/*"],
    },
  ],
  asar: true,
  artifactName: "MaxmaHere-${version}-portable-${arch}.${ext}",
  win: {
    signAndEditExecutable: false,
    target: [{ target: "zip", arch: ["x64"] }],
  },
};
