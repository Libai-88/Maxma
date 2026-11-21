/** tools/web.test.ts — Web 研究的 SSRF/私网/解析边界。 */
import { describe, expect, test } from "bun:test";

import {
  assertPublicUrl,
  fetchPublicPage,
  isPrivateAddress,
  parseDuckDuckGoResults,
  parseHtmlPage,
  webFetchTool,
} from "../src/tools/web";

describe("web research tools", () => {
  test("blocks private, loopback, link-local, CGNAT and multicast addresses", () => {
    for (const address of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "224.0.0.1", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateAddress(address)).toBe(true);
    }
    expect(isPrivateAddress("93.184.216.34")).toBe(false);
    expect(isPrivateAddress("2606:2800:220:1:248:1893:25c8:1946")).toBe(false);
  });

  test("rejects localhost, metadata hosts, credentials and dangerous ports", async () => {
    await expect(assertPublicUrl("http://localhost:8080")).rejects.toThrow("本机/内网");
    await expect(assertPublicUrl("http://169.254.169.254/latest/meta-data")).rejects.toThrow("私网");
    await expect(assertPublicUrl("https://user:pass@example.com")).rejects.toThrow("凭据");
    await expect(assertPublicUrl("ftp://example.com")).rejects.toThrow("http/https");
    await expect(assertPublicUrl("http://example.com:6379")).rejects.toThrow("内网服务端口");
  });

  test("rejects domains whose DNS resolves to private addresses", async () => {
    const resolver = (async () => [{ address: "192.168.10.5", family: 4 }]) as unknown as typeof import("node:dns/promises").lookup;
    await expect(assertPublicUrl("https://example.com", resolver)).rejects.toThrow("私网地址");
    const publicResolver = (async () => [{ address: "93.184.216.34", family: 4 }]) as unknown as typeof import("node:dns/promises").lookup;
    await expect(assertPublicUrl("https://example.com", publicResolver)).resolves.toBeInstanceOf(URL);
  });

  test("parses HTML into title, readable text and resolved links", () => {
    const page = parseHtmlPage(
      `<html><head><title>Maxma &amp; 工作台</title><style>.x{color:red}</style></head><body><article><h1>标题</h1><p>正文 <b>加粗</b></p><a href="/docs">文档</a><script>alert(1)</script></article></body></html>`,
      "https://example.com/page",
    );
    expect(page.title).toBe("Maxma & 工作台");
    expect(page.text).toContain("标题");
    expect(page.text).toContain("正文 加粗");
    expect(page.text).not.toContain("alert");
    expect(page.links).toContainEqual({ title: "文档", url: "https://example.com/docs" });
  });

  test("parses DuckDuckGo result cards and unwraps redirect URLs", () => {
    const html = `<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa">Example A</a><div class="result__snippet">摘要 A</div></div><div class="result"><a class="result__a" href="https://example.org/b">Example B</a><div class="result__snippet">摘要 B</div></div>`;
    const hits = parseDuckDuckGoResults(html);
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({ title: "Example A", url: "https://example.com/a", snippet: "摘要 A" });
    expect(hits[1]?.url).toBe("https://example.org/b");
  });

  test("fetches mocked public pages and rejects binary content types", async () => {
    const publicResolver = (async () => [{ address: "93.184.216.34", family: 4 }]) as unknown as typeof import("node:dns/promises").lookup;
    const htmlFetch = (async () => new Response("<html><title>抓取</title><body><main>正文</main></body></html>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    })) as unknown as typeof fetch;
    const page = await fetchPublicPage("https://example.com", { resolver: publicResolver, fetchImpl: htmlFetch });
    expect(page.title).toBe("抓取");
    expect(page.text).toContain("正文");

    const binaryFetch = (async () => new Response("PNG", { status: 200, headers: { "content-type": "image/png" } })) as unknown as typeof fetch;
    await expect(fetchPublicPage("https://example.com/a.png", { resolver: publicResolver, fetchImpl: binaryFetch })).rejects.toThrow("不支持的内容类型");
  });

  test("tool-level fetch refuses localhost without making a request", async () => {
    const output = await webFetchTool().execute("test", { url: "http://127.0.0.1:8080/private" });
    expect(output.content[0]?.text).toContain("抓取失败");
    expect(output.details).toMatchObject({ ok: false });
  });
});
