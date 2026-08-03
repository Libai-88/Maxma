// Compile session-bridge into a single-file executable.
//
// The compiled binary embeds the Bun runtime plus the bundled oh-my-pi agent
// code, replacing the 1.1GB node_modules tree + 98MB bun.exe that were
// previously shipped alongside the Python backend.
//
//   bun run build-compiled.mjs
//
// Output: desktop/src-tauri/resources/runtime/maxma-engine.exe
// (kept under resources/runtime so main.rs's resource_dir probe still passes).

import * as fs from "node:fs";
import * as path from "node:path";

// External at compile time. These are lazy / optional native deps of oh-my-pi
// (local embedding & ONNX inference) that Maxma never triggers via
// createAgentSession; leaving them out of the binary keeps it ~120MB instead
// of pulling in transformers.js + onnxruntime (hundreds of MB).
const EXTERNAL = [
  "fastembed",
  "onnxruntime-node",
  "omp-legacy-pi-modules",
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
