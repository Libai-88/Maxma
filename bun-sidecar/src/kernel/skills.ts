import * as path from "node:path";
import * as os from "node:os";
import { getAgentDir, loadSkills } from "@earendil-works/pi-coding-agent";

export interface DiscoveredSkill {
  name: string;
  description: string;
  source: string;
  file_path: string;
  base_dir: string;
  disable_model_invocation: boolean;
}

export interface SkillDiscoveryResult {
  skills: DiscoveredSkill[];
  diagnostics: unknown[];
}

export function maxmaSkillPaths(cwd: string): string[] {
  return [
    path.join(cwd, ".agents", "skills"),
    path.join(os.homedir(), ".agents", "skills"),
  ];
}

/** Discover Pi defaults and Agent Skills directories used by Maxma projects. */
export function discoverMaxmaSkills(cwd?: string): SkillDiscoveryResult {
  const root = path.resolve(cwd ?? process.env.MAXMA_DATA_DIR ?? process.env.MAXMA_PROJECT_ROOT ?? path.join(import.meta.dir, "../../.."));
  const result = loadSkills({ cwd: root, agentDir: getAgentDir(), skillPaths: maxmaSkillPaths(root), includeDefaults: true });
  return {
    skills: result.skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      source: skill.sourceInfo?.source ?? skill.sourceInfo?.kind ?? "unknown",
      file_path: skill.filePath,
      base_dir: skill.baseDir,
      disable_model_invocation: skill.disableModelInvocation,
    })),
    diagnostics: result.diagnostics,
  };
}
