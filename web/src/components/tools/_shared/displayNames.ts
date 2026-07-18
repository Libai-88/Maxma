const DISPLAY_NAMES: Record<string, string> = {
  weather: '天气查询',
  get_current_weather: '天气查询',
  holiday_calendar: '节假日查询',
  tavily_search: 'Tavily 搜索',
  tavily_extract: 'Tavily 提取',
  holiday: '节假日查询',
  image_understand: '图片理解',
  analyze_image: '图片理解',
  map_nearby: '周边搜索',
  map_geocode: '地理编码',
  map_transit: '公交换乘',
  map_cycling: '骑行路线',
  map_fuzzy_addr: '地址解析',
  file_read: '读取文件',
  file_write: '写入文件',
  file_manage: '文件管理',
  file_search: '文件搜索',
  file_edit: '文件编辑',
  syntax_check: '语法检查',
  code_quality: '代码质量',
  unit_test: '单元测试',
  debug: '调试',
  todo_add: '添加待办',
  todo_list: '待办列表',
  todo_complete: '完成待办',
  todo_uncomplete: '取消完成',
  todo_delete: '删除待办',
  todo_update: '更新待办',
  todo_query: '查询待办',
  todo_list_projects: '项目列表',
  todo_add_quick: '快速添加待办',
  todo_list_sections: '分区列表',
  todo_list_labels: '标签列表',
  python: 'Python 执行',
  run_python: 'Python 执行',
  context_strategy: '上下文策略',
  forget: '选择性遗忘',
  create_persona: '创建人格',
  nearby_search: '周边搜索',
  fuzzy_address_search: '模糊地址搜索',
  geocode_address: '地理编码',
  get_transit_route: '公交换乘',
  get_cycling_route: '骑行路线',
  tarot: '塔罗牌',
  ask_user: '询问用户',
  ask_user_for_info: '询问用户',
  ask_user_qa: '询问用户',
  ask_user_single_choice: '请选择',
  ask_user_multi_choice: '多选',
  ask_user_confirm: '危险操作确认',
  task_tracker: '任务追踪',

  /* Memory */
  list_memories: '记忆列表',
  read_memories: '读取记忆',
  create_memory: '创建记忆',
  update_memory: '更新记忆',
  delete_memory: '删除记忆',
  merge_memories: '合并记忆',
  search_memories: '搜索记忆',

  /* Config */
  manage_mcp: 'MCP 管理',
  manage_skills: '技能管理',
  manage_macros: '宏管理',
  manage_providers: '提供商管理',
  manage_env_vars: '环境变量管理',
  manage_whitelist: '路径白名单管理',

  /* Git */
  git_status: '仓库状态',
  git_diff: '文件差异',
  git_log: '提交历史',
  git_commit: '提交代码',
  git_branch: '分支管理',
  git_push: '推送远程',
  git_pr: '创建 PR',

  /* OMP / Coding Agent built-in tools */
  bash: 'Shell 执行',
  read: '读取文件',
  write: '写入文件',
  edit: '文件编辑',
  search: '搜索',
  glob: '文件查找',
  grep: '文本搜索',
  lsp: 'LSP 代码分析',
  browser: '浏览器操作',
  eval: '代码评估',
  task: '任务管理',
  todo: '待办管理',
  goal: '目标管理',
  resolve: '依赖解析',
  fetch: '网络请求',
  ssh: 'SSH 连接',
  job: '作业管理',
  inspect_image: '图片分析',
  generate_image: '图片生成',
  web_search: '网络搜索',
  memory_recall: '记忆召回',
  memory_reflect: '记忆反思',
  memory_retain: '记忆保留',
  report_finding: '报告发现',
  report_tool_issue: '报告工具问题',
  yield: '任务让出',
  irc: 'IRC 通信',
  ast_grep: 'AST 搜索',
  ast_edit: 'AST 编辑',
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
 * 注意：调用方仍需包裹 computed()，但此函数统一了 null 安全性与检查语义。
 */
export function hasObjectKeys(obj: Record<string, unknown> | null | undefined): boolean {
  return !!obj && Object.keys(obj).length > 0
}
