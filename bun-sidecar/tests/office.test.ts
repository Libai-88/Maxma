import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { zipSync, strToU8 } from "fflate";
import { describe, expect, test } from "bun:test";

import { readOfficeFileTool, writeOfficeFileTool } from "../src/tools/office";

async function writeZip(root: string, name: string, files: Record<string, string>): Promise<string> {
  const archive = zipSync(Object.fromEntries(Object.entries(files).map(([file, content]) => [file, strToU8(content)])));
  const filePath = path.join(root, name);
  await fs.writeFile(filePath, archive);
  return filePath;
}

describe("office tools", () => {
  test("reads DOCX paragraph text inside the workspace", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "maxma-office-"));
    await writeZip(root, "brief.docx", {
      "word/document.xml": "<w:document><w:body><w:p><w:r><w:t>会议纪要</w:t></w:r></w:p><w:p><w:r><w:t>第二段</w:t></w:r></w:p></w:body></w:document>",
    });
    const output = await readOfficeFileTool(root).execute("test", { path: "brief.docx" });
    expect(output.content[0]?.text).toContain("会议纪要\n第二段");
    expect(output.details).toMatchObject({ ok: true, format: "docx" });
  });

  test("reads the first XLSX worksheet and shared strings", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "maxma-office-"));
    await writeZip(root, "budget.xlsx", {
      "xl/sharedStrings.xml": "<sst><si><t>项目</t></si><si><t>金额</t></si></sst>",
      "xl/worksheets/sheet1.xml": "<worksheet><sheetData><row><c t=\"s\"><v>0</v></c><c t=\"s\"><v>1</v></c></row><row><c><v>42</v></c></row></sheetData></worksheet>",
    });
    const output = await readOfficeFileTool(root).execute("test", { path: "budget.xlsx" });
    expect(output.content[0]?.text).toContain("## 工作表：Sheet1\n项目\t金额\n42");
    expect(output.details).toMatchObject({ ok: true, format: "xlsx" });
  });

  test("reads all XLSX worksheets by workbook metadata and preserves columns", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "maxma-office-"));
    await writeZip(root, "multi.xlsx", {
      "xl/workbook.xml": "<workbook xmlns:r=\"r\"><sheets><sheet name=\"汇总\" sheetId=\"1\" r:id=\"rId1\"/><sheet name=\"明细\" sheetId=\"2\" r:id=\"rId2\"/></sheets></workbook>",
      "xl/_rels/workbook.xml.rels": "<Relationships><Relationship Id=\"rId1\" Target=\"worksheets/sheet1.xml\"/><Relationship Id=\"rId2\" Target=\"worksheets/sheet2.xml\"/></Relationships>",
      "xl/worksheets/sheet1.xml": "<worksheet><sheetData><row r=\"1\"><c r=\"A1\" t=\"inlineStr\"><is><t>合计</t></is></c><c r=\"C1\"><v>9</v></c></row></sheetData></worksheet>",
      "xl/worksheets/sheet2.xml": "<worksheet><sheetData><row><c t=\"inlineStr\"><is><t>备注</t></is></c></row></sheetData></worksheet>",
    });
    const output = await readOfficeFileTool(root).execute("test", { path: "multi.xlsx" });
    const text = String(output.content[0]?.text ?? "");
    expect(text).toContain("## 工作表：汇总");
    expect(text).toContain("合计\t\t9");
    expect(text).toContain("## 工作表：明细");
  });

  test("preserves DOCX table rows and columns", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "maxma-office-"));
    await writeZip(root, "table.docx", {
      "word/document.xml": "<w:document><w:body><w:p><w:r><w:t>说明</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>项目</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>金额</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>42</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>",
    });
    const output = await readOfficeFileTool(root).execute("test", { path: "table.docx" });
    expect(output.content[0]?.text).toContain("[表格]\n| 项目 | 金额 |\n| A | 42 |");
  });

  test("writes XLSX with multiple named sheets and reads them back", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "maxma-office-"));
    const write = writeOfficeFileTool(root);
    const output = await write.execute("test", {
      path: "multi.xlsx",
      sheets: [
        { name: "汇总", rows: [["项目", "金额"], ["A", 42]] },
        { name: "明细", rows: [["备注", "状态"], ["第一条", "完成"]] },
      ],
    });
    expect(output.details).toMatchObject({ ok: true, format: "xlsx" });
    const read = await readOfficeFileTool(root).execute("test", { path: "multi.xlsx" });
    const text = String(read.content[0]?.text ?? "");
    expect(text).toContain("## 工作表：汇总");
    expect(text).toContain("## 工作表：明细");
  });

  test("reads DOCX heading styles, bold text and images with relationship target", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "maxma-office-"));
    await writeZip(root, "styled.docx", {
      "word/styles.xml": "<w:styles><w:style w:type=\"paragraph\" w:styleId=\"Heading1\"><w:name w:val=\"heading 1\"/></w:style></w:styles>",
      "word/_rels/document.xml.rels": "<Relationships><Relationship Id=\"rId5\" Target=\"media/image1.png\"/></Relationships>",
      "word/document.xml": "<w:document><w:body>" +
        "<w:p><w:pPr><w:pStyle w:val=\"Heading1\"/></w:pPr><w:r><w:t>一级标题</w:t></w:r></w:p>" +
        "<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>加粗结论</w:t></w:r></w:p>" +
        "<w:p><w:r><w:drawing><wp:docPr descr=\"示意图\"/><a:blip r:embed=\"rId5\"/></w:drawing></w:r></w:p>" +
        "</w:body></w:document>",
    });
    const output = await readOfficeFileTool(root).execute("test", { path: "styled.docx" });
    const text = String(output.content[0]?.text ?? "");
    expect(text).toContain("# 一级标题");
    expect(text).toContain("**加粗结论**");
    expect(text).toContain("[图片] 示意图（media/image1.png）");
  });

  test("writes markdown-like DOCX with heading styles and reads it back", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "maxma-office-"));
    const write = writeOfficeFileTool(root);
    const output = await write.execute("test", { path: "report.docx", content: "# 周报\n正文\n- 要点一" });
    expect(output.details).toMatchObject({ ok: true });
    const read = await readOfficeFileTool(root).execute("test", { path: "report.docx" });
    const text = String(read.content[0]?.text ?? "");
    expect(text).toContain("# 周报");
    expect(text).toContain("• 要点一");
  });

  test("rejects files outside the workspace", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "maxma-office-"));
    const output = await readOfficeFileTool(root).execute("test", { path: "../outside.txt" });
    expect(output.content[0]?.text).toContain("文件必须位于当前工作区内");
    expect(output.details).toMatchObject({ ok: false });
  });

  test("writes DOCX and XLSX without overwriting by default", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "maxma-office-"));
    const tool = writeOfficeFileTool(root);
    const docx = await tool.execute("test", { path: "out.docx", content: "标题\n正文" });
    const xlsx = await tool.execute("test", { path: "out.xlsx", rows: [["项目", "金额"], ["A", 42]] });
    const duplicate = await tool.execute("test", { path: "out.docx", content: "覆盖" });
    expect(docx.details).toMatchObject({ ok: true, format: "docx" });
    expect(xlsx.details).toMatchObject({ ok: true, format: "xlsx" });
    expect(duplicate.content[0]?.text).toContain("目标文件已存在");
    expect((await fs.stat(path.join(root, "out.docx"))).size).toBeGreaterThan(0);
    expect((await fs.stat(path.join(root, "out.xlsx"))).size).toBeGreaterThan(0);
  });
});
