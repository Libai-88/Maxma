/**
 * 设计画布的 Agent 通道：sidecar 发 canvas_command → 本模块在真实画布组件上执行
 * → 通过同一会话 WS 回 canvas_agent_result。
 *
 * 关键约束：
 * - 只允许当前会话；并行会话不能让工具误改另一张画布。
 * - 画布未打开时自动打开「设计」页，等 React/Konva 挂载后再执行。
 * - 多窗口用 Web Locks 选一个执行者，避免同一命令被两个窗口各改一次。
 */
import { useSessionStore } from '@/stores/session'
import { useWorkbenchStore } from '@/stores/workbench'
import type { DesignProject } from '@/types/designCanvas'
import {
  applyDesignOperations,
  normalizeAgentOperations,
  summarizeDesignProject,
  type CanvasAgentApplyResult,
} from './canvasAgentOperations'
import { createDesignAssetFromDataUrl } from './useDesignImages'

const CONTROLLER_WAIT_MS = 6_000
const POLL_INTERVAL_MS = 50

export type CanvasAgentAction = 'read' | 'apply' | 'export'

export interface CanvasAgentController {
  getProject: () => DesignProject | null
  getSelectedId: () => string | null
  commitProject: (recipe: (current: DesignProject) => DesignProject | null) => DesignProject | null
  select: (id: string | null) => void
  exportPng: () => Promise<string>
}

export interface CanvasAgentRequestPayload {
  request_id?: unknown
  action?: unknown
  args?: unknown
}

export interface CanvasAgentCommandResult {
  request_id: string
  result?: unknown
  error?: string
}

type CanvasAgentResponse =
  | { ok: true; result: unknown }
  | { ok: false; error: string }

const controllers = new Map<string, CanvasAgentController>()

function currentSessionKey(): string {
  return useSessionStore.getState().sessionId || 'global'
}

function normalizeSessionKey(sessionId: unknown): string {
  return typeof sessionId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(sessionId)
    ? sessionId
    : 'global'
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export function registerDesignCanvasAgent(
  sessionKey: string,
  controller: CanvasAgentController,
): () => void {
  controllers.set(sessionKey, controller)
  return () => {
    if (controllers.get(sessionKey) === controller) controllers.delete(sessionKey)
  }
}

function sanitizeExportName(name: string): string {
  return name.replace(/[\\/:*?"<>|\s]+/g, '').trim().slice(0, 60) || '设计画布'
}

async function ensureCanvasReady(sessionKey: string): Promise<CanvasAgentController> {
  const active = currentSessionKey()
  if (sessionKey !== active) {
    throw new Error(`画布只允许操作当前会话（当前 ${active.slice(0, 8)}，请求 ${sessionKey.slice(0, 8)}）`)
  }

  const existing = controllers.get(sessionKey)
  if (existing) return existing

  const workbench = useWorkbenchStore.getState()
  if (!workbench.isOpen) workbench.open()
  workbench.setTab('canvas', sessionKey === 'global' ? undefined : sessionKey)

  const deadline = Date.now() + CONTROLLER_WAIT_MS
  while (Date.now() < deadline) {
    const controller = controllers.get(sessionKey)
    if (controller) return controller
    await sleep(POLL_INTERVAL_MS)
  }
  throw new Error('画布面板未能在 6 秒内就绪；请确认右侧工作台可用后重试')
}

async function executeRead(controller: CanvasAgentController): Promise<unknown> {
  const project = controller.getProject()
  if (!project) throw new Error('画布项目尚未加载')
  return summarizeDesignProject(project, controller.getSelectedId())
}

async function executeApply(
  controller: CanvasAgentController,
  rawArgs: Record<string, unknown>,
): Promise<CanvasAgentApplyResult & { summary: ReturnType<typeof summarizeDesignProject> }> {
  const project = controller.getProject()
  if (!project) throw new Error('画布项目尚未加载')
  const operations = normalizeAgentOperations(rawArgs.operations)
  const first = operations[0]
  if (operations.length === 1 && first && (first.op === 'undo' || first.op === 'redo')) {
    throw new Error(`${first.op} 需要单独调用；本轮 canvas_apply 只接受编辑操作`)
  }

  for (const operation of operations) {
    if (operation.op !== 'add_image') continue
    const source = (operation as { dataUrl?: unknown }).dataUrl
    const name = (operation as { fileName?: unknown }).fileName
    if (typeof source !== 'string' || !source.startsWith('data:image/')) {
      throw new Error('add_image 缺少图片数据；请传绝对路径 imagePath')
    }
    if (typeof name !== 'string' || !name.trim()) {
      throw new Error('add_image 缺少文件名')
    }
    const mime = source.slice(5, source.indexOf(';'))
    const asset = await createDesignAssetFromDataUrl(source, name.trim().slice(0, 120), mime)
    if (!asset) throw new Error('图片解码或落库失败（最大 20 MB，最长边会缩到 2400）')
    operation.asset = asset
  }

  const selectedBefore = controller.getSelectedId()
  const result = applyDesignOperations(project, operations, selectedBefore)
  if (result.changed) {
    const next = controller.commitProject(() => result.project)
    if (!next) throw new Error('画布写入没有产生新项目')
  }
  controller.select(result.selectedId)
  const nextProject = controller.getProject()
  if (!nextProject) throw new Error('画布写入后项目丢失')
  return {
    ...result,
    project: nextProject,
    summary: summarizeDesignProject(nextProject, result.selectedId),
  }
}

async function executeExport(
  controller: CanvasAgentController,
  rawArgs: Record<string, unknown>,
): Promise<unknown> {
  const project = controller.getProject()
  if (!project) throw new Error('画布项目尚未加载')
  const dataUrl = await controller.exportPng()
  if (!dataUrl.startsWith('data:image/png;base64,')) throw new Error('导出未生成 PNG')
  const name = `${sanitizeExportName(project.name)}.png`
  const toChat = rawArgs.toChat === true
  if (toChat) {
    window.dispatchEvent(new CustomEvent('maxma:add-image-ref', {
      detail: {
        dataUrl,
        label: name,
        sessionId: currentSessionKey() === 'global' ? undefined : currentSessionKey(),
      },
    }))
  }
  return {
    name,
    width: project.artboard.width,
    height: project.artboard.height,
    elementCount: project.elements.length,
    dataUrl,
    queuedForChat: toChat,
  }
}

async function executeCanvasAgentAction(
  action: unknown,
  args: unknown,
  sessionKeyInput?: unknown,
): Promise<CanvasAgentResponse> {
  const sessionKey = normalizeSessionKey(sessionKeyInput ?? currentSessionKey())
  if (typeof action !== 'string' || !['read', 'apply', 'export'].includes(action)) {
    return { ok: false, error: `未知画布动作 ${String(action)}` }
  }
  try {
    const controller = await ensureCanvasReady(sessionKey)
    const rawArgs = args && typeof args === 'object' && !Array.isArray(args)
      ? args as Record<string, unknown>
      : {}
    if (action === 'read') return { ok: true, result: await executeRead(controller) }
    if (action === 'apply') return { ok: true, result: await executeApply(controller, rawArgs) }
    return { ok: true, result: await executeExport(controller, rawArgs) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** 供 UI 驱动/组件内自测直接调用；正式链路走 handleCanvasAgentCommand。 */
export interface CanvasAgentGlobal {
  execute: (action: string, args?: Record<string, unknown>, sessionId?: string) => Promise<CanvasAgentResponse>
}

declare global {
  interface Window {
    __maxmaCanvasAgent?: CanvasAgentGlobal
  }
}

if (typeof window !== 'undefined') {
  window.__maxmaCanvasAgent = {
    execute: (action, args = {}, sessionId) => executeCanvasAgentAction(action, args, sessionId),
  }
}

async function runInOneWindow<T>(requestId: string, task: () => Promise<T>): Promise<T | null> {
  const locks = navigator.locks
  if (!locks?.request) return task()
  return new Promise<T | null>((resolve, reject) => {
    void locks.request(`maxma-canvas-command:${requestId}`, { ifAvailable: true }, async (lock) => {
      if (!lock) {
        resolve(null)
        return
      }
      try {
        resolve(await task())
      } catch (error) {
        reject(error)
      }
    })
  })
}

/** useChat 收到 canvas_command 时调用；结果由调用方通过原 WS 写回。 */
export async function handleCanvasAgentCommand(
  sessionId: string,
  payload: CanvasAgentRequestPayload,
  respond: (result: CanvasAgentCommandResult) => void,
): Promise<void> {
  const requestId = typeof payload.request_id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(payload.request_id)
    ? payload.request_id
    : ''
  if (!requestId) return
  const action = typeof payload.action === 'string' ? payload.action : ''
  try {
    const result = await runInOneWindow(requestId, () =>
      executeCanvasAgentAction(action, payload.args, sessionId))
    if (result === null) return
    respond({
      request_id: requestId,
      ...(result.ok ? { result: result.result } : { error: result.error }),
    })
  } catch (error) {
    respond({
      request_id: requestId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
