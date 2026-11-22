/**
 * docintel/extract.ts — 把办公文档拆成带来源坐标的文本块。
 *
 * 只做“可检索的纯文本 + 来源坐标”，不做版式还原。v1 明确不做 OCR：
 * 扫描 PDF 没有文本层时返回 unsupported，不伪造内容。PDF 解析器（unpdf）
 * 动态加载：普通聊天/任务不打开 PDF 时不付加载成本。
 */

import * as path from "node:path";
import { strFromU8, unzipSync } from "fflate";

import type { DocLocator, DocSourceBlock } from "./store";

export const SUPPORTED_DOC_EXTENSIONS = new Set([
  ".pdf",
  ".docx",
  ".xlsx",
  ".md",
  ".markdown",
  ".txt",
  ".html",
  ".htm",
]);

const CHUNK_CHARS = 1200;
const PDF_MAX_PAGES = 2000;

export interface ExtractResult {
  format: string;
  blocks: DocSourceBlock[];
  /** 文件级提示；blocks 为空且 unsupported=true 时表示“未识别”，不是空文档。 */
  warning?: string;
  unsupported?: boolean;
}

export function docFormatOf(filePath: string): string {
  return path.extname(filePath).toLowerCase().replace(/^\./, "");
}

export function isSupportedDoc(filePath: string): boolean {
  return SUPPORTED_DOC_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export async function extractDocument(absolutePath: string, bytes: Uint8Array): Promise<ExtractResult> {
  const extension = path.extname(absolutePath).toLowerCase();
  if (extension === ".pdf") return extractPdf(bytes);
  if (extension === ".docx") return extractDocx(bytes);
  if (extension === ".xlsx") return extractXlsx(bytes);
  if (extension === ".html" || extension === ".htm") return extractTextBytes(bytes, "html");
  if (extension === ".md" || extension === ".markdown") return extractTextBytes(bytes, "md");
  if (extension === ".txt") return extractTextBytes(bytes, "txt");
  return {
    format: docFormatOf(absolutePath) || "unknown",
    blocks: [],
    unsupported: true,
    warning: `不支持的文档格式：${extension || "(无扩展名)"}`,
  };
}

function textChunks(text: string, maxChars = CHUNK_CHARS, overlap = 150): string[] {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(normalized.length, start + maxChars);
    if (end < normalized.length) {
      const boundary = Math.max(
        normalized.lastIndexOf("\n", end),
        normalized.lastIndexOf("。", end),
        normalized.lastIndexOf("！", end),
        normalized.lastIndexOf("？", end),
        normalized.lastIndexOf("；", end),
        normalized.lastIndexOf(" ", end),
      );
      if (boundary > start + maxChars * 0.55) end = boundary + 1;
    }
    const chunk = normalized.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= normalized.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks;
}

function extractTextBytes(bytes: Uint8Array, format: "txt" | "md" | "html"): ExtractResult {
  const raw = new Uint8Array(bytes);
  if (raw.includes(0)) {
    return { format, blocks: [], unsupported: true, warning: "文件含二进制内容，不是可读文本" };
  }
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(raw);
  const text = format === "html" ? htmlToText(decoded) : decoded;
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: DocSourceBlock[] = [];
  let start = 1;
  let buffer: string[] = [];
  let bufferChars = 0;

  const flush = () => {
    while (buffer.length > 0 && !buffer[buffer.length - 1]!.trim()) buffer.pop();
    if (buffer.length === 0) {
      bufferChars = 0;
      return;
    }
    const chunk = buffer.join("\n").trim();
    if (chunk) {
      const end = start + buffer.length - 1;
      blocks.push({
        text: `${labelForLines(start, end, format)}\n${chunk}`,
        locator: { lines: [start, end] },
        locatorLabel: labelForLines(start, end, format),
      });
    }
    buffer = [];
    bufferChars = 0;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const lineNumber = index + 1;
    if (buffer.every((item) => !item.trim()) && line.trim()) start = lineNumber;
    const pieces = line.length > CHUNK_CHARS ? textChunks(line) : [line];
    for (let part = 0; part < pieces.length; part += 1) {
      const piece = pieces[part] ?? "";
      if (bufferChars + piece.length > CHUNK_CHARS && buffer.length > 0) flush();
      if (buffer.length === 0) start = lineNumber;
      buffer.push(piece);
      bufferChars += piece.length + 1;
      if (pieces.length > 1 && part < pieces.length - 1) {
        const label = `${labelForLines(lineNumber, lineNumber, format)}·第${part + 1}段`;
        blocks.push({
          text: `${label}\n${piece}`,
          locator: { lines: [lineNumber, lineNumber], part },
          locatorLabel: label,
        });
        buffer = [];
        bufferChars = 0;
      }
    }
    if (bufferChars >= CHUNK_CHARS) flush();
  }
  flush();
  if (blocks.length === 0) {
    return { format, blocks: [], unsupported: true, warning: "文档没有可索引的文本" };
  }
  return { format, blocks };
}

function labelForLines(start: number, end: number, format: string): string {
  const unit = format === "html" ? "文本行" : format === "md" ? "Markdown 行" : "行";
  return start === end ? `第 ${start} ${unit}` : `第 ${start}-${end} ${unit}`;
}

function htmlToText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<\/h[1-6]>/gi, "\n")
      .replace(/<\/tr>/gi, "\n")
      .replace(/<\/td>/gi, "\t")
      .replace(/<\/th>/gi, "\t")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    ensp: " ",
    emsp: " ",
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (full, entity: string) => {
    if (entity.startsWith("#")) {
      const hex = entity[1]?.toLowerCase() === "x";
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : full;
    }
    return named[entity.toLowerCase()] ?? full;
  });
}

function decodeXml(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, ""));
}

function extractDocx(bytes: Uint8Array): ExtractResult {
  const files = unzipSync(bytes);
  const documentXml = files["word/document.xml"];
  if (!documentXml) {
    return { format: "docx", blocks: [], unsupported: true, warning: "DOCX 缺少 word/document.xml" };
  }
  const xml = strFromU8(documentXml);
  const paragraphs: Array<{ index: number; text: string }> = [];
  const paragraphMatches = [...xml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)];
  paragraphMatches.forEach((match, index) => {
    const body = match[1] ?? "";
    const text = docxParagraphText(body).replace(/\u00a0/g, " ").replace(/[ \t]{2,}/g, " ").trim();
    paragraphs.push({ index: index + 1, text });
  });

  const blocks: DocSourceBlock[] = [];
  for (const paragraph of paragraphs) {
    if (!paragraph.text) continue;
    const pieces = paragraph.text.length > CHUNK_CHARS ? textChunks(paragraph.text) : [paragraph.text];
    pieces.forEach((piece, part) => {
      const label = pieces.length > 1 ? `第 ${paragraph.index} 段·第 ${part + 1} 块` : `第 ${paragraph.index} 段`;
      blocks.push({
        text: `${label}\n${piece}`,
        locator: { paragraphs: [paragraph.index, paragraph.index], ...(pieces.length > 1 ? { part } : {}) },
        locatorLabel: label,
      });
    });
  }

  if (blocks.length === 0) {
    return { format: "docx", blocks: [], unsupported: true, warning: "DOCX 没有可索引的正文段落" };
  }
  return { format: "docx", blocks };
}

function docxParagraphText(body: string): string {
  let text = "";
  const tokens = [...body.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>|<w:cr\s*\/>/g)];
  for (const token of tokens) {
    if (token[0].startsWith("<w:t")) text += decodeXml(token[1] ?? "");
    else if (token[0].startsWith("<w:tab")) text += "\t";
    else text += "\n";
  }
  return text;
}

interface SheetInfo {
  name: string;
  path: string;
}

interface SheetRow {
  number: number;
  cells: Array<{ reference: string; value: string }>;
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

function extractXlsx(bytes: Uint8Array): ExtractResult {
  const files = unzipSync(bytes);
  const workbook = files["xl/workbook.xml"];
  if (!workbook) {
    return { format: "xlsx", blocks: [], unsupported: true, warning: "XLSX 缺少 xl/workbook.xml" };
  }
  const sharedStrings = workbookSharedStrings(files);
  const sheets = xlsxSheets(files, workbook);
  const blocks: DocSourceBlock[] = [];

  for (const sheet of sheets) {
    const worksheet = files[sheet.path];
    if (!worksheet) continue;
    const rows = xlsxRows(strFromU8(worksheet), sharedStrings);
    if (rows.length === 0) continue;
    let buffer: SheetRow[] = [];
    let bufferChars = 0;
    const flush = () => {
      if (buffer.length === 0) return;
      const start = buffer[0]?.number ?? 0;
      const end = buffer[buffer.length - 1]?.number ?? start;
      const firstRef = buffer[0]?.cells[0]?.reference ?? `A${start}`;
      const lastRow = buffer[buffer.length - 1];
      const lastCell = lastRow?.cells[lastRow.cells.length - 1];
      const lastRef = lastCell?.reference ?? `A${end}`;
      const range = `${firstRef}:${lastRef}`;
      const label = `工作表「${sheet.name}」第 ${start}-${end} 行`;
      const content = buffer.map((row) =>
        row.cells.map((cell) => `${cell.reference}: ${cell.value}`).join(" | "),
      );
      blocks.push({
        text: `${label} (${range})\n${content.join("\n")}`,
        locator: { sheet: sheet.name, rows: [start, end], cells: range },
        locatorLabel: label,
      });
      buffer = [];
      bufferChars = 0;
    };

    for (const row of rows) {
      const rowText = row.cells.map((cell) => `${cell.reference}: ${cell.value}`).join(" | ");
      if (bufferChars + rowText.length > CHUNK_CHARS && buffer.length > 0) flush();
      buffer.push(row);
      bufferChars += rowText.length + 1;
      if (bufferChars >= CHUNK_CHARS) flush();
    }
    flush();
  }

  if (blocks.length === 0) {
    return { format: "xlsx", blocks: [], unsupported: true, warning: "XLSX 没有可索引的单元格文本" };
  }
  return { format: "xlsx", blocks };
}

function workbookSharedStrings(files: Record<string, Uint8Array>): string[] {
  const xml = files["xl/sharedStrings.xml"];
  if (!xml) return [];
  const text = strFromU8(xml);
  return [...text.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map((match) => {
    const body = match[1] ?? "";
    return [...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
      .map((item) => decodeXml(item[1] ?? ""))
      .join("");
  });
}

function xlsxSheets(files: Record<string, Uint8Array>, workbook: Uint8Array): SheetInfo[] {
  const workbookXml = strFromU8(workbook);
  const rels = files["xl/_rels/workbook.xml.rels"];
  const relMap = new Map<string, string>();
  if (rels) {
    for (const match of strFromU8(rels).matchAll(/<Relationship\s+[^>]*>/g)) {
      const tag = match[0];
      const id = /\bId="([^"]+)"/.exec(tag)?.[1];
      const target = /\bTarget="([^"]+)"/.exec(tag)?.[1];
      if (id && target) relMap.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target}`);
    }
  }
  const declared = [...workbookXml.matchAll(/<sheet\s+[^>]*>/g)].map((match, index) => {
    const tag = match[0];
    const name = decodeXml(/\bname="([^"]+)"/.exec(tag)?.[1] ?? `Sheet${index + 1}`);
    const relId = /\br:id="([^"]+)"/.exec(tag)?.[1];
    return { name, path: (relId ? relMap.get(relId) : undefined) ?? `xl/worksheets/sheet${index + 1}.xml` };
  });
  if (declared.length > 0) return declared;
  return Object.keys(files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((filePath, index) => ({ name: `Sheet${index + 1}`, path: filePath }));
}

function xlsxRows(xml: string, sharedStrings: string[]): SheetRow[] {
  const rows: SheetRow[] = [];
  const rowMatches = [...xml.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)];
  rowMatches.forEach((rowMatch, rowIndex) => {
    const rowTag = /<row\s+[^>]*>/.exec(rowMatch[0])?.[0] ?? "";
    const number = Number.parseInt(/\br="(\d+)"/.exec(rowTag)?.[1] ?? `${rowIndex + 1}`, 10);
    const cells: Array<{ reference: string; value: string }> = [];
    const cellMatches = [...(rowMatch[1] ?? "").matchAll(/<c(?:\s[^>]*)?>([\s\S]*?)<\/c>/g)];
    cellMatches.forEach((cellMatch, cellIndex) => {
      const cellXml = cellMatch[0];
      const reference = /\br="([^"]+)"/.exec(cellXml)?.[1] ?? `${columnName(cellIndex)}${number}`;
      const type = /\bt="([^"']+)"/.exec(cellXml)?.[1];
      const inline = [...(cellMatch[1] ?? "").matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
        .map((item) => decodeXml(item[1] ?? ""))
        .join("");
      const raw = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(cellMatch[1] ?? "")?.[1] ?? inline;
      const value = decodeXml(raw);
      if (!value.trim()) return;
      cells.push({ reference, value: type === "s" ? (sharedStrings[Number(value)] ?? "") : value });
    });
    if (cells.length > 0) rows.push({ number, cells });
  });
  return rows;
}

async function extractPdf(bytes: Uint8Array): Promise<ExtractResult> {
  let getDocumentProxy: typeof import("unpdf").getDocumentProxy;
  let extractText: typeof import("unpdf").extractText;
  try {
    const unpdf = await import("unpdf");
    getDocumentProxy = unpdf.getDocumentProxy;
    extractText = unpdf.extractText;
  } catch (error) {
    return {
      format: "pdf",
      blocks: [],
      unsupported: true,
      warning: `PDF 解析器不可用：${error instanceof Error ? error.message : String(error)}`,
    };
  }
  try {
    const pdf = await getDocumentProxy(bytes);
    if (pdf.numPages > PDF_MAX_PAGES) {
      return {
        format: "pdf",
        blocks: [],
        unsupported: true,
        warning: `PDF 页数 ${pdf.numPages} 超过 ${PDF_MAX_PAGES} 页上限`,
      };
    }
    const extracted = await extractText(pdf, { mergePages: false });
    const pages = Array.isArray(extracted.text) ? extracted.text : [String(extracted.text ?? "")];
    const blocks: DocSourceBlock[] = [];
    const emptyPages: number[] = [];
    pages.forEach((pageText, index) => {
      const page = index + 1;
      const text = String(pageText ?? "").trim();
      if (!text) {
        emptyPages.push(page);
        return;
      }
      const chunks = textChunks(text);
      chunks.forEach((chunk, part) => {
        const label = chunks.length > 1 ? `第 ${page} 页·第 ${part + 1} 块` : `第 ${page} 页`;
        blocks.push({
          text: `${label}\n${chunk}`,
          locator: { page, ...(chunks.length > 1 ? { part } : {}) },
          locatorLabel: label,
        });
      });
    });
    if (blocks.length === 0) {
      return {
        format: "pdf",
        blocks: [],
        unsupported: true,
        warning: `扫描件未识别：${pages.length} 页均无文本层（v1 不做 OCR）`,
      };
    }
    return {
      format: "pdf",
      blocks,
      ...(emptyPages.length > 0
        ? { warning: `${emptyPages.length} 页无文本层（扫描页未识别）：${emptyPages.slice(0, 8).join(", ")}${emptyPages.length > 8 ? "…" : ""}` }
        : {}),
    };
  } catch (error) {
    return {
      format: "pdf",
      blocks: [],
      unsupported: true,
      warning: `PDF 解析失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
