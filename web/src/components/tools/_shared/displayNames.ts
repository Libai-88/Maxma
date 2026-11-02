/**
 * 工具气泡标题的中文字典：工具名 → 展示名。
 * 未登记的名字会原样显示英文（toolDisplayName 的兜底），所以「引擎实际会调用的工具」
 * 必须全部出现在这里；实际可用工具清单来源：
 *   bun-sidecar/src/kernel/pi-session.ts:35（引擎内置）、bun-sidecar/src/tools/*（自定义）、
 *   bun-sidecar/src/kernel/plan.ts:84（submit_plan）。
 *
 * 表内三段共存：当前 pi 引擎内置 7 个 + Maxma 自定义 7 个 + 上一代引擎（OMP）专有若干。
 * OMP 专有名在 pi 下不产生，但可能被用户配置的 MCP 服务器同名暴露，也用于历史转录回放，
 * 故保留（删除 = 那些气泡标题退回英文）。
 */
const DISPLAY_NAMES: Record<string, string> = {
  /* 引擎内建 + 上一代引擎（OMP）内建，同名者共用一条中文。
   * 其中仅 OMP 存在、pi 下不产生的：eval, task, todo, ask, inspect_image, ast_grep,
   * ast_edit, browser, lsp, ssh, github, checkpoint, rewind, job, irc, launch, debug,
   * learn, manage_skill, memory_edit, retain, recall, reflect, resolve,
   * search_tool_bm25, yield（glob 同理——pi 用 find 而非 glob）。
   * 保留原因见文件头：兼容 MCP 同名工具 + 历史转录回放。 */
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
  /* Maxma 自定义工具（sidecar customTools 注册，tools.py 宣告） */
  remember_memory: '记住记忆',
  search_memories: '检索记忆',
  get_sticker: '获取贴纸',
  list_rules: '查询规则',
  list_automations: '查询自动化',
  read_office_file: '读取 Office 文件',
  write_office_file: '写入 Office 文件',
  /* 计划模式提交工具（bun-sidecar/src/kernel/plan.ts:84） */
  submit_plan: '提交计划',
  /* pi 引擎（@earendil-works/pi-coding-agent）内置工具里与上方 OMP 同名的
   * read/write/edit/grep/bash 复用既有中文；以下两个是 pi 专有、此前缺失的：
   *   find — 按 glob 模式查找文件；ls — 列目录
   * powershell 为 pi 支持但未进入 MAXMA_DEFAULT_PI_TOOLS 的第 8 个内置工具，
   * 一并登记以防默认工具集调整时标题退化为英文原名。 */
  find: '查找文件',
  ls: '目录列表',
  powershell: 'PowerShell 执行',
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
