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

/**
 * 正则捕获组的取值助手。
 *
 * `match[1]` 在类型上是 `string | undefined`（`noUncheckedIndexedAccess` 下更明确），
 * 直接传给 `decodeXmlText(text: string)` 会报 TS2345。这里统一收口：
 * 捕获组缺失（理论上不应发生，正则里有该组）时退化为空串，而不是让 undefined
 * 流进 XML 解码。**不做非空断言**——真出现形状变化时，空串比崩溃更安全，
 * 而且这段代码解析的是用户上传的 Office 文件（半可控输入）。
 */
function capture(match: RegExpMatchArray | RegExpExecArray, index = 1): string {
  return match[index] ?? "";
}

function docxStyleMap(files: Record<string, Uint8Array>): Map<string, { name: string; heading: number }> {
  const styles = files["word/styles.xml"];
  const map = new Map<string, { name: string; heading: number }>();
  if (!styles) return map;
  for (const match of strFromU8(styles).matchAll(/<w:style\s+[^>]*w:type="paragraph"[^>]*>(.*?)<\/w:style>/gs)) {
    const body = capture(match, 1);
    const tag = capture(match, 0);
    const id = /\bw:styleId="([^"]+)"/.exec(tag)?.[1];
    const name = /<w:name\s+w:val="([^"]+)"/.exec(body)?.[1] ?? "";
    if (!id) continue;
    const level = /heading\s*([1-6])/i.exec(name)?.[1] ?? /标题\s*([1-6])/.exec(name)?.[1] ?? /^Heading([1-6])$/i.exec(id)?.[1];
    map.set(id, { name: decodeXmlText(name), heading: level ? Number(level) : 0 });
  }
  return map;
}

function docxRelationships(files: Record<string, Uint8Array>): Map<string, string> {
  const rels = files["word/_rels/document.xml.rels"];
  const map = new Map<string, string>();
  if (!rels) return map;
  for (const match of strFromU8(rels).matchAll(/<Relationship\s+[^>]*>/g)) {
    const tag = capture(match, 0);
    const id = /\bId="([^"]+)"/.exec(tag)?.[1];
    const target = /\bTarget="([^"]+)"/.exec(tag)?.[1];
    if (id && target && !target.startsWith("http")) map.set(id, target);
  }
  return map;
}

interface DocxRun {
  text: string;
  bold: boolean;
  italic: boolean;
}

interface DocxParagraph {
  text: string;
  heading: number;
  bold: boolean;
  italic: boolean;
  images: string[];
}

function docxRuns(fragment: string): DocxRun[] {
  return [...fragment.matchAll(/<w:r(?:\s[^>]*)?>(.*?)<\/w:r>/gs)].map((runMatch) => {
    const body = capture(runMatch, 1);
    const text = [...body.matchAll(/<w:t(?:\s[^>]*)?>(.*?)<\/w:t>/gs)]
      .map((textMatch) => decodeXmlText(capture(textMatch)))
      .join("");
    const boldTag = /<w:b(?:\s[^>]*)?\/?>/.exec(body)?.[0] ?? "";
    const italicTag = /<w:i(?:\s[^>]*)?\/?>/.exec(body)?.[0] ?? "";
    return {
      text,
      bold: boldTag !== "" && !/w:val="(?:0|false)"/.test(boldTag),
      italic: italicTag !== "" && !/w:val="(?:0|false)"/.test(italicTag),
    };
  });
}

function docxParagraph(fragment: string, styles: Map<string, { heading: number }>, rels: Map<string, string>): DocxParagraph {
  const styleId = /<w:pStyle\s+w:val="([^"]+)"/.exec(fragment)?.[1];
  const heading = styleId ? styles.get(styleId)?.heading ?? 0 : 0;
  const runs = docxRuns(fragment);
  const textRuns = runs.filter((run) => run.text.trim() !== "");
  const text = runs.map((run) => run.text).join("");
  const bold = textRuns.length > 0 && textRuns.every((run) => run.bold);
  const italic = textRuns.length > 0 && textRuns.every((run) => run.italic);
  const images: string[] = [];
  const seenEmbeds = new Set<string>();
  for (const embedMatch of fragment.matchAll(/<a:blip\s+[^>]*r:embed="([^"]+)"/g)) {
    const embed = capture(embedMatch);
    if (seenEmbeds.has(embed)) continue;
    seenEmbeds.add(embed);
    const target = rels.get(embed) ?? embed;
    const descr = /<wp:docPr\s+[^>]*descr="([^"]*)"/.exec(fragment)?.[1]
      ?? /<pic:cNvPr\s+[^>]*descr="([^"]*)"/.exec(fragment)?.[1]
      ?? "";
    images.push(`[图片] ${decodeXmlText(descr).trim() || "（无替代文本）"}（${target}）`);
  }
  return { text, heading, bold, italic, images };
}

function formatDocxParagraph(paragraph: DocxParagraph): string {
  const body = paragraph.text.trim();
  const decorated = body
    ? `${paragraph.bold ? "**" : ""}${paragraph.italic ? "*" : ""}${body}${paragraph.italic ? "*" : ""}${paragraph.bold ? "**" : ""}`
    : "";
  const heading = paragraph.heading > 0 && body ? `${"#".repeat(Math.min(paragraph.heading, 6))} ${body}` : decorated;
  return [heading, ...paragraph.images].filter(Boolean).join("\n");
}

function docxPlainText(fragment: string): string {
  return [...fragment.matchAll(/<w:t(?:\s[^>]*)?>(.*?)<\/w:t>/gs)]
    .map((textMatch) => decodeXmlText(capture(textMatch)))
    .join("");
}

function docxText(bytes: Uint8Array): string {
  const files = unzipSync(bytes);
  const documentXml = files["word/document.xml"];
  if (!documentXml) throw new Error("DOCX 缺少 word/document.xml。");
  const xml = strFromU8(documentXml);
  const styles = docxStyleMap(files);
  const rels = docxRelationships(files);

  // 按文档顺序同时提取段落与表格；表格保留行/列结构，便于后续整理。
  const blocks: string[] = [];
  for (const match of xml.matchAll(/<w:tbl(?:\s[^>]*)?>.*?<\/w:tbl>|<w:p(?:\s[^>]*)?>.*?<\/w:p>/gs)) {
    const block = capture(match, 0);
    if (block.startsWith("<w:tbl")) {
      const rows = [...block.matchAll(/<w:tr(?:\s[^>]*)?>.*?<\/w:tr>/gs)]
        .map((rowMatch) => {
          const cells = [...capture(rowMatch, 0).matchAll(/<w:tc(?:\s[^>]*)?>.*?<\/w:tc>/gs)]
            .map((cellMatch) => docxPlainText(capture(cellMatch, 0)).replace(/\s+/g, " ").trim());
          return `| ${cells.join(" | ")} |`;
        })
        .filter(Boolean);
      if (rows.length > 0) blocks.push(`[表格]\n${rows.join("\n")}`);
      continue;
    }
    const paragraph = docxParagraph(block, styles, rels);
    const formatted = formatDocxParagraph(paragraph);
    if (formatted.trim()) blocks.push(formatted);
  }
  return blocks.join("\n");
}

interface WorkbookSheet {
  name: string;
  path: string;
}

function workbookSharedStrings(files: Record<string, Uint8Array>): string[] {
  const shared = files["xl/sharedStrings.xml"];
  if (!shared) return [];
  return [...strFromU8(shared).matchAll(/<si(?:\s[^>]*)?>(.*?)<\/si>/gs)].map((match) =>
    [...capture(match).matchAll(/<t(?:\s[^>]*)?>(.*?)<\/t>/gs)]
      .map((textMatch) => decodeXmlText(capture(textMatch)))
      .join(""),
  );
}

function workbookSheets(files: Record<string, Uint8Array>): WorkbookSheet[] {
  const workbook = files["xl/workbook.xml"];
  const rels = files["xl/_rels/workbook.xml.rels"];
  if (!workbook) return [];
  const relMap = new Map<string, string>();
  if (rels) {
    for (const match of strFromU8(rels).matchAll(/<Relationship\s+[^>]*>/g)) {
      const tag = capture(match, 0);
      const id = /\bId="([^"]+)"/.exec(tag)?.[1];
      const target = /\bTarget="([^"]+)"/.exec(tag)?.[1];
      if (id && target) relMap.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target}`);
    }
  }
  return [...strFromU8(workbook).matchAll(/<sheet\s+[^>]*>/g)].map((match, index) => {
    const tag = capture(match, 0);
    const name = decodeXmlText(/\bname="([^"]+)"/.exec(tag)?.[1] ?? `Sheet${index + 1}`);
    const relId = /\br:id="([^"]+)"/.exec(tag)?.[1];
    return { name, path: (relId ? relMap.get(relId) : undefined) ?? `xl/worksheets/sheet${index + 1}.xml` };
  });
}

function columnIndex(reference: string | undefined, fallback: number): number {
  const letters = /\b([A-Z]+)\d+\b/.exec(reference ?? "")?.[1];
  if (!letters) return fallback;
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

function worksheetRows(xml: string, sharedStrings: string[]): string[] {
  return [...xml.matchAll(/<row(?:\s[^>]*)?>(.*?)<\/row>/gs)].map((rowMatch) => {
    const values: string[] = [];
    const cells = [...capture(rowMatch).matchAll(/<c(?:\s[^>]*)?>(.*?)<\/c>/gs)];
    cells.forEach((cellMatch, cellIndex) => {
      const cellXml = cellMatch[0];
      const reference = /\br="([^"]+)"/.exec(cellXml)?.[1];
      const type = /\bt="([^"']+)"/.exec(cellXml)?.[1];
      const inline = [...cellXml.matchAll(/<t(?:\s[^>]*)?>(.*?)<\/t>/gs)]
        .map((textMatch) => decodeXmlText(capture(textMatch)))
        .join("");
      const raw = /<v(?:\s[^>]*)?>(.*?)<\/v>/s.exec(cellXml)?.[1] ?? inline;
      const value = decodeXmlText(raw);
      const column = columnIndex(reference, cellIndex);
      values[column] = type === "s" ? (sharedStrings[Number(value)] ?? "") : value;
    });
    // 补齐空列，保留表格列位。
    for (let i = 0; i < values.length; i += 1) if (values[i] === undefined) values[i] = "";
    return values.join("\t");
  });
}

function xlsxText(bytes: Uint8Array): string {
  const files = unzipSync(bytes);
  const sharedStrings = workbookSharedStrings(files);
  const sheets = workbookSheets(files);
  const fallbackSheets = Object.keys(files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((filePath, index) => ({ name: `Sheet${index + 1}`, path: filePath }));
  const targets = sheets.length > 0 ? sheets : fallbackSheets;
  if (targets.length === 0) throw new Error("XLSX 缺少工作表。");
  return targets.map((sheet) => {
    const worksheet = files[sheet.path];
    if (!worksheet) throw new Error(`XLSX 缺少工作表内容: ${sheet.path}`);
    const rows = worksheetRows(strFromU8(worksheet), sharedStrings);
    return `## 工作表：${sheet.name}\n${rows.join("\n")}`;
  }).join("\n\n");
}

function docxArchive(content: string): Uint8Array {
  const paragraphs = content.split(/\r?\n/).map((line) => {
    const headingMatch = /^(#{1,3})\s+(.*)$/.exec(line);
    if (headingMatch) {
      const level = headingMatch[1]!.length;
      const text = headingMatch[2]!;
      return `<w:p><w:pPr><w:pStyle w:val="Heading${level}"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const text = bullet ? `• ${bullet[1]}` : line;
    return `<w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
  }).join("");
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
    [1, 2, 3].map((level) =>
      `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:outlineLvl w:val="${level - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${32 - level * 4}"/></w:rPr></w:style>`,
    ).join("") + `</w:styles>`;
  return zipSync({
    "[Content_Types].xml": strToU8("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/><Override PartName=\"/word/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml\"/></Types>"),
    "_rels/.rels": strToU8("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/></Relationships>"),
    "word/document.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr/></w:body></w:document>`),
    "word/styles.xml": strToU8(stylesXml),
    "word/_rels/document.xml.rels": strToU8("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rIdStyles\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/></Relationships>"),
  });
}

function columnName(index: number): string {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

interface XlsxSheetInput {
  name: string;
  rows: unknown[][];
}

function normalizedSheets(rows: unknown[][], sheets: unknown): XlsxSheetInput[] {
  if (Array.isArray(sheets) && sheets.length > 0) {
    return sheets.map((sheet, index) => {
      const item = (sheet ?? {}) as { name?: unknown; rows?: unknown };
      const name = String(item.name ?? `Sheet${index + 1}`).replace(/[\[\]:*?/\\]/g, "_").slice(0, 31) || `Sheet${index + 1}`;
      const sheetRows = Array.isArray(item.rows) ? item.rows : [];
      if (!sheetRows.every((row) => Array.isArray(row))) throw new Error("XLSX 每个 sheet 的 rows 必须是二维数组。");
      return { name, rows: sheetRows as unknown[][] };
    }).slice(0, 20);
  }
  return [{ name: "Sheet1", rows }];
}

function sheetXml(rows: unknown[][]): string {
  const rowXml = rows.slice(0, 10000).map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => {
      const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
      const text = String(value ?? "");
      const numeric = text.trim() !== "" && Number.isFinite(Number(text));
      return numeric
        ? `<c r="${reference}"><v>${escapeXml(text)}</v></c>`
        : `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowXml}</sheetData></worksheet>`;
}

function xlsxArchive(rows: unknown[][], sheets?: unknown): Uint8Array {
  const targets = normalizedSheets(rows, sheets);
  const used = new Set<string>();
  for (const sheet of targets) {
    const base = sheet.name;
    let name = base;
    let suffix = 2;
    while (used.has(name)) {
      name = `${base.slice(0, 27)}_${suffix}`;
      suffix += 1;
    }
    sheet.name = name;
    used.add(name);
  }
  const sheetEntries = targets.map((sheet, index) => [
    `xl/worksheets/sheet${index + 1}.xml`,
    strToU8(sheetXml(sheet.rows)),
  ] as const);
  const overrides = targets.map((_sheet, index) =>
    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join("");
  const workbookSheetsXml = targets.map((sheet, index) =>
    `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
  ).join("");
  const workbookRels = targets.map((_sheet, index) =>
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
  ).join("");
  return zipSync({
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides}</Types>`),
    "_rels/.rels": strToU8("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>"),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheetsXml}</sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${workbookRels}</Relationships>`),
    ...Object.fromEntries(sheetEntries),
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
        content: { type: "string", description: "DOCX 或文本文件内容；XLSX 可省略并使用 rows/sheets" },
        rows: { type: "array", description: "XLSX 单工作表二维单元格数组（未提供 sheets 时写入 Sheet1）" },
        sheets: {
          type: "array",
          description: "XLSX 多工作表：[{name, rows}]，最多 20 个；sheet 名会做 Excel 非法字符清理",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              rows: { type: "array" },
            },
            required: ["name", "rows"],
          },
        },
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
          bytes = xlsxArchive(rows as unknown[][], params.sheets);
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
