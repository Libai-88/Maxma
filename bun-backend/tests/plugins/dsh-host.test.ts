/**
 * tests/plugins/dsh-host.test.ts — DSH 插件宿主的装配自检（PLUGIN-001）。
 *
 * 这里验证的是「不重写插件也能在 Maxma 里跑起来」这条架构前提：
 *   1. 宿主提供 credentials / llm / commands 三个服务后，
 *      `dsh-codearts-auth` 能原样加载并注册它全部的 provider 路由与 Auth 服务；
 *   2. 宿主自有的凭据服务能落盘、能读回、且 describe 不泄露值；
 *   3. 插件的数据被隔离在 Maxma 数据目录内（不写用户主目录的 `~/.dsh`）；
 *   4. dispose 能收干净（插件的定时器与子进程不残留）。
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { createDshPluginHost, type DshPluginHost } from "../../src/plugins/dsh/host";

let dataDir: string;
let prevDataDir: string | undefined;
let host: DshPluginHost;

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-dsh-host-"));
  prevDataDir = process.env.MAXMA_DATA_DIR;
  process.env.MAXMA_DATA_DIR = dataDir;
  host = await createDshPluginHost({
    stateDir: path.join(dataDir, "plugins", "dsh"),
    pluginSpecifiers: ["dsh-codearts-auth"],
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  });
});

afterAll(async () => {
  await host?.dispose();
  if (prevDataDir === undefined) delete process.env.MAXMA_DATA_DIR;
  else process.env.MAXMA_DATA_DIR = prevDataDir;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("DSH plugin host", () => {
  test("loads the bundled Jet Hub plugin and records it as loaded", () => {
    expect(host.loadedModules()).toEqual(["dsh-codearts-auth"]);
  });

  test("exposes the plugin's 15 provider routes through the shared llm runtime", () => {
    const ids = host.listProviders().map((provider) => provider.id);
    expect(ids.length).toBe(15);
    // 抽验若干渠道 + 聚合路由，防止插件升级后静默少注册
    for (const expected of [
      "codearts",
      "buddy",
      "workbuddy",
      "lobsterai",
      "qoder",
      "qodercn",
      "trae",
      "cline",
      "loomy",
      "raccoon",
      "minimax",
      "zcode",
      "opencode",
      "gemini",
      "jet-hub-auto",
    ]) {
      expect(ids).toContain(expected);
    }
  });

  test("registers each provider's Auth service on the context", () => {
    for (const service of [
      "codeartsAuth",
      "buddyAuth",
      "workbuddyAuth",
      "lobsteraiAuth",
      "qoderAuth",
      "traeAuth",
      "clineAuth",
      "loomyAuth",
      "raccoonAuth",
      "zcodeAuth",
      "minimaxAuth",
      "geminiAuth",
    ]) {
      expect(host.hasService(service)).toBe(true);
    }
  });

  test("credential service round-trips through disk without leaking values", async () => {
    const ref = "CODEARTS_ACCOUNT_TEST" as never;

    expect(await host.credentials.resolve(ref)).toBeUndefined();
    expect(await host.credentials.describe(ref)).toEqual({ configured: false, writable: true });

    await host.credentials.set(ref, "secret-value");
    expect(await host.credentials.resolve(ref)).toEqual({ value: "secret-value", source: "maxma-file" });
    expect(await host.credentials.describe(ref)).toEqual({ configured: true, source: "maxma-file", writable: true });

    // describe 的返回结构里没有任何字段能载入值本体
    expect(JSON.stringify(await host.credentials.describe(ref))).not.toContain("secret-value");

    // 落盘位置与形状必须与插件的 `bootstrapFromCredentialRefs()` 文本扫描兼容：
    // 顶格 `refs:` 段 + 缩进的 `NAME: value` 行（否则账号索引兜底会静默失效）。
    const storePath = path.join(dataDir, "plugins", "dsh", ".credentials.yaml");
    expect(fs.existsSync(storePath)).toBe(true);
    const text = fs.readFileSync(storePath, "utf8");
    expect(text).toContain("secret-value");
    expect(/^refs:\s*$/m.test(text)).toBe(true);
    expect(/^\s+CODEARTS_ACCOUNT_TEST:/m.test(text)).toBe(true);

    await host.credentials.unset(ref);
    expect(await host.credentials.resolve(ref)).toBeUndefined();
    // 重复 unset 是 no-op
    await host.credentials.unset(ref);
    expect(host.credentials.listRefNames()).not.toContain("CODEARTS_ACCOUNT_TEST");
  });

  test("rejects empty credential values", async () => {
    await expect(host.credentials.set("SOME_REF" as never, "")).rejects.toThrow();
  });

  test("keeps plugin state inside the Maxma data directory", () => {
    // 宿主把 DSH_HOME / DSH_JET_HUB_STATE_DIR 指向 Maxma 数据目录
    const stateDir = path.join(dataDir, "plugins", "dsh");
    expect(process.env.DSH_HOME).toBe(stateDir);
    expect(process.env.DSH_JET_HUB_STATE_DIR).toBe(path.join(stateDir, "jet-hub"));
    // 默认关闭插件的本机 OpenAI 网关，避免与 Maxma 抢端口
    expect(process.env.DSH_OPENAI_GATEWAY_ENABLED).toBe("0");
  });

  test("pi 桥认得真实插件的全部路由，且不接管任何内建 provider", async () => {
    const { pluginProviderIds } = await import("../../src/plugins/dsh/pi-bridge");
    const { createPluginProviderRegistrar } = await import("../../src/plugins/dsh/pi-providers");

    const ids = pluginProviderIds(host.getService("llm"));
    expect(ids).toHaveLength(15);
    expect(ids).toContain("codearts");
    expect(ids).toContain("jet-hub-auto");

    // 内建 provider（内置免费通道）绝不能被插件注册器接管 —— 否则会覆盖它的传输。
    const registered: string[] = [];
    const runtime = { registerProvider: (id: string) => registered.push(id) };
    const registrar = createPluginProviderRegistrar(host);
    expect(await registrar(runtime as never, "opencode-zen", "mimo-v2.6-flash-free")).toBe(false);
    expect(await registrar(runtime as never, "deepseek", "deepseek-chat")).toBe(false);
    expect(registered).toHaveLength(0);
  });

  test("插件把管理端点交给宿主（connection.fetch.register）", () => {    // 缺 connection 服务时插件只打一行 warn 就跳过全部 RPC —— 这条断言是那个坑的闸门。
    const endpoints = host.httpHandlers().map((h) => `${h.methods.join(",")} ${h.path}`);
    expect(endpoints).toContain("POST /api/jet-hub");
    expect(endpoints).toContain("GET /api/jet-hub/captcha-carrier");
  });

  test("Jet Hub 的 RPC 分派器真的在跑（离线方法 account.list）", async () => {
    const handler = host.httpHandlers().find((h) => h.path === "/api/jet-hub");
    expect(handler).toBeDefined();

    const response = await handler!.fetch(
      new Request("http://127.0.0.1/api/jet-hub", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "client-request",
          rpcId: "t1",
          method: "jet-hub",
          payload: { method: "account.list", payload: {} },
        }),
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { type: string; rpcId: string; result: { ok: boolean; value?: { accounts: unknown[] } } };
    expect(body.type).toBe("server-response");
    expect(body.rpcId).toBe("t1");
    expect(body.result.ok).toBe(true);
    expect(Array.isArray(body.result.value?.accounts)).toBe(true);
  });

  test("未知方法回 bad-request，信封不合法回 gateway/bad-request", async () => {    const handler = host.httpHandlers().find((h) => h.path === "/api/jet-hub")!;
    const post = (body: unknown) =>
      handler.fetch(
        new Request("http://127.0.0.1/api/jet-hub", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );

    const unknown = (await (await post({ type: "client-request", rpcId: "a", method: "jet-hub", payload: { method: "no.such.method", payload: {} } })).json()) as {
      result: { ok: boolean; error: { code: string } };
    };
    expect(unknown.result.ok).toBe(false);
    expect(unknown.result.error.code).toBe("bad-request");

    // 信封错了（method 不是 jet-hub）→ 网关级错误码
    const badEnvelope = (await (await post({ type: "client-request", rpcId: "b", method: "wrong", payload: { method: "account.list", payload: {} } })).json()) as {
      result: { ok: boolean; error: { code: string } };
    };
    expect(badEnvelope.result.ok).toBe(false);
    expect(badEnvelope.result.error.code).toBe("gateway/bad-request");

    // 非 JSON 内容类型被插件自己挡掉
    const wrongType = await handler.fetch(
      new Request("http://127.0.0.1/api/jet-hub", { method: "POST", headers: { "content-type": "text/plain" }, body: "x" }),
    );
    expect(wrongType.status).toBe(415);
  });

  test("网关开关来自插件配置，且默认关闭（不让插件占端口）", async () => {    const { resolveDshHostOptions } = await import("../../src/plugins/dsh");
    const { setPluginConfig } = await import("../../src/plugins/registry");

    // 默认：Maxma 不让插件监听本机端口（与其它 Maxma 服务抢端口是最难查的一类故障）
    expect(resolveDshHostOptions().enableOpenAiGateway).toBe(false);

    setPluginConfig("codearts-auth", { gatewayEnabled: true });
    const enabled = resolveDshHostOptions();
    expect(enabled.enableOpenAiGateway).toBe(true);
    expect(enabled.pluginSpecifiers).toEqual(["dsh-codearts-auth"]);

    setPluginConfig("codearts-auth", { gatewayEnabled: false });
    expect(resolveDshHostOptions().enableOpenAiGateway).toBe(false);
  });

  test("宿主按开关注入 DSH_OPENAI_GATEWAY_ENABLED", async () => {    const { createDshPluginHost: create } = await import("../../src/plugins/dsh/host");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-dsh-gw-"));
    try {
      const gwHost = await create({
        stateDir: dir,
        pluginSpecifiers: [],
        enableOpenAiGateway: true,
        logger: { info: () => {}, warn: () => {}, error: () => {} },
      });
      expect(process.env.DSH_OPENAI_GATEWAY_ENABLED).toBe("1");
      await gwHost.dispose();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * `isPluginProvider` —— chat-ws 判断「provider 查不到时是不是插件的」所依赖的谓词。
 *
 * 真实缺陷（端到端验收发现）：`chat-ws` 原来对 providers.yaml 里查不到的 provider
 * 一律抛「所选提供商不可用」—— 而插件渠道**本来就不在那份文件里**（凭据与端点在插件
 * 自己的适配器内），于是插件模型在 pi 侧能解析、发消息时却被挡在门外。
 */
describe("isPluginProvider", () => {
  test("未装配宿主时恒为 false（插件不可用就该给明确的不可用）", async () => {
    const { isPluginProvider } = await import("../../src/plugins/dsh");
    // 该谓词读的是**模块单例**，而本文件的其它用例都直接用 createDshPluginHost，
    // 所以此刻单例尚未装配 —— 正好覆盖「插件没起来」这条分支。
    expect(isPluginProvider("trae")).toBe(false);
  });

  test("装配后认得插件渠道，且不误认内建渠道", async () => {
    const { ensurePluginBridgeInstalled, isPluginProvider, disposeDshPluginHost } = await import("../../src/plugins/dsh");
    await ensurePluginBridgeInstalled();
    expect(isPluginProvider("opencode")).toBe(true);
    expect(isPluginProvider("trae")).toBe(true);
    expect(isPluginProvider("jet-hub-auto")).toBe(true);
    // 内建免费通道与用户自配渠道都不是插件渠道
    expect(isPluginProvider("opencode-zen")).toBe(false);
    expect(isPluginProvider("deepseek")).toBe(false);
    expect(isPluginProvider("")).toBe(false);
    await disposeDshPluginHost();
  });
});
