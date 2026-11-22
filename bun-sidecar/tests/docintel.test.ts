import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { cancelDocIndex, getDocIndexStatus, startDocIndex } from "../src/docintel/index";
import { readDoc, searchDocs } from "../src/docintel/search";
import { docReadTool, docSearchTool } from "../src/tools/doc";

let root = "";
let dbPath = "";

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-docintel-"));
  dbPath = path.join(root, "doc-index.db");
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function writeZip(name: string, files: Record<string, string>): void {
  const archive = zipSync(Object.fromEntries(Object.entries(files).map(([entry, content]) => [entry, strToU8(content)])));
  fs.writeFileSync(path.join(root, name), archive);
}

/** 生成一个可被 PDF.js 解析的最小多页 PDF（ASCII 文本，无嵌入字体）。 */
function makePdf(pages: string[]): Uint8Array {
  const objects: string[] = [];
  const pageIds = pages.map((_page, index) => 3 + index * 2);
  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  const fontId = 3 + pages.length * 2;
  pages.forEach((page, index) => {
    const pageId = pageIds[index]!;
    const contentId = pageId + 1;
    const escaped = page.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`;
    objects[contentId] = `<< /Length ${`BT /F1 14 Tf 72 720 Td (${escaped}) Tj ET`.length} >>\nstream\nBT /F1 14 Tf 72 720 Td (${escaped}) Tj ET\nendstream`;
  });
  objects[fontId] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;

  let output = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let index = 1; index < objects.length; index += 1) {
    offsets[index] = output.length;
    output += `${index} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = output.length;
  output += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let index = 1; index < objects.length; index += 1) {
    output += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(output, "latin1"));
}

async function waitReady(): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 15000) {
    const [status] = getDocIndexStatus(dbPath, [{ path: root }]);
    if (status?.status === "ready") return;
    if (status?.status === "error") throw new Error(status.error ?? "index error");
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error("doc index not ready");
}

describe("docintel", () => {
  test("5 篇 PDF + DOCX/XLSX/MD/HTML 可检索，页码/工作表/段落坐标正确", async () => {
    for (let index = 1; index <= 5; index += 1) {
      fs.writeFileSync(
        path.join(root, `paper-${index}.pdf`),
        makePdf([`PAPER ${index} PAGE ONE marker-${index}`, `PAPER ${index} PAGE TWO thermal materials`]),
      );
    }
    writeZip("brief.docx", {
      "word/document.xml":
        "<w:document><w:body><w:p><w:r><w:t>标题：热电材料综述</w:t></w:r></w:p><w:p><w:r><w:t>本项目研究热电材料与自修复聚氨酯涂层。</w:t></w:r></w:p><w:p><w:r><w:t>第三段用于页码和段落坐标验证。</w:t></w:r></w:p></w:body></w:document>",
    });
    writeZip("data.xlsx", {
      "xl/workbook.xml": "<workbook><sheets><sheet name=\"汇总\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>",
      "xl/_rels/workbook.xml.rels": "<Relationships><Relationship Id=\"rId1\" Target=\"worksheets/sheet1.xml\"/></Relationships>",
      "xl/sharedStrings.xml": "<sst><si><t>材料</t></si><si><t>热电性能</t></si></sst>",
      "xl/worksheets/sheet1.xml":
        "<worksheet><sheetData><row r=\"1\"><c r=\"A1\" t=\"s\"><v>0</v></c><c r=\"B1\" t=\"s\"><v>1</v></c></row><row r=\"2\"><c r=\"A2\" t=\"inlineStr\"><is><t>自修复涂层</t></is></c><c r=\"B2\"><v>42</v></c></row></sheetData></worksheet>",
    });
    fs.writeFileSync(path.join(root, "notes.md"), "# 记录\n\n热电材料实验记录：样品 A 在 300K 下电阻下降。\n");
    fs.writeFileSync(
      path.join(root, "page.html"),
      "<html><body><h1>网页资料</h1><p>热电器件的转换效率与温差有关。</p><script>shouldNotIndex()</script></body></html>",
    );

    startDocIndex(root, { force: true }, dbPath);
    await waitReady();
    const [status] = getDocIndexStatus(dbPath, [{ path: root }]);
    expect(status?.fileCount).toBe(9);
    expect(status?.chunkCount).toBeGreaterThanOrEqual(9);

    for (let index = 1; index <= 5; index += 1) {
      const hits = searchDocs(`marker-${index}`, { root, dbPath, limit: 5 });
      expect(hits.some((hit) => hit.relPath === `paper-${index}.pdf` && hit.locator.page === 1)).toBe(true);
    }

    const pdfHit = searchDocs("thermal materials", { root, dbPath });
    expect(pdfHit.some((hit) => hit.locator.page === 2)).toBe(true);

    const docxHits = searchDocs("自修复聚氨酯涂层", { root, dbPath });
    expect(docxHits[0]?.relPath).toBe("brief.docx");
    expect(docxHits[0]?.locator.paragraphs).toEqual([2, 2]);
    const xlsxHits = searchDocs("热电性能", { root, dbPath });
    expect(xlsxHits[0]?.relPath).toBe("data.xlsx");
    expect(xlsxHits[0]?.locator.sheet).toBe("汇总");

    const htmlHits = searchDocs("转换效率", { root, dbPath });
    expect(htmlHits[0]?.relPath).toBe("page.html");

    const docxRead = readDoc("brief.docx", { root, paragraph: 3, dbPath });
    expect(docxRead?.chunks[0]?.locator.paragraphs).toEqual([3, 3]);
    expect(docxRead?.chunks[0]?.text).toContain("第三段用于页码和段落坐标验证");

    const pdfRead = readDoc("paper-3.pdf", { root, page: 2, dbPath });
    expect(pdfRead?.chunks[0]?.locator.page).toBe(2);
    expect(pdfRead?.chunks[0]?.text).toContain("PAGE TWO");

    const xlsxRead = readDoc("data.xlsx", { root, sheet: "汇总", dbPath });
    expect(xlsxRead?.chunks[0]?.text).toContain("B2: 42");
  });

  test("增量更新替换旧块；扫描件显式 unsupported；工具返回来源坐标", async () => {
    fs.writeFileSync(path.join(root, "memo.md"), "旧内容 old-marker 不应再命中。\n");
    fs.writeFileSync(path.join(root, "scan.pdf"), "not a pdf");
    startDocIndex(root, { force: true }, dbPath);
    await waitReady();
    expect(searchDocs("old-marker", { root, dbPath }).length).toBe(1);

    fs.writeFileSync(path.join(root, "memo.md"), "新内容 new-marker 与热电材料共同出现。\n");
    startDocIndex(root, { force: true }, dbPath);
    await waitReady();
    expect(searchDocs("old-marker", { root, dbPath }).length).toBe(0);
    expect(searchDocs("new-marker", { root, dbPath })[0]?.relPath).toBe("memo.md");

    const [status] = getDocIndexStatus(dbPath, [{ path: root }]);
    expect(status?.unsupportedCount).toBe(1);
    expect(status?.warnings.join("\n")).toContain("scan.pdf");
    const read = readDoc("scan.pdf", { root, dbPath });
    expect(read?.status).toBe("unsupported");

    process.env.MAXMA_DOC_INDEX_DB = dbPath;
    const search = await docSearchTool(root).execute("test", { query: "热电材料" });
    expect(search.details).toMatchObject({ ok: true });
    expect(String(search.content[0]?.text)).toContain("第 1 Markdown 行");
    const readTool = await docReadTool(root).execute("test", { path: "memo.md", start_line: 1, end_line: 1 });
    expect(readTool.details).toMatchObject({ ok: true });
    expect(String(readTool.content[0]?.text)).toContain("new-marker");
    delete process.env.MAXMA_DOC_INDEX_DB;
  });

  test("取消构建后状态为 cancelled，不删除既有索引", async () => {
    fs.writeFileSync(path.join(root, "keep.md"), "keep-marker\n");
    startDocIndex(root, { force: true }, dbPath);
    await waitReady();
    expect(cancelDocIndex(root)).toBe(false);
    expect(searchDocs("keep-marker", { root, dbPath }).length).toBe(1);
  });
});
