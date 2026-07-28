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
      redirect: '/memory',
    },
    {
      path: '/news',
      name: 'news',
      component: () => import('@/views/NewsView.vue'),
      meta: { title: '动态' },
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
      path: '/user',
      name: 'user',
      component: () => import('@/views/UserView.vue'),
      meta: { title: '用户' },
    },
    {
      path: '/maxma-blocker',
      name: 'maxma-blocker',
      component: () => import('@/views/MaxmaBlockerView.vue'),
      meta: { title: 'Maxma 阻止' },
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
      path: '/settings',
      name: 'settings',
      component: () => import('@/views/SettingsView.vue'),
      meta: { title: '设置' },
    },
    {
      path: '/plugins',
      name: 'plugins',
      component: () => import('@/views/PluginListView.vue'),
      meta: { title: '插件管理' },
    },
    {
      path: '/plugins/:name',
      name: 'plugin-detail',
      component: () => import('@/views/PluginDetailView.vue'),
      meta: { title: '插件详情' },
    },
    {
      path: '/extensions',
      name: 'extensions',
      component: () => import('@/views/ExtensionView.vue'),
      meta: { title: '扩展管理' },
    },
    {
      path: '/audit-log',
      redirect: '/privacy',
    },
    {
      path: '/capabilities',
      name: 'capabilities',
      component: () => import('@/views/CapabilitiesView.vue'),
      meta: { title: '能力仪表盘' },
    },
    {
      path: '/activity',
      name: 'activity',
      component: () => import('@/views/ActivityView.vue'),
      meta: { title: '活动' },
    },
    {
      path: '/collab',
      name: 'collab',
      component: () => import('@/views/CollabView.vue'),
      meta: { title: '协作' },
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
