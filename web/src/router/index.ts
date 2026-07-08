import { createRouter, createWebHistory } from 'vue-router'
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'chat', component: () => import('@/views/ChatView.vue') },
    { path: '/memory', name: 'memory', component: () => import('@/views/MemoryView.vue') },
    {
      path: '/kb',
      name: 'kb',
      component: () => import('@/views/KbView.vue'),
    },
    {
      path: '/playground',
      name: 'news',
      component: () => import('@/views/NewsView.vue'),
    },
    {
      path: '/providers',
      name: 'providers',
      component: () => import('@/views/ProvidersView.vue'),
    },
    {
      path: '/soul',
      name: 'soul',
      component: () => import('@/views/SoulView.vue'),
    },
    {
      path: '/mcp',
      name: 'mcp',
      component: () => import('@/views/McpView.vue'),
    },
    {
      path: '/skills',
      name: 'skills',
      component: () => import('@/views/SkillsView.vue'),
    },
    {
      path: '/user',
      name: 'user',
      component: () => import('@/views/UserView.vue'),
    },
    {
      path: '/path-whitelist',
      name: 'path-whitelist',
      component: () => import('@/views/PathWhitelistView.vue'),
    },
    {
      path: '/maxma-blocker',
      name: 'maxma-blocker',
      component: () => import('@/views/MaxmaBlockerView.vue'),
    },
    {
      path: '/env-vars',
      name: 'env-vars',
      component: () => import('@/views/EnvVarsView.vue'),
    },
    {
      path: '/event-hooks',
      name: 'event-hooks',
      component: () => import('@/views/HooksView.vue'),
    },
    {
      path: '/privacy',
      name: 'privacy',
      component: () => import('@/views/PrivacyView.vue'),
    },
    {
      path: '/metrics',
      name: 'metrics',
      component: () => import('@/views/MetricsView.vue'),
    },
    {
      path: '/audit-log',
      name: 'audit-log',
      component: () => import('@/views/AuditLogView.vue'),
    },
    {
      path: '/activity',
      name: 'activity',
      component: () => import('@/views/ActivityView.vue'),
    },
  ],
})

export default router
