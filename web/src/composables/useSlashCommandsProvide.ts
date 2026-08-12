/**
 * useSlashCommandsProvide — 斜杠命令执行器的 provide/inject 通道（GAP-CMD-001）。
 *
 * ChatView 实现全部命令分发（拥有 useChat 的 WS senders、undo/retry/clear
 * 等既有 handler），ChatInput 的 / 命令面板通过本通道调用并展示反馈。
 */
import { provide, inject, type InjectionKey } from 'vue'

export interface SlashCommandRunner {
  run: (name: string, args: string) => Promise<string | void>
}

const SLASH_COMMANDS_KEY: InjectionKey<SlashCommandRunner> = Symbol('maxma-slash-commands')

export function provideSlashCommands(runner: SlashCommandRunner): void {
  provide(SLASH_COMMANDS_KEY, runner)
}

export function useSlashCommandsInjected(): SlashCommandRunner | null {
  return inject(SLASH_COMMANDS_KEY, null)
}
