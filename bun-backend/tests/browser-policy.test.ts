import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const {
  DEFAULT_POLICY,
  normalizeDomain,
  normalizeDomains,
  normalizePolicy,
  isHostAllowed,
  isUrlAllowedByPolicy,
  policySummary,
  readPolicy,
  writePolicy,
} = require("../../desktop/electron/browser-net-policy.cjs");

const {
  MAX_DOWNLOAD_BYTES,
  sanitizeDownloadName,
  uniqueDownloadPath,
  exceedsDownloadLimit,
} = require("../../desktop/electron/browser-downloads.cjs");

describe("浏览器网络 allowlist", () => {
  test("默认 all 放行 http/https，allowlist 精确放行主机和子域", () => {
    const policy = normalizePolicy({ mode: "allowlist", domains: ["example.com", "127.0.0.1"] });
    expect(isHostAllowed("example.com", policy)).toBe(true);
    expect(isHostAllowed("docs.example.com", policy)).toBe(true);
    expect(isHostAllowed("evil-example.com", policy)).toBe(false);
    expect(isHostAllowed("example.com.evil", policy)).toBe(false);
    expect(isHostAllowed("127.0.0.1", policy)).toBe(true);
    expect(isHostAllowed("sub.127.0.0.1", policy)).toBe(false);
    expect(isUrlAllowedByPolicy("https://docs.example.com/a", policy)).toBe(true);
    expect(isUrlAllowedByPolicy("https://evil-example.com/a", policy)).toBe(false);
    expect(isUrlAllowedByPolicy("http://[::1]/", { mode: "allowlist", domains: ["[::1]"] })).toBe(true);
    expect(isUrlAllowedByPolicy("https://anything.test/", DEFAULT_POLICY)).toBe(true);
    expect(policySummary(policy)).toEqual({ mode: "allowlist", domains: ["example.com", "127.0.0.1"], allowAll: false });
  });

  test("域名归一：协议/路径/端口/通配前缀/重复项都被收敛，非法项拒绝", () => {
    expect(normalizeDomain("https://Docs.Example.com:8443/path?q=1")).toBe("docs.example.com");
    expect(normalizeDomain("*.Example.com")).toBe("example.com");
    expect(normalizeDomain(".example.com")).toBe("example.com");
    expect(normalizeDomain("[::1]")).toBe("[::1]");
    expect(normalizeDomains("a.com, B.com\nA.com；c.com")).toEqual(["a.com", "b.com", "c.com"]);
    expect(() => normalizeDomain("*")).toThrow("不允许单独使用");
    expect(() => normalizeDomain("bad domain")).toThrow("不是合法域名");
    expect(() => normalizePolicy({ mode: "allowlist", domains: ["x".repeat(70) + ".com"] })).toThrow();
    expect(() => normalizePolicy({ mode: "nope" })).toThrow("网络模式");
  });

  test("策略文件原子读写，坏文件回退到默认 all", () => {
    const dir = mkdtempSync(join(tmpdir(), "maxma-net-policy-"));
    const file = join(dir, "policy.json");
    try {
      expect(readPolicy(file)).toMatchObject({ mode: "all" });
      writePolicy(file, { mode: "allowlist", domains: ["Example.com", "example.com"] });
      expect(readPolicy(file)).toEqual({ version: 1, mode: "allowlist", domains: ["example.com"] });
      writeFileSync(file, "{bad", "utf8");
      expect(readPolicy(file)).toMatchObject({ mode: "all", domains: [] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("浏览器下载落盘", () => {
  test("文件名清洗路径穿越、Windows 非法字符、保留名与超长名", () => {
    expect(sanitizeDownloadName("../../secret.txt")).toBe("secret.txt");
    expect(sanitizeDownloadName("C:\\temp\\a:b?.txt")).toBe("a_b_.txt");
    expect(sanitizeDownloadName("CON")).toBe("_CON");
    expect(sanitizeDownloadName("nul.txt")).toBe("_nul.txt");
    expect(sanitizeDownloadName("...")).toBe("download");
    expect(sanitizeDownloadName("")).toBe("download");
    const long = sanitizeDownloadName(`${"a".repeat(300)}.txt`);
    expect(long.length).toBeLessThanOrEqual(180);
    expect(long.endsWith(".txt")).toBe(true);
  });

  test("同名文件自动编号，大小上限判定不复用负数/NaN", () => {
    const dir = mkdtempSync(join(tmpdir(), "maxma-download-"));
    try {
      const first = uniqueDownloadPath(dir, "a.txt");
      writeFileSync(first, "x");
      const second = uniqueDownloadPath(dir, "a.txt");
      expect(second.endsWith("a (1).txt")).toBe(true);
      expect(new Set([first, second]).size).toBe(2);
      expect(exceedsDownloadLimit(MAX_DOWNLOAD_BYTES + 1)).toBe(true);
      expect(exceedsDownloadLimit(MAX_DOWNLOAD_BYTES)).toBe(false);
      expect(exceedsDownloadLimit(Number.NaN)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
