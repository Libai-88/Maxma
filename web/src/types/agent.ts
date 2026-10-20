// Agent 系统类型定义补充

export type AgentStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export interface AgentTimeline {
  timestamp: number
  message: string
}

export interface Agent {
  id: string
  title?: string
  description?: string
  status: AgentStatus
  attempts?: number
  duration?: number
  progress?: number
  result?: string
  error?: string
  cancelReason?: string
  timeline?: AgentTimeline[]
  cancellable?: boolean
  dependencies?: string[]
}

export interface AgentDependency {
  from: string
  to: string
  type?: 'sequential' | 'parallel' | 'conditional'
}

export type TimelineEventType = 'start' | 'progress' | 'complete' | 'error' | 'info'

export interface TimelineEventAction {
  label: string
  type: string
}

export interface TimelineEvent {
  id: string
  type: TimelineEventType
  status: AgentStatus
  title: string
  description?: string
  timestamp: number
  duration?: number
  metadata?: Record<string, string | number>
  actions?: TimelineEventAction[]
}
