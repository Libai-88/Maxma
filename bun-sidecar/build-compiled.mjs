// Compile session-bridge into a single-file executable.
//
// The compiled binary embeds the Bun runtime plus the bundled pi agent code
// (@earendil-works/pi-coding-agent), replacing the node_modules tree +
// bun.exe that were previously shipped alongside the Python backend.
//
//   bun run build-compiled.mjs
//
// Output: desktop/src-tauri/resources/runtime/maxma-engine.exe
// (kept under resources/runtime so main.rs's resource_dir probe still passes).

import * as fs from "node:fs";
import * as path from "node:path";

// External at compile time. Optional native deps never triggered by Maxma
// sessions (local embedding & ONNX inference); keeping them external keeps
// the binary small instead of pulling transformers.js + onnxruntime.
const EXTERNAL = [
  "fastembed",
  "onnxruntime-node",
];

const outfile = path.resolve(
  import.meta.dir,
  "..",
  "desktop",
  "src-tauri",
  "resources",
  "runtime",
  "maxma-engine.exe",
);

fs.mkdirSync(path.dirname(outfile), { recursive: true });

const result = await Bun.build({
  entrypoints: [path.join(import.meta.dir, "src", "session-bridge.ts")],
  root: import.meta.dir,
  external: EXTERNAL,
  define: {
    "process.env.MAXMA_SIDECAR_COMPILED": JSON.stringify("1"),
  },
  compile: { outfile },
  throw: false,
});

if (!result.success) {
  console.error(
    "sidecar compile failed:\n" +
      (result.logs || []).map((l) => l.message).join("\n"),
  );
  process.exit(1);
}

const bytes = fs.statSync(outfile).size;
console.log(
  `[compile] maxma-engine.exe ${(bytes / 1024 / 1024).toFixed(1)}MB -> ${outfile}`,
);
