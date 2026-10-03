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
    expect(output.content[0]?.text).toContain("项目\t金额\n42");
    expect(output.details).toMatchObject({ ok: true, format: "xlsx" });
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
