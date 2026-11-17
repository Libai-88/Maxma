/**
 * routes/extensions.ts — 扩展清单与启停（EXT-VISIBLE-001 / EXT-TOGGLE-001）。
 *
 * 使命对齐：pi 的扩展能力要在 Maxma 上"看得见、控得住"，且界面不撒谎。
 *   - GET  /api/extensions           最近一次会话真实加载到的扩展 + 错误/警告
 *   - POST /api/extensions/refresh   显式重新探测（不建会话）
 *   - PUT  /api/extensions           启用/禁用某条用户扩展（写 api/data/disabled_extensions.json）
 *
 * 安全边界（务必与 UI 文案一致）：
 *   - 只有 `<agentDir>/extensions` 下的用户扩展可禁用；Maxma 内联的审批/拒止/
 *     遥测扩展硬拒（禁用审批扩展 = 静默关掉审批门，属于安全回归）。
 *   - 扩展代码与当前会话同权限运行；禁用只影响**之后新建**的会话，
 *     因为扩展在会话创建时加载并绑定。
 *   - 禁用是"不参与会话"，不是沙箱：模块顶层代码在加载期仍会被 import。
 */

import { Hono } from "hono";

import {
  defaultAgentDir,
  extensionsDirFor,
  getLastExtensionsSnapshot,
  type ExtensionsSnapshot,
} from "../../../bun-sidecar/src/kernel/extensions";
import { probeExtensionsSnapshot } from "../../../bun-sidecar/src/kernel/pi-session";
import { maxmaProjectRoot } from "../../../bun-sidecar/src/kernel/project-paths";
import {
  isValidExtensionId,
  readDisabledExtensions,
  setExtensionEnabled,
} from "../extensions-config";

/** 内置扩展（内联工厂）——恒装配，不可禁用。列出名字是为了让 UI 不装作没有。 */
const PROTECTED_BUNDLED = ["maxma-approval", "maxma-blocker", "request-telemetry"];

interface ExtensionsPayload {
  agent_dir: string;
  extensions_dir: string;
  /** 是否有真实加载结果（false = 进程内还没建过会话）。 */
  loaded: boolean;
  loaded_at: number | null;
  /** 本次数据来自显式探测（装配面只有拒止锚 + 用户扩展）。 */
  probe: boolean;
  extensions: ExtensionsSnapshot["extensions"];
  errors: ExtensionsSnapshot["errors"];
  warnings: ExtensionsSnapshot["warnings"];
  disabled: string[];
  protected_bundled: string[];
  /** UI 文案用的边界说明，后端与前端同源，避免两处各写一套。 */
  notes: string[];
}

const NOTES = [
  "扩展以与当前会话相同的系统权限运行；启用前请确认来源可信。",
  "启用/禁用只影响之后新建的会话，当前会话保持创建时的扩展集合。",
  "禁用是把它排除出会话（不注册 handler/tool），不是沙箱隔离。",
  "Maxma 内置的审批、拒止、遥测扩展不可禁用。",
];

function payloadFromSnapshot(
  snapshot: ExtensionsSnapshot | null,
  opts: { probe: boolean; agentDir: string },
): ExtensionsPayload {
  const disabled = readDisabledExtensions();
  if (!snapshot) {
    return {
      agent_dir: opts.agentDir,
      extensions_dir: extensionsDirFor(opts.agentDir),
      loaded: false,
      loaded_at: null,
      probe: opts.probe,
      extensions: [],
      errors: [],
      warnings: [],
      disabled,
      protected_bundled: PROTECTED_BUNDLED,
      notes: NOTES,
    };
  }
  return {
    agent_dir: snapshot.agent_dir,
    extensions_dir: snapshot.extensions_dir,
    loaded: true,
    loaded_at: snapshot.loaded_at,
    probe: opts.probe,
    extensions: snapshot.extensions,
    errors: snapshot.errors,
    warnings: snapshot.warnings,
    disabled,
    protected_bundled: PROTECTED_BUNDLED,
    notes: NOTES,
  };
}

export function createExtensionsRoutes(): Hono {
  const app = new Hono();

  app.get("/api/extensions", (c) => {
    const snapshot = getLastExtensionsSnapshot();
    return c.json(payloadFromSnapshot(snapshot, { probe: false, agentDir: defaultAgentDir() }));
  });

  // 显式探测：不建会话，只走一次资源加载，把用户扩展的错误暴露出来。
  app.post("/api/extensions/refresh", async (c) => {
    const snapshot = await probeExtensionsSnapshot({
      cwd: maxmaProjectRoot(),
      disabledExtensions: readDisabledExtensions(),
    });
    return c.json(payloadFromSnapshot(snapshot, { probe: true, agentDir: snapshot.agent_dir }));
  });

  // 启用/禁用。body: { id: string, enabled: boolean }
  app.put("/api/extensions", async (c) => {
    let body: { id?: unknown; enabled?: unknown };
    try {
      body = (await c.req.json()) as { id?: unknown; enabled?: unknown };
    } catch {
      return c.json({ detail: "请求体必须是 JSON" }, 400);
    }
    const id = body.id;
    if (!isValidExtensionId(id)) {
      return c.json({ detail: "扩展 id 不合法：只接受 extensions 目录下的相对路径（如 hello.ts / team/tool.ts）" }, 400);
    }
    const enabled = body.enabled;
    if (typeof enabled !== "boolean") {
      return c.json({ detail: "enabled 必须是布尔值" }, 400);
    }
    // 内置扩展硬拒：即使伪造请求也写不进去（isValidExtensionId 已挡掉 `<inline:…>`，
    // 这里再按名字兜一层，防止未来出现同名用户文件）。
    const baseName = id.split(/[\\/]+/).pop()!.replace(/\.(ts|js|mts|cts|cjs|mjs)$/i, "");
    if (PROTECTED_BUNDLED.includes(baseName)) {
      return c.json({ detail: `内置扩展 ${baseName} 属于安全机制，不允许禁用` }, 403);
    }

    try {
      setExtensionEnabled(id, enabled);
    } catch (error) {
      const status = (error as { status?: 400 | 403 | 500 }).status ?? 500;
      return c.json({ detail: String((error as Error).message ?? error) }, status);
    }

    // 立即重探测：让界面看到真实结果（写盘 ≠ 生效，生效点在下一次 load）。
    const snapshot = await probeExtensionsSnapshot({
      cwd: maxmaProjectRoot(),
      disabledExtensions: readDisabledExtensions(),
    });
    return c.json(payloadFromSnapshot(snapshot, { probe: true, agentDir: snapshot.agent_dir }));
  });

  return app;
}
