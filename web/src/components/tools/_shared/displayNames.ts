/**
 * 工具展示名单一数据源（中文）。
 *
 * 必须覆盖：pi 内置工具（`PI_BUILTIN_TOOLS`）+ Maxma 自定义工具
 * （`MAXMA_CUSTOM_TOOLS`）+ 计划提交（`submit_plan`）。
 * `bun-sidecar/tests/engine-boundary.test.ts` 对账本表：漏一个，气泡/步骤标题
 * 就会退回英文工具名。
 *
 * 前端不许 import kernel 源码（engine-boundary 纪律），所以这里是副本；
 * 名字变化时测试会指出缺哪一条。
 */
export const TOOL_DISPLAY_NAMES: Record<string, string> = {
  // ── pi 内置 ──
  read: '读取',
  bash: '运行命令',
  edit: '编辑',
  write: '写入',
  grep: '搜索内容',
  find: '查找文件',
  ls: '列出目录',
  powershell: 'PowerShell',
  // ── Maxma 自定义 ──
  remember_memory: '记住记忆',
  search_memories: '检索记忆',
  get_sticker: '获取贴纸',
  list_rules: '列出规则',
  read_office_file: '读取 Office 文件',
  write_office_file: '写入 Office 文件',
  // ── kernel 扩展点 ──
  submit_plan: '提交计划',
}

/** 其它常见/历史名称（非契约，按需展示）。 */
const EXTRA_NAMES: Record<string, string> = {
  glob: '匹配文件',
  todo: '更新待办',
  task_tracker: '更新任务清单',
  ask_user: '向用户提问',
  web_search: '联网搜索',
  tavily_search: '联网搜索',
  browser_browse: '浏览网页',
  browser: '浏览网页',
  python: '运行 Python',
  run_python: '运行 Python',
  call_sub_agent: '启动子任务',
  memory_processing: '整理记忆',
  memory_review: '记忆回顾',
}

export function toolDisplayName(name: string): string {
  return TOOL_DISPLAY_NAMES[name] ?? EXTRA_NAMES[name] ?? name
}