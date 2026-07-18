import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'chat',
      component: () => import('@/views/ChatView.vue'),
      meta: { title: '对话' },
    },
    {
      path: '/memory',
      name: 'memory',
      component: () => import('@/views/MemoryView.vue'),
      meta: { title: '记忆' },
    },
    {
      path: '/kb',
      name: 'kb',
      component: () => import('@/views/KbView.vue'),
      meta: { title: '知识库' },
    },
    {
      path: '/news',
      name: 'news',
      component: () => import('@/views/NewsView.vue'),
      meta: { title: '动态' },
    },
    {
      path: '/playground',
      redirect: '/news',
    },
    {
      path: '/appearance',
      name: 'appearance',
      component: () => import('@/views/AppearanceView.vue'),
      meta: { title: '外观' },
    },
    {
      path: '/help',
      name: 'help',
      component: () => import('@/views/HelpView.vue'),
      meta: { title: '帮助' },
    },
    {
      path: '/providers',
      name: 'providers',
      component: () => import('@/views/ProvidersView.vue'),
      meta: { title: '模型提供商' },
    },
    {
      path: '/soul',
      name: 'soul',
      component: () => import('@/views/SoulView.vue'),
      meta: { title: '角色设定' },
    },
    {
      path: '/mcp',
      name: 'mcp',
      component: () => import('@/views/McpView.vue'),
      meta: { title: 'MCP 工具' },
    },
    {
      path: '/skills',
      name: 'skills',
      component: () => import('@/views/SkillsView.vue'),
      meta: { title: '技能' },
    },
    {
      path: '/user',
      name: 'user',
      component: () => import('@/views/UserView.vue'),
      meta: { title: '用户' },
    },
    {
      path: '/path-whitelist',
      name: 'path-whitelist',
      component: () => import('@/views/PathWhitelistView.vue'),
      meta: { title: '路径白名单' },
    },
    {
      path: '/maxma-blocker',
      name: 'maxma-blocker',
      component: () => import('@/views/MaxmaBlockerView.vue'),
      meta: { title: 'Maxma 阻止' },
    },
    {
      path: '/env-vars',
      name: 'env-vars',
      component: () => import('@/views/EnvVarsView.vue'),
      meta: { title: '环境变量' },
    },
    {
      path: '/event-hooks',
      name: 'event-hooks',
      component: () => import('@/views/HooksView.vue'),
      meta: { title: '事件钩子' },
    },
    {
      path: '/privacy',
      name: 'privacy',
      component: () => import('@/views/PrivacyView.vue'),
      meta: { title: '隐私' },
    },
    {
      path: '/metrics',
      name: 'metrics',
      component: () => import('@/views/MetricsView.vue'),
      meta: { title: '指标' },
    },
    {
      path: '/audit-log',
      name: 'audit-log',
      component: () => import('@/views/AuditLogView.vue'),
      meta: { title: '审计日志' },
    },
    {
      path: '/activity',
      name: 'activity',
      component: () => import('@/views/ActivityView.vue'),
      meta: { title: '活动' },
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('@/views/NotFoundView.vue'),
      meta: { title: '页面未找到' },
    },
  ],
})

router.beforeEach((to, _from) => {
  const title = (to.meta?.title as string) || ''
  document.title = title ? `${title} - Maxma` : 'Maxma'
})

router.afterEach((_to) => {
  window.scrollTo(0, 0)
})

export default router
