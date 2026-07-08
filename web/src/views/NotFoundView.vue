<!-- web/src/views/NotFoundView.vue -->
<template>
  <div class="not-found-view">
    <div class="not-found-card">
      <h1 class="not-found-code">404</h1>
      <p class="not-found-text">页面不存在</p>
      <router-link to="/" class="ds-btn ds-btn--primary">返回首页</router-link>
    </div>
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: 'NotFoundView' })
</script>

<style scoped>
.not-found-view {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.not-found-card {
  text-align: center;
}
.not-found-code {
  font-size: 4em;
  font-weight: 700;
  color: var(--accent);
  margin: 0;
}
.not-found-text {
  color: var(--text-secondary);
  margin: var(--space-4) 0 var(--space-6);
}
</style>
