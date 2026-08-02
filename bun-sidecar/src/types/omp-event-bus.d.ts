// Type declarations for OMP SDK internals not exported via the public API.

declare module "@oh-my-pi/pi-coding-agent/src/utils/event-bus" {
  export class EventBus {
    emit(channel: string, data: unknown): void;
    on(channel: string, handler: (data: unknown) => void): () => void;
    clear(): void;
  }
}

// OMP session event types used by mapPiEventToMaxma.

interface OmpAutoCompactionEndEvent {
  result?: { shortSummary?: string; summary?: string; tokensBefore?: number };
  action?: string;
  skipped?: boolean;
  aborted?: boolean;
  willRetry?: boolean;
  errorMessage?: string;
}

interface OmpAutoCompactionStartEvent {
  reason?: string;
  action?: string;
}

interface OmpAutoRetryEvent {
  attempt?: number;
  maxAttempts?: number;
  delayMs?: number;
  errorMessage?: string;
  success?: boolean;
  finalError?: string;
}

interface OmpTodoItem {
  content?: string;
  status?: string;
}

interface OmpTodoReminderEvent {
  todos?: OmpTodoItem[];
  attempt?: number;
  maxAttempts?: number;
}

interface OmpIrcMessageEvent {
  message?: {
    from?: string;
    to?: string;
    body?: string;
    id?: string;
  };
}

interface OmpNoticeEvent {
  level?: string;
  message?: string;
  source?: string;
}