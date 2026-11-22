import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { zipSync, strToU8, unzipSync, strFromU8 } from "fflate";
import { describe, expect, test } from "bun:test";

import { editOfficeFileTool, readOfficeFileTool, writeOfficeFileTool } from "../src/tools/office";

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

  test("writes native editable PPTX slides and reads them back per slide", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "maxma-office-"));
    const write = writeOfficeFileTool(root);
    const output = await write.execute("test", {
      path: "deck.pptx",
      title: "M2 办公能力",
      subtitle: "可编辑 PPTX · 2026",
      slides: [
        { title: "封面不需要重复", bullets: [] },
        { title: "实时预览", bullets: ["DOCX / XLSX / PPTX", "落盘后 2 秒内刷新", "只读，不抢编辑"] },
        { title: "结构化选改", bullets: ["选中段落再下指令", "产物保留版本"] },
      ],
    });
    expect(output.details).toMatchObject({ ok: true, format: "pptx" });

    const file = await fs.readFile(path.join(root, "deck.pptx"));
    const zip = unzipSync(file);
    const contentTypes = strFromU8(zip["[Content_Types].xml"]!);
    const declaredParts = [...contentTypes.matchAll(/<Override\b[^>]*PartName="\/([^"]+)"/g)]
      .map((match) => match[1]!);
    for (const part of declaredParts) {
      expect(zip[part]).toBeDefined();
    }
    const slideFiles = Object.keys(zip).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
    expect(slideFiles.length).toBe(3);
    for (const name of slideFiles) {
      const xml = strFromU8(zip[name]!);
      // 原生形状 + 文本节点：PowerPoint 里能直接改字，不是图片幻灯片。
      expect(xml).toContain("<p:sp>");
      expect(xml).toContain("<a:t>");
      expect(xml).not.toContain("<a:blip");
      expect(xml).not.toContain("r:embed=");
    }

    const read = await readOfficeFileTool(root).execute("test", { path: "deck.pptx" });
    const text = String(read.content[0]?.text ?? "");
    expect(text).toContain("## 幻灯片 1");
    expect(text).toContain("M2 办公能力");
    expect(text).toContain("可编辑 PPTX · 2026");
    expect(text).toContain("## 幻灯片 2");
    expect(text).toContain("实时预览");
    expect(text).toContain("落盘后 2 秒内刷新");
    expect(read.details).toMatchObject({ ok: true, format: "pptx" });
  });

  test("falls back to Markdown headings when PPTX slides are omitted", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "maxma-office-"));
    const write = writeOfficeFileTool(root);
    const output = await write.execute("test", {
      path: "outline.pptx",
      content: "# 周会汇报\n季度进展与风险\n## 本周完成\n- 预览链路\n- PPTX 生成\n## 下周计划\n- 版本历史",
    });
    expect(output.details).toMatchObject({ ok: true, format: "pptx" });
    const read = await readOfficeFileTool(root).execute("test", { path: "outline.pptx" });
    const text = String(read.content[0]?.text ?? "");
    expect(text).toContain("## 幻灯片 1\n周会汇报\n季度进展与风险");
    expect(text).toContain("## 幻灯片 2\n本周完成\n预览链路\nPPTX 生成");
    expect(text).toContain("## 幻灯片 3\n下周计划\n版本历史");
  });

  test("rejects PPTX slides without a title", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "maxma-office-"));
    const output = await writeOfficeFileTool(root).execute("test", {
      path: "bad.pptx",
      slides: [{ bullets: ["没有标题"] }],
    });
    expect(output.details).toMatchObject({ ok: false });
    expect(String(output.content[0]?.text ?? "")).toContain("slides[0] 缺少 title");
  });

  test("rejects files outside the workspace", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "maxma-office-"));
    const output = await readOfficeFileTool(root).execute("test", { path: "../outside.txt" });
    expect(output.content[0]?.text).toContain("文件必须位于当前工作区内");
    expect(output.details).toMatchObject({ ok: false });
  });

  test("reads an Office artifact inside an explicit staging write root", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "maxma-office-"));
    const staging = await fs.mkdtemp(path.join(os.tmpdir(), "maxma-office-staging-"));
    try {
      const output = await writeOfficeFileTool(root, [staging]).execute("test", {
        path: path.join(staging, "brief.docx"),
        content: "# 选改产物\n原段落",
      });
      expect(output.details).toMatchObject({ ok: true, format: "docx" });
      const read = await readOfficeFileTool(root, [staging]).execute("test", {
        path: path.join(staging, "brief.docx"),
      });
      expect(String(read.content[0]?.text ?? "")).toContain("原段落");
      expect(read.details).toMatchObject({ ok: true, format: "docx" });
    } finally {
      await fs.rm(staging, { recursive: true, force: true });
    }
  });

  test("edits a selected DOCX paragraph without rewriting the document", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "maxma-office-"));
    const write = writeOfficeFileTool(root);
    await write.execute("test", { path: "edit.docx", content: "# 标题\n正文保留\n- 要点保留" });
    const edit = editOfficeFileTool(root);
    const output = await edit.execute("test", {
      path: "edit.docx",
      edits: [{ kind: "docx", find: "正文保留", replace: "正文已改" }],
    });
    expect(output.details).toMatchObject({ ok: true, edits: 1 });
    const read = await readOfficeFileTool(root).execute("test", { path: "edit.docx" });
    const text = String(read.content[0]?.text ?? "");
    expect(text).toContain("# 标题");
    expect(text).toContain("正文已改");
    expect(text).toContain("• 要点保留");
  });

  test("edits a selected PPTX slide title in place", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "maxma-office-"));
    const write = writeOfficeFileTool(root);
    await write.execute("test", {
      path: "edit.pptx",
      slides: [
        { title: "封面" },
        { title: "原副标题", bullets: ["要点一", "要点二"] },
      ],
    });
    const output = await editOfficeFileTool(root).execute("test", {
      path: "edit.pptx",
      edits: [{ kind: "pptx", slide: 2, find: "原副标题", replace: "新副标题" }],
    });
    expect(output.details).toMatchObject({ ok: true, edits: 1 });
    const read = await readOfficeFileTool(root).execute("test", { path: "edit.pptx" });
    const text = String(read.content[0]?.text ?? "");
    expect(text).toContain("新副标题");
    expect(text).toContain("要点一");
    expect(text).not.toContain("原副标题");
  });

  test("edits an existing XLSX cell and keeps other cells intact", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "maxma-office-"));
    const write = writeOfficeFileTool(root);
    await write.execute("test", {
      path: "edit.xlsx",
      sheets: [{ name: "明细", rows: [["项目", "金额"], ["A", 42], ["B", 7]] }],
    });
    const output = await editOfficeFileTool(root).execute("test", {
      path: "edit.xlsx",
      edits: [{ kind: "xlsx", sheet: "明细", cell: "B2", value: "99" }],
    });
    expect(output.details).toMatchObject({ ok: true, edits: 1 });
    const read = await readOfficeFileTool(root).execute("test", { path: "edit.xlsx" });
    const text = String(read.content[0]?.text ?? "");
    expect(text).toContain("项目\t金额");
    expect(text).toContain("A\t99");
    expect(text).toContain("B\t7");
  });

  test("rejects ambiguous DOCX selection instead of changing the wrong paragraph", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "maxma-office-"));
    await writeOfficeFileTool(root).execute("test", { path: "dup.docx", content: "重复\n重复" });
    const output = await editOfficeFileTool(root).execute("test", {
      path: "dup.docx",
      edits: [{ kind: "docx", find: "重复", replace: "改掉" }],
    });
    expect(output.details).toMatchObject({ ok: false });
    expect(String(output.content[0]?.text ?? "")).toContain("出现 2 次");
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
