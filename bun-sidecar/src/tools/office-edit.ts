/**
 * OOXML 选区编辑：只替换选中的文本单元，保留其余段落、版式和项目符号。
 *
 * 从 office.ts 拆出，避免 900 行单文件继续变胖；对外仍由
 * `editOfficeFileTool` 统一做路径/大小/参数校验。
 */

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

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

function capture(match: RegExpMatchArray | RegExpExecArray, index = 1): string {
  return match[index] ?? "";
}

function docxPlainText(fragment: string): string {
  return [...fragment.matchAll(/<w:t(?:\s[^>]*)?>(.*?)<\/w:t>/gs)]
    .map((textMatch) => decodeXmlText(capture(textMatch)))
    .join("");
}

/** 在一段 OOXML 文本里按字符偏移替换，保留首个受影响 run 的字符格式。 */
function replaceRunText(
  fragment: string,
  find: string,
  replacement: string,
  runPattern: RegExp,
  textPattern: RegExp,
  textTag: string,
): { xml: string; replaced: boolean } {
  const runs = [...fragment.matchAll(runPattern)];
  const texts = runs.map((run) => [...capture(run, 1).matchAll(textPattern)]
    .map((text) => decodeXmlText(capture(text)))
    .join(""));
  const joined = texts.join("");
  const start = joined.indexOf(find);
  if (start < 0 || joined.indexOf(find, start + 1) >= 0) return { xml: fragment, replaced: false };
  const end = start + find.length;
  let cursor = 0;
  let xml = fragment;
  let shift = 0;
  let first = true;
  for (let index = 0; index < runs.length; index += 1) {
    const text = texts[index] ?? "";
    const runStart = cursor;
    const runEnd = cursor + text.length;
    cursor = runEnd;
    if (runEnd <= start || runStart >= end) continue;
    const localStart = Math.max(start, runStart) - runStart;
    const localEnd = Math.min(end, runEnd) - runStart;
    const nextText = `${text.slice(0, localStart)}${first ? replacement : ""}${text.slice(localEnd)}`;
    first = false;
    const runXml = capture(runs[index]!, 0);
    const body = capture(runs[index]!, 1);
    const withoutText = body.replace(textPattern, "");
    const textXml = nextText.length > 0 ? `<${textTag} xml:space="preserve">${escapeXml(nextText)}</${textTag}>` : "";
    const nextRunXml = runXml.replace(body, `${withoutText}${textXml}`);
    const at = xml.indexOf(runXml, shift);
    if (at < 0) continue;
    xml = `${xml.slice(0, at)}${nextRunXml}${xml.slice(at + runXml.length)}`;
    shift = at + nextRunXml.length;
  }
  return { xml, replaced: !first };
}

export function editDocx(bytes: Uint8Array, find: string, replacement: string): Uint8Array {
  const files = unzipSync(bytes);
  const document = files["word/document.xml"];
  if (!document) throw new Error("DOCX 缺少 word/document.xml。");
  const xml = strFromU8(document);
  const paragraphs = [...xml.matchAll(/<w:p\b[^>]*>.*?<\/w:p>/gs)];
  let hit: RegExpMatchArray | null = null;
  let matches = 0;
  for (const paragraph of paragraphs) {
    const text = docxPlainText(capture(paragraph, 0));
    if (text.includes(find)) {
      matches += 1;
      hit = paragraph;
    }
  }
  if (matches === 0) throw new Error("没有找到选中的 DOCX 文本；请确认选区仍在当前版本中。");
  if (matches > 1) throw new Error(`选中文本在 DOCX 中出现 ${matches} 次，无法唯一定位；请扩大选区。`);
  const patched = replaceRunText(
    capture(hit!, 0),
    find,
    replacement,
    /<w:r\b[^>]*>(.*?)<\/w:r>/gs,
    /<w:t\b[^>]*>(.*?)<\/w:t>/gs,
    "w:t",
  );
  if (!patched.replaced) throw new Error("选中文本不在单个文本 run 内，无法安全替换。");
  const nextXml = `${xml.slice(0, hit!.index ?? 0)}${patched.xml}${xml.slice((hit!.index ?? 0) + capture(hit!, 0).length)}`;
  files["word/document.xml"] = strToU8(nextXml);
  return zipSync(files);
}

function slideTargets(files: Record<string, Uint8Array>): string[] {
  const rels = files["ppt/_rels/presentation.xml.rels"];
  const presentation = files["ppt/presentation.xml"];
  if (!presentation) throw new Error("PPTX 缺少 ppt/presentation.xml。");
  const relMap = new Map<string, string>();
  if (rels) {
    for (const match of strFromU8(rels).matchAll(/<Relationship\s+[^>]*>/g)) {
      const id = /\bId="([^"]+)"/.exec(match[0])?.[1];
      const target = /\bTarget="([^"]+)"/.exec(match[0])?.[1];
      if (id && target) relMap.set(id, target.startsWith("/") ? target.slice(1) : `ppt/${target.replace(/^\.\//, "")}`);
    }
  }
  const ordered = [...strFromU8(presentation).matchAll(/<p:sldId\s+[^>]*r:id="([^"]+)"[^>]*>/g)]
    .map((match) => relMap.get(capture(match)))
    .filter((value): value is string => Boolean(value));
  return ordered.length > 0
    ? ordered
    : Object.keys(files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export function editPptx(bytes: Uint8Array, find: string, replacement: string, slide?: number): Uint8Array {
  const files = unzipSync(bytes);
  const targets = slideTargets(files);
  if (targets.length === 0) throw new Error("PPTX 缺少幻灯片。");
  if (slide !== undefined && (slide < 1 || slide > targets.length)) throw new Error(`slide 超出范围：1–${targets.length}。`);
  const selected = slide === undefined ? targets : [targets[slide - 1]!];
  let hit: { target: string; shape: string; before: string } | null = null;
  let matches = 0;
  for (const target of selected) {
    const slideXml = files[target];
    if (!slideXml) continue;
    const xml = strFromU8(slideXml);
    for (const shape of xml.matchAll(/<p:sp\b[^>]*>.*?<\/p:sp>/gs)) {
      for (const paragraph of capture(shape, 0).matchAll(/<a:p\b[^>]*>.*?<\/a:p>/gs)) {
        const text = [...capture(paragraph, 0).matchAll(/<a:t\b[^>]*>(.*?)<\/a:t>/gs)]
          .map((entry) => decodeXmlText(capture(entry)))
          .join("");
        if (text.includes(find)) {
          matches += 1;
          hit = { target, shape: capture(shape, 0), before: xml };
        }
      }
    }
  }
  if (matches === 0) throw new Error("没有找到选中的 PPTX 文本；请确认页码和选区属于当前版本。");
  if (matches > 1) throw new Error(`选中文本在 PPTX 中出现 ${matches} 次，无法唯一定位；请带上页码或扩大选区。`);
  let shapeXml = hit!.shape;
  let replaced = false;
  for (const paragraph of shapeXml.matchAll(/<a:p\b[^>]*>.*?<\/a:p>/gs)) {
    const paragraphXml = capture(paragraph, 0);
    const patched = replaceRunText(
      paragraphXml,
      find,
      replacement,
      /<a:r\b[^>]*>(.*?)<\/a:r>/gs,
      /<a:t\b[^>]*>(.*?)<\/a:t>/gs,
      "a:t",
    );
    if (patched.replaced) {
      shapeXml = shapeXml.replace(paragraphXml, patched.xml);
      replaced = true;
      break;
    }
  }
  if (!replaced) throw new Error("选中文本不在单个 PPTX 文本 run 内，无法安全替换。");
  const nextSlide = hit!.before.replace(hit!.shape, shapeXml);
  files[hit!.target] = strToU8(nextSlide);
  return zipSync(files);
}
