/**
 * activity-hub.ts — 全局活动事件中心（api/activity_hub.py 的 Bun 直译，阶段二 2.3b）。
 *
 * 环形缓冲（MAX_IN_MEMORY=1000）+ record() 安全包装（吞异常、message 截断
 * 120 字符）逐字段对齐 Python 版；新增 subscribe() 订阅器——Python 版 SSE
 * 以 1s 轮询 deque 实现，Bun 单线程下改为记录时同步回调（事件即时送达）。
 */

export interface ActivityRecord {
  timestamp: number;
  category: string; // turn / tool / plan / compression / approval / memory / system
  event_type: string; // turn_start / tool_end / compact / startup ...
  session_id: string;
  turn_id: string;
  tool_name: string;
  level: string; // info / warn / error
  message: string;
  payload: Record<string, unknown>;
}

export type ActivityListener = (record: ActivityRecord) => void;

const MAX_IN_MEMORY = 1000;
/** message 字段最大长度——防止超长文本撑爆内存环形缓冲。 */
const MAX_MESSAGE_LEN = 120;

class ActivityHub {
  private buffer: ActivityRecord[] = [];
  private startedAt = Date.now() / 1000;
  private listeners = new Set<ActivityListener>();

  add(
    category: string,
    eventType: string,
    opts: {
      session_id?: string;
      turn_id?: string;
      tool_name?: string;
      level?: string;
      message?: string;
      payload?: Record<string, unknown>;
    } = {},
  ): ActivityRecord {
    const record: ActivityRecord = {
      timestamp: Date.now() / 1000,
      category,
      event_type: eventType,
      session_id: opts.session_id ?? "",
      turn_id: opts.turn_id ?? "",
      tool_name: opts.tool_name ?? "",
      level: opts.level ?? "info",
      message: opts.message ?? "",
      payload: opts.payload ?? {},
    };
    this.buffer.push(record);
    if (this.buffer.length > MAX_IN_MEMORY) this.buffer.shift();
    for (const listener of this.listeners) {
      try {
        listener(record);
      } catch {
        // 订阅器失败不影响记录本身（与 record() 遥测安全同语义）
      }
    }
    return record;
  }

  recent(limit = 100, category?: string): ActivityRecord[] {
    let records = this.buffer;
    if (category) records = records.filter((r) => r.category === category);
    return records.slice(-Math.max(0, limit));
  }

  listBySession(sessionId: string, limit = 100): ActivityRecord[] {
    return this.buffer.filter((r) => r.session_id === sessionId).slice(-Math.max(0, limit));
  }

  clear(): number {
    const count = this.buffer.length;
    this.buffer = [];
    return count;
  }

  clearBySession(sessionId: string): number {
    const before = this.buffer.length;
    this.buffer = this.buffer.filter((r) => r.session_id !== sessionId);
    return before - this.buffer.length;
  }

  stats(): Record<string, unknown> {
    const byCategory: Record<string, number> = {};
    for (const r of this.buffer) {
      byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
    }
    const now = Date.now() / 1000;
    return {
      total: this.buffer.length,
      by_category: byCategory,
      started_at: this.startedAt,
      uptime_seconds: now - this.startedAt,
    };
  }

  /** 新记录回调（SSE 推送用）。返回取消订阅函数。 */
  subscribe(listener: ActivityListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

let instance: ActivityHub | null = null;

export function getActivityHub(): ActivityHub {
  if (!instance) instance = new ActivityHub();
  return instance;
}

/**
 * [遥测安全] 统一埋点入口——吞掉所有异常（遥测失败绝不影响主流程），
 * message 超长自动截断加省略号（对齐 Python record()）。
 */
export function record(
  category: string,
  eventType: string,
  kwargs: {
    session_id?: string;
    turn_id?: string;
    tool_name?: string;
    level?: string;
    message?: string;
    payload?: Record<string, unknown>;
  } = {},
): void {
  try {
    const msg = kwargs.message;
    if (typeof msg === "string" && msg.length > MAX_MESSAGE_LEN) {
      kwargs = { ...kwargs, message: msg.slice(0, MAX_MESSAGE_LEN) + "…" };
    }
    getActivityHub().add(category, eventType, kwargs);
  } catch {
    // 静默：与 Python 版 except Exception 同语义
  }
}
