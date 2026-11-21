/**
 * kernel/permission-decision.ts — 工具调用三值判定。
 *
 * 单独成文件的原因：`kernel/types.ts` 被权限单源守卫扫描，任何档位字面量
 * 都会被当成第二份清单；而 allow/ask/deny 是判定，不是档位，不应与
 * read_only/ask/operate/auto 混在同一份源码里。
 */

export type PermissionDecision = "allow" | "ask" | "deny";
