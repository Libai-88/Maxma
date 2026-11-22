/**
 * Cowork 持久化行类型。从 cowork-store.ts 拆出，避免单文件越过体量棘轮；
 * 对外仍由 cowork-store.ts 重导出，调用方无需改 import。
 */
import type {
  CoworkApprovalKind,
  CoworkApprovalStatus,
  CoworkRunStatus,
  CoworkStepStatus,
  CoworkTaskStatus,
} from "./cowork-status";

export interface CoworkTask {
  id: string;
  project_id: string | null;
  title: string;
  objective: string;
  status: CoworkTaskStatus;
  workspace_root: string;
  staging_root: string;
  permission_mode: string;
  model_policy_json: string;
  data_policy: string;
  inputs_json: string;
  session_id: string | null;
  schedule_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface CoworkRun {
  id: string;
  task_id: string;
  attempt: number;
  status: CoworkRunStatus;
  started_at: string;
  ended_at: string | null;
  error: string | null;
  checkpoint_json: string;
  usage_json: string;
}

export interface CoworkStep {
  id: string;
  run_id: string;
  seq: number;
  status: CoworkStepStatus;
  label: string;
  detail_json: string;
  started_at: string | null;
  ended_at: string | null;
}

export interface CoworkArtifact {
  id: string;
  task_id: string;
  run_id: string | null;
  kind: string;
  path: string;
  version: number;
  sha256: string;
  size_bytes: number;
  template_id: string | null;
  status: string;
  sources_json: string;
  created_at: string;
}

export interface CoworkApproval {
  id: string;
  task_id: string;
  run_id: string | null;
  kind: CoworkApprovalKind;
  payload_json: string;
  status: CoworkApprovalStatus;
  decision_reason: string | null;
  expires_at: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface CoworkEvent {
  id: number;
  task_id: string;
  run_id: string | null;
  type: string;
  payload_json: string;
  created_at: string;
}

export interface CoworkTaskDetail {
  task: CoworkTask;
  runs: CoworkRun[];
  steps: CoworkStep[];
  artifacts: CoworkArtifact[];
  approvals: CoworkApproval[];
  events: CoworkEvent[];
  latest_run: CoworkRun | null;
}

export interface CoworkProject {
  id: string;
  title: string;
  instructions: string;
  workspace_roots_json: string;
  default_template_ids_json: string;
  model_policy_json: string;
  data_policy: string;
  created_at: string;
  updated_at: string;
}

export interface CoworkProjectAsset {
  id: string;
  project_id: string;
  path: string;
  label: string;
  source: string;
  size_bytes: number;
  created_at: string;
}

export interface CoworkSchedule {
  id: string;
  task_id: string;
  cron: string;
  timezone: string;
  enabled: number;
  next_run_at: string | null;
  last_run_at: string | null;
  missed_policy: string;
  last_status: string | null;
  last_error: string | null;
  last_task_run_id: string | null;
  created_at: string;
  updated_at: string;
}
