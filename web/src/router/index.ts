import { createRouter, createWebHistory } from 'vue-router'
import { useCapabilitiesStore } from '@/stores/capabilities'

// 扩展路由 meta 类型：声明可选的 feature / transition 字段。
declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    /** 若指定，导航到该路由前会校验对应后端能力是否启用。 */
    feature?: string
    /** 页面转场类型：flip(3D翻转)/slide(水平滑入)/rise(上升浮入)/zoom(缩放淡入)。
     *  默认 flip。方向感知（前进/后退）由 App.vue 的基础层控制。 */
    transition?: 'flip' | 'slide' | 'rise' | 'zoom'
  }
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'chat',
      component: () => import('@/views/ChatView.vue'),
      meta: { transition: 'flip', title: '对话' },
    },
    {
      path: '/memory',
      name: 'memory',
      component: () => import('@/views/MemoryView.vue'),
      meta: { transition: 'flip', title: '记忆', feature: 'memory' },
    },
    {
      path: '/kb',
      redirect: '/memory',
    },
    {
      path: '/news',
      name: 'news',
      component: () => import('@/views/NewsView.vue'),
      meta: { transition: 'flip', title: '动态' },
    },
    {
      path: '/appearance',
      name: 'appearance',
      component: () => import('@/views/AppearanceView.vue'),
      meta: { transition: 'slide', title: '外观' },
    },
    {
      path: '/help',
      name: 'help',
      component: () => import('@/views/HelpView.vue'),
      meta: { transition: 'flip', title: '帮助' },
    },
    {
      path: '/providers',
      name: 'providers',
      component: () => import('@/views/ProvidersView.vue'),
      meta: { transition: 'rise', title: '模型提供商' },
    },
    {
      path: '/soul',
      name: 'soul',
      component: () => import('@/views/SoulView.vue'),
      meta: { transition: 'slide', title: '角色设定' },
    },
    {
      path: '/mcp',
      name: 'mcp',
      component: () => import('@/views/McpView.vue'),
      meta: { transition: 'rise', title: 'MCP 工具', feature: 'mcp' },
    },
    {
      path: '/user',
      name: 'user',
      component: () => import('@/views/UserView.vue'),
      meta: { transition: 'slide', title: '用户' },
    },
    {
      path: '/maxma-blocker',
      name: 'maxma-blocker',
      component: () => import('@/views/MaxmaBlockerView.vue'),
      meta: { transition: 'slide', title: 'Maxma 阻止' },
    },
    {
      path: '/privacy',
      name: 'privacy',
      component: () => import('@/views/PrivacyView.vue'),
      meta: { transition: 'slide', title: '隐私' },
    },
    {
      path: '/metrics',
      name: 'metrics',
      component: () => import('@/views/MetricsView.vue'),
      meta: { transition: 'slide', title: '指标' },
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('@/views/SettingsView.vue'),
      meta: { transition: 'slide', title: '设置' },
    },
    {
      path: '/plugins',
      name: 'plugins',
      component: () => import('@/views/PluginListView.vue'),
      meta: { transition: 'rise', title: '插件管理', feature: 'plugins' },
    },
    {
      path: '/plugins/:name',
      name: 'plugin-detail',
      component: () => import('@/views/PluginDetailView.vue'),
      meta: { transition: 'zoom', title: '插件详情', feature: 'plugins' },
    },
    {
      path: '/extensions',
      name: 'extensions',
      component: () => import('@/views/ExtensionView.vue'),
      meta: { transition: 'rise', title: '扩展管理' },
    },
    {
      path: '/audit-log',
      redirect: '/privacy',
    },
    {
      path: '/capabilities',
      name: 'capabilities',
      component: () => import('@/views/CapabilitiesView.vue'),
      meta: { transition: 'flip', title: '能力仪表盘' },
    },
    {
      path: '/activity',
      name: 'activity',
      component: () => import('@/views/ActivityView.vue'),
      meta: { transition: 'flip', title: '活动' },
    },
    {
      path: '/collab',
      name: 'collab',
      component: () => import('@/views/CollabView.vue'),
      meta: { transition: 'flip', title: '协作', feature: 'collab' },
    },
    {
      path: '/share/:id',
      name: 'share',
      component: () => import('@/views/ShareView.vue'),
      meta: { transition: 'zoom', title: '分享的会话' },
    },
    {
      path: '/rules',
      name: 'rules',
      component: () => import('@/views/RulesView.vue'),
      meta: { transition: 'rise', title: '质量规则', feature: 'rules' },
    },
    {
      path: '/automation',
      name: 'automation',
      component: () => import('@/views/AutomationView.vue'),
      meta: { transition: 'rise', title: '自动化', feature: 'automation' },
    },
    {
      path: '/feature-unavailable',
      name: 'feature-unavailable',
      component: () => import('@/views/FeatureUnavailableView.vue'),
      meta: { transition: 'zoom', title: '功能不可用' },
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('@/views/NotFoundView.vue'),
      meta: { transition: 'zoom', title: '页面未找到' },
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

// 注：不再使用 window.scrollTo —— body 为 overflow:hidden，滚动容器在各 view 内部；
// 新 view mount 天然从顶部开始。

export default router
