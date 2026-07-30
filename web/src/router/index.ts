import { createRouter, createWebHistory } from 'vue-router'
import { useCapabilitiesStore } from '@/stores/capabilities'

// 扩展路由 meta 类型：声明可选的 feature 字段用于能力守卫。
declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    /** 若指定，导航到该路由前会校验对应后端能力是否启用。 */
    feature?: string
  }
}

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
      meta: { title: '记忆', feature: 'memory' },
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
      meta: { title: 'MCP 工具', feature: 'mcp' },
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
      meta: { title: '插件管理', feature: 'plugins' },
    },
    {
      path: '/plugins/:name',
      name: 'plugin-detail',
      component: () => import('@/views/PluginDetailView.vue'),
      meta: { title: '插件详情', feature: 'plugins' },
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
      meta: { title: '协作', feature: 'collab' },
    },
    {
      path: '/share/:id',
      name: 'share',
      component: () => import('@/views/ShareView.vue'),
      meta: { title: '分享的会话' },
    },
    {
      path: '/rules',
      name: 'rules',
      component: () => import('@/views/RulesView.vue'),
      meta: { title: '质量规则', feature: 'rules' },
    },
    {
      path: '/automation',
      name: 'automation',
      component: () => import('@/views/AutomationView.vue'),
      meta: { title: '自动化', feature: 'automation' },
    },
    {
      path: '/feature-unavailable',
      name: 'feature-unavailable',
      component: () => import('@/views/FeatureUnavailableView.vue'),
      meta: { title: '功能不可用' },
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
  // 能力守卫：若目标路由声明了 meta.feature 且该能力被禁用，
  // 重定向到「功能不可用」页面。清单尚未加载时 isFeatureEnabled
  // 返回乐观默认 true，因此不会阻塞首次导航。
  if (to.meta?.feature && to.name !== 'feature-unavailable') {
    const capabilities = useCapabilitiesStore()
    if (!capabilities.isFeatureEnabled(to.meta.feature)) {
      return {
        name: 'feature-unavailable',
        query: {
          feature: to.meta.feature,
          title: (to.meta?.title as string) || to.meta.feature,
          from: to.fullPath,
        },
      }
    }
  }

  const title = (to.meta?.title as string) || ''
  document.title = title ? `${title} - Maxma` : 'Maxma'
})

router.afterEach((_to) => {
  window.scrollTo(0, 0)
})

export default router
