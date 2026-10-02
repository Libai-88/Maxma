import * as path from "node:path";

/** Resolve Maxma's writable data root when launched from bun-backend. */
export function maxmaDataRoot(): string {
  return path.resolve(
    process.env.MAXMA_DATA_DIR ??
      process.env.MAXMA_PROJECT_ROOT ??
      path.join(import.meta.dir, "../../.."),
  );
}

/** Resolve bundled read-only assets, with the project root as development fallback. */
export function maxmaBundleRoot(): string {
  return path.resolve(
    process.env.MAXMA_BUNDLE_DIR ??
      process.env.MAXMA_PROJECT_ROOT ??
      path.join(import.meta.dir, "../../.."),
  );
}

/** Backward-compatible alias for callers that need the data root. */
export const maxmaProjectRoot = maxmaDataRoot;
