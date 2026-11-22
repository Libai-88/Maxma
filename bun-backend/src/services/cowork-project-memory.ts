/**
 * 项目记忆：复用 MemoryStore 的 project 层文件，按 Cowork 项目 id 隔离。
 *
 * 任务完成摘要只有用户在验收弹层里确认后才会写入；这里不提供“自动总结写入”
 * 的后门，搜索也只读取当前项目的 key，避免跨项目串记忆。
 */

import * as path from "node:path";

import {
  addMemory,
  loadYamlDocument,
  projectFacts,
  projectsDir,
  safeMemoryKey,
  type MemoryFactRecord,
} from "./memory-store";

export function projectMemoryKey(projectId: string): string {
  const suffix = projectId.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 60);
  return safeMemoryKey(`cowork-${suffix}`, "project memory key");
}

export function projectMemoryFile(projectId: string): string {
  return path.join(projectsDir(), `${projectMemoryKey(projectId)}.yaml`);
}

export function listProjectMemories(projectId: string): MemoryFactRecord[] {
  const file = projectMemoryFile(projectId);
  const document = loadYamlDocument(file);
  if (!document) return [];
  return projectFacts(document, "project", projectMemoryKey(projectId));
}

export function searchProjectMemories(projectId: string, query: string, limit = 20): MemoryFactRecord[] {
  const facts = listProjectMemories(projectId);
  const needle = query.trim().toLowerCase();
  if (!needle) return facts.slice(0, limit);
  return facts
    .filter((fact) => fact.content.toLowerCase().includes(needle)
      || fact.category.toLowerCase().includes(needle))
    .slice(0, Math.max(1, Math.min(50, limit)));
}

export function addProjectMemory(projectId: string, content: string, category = "任务摘要"): MemoryFactRecord {
  return addMemory({
    scope: "project",
    key: projectMemoryKey(projectId),
    content,
    category,
  });
}
