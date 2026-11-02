/**
 * tests/_helpers/auth.ts — 测试里读 auth token 的共享实现。
 *
 * ## 为什么要有这个文件
 *
 * 13 个测试文件各自手搓了一份 `bun:sqlite` 的**类型桩**：
 *
 *   const { Database } = require("bun:sqlite") as {
 *     Database: new (p: string, o?: object) => { query: (s: string) => { get: () => … } };
 *   };
 *
 * 那份桩缺 `close`，于是每个文件最后一行 `db.close()` 都报 TS2339——
 * 12 处同源错误、改一次要动 12 个文件，而且下次再有人手搓还会再犯。
 * 更根本的是：**这些类型是编造的**，不是 bun 真实提供的；编造的桩迟早与
 * 真实 API 漂移（本次就是漏了 `close`，而这个错误长期没人看见，
 * 因为 CI 从不跑 tsc）。
 *
 * 现在只在这里写一次，并用 `typeof import("bun:sqlite")` 取**真实类型**——
 * bun 的类型由 `@types/bun` 提供，不再是手抄。
 *
 * 注意：`require` 是运行时调用（测试里同步读 token 需要同步 API），
 * 类型断言则完全交给编译器从真实模块推导。
 */

type BunSqliteModule = typeof import("bun:sqlite");

/** 同步打开一个只读 sqlite 并返回最近一条 auth token；失败返回空串（测试自行断言）。 */
export function readLatestAuthToken(dbPath: string): string {
  const { Database } = require("bun:sqlite") as BunSqliteModule;
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.query("SELECT token FROM auth_tokens ORDER BY id DESC LIMIT 1").get() as
      | { token?: string }
      | null;
    return row?.token ?? "";
  } catch {
    // 表还没建（例如某测试只起了 /api/health）：返回空串，交给调用方判断
    return "";
  } finally {
    db.close();
  }
}

/** 该测试常用的鉴权头构造：读 token 并包成 `x-maxma-token`。 */
export function authHeaderFor(dataDir: string): Record<string, string> {
  const path = require("node:path") as typeof import("node:path");
  const token = readLatestAuthToken(path.join(dataDir, "api", "data", "maxma.db"));
  return { "x-maxma-token": token };
}
