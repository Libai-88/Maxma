/** web-search-parser.test.ts — Bing 搜索结果离线解析。 */
import { describe, expect, test } from "bun:test";

import { parseBingResults } from "../src/tools/web";

describe("Bing result parser", () => {
  test("extracts title, url and snippet from b_algo cards", () => {
    const html = `<ol><li class="b_algo"><h2><a href="https://example.com/a">Result <strong>A</strong></a></h2><p>First snippet</p></li><li class="b_algo"><div><h2><a href="https://example.org/b">Result B</a></h2><p>Second <b>snippet</b></p></div></li></ol>`;
    const hits = parseBingResults(html, 2);
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({ title: "Result A", url: "https://example.com/a", snippet: "First snippet" });
    expect(hits[1]?.title).toBe("Result B");
    expect(hits[1]?.snippet).toBe("Second snippet");
  });

  test("ignores cards without an http link", () => {
    const html = `<li class="b_algo"><h2><a href="/relative">No</a></h2><p>x</p></li>`;
    expect(parseBingResults(html)).toHaveLength(0);
  });
});
