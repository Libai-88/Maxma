import { createRouter, createWebHistory } from 'vue-router'
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'chat', component: () => import('@/views/ChatView.vue') },
    { path: '/memory', name: 'memory', component: () => import('@/views/MemoryView.vue') },
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
  ],
})

export default router
