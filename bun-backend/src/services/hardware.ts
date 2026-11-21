/**
 * services/hardware.ts — 本机硬件探针与本地模型可运行性评估。
 *
 * 边界：
 * - 只读探测，不安装/不启动模型，不修改任何 provider 配置。
 * - GPU 显存在 Windows 上常被 WMI 报告为 0 或错误值；拿不到就明确标记 unknown，
 *   不把系统内存冒充显存。
 * - 模型体积按名称里的参数量 + 量化方式做保守估算，仅用于路由建议，不是精确 benchmark。
 */
import * as os from "node:os";

export interface GpuInfo {
  name: string;
  memoryBytes: number | null;
  source: string;
}

export interface HardwareInfo {
  platform: string;
  arch: string;
  cpuModel: string;
  cpuCores: number;
  memoryTotalBytes: number;
  memoryFreeBytes: number;
  gpus: GpuInfo[];
  probedAt: number;
  warnings: string[];
}

export type ModelFit = "good" | "ok" | "tight" | "too_large" | "cloud";

export interface ModelRouteCandidate {
  providerId: string;
  providerLabel: string;
  model: string;
  location: "local" | "cloud";
  fit: ModelFit;
  requiredMemoryGb: number | null;
  device: "gpu" | "cpu" | "remote";
  reason: string;
}

export interface HardwareProbeOptions {
  spawn?: typeof Bun.spawn;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "host.docker.internal"]);

export function isLocalProviderUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return LOCAL_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function parseJsonArray(text: string): Array<Record<string, unknown>> {
  const trimmed = text.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) return parsed.filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
    if (parsed && typeof parsed === "object") return [parsed as Record<string, unknown>];
  } catch {
    return [];
  }
  return [];
}

async function runProbe(command: string[], timeoutMs = 5000, spawn: typeof Bun.spawn = Bun.spawn): Promise<string> {
  const proc = spawn(command, { stdout: "pipe", stderr: "ignore", timeout: timeoutMs });
  const output = await new Response(proc.stdout).text().catch(() => "");
  const code = await proc.exited.catch(() => -1);
  return code === 0 ? output : "";
}

async function windowsGpus(spawn: typeof Bun.spawn): Promise<{ gpus: GpuInfo[]; warning?: string }> {
  const gpus: GpuInfo[] = [];
  const nvidia = await runProbe(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"], 5000, spawn);
  if (nvidia.trim()) {
    for (const line of nvidia.split(/\r?\n/).filter(Boolean)) {
      const [name, memoryMb] = line.split(",").map((part) => part.trim());
      const bytes = Number(memoryMb) * 1024 * 1024;
      gpus.push({ name: name ?? "NVIDIA GPU", memoryBytes: Number.isFinite(bytes) && bytes > 0 ? bytes : null, source: "nvidia-smi" });
    }
  }
  const script = "Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM | ConvertTo-Json -Compress";
  const output = await runProbe(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script], 8000, spawn);
  const rows = parseJsonArray(output);
  if (rows.length === 0 && gpus.length === 0) return { gpus: [], warning: "未能读取 Windows 显卡信息（WMI 无返回）" };
  for (const row of rows) {
    const name = String(row.Name ?? "未知显卡");
    // 虚拟显示适配器/远控驱动没有真实显存，不应参与模型路由。
    if (/virtual|remote|parsec|spacedesk|gameviewer|basic display/i.test(name)) continue;
    if (gpus.some((gpu) => gpu.name.toLowerCase() === name.toLowerCase() && gpu.memoryBytes !== null)) continue;
    const memory = Number(row.AdapterRAM ?? 0);
    gpus.push({
      name,
      memoryBytes: Number.isFinite(memory) && memory > 0 ? memory : null,
      source: "wmi",
    });
  }
  return {
    gpus,
    warning: gpus.some((gpu) => gpu.source === "wmi" && gpu.memoryBytes !== null && gpu.memoryBytes <= 4.1 * 1024 ** 3)
      ? "Windows WMI 的显存字段可能被 32 位整数截断（约 4GB），已优先使用 nvidia-smi；其余显卡数值仅供参考"
      : undefined,
  };
}

async function linuxGpus(spawn: typeof Bun.spawn): Promise<GpuInfo[]> {
  const nvidia = await runProbe(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"], 5000, spawn);
  if (nvidia.trim()) {
    return nvidia.split(/\r?\n/).filter(Boolean).map((line) => {
      const [name, memoryMb] = line.split(",").map((part) => part.trim());
      const bytes = Number(memoryMb) * 1024 * 1024;
      return { name: name ?? "NVIDIA GPU", memoryBytes: Number.isFinite(bytes) && bytes > 0 ? bytes : null, source: "nvidia-smi" };
    });
  }
  const lspci = await runProbe(["lspci"], 5000, spawn);
  return lspci.split(/\r?\n/).filter((line) => /vga|3d|display/i.test(line)).map((line) => ({
    name: line.replace(/^[0-9a-f:.]+\s+/i, "").trim(),
    memoryBytes: null,
    source: "lspci",
  }));
}

async function macGpus(spawn: typeof Bun.spawn): Promise<GpuInfo[]> {
  const output = await runProbe(["system_profiler", "SPDisplaysDataType", "-json"], 8000, spawn);
  if (!output.trim()) return [];
  try {
    const parsed = JSON.parse(output) as { SPDisplaysDataType?: Array<Record<string, unknown>> };
    return (parsed.SPDisplaysDataType ?? []).map((item) => ({
      name: String(item.sppci_model ?? item._name ?? "Apple GPU"),
      memoryBytes: typeof item.spdisplays_vram === "string" ? Number.parseInt(item.spdisplays_vram, 10) * 1024 * 1024 : null,
      source: "system_profiler",
    }));
  } catch {
    return [];
  }
}

export async function probeHardware(options: HardwareProbeOptions = {}): Promise<HardwareInfo> {
  const spawn = options.spawn ?? Bun.spawn;
  const platform = process.platform;
  const warnings: string[] = [];
  let gpus: GpuInfo[] = [];
  try {
    if (platform === "win32") {
      const result = await windowsGpus(spawn);
      gpus = result.gpus;
      if (result.warning) warnings.push(result.warning);
    } else if (platform === "darwin") {
      gpus = await macGpus(spawn);
    } else {
      gpus = await linuxGpus(spawn);
    }
  } catch (error) {
    warnings.push(`显卡探测失败：${error instanceof Error ? error.message : String(error)}`);
  }
  const cpus = os.cpus();
  return {
    platform,
    arch: process.arch,
    cpuModel: cpus[0]?.model?.trim() || "未知 CPU",
    cpuCores: cpus.length,
    memoryTotalBytes: os.totalmem(),
    memoryFreeBytes: os.freemem(),
    gpus,
    probedAt: Date.now(),
    warnings,
  };
}

/** 从模型名估算参数量（B）。 */
export function estimateParameterBillions(model: string): number | null {
  const cleaned = model.toLowerCase();
  const matches = [...cleaned.matchAll(/(?:^|[^a-z0-9])(\d+(?:\.\d+)?)\s*b(?![a-z0-9])/g)];
  const values = matches.map((match) => Number(match[1])).filter((value) => Number.isFinite(value) && value > 0.05 && value < 500);
  if (values.length === 0) return null;
  return Math.max(...values);
}

/** 按模型名里的量化线索估算内存需求（GB，含约 2GB 运行时/KV 余量）。 */
export function estimateModelMemoryGb(model: string, parametersB: number | null): number | null {
  if (parametersB === null) return null;
  const lower = model.toLowerCase();
  const bytesPerParameter = /q8|8bit|int8/.test(lower)
    ? 1.1
    : /fp16|f16|bf16/.test(lower)
      ? 2.2
      : 0.65; // 默认按 4-bit 量化估算
  return Math.round(parametersB * bytesPerParameter * 10) / 10 + 2;
}

export function assessModelFit(model: string, hardware: HardwareInfo, baseUrl: string): {
  location: "local" | "cloud";
  fit: ModelFit;
  requiredMemoryGb: number | null;
  device: "gpu" | "cpu" | "remote";
  reason: string;
} {
  const location = isLocalProviderUrl(baseUrl) ? "local" : "cloud";
  const requiredMemoryGb = estimateModelMemoryGb(model, estimateParameterBillions(model));
  if (location === "cloud") {
    return {
      location,
      fit: "cloud",
      requiredMemoryGb,
      device: "remote",
      reason: "云端模型，不受本机内存/显存限制",
    };
  }
  if (requiredMemoryGb === null) {
    return {
      location,
      fit: "ok",
      requiredMemoryGb,
      device: "cpu",
      reason: "模型名未包含参数量，无法估算；按 CPU 可加载处理",
    };
  }
  const gpuMemoryGb = hardware.gpus.reduce((max, gpu) => Math.max(max, (gpu.memoryBytes ?? 0) / 1024 ** 3), 0);
  const ramGb = hardware.memoryTotalBytes / 1024 ** 3;
  if (gpuMemoryGb > 0 && requiredMemoryGb <= gpuMemoryGb * 0.9) {
    return {
      location,
      fit: "good",
      requiredMemoryGb,
      device: "gpu",
      reason: `估算需 ${requiredMemoryGb.toFixed(1)}GB，可放入 ${gpuMemoryGb.toFixed(1)}GB 显存`,
    };
  }
  if (requiredMemoryGb <= ramGb * 0.75) {
    return {
      location,
      fit: gpuMemoryGb > 0 ? "tight" : "ok",
      requiredMemoryGb,
      device: "cpu",
      reason: gpuMemoryGb > 0
        ? `估算需 ${requiredMemoryGb.toFixed(1)}GB，超过显存 ${gpuMemoryGb.toFixed(1)}GB，退回 CPU 推理会明显变慢`
        : `估算需 ${requiredMemoryGb.toFixed(1)}GB，可由 ${ramGb.toFixed(1)}GB 系统内存承载（CPU 推理较慢）`,
    };
  }
  return {
    location,
    fit: "too_large",
    requiredMemoryGb,
    device: "cpu",
    reason: `估算需 ${requiredMemoryGb.toFixed(1)}GB，超过可用系统内存 ${ramGb.toFixed(1)}GB 的安全上限`,
  };
}

const FIT_ORDER: Record<ModelFit, number> = { good: 0, ok: 1, tight: 2, cloud: 3, too_large: 4 };

export function rankModelRoutes(hardware: HardwareInfo, providers: Array<Record<string, unknown>>): ModelRouteCandidate[] {
  const candidates: ModelRouteCandidate[] = [];
  for (const provider of providers) {
    if (provider.enabled === false) continue;
    const models = Array.isArray(provider.models) ? provider.models : [];
    const baseUrl = typeof provider.base_url === "string" ? provider.base_url : "";
    for (const rawModel of models) {
      const model = String(rawModel);
      if (!model) continue;
      const fit = assessModelFit(model, hardware, baseUrl);
      candidates.push({
        providerId: String(provider.id ?? ""),
        providerLabel: String(provider.label ?? provider.id ?? ""),
        model,
        ...fit,
      });
    }
  }
  return candidates.sort((a, b) => FIT_ORDER[a.fit] - FIT_ORDER[b.fit] || a.model.localeCompare(b.model));
}
