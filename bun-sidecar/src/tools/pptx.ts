/**
 * PPTX 原生生成 / 读取。
 *
 * 生成交给 PptxGenJS（MIT）：它输出的是 PowerPoint 原生文本框与形状，
 * 产物能选中、改字、换版式；不是把幻灯片截成图片。读取走本文件的
 * OOXML 解析，用于 Agent 修改前核对真实内容。
 */

import PptxGenJS from "pptxgenjs";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

const MAX_SLIDES = 80;
const MAX_BULLETS = 10;
const MAX_BULLET_CHARS = 600;
const FONT = "Microsoft YaHei";

export interface PptxSlide {
  title: string;
  subtitle?: string;
  bullets?: string[];
  notes?: string;
}

export interface PptxDeck {
  title: string;
  subtitle?: string;
  slides: PptxSlide[];
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function normalizeSlide(slide: PptxSlide): PptxSlide {
  const bullets = (slide.bullets ?? [])
    .map((line) => clip(String(line ?? "").trim(), MAX_BULLET_CHARS))
    .filter(Boolean)
    .slice(0, MAX_BULLETS);
  return {
    title: clip(String(slide.title ?? "").trim(), 220) || "未命名幻灯片",
    subtitle: slide.subtitle ? clip(String(slide.subtitle).trim(), 260) : undefined,
    bullets,
    notes: slide.notes ? clip(String(slide.notes).trim(), 1000) : undefined,
  };
}

function bodyFontSize(bullets: string[]): number {
  const chars = bullets.reduce((sum, line) => sum + line.length, 0);
  if (chars <= 120) return 20;
  if (chars <= 260) return 18;
  if (chars <= 420) return 16;
  return 14;
}

/** 生成原生、可编辑的 16:9 PPTX；第一张按封面处理，其余按标题+正文处理。 */
export async function pptxGenerate(deck: PptxDeck): Promise<Uint8Array> {
  const slides = deck.slides.map(normalizeSlide).slice(0, MAX_SLIDES);
  if (slides.length === 0) throw new Error("PPTX 至少需要一张幻灯片。");
  const cover = slides[0]!;
  const content = slides.slice(1);
  const deckTitle = clip(String(deck.title ?? "").trim(), 220) || cover.title;
  const subtitle = deck.subtitle ?? cover.subtitle;

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Maxma";
  pptx.company = "Maxma";
  pptx.title = deckTitle;
  pptx.subject = subtitle ?? "";

  const coverSlide = pptx.addSlide();
  coverSlide.background = { color: "1F2937" };
  coverSlide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 7.38,
    w: 13.333,
    h: 0.12,
    fill: { color: "0F766E" },
    line: { color: "0F766E", width: 0 },
  });
  coverSlide.addText("MAXMA · COWORK", {
    x: 0.9,
    y: 1.55,
    w: 5.0,
    h: 0.3,
    objectName: "Eyebrow",
    fontFace: FONT,
    fontSize: 12,
    bold: true,
    color: "5EEAD4",
    charSpacing: 2,
    margin: 0,
  });
  coverSlide.addText(deckTitle, {
    x: 0.9,
    y: 2.0,
    w: 11.5,
    h: 1.6,
    fontFace: FONT,
    fontSize: 40,
    bold: true,
    color: "FFFFFF",
    valign: "bottom",
    margin: 0,
    fit: "shrink",
  });
  if (subtitle) {
    coverSlide.addText(subtitle, {
      x: 0.9,
      y: 3.8,
      w: 11.5,
      h: 1.0,
      fontFace: FONT,
      fontSize: 18,
      color: "CBD5E1",
      valign: "top",
      margin: 0,
      fit: "shrink",
    });
  }
  if (cover.notes) coverSlide.addNotes(cover.notes);

  content.forEach((slide, index) => {
    const page = index + 2;
    const bodySlide = pptx.addSlide();
    bodySlide.background = { color: "FFFFFF" };
    bodySlide.addShape(pptx.ShapeType.rect, {
      x: 0,
      y: 0,
      w: 13.333,
      h: 0.08,
      fill: { color: "0F766E" },
      line: { color: "0F766E", width: 0 },
    });
    bodySlide.addText(slide.title, {
      x: 0.9,
      y: 0.5,
      w: 11.5,
      h: 0.9,
      fontFace: FONT,
      fontSize: 28,
      bold: true,
      color: "0F172A",
      valign: "bottom",
      margin: 0,
      fit: "shrink",
    });
    if (slide.bullets && slide.bullets.length > 0) {
      bodySlide.addText(slide.bullets.map((line) => ({
        text: line,
        options: {
          bullet: true,
          fontFace: FONT,
          fontSize: bodyFontSize(slide.bullets!),
          color: "334155",
          breakLine: true,
          paraSpaceAfter: 10,
        },
      })), {
        x: 0.9,
        y: 1.6,
        w: 11.5,
        h: 4.9,
        valign: "top",
        margin: 0,
        fit: "shrink",
      });
    }
    bodySlide.addText(String(page), {
      x: 11.9,
      y: 6.9,
      w: 0.9,
      h: 0.25,
      objectName: "Page number",
      fontFace: FONT,
      fontSize: 10,
      color: "64748B",
      align: "right",
      margin: 0,
    });
    if (slide.notes) bodySlide.addNotes(slide.notes);
  });

  const data = await pptx.write({ outputType: "nodebuffer" }) as Buffer;
  return sanitizePptxPackage(new Uint8Array(data));
}

/**
 * PptxGenJS 4.0.1 会在 [Content_Types].xml 中登记 slideMaster2，
 * 但生成的包里并没有这个部件；PowerPoint 能容忍，浏览器预览库会
 * 在读取母版时中断，导致一张幻灯片都加载不到。写入前移除悬空登记，
 * 让包内声明与实际部件一致。
 */
function sanitizePptxPackage(bytes: Uint8Array): Uint8Array {
  const files = unzipSync(bytes);
  const contentTypes = files["[Content_Types].xml"];
  if (!contentTypes) return bytes;
  const source = strFromU8(contentTypes);
  const cleaned = source.replace(/<Override\b[^>]*?\/>/g, (tag) => {
    const part = /\bPartName="([^"]+)"/.exec(tag)?.[1];
    if (!part) return tag;
    return files[part.replace(/^\//, "")] ? tag : "";
  });
  if (cleaned === source) return bytes;
  files["[Content_Types].xml"] = strToU8(cleaned);
  return zipSync(files);
}

/** 按演示文稿顺序读回每页纯文本；供 Agent 修改前核对，不还原版式。 */
export function pptxText(bytes: Uint8Array): string {
  const files = unzipSync(bytes);
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
  const orderedTargets = [...strFromU8(presentation).matchAll(/<p:sldId\s+[^>]*r:id="([^"]+)"[^>]*>/g)]
    .map((match) => relMap.get(match[1] ?? ""))
    .filter((value): value is string => Boolean(value));
  const fallbackTargets = Object.keys(files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const targets = orderedTargets.length > 0 ? orderedTargets : fallbackTargets;
  if (targets.length === 0) throw new Error("PPTX 缺少幻灯片。");

  return targets.map((target, index) => {
    const slide = files[target];
    if (!slide) throw new Error(`PPTX 缺少幻灯片内容: ${target}`);
    const xml = strFromU8(slide);
    const shapeTexts = [...xml.matchAll(/<p:sp(?:\s[^>]*)?>(.*?)<\/p:sp>/gs)]
      .filter((match) => !/<p:cNvPr\s+[^>]*name="(?:Page number|Eyebrow)"/.test(match[1] ?? ""))
      .flatMap((match) => [...(match[1] ?? "").matchAll(/<a:p(?:\s[^>]*)?>(.*?)<\/a:p>/gs)]
        .map((para) => [...(para[1] ?? "").matchAll(/<a:t(?:\s[^>]*)?>(.*?)<\/a:t>/gs)]
          .map((textMatch) => decodeXmlText(textMatch[1] ?? ""))
          .join("")
          .trim())
        .filter(Boolean));
    return `## 幻灯片 ${index + 1}\n${shapeTexts.join("\n")}`;
  }).join("\n\n");
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
