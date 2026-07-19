<!-- web/src/components/FloatSidebar.vue -->
<template>
  <!-- SessionDrawer is the single owner of session management. -->
  <span v-if="false" aria-hidden="true" />
</template>

<style scoped>
.float-sidebar {
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  width: 220px;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border);
  box-shadow: var(--shadow-lg);
  z-index: 150;
  padding: 24px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
}

.fs-nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.fs-nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: var(--radius);
  color: var(--text-secondary);
  text-decoration: none;
  font-size: 0.9em;
  transition: background 0.15s, color 0.15s;
}
.fs-nav-item:hover {
  background: var(--bg-card);
  color: var(--text-primary);
}
.fs-nav-item.router-link-active {
  background: var(--bg-card);
  color: var(--accent);
  font-weight: 600;
}

/* 滑入/滑出动画 */
.float-sidebar-enter-active {
  animation: fs-slide-in 0.25s var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1));
}
.float-sidebar-leave-active {
  animation: fs-slide-out 0.2s var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1));
}

@keyframes fs-slide-in {
  from { transform: translateX(-100%); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}
@keyframes fs-slide-out {
  from { transform: translateX(0); opacity: 1; }
  to { transform: translateX(-100%); opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .float-sidebar-enter-active,
  .float-sidebar-leave-active { animation: none; }
}
</style>
