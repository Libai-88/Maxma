import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { Database } from "bun:sqlite";

let dataDir = "";
let previousDataDir: string | undefined;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join("D:\\MaxmaTemp", "maxma-llm-migration-"));
  previousDataDir = process.env.MAXMA_DATA_DIR;
  process.env.MAXMA_DATA_DIR = dataDir;
  fs.mkdirSync(path.join(dataDir, "api", "data"), { recursive: true });
});

afterEach(() => {
  if (previousDataDir === undefined) delete process.env.MAXMA_DATA_DIR;
  else process.env.MAXMA_DATA_DIR = previousDataDir;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("LLM usage schema migration", () => {
  test("upgrades an existing v7 database without altering its version history", async () => {
    const dbPath = path.join(dataDir, "api", "data", "maxma.db");
    const db = new Database(dbPath);
    db.exec("CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at REAL NOT NULL)");
    db.query("INSERT INTO schema_version (version, applied_at) VALUES (7, julianday('now'))").run();
    db.close();

    const { initializeDatabase } = await import("../src/db/core");
    initializeDatabase();

    const migrated = new Database(dbPath, { readonly: true });
    try {
      const version = migrated.query("SELECT MAX(version) AS version FROM schema_version").get() as { version: number };
      const columns = migrated.query("PRAGMA table_info(llm_usage_calls)").all() as Array<{ name: string }>;
      expect(version.version).toBe(8);
      expect(columns.map((column) => column.name)).toContain("source_entry_id");
      expect(columns.map((column) => column.name)).toContain("cache_observation_status");
    } finally {
      migrated.close();
    }
  });
});
