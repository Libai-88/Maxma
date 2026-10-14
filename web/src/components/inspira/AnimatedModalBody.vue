<template>
  <div
    class="animated-modal-body"
    :class="{ 'lock-scroll': lockScroll }"
    @click.self="onOutsideClick"
  >
    <!-- Close button -->
    <button
      v-if="showClose"
      class="modal-close-btn"
      @click="emit('close')"
      aria-label="关闭"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>

    <div class="modal-body-inner">
      <slot />
    </div>

    <!-- Footer slot -->
    <div v-if="$slots.footer" class="modal-footer">
      <slot name="footer" />
    </div>
  </div>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  lockScroll?: boolean
  closeOnOutside?: boolean
  showClose?: boolean
}>(), {
  lockScroll: false,
  closeOnOutside: true,
  showClose: true,
})

const emit = defineEmits<{
  close: []
}>()

function onOutsideClick() {
  if (props.closeOnOutside) {
    emit('close')
  }
}
</script>

<style scoped>
.animated-modal-body {
  position: relative;
  /* MODAL-THEME-001：玻璃底原先是 `color-mix(--text-inverse 8%, transparent)`
     叠在页面之上。深色主题下这层与页面同色、内容近乎隐形。
     改为从 --bg-raised 派生——弹窗是「浮在页面上的一层卡片」，
     底色应当与卡片体系一致；掺 8% --accent 让玻璃层仍带主题色相，
     深色主题自动变深、浅色主题自动变浅，不需要任何主题分支。
     同规则内的 `rgba(255,255,255,…)` 硬编码（描边、滚动条、关闭按钮）一并去掉，
     它们在深色主题下方向同样是反的。 */
  background: linear-gradient(
    145deg,
    color-mix(in srgb, var(--bg-raised) 92%, var(--accent) 8%),
    var(--bg-card)
  );
  border: 1px solid var(--border);
  border-radius: 20px;
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  box-shadow: var(--shadow-xl);
  overflow: hidden;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
}

.lock-scroll {
  overflow: hidden;
}

.modal-body-inner {
  /* MODAL-LAYOUT-001：作为 flex column 容器，让子组件（如设置中心）
     能通过 flex:1 + min-height:0 撑满可视高度、内部自行滚动，
     底部操作区保持可见。原为纯 block + overflow-y:auto，
     内容超高时整个弹窗滚动、底部按钮被挤出视口。 */
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  scrollbar-width: thin;
  scrollbar-color: var(--scrollbar-thumb) transparent;
}

.modal-body-inner::-webkit-scrollbar {
  width: 6px;
}
.modal-body-inner::-webkit-scrollbar-track {
  background: transparent;
}
.modal-body-inner::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb);
  border-radius: 3px;
}

.modal-close-btn {
  position: absolute;
  top: 14px;
  right: 14px;
  z-index: 10;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  /* MODAL-THEME-001：原为 rgba(255,255,255,…)/rgba(0,0,0,.25) 硬编码，
     深色主题下按钮变白框白叉、几乎不可见。改走 --bg-raised / --border / --text-secondary。 */
  border: 1px solid var(--border);
  background: var(--bg-raised);
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s, border-color 0.2s, color 0.2s;
}
.modal-close-btn:hover {
  background: color-mix(in srgb, var(--accent) 10%, var(--bg-raised));
  border-color: var(--border-strong);
  color: var(--text-primary);
}

.modal-footer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 12px 24px 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}
</style>