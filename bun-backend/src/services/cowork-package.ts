/**
 * M4-D 交付包：把当前版本产物 + 来源清单 + README 打成一个 ZIP。
 *
 * 只读打包，不写工作区；包内路径使用产物 basename，重名时加前缀避免互相覆盖。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { strToU8, zipSync } from "fflate";

import { coworkArtifactSnapshotPath, type CoworkArtifact, type CoworkTask } from "./cowork-store";

interface SourceItem {
  kind: string;
  path: string;
  label?: string;
}

function parseInputs(task: CoworkTask): Record<string, unknown> {
  try {
    const parsed = JSON.parse(task.inputs_json) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function collectSources(task: CoworkTask): SourceItem[] {
  const inputs = parseInputs(task);
  const project = inputs.project && typeof inputs.project === "object" && !Array.isArray(inputs.project)
    ? (inputs.project as Record<string, unknown>)
    : {};
  const sources: SourceItem[] = [];
  if (Array.isArray(inputs.assets)) {
    for (const raw of inputs.assets.slice(0, 50)) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as Record<string, unknown>;
      if (typeof item.path === "string") sources.push({
        kind: "asset",
        path: item.path,
        label: typeof item.label === "string" ? item.label : undefined,
      });
    }
  }
  if (typeof project.id === "string") {
    sources.push({ kind: "project", path: project.id, label: typeof project.title === "string" ? project.title : undefined });
  }
  return sources;
}

function readme(task: CoworkTask, files: string[], sources: SourceItem[]): string {
  return [
    `# ${task.title}`,
    "",
    `任务目标：${task.objective}`,
    "",
    `生成时间：${new Date().toISOString()}`,
    `任务 ID：${task.id}`,
    `源工作区：${task.workspace_root}`,
    "",
    "## 交付物",
    ...files.map((file) => `- ${file}`),
    "",
    "## 来源",
    ...(sources.length ? sources.map((source) => `- ${source.label ?? source.path}（${source.kind}）：${source.path}`) : ["- 未记录外部来源"]),
    "",
    "## 说明",
    "- 产物由 Maxma Cowork 在任务 staging 内生成；此包是只读快照。",
    "- 需要回到原始任务时，请保留任务 ID 与源工作区路径。",
  ].join("\n");
}

export interface DeliveryPackage {
  filename: string;
  bytes: Uint8Array;
  files: string[];
}

export function buildDeliveryPackage(task: CoworkTask, artifacts: CoworkArtifact[]): DeliveryPackage {
  if (artifacts.length === 0) throw new Error("任务还没有交付物，无法打包");
  const entries: Record<string, Uint8Array> = {};
  const files: string[] = [];
  const used = new Set<string>();
  const latestByPath = new Map<string, CoworkArtifact>();
  for (const artifact of artifacts) {
    if (artifact.status === "deleted") continue;
    const current = latestByPath.get(artifact.path);
    if (!current || artifact.version > current.version) latestByPath.set(artifact.path, artifact);
  }
  let index = 1;
  for (const artifact of latestByPath.values()) {
    const snapshot = coworkArtifactSnapshotPath(task.id, artifact.id, artifact.path);
    const source = fs.existsSync(snapshot) ? snapshot : artifact.path;
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) continue;
    let name = path.basename(artifact.path);
    if (used.has(name)) name = `${index}-${name}`;
    index += 1;
    used.add(name);
    entries[`artifacts/${name}`] = new Uint8Array(fs.readFileSync(source));
    files.push(`artifacts/${name}`);
  }
  const sources = collectSources(task);
  entries["sources.json"] = strToU8(JSON.stringify({
    task_id: task.id,
    title: task.title,
    objective: task.objective,
    workspace_root: task.workspace_root,
    sources,
  }, null, 2));
  entries["README.md"] = strToU8(readme(task, files, sources));
  const safeTitle = task.title.replace(/[\\/:*?"<>|]+/g, "_").trim().slice(0, 40) || "cowork-delivery";
  return {
    filename: `${safeTitle}-交付包.zip`,
    bytes: zipSync(entries, { level: 6 }),
    files,
  };
}
