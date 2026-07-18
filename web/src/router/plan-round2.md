# Round 2: 路由守卫添加计划

## 目标
为 `src/router/index.ts` 中的路由添加 `meta` 字段、`beforeEach` 导航守卫和 `scrollBehavior` 配置。

## 当前状态
- 文件路径：`D:\Maxma\MaxmaHere\web\src\router\index.ts`
- 目前 15 个路由，均无 `meta` 字段、无 `beforeEach`、无 `scrollBehavior`
- 现有路由：`/`, `/playground`, `/appearance`, `/providers`, `/soul`, `/mcp`, `/skills`, `/user`, `/path-whitelist`, `/maxma-blocker`, `/env-vars`, `/privacy`, `/metrics`, `/activity`, `/:pathMatch(.*)*`

## 修改计划

### 步骤 1：为每个路由添加 `meta.title` 字段

| 路由 path | name | meta.title |
|---|---|---|
| `/` | chat | 对话 |
| `/playground` | news | 动态 |
| `/appearance` | appearance | 外观 |
| `/providers` | providers | 模型提供商 |
| `/soul` | soul | 角色设定 |
| `/mcp` | mcp | MCP 工具 |
| `/skills` | skills | 技能 |
| `/user` | user | 用户 |
| `/path-whitelist` | path-whitelist | 路径白名单 |
| `/maxma-blocker` | maxma-blocker | Maxma 阻止 |
| `/env-vars` | env-vars | 环境变量 |
| `/privacy` | privacy | 隐私 |
| `/metrics` | metrics | 指标 |
| `/activity` | activity | 活动 |
| `/:pathMatch(.*)*` | not-found | 页面未找到 |

**注意**：以下路由在用户需求列表中但当前文件中不存在，需确认是否要补充添加：
- `/memory` → '记忆'（视图文件 `MemoryView.vue` 存在）
- `/kb` → '知识库'（视图文件 `KbView.vue` 存在）
- `/event-hooks` → '事件钩子'（视图文件 `HooksView.vue` 存在）
- `/audit-log` → '审计日志'（视图文件 `AuditLogView.vue` 存在）

### 步骤 2：添加 `beforeEach` 导航守卫

```typescript
router.beforeEach((to, _from) => {
  const title = (to.meta?.title as string) || 'Maxma'
  document.title = title ? `${title} - Maxma` : 'Maxma'
})
```

### 步骤 3：添加 `scrollBehavior`

```typescript
scrollBehavior(to, _from, savedPosition) {
  if (savedPosition) return savedPosition
  return { top: 0 }
}
```

### 验证方式
- `npx vue-tsc --noEmit` 确认 TypeScript 编译通过
- 人工检查每个路由 meta 字段正确

## 影响范围
仅修改 `src/router/index.ts` 一个文件，不涉及其它模块。
