/**
 * kernel/extension-ui.ts — 把 pi 扩展的 `ctx.ui` 桥接到前端（EXT-UI-001）。
 *
 * ## 为什么需要
 *
 * pi 的扩展通过 `ctx.ui.select/confirm/input/editor/notify` 与用户交互。
 * 宿主必须提供 `ExtensionUIContext`，否则 `ExtensionRunner` 回落到
 * `noOpUIContext`——而它的 `confirm` **恒返回 `false`**（`dist/core/extensions/runner.js`）。
 *
 * 这不是"少一个功能"，是**行为错误**：pi 官方示例里的 `confirm-destructive.ts`
 * （删除前确认）在 Maxma 里会静默拒绝一切操作，不报错、不留痕，用户完全看不出
 * 原因。所以在接扩展体系之前，UI 上下文是必须先补的地基。
 *
 * ## 形状
 *
 * 与 `approval-gate.ts` 同构（emit 事件 → Promise → 超时 → RPC 兑现），
 * 不新建第二套交互机制：
 *   - 出站：`extension_ui_request { id, method, title, ... }`
 *   - 入站：`extension_ui_response { id, value? / confirmed? / cancelled? }`（RPC）
 *
 * ## 与审批门的区别（别合并）
 *
 * 审批门回答的是"这次工具调用能不能跑"，语义是安全边界，超时默认**拒绝**；
 * 扩展 UI 回答的是"这个扩展想问你一件事"，语义是通用交互，超时按官方默认值
 * 回填（`select`/`input` → `undefined`，`confirm` → `false`）。
 * 合并会让两类超时语义互相污染。
 */

import type { ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";

import type { MaxmaEventLike } from "./events";

/**
 * 扩展 `ctx.ui.theme` 的取值。
 *
 * 类型要求 `readonly theme: Theme`（非可选），而 `Theme` 是**终端 ANSI 主题**。
 * Web 壳没有任何渲染会用到它，但扩展可能读（自建 TUI 组件时取色）。
 *
 * 为什么用 Proxy 而不是构造真实 Theme：`new Theme(fgColors, bgColors, mode)`
 * 需要两整套完整色值表，为一个壳永远不渲染的对象扛这份依赖不值得。
 * Proxy 让**任何属性访问都返回空串**——扩展拿到的不是 undefined，不会当场崩；
 * 真要渲染 TUI 组件时那些空色值也无意义（Web 壳里本就没有 TUI 渲染面）。
 */
const fallbackTheme = new Proxy({} as Theme, {
  get: (_target, prop) => {
    // 少数调用点会做 `theme.name` 之类的读取并参与判断，给空串最安全。
    if (prop === "name") return "maxma-web";
    return "";
  },
});

/** 对话框方法（需要回应）。fire-and-forget 方法另列。 */
export type ExtensionDialogMethod = "select" | "confirm" | "input" | "editor";

/** 前端回填的一条应答。 */
export interface ExtensionUiReply {
  value?: string;
  confirmed?: boolean;
  cancelled?: boolean;
}

/** 官方默认超时语义：到期后 select/input/editor 返回 undefined，confirm 返回 false。 */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

interface PendingDialog {
  resolve: (reply: ExtensionUiReply) => void;
  timer: ReturnType<typeof setTimeout>;
  /** 超时时该回填什么（按方法不同）。 */
  onTimeout: () => ExtensionUiReply;
}

export interface ExtensionUiBridge {
  /**
   * 完整的官方 `ExtensionUIContext`。
   *
   * ⚠️ 必须是**完整**实现：类型要求 24 个方法。只实现对话框 5 个会 tsc 报错，
   * 而绕过类型（`as unknown as`）会让扩展在调用 TUI 方法时拿到 undefined 而崩。
   * 所以 TUI 专属方法一律给安全的 no-op / 空值——这与 pi 官方 RPC 模式的降级
   * 表（docs/rpc-extension-ui.md「Limitations」）逐条对齐。
   */
  uiContext: ExtensionUIContext;
  /** extension_ui_response 到达：兑现对应对话框。返回是否命中在途请求。 */
  resolve(id: string, reply: ExtensionUiReply): boolean;
  /** 在途对话框数（health / 调试）。 */
  pendingCount(): number;
  /** 会话销毁时清空，防止 promise 泄漏挂住扩展 handler。 */
  rejectAll(): void;
}

export interface CreateExtensionUiBridgeDeps {
  /** 发射事件（bridge 绑定 session_id 后传入）。 */
  emit: (event: MaxmaEventLike) => void;
  /** 默认超时（毫秒）；官方对话框可自带 timeout 覆盖。 */
  timeoutMs?: number;
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `ui-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createExtensionUiBridge(deps: CreateExtensionUiBridgeDeps): ExtensionUiBridge {
  const pending = new Map<string, PendingDialog>();
  const fallbackTimeout = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  /**
   * 发一个对话框请求并等应答。
   * `onTimeout` 决定超时回填值——官方语义里只有 confirm 是 false，其余是 undefined。
   */
  function ask(
    method: ExtensionDialogMethod,
    title: string,
    extra: Record<string, unknown>,
    opts: { timeout?: number; signal?: AbortSignal } | undefined,
    onTimeout: () => ExtensionUiReply,
  ): Promise<ExtensionUiReply> {
    return new Promise<ExtensionUiReply>((resolve) => {
      const id = newId();
      const ms = opts?.timeout && opts.timeout > 0 ? opts.timeout : fallbackTimeout;

      const finish = (reply: ExtensionUiReply): void => {
        const entry = pending.get(id);
        if (!entry) return;
        clearTimeout(entry.timer);
        pending.delete(id);
        resolve(reply);
      };

      const entry: PendingDialog = {
        resolve: finish,
        timer: setTimeout(() => finish(onTimeout()), ms),
        onTimeout,
      };
      pending.set(id, entry);

      // 官方 signal：扩展可主动撤下对话框（如用户已切走页面）。
      opts?.signal?.addEventListener("abort", () => finish({ cancelled: true }), { once: true });

      deps.emit({
        type: "extension_ui_request",
        payload: { id, method, title, timeout: ms, ...extra },
      });
    });
  }

  const uiContext: ExtensionUIContext = {
    async select(title, options, opts) {
      const r = await ask("select", title, { options }, opts, () => ({ cancelled: true }));
      return r.cancelled ? undefined : r.value;
    },

    async confirm(title, message, opts) {
      const r = await ask("confirm", title, { message }, opts, () => ({ confirmed: false }));
      return r.confirmed === true;
    },

    async input(title, placeholder, opts) {
      const r = await ask("input", title, { placeholder: placeholder ?? "" }, opts, () => ({ cancelled: true }));
      return r.cancelled ? undefined : r.value;
    },

    async editor(title, prefill) {
      const r = await ask("editor", title, { prefill: prefill ?? "" }, undefined, () => ({ cancelled: true }));
      return r.cancelled ? undefined : r.value;
    },

    notify(message, type) {
      // fire-and-forget：不等应答，前端收到即弹提示。
      deps.emit({
        type: "extension_ui_request",
        payload: { id: newId(), method: "notify", title: message, notify_type: type ?? "info" },
      });
    },

    // ── 以下为 TUI 专属方法，Web 壳没有对应概念 ──
    //
    // 逐条对齐 pi 官方 RPC 模式的降级表（docs/rpc-extension-ui.md「Limitations」）：
    // 对话框类方法在 RPC 下可用，其余要么返回空值、要么是 no-op。
    // 给安全默认值而非 `undefined`——扩展拿到 undefined 再 `.length` 会当场崩。

    /** 原始终端输入监听（TUI only）：返回可调用的 no-op 退订函数。 */
    onTerminalInput: () => () => {},
    setStatus: () => {},
    setWorkingMessage: () => {},
    setWorkingVisible: () => {},
    setWorkingIndicator: () => {},
    setHiddenThinkingLabel: () => {},
    setWidget: () => {},
    setFooter: () => {},
    setHeader: () => {},
    setTitle: () => {},
    /** 自定义 TUI 组件（TUI only）：官方 RPC 模式同样返回 undefined。
     *  泛型签名 `custom<T>` 要求返回 `Promise<T>`，但这里恒为 undefined——
     *  与官方 RPC 实现同形（`custom: async () => undefined`），故需断言。 */
    custom: (async () => undefined) as ExtensionUIContext["custom"],
    pasteToEditor: () => {},
    setEditorText: () => {},
    getEditorText: () => "",
    addAutocompleteProvider: () => {},
    setEditorComponent: () => {},
    getEditorComponent: () => undefined,
    /** Web 壳不渲染终端主题，但扩展可能读它取色——给安全代理，见 fallbackTheme。 */
    get theme() {
      return fallbackTheme;
    },
    /** 官方 RPC 模式：主题读取返回空、切换返回失败。 */
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: false, error: "Theme switching not supported in RPC mode" }),
    getToolsExpanded: () => false,
    setToolsExpanded: () => {},
  };

  return {
    uiContext,

    resolve(id, reply) {
      const entry = pending.get(id);
      if (!entry) return false;
      entry.resolve(reply);
      return true;
    },

    pendingCount() {
      return pending.size;
    },

    rejectAll() {
      for (const [, entry] of pending) {
        clearTimeout(entry.timer);
        entry.resolve({ cancelled: true });
      }
      pending.clear();
    },
  };
}
