/**
 * plugins/dsh/credential-provider.ts — Cordis 凭据服务（`ctx.credentials`）的 Maxma 实现。
 *
 * DSH 把凭据拆成两个关键空间（`@deepseek-ai/dsh-credentials` 的 `CredentialProvider`）：
 *   - **引用**（`CredentialRef`，形如 `CODEARTS_ACCOUNT_XXX`）：环境变量式的名字，
 *     消费者每次操作前重新 `resolve`，所以改一次凭据下一轮就生效，无需重启插件；
 *   - **记录**（`CredentialKey`，形如 `scope/id`）：插件自有格式的载荷（API key /
 *     授权产物），本层只保证「JSON 往返不丢」。
 *
 * 本实现把两者都落在 Maxma 数据目录下的单个 JSON 文档里（原子写 + 单队列串行），
 * 使插件的账号与令牌留在 Maxma 自己的数据目录内（便携模式下随包走），
 * 而不是写进用户主目录的 `~/.dsh`。
 *
 * ⚠️ 契约要点（照 `CredentialProvider` 文档）：
 *   - `set` 拒绝空值（清空走 `unset`）；`unset` 不存在的引用是 no-op；
 *   - 读半边（`describe` / `describeRecord` / `listRecords`）**永不返回值本体**；
 *   - `modifyRecord` 是唯一的记录写入口，且必须串行（读-改-写期间独占）。
 */

import { CredentialProvider } from "@deepseek-ai/dsh-credentials";
import type {
  CredentialInfo,
  CredentialKey,
  CredentialRecord,
  CredentialRecordEntry,
  CredentialRecordInfo,
  CredentialRef,
  ResolvedCredential,
} from "@deepseek-ai/dsh-credentials";
import type { Context } from "@deepseek-ai/cordis";

import * as fs from "node:fs";
import * as path from "node:path";

import { getDshPluginStateDir } from "../../app-paths";
import { BunYamlSafeParse, writeTextAtomic } from "../../yaml-store";

/** 磁盘文档形状（版本号留给后续迁移）。 */
interface CredentialDocument {
  version: 1;
  /** 引用 → 明文值。 */
  refs: Record<string, string>;
  /** 记录地址（`scope/id`）→ 记录本体。 */
  records: Record<string, CredentialRecord>;
}

/** 本实现的来源层标识；与 DSH 本地实现的 `file` 同义。 */
const SOURCE = "maxma-file";

export interface MaxmaCredentialProviderOptions {
  /** 凭据文档路径（缺省 `$DSH_HOME/.credentials.yaml`）。 */
  storePath?: string;
}

/**
 * 缺省落盘位置 **必须**是 `$DSH_HOME/.credentials.yaml`。
 *
 * ⚠️ 这不是随意选的：插件在 `state.json` 缺失时会**文本扫描**
 * `$DSH_HOME/.credentials.yaml` 的顶格 `refs:` 段（缩进 ≥2 且
 * `^[A-Z][A-Z0-9_]*:` 的行）来重建账号索引（`bootstrapFromCredentialRefs`）。
 * 若把凭据落到别的文件/别的形状，那条兜底会静默失效 —— 凭据还在，
 * 但用户的账号列表会一次性「消失」，且不报任何错。
 */
function defaultStorePath(): string {
  return path.join(getDshPluginStateDir(), ".credentials.yaml");
}

/**
 * 手工生成**块状（block）YAML** 文本。
 *
 * ⚠️ 不能用 `Bun.YAML.stringify`：它输出的是**流式（flow）风格**（整份文档压成
 * 一行 `{version: 1,refs: {NAME: value}}`，本仓实测确认），按行扫描的消费方
 * 读不到任何 `refs:` / `NAME:` 行。
 *
 * 取值一律用 `JSON.stringify` —— JSON 是 YAML 的子集，引号、转义与嵌套对象都能
 * 被标准 YAML 解析器原样读回，无需自己写转义逻辑。
 */
export function serializeCredentialDocument(doc: CredentialDocument): string {
  const lines: string[] = [`version: ${doc.version}`];
  const refNames = Object.keys(doc.refs).sort();
  lines.push(refNames.length === 0 ? "refs: {}" : "refs:");
  for (const name of refNames) {
    // 引用名必须是 POSIX 标识符，裸写即可（扫描器也要求裸写）。
    lines.push(`  ${name}: ${JSON.stringify(doc.refs[name])}`);
  }
  const recordKeys = Object.keys(doc.records).sort();
  lines.push(recordKeys.length === 0 ? "records: {}" : "records:");
  for (const key of recordKeys) {
    // 地址形如 `scope/id`，含 `/`，必须加引号才能当 YAML 键。
    lines.push(`  ${JSON.stringify(key)}: ${JSON.stringify(doc.records[key])}`);
  }
  return `${lines.join("\n")}\n`;
}

export class MaxmaCredentialProvider extends CredentialProvider {
  readonly storePath: string;

  /**
   * ⚠️ 本类**不能用 ES `#private` 成员**：Cordis 把服务实例包成 Proxy 之后再调用
   * 方法，私有字段的品牌检查在代理对象上必然失败（实测报
   * `Cannot access private method or acessor`）。改用下划线前缀的普通成员。
   */
  _doc: CredentialDocument | null = null;
  /** 单文档串行队列：读-改-写必须独占，否则并发写会互相覆盖。 */
  _queue: Promise<unknown> = Promise.resolve();

  /**
   * ⚠️ Cordis 的类插件由框架构造（`new Class(ctx, config)`），**不要自行 new**
   * —— 传实例给 `ctx.plugin()` 会被判为「invalid plugin」。
   */
  constructor(ctx: Context, options?: MaxmaCredentialProviderOptions) {
    super(ctx, "credentials");
    this.storePath = options?.storePath ?? defaultStorePath();
  }

  /** 串行执行一个临界区（写路径全走它）。 */
  _serial<T>(task: () => Promise<T> | T): Promise<T> {
    const run = this._queue.then(task, task);
    // 队列自身不因单次失败而断掉：吞掉拒绝，只把它交给调用方。
    this._queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run as Promise<T>;
  }

  _load(): CredentialDocument {
    if (this._doc) return this._doc;
    let parsed: Partial<CredentialDocument> | null = null;
    try {
      if (fs.existsSync(this.storePath)) {
        parsed = BunYamlSafeParse(fs.readFileSync(this.storePath, "utf8")) as Partial<CredentialDocument> | null;
      }
    } catch {
      parsed = null;
    }
    this._doc = {
      version: 1,
      refs: parsed && typeof parsed.refs === "object" && parsed.refs ? { ...parsed.refs } : {},
      records: parsed && typeof parsed.records === "object" && parsed.records ? { ...parsed.records } : {},
    };
    return this._doc;
  }

  _persist(): void {
    writeTextAtomic(this.storePath, serializeCredentialDocument(this._load()));
  }

  // ── 引用半边 ──

  async resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    const value = this._load().refs[String(ref)];
    if (typeof value !== "string" || value.length === 0) return undefined;
    return { value, source: SOURCE };
  }

  async describe(ref: CredentialRef): Promise<CredentialInfo> {
    const configured = typeof this._load().refs[String(ref)] === "string";
    return configured ? { configured: true, source: SOURCE, writable: true } : { configured: false, writable: true };
  }

  async set(ref: CredentialRef, value: string): Promise<void> {
    if (typeof value !== "string" || value.length === 0) {
      throw new Error("credential value must be a non-empty string (use unset to remove)");
    }
    await this._serial(() => {
      this._load().refs[String(ref)] = value;
      this._persist();
    });
  }

  async unset(ref: CredentialRef): Promise<void> {
    await this._serial(() => {
      const doc = this._load();
      if (!(String(ref) in doc.refs)) return;
      delete doc.refs[String(ref)];
      this._persist();
    });
  }

  // ── 记录半边 ──

  async readRecord(key: CredentialKey): Promise<CredentialRecord | undefined> {
    return this._load().records[String(key)];
  }

  async describeRecord(key: CredentialKey): Promise<CredentialRecordInfo> {
    const record = this._load().records[String(key)];
    return record === undefined
      ? { configured: false, writable: true }
      : { configured: true, kind: record.kind, writable: true };
  }

  async listRecords(): Promise<readonly CredentialRecordEntry[]> {
    const doc = this._load();
    return Object.entries(doc.records).map(([key, record]) => ({
      key: key as CredentialKey,
      kind: record.kind,
    }));
  }

  async modifyRecord(
    key: CredentialKey,
    mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> {
    return await this._serial(async () => {
      const doc = this._load();
      const current = doc.records[String(key)];
      const next = await mutate(current);
      // 返回 undefined == 本次不写（契约：leave the entry untouched）。
      if (next === undefined) return current;
      doc.records[String(key)] = next;
      this._persist();
      return next;
    });
  }

  async deleteRecord(key: CredentialKey): Promise<void> {
    await this._serial(() => {
      const doc = this._load();
      if (!(String(key) in doc.records)) return;
      delete doc.records[String(key)];
      this._persist();
    });
  }

  // ── 便于宿主与测试使用的辅助 ──

  /** 已配置的引用名清单（**不含值**），用于管理界面的概览。 */
  listRefNames(): string[] {
    return Object.keys(this._load().refs).sort();
  }

  /** 凭据文档是否已落盘（装机自检用）。 */
  exists(): boolean {
    return fs.existsSync(this.storePath);
  }

  /** 抹掉整份凭据文档（卸载插件时调用）。 */
  async clear(): Promise<void> {
    await this._serial(() => {
      this._doc = { version: 1, refs: {}, records: {} };
      try {
        fs.rmSync(this.storePath, { force: true });
      } catch {
        // best-effort：删不掉时至少保证内存态是空的
      }
    });
    void path;
  }
}
