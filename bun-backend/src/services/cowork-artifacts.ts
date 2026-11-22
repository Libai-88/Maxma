/**
 * 从工具结束事件里识别可登记的任务产物。
 *
 * `write_office_file` / `edit_office_file` 在 details.path 回传绝对路径；
 * 内置 write/edit 只在入参里带 path。这里统一做路径边界与扩展名归类，
 * 运行器只负责写事件和登记产物。
 */

import * as fs from "node:fs";
import * as path from "node:path";

import type { CoworkArtifact } from "./cowork-store";
import { asRecord, isInside, str } from "./cowork-utils";

const ARTIFACT_TOOLS = new Set(["write", "write_office_file", "edit_office_file", "edit"]);

export type CoworkArtifactCandidate = Pick<CoworkArtifact, "path" | "kind">;

function kindOf(filePath: string): CoworkArtifact["kind"] {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".docx") return "docx";
  if (ext === ".xlsx") return "xlsx";
  if (ext === ".pdf") return "pdf";
  if (ext === ".pptx") return "pptx";
  if (ext === ".csv") return "csv";
  return "markdown";
}

export function artifactFromToolResult(
  toolName: string,
  output: unknown,
  input: string,
  stagingRoot: string,
): CoworkArtifactCandidate | null {
  if (!ARTIFACT_TOOLS.has(toolName)) return null;
  try {
    const parsed = JSON.parse(str(output, "{}")) as Record<string, unknown>;
    const details = asRecord(parsed.details);
    const inputRecord = input ? asRecord(JSON.parse(input) as unknown) : {};
    const artifactPath = str(details.path) || str(inputRecord.path);
    const ok = details.ok !== false;
    if (!ok || !artifactPath || !fs.existsSync(artifactPath) || !isInside(stagingRoot, artifactPath)) {
      return null;
    }
    return { path: artifactPath, kind: kindOf(artifactPath) };
  } catch {
    return null;
  }
}
