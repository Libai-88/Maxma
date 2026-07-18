<!-- web/src/views/NotFoundView.vue -->
<template>
  <div class="not-found-view">
    <div class="not-found-card">
      <div class="not-found-icon">🧭</div>
      <h1 class="not-found-code">404</h1>
      <p class="not-found-text">页面不存在或已移动</p>
      <p class="not-found-desc">
        你访问的页面可能已被重命名或删除。可以返回对话继续，或前往以下常用页面：
      </p>
      <div class="not-found-actions">
        <router-link to="/" class="nf-action nf-action-primary">
          <span class="nf-action-icon">💬</span>
          <span class="nf-action-body">
            <span class="nf-action-title">返回对话</span>
            <span class="nf-action-desc">继续与 AI 聊天</span>
          </span>
        </router-link>
        <router-link to="/help" class="nf-action">
          <span class="nf-action-icon">❓</span>
          <span class="nf-action-body">
            <span class="nf-action-title">帮助中心</span>
            <span class="nf-action-desc">了解 Maxma 能力与常见问题</span>
          </span>
        </router-link>
        <router-link to="/appearance" class="nf-action">
          <span class="nf-action-icon">🎨</span>
          <span class="nf-action-body">
            <span class="nf-action-title">外观设置</span>
            <span class="nf-action-desc">切换主题、字体与纹理</span>
          </span>
        </router-link>
      </div>
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
  padding: 32px 24px;
}
.not-found-card {
  text-align: center;
  max-width: 480px;
  padding: 32px 28px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 16px;
  box-shadow: var(--shadow-soft);
}
.not-found-icon {
  font-size: 2.4em;
  line-height: 1;
  margin-bottom: 8px;
}
.not-found-code {
  font-size: 3em;
  font-weight: 700;
  color: var(--accent);
  margin: 0;
  letter-spacing: -1px;
}
.not-found-text {
  color: var(--text-primary);
  font-size: 1.05em;
  font-weight: 600;
  margin: 4px 0 8px;
}
.not-found-desc {
  color: var(--text-secondary);
  font-size: 0.85em;
  line-height: 1.5;
  margin: 0 0 20px;
}
.not-found-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  text-align: left;
}
.nf-action {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-primary);
  color: var(--text-primary);
  text-decoration: none;
  transition: border-color 0.15s, background 0.15s, transform 0.15s;
}
.nf-action:hover {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 6%, var(--bg-primary));
  transform: translateY(-1px);
}
.nf-action-primary {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, var(--bg-primary));
}
.nf-action-icon {
  font-size: 1.5em;
  flex-shrink: 0;
}
.nf-action-body {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.nf-action-title {
  font-size: 0.95em;
  font-weight: 600;
  color: var(--text-primary);
}
.nf-action-desc {
  font-size: 0.78em;
  color: var(--text-secondary);
  line-height: 1.35;
}
</style>
