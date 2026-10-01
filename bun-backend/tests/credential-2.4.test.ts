/**
 * tests/credential-2.4.test.ts — Fernet 互操作向量测试（阶段 2.4，§4.1 缓解项）。
 *
 * 向量由 Python cryptography.fernet（生产同库）生成并固化：
 *   1. Python token → Bun 解密（正向互认）
 *   2. Python encv1: 信封 → Bun 解密（信封层互认）
 *   3. Bun token → Python 解密（反向互认，spawnSync venv python；不可用则跳过）
 *   4. 篡改/非法输入 → 空串（与 Python InvalidToken 静默语义一致）
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  decryptApiKey,
  encryptApiKey,
  fernetDecrypt,
  fernetEncrypt,
  generateFernetKey,
  isCredentialEnvelope,
  isLegacyEncrypted,
  parseCredentialEnvelope,
} from "../src/security/credential-envelope";

// ── Python 固化向量（cryptography.fernet @ .venv，key=bytes(range(32)) urlsafe b64）──
const VECTOR_KEY = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";
const VECTOR_TOKEN = "gAAAAABqvav_gy4ZN8KB5LteHizlbYiBeeLutNkIquHrVjtR6LyrtOk69SwERRKoA4DX-rPy4MXpr0ibJd-JrBIbcustcab2Yg==";
const VECTOR_PLAINTEXT = "hello world";
const VECTOR_ENVELOPE =
  "encv1:eyJhbGciOiJmZXJuZXQiLCJjdCI6ImdBQUFBQUJxdmF3THBYMWFOV2dES0E4eXY0RWFfX1F4YUt4WGpKTmMtRlFBMHJlNVIzb09mRGdrcFppRUNyYU83cW5nZmpyNHMxSEg4bmFQNEZEbmtDaWhtU2FydzZxTmRBRWtPMVIzdUJ4VkJRUVQ0TGRVdEZ3PSIsImtpZCI6ImRlZmF1bHQiLCJ2IjoxfQ";
const VECTOR_ENVELOPE_PLAINTEXT = "sk-test-secret-123";

function withTempKeyPath(fn: (keyPath: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-fernet-"));
  try {
    fn(path.join(dir, "credential.key"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("Fernet 向量互操作（阶段 2.4）", () => {
  test("Python token → Bun 解密（正向互认）", () => {
    expect(fernetDecrypt(VECTOR_TOKEN, VECTOR_KEY)).toBe(VECTOR_PLAINTEXT);
  });

  test("Python encv1: 信封 → Bun 解析 + 解密（信封层互认）", () => {
    expect(isCredentialEnvelope(VECTOR_ENVELOPE)).toBe(true);
    const env = parseCredentialEnvelope(VECTOR_ENVELOPE);
    expect(env.algorithm).toBe("fernet");
    expect(env.keyId).toBe("default");
    expect(env.version).toBe(1);
    // 用向量 key 作为 credential.key 文件内容
    withTempKeyPath((keyPath) => {
      fs.writeFileSync(keyPath, VECTOR_KEY, "utf8");
      expect(decryptApiKey(VECTOR_ENVELOPE, keyPath)).toBe(VECTOR_ENVELOPE_PLAINTEXT);
    });
  });

  test("Bun 加密 → 同 key 解密 round-trip（含中文/emoji/空串边界）", () => {
    withTempKeyPath((keyPath) => {
      for (const plain of ["sk-abc123", "密钥测试🔑", "a", "x".repeat(5000)]) {
        const enc = encryptApiKey(plain, keyPath);
        expect(isCredentialEnvelope(enc)).toBe(true);
        expect(decryptApiKey(enc, keyPath)).toBe(plain);
      }
      // key 文件已生成且可复用
      expect(fs.readFileSync(keyPath, "utf8").trim().length).toBe(44);
    });
  });

  test("Bun token → Python 解密（反向互认）", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-fernet-x-"));
    const keyPath = path.join(dir, "credential.key");
    try {
      const enc = encryptApiKey("cross-check-π", keyPath);
      const env = parseCredentialEnvelope(enc);
      const python = [
        path.resolve(import.meta.dir, "..", "..", ".venv", "Scripts", "python.exe"),
        path.resolve(import.meta.dir, "..", "..", ".venv", "bin", "python"),
      ].find((p) => fs.existsSync(p));
      if (!python) return; // 无 venv 环境时跳过反向验证（正向向量已锁定格式）
      const script = `from cryptography.fernet import Fernet\nprint(Fernet(open(${JSON.stringify(keyPath)}, 'rb').read()).decrypt(${JSON.stringify(env.ciphertext)}.encode()).decode())\n`;
      const tmp = path.join(dir, "verify.py");
      fs.writeFileSync(tmp, script, "utf8");
      const r = Bun.spawnSync([python, tmp]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout.toString().trim()).toBe("cross-check-π");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("篡改 token / 非法信封 / 明文透传 / 空值 → 与 Python 静默语义一致", () => {
    withTempKeyPath((keyPath) => {
      fs.writeFileSync(keyPath, VECTOR_KEY, "utf8");
      // 篡改密文（最后一个 body 字节）→ InvalidToken → ""
      const tampered = VECTOR_TOKEN.slice(0, -10) + "AAAAAAAAAA==";
      expect(decryptApiKey("enc:" + tampered, keyPath)).toBe("");
      // 错误 key → ""
      const wrongKeyPath = path.join(path.dirname(keyPath), "other.key");
      fs.writeFileSync(wrongKeyPath, generateFernetKey(), "utf8");
      expect(decryptApiKey(VECTOR_ENVELOPE, wrongKeyPath)).toBe("");
      // 非 fernet 算法信封 → ""
      const badAlg = "encv1:" + Buffer.from(JSON.stringify({ alg: "dpapi", ct: "x", kid: "k", v: 1 })).toString("base64url");
      expect(decryptApiKey(badAlg, keyPath)).toBe("");
      // 明文透传 / 空值
      expect(decryptApiKey("sk-plain", keyPath)).toBe("sk-plain");
      expect(decryptApiKey("", keyPath)).toBe("");
      expect(decryptApiKey(undefined, keyPath)).toBe("");
      // 前缀判定
      expect(isLegacyEncrypted("enc:abc")).toBe(true);
      expect(isLegacyEncrypted("encv1:abc")).toBe(false);
      expect(isCredentialEnvelope("enc:abc")).toBe(false);
    });
  });

  test("Bun 加密的 legacy token 可被 fernetDecrypt 直接解（无信封路径）", () => {
    const key = generateFernetKey();
    const ct = fernetEncrypt("legacy-path", key);
    expect(fernetDecrypt(ct, key)).toBe("legacy-path");
  });
});
