/**
 * security/credential-envelope.ts — Fernet 兼容凭据信封
 * （api/security/credential_envelope.py + providers.py Fernet 部分的 Bun 直译，
 * 阶段二 2.4）。
 *
 * Fernet 规范（https://github.com/fernet/spec）：
 *   key   = 32 字节（urlsafe base64 持久化）：前 16 字节 signing key、后 16 字节 AES key
 *   token = urlsafe_b64( 0x80 ‖ timestamp(8B 大端) ‖ IV(16B) ‖ AES-128-CBC(PKCS7) ‖ HMAC-SHA256(前缀+IV+密文) )
 *   解密校验：版本字节 0x80 + HMAC timing-safe 比对（失败 InvalidToken → 空串）
 *
 * 与 Python cryptography.fernet 逐字节互操作（向量测试锁定，§4.1）。
 * 信封层（encv1:）只记录非密钥元数据（alg/kid/v），内部 ciphertext 仍是
 * legacy "enc:<fernet-token>"——与 Python create/parse/decrypt_credential_envelope 同构。
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export const ENVELOPE_VERSION = 1;
export const ENVELOPE_PREFIX = "encv1:";
export const LEGACY_PREFIX = "enc:";

export class CredentialEnvelopeError extends Error {}

export interface CredentialEnvelope {
  version: number;
  algorithm: string;
  keyId: string;
  ciphertext: string;
}

// ── urlsafe base64（对齐 Python base64.urlsafe_b64*：编解码均带 padding）──

function b64uEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
}

function b64uDecode(s: string): Buffer {
  return Buffer.from(s, "base64url"); // Node 解码容忍缺失 padding
}

// ── Fernet ──

/** 解析 Fernet key（urlsafe b64 → 32 字节）；非法抛错。 */
function parseKey(keyB64: string): { signingKey: Buffer; encryptionKey: Buffer } {
  const raw = b64uDecode(keyB64.trim());
  if (raw.length !== 32) {
    throw new Error("Fernet key must be 32 url-safe base64-encoded bytes.");
  }
  return { signingKey: raw.subarray(0, 16), encryptionKey: raw.subarray(16, 32) };
}

/** 生成新 Fernet key（44 字符 urlsafe b64 带 padding，同 Fernet.generate_key）。 */
export function generateFernetKey(): string {
  return b64uEncode(crypto.randomBytes(32));
}

/** 加密 → legacy token 字符串（不含 "enc:" 前缀）。 */
export function fernetEncrypt(plaintext: string, keyB64: string): string {
  const { signingKey, encryptionKey } = parseKey(keyB64);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-128-cbc", encryptionKey, iv);
  cipher.setAutoPadding(true); // PKCS7
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const timestamp = Buffer.alloc(8);
  timestamp.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000)));
  const body = Buffer.concat([Buffer.from([0x80]), timestamp, iv, ciphertext]);
  const hmac = crypto.createHmac("sha256", signingKey).update(body).digest().subarray(0, 32);
  return b64uEncode(Buffer.concat([body, hmac]));
}

/** 解密 legacy token；任何校验失败（InvalidToken 等价）抛错由调用方吞为空串。 */
export function fernetDecrypt(token: string, keyB64: string): string {
  const { signingKey, encryptionKey } = parseKey(keyB64);
  const data = b64uDecode(token);
  if (data.length < 57) throw new Error("InvalidToken: too short");
  if (data[0] !== 0x80) throw new Error("InvalidToken: version");
  const body = data.subarray(0, data.length - 32);
  const providedHmac = data.subarray(data.length - 32);
  const expected = crypto.createHmac("sha256", signingKey).update(body).digest().subarray(0, 32);
  if (!crypto.timingSafeEqual(expected, providedHmac)) throw new Error("InvalidToken: hmac");
  const iv = body.subarray(9, 25);
  const ciphertext = body.subarray(25);
  const decipher = crypto.createDecipheriv("aes-128-cbc", encryptionKey, iv);
  decipher.setAutoPadding(true);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

// ── 信封层（credential_envelope.py 直译）──

export function isCredentialEnvelope(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(ENVELOPE_PREFIX);
}

export function isLegacyEncrypted(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(LEGACY_PREFIX);
}

/** JSON sort_keys + separators(",",":")（对齐 Python json.dumps 稳定编码）。 */
function canonicalJson(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${JSON.stringify(obj[k])}`);
  return `{${parts.join(",")}}`;
}

export function createCredentialEnvelope(
  plaintext: string,
  opts: { encryptPayload: (p: string) => string; algorithm: string; keyId: string },
): string {
  const legacyValue = opts.encryptPayload(plaintext);
  if (!isLegacyEncrypted(legacyValue)) {
    throw new CredentialEnvelopeError("credential encryption did not return a ciphertext");
  }
  const payload: Record<string, unknown> = {
    alg: opts.algorithm,
    ct: legacyValue.slice(LEGACY_PREFIX.length),
    kid: opts.keyId,
    v: ENVELOPE_VERSION,
  };
  return ENVELOPE_PREFIX + b64uEncode(Buffer.from(canonicalJson(payload), "utf8"));
}

export function parseCredentialEnvelope(value: string): CredentialEnvelope {
  if (!isCredentialEnvelope(value)) throw new CredentialEnvelopeError("not a credential envelope");
  const encoded = value.slice(ENVELOPE_PREFIX.length);
  let payload: unknown;
  try {
    payload = JSON.parse(b64uDecode(encoded).toString("utf8"));
  } catch {
    throw new CredentialEnvelopeError("invalid credential envelope encoding");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new CredentialEnvelopeError("invalid credential envelope encoding");
  }
  const obj = payload as Record<string, unknown>;
  if (obj.v !== ENVELOPE_VERSION) throw new CredentialEnvelopeError("unsupported credential envelope version");
  const algorithm = obj.alg;
  const keyId = obj.kid;
  const ciphertext = obj.ct;
  if (
    typeof algorithm !== "string" || !algorithm ||
    typeof keyId !== "string" || !keyId ||
    typeof ciphertext !== "string" || !ciphertext
  ) {
    throw new CredentialEnvelopeError("invalid credential envelope fields");
  }
  return { version: ENVELOPE_VERSION, algorithm, keyId, ciphertext };
}

export function decryptCredentialEnvelope(
  value: string,
  opts: { decryptPayload: (legacy: string) => string; supportedAlgorithm: string },
): string {
  const envelope = parseCredentialEnvelope(value);
  if (envelope.algorithm !== opts.supportedAlgorithm) {
    throw new CredentialEnvelopeError("credential envelope algorithm is unavailable");
  }
  return opts.decryptPayload(LEGACY_PREFIX + envelope.ciphertext);
}

// ── providers.py 凭据层（_get_or_create_fernet_key / _encrypt_api_key / _decrypt_api_key）──

export const ENVELOPE_ALGORITHM = "fernet";
export const ENVELOPE_KEY_ID = "default";

const KEY_LOCK = { held: false };

/** 读取或生成持久化 Fernet key（API_DATA_DIR/credential.key，原子写；FERNET-RACE-001 双检）。 */
export function getOrCreateFernetKey(keyPath: string): string {
  if (fs.existsSync(keyPath)) return fs.readFileSync(keyPath, "utf8").trim();
  // 单线程 JS 无真正竞态；保留锁结构以镜像 Python 语义（双检路径）
  if (KEY_LOCK.held) return fs.readFileSync(keyPath, "utf8").trim();
  KEY_LOCK.held = true;
  try {
    if (fs.existsSync(keyPath)) return fs.readFileSync(keyPath, "utf8").trim();
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    const key = generateFernetKey();
    const tmp = keyPath + ".tmp";
    fs.writeFileSync(tmp, key, "utf8");
    try {
      fs.chmodSync(tmp, 0o600); // best-effort（Windows no-op）
    } catch {
      /* noop */
    }
    fs.renameSync(tmp, keyPath);
    return key;
  } finally {
    KEY_LOCK.held = false;
  }
}

/** 加密明文 api_key → encv1:<envelope>。 */
export function encryptApiKey(plaintext: string, keyPath: string): string {
  const key = getOrCreateFernetKey(keyPath);
  const ciphertext = fernetEncrypt(plaintext, key);
  return createCredentialEnvelope(plaintext, {
    encryptPayload: () => LEGACY_PREFIX + ciphertext,
    algorithm: ENVELOPE_ALGORITHM,
    keyId: ENVELOPE_KEY_ID,
  });
}

/** 解密存储值（enc:/encv1:/明文原样）；失败 → 空串（与 Python 同语义）。 */
export function decryptApiKey(value: unknown, keyPath: string): string {
  if (typeof value !== "string" || !value) return "";
  const decryptPayload = (legacy: string): string => {
    try {
      return fernetDecrypt(legacy.slice(LEGACY_PREFIX.length), getOrCreateFernetKey(keyPath));
    } catch {
      return "";
    }
  };
  try {
    if (isCredentialEnvelope(value)) {
      return decryptCredentialEnvelope(value, { decryptPayload, supportedAlgorithm: ENVELOPE_ALGORITHM });
    }
    if (isLegacyEncrypted(value)) return decryptPayload(value);
  } catch {
    return "";
  }
  return value;
}
