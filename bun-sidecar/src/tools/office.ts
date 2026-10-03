import * as fs from "node:fs/promises";
import * as path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

import type { MaxmaToolDescriptor, MaxmaToolResult } from "./descriptor";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_CHARS = 50_000;
const TEXT_EXTENSIONS = new Set([".csv", ".tsv", ".txt", ".md", ".json", ".yaml", ".yml"]);

function result(text: string, details?: unknown): MaxmaToolResult {
  return { content: [{ type: "text", text }], details };
}

function resolveWorkspaceFile(cwd: string, requestedPath: string): string {
  const root = path.resolve(cwd);
  const absolute = path.resolve(root, requestedPath);
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("文件必须位于当前工作区内。");
  }
  return absolute;
}

function limitText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[内容已截断，原始字符数：${text.length}]`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function decodeXmlText(value: string): string {
  return value
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function docxText(bytes: Uint8Array): string {
  const files = unzipSync(bytes);
  const documentXml = files["word/document.xml"];
  if (!documentXml) throw new Error("DOCX 缺少 word/document.xml。");
  const xml = strFromU8(documentXml);
  const paragraphs = [...xml.matchAll(/<w:p(?:\s[^>]*)?>(.*?)<\/w:p>/gs)].map((match) =>
    [...match[1].matchAll(/<w:t(?:\s[^>]*)?>(.*?)<\/w:t>/gs)]
      .map((textMatch) => decodeXmlText(textMatch[1]))
      .join(""),
  );
  return paragraphs.filter(Boolean).join("\n");
}

function workbookSharedStrings(files: Record<string, Uint8Array>): string[] {
  const shared = files["xl/sharedStrings.xml"];
  if (!shared) return [];
  return [...strFromU8(shared).matchAll(/<si(?:\s[^>]*)?>(.*?)<\/si>/gs)].map((match) =>
    [...match[1].matchAll(/<t(?:\s[^>]*)?>(.*?)<\/t>/gs)]
      .map((textMatch) => decodeXmlText(textMatch[1]))
      .join(""),
  );
}

function xlsxText(bytes: Uint8Array): string {
  const files = unzipSync(bytes);
  const worksheetName = Object.keys(files).find((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
  if (!worksheetName) throw new Error("XLSX 缺少工作表。");
  const sharedStrings = workbookSharedStrings(files);
  const xml = strFromU8(files[worksheetName]);
  const rows = [...xml.matchAll(/<row(?:\s[^>]*)?>(.*?)<\/row>/gs)].map((rowMatch) => {
    const cells = [...rowMatch[1].matchAll(/<c(?:\s[^>]*)?>(.*?)<\/c>/gs)];
    const values = cells.map((cellMatch) => {
      const cellXml = cellMatch[0];
      const type = /\bt="([^"']+)"/.exec(cellXml)?.[1];
      const inline = [...cellXml.matchAll(/<t(?:\s[^>]*)?>(.*?)<\/t>/gs)]
        .map((textMatch) => decodeXmlText(textMatch[1]))
        .join("");
      const raw = /<v(?:\s[^>]*)?>(.*?)<\/v>/s.exec(cellXml)?.[1] ?? inline;
      const value = decodeXmlText(raw);
      if (type === "s") return sharedStrings[Number(value)] ?? "";
      return value;
    });
    return values.join("\t");
  });
  return rows.join("\n");
}

function docxArchive(content: string): Uint8Array {
  const paragraphs = content.split(/\r?\n/).map((line) =>
    `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`,
  ).join("");
  return zipSync({
    "[Content_Types].xml": strToU8("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/></Types>"),
    "_rels/.rels": strToU8("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/></Relationships>"),
    "word/document.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr/></w:body></w:document>`),
  });
}

function xlsxArchive(rows: unknown[][]): Uint8Array {
  const rowXml = rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => {
      const reference = `${String.fromCharCode(65 + (columnIndex % 26))}${rowIndex + 1}`;
      const text = String(value ?? "");
      const numeric = text.trim() !== "" && Number.isFinite(Number(text));
      return numeric
        ? `<c r="${reference}"><v>${escapeXml(text)}</v></c>`
        : `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  return zipSync({
    "[Content_Types].xml": strToU8("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/><Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/></Types>"),
    "_rels/.rels": strToU8("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>"),
    "xl/workbook.xml": strToU8("<?xml version=\"1.0\" encoding=\"UTF-8\"?><workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets><sheet name=\"Sheet1\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>"),
    "xl/_rels/workbook.xml.rels": strToU8("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/></Relationships>"),
    "xl/worksheets/sheet1.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowXml}</sheetData></worksheet>`),
  });
}

async function pdfText(absolutePath: string): Promise<string> {
  const command = Bun.which("pdftotext");
  if (!command) {
    throw new Error("当前系统未提供 pdftotext，无法在本地读取 PDF；可配置支持 PDF 的 MCP 工具。");
  }
  const process = Bun.spawn([command, "-layout", absolutePath, "-"], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  const exitCode = await process.exited;
  if (exitCode !== 0) throw new Error(stderr.trim() || `pdftotext 退出码：${exitCode}`);
  return stdout;
}

async function readFileContent(cwd: string, requestedPath: string): Promise<{ text: string; format: string; path: string }> {
  const absolutePath = resolveWorkspaceFile(cwd, requestedPath);
  const stat = await fs.stat(absolutePath);
  if (!stat.isFile()) throw new Error("目标路径不是文件。");
  if (stat.size > MAX_FILE_BYTES) throw new Error(`文件超过 ${MAX_FILE_BYTES / 1024 / 1024} MB 限制。`);
  const extension = path.extname(absolutePath).toLowerCase();
  if (TEXT_EXTENSIONS.has(extension)) {
    return { text: await fs.readFile(absolutePath, "utf8"), format: extension.slice(1), path: absolutePath };
  }
  const bytes = new Uint8Array(await fs.readFile(absolutePath));
  if (extension === ".docx") return { text: docxText(bytes), format: "docx", path: absolutePath };
  if (extension === ".xlsx") return { text: xlsxText(bytes), format: "xlsx", path: absolutePath };
  if (extension === ".pdf") return { text: await pdfText(absolutePath), format: "pdf", path: absolutePath };
  throw new Error("支持的格式：DOCX、XLSX、PDF、CSV、TSV、TXT、Markdown、JSON、YAML。");
}

export function readOfficeFileTool(cwd: string): MaxmaToolDescriptor {
  return {
    name: "read_office_file",
    label: "Read Office File",
    description: "在当前工作区内读取 DOCX、XLSX、PDF 或常见文本办公文件，返回可供整理和总结的文本内容。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "相对于当前工作区的文件路径" },
        max_chars: { type: "integer", minimum: 1000, maximum: 200000, description: "最多返回字符数，默认 50000" },
      },
      required: ["path"],
      additionalProperties: false,
    },
    approval: "read",
    async execute(_toolCallId, params) {
      try {
        const requestedPath = String(params.path ?? "").trim();
        if (!requestedPath) return result("path 不能为空。", { ok: false });
        const maxChars = Math.min(Math.max(Number(params.max_chars ?? DEFAULT_MAX_CHARS), 1000), 200000);
        const file = await readFileContent(cwd, requestedPath);
        return result(limitText(file.text, maxChars), {
          ok: true,
          format: file.format,
          path: path.relative(cwd, file.path),
          truncated: file.text.length > maxChars,
        });
      } catch (error) {
        return result(`读取失败：${error instanceof Error ? error.message : String(error)}`, { ok: false });
      }
    },
  };
}

export function writeOfficeFileTool(cwd: string): MaxmaToolDescriptor {
  return {
    name: "write_office_file",
    label: "Write Office File",
    description: "在当前工作区内生成 DOCX、XLSX、CSV 或常见文本办公文件；默认不覆盖已有文件。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "相对于当前工作区的输出路径" },
        content: { type: "string", description: "DOCX 或文本文件内容；XLSX 可省略并使用 rows" },
        rows: { type: "array", description: "XLSX 的二维单元格数组" },
        overwrite: { type: "boolean", description: "是否允许覆盖已有文件，默认 false" },
      },
      required: ["path"],
      additionalProperties: false,
    },
    approval: "write",
    async execute(_toolCallId, params) {
      try {
        const requestedPath = String(params.path ?? "").trim();
        if (!requestedPath) return result("path 不能为空。", { ok: false });
        const absolutePath = resolveWorkspaceFile(cwd, requestedPath);
        const extension = path.extname(absolutePath).toLowerCase();
        const overwrite = params.overwrite === true;
        if (!overwrite && await fs.stat(absolutePath).then(() => true).catch(() => false)) {
          return result("目标文件已存在；如需覆盖，请明确传入 overwrite=true。", { ok: false });
        }
        let bytes: Uint8Array;
        if (extension === ".docx") {
          bytes = docxArchive(String(params.content ?? ""));
        } else if (extension === ".xlsx") {
          const rows = Array.isArray(params.rows) ? params.rows : [];
          if (!rows.every((row) => Array.isArray(row))) return result("XLSX 的 rows 必须是二维数组。", { ok: false });
          bytes = xlsxArchive(rows as unknown[][]);
        } else if (TEXT_EXTENSIONS.has(extension)) {
          bytes = new TextEncoder().encode(String(params.content ?? ""));
        } else {
          return result("支持的输出格式：DOCX、XLSX、CSV、TSV、TXT、Markdown、JSON、YAML。", { ok: false });
        }
        await fs.writeFile(absolutePath, bytes);
        return result(`已写入 ${path.relative(cwd, absolutePath)}`, { ok: true, path: path.relative(cwd, absolutePath), format: extension.slice(1) });
      } catch (error) {
        return result(`写入失败：${error instanceof Error ? error.message : String(error)}`, { ok: false });
      }
    },
  };
}
