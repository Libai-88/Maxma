const DISPLAY_NAMES: Record<string, string> = {
  /* OMP 内建工具 */
  bash: 'Shell 执行',
  read: '读取文件',
  write: '写入文件',
  edit: '文件编辑',
  glob: '文件查找',
  grep: '文本搜索',
  eval: '代码评估',
  task: '任务管理',
  todo: '待办管理',
  ask: '询问用户',
  inspect_image: '图片分析',
  web_search: '网络搜索',
  ast_grep: 'AST 搜索',
  ast_edit: 'AST 编辑',
  browser: '浏览器操作',
  lsp: 'LSP 代码分析',
  ssh: 'SSH 连接',
  github: 'GitHub 操作',
  checkpoint: '检查点',
  rewind: '回退',
  job: '作业管理',
  irc: 'IRC 通信',
  launch: '启动应用',
  debug: '调试',
  learn: '学习',
  manage_skill: '技能管理',
  memory_edit: '记忆编辑',
  retain: '记忆保留',
  recall: '记忆召回',
  reflect: '记忆反思',
  resolve: '依赖解析',
  search_tool_bm25: '工具搜索',
  yield: '任务让出',
  report_finding: '报告发现',
  report_tool_issue: '报告工具问题',
  goal: '目标管理',
  search: '搜索',
}

export function toolDisplayName(name: string): string {
  if (DISPLAY_NAMES[name]) return DISPLAY_NAMES[name]
  return name
}

/** 所有已知工具名称列表（供 Playground 使用） */
export const ALL_TOOL_NAMES = Object.keys(DISPLAY_NAMES)

/**
 * 检查一个对象是否存在且有至少一个自有键。
 * 用于替代各工具气泡中重复的 computed(() => Object.keys(td.value).length > 0) 模式。
 * 注意：调用方仍需包裹 computed()，但此函数统一了 null 安全性与检查逻辑。
 */
export function hasObjectKeys(obj: Record<string, unknown> | null | undefined): boolean {
  return !!obj && Object.keys(obj).length > 0
}
